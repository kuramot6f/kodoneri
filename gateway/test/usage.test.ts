import assert from "node:assert/strict";
import test from "node:test";
import { findCatalogModel } from "../../extension/src/shared/models.ts";
import { customCost } from "../src/usage.ts";

const offPeak = new Date("2026-09-20T12:00:00Z");
const pricing = (id: string) => findCatalogModel(id)!.pricing;

test("gives AI Gateway the catalog rates per token", () => {
  assert.deepEqual(JSON.parse(customCost(pricing("claude-sonnet-5"), offPeak)), {
    per_token_in: 2 / 1_000_000,
    per_cache_read_token: 0.2 / 1_000_000,
    per_cache_write_token: 2.5 / 1_000_000,
    per_token_out: 10 / 1_000_000
  });
});

test("cache writes cost the input rate when the provider has no write rate", () => {
  const cost = JSON.parse(customCost(pricing("gpt-6-sol"), offPeak));
  assert.equal(cost.per_cache_write_token, cost.per_token_in);
});

test("uses DeepSeek peak pricing on weekday peak hours", () => {
  const peak = JSON.parse(customCost(pricing("deepseek-flash"), new Date("2026-09-21T02:00:00Z")));
  const normal = JSON.parse(customCost(pricing("deepseek-flash"), offPeak));
  assert.equal(peak.per_token_out, normal.per_token_out * 2);
});
