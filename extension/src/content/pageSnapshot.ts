export type PageResourceEntry =
  | { type: "source"; source: string }
  | { type: "svg"; content: string }
  | { type: "inline-text"; tagName: "script" | "style"; content: string }
  | { type: "canvas"; element: HTMLCanvasElement }
  | { type: "video"; element: HTMLVideoElement };

export interface PageSnapshot {
  html: string;
  resources: ReadonlyMap<string, PageResourceEntry>;
  resourceRefs: ReadonlyMap<Element, string>;
}

export interface PageSnapshotState {
  elementRefs: WeakMap<Element, string>;
  usedRefs: Set<string>;
  sequences: Map<string, number>;
}

export function createPageSnapshotState(): PageSnapshotState {
  return {
    elementRefs: new WeakMap(),
    usedRefs: new Set(),
    sequences: new Map()
  };
}

export function preparePageSnapshot(
  root: HTMLElement,
  refPrefix = "",
  state = createPageSnapshotState()
): PageSnapshot {
  const clone = root.cloneNode(true) as HTMLElement;
  const resources = new Map<string, PageResourceEntry>();
  const resourceRefs = new Map<Element, string>();
  prepareClonedFrames(root, clone, refPrefix);
  collectUsedRefs(clone, state.usedRefs);
  const sourceElements = collectResourceElements(root);
  const clonedElements = collectResourceElements(clone);

  for (let index = 0; index < sourceElements.length; index += 1) {
    const sourceElement = sourceElements[index];
    const clonedElement = clonedElements[index];
    if (!sourceElement || !clonedElement) continue;

    const entry = createResourceEntry(sourceElement);
    if (!entry) continue;

    let ref = state.elementRefs.get(sourceElement);
    if (!ref) {
      ref = allocateRef(getResourceTag(entry), refPrefix, state);
      state.elementRefs.set(sourceElement, ref);
    }
    resources.set(ref, entry);
    resourceRefs.set(sourceElement, ref);
    prepareClonedElement(clonedElement, entry, ref);
  }

  return { html: clone.outerHTML, resources, resourceRefs };
}

function prepareClonedFrames(root: HTMLElement, clone: HTMLElement, prefix: string): void {
  const sourceFrames = [...root.querySelectorAll("iframe, frame")];
  const clonedFrames = [...clone.querySelectorAll("iframe, frame")];

  for (let index = 0; index < sourceFrames.length; index += 1) {
    const sourceFrame = sourceFrames[index];
    const clonedFrame = clonedFrames[index];
    if (!sourceFrame || !clonedFrame) continue;
    const browsingContextIndex = getBrowsingContextIndex(root.ownerDocument, sourceFrame);
    preserveExistingDataRef(clonedFrame);
    clonedFrame.setAttribute("data-ref", `${prefix}iframe_${browsingContextIndex + 1}`);
  }
}

function getBrowsingContextIndex(document: Document, element: Element): number {
  const view = document.defaultView;
  const child = element instanceof HTMLIFrameElement || element instanceof HTMLFrameElement
    ? element.contentWindow
    : null;
  if (!view || !child) return [...document.querySelectorAll("iframe, frame")].indexOf(element);

  for (let index = 0; index < view.frames.length; index += 1) {
    if (view.frames[index] === child) return index;
  }
  return [...document.querySelectorAll("iframe, frame")].indexOf(element);
}

function collectResourceElements(root: HTMLElement): Element[] {
  return [...root.querySelectorAll("img[src], svg, canvas, video, script:not([src]), style")]
    .filter((element) => !element.parentElement?.closest("svg"));
}

function createResourceEntry(element: Element): PageResourceEntry | null {
  if (element instanceof HTMLImageElement) {
    const source = element.getAttribute("src");
    return source && /^data:/i.test(source) ? { type: "source", source } : null;
  }
  if (element instanceof SVGSVGElement) {
    return {
      type: "svg",
      content: new XMLSerializer().serializeToString(element)
    };
  }
  if (element instanceof HTMLCanvasElement) return { type: "canvas", element };
  if (element instanceof HTMLVideoElement) return { type: "video", element };
  if (element instanceof HTMLScriptElement || element instanceof HTMLStyleElement) {
    const content = element.textContent ?? "";
    if (!content.trim()) return null;
    return {
      type: "inline-text",
      tagName: element.localName as "script" | "style",
      content
    };
  }
  return null;
}

function prepareClonedElement(element: Element, entry: PageResourceEntry, ref: string): void {
  if (entry.type === "source") element.removeAttribute("src");
  if (entry.type === "svg" || entry.type === "inline-text") element.replaceChildren();
  preserveExistingDataRef(element);
  element.setAttribute("data-ref", ref);
}

function collectUsedRefs(root: HTMLElement, usedRefs: Set<string>): void {
  for (const element of [root, ...root.querySelectorAll("*")]) {
    for (const attribute of element.attributes) {
      usedRefs.add(attribute.value);
    }
  }
}

function allocateRef(tag: string, prefix: string, state: PageSnapshotState): string {
  let sequence = state.sequences.get(tag) ?? 1;
  let ref: string;
  do {
    ref = `${prefix}${tag}_${sequence++}`;
  } while (state.usedRefs.has(ref));
  state.sequences.set(tag, sequence);
  state.usedRefs.add(ref);
  return ref;
}

function getResourceTag(entry: PageResourceEntry): string {
  if (entry.type === "source") return "img";
  if (entry.type === "inline-text") return entry.tagName;
  return entry.type;
}

function preserveExistingDataRef(element: Element): void {
  const value = element.getAttribute("data-ref");
  if (value === null) return;

  let attributeName = "data-original-ref";
  let sequence = 2;
  while (element.hasAttribute(attributeName)) {
    attributeName = `data-original-ref-${sequence++}`;
  }
  element.setAttribute(attributeName, value);
}
