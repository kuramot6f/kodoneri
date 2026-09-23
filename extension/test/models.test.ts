import assert from "node:assert/strict";
import test from "node:test";
import { CATALOG, PLANS, PROVIDERS, clampEffort, findModel, lowestEffort } from "../src/shared/models.ts";

test("every catalog entry has a unique id, a known provider and a price", () => {
  const ids = new Set(CATALOG.map((model) => model.id));
  assert.equal(ids.size, CATALOG.length);
  for (const model of CATALOG) {
    assert.ok(Object.hasOwn(PROVIDERS, model.provider), model.id);
    assert.ok(model.pricing.input > 0 && model.pricing.output > 0, model.id);
  }
});

test("every plan lists catalog models only", () => {
  for (const id of Object.values(PLANS).flat()) assert.ok(CATALOG.some((model) => model.id === id), id);
});

test("findModel reads the access from the key", () => {
  assert.equal(findModel("chatext:gpt-6-sol")?.access, "chatext");
  assert.equal(findModel("byok:gpt-6-sol")?.provider, "openai");
  assert.equal(findModel("other:gpt-6-sol"), undefined);
  assert.equal(findModel("byok:gpt-5.6-sol"), undefined);
});

test("clampEffort keeps levels the model offers and falls back to its lowest", () => {
  const flash = findModel("byok:deepseek-flash")!;
  assert.equal(clampEffort(flash, "high"), "high");
  assert.equal(clampEffort(flash, "medium"), "none");
  const opus = findModel("chatext:claude-opus-5-5")!;
  assert.equal(clampEffort(opus, "none"), "low");
  assert.equal(lowestEffort(findModel("byok:gpt-6-astra")!), "low");
});
