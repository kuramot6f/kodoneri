import { errorData } from "../shared/debugLog";
import { MEMORY_PREFIX } from "../shared/memory";
import { CONVERSATION_PREFIX } from "../shared/store";
import { debugEvent } from "./debug";

/** Values are fetched a few at a time so no native message carries the whole history. */
const GET_BATCH = 10;

type Stored = Record<string, { updatedAt?: number } | undefined>;

let running: Promise<boolean> | null = null;

/**
 * Brings Safari's storage and iCloud to the newer copy of each conversation and memory, tombstones included.
 * Answers whether anything here changed.
 */
export function syncWithCloud(): Promise<boolean> {
  running ??= sync()
    .catch((error: unknown) => {
      debugEvent("cloud_sync_failed", errorData(error));
      return false;
    })
    .finally(() => { running = null; });
  return running;
}

async function sync(): Promise<boolean> {
  const [{ items: remote }, local] = await Promise.all([
    native<{ items: Record<string, number> }>({ type: "cloudList" }),
    browser.storage.local.get(null) as Promise<Stored>
  ]);
  const pull = Object.keys(remote).filter((key) => updatedAt(local[key]) < remote[key]);
  const push = Object.keys(local).filter((key) => isSynced(key) && updatedAt(local[key]) > (remote[key] ?? -1));

  await Promise.all(push.map((key) => native({
    type: "cloudPut",
    key,
    value: JSON.stringify(local[key]),
    updatedAt: updatedAt(local[key])
  })));

  let changed = false;
  for (let start = 0; start < pull.length; start += GET_BATCH) {
    const keys = pull.slice(start, start + GET_BATCH);
    const { values } = await native<{ values: Record<string, string> }>({ type: "cloudGet", keys });
    // A write made while this sync ran is newer than what iCloud had.
    const current = await browser.storage.local.get(keys) as Stored;
    const newer = Object.fromEntries(Object.entries(values)
      .map(([key, value]) => [key, JSON.parse(value) as Stored[string]] as const)
      .filter(([key, value]) => updatedAt(current[key]) < updatedAt(value)));
    if (Object.keys(newer).length === 0) continue;
    await browser.storage.local.set(newer);
    changed = true;
  }
  return changed;
}

function isSynced(key: string): boolean {
  return key.startsWith(CONVERSATION_PREFIX) || key.startsWith(MEMORY_PREFIX);
}

function updatedAt(value: Stored[string]): number {
  return value?.updatedAt ?? -1;
}

async function native<T = unknown>(message: Record<string, unknown>): Promise<T> {
  const response = await browser.runtime.sendNativeMessage("application.id", message) as T & { error?: string };
  if (response.error) throw new Error(response.error);
  return response;
}
