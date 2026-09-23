import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Icon } from "./Icon";
import { findSnippet, Highlight, normalizeQuery, SearchBar } from "./search";
import { MEMORY_MAX_COUNT } from "../shared/memory";
import type { Memory } from "../shared/memory";

interface MemoryListViewProps {
  memories: Memory[];
  onCreate: () => void;
  onSelect: (memory: Memory) => void;
  onToggleFavorite: (memory: Memory) => void;
  onDelete: (memory: Memory) => void;
}

interface MemoryEntry {
  memory: Memory;
  preview: string;
}

export function MemoryListView({ memories, onCreate, onSelect, onToggleFavorite, onDelete }: MemoryListViewProps) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const normalizedQuery = normalizeQuery(query);
  const entries = normalizedQuery
    ? searchMemories(memories, normalizedQuery)
    : memories.map((memory) => ({ memory, preview: memory.content }));

  return (
    <>
      <div id="history-view">
        <div className="add-row">
          <button
            className="pill add-memory"
            type="button"
            aria-label={t`New memory`}
            title={memories.length >= MEMORY_MAX_COUNT ? t`You can save up to ${MEMORY_MAX_COUNT} memories` : t`New memory`}
            onClick={onCreate}
            disabled={memories.length >= MEMORY_MAX_COUNT}
          >
            <Icon name="add" />
            <span><Trans>New memory</Trans></span>
          </button>
        </div>
        {memories.length === 0 ? (
          <p className="history-empty"><Trans>No saved memories.</Trans></p>
        ) : entries.length === 0 ? (
          <p className="history-empty"><Trans>No matching memories.</Trans></p>
        ) : entries.map(({ memory, preview }) => {
          const title = memory.title.trim() || t`Untitled`;
          return (
            <div className="history-row" key={memory.id}>
              <button className="history-item" type="button" title={t`Edit this memory`} onClick={() => onSelect(memory)}>
                <span className="history-title"><Highlight text={title} query={normalizedQuery} /></span>
                {preview.trim() && <span className="history-preview"><Highlight text={preview} query={normalizedQuery} /></span>}
              </button>
              <button
                className={memory.favorite ? "icon-button favorite" : "icon-button"}
                type="button"
                aria-label={memory.favorite ? t`Remove from favorites` : t`Add to favorites`}
                title={memory.favorite ? t`Remove from favorites` : t`Add to favorites (the AI will no longer be able to edit it)`}
                aria-pressed={memory.favorite}
                onClick={() => onToggleFavorite(memory)}
              >
                <Icon name={memory.favorite ? "star" : "starBorder"} tone={memory.favorite ? "default" : "secondary"} />
              </button>
              <button className="icon-button" type="button" aria-label={t`Delete this memory`} title={t`Delete this memory`} onClick={() => onDelete(memory)}>
                <Icon name="delete" tone="secondary" />
              </button>
            </div>
          );
        })}
      </div>
      <SearchBar searchable={memories.length > 0} value={query} placeholder={t`Search memories`} onChange={setQuery} />
    </>
  );
}

// 本文が一致すれば一致箇所のスニペット、タイトルだけ一致すれば本文の先頭
function searchMemories(memories: Memory[], query: string): MemoryEntry[] {
  return memories.flatMap((memory) => {
    const preview = findSnippet([memory.content], query)
      ?? (memory.title.toLowerCase().includes(query) ? memory.content : null);
    return preview === null ? [] : [{ memory, preview }];
  });
}
