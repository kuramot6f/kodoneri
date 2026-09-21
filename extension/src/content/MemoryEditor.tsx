import { isTouchDevice } from "./device";
import { Trans, useLingui } from "@lingui/react/macro";
import { MEMORY_CONTENT_MAX_LENGTH, MEMORY_TITLE_MAX_LENGTH } from "../shared/memory";
import type { Memory } from "../shared/memory";

interface MemoryEditorProps {
  memory: Memory;
  onChange: (memory: Memory) => void;
}

export function MemoryEditor({ memory, onChange }: MemoryEditorProps) {
  const { t } = useLingui();
  return (
    <div id="memory-editor">
      <label className="memory-title-row">
        <span className="memory-title-label"><Trans>Title:</Trans></span>
        <input
          className="memory-title"
          type="text"
          placeholder={t`Title`}
          aria-label={t`Title`}
          maxLength={MEMORY_TITLE_MAX_LENGTH}
          value={memory.title}
          onChange={(event) => onChange({ ...memory, title: event.target.value })}
        />
      </label>
      <textarea
        className="memory-content"
        placeholder={t`Content`}
        aria-label={t`Content`}
        autoFocus={!isTouchDevice()}
        maxLength={MEMORY_CONTENT_MAX_LENGTH}
        value={memory.content}
        onChange={(event) => onChange({ ...memory, content: event.target.value })}
      />
      <div className="memory-count">{`${memory.content.length} / ${MEMORY_CONTENT_MAX_LENGTH}`}</div>
    </div>
  );
}
