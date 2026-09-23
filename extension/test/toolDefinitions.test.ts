import assert from "node:assert/strict";
import test from "node:test";
import { captureViewportInput, grepInput, interactInput, navigateInput, newInput, openInput, patchInput, renameInput } from "../src/background/toolDefinitions.ts";

const ok = (schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) => assert.equal(schema.safeParse(value).success, true, JSON.stringify(value));
const fails = (schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) => assert.equal(schema.safeParse(value).success, false, JSON.stringify(value));

// Models tend to fill every field they see, so an inapplicable field is ignored; only a missing one fails.

test("grep needs a ref except for collection resource types, which ignore it", () => {
  ok(grepInput, { pattern: "a", context: 10, ref: "tab_2", resource_type: "style" });
  ok(grepInput, { pattern: "a", context: 10, resource_type: "memory" });
  ok(grepInput, { pattern: "a", context: 10, ref: "https://example.com/a.js" });
  ok(grepInput, { pattern: "a", context: 10, ref: "tab_2", resource_type: "session" });
  fails(grepInput, { pattern: "a", context: 10 });
  fails(grepInput, { pattern: "a", context: 10, resource_type: "style" });
  fails(grepInput, { pattern: "a", context: 10, ref: ["tab_2"], resource_type: "style" });
});

test("open takes a url and an optional tab ref", () => {
  ok(openInput, { url: "https://example.com" });
  ok(openInput, { url: "https://example.com", ref: "tab_2" });
  fails(openInput, { ref: "tab_2" });
  fails(openInput, { url: "https://example.com", ref: "tab_2_iframe_1" });
});

test("navigate requires a tab ref and ignores extra fields", () => {
  ok(navigateInput, { action: "back", ref: "tab_2" });
  ok(navigateInput, { action: "switch_tab", ref: "tab_2", url: "https://example.com" });
  assert.deepEqual(navigateInput.parse({ action: "switch_tab", ref: "tab_2", url: "https://example.com" }), { action: "switch_tab", ref: "tab_2" });
  fails(navigateInput, { action: "back" });
  fails(navigateInput, { action: "open", ref: "tab_2", url: "https://example.com" });
  fails(navigateInput, { action: "switch_tab", ref: "iframe_1" });
});

test("interact requires a value for type, press, and select and ignores it otherwise", () => {
  ok(interactInput, { ref: "tab_1_iframe_2", action: "type", query: "input", value: "x" });
  ok(interactInput, { ref: "tab_1", action: "click", query: "a" });
  ok(interactInput, { ref: "tab_1", action: "check", query: "input", value: "x" });
  fails(interactInput, { ref: "tab_1", action: "type", query: "input" });
  fails(interactInput, { ref: "tab_1_img_1", action: "click", query: "a" });
});

test("capture_viewport ignores extra fields", () => {
  ok(captureViewportInput, { ref: "tab_2" });
});

test("memory writes validate refs, titles, and content", () => {
  assert.deepEqual(newInput.parse({ title: " Project ", content: "notes" }), { title: "Project", content: "notes" });
  ok(patchInput, { ref: "memory_1", edits: [{ old: "a", new: "" }] });
  fails(renameInput, { ref: "session_1", title: "t" });
  fails(renameInput, { ref: "memory_1", title: " " });
  fails(patchInput, { ref: "memory_1", edits: [] });
  fails(patchInput, { ref: "memory_1", edits: [{ old: "", new: "x" }] });
  fails(newInput, { title: "t", content: "x".repeat(1001) });
});
