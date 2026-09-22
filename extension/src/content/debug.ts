import type { DebugData } from "../shared/debugLog";
import type { RuntimeMessage } from "../shared/protocol";

const contextId = crypto.randomUUID();

export function debugEvent(event: string, data?: DebugData): void {
  void browser.runtime.sendMessage({ type: "debug", contextId, event, data } satisfies RuntimeMessage).catch(() => undefined);
}
