import { findCatalogModel, type Provider } from "../../extension/src/shared/models.ts";

/** Tokens split by what each costs; `input` excludes the cached and cache-written ones. */
export interface Usage {
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
  /** Provider-hosted web searches, billed per call; what they bring in is billed as input. */
  webSearches: number;
}

/** OpenAI and Anthropic charge $10 per 1,000 searches; DeepSeek's run through its metered tool endpoints. */
const WEB_SEARCH_MICROUSD: Record<Provider, number> = { openai: 10_000, anthropic: 10_000, deepseek: 0 };

type Json = Record<string, any>;

/** Reads one response body or stream event; Anthropic spreads its usage over two events, so the previous read carries over. */
const READERS: Record<Provider, (json: Json, previous: Usage | null) => Usage | null> = {
  openai: (json) => {
    const usage = json.usage ?? json.response?.usage;
    if (!usage) return null;
    const cached = usage.input_tokens_details?.cached_tokens ?? 0;
    // Each web_search_call item is a billed call; the completed response lists them all.
    const output: Json[] = json.output ?? json.response?.output ?? [];
    const webSearches = output.filter((item) => item.type === "web_search_call" && item.status === "completed").length;
    return { input: usage.input_tokens - cached, cachedInput: cached, cacheWrite: 0, output: usage.output_tokens, webSearches };
  },
  anthropic: (json, previous) => {
    const usage = json.usage ?? json.message?.usage;
    if (!usage) return null;
    return {
      input: usage.input_tokens ?? previous?.input ?? 0,
      cachedInput: usage.cache_read_input_tokens ?? previous?.cachedInput ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? previous?.cacheWrite ?? 0,
      output: usage.output_tokens ?? previous?.output ?? 0,
      // Web fetches cost only their tokens.
      webSearches: usage.server_tool_use?.web_search_requests ?? previous?.webSearches ?? 0
    };
  },
  deepseek: (json) => {
    const usage = json.usage;
    if (!usage) return null;
    const cached = usage.prompt_cache_hit_tokens ?? 0;
    return { input: usage.prompt_tokens - cached, cachedInput: cached, cacheWrite: 0, output: usage.completion_tokens, webSearches: 0 };
  }
};

/** The usage a finished response reported, from a JSON body or a server-sent event stream. */
export function readUsage(provider: Provider, body: string): Usage | null {
  const events = body.trimStart().startsWith("{")
    ? [body]
    : body.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
  let usage: Usage | null = null;
  for (const event of events) {
    const json = parse(event);
    if (json) usage = READERS[provider](json, usage) ?? usage;
  }
  return usage;
}

/** Prices are per million tokens, so tokens times price is microUSD. */
export function costMicrousd(model: string, usage: Usage): number {
  const { price, provider } = findCatalogModel(model)!;
  return usage.webSearches * WEB_SEARCH_MICROUSD[provider] + Math.round(
    usage.input * price.input
    + usage.cachedInput * price.cachedInput
    + usage.cacheWrite * (price.cacheWrite ?? price.input)
    + usage.output * price.output
  );
}

function parse(event: string): Json | null {
  try {
    const json = JSON.parse(event);
    return typeof json === "object" && json ? json : null;
  } catch {
    return null;
  }
}
