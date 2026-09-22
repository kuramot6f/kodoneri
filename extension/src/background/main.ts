import type { ModelsView, RuntimeMessage, WhoAmI } from "../shared/protocol";
import { activateBrowserLocale, i18n } from "../shared/i18n.ts";
import { loadSettings, saveSettings } from "../shared/store";
import { loadTextResource } from "../shared/textResource";
import { clearFrames, registerFrame } from "./frames";
import { clearDebugLog, debugEvent, exportDebugLog } from "./debug";
import { availableModels, refreshApiKeys, resolveSettings } from "./provider";
import { attachPort, removeSession, togglePanel } from "./session";

activateBrowserLocale();
debugEvent("worker_started");
void refreshApiKeys().catch(() => undefined);

browser.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined) void togglePanel(tab.id);
});

browser.tabs.onRemoved.addListener((tabId) => {
  clearFrames(tabId);
  removeSession(tabId);
});

browser.runtime.onConnect.addListener((port) => {
  if (port.name === "panel") {
    debugEvent("panel_port_received", {
      tabId: port.sender?.tab?.id ?? null,
      frameId: port.sender?.frameId ?? null
    });
    void attachPort(port);
  }
});

browser.runtime.onMessage.addListener((message: RuntimeMessage, sender) => {
  if (message.type === "debug") {
    debugEvent(message.event, {
      contentContextId: message.contextId,
      tabId: sender.tab?.id ?? null,
      frameId: sender.frameId ?? null,
      ...message.data
    }, "content");
    return;
  }
  if (message.type === "debug_export") return exportDebugLog();
  if (message.type === "debug_clear") return clearDebugLog();
  if (message.type === "whoami") {
    if (sender.tab?.id === undefined || sender.frameId === undefined) return;
    return Promise.resolve({ tabId: sender.tab.id, frameId: sender.frameId } satisfies WhoAmI);
  }
  if (message.type === "frame") {
    registerFrame(message.ref, sender);
    return;
  }
  if (message.type === "models") {
    // The menu is where a key added or removed in the app is first noticed, so re-read the Keychain here too.
    return Promise.all([refreshApiKeys().catch(() => undefined), loadSettings()])
      .then(([, settings]): ModelsView => ({ models: availableModels(), settings: resolveSettings(settings) }));
  }
  if (message.type === "settings") {
    return saveSettings(message.settings);
  }
  if (message.type === "fetch") {
    return loadTextResource(message.url).catch((error: unknown) => ({
      type: "error",
      error: error instanceof Error && error.message
        ? error.message
        : i18n._({ id: "errors.fetchTextResource", message: "Could not fetch the text resource." })
    }));
  }
});
