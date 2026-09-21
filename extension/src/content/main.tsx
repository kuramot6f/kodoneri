import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@lingui/react";
import type { RuntimeMessage, TabMessage, ToolOutput } from "../shared/protocol";
import { activateBrowserLocale, i18n } from "../shared/i18n.ts";
import { App } from "./App";
import { CHAT_HOST_ID } from "./pageSelection";
import { disposePageTools, getPageTools } from "./pageTools";
import "./styles.css";

activateBrowserLocale();

browser.runtime.onMessage.addListener((message: TabMessage) => {
  if (message.type === "ping") return Promise.resolve(true);
  if (message.type === "refresh_frame") return registerFrame();
  if (message.type === "dispose") {
    disposePageTools(message.requestId);
    return;
  }
  if (message.type === "tool") {
    return getPageTools(message.requestId, message.refPrefix).run(message.name, message.args)
      .catch((error: unknown): ToolOutput => ({
        type: "error",
        error: error instanceof Error && error.message
          ? error.message
          : i18n._({ id: "errors.toolExecutionFailed", message: "Tool execution failed." })
      }));
  }
});

/** Frames tell the background their iframe_1_iframe_2 path so tab_<id>_iframe_1_iframe_2 refs resolve to a frameId. */
function registerFrame(): Promise<void> | undefined {
  const segments: string[] = [];
  try {
    for (let current: Window = window; current !== current.top; current = current.parent) {
      const index = frameIndex(current.parent, current);
      if (index < 0) return;
      segments.unshift(`iframe_${index + 1}`);
    }
  } catch {
    return;
  }
  if (segments.length === 0) return;
  const message: RuntimeMessage = { type: "frame", ref: segments.join("_") };
  return browser.runtime.sendMessage(message).then(() => undefined, () => undefined);
}

function frameIndex(parent: Window, child: Window): number {
  for (let index = 0; index < parent.frames.length; index += 1) {
    if (parent.frames[index] === child) return index;
  }
  return -1;
}

void registerFrame();

if (window === window.top && !document.getElementById(CHAT_HOST_ID)) {
  const host = document.createElement("div");
  host.id = CHAT_HOST_ID;

  const shadow = host.attachShadow({ mode: "closed" });
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = browser.runtime.getURL("styles.css");
  const root = document.createElement("div");
  shadow.append(stylesheet, root);

  createRoot(root).render(
    <StrictMode>
      <I18nProvider i18n={i18n}>
        <App />
      </I18nProvider>
    </StrictMode>
  );

  if (document.documentElement) {
    document.documentElement.appendChild(host);
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      document.documentElement.appendChild(host);
    }, { once: true });
  }
}
