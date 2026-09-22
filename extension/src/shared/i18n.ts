import { i18n } from "@lingui/core";
import { messages as enMessages } from "../locales/en/messages.ts";
import { messages as jaMessages } from "../locales/ja/messages.ts";

type AppLocale = "en" | "ja";

// Source modules can translate errors during tests before the extension entry point runs.
if (!i18n.locale) {
  i18n.load("en", {});
  i18n.activate("en");
}

export function resolveLocale(language: string): AppLocale {
  return language.toLowerCase().split(/[-_]/, 1)[0] === "ja" ? "ja" : "en";
}

export function activateLocale(locale: AppLocale): AppLocale {
  i18n.load({ en: enMessages, ja: jaMessages });
  i18n.activate(locale);
  return locale;
}

export function activateBrowserLocale(): AppLocale {
  return activateLocale(resolveLocale(browser.i18n.getUILanguage()));
}

export { i18n };
