import assert from "node:assert/strict";
import test from "node:test";
import { createDeepSeek } from "@ai-sdk/deepseek";

test("DeepSeek converter emits tool files as one trailing user message", async () => {
  let requestMessages: unknown[] = [];
  const deepSeek = createDeepSeek({
    apiKey: "test-key",
    fetch: async (_input, init) => {
      const requestBody = JSON.parse(String(init?.body)) as { messages: unknown[] };
      requestMessages = requestBody.messages;
      return new Response(JSON.stringify({
        id: "response-1",
        object: "chat.completion",
        choices: [{
          index: 0,
          message: { role: "assistant", content: "done" },
          finish_reason: "stop"
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  await deepSeek("deepseek-flash").doGenerate({
    prompt: [
      { role: "user", content: [{ type: "text", text: "capture" }] },
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "tool-1", toolName: "capture", input: {} },
          { type: "tool-call", toolCallId: "tool-2", toolName: "capture", input: {} }
        ]
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tool-1",
            toolName: "capture",
            output: {
              type: "content",
              value: [
                { type: "text", text: "first image" },
                {
                  type: "file",
                  mediaType: "image/png",
                  data: { type: "reference", reference: { deepseek: "file-1" } }
                }
              ]
            }
          },
          {
            type: "tool-result",
            toolCallId: "tool-2",
            toolName: "capture",
            output: {
              type: "content",
              value: [
                { type: "text", text: "second image" },
                {
                  type: "file",
                  mediaType: "image/webp",
                  data: { type: "reference", reference: { deepseek: "file-2" } }
                }
              ]
            }
          }
        ]
      },
      { role: "user", content: [{ type: "text", text: "continue" }] }
    ]
  });

  assert.deepEqual(requestMessages.slice(-4), [
    { role: "tool", tool_call_id: "tool-1", content: "first image" },
    { role: "tool", tool_call_id: "tool-2", content: "second image" },
    {
      role: "user",
      content: [
        { type: "file", file_id: "file-1" },
        { type: "file", file_id: "file-2" }
      ]
    },
    { role: "user", content: "continue" }
  ]);
});
