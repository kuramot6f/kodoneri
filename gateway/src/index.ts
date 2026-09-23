import { createRemoteJWKSet, jwtVerify } from "jose";
import { findCatalogModel, PLANS, type Provider } from "../../extension/src/shared/models.ts";
import { effectivePlan, ensureBilling, syncTransaction, verifyNotification, type BillingRow } from "./billing";
import { UPSTREAMS, clientResponse, prepareBody, requestHeaders, type Body } from "./upstream";
import { costMicrousd, extractUsage, readUsage, totalInput } from "./usage";

const APPLE_ISSUER = "https://appleid.apple.com";
const NONCE_TTL_MINUTES = 10;

const appleKeys = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`));

// Secrets are not in wrangler.jsonc, so `wrangler types` does not know them.
declare global {
  interface Env {
    CLOUDFLARE_API_TOKEN: string;
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
    const [, provider, rest = ""] = pathname.match(/^\/([^/]+)(\/.*)?$/) ?? [];
    if (provider && Object.hasOwn(UPSTREAMS, provider)) return proxy(request, env, ctx, provider as Provider, rest);
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
  const tokenHash = await sha256(token);
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").bind(subject),
    env.DB.prepare("INSERT INTO tokens (token_hash, user_id) VALUES (?, ?)").bind(tokenHash, subject)
  ]);
  await ensureBilling(env, subject);
  return Response.json({ token });
}

/** Forwards authenticated model and file requests through Cloudflare AI Gateway using its stored provider keys. */
async function proxy(request: Request, env: Env, ctx: ExecutionContext, provider: Provider, path: string): Promise<Response> {
  const upstream = UPSTREAMS[provider];
  const generating = path === upstream.generate;
  if (!generating && path !== upstream.files) return status(404);
  if (request.method !== "POST") return status(405);
  const user = await authenticate(request, env);
  if (!user) return status(401);
  const billing = await ensureBilling(env, user.userId);
  if (!canUseGateway(billing)) return usageLimitResponse(billing);

  let body: BodyInit;
  let model: string | null = null;
  if (generating) {
    const input = await request.json<Body>().catch(() => null);
    if (!input) return status(400);
    model = typeof input.model === "string" ? input.model : null;
    const plan = effectivePlan(billing);
    if (!model || findCatalogModel(model)?.provider !== provider || !PLANS[plan].includes(model)) {
      return errorResponse(403, "model_not_allowed", `${model ?? "This model"} is not included in the ${plan} plan.`);
    }
    const prepared = prepareBody(provider, input, user.billingId);
    if (!prepared) return errorResponse(400, "tool_not_allowed", "Only function tools are available through chatext.");
    body = JSON.stringify(prepared);
  } else {
    body = await request.arrayBuffer();
  }
  ctx.waitUntil(env.DB.prepare("UPDATE tokens SET last_used_at = datetime('now') WHERE token_hash = ?").bind(user.tokenHash).run());

  const headers = requestHeaders(request.headers);
  headers.set("cf-aig-authorization", `Bearer ${env.CLOUDFLARE_API_TOKEN}`);
  headers.set("cf-aig-metadata", JSON.stringify({ user_id: user.billingId }));
  headers.set("cf-aig-collect-log-payload", "false");

  const base = `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.CLOUDFLARE_AI_GATEWAY_ID}/${provider}`;
  const response = await fetch(`${base}${path}`, { method: "POST", headers, body });
  if (!model || !response.ok || !response.body || !billing.period_start) return clientResponse(response.body, response);

  const [clientBody, meterBody] = response.body.tee();
  const eventId = response.headers.get("cf-aig-log-id") ?? crypto.randomUUID();
  ctx.waitUntil(extractUsage(meterBody, response.headers.get("content-type"))
    .then((usage) => usage
      ? recordUsage(env, user.userId, billing.period_start!, eventId, provider, model!, usage)
      : console.error("Provider response carried no usage", provider, model, eventId))
    .catch((error) => console.error("Usage could not be recorded", provider, model, eventId, error)));
  return clientResponse(clientBody, response);
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
  const allowance = row.allowance_microusd;
  const used = row.used_microusd;
  return Response.json({
    plan,
    productID: row.product_id,
    period: row.period_start && row.period_end ? { start: row.period_start, end: row.period_end } : null,
    currency: "USD",
    allowanceUsd: allowance / 1_000_000,
    estimatedCostUsd: used / 1_000_000,
    remainingUsd: Math.max(allowance - used, 0) / 1_000_000,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    requests: row.requests,
    appAccountToken: row.app_account_token
  });
}

async function authenticate(request: Request, env: Env): Promise<{ tokenHash: string; userId: string; billingId: string } | null> {
  // The Anthropic SDK sends its key as x-api-key; the others use a bearer token.
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1] ?? request.headers.get("x-api-key");
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare("SELECT user_id FROM tokens WHERE token_hash = ?").bind(tokenHash).first<{ user_id: string }>();
  return row ? { tokenHash, userId: row.user_id, billingId: await sha256(row.user_id) } : null;
}

function canUseGateway(row: BillingRow): boolean {
  return row.used_microusd < row.allowance_microusd;
}

function usageLimitResponse(row: BillingRow): Response {
  const message = effectivePlan(row) === "free"
    ? "The free usage limit for this month has been reached. Subscribe to Plus or Pro to continue."
    : "The usage limit for this billing period has been reached.";
  return errorResponse(402, "usage_limit_exceeded", message);
}

function errorResponse(code: number, type: string, message: string): Response {
  return Response.json({ error: { message, type } }, { status: code });
}

/** Prices the provider-reported usage from the catalog; the event id keeps a retried write from counting twice. */
async function recordUsage(
  env: Env,
  userId: string,
  periodStart: string,
  eventId: string,
  provider: Provider,
  model: string,
  raw: Record<string, unknown>
): Promise<void> {
  const usage = readUsage(provider, raw);
  const cost = costMicrousd(findCatalogModel(model)!.pricing, usage, new Date());
  await env.DB.prepare(`
    INSERT OR IGNORE INTO usage_events
      (log_id, user_id, period_start, cost_microusd, input_tokens, output_tokens)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(eventId, userId, periodStart, cost, totalInput(usage), usage.output).run();
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function status(code: number): Response {
  return new Response(null, { status: code });
}
