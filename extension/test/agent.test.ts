import assert from "node:assert/strict";
import test from "node:test";
import { jsonSchema, tool } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { streamAnswer } from "../src/background/agent.ts";
import { createConversationSystemPrompt, SYSTEM_PROMPT } from "../src/background/prompt.ts";
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

test("a conversation system prompt embeds the initial memory list as reference data", () => {
  const memoryList = JSON.stringify({ memories: [{ ref: "memory_1", title: "Preferences" }] });
  const prompt = createConversationSystemPrompt(memoryList);

  assert.ok(prompt.startsWith(SYSTEM_PROMPT));
  assert.ok(prompt.includes(memoryList));
  assert.match(prompt, /list\(type=memory\)/);
  assert.doesNotMatch(prompt, /list\(type=tab\)/);
});
