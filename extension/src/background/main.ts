import type { ModelsView, RuntimeMessage } from "../shared/protocol";
import { activateBrowserLocale } from "../shared/i18n.ts";
import { loadSettings, saveSettings } from "../shared/store";
import { errorMessage } from "../shared/errors";
import { fetchText } from "../shared/fetch";
import { clearFrames, registerFrame } from "./frames";
import { clearDebugLog, debugEvent, exportDebugLog } from "./debug";
import { availableModels, refreshApiKeys, resolveSettings } from "./provider";
import { handlePanelMessage, removeSession, togglePanel } from "./session";

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
  if (message.type === "sync" || message.type === "ask" || message.type === "cancel" || message.type === "open" || message.type === "panel") {
    if (sender.tab?.id === undefined || sender.frameId !== 0) return;
    return handlePanelMessage(sender.tab.id, message);
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
    return fetchText(message.url).catch((error: unknown) => ({ error: errorMessage(error) }));
  }
});
