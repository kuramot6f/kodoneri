export const DEBUG_LOG_KEY = "chatext:debug-events";
export const DEBUG_LOG_LIMIT = 500;

type DebugValue = string | number | boolean | null;
export type DebugData = Record<string, DebugValue>;

export interface DebugEvent {
  timestamp: string;
  contextId: string;
  scope: "background" | "content";
  event: string;
  data?: DebugData;
}

interface DebugStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Background-owned serialized ring buffer. Content contexts submit events over runtime messaging. */
export class DebugLog {
  private pending: Promise<unknown> = Promise.resolve();
  private readonly storage: DebugStorage;
  private readonly contextId: string;
  private readonly now: () => Date;

  constructor(
    storage: DebugStorage,
    contextId: string,
    now: () => Date = () => new Date()
  ) {
    this.storage = storage;
    this.contextId = contextId;
    this.now = now;
  }

  record(scope: DebugEvent["scope"], event: string, data?: DebugData): Promise<DebugEvent> {
    return this.enqueue(async () => {
      const events = await this.read();
      const entry = { timestamp: this.now().toISOString(), contextId: this.contextId, scope, event, ...(data ? { data } : {}) };
      events.push(entry);
      await this.storage.set({ [DEBUG_LOG_KEY]: events.slice(-DEBUG_LOG_LIMIT) });
      return entry;
    });
  }

  export(metadata: DebugData): Promise<string> {
    return this.enqueue(async () => JSON.stringify({
      generatedAt: this.now().toISOString(),
      metadata,
      events: await this.read()
    }, null, 2));
  }

  clear(): Promise<void> {
    return this.enqueue(() => this.storage.remove(DEBUG_LOG_KEY));
  }

  private async read(): Promise<DebugEvent[]> {
    const stored = (await this.storage.get(DEBUG_LOG_KEY))[DEBUG_LOG_KEY];
    return Array.isArray(stored) ? stored.filter(isDebugEvent).slice(-DEBUG_LOG_LIMIT) : [];
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation, operation);
    this.pending = result.catch(() => undefined);
    return result;
  }
}

function isDebugEvent(value: unknown): value is DebugEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<DebugEvent>;
  return typeof event.timestamp === "string"
    && typeof event.contextId === "string"
    && (event.scope === "background" || event.scope === "content")
    && typeof event.event === "string";
}

export function errorData(error: unknown): DebugData {
  if (error instanceof Error || error instanceof DOMException) {
    return { errorName: error.name, errorMessage: error.message };
  }
  return { errorName: "Unknown", errorMessage: String(error) };
}
