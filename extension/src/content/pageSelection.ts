import type { SelectionContext, SelectionMediaContext } from "../shared/protocol";
import { plural, t } from "@lingui/core/macro";
import type { PageSnapshot } from "./pageSnapshot";

export const CHAT_HOST_ID = "web-page-chat-host";

type SelectedMediaElement = HTMLImageElement | HTMLCanvasElement | HTMLVideoElement;

export interface PageSelection {
  text: string;
  media: SelectedMediaElement[];
}

export function capturePageSelection(): PageSelection | null {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const ranges = Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index));
  const media = [...document.querySelectorAll<SelectedMediaElement>("img, canvas, video")]
    .filter((element) => ranges.some((range) => intersects(range, element)));
  const text = selection.toString().trim();

  return text || media.length > 0 ? { text, media } : null;
}

export function summarizePageSelection(selection: PageSelection | null): string | null {
  if (!selection) return null;

  const characters = Array.from(selection.text);
  const preview = `${characters.slice(0, 10).join("")}${characters.length > 10 ? "…" : ""}`;
  const textPreview = characters.length > 0
    ? t`“${preview}”`
    : "";
  const mediaSummary = selection.media.length > 0
    ? plural(selection.media.length, { one: "# media item", other: "# media items" })
    : "";
  return [textPreview, mediaSummary].filter(Boolean).join(" + ");
}

export function createSelectionContext(
  selection: PageSelection | null,
  page: PageSnapshot
): SelectionContext | null {
  if (!selection) return null;

  const media = selection.media.flatMap((element): SelectionMediaContext[] => {
    const ref = page.resourceRefs.get(element) ?? getImageSource(element);
    if (!ref) return [];
    if (element instanceof HTMLImageElement) {
      const alt = element.alt.trim();
      return [{ type: "img", ref, ...(alt ? { alt } : {}) }];
    }
    return [{ type: element instanceof HTMLCanvasElement ? "canvas" : "video", ref }];
  });

  return selection.text || media.length > 0
    ? { text: selection.text, media }
    : null;
}

// 送信直後にチャットへ出す表示用。メディアのrefは質問開始時のsnapshotで確定するので暫定値
export function createPendingSelectionContext(selection: PageSelection | null): SelectionContext | null {
  if (!selection) return null;
  return {
    text: selection.text,
    media: selection.media.map((element) => ({
      type: element instanceof HTMLImageElement ? "img" : element instanceof HTMLCanvasElement ? "canvas" : "video",
      ref: getImageSource(element) ?? ""
    }))
  };
}

function intersects(range: Range, element: Element): boolean {
  try {
    return range.intersectsNode(element);
  } catch {
    return false;
  }
}

function getImageSource(element: SelectedMediaElement): string | null {
  if (!(element instanceof HTMLImageElement)) return null;
  return element.currentSrc || element.getAttribute("src");
}
