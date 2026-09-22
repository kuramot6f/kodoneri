import { fetchText, isSameOrigin, resolveUrl } from "../shared/fetch";
import type { PageToolName, RuntimeMessage, SelectionContext, TextResource } from "../shared/protocol";
import { aggregateGrep, grepText, readText, type GrepArgs, type ReadArgs } from "../shared/text";
import { createImageReader } from "./imageTools";
import { interact, type InteractArgs } from "./interactionTools";
import { createPageSnapshotState, preparePageSnapshot, type PageSnapshot } from "./pageSnapshot";
import { createSelectionContext, type PageSelection } from "./pageSelection";

const MAX_TOTAL_TEXT_BYTES = 20 * 1024 * 1024;
/** Tool sessions are dropped oldest first; a request only needs its own for as long as it runs. */
const MAX_SESSIONS = 8;

interface PageTools {
  htmlLength: number;
  selectionContext: SelectionContext | null;
  run: (name: PageToolName, args: Record<string, unknown>) => Promise<unknown>;
  dispose: () => void;
}

/** One page-tool session per request; refs and caches stay stable for the request's lifetime. */
const sessions = new Map<string, PageTools>();

export function getPageTools(requestId: string, refPrefix: string, selection: PageSelection | null = null): PageTools {
  let tools = sessions.get(requestId);
  if (!tools) {
    tools = createPageTools(refPrefix, selection);
    sessions.set(requestId, tools);
    for (const [id, old] of sessions) {
      if (sessions.size <= MAX_SESSIONS) break;
      old.dispose();
      sessions.delete(id);
    }
  }
  return tools;
}

function createPageTools(refPrefix: string, selection: PageSelection | null): PageTools {
  const snapshotState = createPageSnapshotState();
  let latest: PageSnapshot | null = null;
  // Cloning the page is costly, so it waits for the first tool; refs stay stable across snapshots.
  const snapshot = () => (latest = preparePageSnapshot(document.documentElement, refPrefix, snapshotState));
  const readImage = createImageReader(() => (latest ?? snapshot()).resources);
  const controller = new AbortController();
  const texts = new Map<string, Promise<TextResource>>();
  let textBytes = 0;

  const loadText = async (ref: string, page: PageSnapshot): Promise<string> => {
    const entry = page.resources.get(ref);
    if (entry) {
      if (entry.type !== "inline-text" && entry.type !== "svg") throw new Error("This ref identifies an image resource. Use read_image.");
      return entry.content;
    }
    const url = resolveUrl(decodeHtmlAttribute(ref), document.baseURI, ["http:", "https:"]);
    let text = texts.get(url);
    if (!text) {
      // Same-origin text is fetched here with the page's cookies; the background fetches the rest.
      text = (isSameOrigin(url, location.href) ? fetchText(url, controller.signal) : fetchInBackground(url)).then((resource) => {
        if (textBytes + resource.byteLength > MAX_TOTAL_TEXT_BYTES) throw new Error("The text resources fetched for this question exceed 20 MiB in total.");
        textBytes += resource.byteLength;
        return resource;
      });
      texts.set(url, text);
    }
    return (await text).content;
  };

  const grep = async (args: GrepArgs) => {
    const page = snapshot();
    const type = args.resource_type;
    if (type === "script" || type === "style" || type === "svg") {
      const refs = resourceRefs(page, type).map((ref) => ({ ref }));
      return aggregateGrep(refs, args.offset ?? 0, async ({ ref }, offset) => grepText(await loadText(ref, page), { ...args, offset }));
    }
    if (!args.ref) return grepText(page.html, args);
    return { ref: args.ref, ...grepText(await loadText(args.ref, page), args) };
  };

  const read = async (args: ReadArgs) => {
    const page = snapshot();
    if (!args.ref) return readText(page.html, args);
    return { ref: args.ref, ...readText(await loadText(args.ref, page), args) };
  };

  return {
    htmlLength: document.documentElement.outerHTML.length,
    // Selected media need refs now, so a selection is the one case that snapshots up front.
    selectionContext: selection ? createSelectionContext(selection, snapshot()) : null,
    run: async (name, args) => {
      switch (name) {
        case "grep": return grep(args as unknown as GrepArgs);
        case "read": return read(args as unknown as ReadArgs);
        case "read_image":
          if (typeof args.ref !== "string") throw new Error("read_image needs an image ref or URL, not a tab or iframe ref.");
          return readImage(args.ref);
        case "interact": return interact(args as unknown as InteractArgs);
      }
    },
    dispose: () => controller.abort()
  };
}

/** Every script, style, or top-level SVG in the page, in document order: data-refs for inline ones, URLs for external ones. */
function resourceRefs(page: PageSnapshot, type: "script" | "style" | "svg"): string[] {
  const selector = type === "style" ? 'style, link[rel~="stylesheet"][href]' : type;
  const refs = [...document.querySelectorAll(selector)].map((element) => (
    page.resourceRefs.get(element) ?? (type === "svg" ? null : element.getAttribute(type === "script" ? "src" : "href"))
  ));
  return [...new Set(refs.filter((ref): ref is string => Boolean(ref)))];
}

async function fetchInBackground(url: string): Promise<TextResource> {
  const reply = await browser.runtime.sendMessage({ type: "fetch", url } satisfies RuntimeMessage) as TextResource | { error: string } | undefined;
  if (!reply) throw new Error("Could not fetch the text resource.");
  if ("error" in reply) throw new Error(reply.error);
  return reply;
}

function decodeHtmlAttribute(value: string): string {
  if (!value.includes("&")) return value;
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}
