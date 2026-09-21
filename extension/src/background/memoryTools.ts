import { parseTextToolCall } from "../shared/htmlTools";
import { i18n } from "../shared/i18n.ts";
import {
  applyMemoryEdits,
  createMemory,
  deleteMemory,
  isMemoryWriteTool,
  loadMemories,
  MEMORY_MAX_COUNT,
  memoryRef,
  parseMemoryWriteCall,
  saveMemory,
  type Memory
} from "../shared/memory";
import type { ToolSuccessOutput } from "../shared/protocol";
import { grepStored, listMemories, memoryTexts, runStoredTextTool } from "./storedText";

export async function runMemoryWrite(name: string, args: string): Promise<ToolSuccessOutput> {
  if (!isMemoryWriteTool(name)) throw new Error(i18n._({ id: "errors.unsupportedTool", message: "Unsupported tool: {name}", values: { name } }));
  const call = parseMemoryWriteCall(name, args);
  const memories = await loadMemories();
  if (call.name === "new") {
    if (memories.length >= MEMORY_MAX_COUNT) {
      throw new Error(i18n._({ id: "errors.memoryLimit", message: "You can save up to {max} memories. Merge this into an existing topic or delete an unnecessary topic.", values: { max: MEMORY_MAX_COUNT } }));
    }
    const memory = { ...createMemory(), title: call.title, content: call.content };
    await saveMemory(memory);
    return describe(memory);
  }

  const memory = memories.find((candidate) => memoryRef(candidate) === call.ref);
  if (!memory) throw new Error(invalidMemoryRef(call.ref));
  if (memory.favorite) throw new Error(i18n._({ id: "errors.favoriteMemory", message: "A favorite memory (is_editable=false) cannot be changed." }));
  if (call.name === "delete") {
    await deleteMemory(memory.id);
    return { type: "text", content: JSON.stringify({ ref: call.ref, deleted: true }) };
  }
  const updated: Memory = {
    ...memory,
    ...(call.name === "patch" ? { content: applyMemoryEdits(memory.content, call.edits) } : { title: call.title }),
    updatedAt: Date.now()
  };
  await saveMemory(updated);
  return describe(updated);
}

/** The memory-maintenance branch only sees memories: no page, tab, or session access. */
export async function runMemoryScopedTool(name: string, args: string): Promise<ToolSuccessOutput> {
  if (isMemoryWriteTool(name)) return runMemoryWrite(name, args);
  if (name === "list") {
    if ((JSON.parse(args) as { type?: unknown }).type !== "memory") throw notAvailable(name);
    return listMemories();
  }
  if (name !== "grep" && name !== "read") throw notAvailable(name);

  const call = parseTextToolCall(name, args);
  const texts = await memoryTexts();
  if (call.name === "grep" && call.args.resourceType === "memory") return grepStored(texts, call.args);
  const ref = call.args.ref;
  if (!ref || !/^memory_\d+$/.test(ref)) throw notAvailable(name);
  const text = texts.find((candidate) => candidate.ref === ref);
  if (!text) throw new Error(invalidMemoryRef(ref));
  return runStoredTextTool(text, call);
}

function describe(memory: Memory): ToolSuccessOutput {
  return {
    type: "text",
    content: JSON.stringify({
      ref: memoryRef(memory),
      title: memory.title,
      content: memory.content,
      length: memory.content.length
    })
  };
}

function notAvailable(name: string): Error {
  return new Error(i18n._({
    id: "errors.memoryToolScope",
    message: "During a memory update, {name} cannot be used outside memory. Use only list(type=memory), grep with resource_type=memory, read/grep with memory_<id>, and patch/rename/new/delete.",
    values: { name }
  }));
}

function invalidMemoryRef(ref: string): string {
  return i18n._({
    id: "errors.invalidMemoryReference",
    message: "Invalid ref: {ref}. Use list(type=memory) to refresh memory refs.",
    values: { ref }
  });
}
