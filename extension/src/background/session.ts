import type { CacheUsage, Conversation, ModelMessage } from "../shared/conversation";
import { i18n } from "../shared/i18n.ts";
import { errorMessage } from "../shared/errors.ts";
import {
  createConversation,
  expireToolHistory,
  getMessageText,
  latestContext,
  recentTurns,
  stamp,
  taggedMessage
} from "../shared/conversation";
import type {
  AskMessage,
  MemoryProgress,
  PanelState,
  ModelsView,
  RuntimeMessage,
  TabMessage,
  TabView
} from "../shared/protocol";
import { findModel } from "../shared/models";
import type { ModelSettings } from "../shared/models";
import { loadConversation, loadSettings, saveConversation, saveSettings } from "../shared/store";
import { compact, generateTitle, MEMORY_SYSTEM_PROMPT, MEMORY_TURNS, MEMORY_UPDATE_REQUEST, streamAnswer } from "./agent";
import { applyCompaction, planCompaction } from "./compaction";
import { apiKeysLoaded, availableModels, createMemoryRuntime, createRuntime, refreshApiKeys, resolveSettings } from "./provider";
import type { ModelRuntime } from "./provider";
import { createTools } from "./tools";
import { createRuntimeContext, formatMemoryContext, formatSelectionContext, SYSTEM_PROMPT } from "./prompt";
import { listMemories } from "./stored";
import { debugEvent } from "./debug";
import { errorData } from "../shared/debugLog";

interface Session {
  tabId: number;
  panel: PanelState;
  conversation: Conversation | null;
  /** The tab's model choice; without one the tab follows the last used settings. */
  settings?: ModelSettings;
  run: { requestId: string; controller: AbortController; done: Promise<void> } | null;
  step: ModelMessage[] | null;
  compacting: boolean;
  memory: MemoryProgress | null;
  cacheUsage: CacheUsage | null;
  liveTimer?: ReturnType<typeof setTimeout>;
}

interface StoredTabState {
  conversationId: string | null;
  panel: PanelState;
  settings?: ModelSettings;
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
  const session = createSession(tabId, { ...DEFAULT_PANEL, ...stored?.panel }, conversation, stored?.settings ?? conversation?.settings);
  sessions.set(tabId, session);
  return session;
}

function createSession(tabId: number, panel: PanelState, conversation: Conversation | null, settings?: ModelSettings): Session {
  return {
    tabId,
    panel,
    conversation,
    settings,
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
    session.settings = session.conversation?.settings;
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

/** The models the menu offers and the tab's choice resolved against them. */
export async function modelsView(tabId: number): Promise<ModelsView> {
  const session = await getSession(tabId);
  // The menu is where a key or plan changed in the app is first noticed, so re-read them here too.
  const [, lastUsed] = await Promise.all([refreshApiKeys().catch(() => undefined), loadSettings()]);
  return { models: availableModels(), settings: resolveSettings(session.settings, lastUsed) };
}

/** A choice in the menu applies to this tab and becomes the default for new conversations. */
export async function selectModel(tabId: number, settings: ModelSettings): Promise<void> {
  const session = await getSession(tabId);
  session.settings = settings;
  persist(session);
  await saveSettings(settings);
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
    const conversation = session.conversation ? expireToolHistory(session.conversation) : createConversation(message.text);
    const firstTurn = conversation.messages.length === 0;
    // Keys live in memory and are re-read from the Keychain only when a conversation starts; later turns
    // wait for the lookup a restarted worker began, or they would find no keys.
    await (firstTurn ? refreshApiKeys() : apiKeysLoaded()).catch(() => undefined);
    // The system prompt never changes; what changes is appended as context only when it differs from the
    // latest one, so the prompt cache and the thinking blocks bound to earlier turns stay valid.
    const runtimeContext = createRuntimeContext(browser.i18n.getUILanguage(), new Date(now));
    const memoryContext = formatMemoryContext(JSON.stringify(await listMemories()));
    const page = { ref: `tab_${session.tabId}`, title: message.title, url: message.url, htmlLength: message.htmlLength };
    const lastPage = JSON.parse(latestContext(conversation.messages, "browser_context") ?? "null") as typeof page | null;
    conversation.messages = [
      ...conversation.messages,
      ...(runtimeContext !== latestContext(conversation.messages, "runtime_context") ? [stamp(taggedMessage("runtime_context", runtimeContext), now)] : []),
      ...(memoryContext !== latestContext(conversation.messages, "memory_context") ? [stamp(taggedMessage("memory_context", memoryContext), now)] : []),
      ...(lastPage?.ref !== page.ref || lastPage.url !== page.url ? [stamp(taggedMessage("browser_context", JSON.stringify(page)), now)] : []),
      ...(message.selection ? [stamp(taggedMessage("selection_context", formatSelectionContext(message.selection), { selection: message.selection }), now)] : []),
      stamp({ role: "user", content: message.text }, now)
    ];
    conversation.updatedAt = now;
    session.conversation = conversation;
    session.step = [];
    persist(session);
    pushView(session);
    await save(conversation);

    const models = await resolveModels(session, conversation);
    await answer(session, conversation, models, message.requestId, controller.signal, firstTurn ? message.text : null);
  } catch (error) {
    // A failure outside the model call (storage, settings) would otherwise leave the panel busy with nothing to stop.
    if (session.step && session.conversation) {
      append(session.conversation, [taggedMessage("runtime_error", errorMessage(error))]);
      session.step = null;
      session.compacting = false;
      pushView(session);
      await save(session.conversation).catch(() => undefined);
    }
    throw error;
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

/** The answer uses the chosen effort; title and compaction use the model's lowest. */
interface Models {
  main: ModelRuntime;
  low: ModelRuntime;
  memory: ModelRuntime;
}

/** A model that is no longer available falls back to the last used one, then to the default model. */
async function resolveModels(session: Session, conversation: Conversation): Promise<Models> {
  const settings = resolveSettings(session.settings, await loadSettings());
  if (!settings) throw new Error(i18n._({ id: "errors.apiKeyMissing", message: "No API key is configured. Configure one in the Kodoneri app." }));
  // Tool images live in the account that uploaded them and reasoning replays only to the provider that wrote it,
  // so switching the provider or between an own key and the subscription drops both.
  if (conversation.settings && account(conversation.settings) !== account(settings)) {
    conversation.messages = expireToolHistory(conversation, Infinity).messages;
  }
  session.settings = settings;
  conversation.settings = settings;
  persist(session);
  await saveSettings(settings);
  return { main: createRuntime(settings, settings.effort), low: createRuntime(settings, "lowest"), memory: createMemoryRuntime(settings) };
}

function account(settings: ModelSettings): string | undefined {
  const info = findModel(settings.model);
  return info && `${info.access}:${info.provider}`;
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
  const live = () => session.conversation === conversation;
  const result = await streamAnswer(models.main, conversation.messages, createTools(runtime), signal, {
    onUpdate: (step) => {
      if (!live() || !session.step) return;
      session.step = step;
      scheduleLive(session);
    },
    onStep: (messages) => {
      append(conversation, messages);
      void save(conversation).catch(() => undefined);
      if (!live()) return;
      session.step = [];
      pushView(session);
    },
    onToolError: (toolName, errorMessage) => debugEvent("tool_failed", { requestId, toolName, errorMessage })
  }, SYSTEM_PROMPT);
  debugEvent("answer_finished", {
    tabId: session.tabId,
    requestId,
    cancelled: Boolean(result.cancelled),
    errorMessage: result.error ?? null,
    contextTokens: result.contextTokens
  });

  if (result.error) {
    append(conversation, [
      ...(result.partial ? [result.partial] : []),
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
  void maintainMemory(session, conversation, models.memory);
}

async function maintainMemory(session: Session, conversation: Conversation, model: ModelRuntime): Promise<void> {
  const progress: MemoryProgress = { messages: [], done: false, cacheUsage: null };
  let finished: ModelMessage[] = [];
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
    [...recentTurns(conversation.messages, MEMORY_TURNS), taggedMessage("memory_update", MEMORY_UPDATE_REQUEST)],
    createTools(runtime),
    runtime.signal,
    {
      onUpdate: (step) => {
        progress.messages = [...finished, ...step];
        if (live()) scheduleLive(session);
      },
      onStep: (messages) => {
        finished = [...finished, ...messages];
        progress.messages = finished;
      }
    },
    MEMORY_SYSTEM_PROMPT
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

function persist(session: Session): void {
  const state: StoredTabState = { conversationId: session.conversation?.id ?? null, panel: session.panel, settings: session.settings };
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
