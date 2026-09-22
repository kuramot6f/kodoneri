import assert from "node:assert/strict";
import test from "node:test";
import { jsonSchema, tool } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { streamAnswer } from "../src/background/agent.ts";
import { createConversationSystemPrompt, SYSTEM_PROMPT } from "../src/background/prompt.ts";
import type { ToolDetail } from "../src/shared/protocol.ts";

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

test("streamAnswer runs tool steps, reports tools, and hands each step's messages back", async () => {
  const model = new MockLanguageModelV3({
    doStream: [toolStep("call-1", '{"value":"hi"}'), toolStep("call-2", '{"value":"boom"}'), textStep("done")]
  });
  const tools: ToolDetail[] = [];
  const steps: number[] = [];
  let text = "";
  const instructions = "conversation-specific system prompt";
  const result = await streamAnswer({ model, providerOptions: {} }, [{ role: "user", content: "q" }], { echo }, new AbortController().signal, {
    onDelta: (channel, delta) => { if (channel === "text") text += delta; },
    onTool: (detail) => tools.push(detail),
    onStep: (messages) => steps.push(messages.length)
  }, instructions);

  assert.equal(result.error, undefined);
  assert.equal(text, "done");
  assert.deepEqual(steps, [2, 2, 1]);
  assert.deepEqual(tools.map((detail) => [detail.id, detail.result, detail.error ?? false]), [
    ["call-1", null, false],
    ["call-1", JSON.stringify({ value: "hi" }, null, 2), false],
    ["call-2", null, false],
    ["call-2", "failed", true]
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

test("streamAnswer reports cancellation and keeps the partial text", async () => {
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
    onDelta: () => controller.abort(),
    onTool: () => undefined,
    onStep: () => assert.fail("no step should finish")
  }, "instructions");
  assert.equal(result.cancelled, true);
  assert.equal(result.partial.text, "par");
});

test("a conversation system prompt embeds the initial memory list as reference data", () => {
  const memoryList = JSON.stringify({ memories: [{ ref: "memory_1", title: "Preferences" }] });
  const prompt = createConversationSystemPrompt(memoryList);

  assert.ok(prompt.startsWith(SYSTEM_PROMPT));
  assert.ok(prompt.includes(memoryList));
  assert.match(prompt, /list\(type=memory\)/);
  assert.doesNotMatch(prompt, /list\(type=tab\)/);
});
