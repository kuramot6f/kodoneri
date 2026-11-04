import { useEffect, useRef, useState } from "react";
import { loadPrompts, resetPrompt, savePrompt } from "../shared/prompts";
import type { Prompt } from "../shared/prompts";

const SAVE_DELAY_MS = 400;

/** Prompt list plus the one being edited. Edits are saved after a short pause and flushed on close. */
export function usePrompts() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [editing, setEditing] = useState<Prompt | null>(null);
  const dirtyRef = useRef<Prompt | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const prompt = dirtyRef.current;
    dirtyRef.current = null;
    if (prompt) await savePrompt(prompt.id, prompt.content);
  };

  useEffect(() => () => void flush(), []);

  const refresh = async () => {
    setPrompts(await loadPrompts());
  };

  const open = (prompt: Prompt) => setEditing(prompt);

  const update = (prompt: Prompt) => {
    setEditing(prompt);
    dirtyRef.current = prompt;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  };

  const reset = async (prompt: Prompt) => {
    await resetPrompt(prompt.id);
    await refresh();
  };

  // Saving the default or an empty text resets the prompt, so the list is reloaded rather than patched.
  const close = async () => {
    setEditing(null);
    await flush();
    await refresh();
  };

  return { prompts, editing, refresh, open, update, reset, close };
}
