import assert from "node:assert/strict";
import test from "node:test";
import { activateLocale, i18n, resolveLocale } from "../src/shared/i18n.ts";

test("browser languages resolve to Japanese or the English fallback", () => {
  assert.equal(resolveLocale("ja-JP"), "ja");
  assert.equal(resolveLocale("JA_jp"), "ja");
  assert.equal(resolveLocale("en-US"), "en");
  assert.equal(resolveLocale("fr-FR"), "en");
});

test("English source messages and Japanese translations both load", () => {
  const descriptor = { id: "errors.unknown", message: "An unknown error occurred." };

  activateLocale("en");
  assert.equal(i18n._(descriptor), "An unknown error occurred.");

  activateLocale("ja");
  assert.equal(i18n._(descriptor), "不明なエラーが発生しました。");
});
