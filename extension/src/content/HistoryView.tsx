import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { lexer } from "marked";
import type { Token } from "marked";
import { Icon } from "./Icon";
import { findSnippet, Highlight, normalizeQuery, SearchBar } from "./search";
import type { Conversation, ModelMessage } from "../shared/conversation";
import { getMeta, getMessageText } from "../shared/conversation";

interface HistoryViewProps {
  conversations: Conversation[];
  onSelect: (conversation: Conversation) => void;
  onDelete: (conversation: Conversation) => void;
}

export function HistoryView({ conversations, onSelect, onDelete }: HistoryViewProps) {
  const [query, setQuery] = useState("");
  const viewRef = useRef<HTMLDivElement>(null);
  const normalizedQuery = normalizeQuery(query);
  const entries = useMemo(() => normalizedQuery
    ? searchConversations(conversations.map(indexConversation), normalizedQuery)
    : conversations.map(toDefaultEntry), [conversations, normalizedQuery]);
  const groups = groupEntriesByDate(entries);

  useLayoutEffect(() => {
    const panel = viewRef.current?.parentElement;
    if (panel) panel.scrollTop = 0;
  }, []);

  return (
    <>
      <div id="history-view" ref={viewRef}>
        {conversations.length === 0 ? (
          <p className="history-empty">保存された会話はありません。</p>
        ) : entries.length === 0 ? (
          <p className="history-empty">一致する会話はありません。</p>
        ) : groups.map((group) => (
          <section className="history-group" key={group.dateKey}>
            <h2>{group.label}</h2>
            {group.entries.map(({ conversation, preview }) => (
              <div className="history-row" key={conversation.id}>
                <button className="history-item" type="button" title="この会話を開く" onClick={() => onSelect(conversation)}>
                  <span className="history-title"><Highlight text={conversation.title} query={normalizedQuery} /></span>
                  {preview && <span className="history-preview"><Highlight text={preview} query={normalizedQuery} /></span>}
                </button>
                <button className="icon-button" type="button" aria-label="この会話を削除" title="この会話を削除" onClick={() => onDelete(conversation)}>
                  <Icon name="delete" />
                </button>
              </div>
            ))}
          </section>
        ))}
      </div>
      {conversations.length > 0 && <SearchBar value={query} placeholder="履歴を検索" onChange={setQuery} />}
    </>
  );
}

// 会話ごとに検索対象のプレーンテキストを保持する
interface IndexedConversation {
  conversation: Conversation;
  title: string;
  texts: string[];
  lastAnswer: string;
}

interface HistoryEntry {
  conversation: Conversation;
  preview: string;
}

function indexConversation(conversation: Conversation): IndexedConversation {
  const texts = conversation.messages.map(getSearchableText).filter(Boolean);
  return {
    conversation,
    title: conversation.title.toLowerCase(),
    texts,
    lastAnswer: getLastAnswer(conversation)
  };
}

// 検索対象はユーザーの質問とアシスタントの回答本文のみ。選択範囲コンテキストやツール結果は除外する
function getSearchableText(message: ModelMessage): string {
  if (message.role === "user" && !getMeta(message).kind) return getMessageText(message);
  if (message.role === "assistant") return markdownToPlainText(getMessageText(message));
  return "";
}

function toDefaultEntry(conversation: Conversation): HistoryEntry {
  return { conversation, preview: getLastAnswer(conversation) };
}

function searchConversations(index: IndexedConversation[], query: string): HistoryEntry[] {
  const entries: HistoryEntry[] = [];

  for (const item of index) {
    const preview = findPreview(item, query);
    if (preview !== null) entries.push({ conversation: item.conversation, preview });
  }

  return entries;
}

// 本文が一致すれば一致箇所のスニペット、タイトルだけ一致すれば通常のプレビュー
function findPreview({ title, texts, lastAnswer }: IndexedConversation, query: string): string | null {
  return findSnippet(texts, query) ?? (title.includes(query) ? lastAnswer : null);
}

interface HistoryGroup {
  dateKey: string;
  label: string;
  entries: HistoryEntry[];
}

function groupEntriesByDate(entries: HistoryEntry[]): HistoryGroup[] {
  const today = startOfDay(new Date());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const groups = new Map<string, HistoryGroup>();

  for (const entry of entries) {
    const date = new Date(entry.conversation.updatedAt);
    const dateKey = toDateKey(date);
    const existing = groups.get(dateKey);

    if (existing) {
      existing.entries.push(entry);
      continue;
    }

    groups.set(dateKey, {
      dateKey,
      label: dateKey === toDateKey(today)
        ? "Today"
        : dateKey === toDateKey(yesterday)
          ? "Yesterday"
          : date.toLocaleDateString("ja-JP", {
              year: "numeric",
              month: "long",
              day: "numeric"
            }),
      entries: [entry]
    });
  }

  return [...groups.values()];
}

function getLastAnswer(conversation: Conversation): string {
  for (const message of conversation.messages.toReversed()) {
    if (message.role !== "assistant") continue;
    const content = markdownToPlainText(getMessageText(message));
    if (content) return content;
  }
  return "";
}

function markdownToPlainText(markdown: string): string {
  return tokensToPlainText(lexer(markdown)).replace(/\s+/g, " ").trim();
}

function tokensToPlainText(tokens: Token[]): string {
  return tokens.map(tokenToPlainText).filter(Boolean).join(" ");
}

function tokenToPlainText(token: Token): string {
  switch (token.type) {
    case "blockquote":
    case "del":
    case "em":
    case "heading":
    case "link":
    case "list_item":
    case "paragraph":
    case "strong":
      return tokensToPlainText(token.tokens ?? []);
    case "list":
      return token.items.map(tokenToPlainText).join(" ");
    case "table":
      return [token.header, ...token.rows]
        .flat()
        .map((cell) => tokensToPlainText(cell.tokens))
        .join(" ");
    case "text":
      return token.tokens ? tokensToPlainText(token.tokens) : token.text;
    case "code":
    case "codespan":
    case "escape":
    case "image":
      return token.text;
    case "br":
    case "checkbox":
    case "hr":
    case "space":
      return " ";
    case "def":
    case "html":
      return "";
    default:
      return "";
  }
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}
