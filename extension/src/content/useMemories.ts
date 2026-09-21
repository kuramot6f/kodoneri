import { useEffect, useRef, useState } from "react";
import {
  createMemory,
  deleteMemory,
  isEmptyMemory,
  loadMemories,
  saveMemory
} from "../shared/memory";
import type { Memory } from "../shared/memory";

const SAVE_DELAY_MS = 400;

/** Memory list plus the one being edited. Edits are saved after a short pause and flushed on close. */
export function useMemories() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [editing, setEditing] = useState<Memory | null>(null);
  const dirtyRef = useRef<Memory | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const takeDirty = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const memory = dirtyRef.current;
    dirtyRef.current = null;
    return memory;
  };

  const flush = async () => {
    const memory = takeDirty();
    if (memory) await saveMemory(memory);
  };

  useEffect(() => () => void flush(), []);

  const refresh = async () => {
    setMemories(await loadMemories());
  };

  const open = (memory: Memory) => setEditing(memory);

  // A new memory is not stored until something is typed, so an untouched one leaves no record.
  const create = () => setEditing(createMemory());

  const update = (memory: Memory) => {
    const next = { ...memory, updatedAt: Date.now() };
    setEditing(next);
    dirtyRef.current = next;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  };

  // The list is updated in place first; storage catches up in the background and a failure reloads it.
  const applyLocally = (update: (current: Memory[]) => Memory[], persist: () => Promise<void>) => {
    setMemories(update);
    return persist().catch(refresh);
  };

  // Favorites are excluded from the model's automatic updates; toggling is not a content edit.
  const toggleFavorite = (memory: Memory) => {
    const toggled = { ...memory, favorite: !memory.favorite };
    return applyLocally(
      (current) => current.map((item) => (item.id === memory.id ? toggled : item)),
      () => saveMemory(toggled)
    );
  };

  const remove = (memory: Memory) => applyLocally(
    (current) => current.filter(({ id }) => id !== memory.id),
    () => deleteMemory(memory.id)
  );

  const close = () => {
    if (!editing) return Promise.resolve();
    const closed = editing;
    setEditing(null);
    if (isEmptyMemory(closed)) {
      takeDirty();
      return applyLocally(
        (current) => current.filter(({ id }) => id !== closed.id),
        () => deleteMemory(closed.id)
      );
    }
    return applyLocally(
      (current) => [closed, ...current.filter(({ id }) => id !== closed.id)]
        .sort((a, b) => b.updatedAt - a.updatedAt),
      flush
    );
  };

  return { memories, editing, refresh, open, create, update, toggleFavorite, remove, close };
}
