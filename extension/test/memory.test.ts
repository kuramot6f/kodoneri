import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMemoryEdits,
  MEMORY_CONTENT_MAX_LENGTH,
  parseMemoryWriteCall
} from "../src/shared/memory.ts";

test("patch edits apply in order and an empty replacement removes a statement", () => {
  const content = "- uses X\n- likes tea\n";
  assert.equal(
    applyMemoryEdits(content, [
      { old: "uses X", new: "used X until 2026-09; now uses Y" },
      { old: "- likes tea\n", new: "" }
    ]),
    "- used X until 2026-09; now uses Y\n"
  );
});

test("patch rejects stale, ambiguous, empty, and oversized results", () => {
  assert.throws(() => applyMemoryEdits("- a", [{ old: "b", new: "c" }]), /does not match/);
  assert.throws(() => applyMemoryEdits("- a\n- a", [{ old: "a", new: "c" }]), /more than once/);
  assert.throws(() => applyMemoryEdits("- a", [{ old: "- a", new: " " }]), /become empty/);
  assert.throws(
    () => applyMemoryEdits("- a", [{ old: "a", new: "b".repeat(MEMORY_CONTENT_MAX_LENGTH) }]),
    /no more than 1000 characters/
  );
});

test("write calls validate refs, titles, and content", () => {
  assert.deepEqual(
    parseMemoryWriteCall("new", '{"title":" Project ","content":"notes"}'),
    { name: "new", title: "Project", content: "notes" }
  );
  assert.deepEqual(
    parseMemoryWriteCall("patch", '{"ref":"memory_1","edits":[{"old":"a","new":""}]}'),
    { name: "patch", ref: "memory_1", edits: [{ old: "a", new: "" }] }
  );
  assert.deepEqual(parseMemoryWriteCall("delete", '{"ref":"memory_1"}'), { name: "delete", ref: "memory_1" });
  assert.throws(() => parseMemoryWriteCall("rename", '{"ref":"session_1","title":"t"}'), /memory_/);
  assert.throws(() => parseMemoryWriteCall("rename", '{"ref":"memory_1","title":""}'), /title/);
  assert.throws(() => parseMemoryWriteCall("patch", '{"ref":"memory_1","edits":[]}'), /edit/);
  assert.throws(() => parseMemoryWriteCall("patch", '{"ref":"memory_1","edits":[{"old":"","new":"x"}]}'), /old/);
  assert.throws(() => parseMemoryWriteCall("new", `{"title":"t","content":"${"x".repeat(1001)}"}`), /1000/);
});
