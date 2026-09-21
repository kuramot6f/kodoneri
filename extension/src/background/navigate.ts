import type { ToolSuccessOutput } from "../shared/protocol";
import { i18n } from "../shared/i18n.ts";
import type { NavigateArgs } from "./navigationTools";
import type { ToolRuntime } from "./tools";

const LOAD_TIMEOUT_MS = 30_000;

export async function navigate({ session, signal, moveSession }: ToolRuntime, args: NavigateArgs): Promise<ToolSuccessOutput> {
  if (args.action === "open_tab") {
    const tab = await browser.tabs.create({ url: args.url!, active: false });
    return output(args.action, tab, session.tabId);
  }

  const tabId = await resolveTab(args.ref!);
  if (args.action === "close_tab") {
    if (tabId === session.tabId) throw new Error(i18n._({ id: "errors.closeConversationTab", message: "The tab running this conversation cannot be closed." }));
    await browser.tabs.remove(tabId);
    return { type: "text", content: JSON.stringify({ action: args.action, ref: args.ref, success: true }) };
  }

  // The listener is attached before the action so a fast load cannot slip past it.
  const loaded = tabId === session.tabId && args.action !== "switch_tab" ? waitForLoad(tabId, signal) : null;
  try {
    if (args.action === "back") await browser.tabs.goBack(tabId);
    else if (args.action === "forward") await browser.tabs.goForward(tabId);
    else if (args.action === "reload") await browser.tabs.reload(tabId);
    else if (args.action === "go_to") await browser.tabs.update(tabId, { url: args.url! });
    else {
      const tab = await browser.tabs.update(tabId, { active: true });
      if (tab.windowId !== undefined) await browser.windows?.update(tab.windowId, { focused: true });
      if (tabId !== session.tabId) await moveSession(tabId);
    }
    await loaded;
  } catch (error) {
    void loaded?.catch(() => undefined);
    throw error;
  }
  return output(args.action, await browser.tabs.get(tabId), session.tabId);
}

export async function resolveTab(ref: string): Promise<number> {
  const tabId = Number(/^tab_(\d+)$/.exec(ref)?.[1]);
  try {
    if (Number.isNaN(tabId)) throw new Error();
    await browser.tabs.get(tabId);
  } catch {
    throw new Error(i18n._({ id: "errors.invalidTabRef", message: "Invalid tab ref: {ref}. Use list(type=tab) to refresh tab refs.", values: { ref } }));
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
    const onAbort = () => finish(new DOMException(i18n._({ id: "errors.responseCancelled", message: "Response generation was cancelled." }), "AbortError"));
    const timeout = setTimeout(() => finish(new Error(i18n._({ id: "errors.navigationTimeout", message: "The page did not finish loading within 30 seconds after navigation." }))), LOAD_TIMEOUT_MS);
    browser.tabs.onUpdated.addListener(onUpdated);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function output(action: NavigateArgs["action"], tab: browser.tabs.Tab, currentTabId: number): ToolSuccessOutput {
  return {
    type: "text",
    content: JSON.stringify({
      action,
      tab: { ref: `tab_${tab.id}`, title: tab.title ?? "", url: tab.url ?? "", current: tab.id === currentTabId }
    })
  };
}
