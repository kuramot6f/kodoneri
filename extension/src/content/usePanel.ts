import { useEffect, useRef, useState } from "react";
import type { PanelEvent, PanelMessage, PanelState, TabView } from "../shared/protocol";
import type { PageSelection } from "./pageSelection";
import { getPageTools, whoami } from "./pageTools";

const RECONNECT_DELAY_MS = 1000;

/** The background owns the conversation; this hook mirrors its view of the tab and sends user actions. */
export function usePanel() {
  const [state, setState] = useState<TabView | null>(null);
  const portRef = useRef<browser.runtime.Port | null>(null);

  useEffect(() => {
    let disposed = false;
    const connect = () => {
      const port = browser.runtime.connect({ name: "panel" });
      portRef.current = port;
      port.onMessage.addListener((raw: object) => {
        const event = raw as PanelEvent;
        if (event.type === "state") setState(event.state);
        else setState((current) => current && applyDelta(current, event));
      });
      // The background worker may restart; reconnecting brings back the current state.
      port.onDisconnect.addListener(() => {
        if (portRef.current === port) portRef.current = null;
        if (!disposed) setTimeout(connect, RECONNECT_DELAY_MS);
      });
    };
    connect();
    return () => {
      disposed = true;
      portRef.current?.disconnect();
    };
  }, []);

  const send = (message: PanelMessage) => {
    try {
      portRef.current?.postMessage(message);
    } catch {
      // The port is reconnecting; the next state push resynchronizes the view.
    }
  };

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
