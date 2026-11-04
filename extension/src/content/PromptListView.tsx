import { useLingui } from "@lingui/react/macro";
import { Icon } from "./Icon";
import type { Prompt, PromptId } from "../shared/prompts";

interface PromptListViewProps {
  prompts: Prompt[];
  onSelect: (prompt: Prompt) => void;
  onReset: (prompt: Prompt) => void;
}

export function usePromptLabels(): Record<PromptId, string> {
  const { t } = useLingui();
  return {
    system: t`System prompt`,
    compaction: t`Conversation compaction`,
    memory: t`Memory maintenance`,
    memory_update: t`Memory update request`,
    title: t`Title generation`
  };
}

export function PromptListView({ prompts, onSelect, onReset }: PromptListViewProps) {
  const { t } = useLingui();
  const labels = usePromptLabels();
  return (
    <div id="history-view">
      {prompts.map((prompt) => {
        const label = labels[prompt.id];
        return (
          <div className="history-row" key={prompt.id}>
            <button className="history-item" type="button" title={t`Edit this prompt`} onClick={() => onSelect(prompt)}>
              <span className="history-title">{prompt.customized ? t`${label} (edited)` : label}</span>
              <span className="history-preview">{prompt.content}</span>
            </button>
            {prompt.customized && (
              <button className="icon-button" type="button" aria-label={t`Reset to default`} title={t`Reset to default`} onClick={() => onReset(prompt)}>
                <Icon name="delete" tone="secondary" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
