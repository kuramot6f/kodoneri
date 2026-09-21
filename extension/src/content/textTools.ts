import { isSameOrigin } from "../shared/resourceLoader";
import {
  loadTextResource,
  MAX_TOTAL_TEXT_RESOURCE_BYTES,
  resolveTextResourceUrl
} from "../shared/textResource";
import type { TextResourceOutput, ToolOutput } from "../shared/protocol";
import { aggregateGrep } from "../shared/aggregateGrep";
import { i18n } from "../shared/i18n.ts";
import {
  parseTextToolCall,
  runTextTool,
  type GrepArgs,
  type GrepResourceType,
  type TextToolMetadata
} from "../shared/htmlTools";
import type { PageResourceEntry, PageSnapshot } from "./pageSnapshot";

interface TextToolRunner {
  run: (name: string, argumentsJson: string) => Promise<ToolOutput>;
  dispose: () => void;
}

interface TextResourceBudget {
  loadedBytes: number;
}

interface TextToolPage extends Pick<PageSnapshot, "html" | "resources"> {
  baseUrl: string;
  pageUrl: string;
}

export function createTextToolRunner(
  getPage: () => TextToolPage,
  loadRemote: (url: string) => Promise<TextResourceOutput>
): TextToolRunner {
  const controller = new AbortController();
  const cache = new Map<string, Promise<TextResourceOutput>>();
  const budget: TextResourceBudget = { loadedBytes: 0 };

  return {
    run: async (name, argumentsJson) => {
      try {
        const { html, baseUrl, pageUrl, resources } = getPage();
        const call = parseTextToolCall(name, argumentsJson);
        if (call.name === "grep" && call.args.resourceType) {
          if (call.args.resourceType === "session" || call.args.resourceType === "tab") {
            throw new Error(i18n._({ id: "errors.backgroundSearch", message: "Bulk {resourceType} searches run in the background.", values: { resourceType: call.args.resourceType } }));
          }
          // Background strips a tab or iframe ref before delivery, so a remaining ref names a resource instead.
          if (call.args.ref !== undefined) {
            throw new Error(i18n._({ id: "errors.resourceTypeRef", message: "When used with resource_type, ref must identify a tab or iframe." }));
          }
          const resourceType = call.args.resourceType;
          return runAggregateGrep(
            getResourceRefs(html, resourceType),
            call.args,
            (ref, offset) => runSingleTextTool(
              html,
              baseUrl,
              pageUrl,
              loadRemote,
              resources,
              cache,
              controller.signal,
              budget,
              { name: "grep", args: { ...call.args, offset, ref, resourceType: undefined } }
            )
          );
        }
        return runSingleTextTool(
          html,
          baseUrl,
          pageUrl,
          loadRemote,
          resources,
          cache,
          controller.signal,
          budget,
          call
        );
      } catch (error) {
        return { type: "error", error: getErrorMessage(error) };
      }
    },
    dispose: () => controller.abort()
  };
}

async function runAggregateGrep(
  refs: string[],
  args: GrepArgs,
  run: (ref: string, offset: number) => Promise<ToolOutput>
): Promise<ToolOutput> {
  const result = await aggregateGrep({
    resources: refs.map((ref) => ({ ref })),
    args,
    run: ({ ref }, offset) => run(ref, offset),
    nonTextError: i18n._({ id: "errors.textToolReturnedImage", message: "The text tool returned an image." })
  });
  return {
    type: "text",
    content: JSON.stringify(result)
  };
}

function getResourceRefs(html: string, resourceType: GrepResourceType): string[] {
  const document = new DOMParser().parseFromString(html, "text/html");
  const refs = resourceType === "script"
    ? [...document.querySelectorAll("script")].map((element) => (
        element.getAttribute("data-ref") ?? element.getAttribute("src")
      ))
    : resourceType === "style"
      ? [
          ...[...document.querySelectorAll("style")].map((element) => element.getAttribute("data-ref")),
          ...[...document.querySelectorAll('link[rel~="stylesheet"][href]')]
            .map((element) => element.getAttribute("href"))
        ]
      : resourceType === "svg"
        ? [...document.querySelectorAll("svg[data-ref]")]
            .map((element) => element.getAttribute("data-ref"))
        : [];
  return [...new Set(refs.filter((ref): ref is string => Boolean(ref)))];
}

async function runSingleTextTool(
  html: string,
  baseUrl: string,
  pageUrl: string,
  loadRemote: (url: string) => Promise<TextResourceOutput>,
  resources: ReadonlyMap<string, PageResourceEntry>,
  cache: Map<string, Promise<TextResourceOutput>>,
  signal: AbortSignal,
  budget: TextResourceBudget,
  call: ReturnType<typeof parseTextToolCall>
): Promise<ToolOutput> {
  try {
    const ref = call.args.ref;
    if (!ref) return runTextTool(html, call);

    const entry = resources.get(ref);
    if (entry) {
      if (entry.type !== "inline-text" && entry.type !== "svg") {
        throw new Error(i18n._({ id: "errors.imageRefAsText", message: "This ref identifies an image resource. Use read_image." }));
      }
      const content = entry.content;
      const metadata: TextToolMetadata = { ref };
      return runTextTool(content, call, metadata);
    }

    const url = resolveTextResourceUrl(decodeHtmlAttribute(ref), baseUrl);
    let resourcePromise = cache.get(url);
    if (!resourcePromise) {
      const load = isSameOrigin(url, pageUrl)
        ? loadTextResource(url, signal)
        : loadRemote(url);
      resourcePromise = load.then((resource) => {
        if (budget.loadedBytes + resource.byteLength > MAX_TOTAL_TEXT_RESOURCE_BYTES) {
          throw new Error(i18n._({ id: "errors.totalTextSize", message: "The text resources fetched for this question exceed 20 MiB in total." }));
        }
        budget.loadedBytes += resource.byteLength;
        return resource;
      });
      cache.set(url, resourcePromise);
    }

    const resource = await resourcePromise;
    return runTextTool(resource.content, call, { ref });
  } catch (error) {
    return { type: "error", error: getErrorMessage(error) };
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : i18n._({ id: "errors.textToolFailed", message: "Text tool execution failed." });
}

function decodeHtmlAttribute(value: string): string {
  if (!value.includes("&")) return value;
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}
