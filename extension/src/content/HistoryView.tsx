import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { htmlToPlainText } from "./html";
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
  const { i18n, t } = useLingui();
  const [query, setQuery] = useState("");
  const viewRef = useRef<HTMLDivElement>(null);
  const normalizedQuery = normalizeQuery(query);
  const entries = useMemo(() => normalizedQuery
    ? searchConversations(conversations.map(indexConversation), normalizedQuery)
    : conversations.map(toDefaultEntry), [conversations, normalizedQuery]);
  const groups = groupEntriesByDate(entries, i18n.locale, t`Today`, t`Yesterday`);

  useLayoutEffect(() => {
    const panel = viewRef.current?.parentElement;
    if (panel) panel.scrollTop = 0;
  }, []);

  return (
    <>
      <div id="history-view" ref={viewRef}>
        {conversations.length === 0 ? (
          <p className="history-empty"><Trans>No saved conversations.</Trans></p>
        ) : entries.length === 0 ? (
          <p className="history-empty"><Trans>No matching conversations.</Trans></p>
        ) : groups.map((group) => (
          <section className="history-group" key={group.dateKey}>
            <h2>{group.label}</h2>
            {group.entries.map(({ conversation, preview }) => (
              <div className="history-row" key={conversation.id}>
                <button className="history-item" type="button" title={t`Open this conversation`} onClick={() => onSelect(conversation)}>
                  <span className="history-title"><Highlight text={conversation.title} query={normalizedQuery} /></span>
                  {preview && <span className="history-preview"><Highlight text={preview} query={normalizedQuery} /></span>}
                </button>
                <button className="icon-button" type="button" aria-label={t`Delete this conversation`} title={t`Delete this conversation`} onClick={() => onDelete(conversation)}>
                  <Icon name="delete" />
                </button>
              </div>
            ))}
          </section>
        ))}
      </div>
      <SearchBar searchable={conversations.length > 0} value={query} placeholder={t`Search history`} onChange={setQuery} />
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
  if (message.role === "assistant") return htmlToPlainText(getMessageText(message));
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

function groupEntriesByDate(entries: HistoryEntry[], locale: string, todayLabel: string, yesterdayLabel: string): HistoryGroup[] {
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
        ? todayLabel
        : dateKey === toDateKey(yesterday)
          ? yesterdayLabel
          : date.toLocaleDateString(locale, {
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
    const content = htmlToPlainText(getMessageText(message));
    if (content) return content;
  }
  return "";
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}
