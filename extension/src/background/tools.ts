import { jsonSchema, tool, uploadFile } from "ai";
import type { ToolResultPart, ToolSet } from "ai";
import { aggregateGrep } from "../shared/aggregateGrep";
import { parseTextToolCall, type GrepArgs } from "../shared/htmlTools";
import { isMemoryWriteTool } from "../shared/memory";
import type { ImageToolOutput, TabMessage, ToolSuccessOutput } from "../shared/protocol";
import { isToolOutput } from "../shared/toolOutput";
import { isClickInteraction, keepNewTabsInBackground } from "./backgroundTabPolicy";
import { resolveFrame } from "./frames";
import { runMemoryScopedTool, runMemoryWrite } from "./memoryTools";
import { navigate, resolveTab } from "./navigate";
import { parseNavigateArgs } from "./navigationTools";
import { BROWSER_TOOLS } from "./prompt";
import type { ModelRuntime } from "./provider";
import { grepStored, listMemories, memoryTexts, runStoredTextTool, sessionTexts } from "./storedText";

export interface ToolRuntime {
  session: { tabId: number; touched: Set<string> };
  requestId: string;
  signal: AbortSignal;
  model: Pick<ModelRuntime, "files" | "fileOptions">;
  /** The memory branch only gets memory tools. */
  scope: "browser" | "memory";
  moveSession: (tabId: number) => Promise<void>;
}

const MUTATING_TOOLS = new Set(["interact", "navigate", "patch", "rename", "new", "delete"]);

export function createTools(runtime: ToolRuntime): ToolSet {
  // Mutations run one at a time in call order; reads wait for any mutation already queued.
  let chain: Promise<unknown> = Promise.resolve();
  return Object.fromEntries(BROWSER_TOOLS.map(({ function: definition }) => [
    definition.name,
    tool<unknown, ToolSuccessOutput, Record<string, unknown>>({
      description: definition.description,
      inputSchema: jsonSchema(definition.parameters as Parameters<typeof jsonSchema>[0]),
      execute: (input, { abortSignal }) => {
        const run = () => executeTool(runtime, definition.name, JSON.stringify(input), abortSignal ?? runtime.signal);
        if (!MUTATING_TOOLS.has(definition.name)) return chain.then(run, run);
        const result = chain.then(run, run);
        chain = result.catch(() => undefined);
        return result;
      },
      toModelOutput: ({ output }) => toModelOutput(runtime, output)
    })
  ]));
}

export async function disposeTools(runtime: Pick<ToolRuntime, "session" | "requestId">): Promise<void> {
  const message: TabMessage = { type: "dispose", requestId: runtime.requestId };
  await Promise.all([...runtime.session.touched].map((key) => {
    const [tabId, frameId] = key.split(":").map(Number);
    return browser.tabs.sendMessage(tabId!, message, { frameId }).catch(() => undefined);
  }));
  runtime.session.touched.clear();
}

async function executeTool(runtime: ToolRuntime, name: string, args: string, signal: AbortSignal): Promise<ToolSuccessOutput> {
  signal.throwIfAborted();
  if (runtime.scope === "memory") return runMemoryScopedTool(name, args);
  if (isMemoryWriteTool(name)) return runMemoryWrite(name, args);
  switch (name) {
    case "list":
      return (JSON.parse(args) as { type?: unknown }).type === "tab" ? listTabs(runtime.session.tabId) : listMemories();
    case "navigate":
      return navigate(runtime, parseNavigateArgs(args));
    case "capture_viewport":
      return captureViewport(runtime.session.tabId);
    case "grep":
    case "read":
      return textTool(runtime, name, args);
    case "read_image":
    case "interact":
      return pageTool(runtime, name, args, (JSON.parse(args) as { ref?: unknown }).ref);
    default:
      throw new Error(`未対応のツールです: ${name}`);
  }
}

async function textTool(runtime: ToolRuntime, name: "grep" | "read", args: string): Promise<ToolSuccessOutput> {
  const call = parseTextToolCall(name, args);
  const resourceType = call.name === "grep" ? call.args.resourceType : undefined;
  if (resourceType === "session") return grepStored(await sessionTexts(), call.args as GrepArgs);
  if (resourceType === "memory") return grepStored(await memoryTexts(), call.args as GrepArgs);
  if (resourceType === "tab") return grepTabs(runtime, call.args as GrepArgs);

  const ref = call.args.ref;
  if (!ref) throw new Error("refを指定してください。現在のページはbrowser_contextのrefを使います。");
  if (/^(?:session|memory)_\d+$/.test(ref)) {
    const texts = ref.startsWith("session") ? await sessionTexts() : await memoryTexts();
    const text = texts.find((candidate) => candidate.ref === ref);
    if (!text) {
      throw new Error(`参照が無効です: ${ref}。会話はgrep(resource_type=session)、メモリはlist(type=memory)で参照を再取得してください。`);
    }
    return runStoredTextTool(text, call);
  }
  return pageTool(runtime, name, args, ref);
}

async function grepTabs(runtime: ToolRuntime, args: GrepArgs): Promise<ToolSuccessOutput> {
  const tabs = (await browser.tabs.query({})).flatMap((tab) => tab.id === undefined ? [] : [{
    ref: `tab_${tab.id}`,
    title: tab.title ?? "",
    url: tab.url ?? ""
  }]);
  const result = await aggregateGrep({
    resources: tabs,
    args,
    run: async (tab, offset) => {
      const tabArgs = JSON.stringify({ pattern: args.pattern, context: args.context, offset, ref: tab.ref });
      try {
        return await pageTool(runtime, "grep", tabArgs, tab.ref);
      } catch (error) {
        return { type: "error", error: getErrorMessage(error) };
      }
    },
    metadata: ({ ref, title, url }) => ({ ref, title, url }),
    nonTextError: "grepが画像結果を返しました。"
  });
  return { type: "text", content: JSON.stringify(result) };
}

/**
 * Sends a tool to the content script owning the ref. Refs look like tab_12, tab_12_iframe_1,
 * tab_12_style_3, or tab_12_iframe_1_img_2; anything else (a URL) targets the current tab.
 */
async function pageTool(runtime: ToolRuntime, name: string, args: string, ref: unknown): Promise<ToolSuccessOutput> {
  if (typeof ref !== "string" || !ref) throw new Error("refを指定してください。現在のページはbrowser_contextのrefを使います。");
  const match = /^(tab_(\d+))((?:_iframe_\d+)*)(?:_(.+))?$/.exec(ref);
  const tabId = match ? await resolveTab(match[1]!) : runtime.session.tabId;
  const framePath = match?.[3]?.slice(1) ?? "";
  const frameId = framePath ? await resolveFrame(tabId, framePath) : 0;
  if (frameId === null) throw new Error(`iframeに接続できませんでした: ${ref}`);
  const refPrefix = match ? `${match[1]}${match[3]}_` : `tab_${tabId}_`;
  const localArgs = { ...JSON.parse(args) as Record<string, unknown> };
  if (match && match[4] === undefined) delete localArgs.ref;
  else localArgs.ref = ref;

  const message: TabMessage = { type: "tool", requestId: runtime.requestId, refPrefix, name, args: JSON.stringify(localArgs) };
  runtime.session.touched.add(`${tabId}:${frameId}`);
  const send = async () => {
    const output: unknown = await browser.tabs.sendMessage(tabId, message, { frameId });
    if (!isToolOutput(output)) throw new Error("ツール結果を取得できませんでした。");
    if (output.type === "error") throw new Error(output.error);
    return output;
  };
  return isClickInteraction(name, args) ? keepNewTabsInBackground(tabId, send) : send();
}

async function listTabs(currentTabId: number): Promise<ToolSuccessOutput> {
  const tabs = await browser.tabs.query({});
  return {
    type: "text",
    content: JSON.stringify({
      tabs: tabs.flatMap((tab) => tab.id === undefined ? [] : [{
        ref: `tab_${tab.id}`,
        title: tab.title ?? "",
        url: tab.url ?? "",
        current: tab.id === currentTabId
      }])
    })
  };
}

async function captureViewport(tabId: number): Promise<ToolSuccessOutput> {
  const tab = await browser.tabs.get(tabId);
  if (!tab.active || tab.windowId === undefined) {
    throw new Error("対象タブが表示中ではありません。タブを表示してから再試行してください。");
  }
  const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return { type: "image", dataUrl, mimeType: "image/png", byteLength: Math.floor(base64.length * 3 / 4) - padding };
}

async function toModelOutput(runtime: ToolRuntime, output: ToolSuccessOutput): Promise<ToolResultPart["output"]> {
  if (output.type === "text") return { type: "text", value: output.content };
  return uploadToolImage(runtime, output);
}

/** Images go through the provider's Files API; the reference is what the conversation stores. */
async function uploadToolImage(runtime: ToolRuntime, output: ImageToolOutput): Promise<ToolResultPart["output"]> {
  const { providerReference, filename } = await uploadFile({
    api: runtime.model.files,
    data: dataUrlToBytes(output.dataUrl),
    mediaType: output.mimeType,
    filename: `image.${extensionFor(output.mimeType)}`,
    abortSignal: runtime.signal,
    providerOptions: runtime.model.fileOptions
  });
  return {
    type: "content",
    value: [
      { type: "text", text: "画像を添付しました。" },
      {
        type: "file",
        mediaType: output.mimeType,
        data: { type: "reference", reference: providerReference },
        ...(filename ? { filename } : {})
      }
    ]
  };
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const separator = dataUrl.indexOf(",");
  const metadata = separator < 0 ? "" : dataUrl.slice(0, separator);
  if (!metadata.startsWith("data:") || !metadata.endsWith(";base64")) throw new Error("画像データの形式が不正です。");
  const binary = atob(dataUrl.slice(separator + 1));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function extensionFor(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg": return "jpg";
    case "image/gif": return "gif";
    case "image/webp": return "webp";
    default: return "png";
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "不明なエラーが発生しました。";
}
