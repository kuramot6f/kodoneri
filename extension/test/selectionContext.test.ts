import assert from "node:assert/strict";
import { test } from "node:test";
import { formatSelectionContext, parseSelectionContext } from "../src/shared/selectionContext.ts";

test("parseSelectionContext restores text and media count from formatted content", () => {
  const content = formatSelectionContext({
    text: "選択テキスト:\n入れ子の見出し\n\n選択メディア:\nではない本文",
    media: [
      { type: "img", ref: "tab_1_img_1", alt: "図" },
      { type: "video", ref: "tab_1_video_1" }
    ]
  });
  assert.deepEqual(parseSelectionContext(content), {
    text: "選択テキスト:\n入れ子の見出し\n\n選択メディア:\nではない本文",
    mediaCount: 2
  });
});

test("parseSelectionContext handles text-only and media-only selections", () => {
  assert.deepEqual(parseSelectionContext(formatSelectionContext({ text: "abc", media: [] })), {
    text: "abc",
    mediaCount: 0
  });
  assert.deepEqual(parseSelectionContext(formatSelectionContext({
    text: "",
    media: [{ type: "canvas", ref: "tab_1_canvas_1" }]
  })), { text: "", mediaCount: 1 });
});
