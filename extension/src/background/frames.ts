import type { TabMessage } from "../shared/protocol";

/** tabId → frame ref (iframe_1_iframe_2) → frameId, reported by each frame's content script. */
const byTab = new Map<number, Map<string, number>>();

export function registerFrame(ref: string, sender: browser.runtime.MessageSender): void {
  const tabId = sender.tab?.id;
  const frameId = sender.frameId;
  if (tabId === undefined || frameId === undefined || frameId === 0) return;
  if (!/^iframe_\d+(?:_iframe_\d+)*$/.test(ref)) return;

  const frames = byTab.get(tabId) ?? new Map<string, number>();
  byTab.set(tabId, frames);
  forget(frames, frameId);
  frames.set(ref, frameId);
}

export function clearFrames(tabId: number): void {
  byTab.delete(tabId);
}

/** Frames re-register on refresh, so a frame that moved or vanished never resolves to a stale id. */
export async function resolveFrame(tabId: number, ref: string): Promise<number | null> {
  const message: TabMessage = { type: "refresh_frame" };
  const frames = byTab.get(tabId);
  if (frames) {
    await Promise.all([...new Set(frames.values())].map(async (frameId) => {
      try {
        await browser.tabs.sendMessage(tabId, message, { frameId });
      } catch {
        forget(frames, frameId);
      }
    }));
    if (frames.has(ref)) return frames.get(ref)!;
  }
  // Registrations are lost when the worker restarts; ask every frame of the tab to register again.
  await browser.tabs.sendMessage(tabId, message).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 200));
  return byTab.get(tabId)?.get(ref) ?? null;
}

function forget(frames: Map<string, number>, frameId: number): void {
  for (const [ref, id] of frames) {
    if (id === frameId) frames.delete(ref);
  }
}
