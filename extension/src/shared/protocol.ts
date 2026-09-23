import type { CacheUsage, Conversation, ModelMessage } from "./conversation";
import type { DebugData } from "./debugLog";
import type { ModelInfo, ModelSettings } from "./models";

export interface PanelFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PanelState {
  open: boolean;
  /** Sidebar on desktop/iPad, enlarged sheet on phones. */
  expanded: boolean;
  frame: PanelFrame | null;
}

/** An image a tool returns; the background uploads it through the provider's Files API. */
export interface ImageOutput {
  type: "image";
  dataUrl: string;
  mimeType: string;
  byteLength: number;
}

export function isImageOutput(value: unknown): value is ImageOutput {
  return typeof value === "object" && value !== null && "type" in value && value.type === "image" && "dataUrl" in value;
}

export interface TextResource {
  content: string;
  url: string;
  byteLength: number;
}

/** What a content frame answers to a tool message. */
export type PageToolReply = { output: unknown } | { error: string };

export interface SelectionMediaContext {
  type: "img" | "canvas" | "video";
  ref: string;
  alt?: string;
}

export interface SelectionContext {
  text: string;
  media: SelectionMediaContext[];
}

/** The memory-maintenance branch after an answer. Displayed only, never saved. */
export interface MemoryProgress {
  messages: ModelMessage[];
  done: boolean;
  error?: string;
  cacheUsage: CacheUsage | null;
}

export interface TabView {
  /** Increases with every view the background sends, so a late message never overwrites a newer one. */
  version: number;
  tabId: number;
  panel: PanelState;
  conversation: Conversation | null;
  /** The step streaming now, shaped as the messages it is saved as; finished steps are in the conversation. */
  step: ModelMessage[] | null;
  compacting: boolean;
  memory: MemoryProgress | null;
  cacheUsage: CacheUsage | null;
}

export interface AskMessage {
  type: "ask";
  requestId: string;
  text: string;
  title: string;
  url: string;
  htmlLength: number;
  selection: SelectionContext | null;
}

/** Content → Background via runtime.sendMessage. Panel messages come from the top frame and are answered with the tab's view. */
export type RuntimeMessage =
  | { type: "sync" }
  /** Sent while a run streams so Safari does not stop the worker mid-run; nothing is answered. */
  | { type: "keepalive" }
  | AskMessage
  | { type: "cancel" }
  | { type: "open"; conversationId: string | null }
  | { type: "panel"; panel: Partial<PanelState> }
  | { type: "frame"; ref: string }
  | { type: "fetch"; url: string }
  | { type: "models" }
  /** Answered with whether the app holds any API key or gateway token. */
  | { type: "credentials" }
  | { type: "settings"; settings: ModelSettings }
  | { type: "debug"; contextId: string; event: string; data?: DebugData }
  | { type: "open_settings" }
  /** Re-reads the app's settings into storage; pages pick them up through storage.onChanged. */
  | { type: "app_settings" };

/** Models the subscription or a key allows, and the tab's selection resolved against them; settings is null without any. */
export interface ModelsView {
  models: ModelInfo[];
  settings: ModelSettings | null;
}

export type PageToolName = "grep" | "read" | "read_image" | "interact";

/** Background → a content frame via tabs.sendMessage. */
export type TabMessage =
  | { type: "view"; view: TabView }
  /** The streaming parts of the view, sent at most every few dozen milliseconds while a response streams. */
  | { type: "live"; version: number; step: ModelMessage[] | null; memory: MemoryProgress | null }
  | { type: "tool"; requestId: string; refPrefix: string; name: PageToolName; args: Record<string, unknown> }
  | { type: "refresh_frame" }
  | { type: "ping" };
