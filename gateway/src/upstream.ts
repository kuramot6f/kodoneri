import type { Provider } from "../../extension/src/shared/models.ts";

export type Body = Record<string, unknown>;

/**
 * Each provider's API is relayed under `/{provider}`. Every user shares one provider key and only tokens are metered,
 * so anything that reaches other users' data or bills outside the token usage is closed off.
 */
interface Upstream {
  /** The path whose JSON body names the model; the only one that is metered. */
  generate: string;
  /** Upload only: listing, reading or deleting would reach every user's files. */
  files: string;
  /** Tool types that run on the client; provider-hosted tools bill outside the token usage. */
  toolTypes: unknown[];
  /** Body fields that bill outside the token usage, run unmetered, or switch to another model. */
  drop: string[];
  /** Tags the request with the hashed user so the provider can attribute abuse. */
  identify(body: Body, billingId: string): Body;
}

export const UPSTREAMS: Record<Provider, Upstream> = {
  openai: {
    generate: "/responses",
    files: "/files",
    toolTypes: ["function"],
    drop: ["background", "service_tier", "prompt", "conversation"],
    identify: (body, billingId) => ({ ...body, safety_identifier: billingId })
  },
  anthropic: {
    generate: "/v1/messages",
    files: "/v1/files",
    toolTypes: [undefined, "custom"],
    drop: ["service_tier", "speed", "inference_geo", "fallbacks", "mcp_servers", "container"],
    identify: (body, billingId) => ({ ...body, metadata: { ...(body.metadata as Body | undefined), user_id: billingId } })
  },
  deepseek: {
    generate: "/chat/completions",
    files: "/files",
    toolTypes: ["function"],
    drop: [],
    // Without include_usage a stream carries no usage and could not be metered.
    identify: (body, billingId) => ({
      ...body,
      user_id: billingId,
      ...(body.stream ? { stream_options: { ...(body.stream_options as Body | undefined), include_usage: true } } : {})
    })
  }
};

/** The provider's API on Cloudflare AI Gateway, which adds the stored provider key. */
export function gatewayUrl(env: Env, provider: Provider): string {
  return `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.CLOUDFLARE_AI_GATEWAY_ID}/${provider}`;
}

/** Returns the body to send, or null when it asks for a provider-hosted tool. */
export function prepareBody(provider: Provider, body: Body, billingId: string): Body | null {
  const upstream = UPSTREAMS[provider];
  const tools = body.tools ?? [];
  if (!Array.isArray(tools) || tools.some((tool) => !upstream.toolTypes.includes((tool as Body | null)?.type))) return null;
  const kept = Object.fromEntries(Object.entries(body).filter(([key]) => !upstream.drop.includes(key)));
  return upstream.identify(kept, billingId);
}

/** Betas the extension's SDK sends; others can switch on pricier features. */
const ANTHROPIC_BETAS = new Set(["files-api-2025-04-14", "thinking-binding-controls-2026-08-01"]);

/** Only what the provider APIs need; `cf-aig-*` and the like would let a client steer AI Gateway. */
export function requestHeaders(source: Headers): Headers {
  const headers = pick(source, ["content-type", "accept", "anthropic-version"]);
  const betas = source.get("anthropic-beta")?.split(",").map((beta) => beta.trim()).filter((beta) => ANTHROPIC_BETAS.has(beta));
  if (betas?.length) headers.set("anthropic-beta", betas.join(","));
  return headers;
}

/** Relays the status and body without provider headers such as the organization id. */
export function clientResponse(body: ReadableStream | null, response: Response): Response {
  return new Response(body, { status: response.status, headers: pick(response.headers, ["content-type", "retry-after"]) });
}

function pick(source: Headers, names: string[]): Headers {
  const headers = new Headers();
  for (const name of names) {
    const value = source.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}
