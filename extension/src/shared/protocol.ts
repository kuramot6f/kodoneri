import type { CacheUsage, Conversation } from "./conversation";
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
  panel: PanelState;
  conversation: Conversation | null;
  step: StepView | null;
  compacting: boolean;
  memory: MemoryProgress | null;
  cacheUsage: CacheUsage | null;
}

/** Content → Background over the "panel" port. */
export type PanelMessage =
  | {
      type: "ask";
      requestId: string;
      text: string;
      title: string;
      url: string;
      htmlLength: number;
      selection: SelectionContext | null;
    }
  | { type: "cancel" }
  | { type: "open"; conversationId: string | null }
  | { type: "panel"; panel: Partial<PanelState> };

/** Background → Content over the "panel" port. */
export type PanelEvent =
  | { type: "state"; state: TabView }
  | { type: "delta"; phase: "answer" | "memory"; channel: "text" | "reasoning"; text: string };

/** Content → Background via runtime.sendMessage. */
export type RuntimeMessage =
  | { type: "whoami" }
  | { type: "frame"; ref: string }
  | { type: "fetch"; url: string }
  | { type: "models" }
  | { type: "settings"; settings: ModelSettings };

/** Models whose provider has a key, and the selection clamped to them; settings is null without any key. */
export interface ModelsView {
  models: ModelInfo[];
  settings: ModelSettings | null;
}

export interface WhoAmI {
  tabId: number;
  frameId: number;
}

/** Background → a content frame via tabs.sendMessage. */
export type TabMessage =
  | { type: "tool"; requestId: string; refPrefix: string; name: string; args: string }
  | { type: "dispose"; requestId: string }
  | { type: "refresh_frame" }
  | { type: "ping" };
