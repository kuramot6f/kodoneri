import type { NavigateInput, OpenInput } from "./toolDefinitions.ts";
import type { ToolContext } from "./tools.ts";

const LOAD_TIMEOUT_MS = 30_000;

export async function open({ session, signal }: ToolContext, args: OpenInput) {
  if (args.ref === undefined) return output("open", await browser.tabs.create({ url: args.url, active: false }), session.tabId);
  const tabId = await resolveTab(args.ref);
  await untilLoaded(tabId === session.tabId ? waitForLoad(tabId, signal) : null, () => browser.tabs.update(tabId, { url: args.url }));
  return output("open", await browser.tabs.get(tabId), session.tabId);
}

export async function navigate({ session, signal, moveSession }: ToolContext, args: NavigateInput) {
  const tabId = await resolveTab(args.ref);
  if (args.action === "close_tab") {
    if (tabId === session.tabId) throw new Error("The tab running this conversation cannot be closed.");
    await browser.tabs.remove(tabId);
    return { action: args.action, ref: args.ref, success: true };
  }

  await untilLoaded(tabId === session.tabId && args.action !== "switch_tab" ? waitForLoad(tabId, signal) : null, async () => {
    if (args.action === "back") await browser.tabs.goBack(tabId);
    else if (args.action === "forward") await browser.tabs.goForward(tabId);
    else if (args.action === "reload") await browser.tabs.reload(tabId);
    else {
      const tab = await browser.tabs.update(tabId, { active: true });
      if (tab.windowId !== undefined) await browser.windows?.update?.(tab.windowId, { focused: true });
      if (tabId !== session.tabId) await moveSession(tabId);
    }
  });
  return output(args.action, await browser.tabs.get(tabId), session.tabId);
}

/** loaded is created before the action so a fast load cannot slip past its listener. */
async function untilLoaded(loaded: Promise<void> | null, action: () => Promise<unknown>) {
  try {
    await action();
    await loaded;
  } catch (error) {
    void loaded?.catch(() => undefined);
    throw error;
  }
}

export async function resolveTab(ref: string): Promise<number> {
  const tabId = Number(/^tab_(\d+)$/.exec(ref)?.[1]);
  try {
    if (Number.isNaN(tabId)) throw new Error();
    await browser.tabs.get(tabId);
  } catch {
    throw new Error(`Invalid tab ref: ${ref}. Use list(type=tab) to refresh tab refs.`);
  }
  return tabId;
}

function waitForLoad(tabId: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      browser.tabs.onUpdated.removeListener(onUpdated);
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onUpdated = (updatedTabId: number, change: browser.tabs._OnUpdatedChangeInfo) => {
      if (updatedTabId === tabId && change.status === "complete") finish();
    };
    const onAbort = () => finish(new DOMException("Response generation was cancelled.", "AbortError"));
    const timeout = setTimeout(() => finish(new Error("The page did not finish loading within 30 seconds after navigation.")), LOAD_TIMEOUT_MS);
    browser.tabs.onUpdated.addListener(onUpdated);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function output(action: NavigateInput["action"] | "open", tab: browser.tabs.Tab, currentTabId: number) {
  return { action, tab: { ref: `tab_${tab.id}`, title: tab.title ?? "", url: tab.url ?? "", current: tab.id === currentTabId } };
}
