import assert from "node:assert/strict";
import test from "node:test";
import { deepSeekCostMicrousd } from "../src/usage.ts";

test("calculates off-peak DeepSeek Flash cost with cached input", () => {
  assert.equal(deepSeekCostMicrousd({
    prompt_tokens: 1_000_000,
    completion_tokens: 1_000_000,
    prompt_cache_hit_tokens: 800_000,
    prompt_cache_miss_tokens: 200_000
  }, new Date("2026-09-20T12:00:00Z")), 632_400);
});

test("uses peak pricing on weekday peak hours", () => {
  assert.equal(deepSeekCostMicrousd({
    prompt_tokens: 1_000,
    completion_tokens: 1_000,
    prompt_cache_hit_tokens: 0,
    prompt_cache_miss_tokens: 1_000
  }, new Date("2026-09-21T02:00:00Z")), 1_500);
});

test("treats unclassified input as cache misses", () => {
  assert.equal(deepSeekCostMicrousd({
    prompt_tokens: 1_000,
    completion_tokens: 0
  }, new Date("2026-09-20T12:00:00Z")), 150);
});
