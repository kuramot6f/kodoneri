import { useSyncExternalStore } from "react";
import type { RuntimeMessage } from "../shared/protocol";

/** Phones get a bottom sheet without drag/resize; iPad and desktop share the floating/sidebar layout. */
export const PHONE_QUERY = "(max-width: 599px)";

/** Touch devices never auto-focus text fields, so the keyboard only appears on an explicit tap. */
export const isTouchDevice = () => window.matchMedia("(pointer: coarse)").matches;

// iOS の拡張はアプリを直接起動できないので、ページ自体を URL スキームへ遷移させて Safari の確認を出す。
// macOS はネイティブメッセージでアプリを開く。
export function openSettings() {
  if (isTouchDevice()) location.href = "chatext://settings";
  else void browser.runtime.sendMessage({ type: "open_settings" } satisfies RuntimeMessage);
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches
  );
}
