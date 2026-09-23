import type { ModelMessage } from "../shared/conversation";
import { getMeta, taggedMessage } from "../shared/conversation.ts";

interface ConversationCompaction {
  /** Number of messages replaced by the compaction checkpoint. */
  prefixMessageCount: number;
  content: string;
}

export const COMPACTION_THRESHOLD_RATIO = 0.8;
const RECENT_TURNS_TO_KEEP = 5;

const TAIL_CONTEXT_NAMES = new Set(["runtime_context", "memory_context", "browser_context", "selection_context"]);

export function planCompaction(
  messages: ModelMessage[],
  contextTokens: number | null,
  contextWindow: number
): { prefix: ModelMessage[]; prefixMessageCount: number } | null {
  if (contextTokens === null || contextTokens < contextWindow * COMPACTION_THRESHOLD_RATIO) return null;

  const questions = messages.flatMap((message, index) => (
    message.role === "user" && getMeta(message).kind === undefined ? [index] : []
  ));
  if (questions.length <= RECENT_TURNS_TO_KEEP) return null;

  let tailStart = questions[questions.length - RECENT_TURNS_TO_KEEP];
  while (tailStart > 0) {
    const previous = messages[tailStart - 1];
    const kind = getMeta(previous).kind;
    if (previous.role !== "user" || !kind || !TAIL_CONTEXT_NAMES.has(kind)) break;
    tailStart -= 1;
  }
  if (tailStart === 0) return null;
  return { prefix: messages.slice(0, tailStart), prefixMessageCount: tailStart };
}

export function applyCompaction(
  messages: ModelMessage[],
  compaction: ConversationCompaction
): ModelMessage[] {
  return [
    taggedMessage("compaction", compaction.content),
    ...messages.slice(compaction.prefixMessageCount)
  ];
}
