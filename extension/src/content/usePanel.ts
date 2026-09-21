import { useEffect, useRef, useState } from "react";
import type { PanelEvent, PanelMessage, PanelState, TabView } from "../shared/protocol";
import type { PageSelection } from "./pageSelection";
import { getPageTools, whoami } from "./pageTools";

const RECONNECT_DELAY_MS = 1000;
const REPLY_TIMEOUT_MS = 3000;

/** The background owns the conversation; this hook mirrors its view of the tab and sends user actions. */
export function usePanel() {
  const [state, setState] = useState<TabView | null>(null);
  const linkRef = useRef<Link | null>(null);

  useEffect(() => {
    const link = createLink((event) => {
      if (event.type === "state") setState(event.state);
      else setState((current) => current && applyDelta(current, event));
    });
    linkRef.current = link;
    // A tab that comes back to the front may hold a port the background no longer knows about.
    const onVisible = () => {
      if (document.visibilityState === "visible") link.probe();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      link.dispose();
      linkRef.current = null;
    };
  }, []);

  const send = (message: PanelMessage) => linkRef.current?.send(message);

  const ask = async (text: string, selection: PageSelection | null) => {
    const requestId = crypto.randomUUID();
    const { tabId } = await whoami;
    // The page tools are created now so selected media get refs before the question is sent.
    const tools = getPageTools(requestId, `tab_${tabId}_`, selection);
    send({
      type: "ask",
      requestId,
      text,
      title: document.title,
      url: location.href,
      htmlLength: tools.htmlLength,
      selection: tools.selectionContext
    });
  };

  return {
    state,
    ask,
    cancel: () => send({ type: "cancel" }),
    open: (conversationId: string | null) => send({ type: "open", conversationId }),
    setPanel: (panel: Partial<PanelState>) => send({ type: "panel", panel })
  };
}

interface Link {
  send(message: PanelMessage): void;
  probe(): void;
  dispose(): void;
}

type Port = browser.runtime.Port;

/**
 * Keeps one live port to the background. Safari does not always fire onDisconnect when the
 * background worker is replaced, so every message is followed by a ping and a port that stays
 * silent is discarded; the message it swallowed is sent again over the replacement.
 */
function createLink(onEvent: (event: PanelEvent) => void): Link {
  let port: Port | null = null;
  let pending: { message: PanelMessage; port: Port | null } | null = null;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const expectReply = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(connect, REPLY_TIMEOUT_MS);
  };

  const connect = () => {
    clearTimeout(retry);
    port?.disconnect();
    if (disposed) return;
    const current = browser.runtime.connect({ name: "panel" });
    port = current;
    current.onMessage.addListener((raw: object) => {
      if (port !== current) return;
      clearTimeout(watchdog);
      onEvent(raw as PanelEvent);
      const lost = pending;
      pending = null;
      if (lost && lost.port !== current) send(lost.message);
    });
    current.onDisconnect.addListener(() => {
      if (port !== current) return;
      port = null;
      retry = setTimeout(connect, RECONNECT_DELAY_MS);
    });
    // A new port is answered with the current state.
    expectReply();
  };

  const post = (message: PanelMessage) => {
    try {
      port?.postMessage(message);
    } catch {
      connect();
    }
  };

  const probe = () => {
    post({ type: "ping" });
    expectReply();
  };

  const send = (message: PanelMessage) => {
    pending = { message, port };
    post(message);
    probe();
  };

  connect();
  return {
    send,
    probe,
    dispose: () => {
      disposed = true;
      clearTimeout(watchdog);
      clearTimeout(retry);
      port?.disconnect();
      port = null;
    }
  };
}

function applyDelta(state: TabView, event: Extract<PanelEvent, { type: "delta" }>): TabView {
  if (event.phase === "memory") {
    return state.memory
      ? { ...state, memory: { ...state.memory, [event.channel]: state.memory[event.channel] + event.text } }
      : state;
  }
  return state.step
    ? { ...state, step: { ...state.step, [event.channel]: state.step[event.channel] + event.text } }
    : state;
}
