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

export type MemoryWriteCall =
  | { name: "patch"; ref: string; edits: MemoryEdit[] }
  | { name: "rename"; ref: string; title: string }
  | { name: "new"; title: string; content: string }
  | { name: "delete"; ref: string };

export const MEMORY_MAX_COUNT = 10;
export const MEMORY_CONTENT_MAX_LENGTH = 1000;
export const MEMORY_TITLE_MAX_LENGTH = 50;
export const MEMORY_WRITE_TOOLS = ["patch", "rename", "new", "delete"] as const;

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

export function isMemoryWriteTool(name: string): name is MemoryWriteCall["name"] {
  return (MEMORY_WRITE_TOOLS as readonly string[]).includes(name);
}

export function parseMemoryWriteCall(name: MemoryWriteCall["name"], argumentsJson: string): MemoryWriteCall {
  const value: unknown = JSON.parse(argumentsJson);
  if (!value || typeof value !== "object") throw new Error("引数が不正です。");
  const args = value as Record<string, unknown>;
  if (name === "new") {
    return { name, title: parseTitle(args.title), content: parseContent(args.content) };
  }
  const ref = args.ref;
  if (typeof ref !== "string" || !/^memory_\d+$/.test(ref)) {
    throw new Error("refはlist(type=memory)が返すmemory_<id>形式で指定してください。");
  }
  if (name === "delete") return { name, ref };
  if (name === "rename") return { name, ref, title: parseTitle(args.title) };
  return { name, ref, edits: parseEdits(args.edits) };
}

/** Applies edits in order; each `old` must match exactly once so stale edits fail instead of corrupting the topic. */
export function applyMemoryEdits(content: string, edits: MemoryEdit[]): string {
  let next = content;
  for (const edit of edits) {
    const first = next.indexOf(edit.old);
    if (first === -1) {
      throw new Error(`oldが本文と一致しません: ${JSON.stringify(edit.old)}。readで現在の内容を確認してから再試行してください。`);
    }
    if (next.indexOf(edit.old, first + 1) !== -1) {
      throw new Error(`oldが本文に複数回含まれます: ${JSON.stringify(edit.old)}。一意になるよう前後を含めてください。`);
    }
    next = next.slice(0, first) + edit.new + next.slice(first + edit.old.length);
  }
  if (!next.trim()) throw new Error("本文が空になります。トピックごと削除するにはdeleteを使ってください。");
  return parseContent(next);
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

function parseTitle(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > MEMORY_TITLE_MAX_LENGTH) {
    throw new Error(`titleは1〜${MEMORY_TITLE_MAX_LENGTH}文字で指定してください。`);
  }
  return value.trim();
}

function parseContent(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("contentを指定してください。");
  if (value.length > MEMORY_CONTENT_MAX_LENGTH) {
    throw new Error(`本文は${MEMORY_CONTENT_MAX_LENGTH}文字以内にしてください(現在${value.length}文字)。不要な記述を削るか要約してください。`);
  }
  return value;
}

function parseEdits(value: unknown): MemoryEdit[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("editsは1件以上指定してください。");
  return value.map((edit: unknown) => {
    const { old, new: next } = (edit && typeof edit === "object" ? edit : {}) as Record<string, unknown>;
    if (typeof old !== "string" || !old || typeof next !== "string") {
      throw new Error("各editはold(1文字以上)とnewの文字列で指定してください。");
    }
    return { old, new: next };
  });
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
