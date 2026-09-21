import assert from "node:assert/strict";
import test from "node:test";
import { parseTextToolCall } from "../src/shared/htmlTools.ts";

test("grep scopes script/style/svg resource types by a single tab or iframe ref", () => {
  const call = parseTextToolCall("grep", '{"pattern":"a","context":10,"ref":"tab_2","resource_type":"style"}');
  assert.equal(call.name, "grep");
  assert.deepEqual(call.args, { pattern: "a", context: 10, offset: 0, ref: "tab_2", resourceType: "style" });
  assert.throws(
    () => parseTextToolCall("grep", '{"pattern":"a","context":10,"ref":["tab_2","tab_3"],"resource_type":"style"}'),
    /string/
  );
});

test("grep rejects a ref with session or tab resource types", () => {
  assert.throws(
    () => parseTextToolCall("grep", '{"pattern":"a","context":10,"ref":"tab_2","resource_type":"session"}'),
    /session/
  );
  assert.throws(
    () => parseTextToolCall("grep", '{"pattern":"a","context":10,"ref":"tab_2","resource_type":"tab"}'),
    /tab/
  );
});

test("grep accepts resource_type=memory without a ref and rejects it with one", () => {
  const call = parseTextToolCall("grep", '{"pattern":"a","context":10,"resource_type":"memory"}');
  assert.equal(call.name === "grep" && call.args.resourceType, "memory");
  assert.throws(
    () => parseTextToolCall("grep", '{"pattern":"a","context":10,"ref":"memory_1","resource_type":"memory"}'),
    /memory/
  );
});
