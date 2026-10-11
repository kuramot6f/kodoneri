import type { Conversation } from "./conversation.ts";
import { DEFAULT_SETTINGS } from "./models.ts";
import type { ModelSettings } from "./models.ts";

export const CONVERSATION_PREFIX = "conversation:";
export const CONVERSATION_MAX_COUNT = 100;

/** A deletion stays as a dated marker so iCloud sync can tell it from a record another device has not seen. */
export function tombstone() {
  return { deleted: true, updatedAt: Date.now() };
}

export async function loadConversations(): Promise<Conversation[]> {
  const stored = await browser.storage.local.get(null);
  return Object.entries(stored)
    .filter(([key, value]) => key.startsWith(CONVERSATION_PREFIX) && isConversation(value))
    .map(([, value]) => value as Conversation)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadConversation(id: string): Promise<Conversation | null> {
  const stored = await browser.storage.local.get(CONVERSATION_PREFIX + id);
  const value = stored[CONVERSATION_PREFIX + id];
  return isConversation(value) ? value : null;
}

export async function saveConversation(conversation: Conversation): Promise<void> {
  await browser.storage.local.set({ [CONVERSATION_PREFIX + conversation.id]: conversation });
}

/** Reads every conversation, so it runs only when one is added; saves of an existing one never raise the count. */
export async function pruneConversations(): Promise<void> {
  const overflow = (await loadConversations()).slice(CONVERSATION_MAX_COUNT);
  if (overflow.length) await browser.storage.local.set(Object.fromEntries(overflow.map(({ id }) => [CONVERSATION_PREFIX + id, tombstone()])));
}

export async function deleteConversation(id: string): Promise<void> {
  await browser.storage.local.set({ [CONVERSATION_PREFIX + id]: tombstone() });
}

function isConversation(value: unknown): value is Conversation {
  if (!value || typeof value !== "object") return false;
  const conversation = value as Partial<Conversation>;
  return typeof conversation.id === "string"
    && typeof conversation.title === "string"
    && Number.isFinite(conversation.createdAt)
    && Number.isFinite(conversation.updatedAt)
    && Array.isArray(conversation.messages);
}

const SETTINGS_KEY = "settings";

/** The last model and effort chosen anywhere; new conversations start with them. */
export async function loadSettings(): Promise<ModelSettings> {
  const stored = (await browser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as Partial<ModelSettings> | undefined;
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(settings: ModelSettings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

export const CHAT_BUTTON_KEY = "chatButton";

/** Whether pages show the chat button; the background mirrors it from the app's settings. */
export async function loadChatButton(): Promise<boolean> {
  return (await browser.storage.local.get(CHAT_BUTTON_KEY))[CHAT_BUTTON_KEY] === true;
}

export async function saveChatButton(shown: boolean): Promise<void> {
  await browser.storage.local.set({ [CHAT_BUTTON_KEY]: shown });
}
