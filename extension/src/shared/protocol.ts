import type { CacheUsage, Conversation } from "./conversation";
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

export interface TextToolOutput {
  type: "text";
  content: string;
}

export interface ImageToolOutput {
  type: "image";
  dataUrl: string;
  mimeType: string;
  byteLength: number;
}

export interface ErrorToolOutput {
  type: "error";
  error: string;
}

export type ToolSuccessOutput = TextToolOutput | ImageToolOutput;
export type ToolOutput = ToolSuccessOutput | ErrorToolOutput;

export interface TextResourceOutput {
  type: "text_resource";
  content: string;
  url: string;
  contentType: string;
  byteLength: number;
}

export interface SelectionMediaContext {
  type: "img" | "canvas" | "video";
  ref: string;
  alt?: string;
}

export interface SelectionContext {
  text: string;
  media: SelectionMediaContext[];
}

export interface ToolDetail {
  id: string;
  name: string;
  args: string;
  /** Null while the tool is still running. */
  output: ToolOutput | null;
}

/** One model step as it streams; finished steps live in the conversation messages. */
export interface StepView {
  reasoning: string;
  text: string;
  tools: ToolDetail[];
}

/** The memory-maintenance branch after an answer. Displayed only, never saved. */
export interface MemoryProgress extends StepView {
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
  step: StepView | null;
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
  | AskMessage
  | { type: "cancel" }
  | { type: "open"; conversationId: string | null }
  | { type: "panel"; panel: Partial<PanelState> }
  | { type: "frame"; ref: string }
  | { type: "fetch"; url: string }
  | { type: "models" }
  | { type: "settings"; settings: ModelSettings }
  | { type: "debug"; contextId: string; event: string; data?: DebugData }
  | { type: "debug_export" }
  | { type: "debug_clear" };

/** Models whose provider has a key, and the selection clamped to them; settings is null without any key. */
export interface ModelsView {
  models: ModelInfo[];
  settings: ModelSettings | null;
}

/** Background → a content frame via tabs.sendMessage. */
export type TabMessage =
  | { type: "view"; view: TabView }
  /** The streaming parts of the view, sent at most every few dozen milliseconds while a response streams. */
  | { type: "live"; version: number; step: StepView | null; memory: MemoryProgress | null }
  | { type: "tool"; requestId: string; refPrefix: string; name: string; args: string }
  | { type: "dispose"; requestId: string }
  | { type: "refresh_frame" }
  | { type: "ping" };
