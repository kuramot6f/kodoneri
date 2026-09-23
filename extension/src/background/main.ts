import type { RuntimeMessage } from "../shared/protocol";
import { activateBrowserLocale } from "../shared/i18n.ts";
import { errorMessage } from "../shared/errors";
import { fetchText } from "../shared/fetch";
import { clearFrames, registerFrame } from "./frames";
import { debugEvent } from "./debug";
import { hasCredentials, refreshApiKeys } from "./provider";
import { loadChatButton, saveChatButton } from "../shared/store";
import { handlePanelMessage, modelsView, removeSession, selectModel, togglePanel } from "./session";

activateBrowserLocale();
debugEvent("worker_started");
void refreshApiKeys().catch(() => undefined);
void refreshAppSettings().catch(() => undefined);

/** Mirrors the app's settings into storage, where every page reads them without a native round trip. */
async function refreshAppSettings(): Promise<void> {
  const { chatButton } = await browser.runtime.sendNativeMessage("application.id", { type: "settings" }) as { chatButton?: unknown };
  if (typeof chatButton === "boolean" && chatButton !== await loadChatButton()) await saveChatButton(chatButton);
}

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
  if (message.type === "keepalive") return;
  if (message.type === "credentials") return refreshApiKeys().catch(() => undefined).then(hasCredentials);
  if (message.type === "app_settings") return refreshAppSettings().catch(() => undefined);
  if (message.type === "open_settings") return browser.runtime.sendNativeMessage("application.id", { type: "openSettings" });
  if (message.type === "sync" || message.type === "ask" || message.type === "cancel" || message.type === "open" || message.type === "panel") {
    if (sender.tab?.id === undefined || sender.frameId !== 0) return;
    return handlePanelMessage(sender.tab.id, message);
  }
  if (message.type === "frame") {
    registerFrame(message.ref, sender);
    return;
  }
  if (message.type === "models" || message.type === "settings") {
    if (sender.tab?.id === undefined) return;
    return message.type === "models" ? modelsView(sender.tab.id) : selectModel(sender.tab.id, message.settings);
  }
  if (message.type === "fetch") {
    return fetchText(message.url).catch((error: unknown) => ({ error: errorMessage(error) }));
  }
});
