import assert from "node:assert/strict";
import test from "node:test";
import { costMicrousd, readUsage } from "../src/usage.ts";

const sse = (...events: unknown[]) => events.map((event) => `event: x\ndata: ${JSON.stringify(event)}\n\n`).join("");

test("reads OpenAI usage from the completed event", () => {
  const body = sse(
    { type: "response.created", response: { usage: null } },
    { type: "response.output_text.delta", delta: "hi" },
    { type: "response.completed", response: { usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 40 }, output_tokens: 7 } } }
  );
  assert.deepEqual(readUsage("openai", body), { input: 60, cachedInput: 40, cacheWrite: 0, output: 7 });
});

test("merges Anthropic usage across message_start and message_delta", () => {
  const body = sse(
    { type: "message_start", message: { usage: { input_tokens: 10, cache_read_input_tokens: 500, cache_creation_input_tokens: 20, output_tokens: 1 } } },
    { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } },
    { type: "message_delta", usage: { output_tokens: 30 } },
    { type: "message_stop" }
  );
  assert.deepEqual(readUsage("anthropic", body), { input: 10, cachedInput: 500, cacheWrite: 20, output: 30 });
});

test("reads DeepSeek usage from the last chunk and from a JSON body", () => {
  const usage = { prompt_tokens: 100, prompt_cache_hit_tokens: 80, completion_tokens: 5 };
  const expected = { input: 20, cachedInput: 80, cacheWrite: 0, output: 5 };
  assert.deepEqual(readUsage("deepseek", sse({ choices: [], usage: null }, { choices: [], usage }) + "data: [DONE]\n\n"), expected);
  assert.deepEqual(readUsage("deepseek", JSON.stringify({ choices: [], usage })), expected);
});

test("a body without usage reads as none", () => {
  assert.equal(readUsage("openai", sse({ type: "response.output_text.delta", delta: "hi" })), null);
});

test("prices tokens per million in microUSD", () => {
  // Opus 5.5: $4 input, $0.20 cache read, $5 cache write, $20 output.
  assert.equal(costMicrousd("claude-opus-5-5", { input: 1000, cachedInput: 10_000, cacheWrite: 100, output: 500 }), 4000 + 2000 + 500 + 10_000);
  // Without a cache write price, writes cost input.
  assert.equal(costMicrousd("gpt-6-luna", { input: 0, cachedInput: 0, cacheWrite: 10, output: 0 }), 1);
});
