import assert from "node:assert/strict";
import test from "node:test";
import { activateLocale, i18n, resolveLocale } from "../src/shared/i18n.ts";

test("browser languages resolve to a supported locale or the English fallback", () => {
  assert.equal(resolveLocale("ja-JP"), "ja");
  assert.equal(resolveLocale("JA_jp"), "ja");
  assert.equal(resolveLocale("en-US"), "en");
  assert.equal(resolveLocale("fr-CA"), "fr");
  assert.equal(resolveLocale("es-419"), "es");
  assert.equal(resolveLocale("pt-PT"), "pt-BR");
  assert.equal(resolveLocale("zh-CN"), "zh-Hans");
  assert.equal(resolveLocale("zh-Hans-SG"), "zh-Hans");
  assert.equal(resolveLocale("zh-TW"), "zh-Hant");
  assert.equal(resolveLocale("zh-Hant-HK"), "zh-Hant");
  assert.equal(resolveLocale("it-IT"), "it");
  assert.equal(resolveLocale("ru-RU"), "ru");
  assert.equal(resolveLocale("in-ID"), "id");
  assert.equal(resolveLocale("nl-NL"), "en");
});

test("English source messages and translations load", () => {
  const descriptor = { id: "errors.noResponse", message: "No response was received." };

  activateLocale("en");
  assert.equal(i18n._(descriptor), "No response was received.");

  activateLocale("ja");
  assert.equal(i18n._(descriptor), "回答を取得できませんでした。");

  activateLocale("zh-Hant");
  assert.equal(i18n._(descriptor), "未收到回答。");
});
