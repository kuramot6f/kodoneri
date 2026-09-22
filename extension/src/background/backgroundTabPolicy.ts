const NEW_TAB_SETTLE_MS = 100;

interface TabApi {
  tabs: {
    get: (tabId: number) => Promise<browser.tabs.Tab>;
    query: (queryInfo: { active: true; windowId: number }) => Promise<browser.tabs.Tab[]>;
    update: (tabId: number, updateProperties: { active: true }) => Promise<browser.tabs.Tab>;
    onCreated: {
      addListener: (listener: (tab: browser.tabs.Tab) => void) => void;
      removeListener: (listener: (tab: browser.tabs.Tab) => void) => void;
    };
  };
}

/** Tabs a click opens stay behind the tab the user was looking at. */
export async function keepNewTabsInBackground<T>(
  openerTabId: number | undefined,
  operation: () => Promise<T>,
  api: TabApi = browser
): Promise<T> {
  if (openerTabId === undefined) return operation();

  const opener = await api.tabs.get(openerTabId).catch(() => undefined);
  if (opener?.windowId === undefined) return operation();
  const [previouslyActive] = await api.tabs.query({ active: true, windowId: opener.windowId });
  if (previouslyActive?.id === undefined) return operation();

  let resolveRestored!: () => void;
  const restored = new Promise<void>((resolve) => { resolveRestored = resolve; });
  const listener = (tab: browser.tabs.Tab) => {
    if (tab.openerTabId !== openerTabId || tab.windowId !== opener.windowId) return;
    void api.tabs.update(previouslyActive.id!, { active: true })
      .catch(() => undefined)
      .finally(resolveRestored);
  };
  api.tabs.onCreated.addListener(listener);

  try {
    const result = await operation();
    await Promise.race([restored, wait(NEW_TAB_SETTLE_MS)]);
    return result;
  } finally {
    api.tabs.onCreated.removeListener(listener);
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
