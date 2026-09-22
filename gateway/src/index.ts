import { createRemoteJWKSet, jwtVerify } from "jose";

const MODEL = "deepseek-flash";
const APPLE_ISSUER = "https://appleid.apple.com";
const NONCE_TTL_MINUTES = 10;
const LOGS_PER_PAGE = 50;

const appleKeys = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`));

// Secrets are not in wrangler.jsonc, so `wrangler types` does not know them.
declare global {
  interface Env {
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
  return Response.json({ token });
}

/** Forwards authenticated model requests through Cloudflare AI Gateway. */
async function proxy(request: Request, env: Env, ctx: ExecutionContext, pathname: string): Promise<Response> {
  const user = await authenticate(request, env);
  if (!user) return status(401);
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
    body = JSON.stringify({ ...input, model: MODEL });
  }

  const upstream = `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.CLOUDFLARE_AI_GATEWAY_ID}/deepseek`;
  return fetch(`${upstream}${pathname}`, { method: request.method, headers, body });
}

/** Returns the current user's month-to-date AI Gateway cost and token totals. */
async function usage(request: Request, env: Env): Promise<Response> {
  const user = await authenticate(request, env);
  if (!user) return status(401);

  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const totals = { estimatedCostUsd: 0, inputTokens: 0, outputTokens: 0, requests: 0 };

  let page = 1;
  let totalCount = 0;
  do {
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai-gateway/gateways/${env.CLOUDFLARE_AI_GATEWAY_ID}/logs`);
    url.searchParams.set("start_date", start.toISOString());
    url.searchParams.set("end_date", end.toISOString());
    url.searchParams.set("search", user.billingId);
    url.searchParams.set("per_page", String(LOGS_PER_PAGE));
    url.searchParams.set("page", String(page));

    const response = await fetch(url, { headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } });
    if (!response.ok) {
      console.error("AI Gateway logs request failed", response.status, (await response.text()).slice(0, 1_000));
      return status(502);
    }
    const payload = await response.json<CloudflareLogsResponse>();
    if (!payload.success) {
      console.error("AI Gateway logs request was unsuccessful", JSON.stringify(payload).slice(0, 1_000));
      return status(502);
    }

    for (const log of payload.result) {
      if (!belongsTo(log.metadata, user.billingId) || !log.path.endsWith("/chat/completions")) continue;
      totals.estimatedCostUsd += log.cost ?? 0;
      totals.inputTokens += log.tokens_in ?? 0;
      totals.outputTokens += log.tokens_out ?? 0;
      totals.requests += 1;
    }
    totalCount = payload.result_info.total_count ?? payload.result.length;
    page += 1;
  } while ((page - 1) * LOGS_PER_PAGE < totalCount);

  return Response.json({
    period: { start: start.toISOString(), end: end.toISOString() },
    currency: "USD",
    ...totals
  });
}

async function authenticate(request: Request, env: Env): Promise<{ token: string; billingId: string } | null> {
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) return null;
  const row = await env.DB.prepare("SELECT user_id FROM tokens WHERE token = ?").bind(token).first<{ user_id: string }>();
  return row ? { token, billingId: await sha256(row.user_id) } : null;
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

interface CloudflareLogsResponse {
  success: boolean;
  result: Array<{
    path: string;
    tokens_in: number | null;
    tokens_out: number | null;
    cost?: number;
    metadata?: unknown;
  }>;
  result_info: { total_count?: number };
}

function status(code: number): Response {
  return new Response(null, { status: code });
}
