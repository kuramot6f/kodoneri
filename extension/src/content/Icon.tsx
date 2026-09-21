import addIcon from "../../../design/plus.svg?raw";
import closeIcon from "../../../design/xmark.svg?raw";
import deleteIcon from "../../../design/trash.svg?raw";
import editIcon from "../../../design/square.and.pencil.svg?raw";
import historyIcon from "../../../design/clock.arrow.trianglehead.counterclockwise.rotate.90.svg?raw";
import menuIcon from "../../../design/line.3.horizontal.svg?raw";
import searchIcon from "../../../design/magnifyingglass.svg?raw";
import sendIcon from "../../../design/arrow.up.svg?raw";
import sidebarIcon from "../../../design/sidebar.left.svg?raw";
import starBorderIcon from "../../../design/star.svg?raw";
import stopIcon from "../../../design/stop.fill.svg?raw";
import tuneIcon from "../../../design/slider.horizontal.3.svg?raw";

// design/ に対応するものがない補助アイコンだけ Material Icons のパスを使う。
const PATHS = {
  back: "M17.77 3.77L16 2 6 12l10 10 1.77-1.77L9.54 12z",
  closeFullscreen: "M22 3.41l-5.34 5.34L20 12h-8V4l3.29 3.29L20.59 2 22 3.41zM3.41 22l5.34-5.34L12 20v-8H4l3.29 3.29L2 20.59 3.41 22z",
  expand: "M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z",
  floating: "M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z",
  openInFull: "M21 11V3h-8l3.29 3.29-10 10L3 13v8h8l-3.29-3.29 10-10z",
  star: "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z",
} as const;

const INLINE_SVGS = {
  add: addIcon,
  close: closeIcon,
  delete: deleteIcon,
  edit: editIcon,
  history: historyIcon,
  menu: menuIcon,
  search: searchIcon,
  send: sendIcon,
  sidebar: sidebarIcon,
  starBorder: starBorderIcon,
  stop: stopIcon,
  tune: tuneIcon
} as const;

type IconName = keyof typeof PATHS | keyof typeof INLINE_SVGS;

export function Icon({ name }: { name: IconName }) {
  if (name in INLINE_SVGS) {
    const source = INLINE_SVGS[name as keyof typeof INLINE_SVGS];
    return (
      <span
        className="icon"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: source }}
      />
    );
  }

  return (
    <svg className="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={PATHS[name as keyof typeof PATHS]} />
    </svg>
  );
}
