import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, RefObject } from "react";
import hljs from "highlight.js/lib/common";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import type {
  CacheUsage,
  Conversation,
  ModelMessage,
  ToolResultPart
} from "../shared/conversation";
import { getMeta, getMessageText, getToolResults } from "../shared/conversation";
import type { MemoryProgress, StepView, ToolDetail, ToolOutput } from "../shared/protocol";
import { Icon } from "./Icon";
import { ModelMenu } from "./ModelMenu";
import { parseSelectionContext } from "../shared/selectionContext";

const plainTextLanguages = new Set(["nohighlight", "plaintext", "text", "txt"]);
const markdown = new Marked(markedHighlight({
  emptyLangClass: "hljs",
  langPrefix: "hljs language-",
  highlight(code, language) {
    const normalizedLanguage = language.toLowerCase();
    if (plainTextLanguages.has(normalizedLanguage)) return code;
    if (normalizedLanguage && hljs.getLanguage(normalizedLanguage)) {
      return hljs.highlight(code, { language: normalizedLanguage }).value;
    }
    return hljs.highlightAuto(code).value;
  }
}));

interface ChatViewProps {
  conversation: Conversation | null;
  /** The step currently streaming; finished steps are already in the conversation. */
  step: StepView | null;
  memory: MemoryProgress | null;
  compacting: boolean;
  cacheUsage: CacheUsage | null;
  question: string;
  includeSelection: boolean;
  selectionSummary: string | null;
  busy: boolean;
  questionRef: RefObject<HTMLTextAreaElement | null>;
  onQuestionChange: (value: string) => void;
  onIncludeSelectionChange: (value: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onStop: () => void;
}

export function ChatView({
  conversation,
  step,
  memory,
  compacting,
  cacheUsage,
  question,
  includeSelection,
  selectionSummary,
  busy,
  questionRef,
  onQuestionChange,
  onIncludeSelectionChange,
  onSubmit,
  onStop
}: ChatViewProps) {
  const messagesRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const messages = conversation?.messages ?? [];
  const toolResults = useMemo(() => collectToolResults(messages), [messages]);
  const canInterrupt = busy && Boolean(question.trim());
  const showStop = busy && !canInterrupt;
  const sendLabel = showStop ? "回答を停止" : canInterrupt ? "割り込み送信" : "送信";

  useEffect(() => {
    const panel = messagesRef.current?.parentElement;
    if (panel) panel.scrollTop = panel.scrollHeight;
  }, [conversation, step, memory]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <>
      <div id="messages" aria-live="polite" ref={messagesRef}>
        {messages.map((message, index) => (
          <MessageView message={message} toolResults={toolResults} key={index} />
        ))}
        {step && <StepContent step={step} placeholder="回答を生成中…" />}
        {compacting && <div className="memory-update-label">会話を圧縮中…</div>}
        {memory && <MemoryUpdateView progress={memory} />}
      </div>
      <form className="bottom-bar" onSubmit={onSubmit}>
        {selectionSummary && (
          <label className="selection-option">
            <input
              type="checkbox"
              checked={includeSelection}
              disabled={busy}
              onChange={(event) => onIncludeSelectionChange(event.target.checked)}
            />
            {`${selectionSummary}を含める`}
          </label>
        )}
        <div className="composer-row">
          <div className="model-menu-anchor">
            <button
              className="round"
              type="button"
              aria-label="モデルと思考量"
              title="モデルと思考量"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Icon name="tune" />
            </button>
            {menuOpen && <ModelMenu onClose={closeMenu} />}
          </div>
          <textarea
            id="question"
            placeholder="このページについて質問"
            required
            ref={questionRef}
            value={question}
            onChange={(event) => onQuestionChange(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className="round accent-action"
            type={showStop ? "button" : "submit"}
            aria-label={sendLabel}
            title={sendLabel}
            disabled={!busy && !question.trim()}
            onClick={showStop ? onStop : undefined}
          >
            <Icon name={showStop ? "stop" : "send"} />
          </button>
        </div>
        {cacheUsage && <CacheRate usage={cacheUsage} />}
      </form>
    </>
  );
}

function MessageView({
  message,
  toolResults
}: {
  message: ModelMessage;
  toolResults: Map<string, ToolResultPart["output"]>;
}) {
  if (message.role === "system" || message.role === "tool") return null;
  if (message.role === "user") {
    const { kind } = getMeta(message);
    if (kind === "browser_context" || kind === "compaction" || kind === "memory_update") return null;
    const content = getMessageText(message);
    if (kind === "selection_context") return <SelectionMessage content={content} />;
    if (kind === "runtime_error") return <div className="message error">{`エラー: ${content}`}</div>;
    if (kind === "runtime_cancelled") return <div className="message error">{content}</div>;
    return <div className="message user">{content}</div>;
  }

  const parts = typeof message.content === "string"
    ? [{ type: "text" as const, text: message.content }]
    : message.content;
  return (
    <Fragment>
      {parts.map((part, index) => {
        if (part.type === "reasoning") return <Reasoning key={index} content={part.text} />;
        if (part.type === "tool-call") {
          return (
            <StoredToolCall
              key={part.toolCallId}
              name={part.toolName}
              argumentsJson={JSON.stringify(part.input)}
              output={toolResults.get(part.toolCallId)}
            />
          );
        }
        if (part.type === "text" && part.text) return <MarkdownMessage key={index} content={part.text} />;
        return null;
      })}
    </Fragment>
  );
}

function StepContent({ step, placeholder }: { step: StepView; placeholder?: string }) {
  const empty = !step.reasoning && !step.text && step.tools.length === 0;
  return (
    <>
      {step.reasoning && <Reasoning content={step.reasoning} />}
      {step.text ? <MarkdownMessage content={step.text} /> : empty && placeholder && <MarkdownMessage content={placeholder} />}
      {step.tools.map((tool) => <PendingToolCall key={tool.id} tool={tool} />)}
    </>
  );
}

// 質問の直前に送ったページの選択範囲。ユーザー吹き出しと同じ配置で枠線だけにする
function SelectionMessage({ content }: { content: string }) {
  const { text, mediaCount } = useMemo(() => parseSelectionContext(content), [content]);
  return (
    <div className="message user selection">
      {text}
      {mediaCount > 0 && <div className="selection-media">{`メディア${mediaCount}件`}</div>}
    </div>
  );
}

function MarkdownMessage({ content }: { content: string }) {
  // Streaming deltas arrive faster than markdown + highlighting can render; deferring lets React skip stale ones.
  const deferredContent = useDeferredValue(content);
  const html = useMemo(() => markdown.parse(deferredContent, { async: false }), [deferredContent]);
  return (
    <div
      className="message assistant markdown"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// 回答完了後に走るメモリ保守の進捗。会話には保存されず、次の質問や会話切替で消える
function MemoryUpdateView({ progress }: { progress: MemoryProgress }) {
  return (
    <div className="memory-update">
      <div className="memory-update-label">{progress.done ? "メモリ更新" : "メモリ更新中…"}</div>
      {progress.reasoning && <Reasoning content={progress.reasoning} />}
      {progress.tools.map((tool) => <PendingToolCall key={tool.id} tool={tool} />)}
      {progress.text && <div className="message memory-update-note">{progress.text}</div>}
      {progress.error && <div className="message error">{`エラー: ${progress.error}`}</div>}
      {progress.cacheUsage && <CacheRate usage={progress.cacheUsage} />}
    </div>
  );
}

function Reasoning({ content }: { content: string }) {
  return (
    <details className="reasoning">
      <summary><Icon name="expand" />思考</summary>
      <pre>{content}</pre>
    </details>
  );
}

function StoredToolCall({
  name,
  argumentsJson,
  output
}: {
  name: string;
  argumentsJson: string;
  output: ToolResultPart["output"] | undefined;
}) {
  return (
    <details className="tool-call">
      <summary><Icon name="expand" />{`${name} ${formatJson(argumentsJson)}`}</summary>
      <pre>{output === undefined ? "実行中…" : formatStoredToolOutput(output)}</pre>
    </details>
  );
}

function PendingToolCall({ tool }: { tool: ToolDetail }) {
  return (
    <details className="tool-call">
      <summary><Icon name="expand" />{`${tool.name} ${formatJson(tool.args)}`}</summary>
      <pre>{tool.output ? formatPendingToolOutput(tool.output) : "実行中…"}</pre>
    </details>
  );
}

function collectToolResults(messages: ModelMessage[]): Map<string, ToolResultPart["output"]> {
  const results = new Map<string, ToolResultPart["output"]>();
  for (const message of messages) {
    if (message.role !== "tool") continue;
    for (const result of getToolResults(message)) results.set(result.toolCallId, result.output);
  }
  return results;
}

function CacheRate({ usage }: { usage: CacheUsage }) {
  const inputTokens = usage.hitTokens + usage.missTokens;
  if (inputTokens === 0) return null;

  const rate = usage.hitTokens / inputTokens * 100;
  return (
    <div className="cache-rate">
      {`キャッシュ率: ${rate.toFixed(1)}%（${usage.hitTokens.toLocaleString()} / ${inputTokens.toLocaleString()} tokens）`}
    </div>
  );
}

function formatStoredToolOutput(output: ToolResultPart["output"]): string {
  if (output.type === "text" || output.type === "error-text") return formatJson(output.value, 2);
  if (output.type === "json" || output.type === "error-json") {
    return JSON.stringify(output.value, null, 2);
  }
  if (output.type === "execution-denied") return output.reason ?? "実行されませんでした。";
  return "画像またはファイル";
}

function formatPendingToolOutput(output: ToolOutput): string {
  if (output.type === "error") return `エラー:\n${output.error}`;
  if (output.type === "image") {
    return `画像: ${output.mimeType} (${formatBytes(output.byteLength)})`;
  }
  return formatJson(output.content, 2);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function formatJson(value: string, indent = 0): string {
  try {
    return JSON.stringify(JSON.parse(value), null, indent);
  } catch {
    return value;
  }
}
