import assert from "node:assert/strict";
import test from "node:test";
import { jsonSchema, tool } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { anthropic } from "@ai-sdk/anthropic";
import { streamAnswer } from "../src/background/agent.ts";
import { formatMemoryContext, SYSTEM_PROMPT } from "../src/background/prompt.ts";
import { getMessageText, latestContext, taggedMessage } from "../src/shared/conversation.ts";
import type { ModelMessage } from "ai";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 }
};

function textStep(text: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start" as const, warnings: [] },
        { type: "text-start" as const, id: "t" },
        { type: "text-delta" as const, id: "t", delta: text },
        { type: "text-end" as const, id: "t" },
        { type: "finish" as const, usage, finishReason: { unified: "stop" as const, raw: undefined } }
      ]
    })
  };
}

function toolStep(toolCallId: string, input: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start" as const, warnings: [] },
        { type: "tool-call" as const, toolCallId, toolName: "echo", input },
        { type: "finish" as const, usage, finishReason: { unified: "tool-calls" as const, raw: undefined } }
      ]
    })
  };
}

const echo = tool({
  description: "echo",
  inputSchema: jsonSchema<{ value: string }>({ type: "object", properties: { value: { type: "string" } } }),
  execute: async ({ value }) => {
    if (value === "boom") throw new Error("failed");
    return { value };
  },
  toModelOutput: ({ output }) => ({ type: "text" as const, value: output.value })
});

test("streamAnswer streams each step as messages and hands the finished messages back", async () => {
  const model = new MockLanguageModelV3({
    doStream: [toolStep("call-1", '{"value":"hi"}'), toolStep("call-2", '{"value":"boom"}'), textStep("done")]
  });
  let live: ModelMessage[] = [];
  const lastLive: ModelMessage[][] = [];
  const steps: number[] = [];
  const toolErrors: string[] = [];
  const instructions = "conversation-specific system prompt";
  const result = await streamAnswer({ model, providerOptions: {} }, [{ role: "user", content: "q" }], { echo }, new AbortController().signal, {
    onUpdate: (step) => { live = step; },
    onStep: (messages) => {
      steps.push(messages.length);
      lastLive.push(live);
    },
    onToolError: (toolName, message) => toolErrors.push(`${toolName}: ${message}`)
  }, instructions);

  assert.equal(result.error, undefined);
  assert.deepEqual(steps, [2, 2, 1]);
  assert.deepEqual(toolErrors, ["echo: failed"]);
  assert.deepEqual(lastLive, [
    [
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "call-1", toolName: "echo", input: { value: "hi" } }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "call-1", toolName: "echo", output: { type: "text", value: '{"value":"hi"}' } }] }
    ],
    [
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "call-2", toolName: "echo", input: { value: "boom" } }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "call-2", toolName: "echo", output: { type: "error-text", value: "Error: failed" } }] }
    ],
    [{ role: "assistant", content: [{ type: "text", text: "done" }] }]
  ]);
  const prompt = model.doStreamCalls.at(-1)!.prompt;
  assert.equal(prompt.find((message) => message.role === "system")?.content, instructions);
  const outputs = prompt.flatMap((message) => message.role === "tool"
    ? message.content.map((part) => part.type === "tool-result" ? part.output : null)
    : []);
  assert.deepEqual(outputs, [
    { type: "text", value: "hi" },
    { type: "error-text", value: "Error: failed" }
  ]);
});

test("streamAnswer reports cancellation and keeps the partial text as a message", async () => {
  const controller = new AbortController();
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunkDelayInMs: 5,
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "text-start" as const, id: "t" },
          { type: "text-delta" as const, id: "t", delta: "par" },
          { type: "text-delta" as const, id: "t", delta: "tial" },
          { type: "text-end" as const, id: "t" },
          { type: "finish" as const, usage, finishReason: { unified: "stop" as const, raw: undefined } }
        ]
      })
    })
  });
  const result = await streamAnswer({ model, providerOptions: {} }, [{ role: "user", content: "q" }], {}, controller.signal, {
    onUpdate: () => controller.abort(),
    onStep: () => assert.fail("no step should finish")
  }, "instructions");
  assert.equal(result.cancelled, true);
  assert.deepEqual(result.partial, { role: "assistant", content: [{ type: "text", text: "par" }] });
});

test("streamAnswer resumes a turn paused with pause_turn by sending it back", async () => {
  const model = new MockLanguageModelV3({
    doStream: [
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { type: "text-start" as const, id: "t" },
            { type: "text-delta" as const, id: "t", delta: "par" },
            { type: "text-end" as const, id: "t" },
            { type: "finish" as const, usage, finishReason: { unified: "stop" as const, raw: "pause_turn" } }
          ]
        })
      },
      textStep("tial")
    ]
  });
  const steps: ModelMessage[][] = [];
  const result = await streamAnswer({ model, providerOptions: {} }, [{ role: "user", content: "q" }], {}, new AbortController().signal, {
    onUpdate: () => {},
    onStep: (messages) => steps.push(messages)
  }, "instructions");

  assert.equal(result.error, undefined);
  assert.deepEqual(steps.map((messages) => messages.map(getMessageText)), [["par"], ["tial"]]);
  const prompt = model.doStreamCalls[1]!.prompt;
  assert.deepEqual(prompt.at(-1)?.role, "assistant");
});

test("streamAnswer keeps the result of a provider-run tool in the assistant message", async () => {
  const model = new MockLanguageModelV3({
    doStream: [{
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "tool-call" as const, toolCallId: "s1", toolName: "web_search", input: '{"query":"news"}', providerExecuted: true },
          { type: "tool-result" as const, toolCallId: "s1", toolName: "web_search", result: [{ url: "https://example.com" }] },
          { type: "text-start" as const, id: "t" },
          { type: "text-delta" as const, id: "t", delta: "answer" },
          { type: "text-end" as const, id: "t" },
          { type: "finish" as const, usage, finishReason: { unified: "stop" as const, raw: "end_turn" } }
        ]
      })
    }]
  });
  const webSearch = anthropic.tools.webSearch_20250305();
  let live: ModelMessage[] = [];
  const saved: ModelMessage[][] = [];
  await streamAnswer({ model, providerOptions: {} }, [{ role: "user", content: "q" }], { web_search: webSearch }, new AbortController().signal, {
    onUpdate: (step) => { live = step; },
    onStep: (messages) => saved.push(messages)
  }, "instructions");

  const result = { type: "tool-result", toolCallId: "s1", toolName: "web_search", output: { type: "json", value: [{ url: "https://example.com" }] } };
  assert.deepEqual(live, [{
    role: "assistant",
    content: [{ type: "tool-call", toolCallId: "s1", toolName: "web_search", input: { query: "news" } }, result, { type: "text", text: "answer" }]
  }]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0]!.length, 1);
  assert.deepEqual((saved[0]![0]!.content as { type: string }[]).map((part) => part.type), ["tool-call", "tool-result", "text"]);
});

test("the memory list is reference data outside the fixed system prompt", () => {
  const memoryList = JSON.stringify({ memories: [{ ref: "memory_1", title: "Preferences" }] });
  const context = formatMemoryContext(memoryList);

  assert.ok(context.includes(memoryList));
  assert.match(context, /list\(type=memory\)/);
  assert.ok(!SYSTEM_PROMPT.includes(memoryList));
});

test("latestContext returns the newest context of a kind without its tag", () => {
  const messages: ModelMessage[] = [
    taggedMessage("memory_context", "old"),
    { role: "user", content: "q" },
    taggedMessage("memory_context", "new"),
    taggedMessage("runtime_context", "runtime")
  ];
  assert.equal(latestContext(messages, "memory_context"), "new");
  assert.equal(latestContext(messages, "browser_context"), undefined);
});
