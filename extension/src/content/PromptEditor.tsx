import { isTouchDevice } from "./device";
import { useLingui } from "@lingui/react/macro";
import { DEFAULT_PROMPTS } from "../shared/prompts";
import type { Prompt } from "../shared/prompts";

interface PromptEditorProps {
  prompt: Prompt;
  onChange: (prompt: Prompt) => void;
}

/** Clearing the text resets the prompt to its default when the editor closes. */
export function PromptEditor({ prompt, onChange }: PromptEditorProps) {
  const { t } = useLingui();
  return (
    <div id="memory-editor">
      <textarea
        className="memory-content"
        placeholder={DEFAULT_PROMPTS[prompt.id]}
        aria-label={t`Prompt`}
        autoFocus={!isTouchDevice()}
        value={prompt.content}
        onChange={(event) => onChange({ ...prompt, content: event.target.value })}
      />
    </div>
  );
}
