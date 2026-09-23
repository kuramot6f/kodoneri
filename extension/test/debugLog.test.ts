import assert from "node:assert/strict";
import test from "node:test";
import { DebugLog, DEBUG_LOG_KEY, DEBUG_LOG_LIMIT, errorData } from "../src/shared/debugLog.ts";

class MemoryStorage {
  readonly values: Record<string, unknown> = {};

  async get(key: string): Promise<Record<string, unknown>> {
    return { [key]: this.values[key] };
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, items);
  }
}

test("debug log serializes concurrent writes and keeps the newest 500 events", async () => {
  const storage = new MemoryStorage();
  let tick = 0;
  const log = new DebugLog(storage, "worker-1", () => new Date(tick++));

  await Promise.all(Array.from({ length: DEBUG_LOG_LIMIT + 20 }, (_, index) => (
    log.record("background", "tick", { index })
  )));

  const events = storage.values[DEBUG_LOG_KEY] as Array<{ data: { index: number } }>;
  assert.equal(events.length, DEBUG_LOG_LIMIT);
  assert.equal(events[0]?.data.index, 20);
  assert.equal(events.at(-1)?.data.index, DEBUG_LOG_LIMIT + 19);
});

test("record returns the event mirrored to the app", async () => {
  const storage = new MemoryStorage();
  const log = new DebugLog(storage, "worker-1", () => new Date(0));
  const event = await log.record("content", "connected", { tabId: 4 });
  assert.deepEqual(event, (storage.values[DEBUG_LOG_KEY] as unknown[])[0]);
});

test("error data contains only the error name and message", () => {
  assert.deepEqual(errorData(new TypeError("broken")), {
    errorName: "TypeError",
    errorMessage: "broken"
  });
});
