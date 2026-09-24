import assert from "node:assert/strict";
import test from "node:test";
import type { Conversation } from "../src/shared/conversation.ts";
import { CONVERSATION_MAX_COUNT, loadConversations, pruneConversations, saveConversation } from "../src/shared/store.ts";

const values: Record<string, unknown> = {};
Object.assign(globalThis, {
  browser: {
    storage: {
      local: {
        async get() { return { ...values }; },
        async set(items: Record<string, unknown>) { Object.assign(values, items); },
        async remove(keys: string[]) { for (const key of keys) delete values[key]; }
      }
    }
  }
});

function conversation(index: number): Conversation {
  return { id: String(index), title: `c${index}`, createdAt: index, updatedAt: index, messages: [] };
}

test("pruning keeps only the most recently updated conversations", async () => {
  for (let index = 0; index < CONVERSATION_MAX_COUNT + 5; index++) {
    await saveConversation(conversation(index));
  }
  await pruneConversations();
  const saved = await loadConversations();
  assert.equal(saved.length, CONVERSATION_MAX_COUNT);
  assert.equal(saved.at(-1)?.id, "5");

  await saveConversation({ ...conversation(5), updatedAt: 1000 });
  await saveConversation(conversation(CONVERSATION_MAX_COUNT + 5));
  await pruneConversations();
  const resaved = await loadConversations();
  assert.equal(resaved.length, CONVERSATION_MAX_COUNT);
  assert.equal(resaved[0]?.id, "5");
  assert.equal(resaved.at(-1)?.id, "7");
});
