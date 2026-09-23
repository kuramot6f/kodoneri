import assert from "node:assert/strict";
import test from "node:test";
import { findCatalogModel } from "../../extension/src/shared/models.ts";
import { costMicrousd, extractUsage, readUsage } from "../src/usage.ts";

const offPeak = new Date("2026-09-20T12:00:00Z");
const pricing = (id: string) => findCatalogModel(id)!.pricing;

test("calculates off-peak DeepSeek Flash cost with cached input", () => {
  const usage = readUsage("deepseek", {
    prompt_tokens: 1_000_000,
    completion_tokens: 1_000_000,
    prompt_cache_hit_tokens: 800_000,
    prompt_cache_miss_tokens: 200_000
  });
  assert.equal(costMicrousd(pricing("deepseek-flash"), usage, offPeak), 632_400);
});

test("uses DeepSeek peak pricing on weekday peak hours", () => {
  const usage = readUsage("deepseek", { prompt_tokens: 1_000, completion_tokens: 1_000 });
  assert.equal(costMicrousd(pricing("deepseek-flash"), usage, new Date("2026-09-21T02:00:00Z")), 1_500);
});

test("OpenAI cached tokens are part of input_tokens and long context raises every rate", () => {
  const short = readUsage("openai", { input_tokens: 100_000, input_tokens_details: { cached_tokens: 60_000 }, output_tokens: 10_000 });
  assert.deepEqual(short, { input: 40_000, cacheRead: 60_000, cacheWrite: 0, output: 10_000 });
  assert.equal(costMicrousd(pricing("gpt-6-sol"), short, offPeak), 40_000 * 2 + 60_000 * 0.2 + 10_000 * 10);
  const long = readUsage("openai", { input_tokens: 300_000, output_tokens: 0 });
  assert.equal(costMicrousd(pricing("gpt-6-sol"), long, offPeak), 300_000 * 4);
});

test("Anthropic cache writes use their own rate", () => {
  const usage = readUsage("anthropic", { input_tokens: 1_000, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 2_000, output_tokens: 500 });
  assert.equal(costMicrousd(pricing("claude-sonnet-5"), usage, offPeak), 1_000 * 2 + 10_000 * 0.2 + 2_000 * 2.5 + 500 * 10);
});

test("merges usage across Anthropic stream events", async () => {
  const sse = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10,"cache_read_input_tokens":90,"output_tokens":1}}}',
    'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":42,"input_tokens":null}}',
    ""
  ].join("\n\n");
  const usage = await extractUsage(new Response(sse).body!, "text/event-stream");
  assert.deepEqual(readUsage("anthropic", usage!), { input: 10, cacheRead: 90, cacheWrite: 0, output: 42 });
});

test("reads the usage of a completed Responses stream", async () => {
  const sse = 'data: {"type":"response.created","response":{"usage":null}}\n\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":5,"output_tokens":7}}}\n\n';
  const usage = await extractUsage(new Response(sse).body!, "text/event-stream");
  assert.deepEqual(readUsage("openai", usage!), { input: 5, cacheRead: 0, cacheWrite: 0, output: 7 });
});
