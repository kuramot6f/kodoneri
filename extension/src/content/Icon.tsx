import type { CSSProperties } from "react";

// design/ に対応するものがない補助アイコンだけ Material Icons のパスを使う。
const PATHS = {
  back: "M17.77 3.77L16 2 6 12l10 10 1.77-1.77L9.54 12z",
  expand: "M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z",
  floating: "M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z",
  star: "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z",
} as const;

const PNGS = {
  add: "plus.png",
  close: "xmark.png",
  closeFullscreen: "arrow.down.right.and.arrow.up.left.png",
  delete: "trash.png",
  edit: "square.and.pencil.png",
  history: "clock.arrow.trianglehead.counterclockwise.rotate.90.png",
  menu: "line.3.horizontal.png",
  openInFull: "arrow.up.left.and.arrow.down.right.png",
  search: "magnifyingglass.png",
  send: "arrow.up.png",
  sidebar: "sidebar.left.png",
  starBorder: "star.png",
  stop: "stop.fill.png",
  tune: "slider.horizontal.3.png"
} as const;

type IconName = keyof typeof PATHS | keyof typeof PNGS;
type IconTone = "default" | "inverse" | "secondary";

const baseStyle = {
  position: "relative",
  zIndex: 2,
  display: "inline-block",
  flex: "none",
  width: 20,
  height: 20,
  background: "transparent"
} satisfies CSSProperties;

export function Icon({ name, tone = "default" }: { name: IconName; tone?: IconTone }) {
  const style = {
    ...baseStyle,
    filter: tone === "inverse" ? "brightness(0) invert(1)" : undefined,
    opacity: tone === "secondary" ? .6 : undefined
  } satisfies CSSProperties;

  if (name in PNGS) {
    const file = PNGS[name as keyof typeof PNGS];
    return (
      <img
        className="ui-icon"
        src={browser.runtime.getURL(`images/ui-icons/${file}`)}
        alt=""
        aria-hidden="true"
        draggable={false}
        style={{ ...style, objectFit: "contain" }}
      />
    );
  }

  return (
    <svg className="ui-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={style}>
      <path d={PATHS[name as keyof typeof PATHS]} />
    </svg>
  );
}
