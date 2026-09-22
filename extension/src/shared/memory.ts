export interface Memory {
  id: string;
  title: string;
  content: string;
  /** Favorites are user-owned: the model cannot patch, rename, or delete them. */
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryEdit {
  old: string;
  new: string;
}

export const MEMORY_MAX_COUNT = 10;
export const MEMORY_CONTENT_MAX_LENGTH = 1000;
export const MEMORY_TITLE_MAX_LENGTH = 50;

const MEMORY_PREFIX = "webPageChatMemory:";
const MEMORY_PREVIEW_LENGTH = 100;

/** Tool ref for a memory. The id is the creation timestamp, so refs follow the `session_<createdAt>` pattern. */
export function memoryRef(memory: Pick<Memory, "id">): string {
  return `memory_${memory.id}`;
}

export function createMemory(): Memory {
  const now = Date.now();
  return { id: String(now), title: "", content: "", favorite: false, createdAt: now, updatedAt: now };
}

/** list(type=memory) output: refs with a short preview; full content is read through the ref. */
export function formatMemoryList(memories: Memory[]): Record<string, unknown> {
  return {
    memories: memories.map((memory) => ({
      ref: memoryRef(memory),
      title: memory.title,
      content: memory.content.length > MEMORY_PREVIEW_LENGTH
        ? `${memory.content.slice(0, MEMORY_PREVIEW_LENGTH)}…`
        : memory.content,
      length: memory.content.length,
      is_editable: !memory.favorite,
      updated_at: new Date(memory.updatedAt).toISOString()
    }))
  };
}

/** Applies edits in order; each `old` must match exactly once so stale edits fail instead of corrupting the topic. */
export function applyMemoryEdits(content: string, edits: MemoryEdit[]): string {
  let next = content;
  for (const edit of edits) {
    const first = next.indexOf(edit.old);
    if (first === -1) {
      throw new Error(`old does not match the content: ${JSON.stringify(edit.old)}. Use read to check the current content and try again.`);
    }
    if (next.indexOf(edit.old, first + 1) !== -1) {
      throw new Error(`old occurs more than once in the content: ${JSON.stringify(edit.old)}. Include surrounding text to make it unique.`);
    }
    next = next.slice(0, first) + edit.new + next.slice(first + edit.old.length);
  }
  if (!next.trim()) throw new Error("The content would become empty. Use delete to remove the entire topic.");
  if (next.length > MEMORY_CONTENT_MAX_LENGTH) {
    throw new Error(`Content must be no more than ${MEMORY_CONTENT_MAX_LENGTH} characters (currently ${next.length}). Remove unnecessary details or summarize it.`);
  }
  return next;
}

export function isEmptyMemory(memory: Memory): boolean {
  return !memory.title.trim() && !memory.content.trim();
}

export async function loadMemories(): Promise<Memory[]> {
  const stored = await browser.storage.local.get(null);
  return Object.entries(stored)
    .filter(([key, value]) => key.startsWith(MEMORY_PREFIX) && isMemory(value))
    .map(([, value]) => {
      const memory = value as Memory;
      return { ...memory, favorite: memory.favorite === true };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveMemory(memory: Memory): Promise<void> {
  await browser.storage.local.set({ [`${MEMORY_PREFIX}${memory.id}`]: memory });
}

export async function deleteMemory(id: string): Promise<void> {
  await browser.storage.local.remove(`${MEMORY_PREFIX}${id}`);
}

function isMemory(value: unknown): value is Memory {
  if (!value || typeof value !== "object") return false;
  const memory = value as Partial<Memory>;
  return typeof memory.id === "string"
    && typeof memory.title === "string"
    && typeof memory.content === "string"
    && Number.isFinite(memory.createdAt)
    && Number.isFinite(memory.updatedAt);
}
