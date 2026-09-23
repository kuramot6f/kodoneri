import { useEffect, useSyncExternalStore } from "react";
import type { PanelState, RuntimeMessage, TabMessage, TabView } from "../shared/protocol";
import { errorData } from "../shared/debugLog";
import type { PageSelection } from "./pageSelection";
import { getPageTools } from "./pageTools";
import { debugEvent } from "./debug";

/** A streaming view that has been silent this long is re-read, in case the background worker was replaced mid-run. */
const STALE_MS = 5000;
/** Safari stops the worker about a minute after the last event it received, even with a response still streaming. */
const KEEPALIVE_MS = 20000;

let view: TabView | null = null;
let receivedAt = 0;
const listeners = new Set<() => void>();

function setView(next: TabView): void {
  view = next;
  receivedAt = performance.now();
  for (const listener of listeners) listener();
}

function applyView(next: TabView | undefined): void {
  if (next && (!view || next.version >= view.version)) setView(next);
}

/** Receives the background's view pushes (see main.tsx). */
export function receivePanelMessage(message: Extract<TabMessage, { type: "view" | "live" }>): void {
  if (message.type === "view") return applyView(message.view);
  if (view && message.version >= view.version) {
    setView({ ...view, version: message.version, step: message.step, memory: message.memory });
  }
}

/** Every panel message is answered with the tab's current view; there is no long-lived connection to keep alive. */
async function send(message: RuntimeMessage): Promise<void> {
  try {
    applyView(await browser.runtime.sendMessage(message) as TabView | undefined);
  } catch (error) {
    debugEvent("panel_send_failed", { messageType: message.type, ...errorData(error) });
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function isStreaming(current: TabView | null): boolean {
  return Boolean(current && (current.step || current.compacting || (current.memory && !current.memory.done)));
}

/** The background owns the conversation; this hook mirrors its view of the tab and sends user actions. */
export function usePanel() {
  const state = useSyncExternalStore(subscribe, () => view);

  useEffect(() => {
    const sync = () => void send({ type: "sync" });
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    const timer = setInterval(() => {
      if (isStreaming(view) && performance.now() - receivedAt > STALE_MS) sync();
    }, STALE_MS);
    const keepalive = setInterval(() => {
      if (isStreaming(view)) void send({ type: "keepalive" });
    }, KEEPALIVE_MS);
    sync();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      clearInterval(keepalive);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const ask = (text: string, selection: PageSelection | null) => {
    if (!view) return;
    const requestId = crypto.randomUUID();
    // The page tools are created now so selected media get refs before the question is sent.
    const tools = getPageTools(requestId, `tab_${view.tabId}_`, selection);
    void send({
      type: "ask",
      requestId,
      text,
      title: document.title,
      url: location.href,
      htmlLength: tools.htmlLength,
      selection: tools.selectionContext
    });
  };

  // Panel changes show at once; the background's answer confirms them.
  const setPanel = (panel: Partial<PanelState>) => {
    if (view) setView({ ...view, panel: { ...view.panel, ...panel } });
    void send({ type: "panel", panel });
  };

  return {
    state,
    ask,
    cancel: () => void send({ type: "cancel" }),
    open: (conversationId: string | null) => void send({ type: "open", conversationId }),
    setPanel
  };
}
