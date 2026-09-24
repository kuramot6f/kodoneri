import type {
  AssistantModelMessage,
  ModelMessage,
  ToolModelMessage,
  ToolResultPart,
  UserModelMessage
} from "ai";

import type { ModelSettings } from "./models";
import type { SelectionContext } from "./protocol";

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
  messages: ModelMessage[];
  /** The model and effort of the latest question; reopening the conversation selects them again. */
  settings?: ModelSettings;
}

type MessageKind =
  | "runtime_context"
  | "memory_context"
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
  /** The structured selection behind a selection_context message, for display. */
  selection?: SelectionContext;
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

export function taggedMessage(kind: MessageKind, content: string, meta: Omit<Meta, "kind"> = {}): UserModelMessage {
  return withMeta({ role: "user", content: [{ type: "text", text: `[${kind}]\n${content}` }] }, { ...meta, kind });
}

/** The content of the latest message of that kind; contexts are appended only when it changes, so the history stays append-only. */
export function latestContext(messages: ModelMessage[], kind: MessageKind): string | undefined {
  const message = messages.findLast((candidate) => candidate.role === "user" && getMeta(candidate).kind === kind);
  return message && getMessageText(message);
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

function getToolCalls(message: AssistantModelMessage) {
  return typeof message.content === "string" ? [] : message.content.filter((part) => part.type === "tool-call");
}

export function getToolResults(message: ToolModelMessage): ToolResultPart[] {
  return message.content.filter((part): part is ToolResultPart => part.type === "tool-result");
}

/** Keeps questions and answers; drops tool traffic and reasoning from before the cutoff (by default, older than the TTL). */
export function expireToolHistory(conversation: Conversation, cutoff = Date.now() - TOOL_HISTORY_TTL_MS): Conversation {
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

/** The last `count` questions, each with the answer text that followed it; context, reasoning and tool traffic are left out. */
export function recentTurns(messages: ModelMessage[], count: number): ModelMessage[] {
  const turns: { question: string; answers: string[] }[] = [];
  for (const message of messages) {
    const text = getMessageText(message);
    if (message.role === "user" && !getMeta(message).kind) turns.push({ question: text, answers: [] });
    else if (message.role === "assistant" && text) turns.at(-1)?.answers.push(text);
  }
  return turns.slice(-count).flatMap(({ question, answers }): ModelMessage[] => [
    { role: "user", content: question },
    ...(answers.length > 0 ? [{ role: "assistant" as const, content: answers.join("\n\n") }] : [])
  ]);
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
