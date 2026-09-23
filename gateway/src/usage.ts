import type { Pricing, Provider } from "../../extension/src/shared/models.ts";

/** Input split the way prices are: uncached, read from cache, written to cache. */
export interface TokenUsage {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

type RawUsage = Record<string, unknown>;

/** Each provider reports usage in its own shape. */
const READERS: Record<Provider, (usage: RawUsage) => TokenUsage> = {
  // Responses API: input_tokens includes the cached part.
  openai: (usage) => {
    const total = tokens(usage.input_tokens);
    const cached = Math.min(tokens((usage.input_tokens_details as RawUsage | undefined)?.cached_tokens), total);
    return { input: total - cached, cacheRead: cached, cacheWrite: 0, output: tokens(usage.output_tokens) };
  },
  // Messages API: input_tokens excludes cache reads and writes.
  anthropic: (usage) => ({
    input: tokens(usage.input_tokens),
    cacheRead: tokens(usage.cache_read_input_tokens),
    cacheWrite: tokens(usage.cache_creation_input_tokens),
    output: tokens(usage.output_tokens)
  }),
  // Chat Completions: prompt_tokens includes the cache hits.
  deepseek: (usage) => {
    const total = tokens(usage.prompt_tokens);
    const hit = Math.min(tokens(usage.prompt_cache_hit_tokens), total);
    return { input: total - hit, cacheRead: hit, cacheWrite: 0, output: tokens(usage.completion_tokens) };
  }
};

export function readUsage(provider: Provider, usage: RawUsage): TokenUsage {
  return READERS[provider](usage);
}

export function totalInput(usage: TokenUsage): number {
  return usage.input + usage.cacheRead + usage.cacheWrite;
}

/** Prices are USD per million tokens, so tokens × price is microUSD. */
export function costMicrousd(pricing: Pricing, usage: TokenUsage, at: Date): number {
  const rates = pricing.longContext && totalInput(usage) > pricing.longContext.above ? pricing.longContext : pricing;
  const multiplier = pricing.peak && isPeak(pricing.peak.weekdayHoursUtc, at) ? pricing.peak.multiplier : 1;
  const cost = usage.input * rates.input
    + usage.cacheRead * rates.cacheRead
    + usage.cacheWrite * (rates.cacheWrite ?? rates.input)
    + usage.output * rates.output;
  return Math.max(0, Math.round(cost * multiplier));
}

/**
 * Merges every usage object a JSON or SSE response carries: top-level `usage` (Chat Completions, Messages
 * message_delta), `response.usage` (Responses) and `message.usage` (Messages message_start). Later values win.
 */
export async function extractUsage(body: ReadableStream<Uint8Array>, contentType: string | null): Promise<RawUsage | null> {
  let merged: RawUsage | null = null;
  const collect = (value: unknown) => {
    if (!isObject(value)) return;
    for (const usage of [value.usage, isObject(value.response) ? value.response.usage : null, isObject(value.message) ? value.message.usage : null]) {
      if (!isObject(usage)) continue;
      merged = { ...merged, ...Object.fromEntries(Object.entries(usage).filter(([, field]) => field != null)) };
    }
  };

  if (!contentType?.includes("text/event-stream")) {
    collect(await new Response(body).json());
    return merged;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const readLines = (text: string) => {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        collect(JSON.parse(data));
      } catch {
        // Ignore non-JSON SSE events while continuing to drain the metering branch.
      }
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const boundary = buffer.lastIndexOf("\n");
    if (boundary < 0) continue;
    readLines(buffer.slice(0, boundary + 1));
    buffer = buffer.slice(boundary + 1);
  }
  readLines(buffer + decoder.decode());
  return merged;
}

function tokens(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function isPeak(hours: [number, number][], at: Date): boolean {
  const day = at.getUTCDay();
  const hour = at.getUTCHours();
  return day >= 1 && day <= 5 && hours.some(([start, end]) => hour >= start && hour < end);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
