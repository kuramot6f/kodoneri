import { useState } from "react";
import type { ReactNode } from "react";
import { isTouchDevice } from "./device";
import { Icon } from "./Icon";

interface SearchBarProps {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}

/** Sticky bottom search button shared by the chat history and memory lists; the field appears only while open. */
export function SearchBar({ value, placeholder, onChange }: SearchBarProps) {
  const [open, setOpen] = useState(false);
  const label = open ? "検索を閉じる" : placeholder;
  const toggle = () => {
    if (open) onChange("");
    setOpen(!open);
  };
  return (
    <div className="bottom-bar">
      <div className="search-row">
        <button className="round" type="button" aria-label={label} title={label} aria-expanded={open} onClick={toggle}>
          <Icon name={open ? "close" : "search"} />
        </button>
        {open && (
          <input
            className="search-input"
            type="search"
            placeholder={placeholder}
            aria-label={placeholder}
            autoFocus={!isTouchDevice()}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
      </div>
    </div>
  );
}

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

// 検索語と一致した部分を強調表示する
export function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  if (!query) return text;

  const parts = [];
  const lowerText = text.toLowerCase();
  let cursor = 0;

  for (let index = lowerText.indexOf(query); index >= 0; index = lowerText.indexOf(query, cursor)) {
    parts.push(text.slice(cursor, index), <mark key={index}>{text.slice(index, index + query.length)}</mark>);
    cursor = index + query.length;
  }
  parts.push(text.slice(cursor));

  return <>{parts}</>;
}

// 本文が一致した場合は一致箇所の少し手前から切り出してプレビューにする
export function findSnippet(texts: string[], query: string): string | null {
  for (const text of texts) {
    const index = text.toLowerCase().indexOf(query);
    if (index < 0) continue;
    const start = Math.max(0, index - 20);
    return (start > 0 ? "…" : "") + text.slice(start);
  }

  return null;
}
