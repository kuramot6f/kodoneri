import type { Pricing } from "../../extension/src/shared/models.ts";

/** AI Gateway writes a log some time after the response ends, so the cost is polled for. */
const LOG_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];

export interface LoggedCost {
  costMicrousd: number;
  inputTokens: number;
  outputTokens: number;
}

/** The `cf-aig-custom-cost` header that has AI Gateway price the request: USD per token, not per million. */
export function customCost(pricing: Pricing, at: Date): string {
  const multiplier = pricing.peak && isPeak(pricing.peak.weekdayHoursUtc, at) ? pricing.peak.multiplier : 1;
  const perToken = (rate: number) => rate * multiplier / 1_000_000;
  return JSON.stringify({
    per_token_in: perToken(pricing.input),
    per_cache_read_token: perToken(pricing.cacheRead),
    per_cache_write_token: perToken(pricing.cacheWrite ?? pricing.input),
    per_token_out: perToken(pricing.output)
  });
}

/** The cost AI Gateway calculated for a finished request, or null when its log never carried one. */
export async function loggedCost(gateway: AiGateway, logId: string): Promise<LoggedCost | null> {
  for (const delay of LOG_DELAYS_MS) {
    await scheduler.wait(delay);
    const log = await gateway.getLog(logId).catch(() => null);
    if (log?.cost == null) continue;
    return {
      costMicrousd: Math.max(0, Math.round(log.cost * 1_000_000)),
      inputTokens: log.tokens_in ?? 0,
      outputTokens: log.tokens_out ?? 0
    };
  }
  return null;
}

function isPeak(hours: [number, number][], at: Date): boolean {
  const day = at.getUTCDay();
  const hour = at.getUTCHours();
  return day >= 1 && day <= 5 && hours.some(([start, end]) => hour >= start && hour < end);
}
