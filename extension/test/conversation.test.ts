import assert from "node:assert/strict";
import test from "node:test";
import type { ModelMessage } from "../src/shared/conversation.ts";
import { recentTurns, taggedMessage } from "../src/shared/conversation.ts";

test("recentTurns keeps question and answer text only", () => {
  const messages: ModelMessage[] = [
    taggedMessage("runtime_context", "date"),
    { role: "user", content: "question" },
    {
      role: "assistant",
      content: [
        { type: "reasoning", text: "thinking" },
        { type: "text", text: "checking" },
        { type: "tool-call", toolCallId: "1", toolName: "read", input: {} }
      ]
    },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "1", toolName: "read", output: { type: "text", value: "page" } }] },
    { role: "assistant", content: [{ type: "text", text: "answer" }] },
    taggedMessage("memory_update", "request")
  ];

  assert.deepEqual(recentTurns(messages, 10), [
    { role: "user", content: "question" },
    { role: "assistant", content: "checking\n\nanswer" }
  ]);
});

test("recentTurns limits to the latest turns and keeps unanswered questions", () => {
  const messages: ModelMessage[] = [
    ...Array.from({ length: 12 }, (_, index): ModelMessage[] => [
      { role: "user", content: `q${index}` },
      { role: "assistant", content: `a${index}` }
    ]).flat(),
    { role: "user", content: "cancelled" },
    taggedMessage("runtime_cancelled", "stopped")
  ];

  const turns = recentTurns(messages, 10);
  assert.equal(turns.filter((message) => message.role === "user").length, 10);
  assert.deepEqual(turns[0], { role: "user", content: "q3" });
  assert.deepEqual(turns.at(-1), { role: "user", content: "cancelled" });
});
