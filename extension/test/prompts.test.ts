import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PROMPTS, loadPrompt, loadPrompts, resetPrompt, savePrompt } from "../src/shared/prompts.ts";

const values: Record<string, unknown> = {};
Object.assign(globalThis, {
  browser: {
    storage: {
      local: {
        async get(keys: string | string[]) {
          return Object.fromEntries([keys].flat().filter((key) => key in values).map((key) => [key, values[key]]));
        },
        async set(items: Record<string, unknown>) { Object.assign(values, items); }
      }
    }
  }
});

test("a saved prompt replaces its default until it is reset", async () => {
  assert.equal(await loadPrompt("system"), DEFAULT_PROMPTS.system);
  await savePrompt("system", "Be brief.");
  assert.equal(await loadPrompt("system"), "Be brief.");
  assert.equal((await loadPrompts()).find(({ id }) => id === "system")?.customized, true);
  await resetPrompt("system");
  assert.equal(await loadPrompt("system"), DEFAULT_PROMPTS.system);
});

test("saving an empty or default text resets the prompt", async () => {
  await savePrompt("title", "Short title.");
  await savePrompt("title", "  ");
  assert.equal(await loadPrompt("title"), DEFAULT_PROMPTS.title);
  await savePrompt("title", DEFAULT_PROMPTS.title);
  assert.equal((await loadPrompts()).find(({ id }) => id === "title")?.customized, false);
});
