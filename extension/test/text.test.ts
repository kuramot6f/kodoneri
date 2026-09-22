import assert from "node:assert/strict";
import test from "node:test";
import { aggregateGrep, grepText, type GrepResult } from "../src/shared/text.ts";

const result = (scannedMatches: number, matches: number, hasMore = false): GrepResult => ({
  totalCharacters: 0,
  scannedMatches,
  ...(hasMore ? {} : { totalMatches: scannedMatches }),
  offset: 0,
  returnedMatches: matches,
  hasMore,
  matches: Array.from({ length: matches }, (_, index) => ({ matchOffset: index, matchEnd: index, before: "", match: "", matchTruncated: false, after: "" }))
});

test("grepText pages through matches with offset", () => {
  const text = "a".repeat(25);
  const first = grepText(text, { pattern: "a", context: 0 });
  assert.equal(first.returnedMatches, 20);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextOffset, 20);
  const second = grepText(text, { pattern: "a", context: 0, offset: 20 });
  assert.equal(second.returnedMatches, 5);
  assert.equal(second.totalMatches, 25);
});

test("aggregateGrep applies one offset across resources", async () => {
  const offsets: number[] = [];
  const output = await aggregateGrep([{ ref: "first" }, { ref: "second" }], 3, async ({ ref }, offset) => {
    offsets.push(offset);
    return ref === "first" ? result(2, 0) : result(4, 1);
  });
  assert.deepEqual(offsets, [3, 1]);
  assert.equal(output.returnedMatches, 1);
  assert.equal(output.results.length, 1);
  assert.equal(output.results[0]!.ref, "second");
});

test("aggregateGrep keeps per-resource metadata and errors", async () => {
  const output = await aggregateGrep(
    [{ ref: "broken", title: "Broken" }, { ref: "valid", title: "Valid" }],
    0,
    async ({ ref }) => {
      if (ref === "broken") throw new Error("failed");
      return result(1, 1);
    },
    ({ ref, title }) => ({ ref, title })
  );
  assert.deepEqual(output.errors, [{ ref: "broken", error: "failed" }]);
  assert.equal(output.results[0]!.title, "Valid");
});

test("aggregateGrep reports another resource after the 20-result limit", async () => {
  const output = await aggregateGrep([{ ref: "first" }, { ref: "second" }], 0, async ({ ref }) => ref === "first" ? result(20, 20) : result(1, 1));
  assert.equal(output.returnedMatches, 20);
  assert.equal(output.hasMore, true);
  assert.equal(output.nextOffset, 20);
});
