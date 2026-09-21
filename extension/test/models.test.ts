import assert from "node:assert/strict";
import test from "node:test";
import { clampEffort, findModel, lowestEffort, MODELS } from "../src/shared/models.ts";

test("every catalog entry has a unique key and a known provider", () => {
  const keys = new Set(MODELS.map((model) => model.key));
  assert.equal(keys.size, MODELS.length);
  for (const model of MODELS) assert.ok(["openai", "anthropic", "deepseek", "chatext"].includes(model.provider), model.key);
});

test("clampEffort keeps levels the model offers and falls back to its lowest", () => {
  const flash = findModel("deepseek/deepseek-flash")!;
  assert.equal(clampEffort(flash, "high"), "high");
  assert.equal(clampEffort(flash, "medium"), "none");
  const astra = findModel("openai/gpt-6-astra")!;
  assert.equal(clampEffort(astra, "none"), "low");
  assert.equal(lowestEffort(findModel("anthropic/claude-haiku-4-5")!), "none");
});
