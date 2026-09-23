import { defineConfig } from "@lingui/cli";

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "ja", "es", "pt-BR", "de", "fr", "ko", "zh-Hans", "zh-Hant", "it", "ru", "vi", "tr", "id"],
  catalogs: [
    {
      path: "<rootDir>/src/locales/{locale}/messages",
      include: ["src"]
    }
  ]
});
