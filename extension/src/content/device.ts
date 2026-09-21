import { useSyncExternalStore } from "react";

/** Phones get a bottom sheet without drag/resize; iPad and desktop share the floating/sidebar layout. */
export const PHONE_QUERY = "(max-width: 599px)";

/** Touch devices never auto-focus text fields, so the keyboard only appears on an explicit tap. */
export const isTouchDevice = () => window.matchMedia("(pointer: coarse)").matches;

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
