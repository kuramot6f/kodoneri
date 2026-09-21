import type { ModelsView, RuntimeMessage, WhoAmI } from "../shared/protocol";
import { loadSettings, saveSettings } from "../shared/store";
import { loadTextResource } from "../shared/textResource";
import { clearFrames, registerFrame } from "./frames";
import { availableModels, refreshApiKeys, resolveSettings } from "./provider";
import { attachPort, removeSession, togglePanel } from "./session";

void refreshApiKeys().catch(() => undefined);

browser.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined) void togglePanel(tab.id);
});

browser.tabs.onRemoved.addListener((tabId) => {
  clearFrames(tabId);
  removeSession(tabId);
});

browser.runtime.onConnect.addListener((port) => {
  if (port.name === "panel") void attachPort(port);
});

browser.runtime.onMessage.addListener((message: RuntimeMessage, sender) => {
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
      error: error instanceof Error && error.message ? error.message : "テキスト資源を取得できませんでした。"
    }));
  }
});
