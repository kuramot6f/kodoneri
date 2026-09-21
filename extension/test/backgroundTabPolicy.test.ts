import assert from "node:assert/strict";
import test from "node:test";
import {
  isClickInteraction,
  keepNewTabsInBackground
} from "../src/background/backgroundTabPolicy.ts";

test("identifies only interact click calls", () => {
  assert.equal(isClickInteraction("interact", '{"action":"click","query":"a"}'), true);
  assert.equal(isClickInteraction("interact", '{"action":"type","query":"input"}'), false);
  assert.equal(isClickInteraction("read", '{"action":"click"}'), false);
  assert.equal(isClickInteraction("interact", "{"), false);
});

test("reactivates the previously active tab when a click opens a tab", async () => {
  const listeners = new Set<(tab: browser.tabs.Tab) => void>();
  const activated: number[] = [];
  const api = {
    tabs: {
      get: async () => ({ id: 4, windowId: 2 }) as browser.tabs.Tab,
      query: async () => [{ id: 7, windowId: 2, active: true }] as browser.tabs.Tab[],
      update: async (tabId: number) => {
        activated.push(tabId);
        return { id: tabId } as browser.tabs.Tab;
      },
      onCreated: {
        addListener: (listener: (tab: browser.tabs.Tab) => void) => listeners.add(listener),
        removeListener: (listener: (tab: browser.tabs.Tab) => void) => listeners.delete(listener)
      }
    }
  };

  await keepNewTabsInBackground(4, async () => {
    for (const listener of listeners) listener({ id: 8, openerTabId: 4, windowId: 2 } as browser.tabs.Tab);
  }, api);

  assert.deepEqual(activated, [7]);
  assert.equal(listeners.size, 0);
});

test("ignores tabs opened by another source", async () => {
  const listeners = new Set<(tab: browser.tabs.Tab) => void>();
  const activated: number[] = [];
  const api = {
    tabs: {
      get: async () => ({ id: 4, windowId: 2 }) as browser.tabs.Tab,
      query: async () => [{ id: 7, windowId: 2, active: true }] as browser.tabs.Tab[],
      update: async (tabId: number) => {
        activated.push(tabId);
        return { id: tabId } as browser.tabs.Tab;
      },
      onCreated: {
        addListener: (listener: (tab: browser.tabs.Tab) => void) => listeners.add(listener),
        removeListener: (listener: (tab: browser.tabs.Tab) => void) => listeners.delete(listener)
      }
    }
  };

  await keepNewTabsInBackground(4, async () => {
    for (const listener of listeners) listener({ id: 8, openerTabId: 5, windowId: 2 } as browser.tabs.Tab);
  }, api);

  assert.deepEqual(activated, []);
  assert.equal(listeners.size, 0);
});
