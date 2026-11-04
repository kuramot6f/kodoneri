import { generateText, isLoopFinished, streamText } from "ai";
import type { AssistantModelMessage, JSONValue, ModelMessage, ToolResultPart, ToolSet } from "ai";
import { i18n } from "../shared/i18n.ts";
import { taggedMessage } from "../shared/conversation.ts";
import { errorMessage } from "../shared/errors.ts";
import { isImageOutput } from "../shared/protocol.ts";
import { loadPrompt, TITLE_MAX_LENGTH } from "../shared/prompts.ts";
import type { ModelRuntime } from "./provider.ts";

interface StreamCallbacks {
  /** Called on every change to the streaming step, shaped as the messages it is saved as. */
  onUpdate: (step: ModelMessage[]) => void;
  /** Called after every step with that step's new messages. */
  onStep: (messages: ModelMessage[]) => void;
  onToolError?: (toolName: string, message: string) => void;
}

interface StreamResult {
  error?: string;
  cancelled?: boolean;
  /** Text and reasoning of the step that was cut off, so it can still be shown and saved. */
  partial: AssistantModelMessage | null;
  contextTokens: number | null;
}

type AssistantPart = Exclude<AssistantModelMessage["content"], string>[number];

/** Runs the model with tools until it answers, is cancelled, or fails. There is no step limit. */
export async function streamAnswer(
  runtime: Pick<ModelRuntime, "model" | "providerOptions">,
  messages: ModelMessage[],
  tools: ToolSet,
  signal: AbortSignal,
  callbacks: StreamCallbacks,
  instructions: string
): Promise<StreamResult> {
  let parts: AssistantPart[] = [];
  let results: ToolResultPart[] = [];
  let contextTokens: number | null = null;
  const step = (): ModelMessage[] => parts.length === 0 ? [] : [
    { role: "assistant", content: parts },
    ...(results.length > 0 ? [{ role: "tool" as const, content: results }] : [])
  ];
  const appendText = (type: "text" | "reasoning", text: string) => {
    const last = parts.at(-1);
    if (last?.type === type) parts = [...parts.slice(0, -1), { ...last, text: last.text + text }];
    else parts = [...parts, { type, text }];
    callbacks.onUpdate(step());
  };
  const appendResult = (part: { toolCallId: string; toolName: string; providerExecuted?: boolean }, output: ToolResultPart["output"]) => {
    const result: ToolResultPart = { type: "tool-result", toolCallId: part.toolCallId, toolName: part.toolName, output };
    // A tool the provider ran, such as web search, has its result saved in the assistant message.
    if (part.providerExecuted) parts = [...parts, result];
    else results = [...results, result];
    callbacks.onUpdate(step());
  };

  try {
    let history = messages;
    // Anthropic pauses a long server-side search with pause_turn, which the SDK reports as a finished answer;
    // sending the paused turn back resumes it.
    while (true) {
      const result = streamText({
        model: runtime.model,
        instructions,
        messages: history,
        tools,
        // The SDK stops after one step by default; the stop button is the only limit here.
        stopWhen: isLoopFinished(),
        abortSignal: signal,
        providerOptions: runtime.providerOptions,
        onStepEnd: (finished) => {
          contextTokens = finished.usage.totalTokens ?? null;
          parts = [];
          results = [];
          history = [...history, ...finished.response.messages];
          callbacks.onStep(finished.response.messages);
        }
      });

      for await (const part of result.stream) {
        if (part.type === "text-delta") {
          appendText("text", part.text);
        } else if (part.type === "reasoning-delta") {
          appendText("reasoning", part.text);
        } else if (part.type === "tool-call") {
          parts = [...parts, { type: "tool-call", toolCallId: part.toolCallId, toolName: part.toolName, input: part.input }];
          callbacks.onUpdate(step());
        } else if (part.type === "tool-result") {
          appendResult(part, part.providerExecuted
            ? { type: "json", value: part.output as JSONValue }
            : { type: "text", value: formatToolResult(part.output) });
        } else if (part.type === "tool-error") {
          callbacks.onToolError?.(part.toolName, errorMessage(part.error));
          // The same text the SDK saves for a failed tool.
          appendResult(part, { type: "error-text", value: String(part.error) });
        } else if (part.type === "error") {
          throw part.error;
        } else if (part.type === "abort") {
          throw new DOMException(i18n._({ id: "errors.responseCancelled", message: "Response generation was cancelled." }), "AbortError");
        }
      }

      const last = (await result.steps).at(-1);
      if (last?.rawFinishReason === "pause_turn") continue;
      if (!last?.text) throw new Error(i18n._({ id: "errors.noResponse", message: "No response was received." }));
      return { partial: null, contextTokens };
    }
  } catch (error) {
    const cancelled = isAbortError(error);
    // Tool calls of the cut-off step have no results, so only its text is kept.
    const content = parts.filter((part) => part.type === "text" || part.type === "reasoning");
    return {
      error: cancelled ? i18n._({ id: "errors.responseCancelled", message: "Response generation was cancelled." }) : errorMessage(error),
      cancelled,
      partial: content.some((part) => part.type === "text") ? { role: "assistant", content } : null,
      contextTokens
    };
  }
}

export async function generateTitle(runtime: ModelRuntime, question: string, answer: string): Promise<string> {
  const { text } = await generateText({
    model: runtime.model,
    instructions: await loadPrompt("title"),
    prompt: `Question:\n${question}\n\nAnswer:\n${answer}`,
    providerOptions: runtime.providerOptions
  });
  const title = text.replace(/[\r\n]+/g, " ").trim().replace(/^[「『"']+|[」』"']+$/g, "").trim();
  if (!title) throw new Error(i18n._({ id: "errors.noTitle", message: "No title was received." }));
  return title.slice(0, TITLE_MAX_LENGTH);
}

export async function compact(runtime: ModelRuntime, prefix: ModelMessage[], signal: AbortSignal): Promise<string> {
  const { text } = await generateText({
    model: runtime.model,
    instructions: await loadPrompt("system"),
    messages: [...prefix, taggedMessage("compaction", await loadPrompt("compaction"))],
    maxOutputTokens: 16_384,
    abortSignal: signal,
    providerOptions: runtime.providerOptions
  });
  const content = text.trim();
  if (!content) throw new Error(i18n._({ id: "errors.noCompaction", message: "No conversation compaction result was received." }));
  return `This is a working checkpoint for continuing an earlier conversation.\n\n${content}`;
}

function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException || error instanceof Error) && error.name === "AbortError";
}

/** Display text for the panel; image data stays out of the view. */
function formatToolResult(output: unknown): string {
  if (isImageOutput(output)) return `${output.mimeType} (${(output.byteLength / 1024).toFixed(1)} KiB)`;
  return typeof output === "string" ? output : JSON.stringify(output);
}
