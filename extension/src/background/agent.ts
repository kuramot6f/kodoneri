import { generateText, isLoopFinished, streamText } from "ai";
import type { LanguageModelUsage, ModelMessage, ToolSet } from "ai";
import type { CacheUsage } from "../shared/conversation";
import { taggedMessage } from "../shared/conversation.ts";
import { MEMORY_CONTENT_MAX_LENGTH, MEMORY_MAX_COUNT } from "../shared/memory.ts";
import type { ToolDetail, ToolOutput } from "../shared/protocol";
import { stripToolImageData } from "../shared/toolOutput.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";
import type { ModelRuntime } from "./provider.ts";

const TITLE_MAX_LENGTH = 30;

export interface StreamCallbacks {
  onDelta: (channel: "text" | "reasoning", text: string) => void;
  /** Called when a tool starts (output null) and again when it finishes. */
  onTool: (detail: ToolDetail) => void;
  /** Called after every step with that step's new messages. */
  onStep: (messages: ModelMessage[]) => void;
}

export interface StreamResult {
  error?: string;
  cancelled?: boolean;
  /** Text of the step that was cut off, so it can still be shown and saved. */
  partial: { text: string; reasoning: string };
  cacheUsage: CacheUsage | null;
  contextTokens: number | null;
}

/** Runs the model with tools until it answers, is cancelled, or fails. There is no step limit. */
export async function streamAnswer(
  runtime: Pick<ModelRuntime, "model" | "providerOptions">,
  messages: ModelMessage[],
  tools: ToolSet,
  signal: AbortSignal,
  callbacks: StreamCallbacks
): Promise<StreamResult> {
  let text = "";
  let reasoning = "";
  let cacheUsage: CacheUsage | null = null;
  let contextTokens: number | null = null;
  const calls = new Map<string, ToolDetail>();

  try {
    const result = streamText({
      model: runtime.model,
      instructions: SYSTEM_PROMPT,
      messages,
      tools,
      // The SDK stops after one step by default; the stop button is the only limit here.
      stopWhen: isLoopFinished(),
      abortSignal: signal,
      providerOptions: runtime.providerOptions,
      onStepEnd: (step) => {
        cacheUsage = sumCacheUsage(cacheUsage, readCacheUsage(step.usage));
        contextTokens = step.usage.totalTokens ?? null;
        text = "";
        reasoning = "";
        callbacks.onStep(step.response.messages);
      }
    });

    for await (const part of result.stream) {
      if (part.type === "text-delta") {
        text += part.text;
        callbacks.onDelta("text", part.text);
      } else if (part.type === "reasoning-delta") {
        reasoning += part.text;
        callbacks.onDelta("reasoning", part.text);
      } else if (part.type === "tool-call") {
        const detail = { id: part.toolCallId, name: part.toolName, args: JSON.stringify(part.input), output: null };
        calls.set(part.toolCallId, detail);
        callbacks.onTool(detail);
      } else if (part.type === "tool-result" || part.type === "tool-error") {
        const call = calls.get(part.toolCallId);
        if (!call) continue;
        const output: ToolOutput = part.type === "tool-result"
          ? stripToolImageData(part.output as ToolOutput)
          : { type: "error", error: getErrorMessage(part.error) };
        callbacks.onTool({ ...call, output });
      } else if (part.type === "error") {
        throw part.error;
      } else if (part.type === "abort") {
        throw new DOMException("回答の生成を中止しました。", "AbortError");
      }
    }

    const steps = await result.steps;
    if (!steps.at(-1)?.text) throw new Error("回答を取得できませんでした。");
    return { partial: { text: "", reasoning: "" }, cacheUsage, contextTokens };
  } catch (error) {
    const cancelled = isAbortError(error);
    return {
      error: cancelled ? "回答の生成を中止しました。" : getErrorMessage(error),
      cancelled,
      partial: { text, reasoning },
      cacheUsage,
      contextTokens
    };
  }
}

export async function generateTitle(runtime: ModelRuntime, question: string, answer: string): Promise<string> {
  const { text } = await generateText({
    model: runtime.model,
    instructions: `会話内容を表す簡潔なタイトルを${TITLE_MAX_LENGTH}文字以内で作成してください。タイトルだけを出力し、引用符、句点、説明、改行は含めないでください。会話と同じ言語を使ってください。`,
    prompt: `質問:\n${question}\n\n回答:\n${answer}`,
    providerOptions: runtime.providerOptions
  });
  const title = text.replace(/[\r\n]+/g, " ").trim().replace(/^[「『"']+|[」』"']+$/g, "").trim();
  if (!title) throw new Error("タイトルを取得できませんでした。");
  return title.slice(0, TITLE_MAX_LENGTH);
}

export async function compact(runtime: ModelRuntime, prefix: ModelMessage[], signal: AbortSignal): Promise<string> {
  const { text } = await generateText({
    model: runtime.model,
    instructions: SYSTEM_PROMPT,
    messages: [...prefix, taggedMessage("compaction", COMPACTION_PROMPT)],
    maxOutputTokens: 16_384,
    abortSignal: signal,
    providerOptions: runtime.providerOptions
  });
  const content = text.trim();
  if (!content) throw new Error("会話の圧縮結果を取得できませんでした。");
  return `これは以前の会話を継続するための作業チェックポイントです。\n\n${content}`;
}

const COMPACTION_PROMPT = `これは会話圧縮専用の分岐です。ユーザーへの返答ではありません。ツールを使わず、ここまでの会話を、以後のエージェントが作業をほぼそのまま継続できる作業チェックポイントへ圧縮してください。
- 元の目的、現在のサブタスク、明示的な制約・好み、確定した判断と理由を残す。
- ツールで確認した事実、重要なURL・識別子・正確な値、完了した操作、重要な失敗と原因を残す。
- 未解決事項、不確実な仮説、次に行うべきことを区別して残す。
- 一時的なDOM参照、冗長なツール出力、反復した探索、不要な推論は除く。
- 既存の圧縮チェックポイントがある場合は重要情報を落とさず統合する。
- 正確さが必要な文字列は原文のまま残し、事実・ユーザー要件・判断・仮説を混同しない。
- 見出しと簡潔な箇条書きを使い、チェックポイント本文だけを出力する。`;

/** Appended after the answer as a user message. The conversation prefix, and so its KV cache, stays untouched. */
export const MEMORY_UPDATE_PROMPT = `これはメモリ保守のための分岐です。直前の回答で会話のターンは完了しており、ユーザーへの返答や質問はできません。
役割: 今回のターンに将来の会話でも役立つ持続的な情報(継続中のプロジェクト、好み、ユーザーの背景、決定事項、制約、計画、既存情報の変更)が含まれるか判断し、必要な場合だけメモリを更新する。
- 既定の動作は「更新なし」。挨拶、一回限りの質問、今回の回答にしか関係しない情報、一般的な説明、既にメモリにある内容、推測によるユーザー像は保存しない。
- 書き込む前にlist(type=memory)で既存トピックを確認し、関係しそうなトピックはgrepやreadで内容を読む。
- 既存トピックへのpatchが基本。newは既存トピックに属さない情報の居場所を作るときだけ。deleteはユーザーが忘れるよう求めた、明らかに無効、重複のときだけ。
- 訂正は誤った記述を書き換える。時間経過による変化は必要なら時期を残して更新し、有用な過去の情報は消さない。
- is_editableがfalseのトピックはユーザーのお気に入りで変更できない。
- 各トピックは${MEMORY_CONTENT_MAX_LENGTH}字以内、最大${MEMORY_MAX_COUNT}件。簡潔な箇条書きで、他の会話でも文脈が分かる内容にする。
- このブランチではメモリ以外のツールは使えない。
- 最後に実施した内容を1文で述べる。更新しない場合は「更新なし」とだけ答える。`;

function readCacheUsage(usage: LanguageModelUsage): CacheUsage | null {
  const { cacheReadTokens, noCacheTokens, cacheWriteTokens } = usage.inputTokenDetails;
  if (cacheReadTokens === undefined && noCacheTokens === undefined) return null;
  return { hitTokens: cacheReadTokens ?? 0, missTokens: (noCacheTokens ?? 0) + (cacheWriteTokens ?? 0) };
}

function sumCacheUsage(current: CacheUsage | null, next: CacheUsage | null): CacheUsage | null {
  if (!next) return current;
  return {
    hitTokens: (current?.hitTokens ?? 0) + next.hitTokens,
    missTokens: (current?.missTokens ?? 0) + next.missTokens
  };
}

function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException || error instanceof Error) && error.name === "AbortError";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "不明なエラーが発生しました。";
}
