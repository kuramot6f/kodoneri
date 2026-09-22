import type { CacheUsage, Conversation, ModelMessage } from "../shared/conversation";
import { i18n } from "../shared/i18n.ts";
import {
  createConversation,
  expireToolHistory,
  getMessageText,
  stamp,
  taggedMessage
} from "../shared/conversation";
import type {
  MemoryProgress,
  PanelEvent,
  PanelMessage,
  PanelState,
  StepView,
  TabMessage,
  TabView
} from "../shared/protocol";
import { formatSelectionContext } from "../shared/selectionContext";
import { loadConversation, loadSettings, saveConversation } from "../shared/store";
import { compact, generateTitle, MEMORY_UPDATE_PROMPT, streamAnswer } from "./agent";
import { applyCompaction, planCompaction } from "./compaction";
import { createRuntime, refreshApiKeys, resolveSettings } from "./provider";
import type { ModelRuntime } from "./provider";
import { createTools, disposeTools } from "./tools";
import { createConversationSystemPrompt } from "./prompt";
import { listMemories } from "./storedText";

export interface Session {
  tabId: number;
  port: browser.runtime.Port | null;
  panel: PanelState;
  conversation: Conversation | null;
  run: { requestId: string; controller: AbortController; done: Promise<void> } | null;
  step: StepView | null;
  compacting: boolean;
  memory: MemoryProgress | null;
  cacheUsage: CacheUsage | null;
  /** tabId:frameId pairs that received tool messages for the running request. */
  touched: Set<string>;
}

interface StoredTabState {
  conversationId: string | null;
  panel: PanelState;
}

const DEFAULT_PANEL: PanelState = { open: false, expanded: false, frame: null };
const sessions = new Map<number, Session>();
const loading = new Map<number, Promise<Session>>();

export function getSession(tabId: number): Promise<Session> {
  const existing = sessions.get(tabId);
  if (existing) return Promise.resolve(existing);
  let pending = loading.get(tabId);
  if (!pending) {
    pending = restoreSession(tabId).finally(() => loading.delete(tabId));
    loading.set(tabId, pending);
  }
  return pending;
}

async function restoreSession(tabId: number): Promise<Session> {
  const key = `tab:${tabId}`;
  let stored: StoredTabState | undefined;
  let conversation: Conversation | null = null;
  try {
    stored = (await browser.storage.session.get(key))[key] as StoredTabState | undefined;
    if (stored?.conversationId) conversation = await loadConversation(stored.conversationId);
  } catch {
    // Stored tab state that cannot be read would otherwise keep this tab without a panel for good.
    stored = undefined;
  }
  const session: Session = {
    tabId,
    port: null,
    panel: { ...DEFAULT_PANEL, ...stored?.panel },
    conversation,
    run: null,
    step: null,
    compacting: false,
    memory: null,
    cacheUsage: null,
    touched: new Set()
  };
  sessions.set(tabId, session);
  return session;
}

export function removeSession(tabId: number): void {
  sessions.get(tabId)?.run?.controller.abort();
  sessions.delete(tabId);
  void browser.storage.session.remove(`tab:${tabId}`);
}

export async function togglePanel(tabId: number): Promise<void> {
  const session = await getSession(tabId);
  session.panel = { ...session.panel, open: !session.panel.open };
  persist(session);
  pushState(session);
}

export async function attachPort(port: browser.runtime.Port): Promise<void> {
  const tabId = port.sender?.tab?.id;
  if (tabId === undefined || port.sender?.frameId !== 0) return;
  const session = await getSession(tabId);
  session.port = port;
  pushState(session);
  port.onMessage.addListener((message: object) => void handle(session, message as PanelMessage));
  port.onDisconnect.addListener(() => {
    if (session.port === port) session.port = null;
  });
}

/** switch_tab carries the conversation to the tab the user now sees; the old tab is left empty. */
export async function moveSession(session: Session, targetTabId: number): Promise<void> {
  if (sessions.get(targetTabId)?.run) throw new Error(i18n._({ id: "errors.targetTabBusy", message: "The conversation cannot be moved because the target tab is processing another response." }));
  try {
    await browser.tabs.sendMessage(targetTabId, { type: "ping" } satisfies TabMessage, { frameId: 0 });
  } catch {
    throw new Error(i18n._({ id: "errors.targetTabUnavailable", message: "The tab was switched, but the conversation remains in the original tab because it cannot be displayed here." }));
  }

  const sourceTabId = session.tabId;
  const sourcePort = session.port;
  session.port = sessions.get(targetTabId)?.port ?? null;
  session.tabId = targetTabId;
  session.panel = { ...session.panel, open: true };
  sessions.set(targetTabId, session);
  persist(session);
  pushState(session);

  sessions.delete(sourceTabId);
  await browser.storage.session.set({
    [`tab:${sourceTabId}`]: { conversationId: null, panel: { ...session.panel, open: false } } satisfies StoredTabState
  });
  const empty = await getSession(sourceTabId);
  empty.port = sourcePort;
  pushState(empty);
}

async function handle(session: Session, message: PanelMessage): Promise<void> {
  // Replied before any await so a slow ask or open never looks like a dead port.
  if (message.type === "ping") return pushState(session);
  if (message.type === "ask") return ask(session, message);
  if (message.type === "cancel") return session.run?.controller.abort();
  if (message.type === "open") {
    session.run?.controller.abort();
    session.conversation = message.conversationId ? await loadConversation(message.conversationId) : null;
    session.step = null;
    session.memory = null;
    session.cacheUsage = null;
  } else {
    session.panel = { ...session.panel, ...message.panel };
  }
  persist(session);
  pushState(session);
}

async function ask(session: Session, message: Extract<PanelMessage, { type: "ask" }>): Promise<void> {
  // The run is registered before any await so a second question cannot start a parallel answer.
  const previous = session.run;
  const controller = new AbortController();
  let finish!: () => void;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  session.run = { requestId: message.requestId, controller, done };
  try {
    if (previous) {
      previous.controller.abort();
      await previous.done;
    }
    session.memory = null;
    session.cacheUsage = null;

    const now = Date.now();
    const conversation = session.conversation ? expireToolHistory(session.conversation, now) : createConversation(message.text);
    const firstTurn = conversation.messages.length === 0;
    // Keys live in memory and are re-read from the Keychain only when a conversation starts.
    if (firstTurn) await refreshApiKeys().catch(() => undefined);
    if (firstTurn && !conversation.systemPrompt) {
      const memoryList = await listMemories();
      conversation.systemPrompt = createConversationSystemPrompt(memoryList.content);
    }
    conversation.messages = [
      ...conversation.messages,
      stamp(taggedMessage("browser_context", JSON.stringify({
        ref: `tab_${session.tabId}`,
        title: message.title,
        url: message.url,
        htmlLength: message.htmlLength
      })), now),
      ...(message.selection ? [stamp(taggedMessage("selection_context", formatSelectionContext(message.selection)), now)] : []),
      stamp({ role: "user", content: message.text }, now)
    ];
    conversation.updatedAt = now;
    session.conversation = conversation;
    session.step = { reasoning: "", text: "", tools: [] };
    persist(session);
    pushState(session);
    await saveConversation(conversation);

    let models: Models;
    try {
      models = await resolveModels();
    } catch (error) {
      append(conversation, [taggedMessage("runtime_error", getErrorMessage(error))]);
      session.step = null;
      await saveConversation(conversation);
      pushState(session);
      return;
    }
    await answer(session, conversation, models, message.requestId, controller.signal, firstTurn ? message.text : null);
  } finally {
    finish();
    if (session.run?.requestId === message.requestId) session.run = null;
  }
}

/** The answer uses the chosen effort; title, compaction and memory maintenance use the model's lowest. */
interface Models {
  main: ModelRuntime;
  low: ModelRuntime;
}

async function resolveModels(): Promise<Models> {
  const settings = resolveSettings(await loadSettings());
  if (!settings) throw new Error(i18n._({ id: "errors.apiKeyMissing", message: "No API key is configured. Configure one in the chatext app." }));
  return { main: createRuntime(settings, settings.effort), low: createRuntime(settings, "lowest") };
}

async function answer(
  session: Session,
  conversation: Conversation,
  models: Models,
  requestId: string,
  signal: AbortSignal,
  titleQuestion: string | null
): Promise<void> {
  const runtime = {
    session,
    requestId,
    signal,
    model: models.main,
    scope: "browser" as const,
    moveSession: (tabId: number) => moveSession(session, tabId)
  };
  // The asking tab prepared page tools for this request even if no tool ever reaches it.
  session.touched.add(`${session.tabId}:0`);
  const live = () => session.conversation === conversation;
  const result = await streamAnswer(models.main, conversation.messages, createTools(runtime), signal, {
    onDelta: (channel, text) => {
      if (!live() || !session.step) return;
      session.step[channel] += text;
      post(session, { type: "delta", phase: "answer", channel, text });
    },
    onTool: (detail) => {
      if (!live() || !session.step) return;
      session.step.tools = upsert(session.step.tools, detail);
      pushState(session);
    },
    onStep: (messages) => {
      append(conversation, messages);
      void saveConversation(conversation);
      if (!live()) return;
      session.step = { reasoning: "", text: "", tools: [] };
      pushState(session);
    }
  }, conversation.systemPrompt);
  await disposeTools(runtime);

  if (result.error) {
    const { text, reasoning } = result.partial;
    append(conversation, [
      ...(text ? [{
        role: "assistant" as const,
        content: [...(reasoning ? [{ type: "reasoning" as const, text: reasoning }] : []), { type: "text" as const, text }]
      }] : []),
      taggedMessage(result.cancelled ? "runtime_cancelled" : "runtime_error", result.error)
    ]);
  }
  if (!live()) {
    await saveConversation(conversation);
    return;
  }
  session.step = null;
  session.cacheUsage = result.cacheUsage;

  const plan = result.error ? null : planCompaction(conversation.messages, result.contextTokens, models.main.info.contextWindow);
  if (plan) {
    session.compacting = true;
    pushState(session);
    try {
      const content = await compact(models.low, plan.prefix, signal);
      conversation.messages = applyCompaction(conversation.messages, { prefixMessageCount: plan.prefixMessageCount, content });
    } catch (error) {
      append(conversation, [taggedMessage("runtime_error", i18n._({ id: "errors.compactionFailed", message: "Conversation compaction failed. {error}", values: { error: getErrorMessage(error) } }))]);
    }
    session.compacting = false;
  }
  await saveConversation(conversation);
  pushState(session);
  if (result.error) return;

  // Title and memory maintenance continue after the answer; the session is already free for the next question.
  if (titleQuestion) {
    void generateTitle(models.low, titleQuestion, lastAnswer(conversation)).then(async (title) => {
      conversation.title = title;
      await saveConversation(conversation);
      if (live()) pushState(session);
    }).catch(() => undefined);
  }
  void maintainMemory(session, conversation, models.low);
}

async function maintainMemory(session: Session, conversation: Conversation, model: ModelRuntime): Promise<void> {
  const progress: MemoryProgress = { reasoning: "", text: "", tools: [], done: false, cacheUsage: null };
  session.memory = progress;
  pushState(session);
  const live = () => session.memory === progress;
  const runtime = {
    session,
    requestId: `${conversation.id}-memory-${Date.now()}`,
    signal: new AbortController().signal,
    model,
    scope: "memory" as const,
    moveSession: () => Promise.reject(new Error(i18n._({ id: "errors.switchDuringMemoryUpdate", message: "Tabs cannot be switched while memory is being updated." })))
  };
  const result = await streamAnswer(
    model,
    [...conversation.messages, taggedMessage("memory_update", MEMORY_UPDATE_PROMPT)],
    createTools(runtime),
    runtime.signal,
    {
      onDelta: (channel, text) => {
        progress[channel] += text;
        if (live()) post(session, { type: "delta", phase: "memory", channel, text });
      },
      onTool: (detail) => {
        progress.tools = upsert(progress.tools, detail);
        if (live()) pushState(session);
      },
      onStep: () => undefined
    }
  );
  progress.done = true;
  progress.cacheUsage = result.cacheUsage;
  if (result.error) progress.error = result.error;
  if (live()) pushState(session);
}

function append(conversation: Conversation, messages: ModelMessage[]): void {
  const now = Date.now();
  conversation.messages = [...conversation.messages, ...messages.map((message) => stamp(message, now))];
  conversation.updatedAt = now;
}

function lastAnswer(conversation: Conversation): string {
  const message = conversation.messages.findLast((candidate) => candidate.role === "assistant" && getMessageText(candidate));
  return message ? getMessageText(message) : "";
}

function upsert(tools: ToolDetailList, detail: ToolDetailList[number]): ToolDetailList {
  return tools.some((tool) => tool.id === detail.id)
    ? tools.map((tool) => tool.id === detail.id ? detail : tool)
    : [...tools, detail];
}

type ToolDetailList = StepView["tools"];

function persist(session: Session): void {
  const state: StoredTabState = { conversationId: session.conversation?.id ?? null, panel: session.panel };
  void browser.storage.session.set({ [`tab:${session.tabId}`]: state });
}

function pushState(session: Session): void {
  const state: TabView = {
    panel: session.panel,
    conversation: session.conversation,
    step: session.step,
    compacting: session.compacting,
    memory: session.memory,
    cacheUsage: session.cacheUsage
  };
  post(session, { type: "state", state });
}

function post(session: Session, event: PanelEvent): void {
  try {
    session.port?.postMessage(event);
  } catch {
    session.port = null;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : i18n._({ id: "errors.unknown", message: "An unknown error occurred." });
}
