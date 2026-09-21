import { parseTextToolCall } from "../shared/htmlTools";
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
  if (!isMemoryWriteTool(name)) throw new Error(`未対応のツールです: ${name}`);
  const call = parseMemoryWriteCall(name, args);
  const memories = await loadMemories();
  if (call.name === "new") {
    if (memories.length >= MEMORY_MAX_COUNT) {
      throw new Error(`メモリは最大${MEMORY_MAX_COUNT}件です。既存のトピックへ統合するか、不要なトピックを削除してください。`);
    }
    const memory = { ...createMemory(), title: call.title, content: call.content };
    await saveMemory(memory);
    return describe(memory);
  }

  const memory = memories.find((candidate) => memoryRef(candidate) === call.ref);
  if (!memory) throw new Error(`参照が無効です: ${call.ref}。list(type=memory)で参照を再取得してください。`);
  if (memory.favorite) throw new Error("お気に入りのメモリ(is_editable=false)は変更できません。");
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
  if (!text) throw new Error(`参照が無効です: ${ref}。list(type=memory)で参照を再取得してください。`);
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
  return new Error(`メモリ更新中は${name}をメモリ以外に使えません。list(type=memory)、resource_type=memoryのgrep、memory_<id>のread/grep、patch/rename/new/deleteだけを使ってください。`);
}
