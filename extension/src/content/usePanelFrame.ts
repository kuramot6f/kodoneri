import { useRef } from "react";
import type { CSSProperties, PointerEvent, RefObject } from "react";
import type { PanelFrame } from "../shared/protocol";

export type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const EDGES: Edge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

const MIN_WIDTH = 280;
const MIN_HEIGHT = 240;
const MARGIN = 16;

interface Gesture {
  edge: Edge | null;
  start: PanelFrame;
  x: number;
  y: number;
}

// ヘッダーのドラッグで移動、縁のドラッグでリサイズする。確定した位置・サイズはonCommitで通知する。
// フローティング以外のレイアウト(サイドバー・スマホ)ではenabled=falseにして、保存済みの位置も適用しない。
export function usePanelFrame(
  panelRef: RefObject<HTMLElement | null>,
  frame: PanelFrame | null,
  enabled: boolean,
  onChange: (frame: PanelFrame) => void,
  onCommit: (frame: PanelFrame) => void
) {
  const gestureRef = useRef<Gesture | null>(null);
  const frameRef = useRef(frame);
  frameRef.current = frame;

  const handlersFor = (edge: Edge | null) => enabled ? ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      const panel = panelRef.current;
      if (event.button !== 0 || !panel) return;
      if (!edge && (event.target as Element).closest("button")) return;
      const rect = panel.getBoundingClientRect();
      gestureRef.current = {
        edge,
        start: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        x: event.clientX,
        y: event.clientY
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      onChange(gesture.edge ? resize(gesture.start, gesture.edge, dx, dy) : move(gesture.start, dx, dy));
    },
    onPointerUp: () => {
      if (!gestureRef.current) return;
      gestureRef.current = null;
      if (frameRef.current) onCommit(frameRef.current);
    },
    onPointerCancel: () => {
      gestureRef.current = null;
    }
  }) : {};

  // CSS側のright/bottom指定を打ち消して保存済みの位置を優先する
  const style: CSSProperties | undefined = enabled && frame
    ? { ...fitToViewport(frame), right: "auto", bottom: "auto" }
    : undefined;
  return { style, handlersFor };
}

function move(start: PanelFrame, dx: number, dy: number): PanelFrame {
  return fitToViewport({ ...start, left: start.left + dx, top: start.top + dy });
}

function resize(start: PanelFrame, edge: Edge, dx: number, dy: number): PanelFrame {
  const right = start.left + start.width;
  const bottom = start.top + start.height;
  let { left, top, width, height } = start;
  if (edge.includes("e")) width = clamp(start.width + dx, MIN_WIDTH, window.innerWidth - MARGIN - left);
  if (edge.includes("s")) height = clamp(start.height + dy, MIN_HEIGHT, window.innerHeight - MARGIN - top);
  if (edge.includes("w")) {
    width = clamp(start.width - dx, MIN_WIDTH, right - MARGIN);
    left = right - width;
  }
  if (edge.includes("n")) {
    height = clamp(start.height - dy, MIN_HEIGHT, bottom - MARGIN);
    top = bottom - height;
  }
  return { left, top, width, height };
}

// 保存時より小さいウィンドウでもパネルが画面内に収まるようにする
function fitToViewport(frame: PanelFrame): PanelFrame {
  const width = clamp(frame.width, MIN_WIDTH, window.innerWidth - MARGIN * 2);
  const height = clamp(frame.height, MIN_HEIGHT, window.innerHeight - MARGIN * 2);
  return {
    width,
    height,
    left: clamp(frame.left, MARGIN, window.innerWidth - MARGIN - width),
    top: clamp(frame.top, MARGIN, window.innerHeight - MARGIN - height)
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
