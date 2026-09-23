import { Fragment, useCallback, useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, RefObject } from "react";
import { plural, t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type {
  CacheUsage,
  Conversation,
  ModelMessage,
  ToolResultPart
} from "../shared/conversation";
import { getMeta, getMessageText, getToolResults } from "../shared/conversation";
import type { MemoryProgress, SelectionContext } from "../shared/protocol";
import { Icon } from "./Icon";
import { markdown } from "./markdown";
import { ModelMenu } from "./ModelMenu";

/** Within this distance of the bottom, new content keeps the view pinned to the bottom. */
const STICK_DISTANCE_PX = 48;

interface ChatViewProps {
  conversation: Conversation | null;
  /** The step currently streaming; finished steps are already in the conversation. */
  step: ModelMessage[] | null;
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
        <Messages messages={step ? [...messages, ...step] : messages} />
        {step?.length === 0 && <MarkdownMessage content={t`Generating response…`} />}
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

function Messages({ messages }: { messages: ModelMessage[] }) {
  const toolResults = useMemo(() => collectToolResults(messages), [messages]);
  return messages.map((message, index) => <MessageView message={message} toolResults={toolResults} key={index} />);
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
    if (kind === "runtime_context" || kind === "memory_context" || kind === "browser_context" || kind === "compaction" || kind === "memory_update") return null;
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
            <ToolCall
              key={part.toolCallId}
              name={part.toolName}
              input={part.input}
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
// 普段は結果だけを見せ、開くと reasoning・tool call・最後の一文が見える
function MemoryUpdateView({ progress }: { progress: MemoryProgress }) {
  const label = !progress.done
    ? t`Updating memory…`
    : progress.error
      ? t`Memory update failed`
      : hasMemoryWrite(progress.messages) ? t`Memory updated` : t`No memory changes`;
  return (
    <details className="memory-update">
      <summary><Icon name="expand" />{label}</summary>
      <div className="memory-update-log">
        <Messages messages={progress.messages} />
        {progress.error && <div className="message error">{t`Error: ${progress.error}`}</div>}
        {progress.cacheUsage && <CacheRate usage={progress.cacheUsage} />}
      </div>
    </details>
  );
}

const MEMORY_WRITE_TOOLS = new Set(["patch", "rename", "new", "delete"]);

function hasMemoryWrite(messages: ModelMessage[]): boolean {
  return messages.some((message) => message.role === "tool" && getToolResults(message).some((result) =>
    MEMORY_WRITE_TOOLS.has(result.toolName) && result.output.type !== "error-text" && result.output.type !== "error-json"
  ));
}

function Reasoning({ content }: { content: string }) {
  return (
    <details className="reasoning">
      <summary><Icon name="expand" /><Trans>Reasoning</Trans></summary>
      <pre>{content}</pre>
    </details>
  );
}

function ToolCall({
  name,
  input,
  output
}: {
  name: string;
  input: unknown;
  output: ToolResultPart["output"] | undefined;
}) {
  return (
    <details className="tool-call">
      <summary><Icon name="expand" />{`${name} ${JSON.stringify(input)}`}</summary>
      <pre>{output === undefined ? t`Running…` : formatToolOutput(output)}</pre>
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

function formatToolOutput(output: ToolResultPart["output"]): string {
  if (output.type === "text" || output.type === "error-text") return formatJson(output.value);
  if (output.type === "json" || output.type === "error-json") {
    return JSON.stringify(output.value, null, 2);
  }
  if (output.type === "execution-denied") return output.reason ?? t`Execution was denied.`;
  return t`Image or file`;
}

function formatJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
