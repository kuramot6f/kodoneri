import { useEffect, useState } from "react";
import type { RuntimeMessage } from "../shared/protocol";
import { CHAT_BUTTON_KEY, loadChatButton } from "../shared/store";

/** Shows the stored setting at once, then asks the background to re-read the app's, which may have changed while the page was hidden. */
export function useChatButton(): boolean {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const refresh = () => void browser.runtime.sendMessage({ type: "app_settings" } satisfies RuntimeMessage).catch(() => undefined);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const onChanged = (changes: Record<string, browser.storage.StorageChange>, area: string) => {
      if (area === "local" && CHAT_BUTTON_KEY in changes) setShown(changes[CHAT_BUTTON_KEY].newValue === true);
    };
    void loadChatButton().then(setShown);
    refresh();
    browser.storage.onChanged.addListener(onChanged);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      browser.storage.onChanged.removeListener(onChanged);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return shown;
}
