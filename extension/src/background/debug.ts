import { DebugLog, type DebugData } from "../shared/debugLog";

const log = new DebugLog(browser.storage.session, crypto.randomUUID());
let nativeWrites: Promise<void> = Promise.resolve();

function mirror(event: string): Promise<void> {
  const manifest = browser.runtime.getManifest();
  nativeWrites = nativeWrites.catch(() => undefined).then(async () => {
    await browser.runtime.sendNativeMessage("application.id", {
      type: "debugRecord",
      event,
      metadata: JSON.stringify({
        extensionVersion: manifest.version,
        userAgent: navigator.userAgent,
        platform: navigator.platform
      })
    });
  });
  return nativeWrites;
}

export function debugEvent(event: string, data?: DebugData, scope: "background" | "content" = "background"): void {
  void log.record(scope, event, data)
    .then((entry) => mirror(JSON.stringify(entry)))
    .catch(() => undefined);
}
