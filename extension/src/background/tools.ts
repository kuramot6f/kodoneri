import { tool, uploadFile } from "ai";
import type { ToolResultPart, ToolSet } from "ai";
import type { z } from "zod";
import { isImageOutput, type ImageOutput, type PageToolName, type PageToolReply, type TabMessage } from "../shared/protocol.ts";
import { dataUrlToBytes, fitImage } from "../shared/image.ts";
import { aggregateGrep, type GrepResult } from "../shared/text.ts";
import { keepNewTabsInBackground } from "./backgroundTabPolicy.ts";
import { resolveFrame } from "./frames.ts";
import { navigate, open, resolveTab } from "./navigate.ts";
import type { ModelRuntime } from "./provider.ts";
import {
  grepStored,
  grepStoredRef,
  isMemoryRef,
  isStoredRef,
  listMemories,
  newMemory,
  patchMemory,
  readStoredRef,
  removeMemory,
  renameMemory
} from "./stored.ts";
import {
  captureViewportInput,
  deleteInput,
  grepInput,
  interactInput,
  isCollectionGrep,
  listInput,
  navigateInput,
  newInput,
  openInput,
  patchInput,
  readImageInput,
  readInput,
  renameInput,
  TOOL_DESCRIPTIONS,
  type GrepInput,
  type ReadInput
} from "./toolDefinitions.ts";

export interface ToolContext {
  session: { tabId: number };
  requestId: string;
  signal: AbortSignal;
  model: Pick<ModelRuntime, "files" | "fileOptions">;
  /** Memory maintenance shares the tool definitions but may only touch memories. */
  scope: "browser" | "memory";
  moveSession: (tabId: number) => Promise<void>;
}

const MUTATING_TOOLS = new Set(["interact", "open", "navigate", "patch", "rename", "new", "delete"]);
const MEMORY_SCOPE_ERROR = "During a memory update only memories are available: list(type=memory), grep with resource_type=memory, read/grep with memory_<id>, and patch/rename/new/delete.";

export function createTools(context: ToolContext): ToolSet {
  // Mutations run one at a time in call order; reads wait for any mutation already queued.
  let chain: Promise<unknown> = Promise.resolve();
  const define = <S extends z.ZodType>(name: keyof typeof TOOL_DESCRIPTIONS, inputSchema: S, run: (input: z.infer<S>) => Promise<unknown>) => tool({
    description: TOOL_DESCRIPTIONS[name],
    inputSchema,
    execute: (input: z.infer<S>) => {
      const result = chain.then(() => run(input), () => run(input));
      if (MUTATING_TOOLS.has(name)) chain = result.catch(() => undefined);
      return result;
    },
    toModelOutput: ({ output }) => toModelOutput(context, output)
  });
  const browserOnly = () => {
    if (context.scope === "memory") throw new Error(MEMORY_SCOPE_ERROR);
  };

  return {
    grep: define("grep", grepInput, (args) => grep(context, args)),
    read: define("read", readInput, (args) => read(context, args)),
    capture_viewport: define("capture_viewport", captureViewportInput, async () => {
      browserOnly();
      return fitImage(await captureViewport(context.session.tabId));
    }),
    read_image: define("read_image", readImageInput, async (args) => {
      browserOnly();
      const output = await pageTool(context, "read_image", args, args.ref);
      return isImageOutput(output) ? fitImage(output) : output;
    }),
    list: define("list", listInput, async ({ type }) => {
      if (type === "memory") return listMemories();
      browserOnly();
      return listTabs(context.session.tabId);
    }),
    patch: define("patch", patchInput, patchMemory),
    rename: define("rename", renameInput, renameMemory),
    new: define("new", newInput, newMemory),
    delete: define("delete", deleteInput, removeMemory),
    open: define("open", openInput, async (args) => {
      browserOnly();
      return open(context, args);
    }),
    navigate: define("navigate", navigateInput, async (args) => {
      browserOnly();
      return navigate(context, args);
    }),
    interact: define("interact", interactInput, async (args) => {
      browserOnly();
      return pageTool(context, "interact", args, args.ref);
    })
  };
}

async function grep(context: ToolContext, args: GrepInput) {
  if (args.resource_type === "memory") return grepStored("memory", args);
  if (context.scope === "memory" && (isCollectionGrep(args) || !isMemoryRef(args.ref))) throw new Error(MEMORY_SCOPE_ERROR);
  if (args.resource_type === "session") return grepStored("session", args);
  if (args.resource_type === "tab") return grepTabs(context, args);
  const ref = args.ref!;
  return isStoredRef(ref) ? grepStoredRef(ref, args) : pageTool(context, "grep", args, ref);
}

async function read(context: ToolContext, args: ReadInput) {
  if (context.scope === "memory" && !isMemoryRef(args.ref)) throw new Error(MEMORY_SCOPE_ERROR);
  return isStoredRef(args.ref) ? readStoredRef(args.ref, args) : pageTool(context, "read", args, args.ref);
}

async function grepTabs(context: ToolContext, args: GrepInput) {
  const tabs = (await browser.tabs.query({})).flatMap((tab) => tab.id === undefined ? [] : [{
    ref: `tab_${tab.id}`,
    title: tab.title ?? "",
    url: tab.url ?? ""
  }]);
  return aggregateGrep(
    tabs,
    args.offset ?? 0,
    (tab, offset) => pageTool(context, "grep", { pattern: args.pattern, context: args.context, offset }, tab.ref) as Promise<GrepResult>,
    ({ ref, title, url }) => ({ ref, title, url })
  );
}

/**
 * Sends a tool to the content script owning the ref. Refs look like tab_12, tab_12_iframe_1,
 * tab_12_style_3, or tab_12_iframe_1_img_2; anything else (a URL) targets the current tab.
 * A tab or iframe ref is dropped from the args; a resource ref or URL is passed on.
 */
async function pageTool(context: ToolContext, name: PageToolName, args: Record<string, unknown>, ref: string): Promise<unknown> {
  const match = /^(tab_\d+)((?:_iframe_\d+)*)(_.+)?$/.exec(ref);
  const tabId = match ? await resolveTab(match[1]!) : context.session.tabId;
  const framePath = match?.[2]?.slice(1) ?? "";
  const frameId = framePath ? await resolveFrame(tabId, framePath) : 0;
  if (frameId === null) throw new Error(`Could not connect to iframe: ${ref}`);

  const message: TabMessage = {
    type: "tool",
    requestId: context.requestId,
    refPrefix: match ? `${match[1]}${match[2]}_` : `tab_${tabId}_`,
    name,
    args: { ...args, ref: match && !match[3] ? undefined : ref }
  };
  const send = async () => {
    const reply = await browser.tabs.sendMessage(tabId, message, { frameId }) as PageToolReply | undefined;
    if (!reply) throw new Error("Could not retrieve the tool result.");
    if ("error" in reply) throw new Error(reply.error);
    return reply.output;
  };
  return name === "interact" && args.action === "click" ? keepNewTabsInBackground(tabId, send) : send();
}

async function listTabs(currentTabId: number) {
  const tabs = await browser.tabs.query({});
  return {
    tabs: tabs.flatMap((tab) => tab.id === undefined ? [] : [{
      ref: `tab_${tab.id}`,
      title: tab.title ?? "",
      url: tab.url ?? "",
      current: tab.id === currentTabId
    }])
  };
}

async function captureViewport(tabId: number): Promise<ImageOutput> {
  const tab = await browser.tabs.get(tabId);
  if (!tab.active || tab.windowId === undefined) throw new Error("The target tab is not visible. Show the tab and try again.");
  const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  return { type: "image", dataUrl, mimeType: "image/png", byteLength: dataUrlToBytes(dataUrl).byteLength };
}

async function toModelOutput(context: ToolContext, output: unknown): Promise<ToolResultPart["output"]> {
  if (isImageOutput(output)) return uploadImage(context, output);
  return { type: "text", value: typeof output === "string" ? output : JSON.stringify(output) };
}

/** Images go through the provider's Files API; the reference is what the conversation stores. */
async function uploadImage(context: ToolContext, output: ImageOutput): Promise<ToolResultPart["output"]> {
  const { providerReference, filename } = await uploadFile({
    api: context.model.files,
    data: dataUrlToBytes(output.dataUrl),
    mediaType: output.mimeType,
    filename: `image.${output.mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "png"}`,
    abortSignal: context.signal,
    providerOptions: context.model.fileOptions
  });
  return {
    type: "content",
    value: [
      { type: "text", text: "Image attached." },
      {
        type: "file",
        mediaType: output.mimeType,
        data: { type: "reference", reference: providerReference },
        ...(filename ? { filename } : {})
      }
    ]
  };
}
