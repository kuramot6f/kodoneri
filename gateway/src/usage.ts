export interface DeepSeekUsage {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  prompt_cache_hit_tokens?: number | null;
  prompt_cache_miss_tokens?: number | null;
}

const PRICING = {
  offPeak: { cacheHit: 0.003, cacheMiss: 0.15, output: 0.6 },
  peak: { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 }
} as const;

/** Returns DeepSeek Flash's estimated cost in microUSD using the current public per-million-token prices. */
export function deepSeekCostMicrousd(usage: DeepSeekUsage, at: Date): number {
  const input = tokens(usage.prompt_tokens);
  const output = tokens(usage.completion_tokens);
  const cacheHit = Math.min(tokens(usage.prompt_cache_hit_tokens), input);
  const reportedMiss = Math.min(tokens(usage.prompt_cache_miss_tokens), input - cacheHit);
  const cacheMiss = Math.max(input - cacheHit, reportedMiss);
  const price = isPeak(at) ? PRICING.peak : PRICING.offPeak;
  return Math.max(0, Math.round(cacheHit * price.cacheHit + cacheMiss * price.cacheMiss + output * price.output));
}

function tokens(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function isPeak(at: Date): boolean {
  const day = at.getUTCDay();
  const hour = at.getUTCHours();
  return day >= 1 && day <= 5 && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10));
}
