import type {
  RuntimeMessage,
  SelectionContext,
  TextResourceOutput,
  ToolOutput,
  WhoAmI
} from "../shared/protocol";
import { createImageReader } from "./imageTools";
import { interactWithPage } from "./interactionTools";
import { createPageSnapshotState, preparePageSnapshot } from "./pageSnapshot";
import type { PageSnapshot } from "./pageSnapshot";
import { createSelectionContext } from "./pageSelection";
import type { PageSelection } from "./pageSelection";
import { createTextToolRunner } from "./textTools";

export interface PageTools {
  htmlLength: number;
  selectionContext: SelectionContext | null;
  run: (name: string, argumentsJson: string) => Promise<ToolOutput>;
  dispose: () => void;
}

/** One page-tool session per request; refs and caches stay stable for the request's lifetime. */
const sessions = new Map<string, PageTools>();

export const whoami: Promise<WhoAmI> = browser.runtime.sendMessage({ type: "whoami" } satisfies RuntimeMessage)
  .then((response: unknown) => {
    const me = response as Partial<WhoAmI> | undefined;
    if (typeof me?.tabId !== "number" || typeof me.frameId !== "number") throw new Error("タブを特定できませんでした。");
    return me as WhoAmI;
  });

export function getPageTools(requestId: string, refPrefix: string, selection: PageSelection | null = null): PageTools {
  let tools = sessions.get(requestId);
  if (!tools) {
    tools = createPageTools(refPrefix, selection);
    sessions.set(requestId, tools);
  }
  return tools;
}

export function disposePageTools(requestId: string): void {
  sessions.get(requestId)?.dispose();
  sessions.delete(requestId);
}

function createPageTools(refPrefix: string, selection: PageSelection | null): PageTools {
  const snapshotState = createPageSnapshotState();
  let latestPage: PageSnapshot | null = null;
  // Cloning the page is costly, so it is deferred to the first read; refs stay stable across snapshots.
  const snapshot = () => (latestPage = preparePageSnapshot(document.documentElement, refPrefix, snapshotState));
  const readImage = createImageReader(document.baseURI, () => (latestPage ?? snapshot()).resources);
  const textTools = createTextToolRunner(
    () => {
      const page = snapshot();
      return { html: page.html, resources: page.resources, baseUrl: document.baseURI, pageUrl: location.href };
    },
    loadRemoteTextResource
  );

  return {
    htmlLength: document.documentElement.outerHTML.length,
    // Selected media need refs now, so a selection is the one case that snapshots up front.
    selectionContext: selection ? createSelectionContext(selection, snapshot()) : null,
    run: (name, argumentsJson) => {
      if (name === "read_image") return readImage(argumentsJson);
      if (name === "interact") return Promise.resolve(interactWithPage(argumentsJson));
      return textTools.run(name, argumentsJson);
    },
    dispose: textTools.dispose
  };
}

/** Cross-origin text is fetched by the background; same-origin fetches stay in the page to keep its cookies. */
async function loadRemoteTextResource(url: string): Promise<TextResourceOutput> {
  const output = await browser.runtime.sendMessage({ type: "fetch", url } satisfies RuntimeMessage) as
    TextResourceOutput | { type: "error"; error: string } | undefined;
  if (!output) throw new Error("テキスト資源を取得できませんでした。");
  if (output.type === "error") throw new Error(output.error);
  return output;
}
