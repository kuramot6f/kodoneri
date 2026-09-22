import type {
  AssistantModelMessage,
  ModelMessage,
  ToolModelMessage,
  ToolResultPart,
  UserModelMessage
} from "ai";

export type { AssistantModelMessage, ModelMessage, ToolModelMessage, ToolResultPart, UserModelMessage } from "ai";

export interface CacheUsage {
  hitTokens: number;
  missTokens: number;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Fixed system prompt created when the conversation starts. */
  systemPrompt?: string;
  messages: ModelMessage[];
}

export type MessageKind =
  | "browser_context"
  | "selection_context"
  | "runtime_error"
  | "runtime_cancelled"
  | "memory_update"
  | "compaction";

/** Older tool output and reasoning are dropped from the prompt; DeepSeek file uploads expire on the same schedule. */
export const TOOL_HISTORY_TTL_MS = 6 * 60 * 60 * 1000;

/** App metadata rides in providerOptions, which providers ignore for unknown keys. */
interface Meta {
  kind?: MessageKind;
  at?: number;
}

export function createConversation(firstQuestion: string): Conversation {
  const now = Date.now();
  return {
    id: `session_${now}`,
    title: firstQuestion.length > 40 ? `${firstQuestion.slice(0, 40)}…` : firstQuestion,
    createdAt: now,
    updatedAt: now,
    messages: []
  };
}

export function taggedMessage(kind: MessageKind, content: string): UserModelMessage {
  return withMeta({ role: "user", content: [{ type: "text", text: `[${kind}]\n${content}` }] }, { kind });
}

export function stamp<T extends ModelMessage>(message: T, at = Date.now()): T {
  return withMeta(message, { at });
}

export function getMeta(message: ModelMessage): Meta {
  const meta = message.providerOptions?.chatext;
  return meta && typeof meta === "object" ? meta as Meta : {};
}

export function getMessageText(message: ModelMessage): string {
  if (typeof message.content === "string") return message.content;
  const text = message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("");
  const { kind } = getMeta(message);
  const prefix = kind ? `[${kind}]\n` : "";
  return prefix && text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

export function getToolCalls(message: AssistantModelMessage) {
  return typeof message.content === "string" ? [] : message.content.filter((part) => part.type === "tool-call");
}

export function getToolResults(message: ToolModelMessage): ToolResultPart[] {
  return message.content.filter((part): part is ToolResultPart => part.type === "tool-result");
}

/** Keeps questions and answers; drops tool traffic and reasoning older than the TTL. */
export function expireToolHistory(conversation: Conversation, now = Date.now()): Conversation {
  const cutoff = now - TOOL_HISTORY_TTL_MS;
  let changed = false;
  const messages = conversation.messages.flatMap((message): ModelMessage[] => {
    const at = getMeta(message).at ?? conversation.createdAt;
    if (at > cutoff) return [message];
    if (message.role === "tool" || (message.role === "assistant" && getToolCalls(message).length > 0)) {
      changed = true;
      return [];
    }
    if (message.role !== "assistant" || typeof message.content === "string") return [message];
    const content = message.content.filter((part) => part.type !== "reasoning");
    if (content.length === message.content.length) return [message];
    changed = true;
    const next = { ...message, content };
    return getMessageText(next) ? [next] : [];
  });
  return changed ? { ...conversation, messages } : conversation;
}

function withMeta<T extends ModelMessage>(message: T, meta: Meta): T {
  const current = message.providerOptions?.chatext;
  return {
    ...message,
    providerOptions: {
      ...message.providerOptions,
      chatext: { ...(current && typeof current === "object" ? current : {}), ...meta }
    }
  };
}
