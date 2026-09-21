import assert from "node:assert/strict";
import test from "node:test";
import { parseNavigateArgs } from "../src/background/navigationTools.ts";

test("parses every navigate action", () => {
  assert.deepEqual(parseNavigateArgs('{"action":"back","ref":"tab_2"}'), { action: "back", ref: "tab_2" });
  assert.deepEqual(parseNavigateArgs('{"action":"forward","ref":"tab_2"}'), {
    action: "forward",
    ref: "tab_2"
  });
  assert.deepEqual(parseNavigateArgs('{"action":"reload","ref":"tab_2"}'), { action: "reload", ref: "tab_2" });
  assert.deepEqual(parseNavigateArgs('{"action":"open_tab","url":"https://example.com"}'), {
    action: "open_tab",
    url: "https://example.com"
  });
  assert.deepEqual(parseNavigateArgs('{"action":"close_tab","ref":"tab_2"}'), {
    action: "close_tab",
    ref: "tab_2"
  });
  assert.deepEqual(parseNavigateArgs('{"action":"switch_tab","ref":"tab_2"}'), {
    action: "switch_tab",
    ref: "tab_2"
  });
  assert.deepEqual(parseNavigateArgs('{"action":"go_to","url":"https://example.com","ref":"tab_2"}'), {
    action: "go_to",
    ref: "tab_2",
    url: "https://example.com"
  });
});

test("rejects invalid navigate arguments", () => {
  assert.throws(() => parseNavigateArgs('{"action":"open_tab"}'), /url/);
  assert.throws(() => parseNavigateArgs('{"action":"close_tab"}'), /ref/);
  assert.throws(() => parseNavigateArgs('{"action":"back"}'), /ref/);
  assert.throws(() => parseNavigateArgs('{"action":"go_to","url":"https://example.com"}'), /ref/);
  assert.throws(() => parseNavigateArgs('{"action":"open_tab","url":"https://example.com","ref":"tab_2"}'), /ref/);
  assert.throws(() => parseNavigateArgs('{"action":"switch_tab","ref":"iframe_1"}'), /ref/);
  assert.throws(() => parseNavigateArgs('{"action":"reload","ref":"tab_2","url":"https://example.com"}'), /url/);
  assert.throws(() => parseNavigateArgs('{"action":"back","ref":"tab_2","extra":true}'), /未対応/);
});
