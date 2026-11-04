/** AI Gateway writes a log some time after the response ends, so the cost is polled for. */
const LOG_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];

export interface LoggedCost {
  costMicrousd: number;
  inputTokens: number;
  outputTokens: number;
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
