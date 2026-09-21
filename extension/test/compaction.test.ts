import assert from "node:assert/strict";
import test from "node:test";
import type { ModelMessage } from "../src/shared/conversation.ts";
import { getMeta, taggedMessage } from "../src/shared/conversation.ts";
import {
  applyCompaction,
  COMPACTION_THRESHOLD_RATIO,
  planCompaction
} from "../src/background/compaction.ts";

const WINDOW = 1_000_000;

function conversation(turns: number): ModelMessage[] {
  return [
    ...Array.from({ length: turns }, (_, index): ModelMessage[] => [
      taggedMessage("browser_context", `context ${index + 1}`),
      { role: "user", content: `question ${index + 1}` },
      { role: "assistant", content: `answer ${index + 1}` }
    ]).flat()
  ];
}

test("planCompaction triggers at 80% and keeps five complete recent turns", () => {
  const messages = conversation(6);
  const plan = planCompaction(messages, WINDOW * COMPACTION_THRESHOLD_RATIO, WINDOW);

  assert.ok(plan);
  assert.deepEqual(plan.prefix, messages.slice(0, 3));
  assert.equal(plan.prefixMessageCount, 3);
  assert.deepEqual(messages.slice(plan.prefixMessageCount), conversation(6).slice(3));
});

test("planCompaction does not trigger below threshold or without an older turn", () => {
  assert.equal(planCompaction(conversation(6), WINDOW * COMPACTION_THRESHOLD_RATIO - 1, WINDOW), null);
  assert.equal(planCompaction(conversation(5), WINDOW * COMPACTION_THRESHOLD_RATIO, WINDOW), null);
  assert.equal(planCompaction(conversation(6), null, WINDOW), null);
});

test("applyCompaction replaces the old prefix and preserves the recent tail verbatim", () => {
  const messages = conversation(6);
  const plan = planCompaction(messages, WINDOW * COMPACTION_THRESHOLD_RATIO, WINDOW);
  assert.ok(plan);

  const compacted = applyCompaction(messages, {
    prefixMessageCount: plan.prefixMessageCount,
    content: "checkpoint"
  });

  assert.deepEqual(compacted[0], taggedMessage("compaction", "checkpoint"));
  assert.deepEqual(compacted.slice(1), messages.slice(plan.prefixMessageCount));
  assert.equal(compacted[1], messages[plan.prefixMessageCount]);
});

test("a prior checkpoint is folded into the next compacted prefix", () => {
  const messages: ModelMessage[] = [
    taggedMessage("compaction", "old checkpoint"),
    ...conversation(6)
  ];
  const plan = planCompaction(messages, WINDOW * COMPACTION_THRESHOLD_RATIO, WINDOW);

  assert.ok(plan);
  assert.equal(plan.prefix[0], messages[0]);
  const compacted = applyCompaction(messages, {
    prefixMessageCount: plan.prefixMessageCount,
    content: "new checkpoint"
  });
  assert.equal(compacted.filter((message) => getMeta(message).kind === "compaction").length, 1);
});
