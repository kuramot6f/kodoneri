import { createRemoteJWKSet, jwtVerify } from "jose";
import { effectivePlan, ensureBilling, syncTransaction, verifyNotification, type BillingRow } from "./billing";

const MODEL = "deepseek-flash";
const APPLE_ISSUER = "https://appleid.apple.com";
const NONCE_TTL_MINUTES = 10;

const appleKeys = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`));

// Secrets are not in wrangler.jsonc, so `wrangler types` does not know them.
declare global {
  interface Env {
    APPLE_APP_ID?: string;
    CLOUDFLARE_API_TOKEN: string;
    DEEPSEEK_API_KEY: string;
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/auth/apple/nonce") return request.method === "POST" ? createNonce(env) : status(405);
    if (pathname === "/auth/apple") return request.method === "POST" ? signIn(request, env) : status(405);
    if (pathname === "/usage") return request.method === "GET" ? usage(request, env) : status(405);
    if (pathname === "/billing/transaction") return request.method === "POST" ? updateSubscription(request, env) : status(405);
    if (pathname === "/billing/apple/notifications") return request.method === "POST" ? appleNotification(request, env) : status(405);
    if (pathname === "/chat/completions" || pathname === "/files" || pathname.startsWith("/files/")) {
      return proxy(request, env, ctx, pathname);
    }
    return status(404);
  }
} satisfies ExportedHandler<Env>;

/** Issues a short-lived, single-use nonce before Sign in with Apple starts. */
async function createNonce(env: Env): Promise<Response> {
  const nonce = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const nonceHash = await sha256(nonce);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_nonces WHERE expires_at <= datetime('now') OR used_at IS NOT NULL"),
    env.DB.prepare(`INSERT INTO oauth_nonces (nonce_hash, expires_at) VALUES (?, datetime('now', '+${NONCE_TTL_MINUTES} minutes'))`).bind(nonceHash)
  ]);
  return Response.json({ nonce });
}

/** Trades an Apple identity token and its one-time nonce for a gateway token. */
async function signIn(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => null) as { identityToken?: unknown; nonce?: unknown } | null;
  if (typeof body?.identityToken !== "string" || typeof body.nonce !== "string" || !/^[a-f0-9]{64}$/i.test(body.nonce)) {
    return status(400);
  }

  const nonceHash = await sha256(body.nonce);
  let subject: string;
  try {
    const { payload } = await jwtVerify(body.identityToken, appleKeys, {
      issuer: APPLE_ISSUER,
      audience: env.APPLE_BUNDLE_ID
    });
    if (!payload.sub || payload.nonce !== nonceHash) return status(401);
    subject = payload.sub;
  } catch {
    return status(401);
  }

  const consumed = await env.DB.prepare(
    "UPDATE oauth_nonces SET used_at = datetime('now') WHERE nonce_hash = ? AND used_at IS NULL AND expires_at > datetime('now')"
  ).bind(nonceHash).run();
  if (consumed.meta.changes !== 1) return status(401);

  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").bind(subject),
    env.DB.prepare("INSERT INTO tokens (token, user_id) VALUES (?, ?)").bind(token, subject)
  ]);
  await ensureBilling(env, subject);
  return Response.json({ token });
}

/** Forwards authenticated model requests through Cloudflare AI Gateway. */
async function proxy(request: Request, env: Env, ctx: ExecutionContext, pathname: string): Promise<Response> {
  const user = await authenticate(request, env);
  if (!user) return status(401);
  const billing = await ensureBilling(env, user.userId);
  if (!canUseGateway(billing)) return usageLimitResponse(billing);
  ctx.waitUntil(env.DB.prepare("UPDATE tokens SET last_used_at = datetime('now') WHERE token = ?").bind(user.token).run());

  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${env.DEEPSEEK_API_KEY}`);
  headers.set("cf-aig-authorization", `Bearer ${env.CLOUDFLARE_API_TOKEN}`);
  headers.set("cf-aig-metadata", JSON.stringify({ user_id: user.billingId }));
  headers.set("cf-aig-collect-log-payload", "false");
  headers.delete("host");

  let body: BodyInit | null = request.body;
  if (pathname === "/chat/completions" && request.method === "POST") {
    const input = await request.json<object>().catch(() => null);
    if (!input) return status(400);
    body = JSON.stringify({ ...input, model: MODEL, user_id: user.billingId });
  }

  const upstream = `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.CLOUDFLARE_AI_GATEWAY_ID}/deepseek`;
  const response = await fetch(`${upstream}${pathname}`, { method: request.method, headers, body });
  if (pathname !== "/chat/completions" || !response.ok) return response;

  const logId = response.headers.get("cf-aig-log-id");
  if (!logId || !billing.period_start) return response;
  if (!response.body) {
    ctx.waitUntil(recordUsage(env, user.userId, user.billingId, billing.period_start, logId));
    return response;
  }

  const [clientBody, meterBody] = response.body.tee();
  ctx.waitUntil(drain(meterBody).catch(() => undefined).then(() => recordUsage(env, user.userId, user.billingId, billing.period_start!, logId)));
  return new Response(clientBody, response);
}

/** Returns the current StoreKit period and D1-backed usage totals. */
async function usage(request: Request, env: Env): Promise<Response> {
  const user = await authenticate(request, env);
  if (!user) return status(401);
  return billingResponse(await ensureBilling(env, user.userId));
}

async function updateSubscription(request: Request, env: Env): Promise<Response> {
  const user = await authenticate(request, env);
  if (!user) return status(401);
  await ensureBilling(env, user.userId);
  const body = await request.json().catch(() => null) as { signedTransaction?: unknown } | null;
  if (typeof body?.signedTransaction !== "string") return status(400);
  try {
    const billing = await syncTransaction(env, body.signedTransaction, user.userId);
    return billing ? billingResponse(billing) : status(400);
  } catch (error) {
    console.error("StoreKit transaction verification failed", error);
    return status(error instanceof Error && error.message.includes("APPLE_APP_ID") ? 503 : 400);
  }
}

async function appleNotification(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => null) as { signedPayload?: unknown } | null;
  if (typeof body?.signedPayload !== "string") return status(400);
  try {
    const signedTransaction = await verifyNotification(env, body.signedPayload);
    if (signedTransaction) await syncTransaction(env, signedTransaction);
    return status(200);
  } catch (error) {
    console.error("App Store notification verification failed", error);
    return status(error instanceof Error && error.message.includes("APPLE_APP_ID") ? 503 : 400);
  }
}

function billingResponse(row: BillingRow): Response {
  const plan = effectivePlan(row);
  const allowance = plan === "free" ? 0 : row.allowance_microusd;
  const used = plan === "free" ? 0 : row.used_microusd;
  return Response.json({
    plan,
    productID: plan === "free" ? null : row.product_id,
    period: row.period_start && row.period_end ? { start: row.period_start, end: row.period_end } : null,
    currency: "USD",
    allowanceUsd: allowance / 1_000_000,
    estimatedCostUsd: used / 1_000_000,
    remainingUsd: Math.max(allowance - used, 0) / 1_000_000,
    inputTokens: plan === "free" ? 0 : row.input_tokens,
    outputTokens: plan === "free" ? 0 : row.output_tokens,
    requests: plan === "free" ? 0 : row.requests,
    appAccountToken: row.app_account_token
  });
}

async function authenticate(request: Request, env: Env): Promise<{ token: string; userId: string; billingId: string } | null> {
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) return null;
  const row = await env.DB.prepare("SELECT user_id FROM tokens WHERE token = ?").bind(token).first<{ user_id: string }>();
  return row ? { token, userId: row.user_id, billingId: await sha256(row.user_id) } : null;
}

function canUseGateway(row: BillingRow): boolean {
  return effectivePlan(row) !== "free" && row.used_microusd < row.allowance_microusd;
}

function usageLimitResponse(row: BillingRow): Response {
  const message = effectivePlan(row) === "free" ? "A Plus or Pro subscription is required." : "The usage limit for this billing period has been reached.";
  return Response.json({ error: { message, type: "usage_limit_exceeded" } }, { status: 402 });
}

async function drain(body: ReadableStream<Uint8Array>): Promise<void> {
  await body.pipeTo(new WritableStream());
}

async function recordUsage(env: Env, userId: string, billingId: string, periodStart: string, logId: string): Promise<void> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai-gateway/gateways/${env.CLOUDFLARE_AI_GATEWAY_ID}/logs/${encodeURIComponent(logId)}`;
  for (const delay of [0, 250, 750, 1_500, 3_000, 5_000]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    const response = await fetch(url, { headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } });
    if (!response.ok) continue;
    const payload = await response.json<CloudflareLogResponse>();
    const log = payload.result;
    if (!payload.success || !log || log.cost == null || !belongsTo(log.metadata, billingId)) continue;
    await env.DB.prepare(`
      INSERT OR IGNORE INTO usage_events
        (log_id, user_id, period_start, cost_microusd, input_tokens, output_tokens)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(logId, userId, periodStart, Math.max(0, Math.round(log.cost * 1_000_000)), log.tokens_in ?? 0, log.tokens_out ?? 0).run();
    return;
  }
  console.error("AI Gateway usage log was not ready", logId);
}

function belongsTo(metadata: unknown, billingId: string): boolean {
  try {
    const value = typeof metadata === "string" ? JSON.parse(metadata) as unknown : metadata;
    return typeof value === "object" && value !== null && (value as Record<string, unknown>).user_id === billingId;
  } catch {
    return false;
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface CloudflareLogResponse {
  success: boolean;
  result?: {
    path: string;
    tokens_in: number | null;
    tokens_out: number | null;
    cost?: number;
    metadata?: unknown;
  };
}

function status(code: number): Response {
  return new Response(null, { status: code });
}
