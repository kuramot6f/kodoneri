import type { CacheUsage, Conversation, ModelMessage } from "../shared/conversation";
import { i18n } from "../shared/i18n.ts";
import { errorMessage } from "../shared/errors.ts";
import {
  createConversation,
  expireToolHistory,
  getMessageText,
  stamp,
  taggedMessage
} from "../shared/conversation";
import type {
  AskMessage,
  MemoryProgress,
  PanelState,
  RuntimeMessage,
  StepView,
  TabMessage,
  TabView,
  ToolDetail
} from "../shared/protocol";
import { loadConversation, loadSettings, saveConversation } from "../shared/store";
import { compact, generateTitle, MEMORY_UPDATE_PROMPT, streamAnswer } from "./agent";
import { applyCompaction, planCompaction } from "./compaction";
import { createRuntime, refreshApiKeys, resolveSettings } from "./provider";
import type { ModelRuntime } from "./provider";
import { createTools } from "./tools";
import { createConversationSystemPrompt, createRuntimeContext, formatSelectionContext } from "./prompt";
import { listMemories } from "./stored";
import { debugEvent } from "./debug";
import { errorData } from "../shared/debugLog";

interface Session {
  tabId: number;
  panel: PanelState;
  conversation: Conversation | null;
  run: { requestId: string; controller: AbortController; done: Promise<void> } | null;
  step: StepView | null;
  compacting: boolean;
  memory: MemoryProgress | null;
  cacheUsage: CacheUsage | null;
  liveTimer?: ReturnType<typeof setTimeout>;
}

interface StoredTabState {
  conversationId: string | null;
  panel: PanelState;
}

type PanelMessage = Extract<RuntimeMessage, { type: "sync" | "ask" | "cancel" | "open" | "panel" }>;

const DEFAULT_PANEL: PanelState = { open: false, expanded: false, frame: null };
const LIVE_INTERVAL_MS = 50;
const sessions = new Map<number, Session>();
const loading = new Map<number, Promise<Session>>();

function getSession(tabId: number): Promise<Session> {
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
  } catch (error) {
    debugEvent("session_restore_failed", { tabId, ...errorData(error) });
    // Stored tab state that cannot be read would otherwise keep this tab without a panel for good.
    stored = undefined;
  }
  const session = createSession(tabId, { ...DEFAULT_PANEL, ...stored?.panel }, conversation);
  sessions.set(tabId, session);
  return session;
}

function createSession(tabId: number, panel: PanelState, conversation: Conversation | null): Session {
  return {
    tabId,
    panel,
    conversation,
    run: null,
    step: null,
    compacting: false,
    memory: null,
    cacheUsage: null
  };
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
  pushView(session);
}

/** Handles a panel message from a tab's top frame and answers with the tab's view. */
export async function handlePanelMessage(tabId: number, message: PanelMessage): Promise<TabView> {
  const session = await getSession(tabId);
  if (message.type === "ask") {
    void ask(session, message).catch((error) => debugEvent("request_failed", { tabId, ...errorData(error) }));
  } else if (message.type === "cancel") {
    session.run?.controller.abort();
  } else if (message.type === "open") {
    session.run?.controller.abort();
    session.conversation = message.conversationId ? await loadConversation(message.conversationId) : null;
    session.step = null;
    session.memory = null;
    session.cacheUsage = null;
    persist(session);
  } else if (message.type === "panel") {
    session.panel = { ...session.panel, ...message.panel };
    persist(session);
  }
  return view(session);
}

/** switch_tab carries the conversation to the tab the user now sees; the old tab is left empty. */
async function moveSession(session: Session, targetTabId: number): Promise<void> {
  if (sessions.get(targetTabId)?.run) throw new Error("The conversation cannot be moved because the target tab is processing another response.");
  try {
    await browser.tabs.sendMessage(targetTabId, { type: "ping" } satisfies TabMessage, { frameId: 0 });
  } catch {
    throw new Error("The tab was switched, but the conversation remains in the original tab because it cannot be displayed there.");
  }

  const sourceTabId = session.tabId;
  session.tabId = targetTabId;
  session.panel = { ...session.panel, open: true };
  sessions.set(targetTabId, session);
  persist(session);
  pushView(session);

  const empty = createSession(sourceTabId, { ...session.panel, open: false }, null);
  sessions.set(sourceTabId, empty);
  persist(empty);
  pushView(empty);
}

async function ask(session: Session, message: AskMessage): Promise<void> {
  // The run is registered before any await so a second question cannot start a parallel answer.
  const previous = session.run;
  const controller = new AbortController();
  let finish!: () => void;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  session.run = { requestId: message.requestId, controller, done };
  const startedAt = performance.now();
  debugEvent("request_started", { tabId: session.tabId, requestId: message.requestId, interruptedPrevious: Boolean(previous) });
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
    // Instructions are rebuilt for every question from the current memories and are never persisted.
    const systemPrompt = createConversationSystemPrompt(JSON.stringify(await listMemories()));
    conversation.messages = [
      ...conversation.messages,
      stamp(taggedMessage("browser_context", JSON.stringify({
        ref: `tab_${session.tabId}`,
        title: message.title,
        url: message.url,
        htmlLength: message.htmlLength
      })), now),
      ...(message.selection ? [stamp(taggedMessage("selection_context", formatSelectionContext(message.selection), { selection: message.selection }), now)] : []),
      stamp({ role: "user", content: message.text }, now)
    ];
    conversation.updatedAt = now;
    session.conversation = conversation;
    session.step = { reasoning: "", text: "", tools: [] };
    persist(session);
    pushView(session);
    await save(conversation);

    let models: Models;
    try {
      models = await resolveModels();
    } catch (error) {
      append(conversation, [taggedMessage("runtime_error", errorMessage(error))]);
      session.step = null;
      await save(conversation);
      pushView(session);
      return;
    }
    await answer(session, conversation, models, systemPrompt, message.requestId, controller.signal, firstTurn ? message.text : null);
  } finally {
    debugEvent("request_finished", {
      tabId: session.tabId,
      requestId: message.requestId,
      durationMs: Math.round(performance.now() - startedAt),
      aborted: controller.signal.aborted
    });
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
  systemPrompt: string,
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
  const live = () => session.conversation === conversation;
  const instructions = `${systemPrompt}\n\n${createRuntimeContext(browser.i18n.getUILanguage())}`;
  const result = await streamAnswer(models.main, conversation.messages, createTools(runtime), signal, {
    onDelta: (channel, text) => {
      if (!live() || !session.step) return;
      session.step[channel] += text;
      scheduleLive(session);
    },
    onTool: (detail) => {
      if (detail.error) debugEvent("tool_failed", { requestId, toolName: detail.name, errorMessage: detail.result });
      if (!live() || !session.step) return;
      session.step.tools = upsert(session.step.tools, detail);
      scheduleLive(session);
    },
    onStep: (messages) => {
      append(conversation, messages);
      void save(conversation).catch(() => undefined);
      if (!live()) return;
      session.step = { reasoning: "", text: "", tools: [] };
      pushView(session);
    }
  }, instructions);
  debugEvent("answer_finished", {
    tabId: session.tabId,
    requestId,
    cancelled: Boolean(result.cancelled),
    errorMessage: result.error ?? null,
    contextTokens: result.contextTokens
  });

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
    await save(conversation);
    return;
  }
  session.step = null;
  session.cacheUsage = result.cacheUsage;

  const plan = result.error ? null : planCompaction(conversation.messages, result.contextTokens, models.main.info.contextWindow);
  if (plan) {
    session.compacting = true;
    pushView(session);
    try {
      const content = await compact(models.low, plan.prefix, signal);
      conversation.messages = applyCompaction(conversation.messages, { prefixMessageCount: plan.prefixMessageCount, content });
    } catch (error) {
      debugEvent("compaction_failed", { tabId: session.tabId, requestId, ...errorData(error) });
      append(conversation, [taggedMessage("runtime_error", i18n._({ id: "errors.compactionFailed", message: "Conversation compaction failed. {error}", values: { error: errorMessage(error) } }))]);
    }
    session.compacting = false;
  }
  await save(conversation);
  pushView(session);
  if (result.error) return;

  // Title and memory maintenance continue after the answer; the session is already free for the next question.
  if (titleQuestion) {
    void generateTitle(models.low, titleQuestion, lastAnswer(conversation)).then(async (title) => {
      conversation.title = title;
      await save(conversation);
      if (live()) pushView(session);
    }).catch(() => undefined);
  }
  void maintainMemory(session, conversation, models.low, instructions);
}

async function maintainMemory(session: Session, conversation: Conversation, model: ModelRuntime, instructions: string): Promise<void> {
  const progress: MemoryProgress = { reasoning: "", text: "", tools: [], done: false, cacheUsage: null };
  session.memory = progress;
  pushView(session);
  const live = () => session.memory === progress;
  const runtime = {
    session,
    requestId: `${conversation.id}-memory-${Date.now()}`,
    signal: new AbortController().signal,
    model,
    scope: "memory" as const,
    moveSession: () => Promise.reject(new Error("Tabs cannot be switched while memory is being updated."))
  };
  const result = await streamAnswer(
    model,
    [...conversation.messages, taggedMessage("memory_update", MEMORY_UPDATE_PROMPT)],
    createTools(runtime),
    runtime.signal,
    {
      onDelta: (channel, text) => {
        progress[channel] += text;
        if (live()) scheduleLive(session);
      },
      onTool: (detail) => {
        progress.tools = upsert(progress.tools, detail);
        if (live()) scheduleLive(session);
      },
      onStep: () => undefined
    },
    instructions
  );
  progress.done = true;
  progress.cacheUsage = result.cacheUsage;
  if (result.error) progress.error = result.error;
  debugEvent("memory_update_finished", {
    tabId: session.tabId,
    cancelled: Boolean(result.cancelled),
    errorMessage: result.error ?? null,
    contextTokens: result.contextTokens
  });
  if (live()) pushView(session);
}

function append(conversation: Conversation, messages: ModelMessage[]): void {
  const now = Date.now();
  conversation.messages = [...conversation.messages, ...messages.map((message) => stamp(message, now))];
  conversation.updatedAt = now;
}

async function save(conversation: Conversation): Promise<void> {
  try {
    await saveConversation(conversation);
  } catch (error) {
    debugEvent("conversation_save_failed", { messageCount: conversation.messages.length, ...errorData(error) });
    throw error;
  }
}

function lastAnswer(conversation: Conversation): string {
  const message = conversation.messages.findLast((candidate) => candidate.role === "assistant" && getMessageText(candidate));
  return message ? getMessageText(message) : "";
}

function upsert(tools: ToolDetail[], detail: ToolDetail): ToolDetail[] {
  return tools.some((tool) => tool.id === detail.id)
    ? tools.map((tool) => tool.id === detail.id ? detail : tool)
    : [...tools, detail];
}

function persist(session: Session): void {
  const state: StoredTabState = { conversationId: session.conversation?.id ?? null, panel: session.panel };
  void browser.storage.session.set({ [`tab:${session.tabId}`]: state });
}

let lastVersion = 0;

/** Wall-clock based so views from a restarted worker still count as newer. */
function nextVersion(): number {
  lastVersion = Math.max(Date.now(), lastVersion + 1);
  return lastVersion;
}

function view(session: Session): TabView {
  return {
    version: nextVersion(),
    tabId: session.tabId,
    panel: session.panel,
    conversation: session.conversation,
    step: session.step,
    compacting: session.compacting,
    memory: session.memory,
    cacheUsage: session.cacheUsage
  };
}

function pushView(session: Session): void {
  clearTimeout(session.liveTimer);
  session.liveTimer = undefined;
  sendToPanel(session.tabId, { type: "view", view: view(session) });
}

/** Streaming updates are coalesced; each one carries the whole step, so a lost message is repaired by the next. */
function scheduleLive(session: Session): void {
  session.liveTimer ??= setTimeout(() => {
    session.liveTimer = undefined;
    sendToPanel(session.tabId, { type: "live", version: nextVersion(), step: session.step, memory: session.memory });
  }, LIVE_INTERVAL_MS);
}

/** A tab without a content script simply misses the update; the panel syncs when it loads or becomes visible. */
function sendToPanel(tabId: number, message: TabMessage): void {
  void browser.tabs.sendMessage(tabId, message, { frameId: 0 }).catch(() => undefined);
}
