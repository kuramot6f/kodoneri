import { useEffect, useRef, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ChatView } from "./ChatView";
import { isTouchDevice, PHONE_QUERY, useMediaQuery } from "./device";
import { HistoryView } from "./HistoryView";
import { Icon } from "./Icon";
import { MemoryEditor } from "./MemoryEditor";
import { MemoryListView } from "./MemoryListView";
import { SegmentedTabs } from "./SegmentedTabs";
import { useMemories } from "./useMemories";
import { usePanel } from "./usePanel";
import { EDGES, usePanelFrame } from "./usePanelFrame";
import {
  capturePageSelection,
  CHAT_HOST_ID,
  summarizePageSelection
} from "./pageSelection";
import type { PageSelection } from "./pageSelection";
import type { Conversation } from "../shared/conversation";
import type { Memory } from "../shared/memory";
import type { PanelFrame } from "../shared/protocol";
import { deleteConversation, loadConversations } from "../shared/store";

type View = "chat" | "history" | "memory";
type HistoryTab = "chat" | "memory";
/** floating/sidebar on desktop and iPad; phones keep the floating look at a fixed size, or enlarge it. */
type Layout = "floating" | "sidebar" | "phone" | "phone-expanded";

export function App() {
  const { t } = useLingui();
  const [view, setView] = useState<View>("chat");
  const [historyTab, setHistoryTab] = useState<HistoryTab>("chat");
  const [question, setQuestion] = useState("");
  const [includeSelection, setIncludeSelection] = useState(true);
  const [selectionSummary, setSelectionSummary] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  // Dragging updates the frame locally; the committed frame comes back from the background.
  const [frame, setFrame] = useState<PanelFrame | null>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const pageSelectionRef = useRef<PageSelection | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panel = usePanel();
  const memories = useMemories();
  const phone = useMediaQuery(PHONE_QUERY);
  const state = panel.state;
  const open = state?.panel.open ?? false;
  const expanded = state?.panel.expanded ?? false;
  const busy = Boolean(state?.step);
  const layout: Layout = phone ? (expanded ? "phone-expanded" : "phone") : (expanded ? "sidebar" : "floating");
  const floating = layout === "floating";
  const savedFrame = JSON.stringify(state?.panel.frame ?? null);
  useEffect(() => setFrame(JSON.parse(savedFrame) as PanelFrame | null), [savedFrame]);
  const panelFrame = usePanelFrame(panelRef, frame, floating, setFrame, (committed) => panel.setPanel({ frame: committed }));

  useEffect(() => {
    if (isTouchDevice()) return;
    if (open && view === "chat" && !busy) questionRef.current?.focus();
  }, [busy, open, view]);

  // サイドバー表示中はページ本体を左に寄せてパネルと重ならないようにする
  useEffect(() => {
    if (!open || layout !== "sidebar" || !panelRef.current) return;
    const root = document.documentElement;
    root.style.setProperty("margin-right", `${panelRef.current.offsetWidth}px`, "important");
    return () => {
      root.style.removeProperty("margin-right");
    };
  }, [open, layout]);

  useEffect(() => {
    const storePageSelection = (selection: PageSelection | null) => {
      pageSelectionRef.current = selection;
      setSelectionSummary(summarizePageSelection(selection));
    };
    const rememberPageSelection = () => {
      if (document.activeElement?.id === CHAT_HOST_ID) return;
      storePageSelection(capturePageSelection());
    };
    const preserveSelectionBeforePanelFocus = (event: PointerEvent) => {
      const host = document.getElementById(CHAT_HOST_ID);
      if (!host || !event.composedPath().includes(host)) return;
      const selection = capturePageSelection();
      if (selection) storePageSelection(selection);
    };
    document.addEventListener("selectionchange", rememberPageSelection);
    document.addEventListener("pointerdown", preserveSelectionBeforePanelFocus, true);
    return () => {
      document.removeEventListener("selectionchange", rememberPageSelection);
      document.removeEventListener("pointerdown", preserveSelectionBeforePanelFocus, true);
    };
  }, []);

  // ボタンやチェックボックスのクリックでページ側の選択範囲が解除されないようにする
  const keepPageSelection = (event: MouseEvent) => {
    if ((event.target as Element).closest("button, .selection-option")) event.preventDefault();
  };

  const submitQuestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = question.trim();
    if (!state || !text) return;
    setQuestion("");
    void panel.ask(text, includeSelection ? pageSelectionRef.current : null);
  };

  const startNewChat = () => {
    setView("chat");
    panel.open(null);
  };

  const showHistory = async () => {
    setHistoryTab("chat");
    setView("history");
    const [stored] = await Promise.all([loadConversations(), memories.refresh()]);
    setConversations(stored);
  };

  const removeConversation = async (conversation: Conversation) => {
    setConversations((current) => current.filter(({ id }) => id !== conversation.id));
    await deleteConversation(conversation.id);
    if (state?.conversation?.id === conversation.id) panel.open(null);
  };

  const openMemory = (memory: Memory) => {
    memories.open(memory);
    setView("memory");
  };

  const createMemory = () => {
    memories.create();
    setView("memory");
  };

  const closeMemory = async () => {
    setView("history");
    await memories.close();
  };

  const historyTabs = [
    { value: "chat", label: t`Chats`, title: t`Saved conversations` },
    { value: "memory", label: t`Memory`, title: t`What the AI remembers` }
  ] as const;
  const expandLabel = phone
    ? (expanded ? t`Restore size` : t`Enlarge`)
    : (expanded ? t`Switch to floating panel` : t`Show in sidebar`);
  const historyLabel = phone ? t`Menu (chat history and memory)` : t`Chat history`;

  if (!state || !open) return null;

  return (
    <section id="panel" ref={panelRef} data-layout={layout} style={panelFrame.style} onMouseDown={keepPageSelection}>
      {floating && EDGES.map((edge) => <div className="edge" data-edge={edge} key={edge} {...panelFrame.handlersFor(edge)} />)}
      <div className="panel-body">
        <header {...panelFrame.handlersFor(null)}>
          {view === "memory" ? (
            <>
              <button className="round" type="button" aria-label={t`Back to list`} title={t`Back to list`} onClick={() => void closeMemory()}>
                <Icon name="back" />
              </button>
              <h1 className="header-title"><Trans>Edit {memories.editing?.title.trim() || t`memory`}</Trans></h1>
              <button className="pill" type="button" title={t`Finish editing and return to the list`} onClick={() => void closeMemory()}><Trans>Done</Trans></button>
            </>
          ) : (
            <>
              <div className="header-actions">
                <button className="round" type="button" aria-label={t`Close panel`} title={t`Close panel`} onClick={() => panel.setPanel({ open: false })}>
                  <Icon name="close" />
                </button>
                <button
                  className="round"
                  type="button"
                  aria-label={expandLabel}
                  title={expandLabel}
                  onClick={() => panel.setPanel({ expanded: !expanded })}
                >
                  <Icon name={phone ? (expanded ? "closeFullscreen" : "openInFull") : (expanded ? "floating" : "sidebar")} />
                </button>
              </div>
              <div className="header-actions">
                {view === "chat" && (
                  <button
                    className="round"
                    type="button"
                    aria-label={historyLabel}
                    title={historyLabel}
                    onClick={() => void showHistory()}
                    disabled={busy}
                  >
                    <Icon name={phone ? "menu" : "history"} />
                  </button>
                )}
                {(!phone || view === "history") && (
                  <button className={view === "history" ? "round accent-action" : "round"} type="button" aria-label={t`New chat`} title={t`New chat`} onClick={startNewChat} disabled={busy}>
                    <Icon name="edit" tone={view === "history" ? "inverse" : "default"} />
                  </button>
                )}
              </div>
            </>
          )}
        </header>
        {view === "memory" && memories.editing ? (
          <MemoryEditor memory={memories.editing} onChange={memories.update} />
        ) : view === "history" ? (
          <>
            <SegmentedTabs tabs={historyTabs} value={historyTab} onChange={setHistoryTab} />
            {historyTab === "memory" ? (
              <MemoryListView
                memories={memories.memories}
                onCreate={createMemory}
                onSelect={openMemory}
                onToggleFavorite={(memory) => void memories.toggleFavorite(memory)}
                onDelete={(memory) => void memories.remove(memory)}
              />
            ) : (
              <HistoryView
                conversations={conversations}
                onSelect={(conversation) => {
                  panel.open(conversation.id);
                  setView("chat");
                }}
                onDelete={(conversation) => void removeConversation(conversation)}
              />
            )}
          </>
        ) : (
          <ChatView
            conversation={state.conversation}
            step={state.step}
            memory={state.memory}
            compacting={state.compacting}
            cacheUsage={state.cacheUsage}
            question={question}
            includeSelection={includeSelection}
            selectionSummary={selectionSummary}
            busy={busy}
            questionRef={questionRef}
            onQuestionChange={setQuestion}
            onIncludeSelectionChange={setIncludeSelection}
            onSubmit={submitQuestion}
            onStop={panel.cancel}
          />
        )}
      </div>
    </section>
  );
}
