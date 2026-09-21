import { useState } from "react";
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
            aria-label="新規メモリ"
            title={memories.length >= MEMORY_MAX_COUNT ? `メモリは${MEMORY_MAX_COUNT}件まで` : "新規メモリ"}
            onClick={onCreate}
            disabled={memories.length >= MEMORY_MAX_COUNT}
          >
            <Icon name="add" />
            <span>新規メモリ</span>
          </button>
        </div>
        {memories.length === 0 ? (
          <p className="history-empty">保存されたメモリはありません。</p>
        ) : entries.length === 0 ? (
          <p className="history-empty">一致するメモリはありません。</p>
        ) : entries.map(({ memory, preview }) => {
          const title = memory.title.trim() || "無題";
          return (
            <div className="history-row" key={memory.id}>
              <button className="history-item" type="button" title="このメモリを編集" onClick={() => onSelect(memory)}>
                <span className="history-title"><Highlight text={title} query={normalizedQuery} /></span>
                {preview.trim() && <span className="history-preview"><Highlight text={preview} query={normalizedQuery} /></span>}
              </button>
              <button
                className={memory.favorite ? "icon-button favorite" : "icon-button"}
                type="button"
                aria-label={memory.favorite ? "お気に入りを解除" : "お気に入りに追加"}
                title={memory.favorite ? "お気に入りを解除" : "お気に入りに追加(AIは編集できなくなる)"}
                aria-pressed={memory.favorite}
                onClick={() => onToggleFavorite(memory)}
              >
                <Icon name={memory.favorite ? "star" : "starBorder"} />
              </button>
              <button className="icon-button" type="button" aria-label="このメモリを削除" title="このメモリを削除" onClick={() => onDelete(memory)}>
                <Icon name="delete" />
              </button>
            </div>
          );
        })}
      </div>
      {memories.length > 0 && <SearchBar value={query} placeholder="メモリを検索" onChange={setQuery} />}
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
