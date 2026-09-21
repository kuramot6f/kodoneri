import { createRemoteJWKSet, jwtVerify } from "jose";

const UPSTREAM = "https://api.deepseek.com";
/** The only model the gateway serves; whatever the client asks for is replaced. */
const MODEL = "deepseek-flash";
const APPLE_ISSUER = "https://appleid.apple.com";

const appleKeys = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`));

// Secrets are not in wrangler.jsonc, so `wrangler types` does not know them.
declare global {
  interface Env {
    DEEPSEEK_API_KEY: string;
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/auth/apple") return request.method === "POST" ? signIn(request, env) : status(405);
    if (pathname === "/chat/completions" || pathname === "/files" || pathname.startsWith("/files/")) return proxy(request, env, ctx, pathname);
    return status(404);
  }
} satisfies ExportedHandler<Env>;

/** Trades an Apple identity token for a gateway token the extension sends as its API key. */
async function signIn(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => null) as { identityToken?: unknown } | null;
  if (typeof body?.identityToken !== "string") return status(400);

  let userId: string;
  try {
    const { payload } = await jwtVerify(body.identityToken, appleKeys, { issuer: APPLE_ISSUER, audience: env.APPLE_BUNDLE_ID });
    if (!payload.sub) return status(401);
    userId = payload.sub;
  } catch {
    return status(401);
  }

  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").bind(userId),
    env.DB.prepare("INSERT INTO tokens (token, user_id) VALUES (?, ?)").bind(token, userId)
  ]);
  return Response.json({ token });
}

/** Forwards the request to DeepSeek with the real key; the response, streamed or not, is returned as is. */
async function proxy(request: Request, env: Env, ctx: ExecutionContext, pathname: string): Promise<Response> {
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  const row = token && await env.DB.prepare("SELECT user_id FROM tokens WHERE token = ?").bind(token).first();
  if (!row) return status(401);
  ctx.waitUntil(env.DB.prepare("UPDATE tokens SET last_used_at = datetime('now') WHERE token = ?").bind(token).run());

  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${env.DEEPSEEK_API_KEY}`);
  headers.delete("host");

  const body = pathname === "/chat/completions" && request.method === "POST"
    ? JSON.stringify({ ...await request.json<object>(), model: MODEL })
    : request.body;

  return fetch(`${UPSTREAM}${pathname}`, { method: request.method, headers, body });
}

function status(code: number): Response {
  return new Response(null, { status: code });
}
