import { z } from "zod";
import { MEMORY_CONTENT_MAX_LENGTH, MEMORY_TITLE_MAX_LENGTH } from "../shared/memory.ts";

/** Model-facing tool contracts: descriptions, input schemas and the cross-field rules a JSON schema cannot express. */

const COLLECTION_TYPES = new Set(["session", "tab", "memory"]);
const memoryRef = z.string().regex(/^memory_[0-9]+$/);

export const grepInput = z.object({
  pattern: z.string().min(1).max(200)
    .describe("JavaScript RegExp source, global and case-sensitive. Do not surround it with / characters or append flags."),
  context: z.number().int().min(0).max(1000)
    .describe("Number of characters to return before and after each match. Usually use 500."),
  offset: z.number().int().min(0).max(1_000_000).optional()
    .describe("Number of matching results to skip. Use nextOffset from a previous result to continue. Defaults to 0."),
  ref: z.string().min(1).max(10000).optional()
    .describe("Target to search: the current page's tab ref from browser_context, observed tab refs, request-scoped iframe or text data-refs (e.g. tab_1043, tab_1043_iframe_1, tab_1043_style_1), saved session refs returned by session search, memory refs from list (e.g. memory_1726800000000), or a URL. Relative URLs are resolved against the owning page URL. Required unless resource_type is session, tab, or memory. Call grep several times in parallel to search several targets."),
  resource_type: z.enum(["session", "tab", "memory", "script", "style", "svg"]).optional()
    .describe("Search every resource of this type. session searches saved conversations, tab searches open tabs, and memory searches saved memories; none of these takes a ref. script/style include inline and external resources and svg searches inline SVG, all within the tab or iframe given by a single ref.")
}).refine(
  (args) => COLLECTION_TYPES.has(args.resource_type ?? "") ? args.ref === undefined : args.ref !== undefined,
  "ref is required, except with resource_type=session, tab, or memory, which take no ref."
);

export const readInput = z.object({
  offset: z.number().int().min(0)
    .describe("Zero-based character offset at which to start reading."),
  limit: z.number().int().min(1).max(10000)
    .describe("Maximum number of characters to read. Usually use 5000."),
  ref: z.string().min(1).max(10000)
    .describe("Target to read: the current page's tab ref from browser_context, an observed tab ref, or a request-scoped iframe or text data-ref (e.g. tab_1043, tab_1043_iframe_1, tab_1043_style_1), a saved session ref returned by session search, a memory ref from list (e.g. memory_1726800000000), or a URL. Script/style/SVG data-refs identify text resources. Relative URLs resolve against the owning page URL.")
});

export const captureViewportInput = z.object({}).strict();

export const readImageInput = z.object({
  ref: z.string().min(1)
    .describe("Image reference or URL to read. Relative URLs are resolved against the current page URL.")
});

export const listInput = z.object({
  type: z.enum(["tab", "memory"])
    .describe("tab lists open browser tabs; memory lists memories saved by the user.")
});

export const patchInput = z.object({
  ref: memoryRef.describe("Memory ref from list (type=memory), such as memory_1726800000000."),
  edits: z.array(z.object({
    old: z.string().min(1).describe("Exact text currently in the memory, unique within it."),
    new: z.string().describe("Replacement text. Empty removes old.")
  })).min(1).max(20)
});

export const renameInput = z.object({
  ref: memoryRef.describe("Memory ref from list (type=memory)."),
  title: z.string().trim().min(1).max(MEMORY_TITLE_MAX_LENGTH).describe("New topic title.")
});

export const newInput = z.object({
  title: z.string().trim().min(1).max(MEMORY_TITLE_MAX_LENGTH).describe("Topic title."),
  content: z.string().min(1).max(MEMORY_CONTENT_MAX_LENGTH).describe("Compact prose or bullets with enough context to stand alone.")
});

export const deleteInput = z.object({
  ref: memoryRef.describe("Memory ref from list (type=memory).")
});

const URL_ACTIONS = new Set(["open_tab", "go_to"]);

export const navigateInput = z.object({
  action: z.enum(["back", "forward", "reload", "open_tab", "close_tab", "switch_tab", "go_to"]),
  ref: z.string().regex(/^tab_[0-9]+$/).optional()
    .describe("Tab ref from list (type=tab) or browser_context, such as tab_1043. Required for every action except open_tab."),
  url: z.string().min(1).max(10000).optional()
    .describe("Required for open_tab and go_to.")
}).strict().superRefine((args, context) => {
  if (args.action === "open_tab" ? args.ref !== undefined : args.ref === undefined) {
    context.addIssue({ code: "custom", message: args.action === "open_tab" ? "ref cannot be specified for open_tab." : `${args.action} requires ref. Use the browser_context ref for the current tab.` });
  }
  if (URL_ACTIONS.has(args.action) ? args.url === undefined : args.url !== undefined) {
    context.addIssue({ code: "custom", message: URL_ACTIONS.has(args.action) ? `${args.action} requires url.` : `url cannot be specified for ${args.action}.` });
  }
});

const VALUE_ACTIONS = new Set(["type", "press", "select"]);

export const interactInput = z.object({
  ref: z.string().regex(/^tab_[0-9]+(?:_iframe_[0-9]+)*$/)
    .describe("Tab or request-scoped iframe reference, such as tab_1043, tab_1043_iframe_1, or tab_1043_iframe_1_iframe_1. The current page's tab ref is given in browser_context."),
  action: z.enum(["click", "type", "press", "select", "check"]),
  value: z.string().optional()
    .describe("Required for type, press, and select. Omit for click and check."),
  query: z.string().min(1).max(10000)
    .describe("CSS selector for the target element. The first matching element is used.")
}).superRefine((args, context) => {
  if (VALUE_ACTIONS.has(args.action) !== (args.value !== undefined)) {
    context.addIssue({ code: "custom", message: VALUE_ACTIONS.has(args.action) ? `${args.action} requires value.` : `value cannot be specified for ${args.action}.` });
  }
});

export type GrepInput = z.infer<typeof grepInput>;
export type ReadInput = z.infer<typeof readInput>;
export type NavigateInput = z.infer<typeof navigateInput>;

export const TOOL_DESCRIPTIONS = {
  grep: "Read-only search of page HTML, text resources, or saved conversations using a global, case-sensitive JavaScript regular expression. Returns up to 20 matches with character positions and context; nextOffset continues matching results. HTML is refreshed from the live DOM for each call, so positions may shift between calls. URLs fetch response text, not rendered DOM. Requires ref, except resource_type=session, tab, or memory which search across all saved conversations, open tabs, or memories; resource_type=script, style, or svg searches every resource of that type in the tab or iframe given by ref. The current page's tab ref is given in browser_context. Invalid patterns, unavailable resources, or expired refs fail. Use read to inspect a bounded range around a useful match.",
  read: "Read-only bounded text retrieval from page HTML, a text resource, a saved conversation, or a memory. Returns content, offset, endOffset, totalCharacters, and eof. Offsets and limits count UTF-16 code units, not lines. Page/tab/iframe HTML is refreshed from the live DOM on each call; URLs return fetched response text, not rendered DOM. Positions may shift after DOM updates. ref is required; the current page's tab ref is given in browser_context. Missing or expired refs and non-text resources fail. Use grep to locate relevant text and read_image for image resources.",
  capture_viewport: "Read-only PNG capture of the current visible browser viewport, not the entire document. Use to anchor an ambiguous question to what the user currently sees when no selection was provided, or for layout and appearance. Read surrounding DOM if more context is needed. Takes no tab or resource ref. The requesting tab must be active in its window; otherwise capture fails. Use read_image to inspect an individual image resource and read/grep for text.",
  read_image: "Read-only retrieval of one image resource. Raster images, canvas, and video frames return an image; SVG returns XML text, not a rendered image. Use an observed img src or image/SVG/canvas/video data-ref. Page resource refs are request-scoped and may become unavailable after navigation or resource changes. Results are cached within the request and may not reflect later image or video changes. Missing, inaccessible, unsupported, or oversized resources fail. Use capture_viewport for rendered layout or SVG appearance; use read/grep for text resources.",
  list: "Read-only listing of open tabs or saved memories. type=tab returns titles, URLs, and tab refs such as tab_1043 across browser windows, not page bodies; use returned refs with read, grep, or interact. Re-list to discover tabs opened by an interaction; closed tabs cannot be inspected. A tab ref stays the same while that tab is open, including across earlier requests; the current page's ref is given in browser_context, and a ref rejected as invalid must be reacquired here. type=memory returns memory refs such as memory_1726800000000 with titles, the first 100 characters of content, length, is_editable, and updated_at; use read or grep with the ref for the full text. is_editable=false marks a user favorite that patch, rename, and delete reject. Use grep with resource_type=session for saved conversations.",
  patch: "State-changing edit of one memory's content. Each edit replaces old with new; old must match the current content exactly and only once, otherwise the whole call fails and nothing is written. Use new=\"\" to remove a statement. Fails for favorites (is_editable=false from list) or when the result exceeds 1000 characters. Read the memory first; replace contradicted or superseded statements and remove stale, low-value or duplicate details. The 1000-character cap is not a target.",
  rename: "State-changing rename of one memory topic. Fails for favorites (is_editable=false).",
  new: "State-changing creation of a new memory topic. A topic is a persistent semantic area (a project, preference, background, plan, or constraint) that future conversations can reuse; prefer patch on an existing topic when the information belongs there. Fails when 10 topics already exist or content exceeds 1000 characters. Returns the created ref.",
  delete: "State-changing deletion of a whole memory topic. Use when the user asked to forget it, or all its content is invalid, superseded, stale with no future utility, or duplicated elsewhere; remove a single statement with patch instead. Fails for favorites (is_editable=false).",
  navigate: "State-changing browser navigation and tab management. Every action except open_tab requires a tab ref from list (type=tab) or browser_context; the current page's ref is given in browser_context. open_tab opens a new tab in the background; use switch_tab when it must become active. switch_tab also moves this conversation into that tab: it becomes the current tab for capture_viewport and browser_context, and the previous tab keeps its own ref. The tab running this conversation cannot be closed. go_to and open_tab require url. Returns after the browser accepts the operation, not after the destination finishes loading. Observe the resulting page or tabs before dependent actions.",
  interact: "State-changing operation on the first live DOM element matching query in the referenced tab or iframe. Works in background tabs; switch only if the particular interaction needs a visible tab. Tabs opened by click remain in the background; use list (type=tab) and switch_tab when one must become active. Returns action, query, element, and success after dispatch, not confirmation of navigation, submission, or task completion. type replaces an input/textarea/contenteditable value; press dispatches synthetic keydown/keyup events and does not guarantee native key behavior; select chooses an option by value; check sets a checkbox/radio to checked. Invalid selectors, absent or incompatible elements, and unavailable refs fail. Choose selectors from observed HTML. Observe the result before planning dependent actions; do not blindly retry an operation whose outcome is unknown."
} as const;
