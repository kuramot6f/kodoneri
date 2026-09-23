import type { Conversation } from "./conversation";
import { DEFAULT_SETTINGS } from "./models";
import type { ModelSettings } from "./models";

const PREFIX = "conversation:";

export async function loadConversations(): Promise<Conversation[]> {
  const stored = await browser.storage.local.get(null);
  return Object.entries(stored)
    .filter(([key, value]) => key.startsWith(PREFIX) && isConversation(value))
    .map(([, value]) => value as Conversation)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadConversation(id: string): Promise<Conversation | null> {
  const stored = await browser.storage.local.get(PREFIX + id);
  const value = stored[PREFIX + id];
  return isConversation(value) ? value : null;
}

export async function saveConversation(conversation: Conversation): Promise<void> {
  await browser.storage.local.set({ [PREFIX + conversation.id]: conversation });
}

export async function deleteConversation(id: string): Promise<void> {
  await browser.storage.local.remove(PREFIX + id);
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
