import assert from "node:assert/strict";
import test from "node:test";
import { aggregateGrep, parseGrepResult } from "../src/shared/aggregateGrep.ts";
import { isToolOutput, stripToolImageData } from "../src/shared/toolOutput.ts";

const textOutput = (value: Record<string, unknown>) => ({
  type: "text" as const,
  content: JSON.stringify(value)
});

test("parseGrepResult rejects malformed results", () => {
  assert.equal(parseGrepResult("not json"), null);
  assert.equal(parseGrepResult('{"scannedMatches":1,"matches":[]}'), null);
});

test("aggregateGrep applies one offset across resources", async () => {
  const offsets: number[] = [];
  const result = await aggregateGrep({
    resources: [{ ref: "first" }, { ref: "second" }],
    args: { offset: 3 },
    run: async ({ ref }, offset) => {
      offsets.push(offset);
      return ref === "first"
        ? textOutput({ scannedMatches: 2, totalMatches: 2, hasMore: false, matches: [] })
        : textOutput({ scannedMatches: 2, totalMatches: 4, hasMore: false, matches: ["match"] });
    },
    nonTextError: "unexpected image"
  });

  assert.deepEqual(offsets, [3, 1]);
  assert.equal(result.returnedMatches, 1);
  assert.deepEqual(result.results, [{ ref: "second", scannedMatches: 2, totalMatches: 4, matches: ["match"] }]);
});

test("aggregateGrep keeps per-resource metadata and errors", async () => {
  const result = await aggregateGrep({
    resources: [{ ref: "broken", title: "Broken" }, { ref: "valid", title: "Valid" }],
    args: { offset: 0 },
    run: async ({ ref }) => ref === "broken"
      ? { type: "error", error: "failed" }
      : textOutput({ scannedMatches: 1, hasMore: false, matches: ["ok"] }),
    metadata: ({ ref, title }) => ({ ref, title }),
    nonTextError: "unexpected image"
  });

  assert.equal("resourceType" in result, false);
  assert.deepEqual(result.errors, [{ ref: "broken", error: "failed" }]);
  assert.deepEqual(result.results, [{
    ref: "valid",
    title: "Valid",
    scannedMatches: 1,
    matches: ["ok"]
  }]);
});

test("aggregateGrep reports another resource after the 20-result limit", async () => {
  const result = await aggregateGrep({
    resources: [{ ref: "first" }, { ref: "second" }],
    args: { offset: 0 },
    run: async ({ ref }) => textOutput({
      scannedMatches: ref === "first" ? 20 : 1,
      hasMore: false,
      matches: ref === "first" ? Array.from({ length: 20 }, (_, index) => index) : [20]
    }),
    nonTextError: "unexpected image"
  });

  assert.equal(result.returnedMatches, 20);
  assert.equal(result.hasMore, true);
  assert.equal(result.nextOffset, 20);
});

test("isToolOutput validates each output shape", () => {
  assert.equal(isToolOutput({ type: "text", content: "ok" }), true);
  assert.equal(isToolOutput({ type: "error", error: "failed" }), true);
  assert.equal(isToolOutput({
    type: "image",
    dataUrl: "data:image/png;base64,",
    mimeType: "image/png",
    byteLength: 0
  }), true);
  assert.equal(isToolOutput({ type: "image", dataUrl: "missing metadata" }), false);
});

test("stripToolImageData releases base64 while preserving display metadata", () => {
  assert.deepEqual(stripToolImageData({
    type: "image",
    dataUrl: "data:image/png;base64,AQID",
    mimeType: "image/png",
    byteLength: 3
  }), {
    type: "image",
    dataUrl: "",
    mimeType: "image/png",
    byteLength: 3
  });
});
