import assert from "node:assert/strict";
import test from "node:test";
import { clientResponse, prepareBody, requestHeaders } from "../src/upstream.ts";

test("drops fields that bill outside the token usage and tags the user", () => {
  assert.deepEqual(
    prepareBody("openai", { model: "gpt-6-luna", background: true, service_tier: "priority", input: [] }, "hash"),
    { model: "gpt-6-luna", input: [], safety_identifier: "hash" }
  );
  assert.deepEqual(
    prepareBody("anthropic", { model: "claude-sonnet-5", fallbacks: "default", speed: "fast", metadata: { a: 1 } }, "hash"),
    { model: "claude-sonnet-5", metadata: { a: 1, user_id: "hash" } }
  );
});

test("only client-side tools pass", () => {
  assert.ok(prepareBody("openai", { tools: [{ type: "function", name: "f" }] }, "hash"));
  assert.equal(prepareBody("openai", { tools: [{ type: "function" }, { type: "web_search" }] }, "hash"), null);
  assert.ok(prepareBody("anthropic", { tools: [{ name: "f", input_schema: {} }, { type: "custom", name: "g" }] }, "hash"));
  assert.equal(prepareBody("anthropic", { tools: [{ type: "web_search_20250305", name: "web_search" }] }, "hash"), null);
  assert.equal(prepareBody("deepseek", { tools: {} }, "hash"), null);
});

test("DeepSeek streams always carry usage", () => {
  assert.deepEqual(prepareBody("deepseek", { stream: true, stream_options: { include_usage: false } }, "hash"), {
    stream: true,
    stream_options: { include_usage: true },
    user_id: "hash"
  });
  assert.deepEqual(prepareBody("deepseek", { stream: false }, "hash"), { stream: false, user_id: "hash" });
});

test("forwards only provider headers and known Anthropic betas", () => {
  const headers = requestHeaders(new Headers({
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "files-api-2025-04-14, fast-mode-2026-02-01",
    "cf-aig-cache-ttl": "3600",
    "cf-aig-collect-log": "false",
    authorization: "Bearer token"
  }));
  assert.deepEqual([...headers], [
    ["anthropic-beta", "files-api-2025-04-14"],
    ["anthropic-version", "2023-06-01"],
    ["content-type", "application/json"]
  ]);
});

test("hides provider response headers", () => {
  const response = clientResponse(null, new Response(null, {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": "5", "openai-organization": "org" }
  }));
  assert.equal(response.status, 429);
  assert.deepEqual([...response.headers], [["content-type", "application/json"], ["retry-after", "5"]]);
});
