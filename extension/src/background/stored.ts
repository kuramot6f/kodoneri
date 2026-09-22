import { getMessageText, getMeta, type Conversation } from "../shared/conversation.ts";
import {
  applyMemoryEdits,
  createMemory,
  deleteMemory,
  formatMemoryList,
  loadMemories,
  MEMORY_MAX_COUNT,
  memoryRef,
  saveMemory,
  type Memory,
  type MemoryEdit
} from "../shared/memory.ts";
import { loadConversations } from "../shared/store.ts";
import { aggregateGrep, grepText, readText, type GrepArgs, type ReadArgs } from "../shared/text.ts";

/** A stored text the model reads by ref: a saved conversation (session_<id>) or a memory (memory_<id>). */
interface StoredText {
  ref: string;
  title: string;
  content: string;
}

export function isStoredRef(ref: string): boolean {
  return /^(?:session|memory)_\d+$/.test(ref);
}

export function isMemoryRef(ref: string | undefined): boolean {
  return ref !== undefined && /^memory_\d+$/.test(ref);
}

export async function listMemories() {
  return formatMemoryList(await loadMemories());
}

export async function grepStored(type: "session" | "memory", args: GrepArgs) {
  const texts = type === "session" ? await sessionTexts() : await memoryTexts();
  return aggregateGrep(
    texts,
    args.offset ?? 0,
    async (text, offset) => grepText(text.content, { ...args, offset }),
    ({ ref, title }) => ({ ref, title })
  );
}

export async function grepStoredRef(ref: string, args: GrepArgs) {
  const text = await findText(ref);
  return { ref, title: text.title, ...grepText(text.content, args) };
}

export async function readStoredRef(ref: string, args: ReadArgs) {
  const text = await findText(ref);
  return { ref, title: text.title, ...readText(text.content, args) };
}

export async function newMemory({ title, content }: { title: string; content: string }) {
  if ((await loadMemories()).length >= MEMORY_MAX_COUNT) {
    throw new Error(`You can save up to ${MEMORY_MAX_COUNT} memories. Merge this into an existing topic or delete an unnecessary topic.`);
  }
  const memory = { ...createMemory(), title, content };
  await saveMemory(memory);
  return describe(memory);
}

export async function patchMemory({ ref, edits }: { ref: string; edits: MemoryEdit[] }) {
  const memory = await editableMemory(ref);
  const updated = { ...memory, content: applyMemoryEdits(memory.content, edits), updatedAt: Date.now() };
  await saveMemory(updated);
  return describe(updated);
}

export async function renameMemory({ ref, title }: { ref: string; title: string }) {
  const updated = { ...await editableMemory(ref), title, updatedAt: Date.now() };
  await saveMemory(updated);
  return describe(updated);
}

export async function removeMemory({ ref }: { ref: string }) {
  await deleteMemory((await editableMemory(ref)).id);
  return { ref, deleted: true };
}

async function editableMemory(ref: string): Promise<Memory> {
  const memory = (await loadMemories()).find((candidate) => memoryRef(candidate) === ref);
  if (!memory) throw new Error(`Invalid ref: ${ref}. Use list(type=memory) to refresh memory refs.`);
  if (memory.favorite) throw new Error("A favorite memory (is_editable=false) cannot be changed.");
  return memory;
}

function describe(memory: Memory) {
  return { ref: memoryRef(memory), title: memory.title, content: memory.content, length: memory.content.length };
}

async function findText(ref: string): Promise<StoredText> {
  const texts = ref.startsWith("session") ? await sessionTexts() : await memoryTexts();
  const text = texts.find((candidate) => candidate.ref === ref);
  if (!text) throw new Error(`Invalid ref: ${ref}. Use grep(resource_type=session) to refresh conversation refs or list(type=memory) to refresh memory refs.`);
  return text;
}

async function memoryTexts(): Promise<StoredText[]> {
  return (await loadMemories()).map((memory) => ({ ref: memoryRef(memory), title: memory.title, content: memory.content }));
}

async function sessionTexts(): Promise<StoredText[]> {
  return (await loadConversations()).map((conversation) => ({
    ref: conversation.id,
    title: conversation.title,
    content: formatConversation(conversation)
  }));
}

function formatConversation(conversation: Conversation): string {
  const lines = conversation.messages.flatMap((message): string[] => {
    const { kind } = getMeta(message);
    if (message.role === "user") {
      if (kind === "runtime_error") return [`[error]\n${getMessageText(message)}`];
      if (kind === "runtime_cancelled") return [`[cancelled]\n${getMessageText(message)}`];
      return kind ? [] : [`[user]\n${getMessageText(message)}`];
    }
    if (message.role !== "assistant") return [];
    const content = getMessageText(message);
    return content ? [`[assistant]\n${content}`] : [];
  });
  return [`# ${conversation.title}`, ...lines].join("\n\n");
}
