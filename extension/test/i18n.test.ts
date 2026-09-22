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
  const descriptor = { id: "errors.noResponse", message: "No response was received." };

  activateLocale("en");
  assert.equal(i18n._(descriptor), "No response was received.");

  activateLocale("ja");
  assert.equal(i18n._(descriptor), "回答を取得できませんでした。");
});
