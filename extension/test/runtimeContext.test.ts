import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeContext } from "../src/background/prompt.ts";

function context(locale: string, date: string, timezone: string) {
  return JSON.parse(createRuntimeContext(locale, new Date(date), timezone));
}

test("runtime date follows the device timezone across a UTC date boundary", () => {
  const tokyo = context("ja-JP", "2026-09-23T23:30:00Z", "Asia/Tokyo");
  const la = context("en-US", "2026-09-23T23:30:00Z", "America/Los_Angeles");
  assert.equal(tokyo.current_date, "2026-09-24");
  assert.equal(la.current_date, "2026-09-23");
  assert.equal(tokyo.timezone, "Asia/Tokyo");
  assert.deepEqual(tokyo.region, { value: "JP", source: "locale", inferred: true });
  assert.equal(la.preferred_answer_language, "en-US");
});

test("a language or timezone alone does not establish a region", () => {
  for (const locale of ["en", "ja", "invalid_locale"]) {
    assert.equal(context(locale, "2026-09-23T00:00:00Z", "Asia/Tokyo").region, null);
  }
});

test("runtime metadata refreshes on the next request", () => {
  const first = context("ja", "2026-09-23T14:59:59Z", "Asia/Tokyo");
  const next = context("ja", "2026-09-23T15:00:00Z", "Asia/Tokyo");
  assert.equal(first.current_date, "2026-09-23");
  assert.equal(next.current_date, "2026-09-24");
});
