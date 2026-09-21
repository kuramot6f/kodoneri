import assert from "node:assert/strict";
import test from "node:test";
import { clampEffort, findModel, lowestEffort, MODELS } from "../src/shared/models.ts";

test("every catalog entry has a unique id and a known provider", () => {
  const ids = new Set(MODELS.map((model) => model.id));
  assert.equal(ids.size, MODELS.length);
  for (const model of MODELS) assert.ok(["openai", "anthropic", "deepseek"].includes(model.provider), model.id);
});

test("clampEffort keeps levels the model offers and falls back to its lowest", () => {
  const flash = findModel("deepseek-flash")!;
  assert.equal(clampEffort(flash, "high"), "high");
  assert.equal(clampEffort(flash, "medium"), "none");
  const astra = findModel("gpt-6-astra")!;
  assert.equal(clampEffort(astra, "none"), "low");
  assert.equal(lowestEffort(findModel("claude-haiku-4-5")!), "none");
});
