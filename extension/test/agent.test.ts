import assert from "node:assert/strict";
import test from "node:test";
import { jsonSchema, tool } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { streamAnswer } from "../src/background/agent.ts";
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
    return { type: "text" as const, content: value };
  },
  toModelOutput: ({ output }) => ({ type: "text" as const, value: output.content })
});

test("streamAnswer runs tool steps, reports tools, and hands each step's messages back", async () => {
  const model = new MockLanguageModelV3({
    doStream: [toolStep("call-1", '{"value":"hi"}'), toolStep("call-2", '{"value":"boom"}'), textStep("done")]
  });
  const tools: ToolDetail[] = [];
  const steps: number[] = [];
  let text = "";
  const result = await streamAnswer({ model, providerOptions: {} }, [{ role: "user", content: "q" }], { echo }, new AbortController().signal, {
    onDelta: (channel, delta) => { if (channel === "text") text += delta; },
    onTool: (detail) => tools.push(detail),
    onStep: (messages) => steps.push(messages.length)
  });

  assert.equal(result.error, undefined);
  assert.equal(text, "done");
  assert.deepEqual(steps, [2, 2, 1]);
  assert.deepEqual(tools.map((detail) => [detail.id, detail.output]), [
    ["call-1", null],
    ["call-1", { type: "text", content: "hi" }],
    ["call-2", null],
    ["call-2", { type: "error", error: "failed" }]
  ]);
  const prompt = model.doStreamCalls.at(-1)!.prompt;
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
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.partial.text, "par");
});
