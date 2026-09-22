import { aggregateGrep } from "../shared/aggregateGrep";
import { getMessageText, getMeta, type Conversation } from "../shared/conversation";
import { runTextTool, type GrepArgs, type ParsedTextToolCall } from "../shared/htmlTools";
import { formatMemoryList, loadMemories, memoryRef } from "../shared/memory";
import { i18n } from "../shared/i18n.ts";
import type { TextToolOutput, ToolSuccessOutput } from "../shared/protocol";
import { loadConversations } from "../shared/store";

/** A stored text the model reads by ref: a saved conversation or a memory. */
export interface StoredText {
  ref: string;
  title: string;
  content: string;
}

export async function listMemories(): Promise<TextToolOutput> {
  return { type: "text", content: JSON.stringify(formatMemoryList(await loadMemories())) };
}

export async function memoryTexts(): Promise<StoredText[]> {
  return (await loadMemories()).map((memory) => ({
    ref: memoryRef(memory),
    title: memory.title,
    content: memory.content
  }));
}

export async function sessionTexts(): Promise<StoredText[]> {
  return (await loadConversations()).map((conversation) => ({
    ref: conversation.id,
    title: conversation.title,
    content: formatConversation(conversation)
  }));
}

export async function grepStored(texts: StoredText[], args: GrepArgs): Promise<ToolSuccessOutput> {
  const result = await aggregateGrep({
    resources: texts,
    args,
    run: (text, offset) => Promise.resolve(runStoredTextTool(text, {
      name: "grep",
      args: { ...args, offset, ref: undefined, resourceType: undefined }
    })),
    metadata: ({ ref, title }) => ({ ref, title }),
    nonTextError: i18n._({ id: "errors.grepReturnedImage", message: "grep returned an image result." })
  });
  return { type: "text", content: JSON.stringify(result) };
}

export function runStoredTextTool(text: StoredText, call: ParsedTextToolCall): ToolSuccessOutput {
  const output = runTextTool(text.content, call.name === "grep"
    ? { name: "grep", args: { ...call.args, ref: undefined, resourceType: undefined } }
    : { name: "read", args: { ...call.args, ref: undefined } });
  if (output.type !== "text") throw new Error(output.type === "error"
    ? output.error
    : i18n._({ id: "errors.cannotReturnImage", message: "An image result cannot be returned here." }));
  return {
    type: "text",
    content: JSON.stringify({ ref: text.ref, title: text.title, ...JSON.parse(output.content) as object })
  };
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
