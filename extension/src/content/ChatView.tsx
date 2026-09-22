import { Fragment, useCallback, useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, RefObject } from "react";
import { plural, t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
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
import type { MemoryProgress, SelectionContext, StepView, ToolDetail } from "../shared/protocol";
import { Icon } from "./Icon";
import { ModelMenu } from "./ModelMenu";

/** Within this distance of the bottom, new content keeps the view pinned to the bottom. */
const STICK_DISTANCE_PX = 48;

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
  const { t } = useLingui();
  const messagesRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const messages = conversation?.messages ?? [];
  const toolResults = useMemo(() => collectToolResults(messages), [messages]);
  const canInterrupt = busy && Boolean(question.trim());
  const showStop = busy && !canInterrupt;
  const sendLabel = showStop ? t`Stop response` : canInterrupt ? t`Send and interrupt` : t`Send`;

  // Follows new content only while the reader is at the bottom; scrolling up to read stops it.
  useLayoutEffect(() => {
    const scroller = messagesRef.current?.parentElement;
    if (!scroller) return;
    const onScroll = () => {
      stickRef.current = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < STICK_DISTANCE_PX;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    const scroller = messagesRef.current?.parentElement;
    if (scroller && stickRef.current) scroller.scrollTop = scroller.scrollHeight;
  }, [conversation, step, memory]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    stickRef.current = true;
    onSubmit(event);
  };

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
        {step && <StepContent step={step} placeholder={t`Generating response…`} />}
        {compacting && <div className="memory-update-label"><Trans>Compacting conversation…</Trans></div>}
        {memory && <MemoryUpdateView progress={memory} />}
      </div>
      <form className="bottom-bar" onSubmit={submit}>
        {selectionSummary && (
          <label className="selection-option">
            <input
              type="checkbox"
              checked={includeSelection}
              disabled={busy}
              onChange={(event) => onIncludeSelectionChange(event.target.checked)}
            />
            <Trans>Include {selectionSummary}</Trans>
          </label>
        )}
        <div className="composer-row">
          <div className="model-menu-anchor">
            <button
              className="round"
              type="button"
              aria-label={t`Model and reasoning effort`}
              title={t`Model and reasoning effort`}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Icon name="tune" />
            </button>
            {menuOpen && <ModelMenu onClose={closeMenu} />}
          </div>
          <textarea
            id="question"
            placeholder={t`Ask about this page`}
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
            <Icon name={showStop ? "stop" : "send"} tone="inverse" />
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
    if (kind === "selection_context") {
      const { selection } = getMeta(message);
      return selection ? <SelectionMessage selection={selection} /> : null;
    }
    const content = getMessageText(message);
    if (kind === "runtime_error") return <div className="message error"><Trans>Error: {content}</Trans></div>;
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
function SelectionMessage({ selection }: { selection: SelectionContext }) {
  const mediaCount = selection.media.length;
  return (
    <div className="message user selection">
      {selection.text}
      {mediaCount > 0 && <div className="selection-media">{plural(mediaCount, { one: "# media item", other: "# media items" })}</div>}
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
      <div className="memory-update-label">{progress.done ? t`Memory updated` : t`Updating memory…`}</div>
      {progress.reasoning && <Reasoning content={progress.reasoning} />}
      {progress.tools.map((tool) => <PendingToolCall key={tool.id} tool={tool} />)}
      {progress.text && <div className="message memory-update-note">{progress.text}</div>}
      {progress.error && <div className="message error">{t`Error: ${progress.error}`}</div>}
      {progress.cacheUsage && <CacheRate usage={progress.cacheUsage} />}
    </div>
  );
}

function Reasoning({ content }: { content: string }) {
  return (
    <details className="reasoning">
      <summary><Icon name="expand" /><Trans>Reasoning</Trans></summary>
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
      <pre>{output === undefined ? t`Running…` : formatStoredToolOutput(output)}</pre>
    </details>
  );
}

function PendingToolCall({ tool }: { tool: ToolDetail }) {
  return (
    <details className="tool-call">
      <summary><Icon name="expand" />{`${tool.name} ${formatJson(tool.args)}`}</summary>
      <pre>{tool.result === null ? t`Running…` : tool.error ? t`Error:\n${tool.result}` : tool.result}</pre>
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
  const { i18n, t } = useLingui();
  const inputTokens = usage.hitTokens + usage.missTokens;
  if (inputTokens === 0) return null;

  const rate = usage.hitTokens / inputTokens * 100;
  return (
    <div className="cache-rate">
      {t`Cache hit rate: ${rate.toFixed(1)}% (${usage.hitTokens.toLocaleString(i18n.locale)} / ${inputTokens.toLocaleString(i18n.locale)} tokens)`}
    </div>
  );
}

function formatStoredToolOutput(output: ToolResultPart["output"]): string {
  if (output.type === "text" || output.type === "error-text") return formatJson(output.value, 2);
  if (output.type === "json" || output.type === "error-json") {
    return JSON.stringify(output.value, null, 2);
  }
  if (output.type === "execution-denied") return output.reason ?? t`Execution was denied.`;
  return t`Image or file`;
}

function formatJson(value: string, indent = 0): string {
  try {
    return JSON.stringify(JSON.parse(value), null, indent);
  } catch {
    return value;
  }
}
