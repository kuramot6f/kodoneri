import { i18n } from "@lingui/core";
import { messages as de } from "../locales/de/messages.ts";
import { messages as en } from "../locales/en/messages.ts";
import { messages as es } from "../locales/es/messages.ts";
import { messages as fr } from "../locales/fr/messages.ts";
import { messages as id } from "../locales/id/messages.ts";
import { messages as it } from "../locales/it/messages.ts";
import { messages as ja } from "../locales/ja/messages.ts";
import { messages as ko } from "../locales/ko/messages.ts";
import { messages as ptBR } from "../locales/pt-BR/messages.ts";
import { messages as ru } from "../locales/ru/messages.ts";
import { messages as tr } from "../locales/tr/messages.ts";
import { messages as vi } from "../locales/vi/messages.ts";
import { messages as zhHans } from "../locales/zh-Hans/messages.ts";
import { messages as zhHant } from "../locales/zh-Hant/messages.ts";

const catalogs = { en, ja, es, "pt-BR": ptBR, de, fr, ko, "zh-Hans": zhHans, "zh-Hant": zhHant, it, ru, vi, tr, id };

type AppLocale = keyof typeof catalogs;

// Source modules can translate errors during tests before the extension entry point runs.
if (!i18n.locale) {
  i18n.load("en", {});
  i18n.activate("en");
}

export function resolveLocale(language: string): AppLocale {
  const [base, ...rest] = language.toLowerCase().split(/[-_]/);
  switch (base) {
    case "ja":
    case "es":
    case "de":
    case "fr":
    case "ko":
    case "it":
    case "ru":
    case "vi":
    case "tr":
    case "id":
      return base;
    // Older platforms still report Indonesian by its withdrawn code.
    case "in":
      return "id";
    case "pt":
      return "pt-BR";
    case "zh":
      return rest.some((part) => ["hant", "tw", "hk", "mo"].includes(part)) ? "zh-Hant" : "zh-Hans";
    default:
      return "en";
  }
}

export function activateLocale(locale: AppLocale): AppLocale {
  i18n.load(catalogs);
  i18n.activate(locale);
  return locale;
}

export function activateBrowserLocale(): AppLocale {
  return activateLocale(resolveLocale(browser.i18n.getUILanguage()));
}

export { i18n };
