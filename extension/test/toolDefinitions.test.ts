import assert from "node:assert/strict";
import test from "node:test";
import { grepInput, interactInput, navigateInput, newInput, patchInput, renameInput } from "../src/background/toolDefinitions.ts";

const ok = (schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) => assert.equal(schema.safeParse(value).success, true, JSON.stringify(value));
const fails = (schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) => assert.equal(schema.safeParse(value).success, false, JSON.stringify(value));

test("grep needs a ref except for collection resource types, which take none", () => {
  ok(grepInput, { pattern: "a", context: 10, ref: "tab_2", resource_type: "style" });
  ok(grepInput, { pattern: "a", context: 10, resource_type: "memory" });
  ok(grepInput, { pattern: "a", context: 10, ref: "https://example.com/a.js" });
  fails(grepInput, { pattern: "a", context: 10 });
  fails(grepInput, { pattern: "a", context: 10, resource_type: "style" });
  fails(grepInput, { pattern: "a", context: 10, ref: "tab_2", resource_type: "session" });
  fails(grepInput, { pattern: "a", context: 10, ref: ["tab_2"], resource_type: "style" });
});

test("navigate requires ref and url exactly where the action needs them", () => {
  ok(navigateInput, { action: "back", ref: "tab_2" });
  ok(navigateInput, { action: "open_tab", url: "https://example.com" });
  ok(navigateInput, { action: "go_to", ref: "tab_2", url: "https://example.com" });
  fails(navigateInput, { action: "open_tab" });
  fails(navigateInput, { action: "back" });
  fails(navigateInput, { action: "go_to", url: "https://example.com" });
  fails(navigateInput, { action: "open_tab", url: "https://example.com", ref: "tab_2" });
  fails(navigateInput, { action: "switch_tab", ref: "iframe_1" });
  fails(navigateInput, { action: "reload", ref: "tab_2", url: "https://example.com" });
  fails(navigateInput, { action: "back", ref: "tab_2", extra: true });
});

test("interact takes a value only for type, press, and select", () => {
  ok(interactInput, { ref: "tab_1_iframe_2", action: "type", query: "input", value: "x" });
  ok(interactInput, { ref: "tab_1", action: "click", query: "a" });
  fails(interactInput, { ref: "tab_1", action: "type", query: "input" });
  fails(interactInput, { ref: "tab_1", action: "check", query: "input", value: "x" });
  fails(interactInput, { ref: "tab_1_img_1", action: "click", query: "a" });
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
