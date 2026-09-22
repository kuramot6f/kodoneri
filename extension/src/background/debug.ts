import { DebugLog, type DebugData } from "../shared/debugLog";

const log = new DebugLog(browser.storage.session, crypto.randomUUID());

export function debugEvent(event: string, data?: DebugData, scope: "background" | "content" = "background"): void {
  void log.record(scope, event, data).catch(() => undefined);
}

export function exportDebugLog(): Promise<string> {
  const manifest = browser.runtime.getManifest();
  return log.export({
    extensionVersion: manifest.version,
    userAgent: navigator.userAgent,
    platform: navigator.platform
  });
}

export function clearDebugLog(): Promise<void> {
  return log.clear();
}
