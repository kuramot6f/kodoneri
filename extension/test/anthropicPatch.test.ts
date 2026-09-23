import assert from "node:assert/strict";
import test from "node:test";
import { createAnthropic } from "@ai-sdk/anthropic";

test("Anthropic converter sends tool file references as image blocks inside tool_result", async () => {
  let requestBody: { messages: unknown[] } = { messages: [] };
  let betaHeader = "";
  const anthropic = createAnthropic({
    apiKey: "test-key",
    fetch: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as { messages: unknown[] };
      betaHeader = String(new Headers(init?.headers).get("anthropic-beta") ?? "");
      return new Response(JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5",
        content: [{ type: "text", text: "done" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  await anthropic("claude-opus-5").doGenerate({
    prompt: [
      { role: "user", content: [{ type: "text", text: "capture" }] },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "tool-1", toolName: "capture", input: {} }]
      },
      {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "tool-1",
          toolName: "capture",
          output: {
            type: "content",
            value: [
              { type: "text", text: "Image attached." },
              {
                type: "file",
                mediaType: "image/png",
                data: { type: "reference", reference: { anthropic: "file-1" } }
              }
            ]
          }
        }]
      }
    ]
  });

  assert.deepEqual(requestBody.messages.at(-1), {
    role: "user",
    content: [{
      type: "tool_result",
      tool_use_id: "tool-1",
      content: [
        { type: "text", text: "Image attached." },
        { type: "image", source: { type: "file", file_id: "file-1" } }
      ]
    }]
  });
  assert.match(betaHeader, /files-api-2025-04-14/);
});
