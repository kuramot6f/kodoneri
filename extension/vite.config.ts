import { defineConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { lingui, linguiTransformerBabelPreset } from "@lingui/vite-plugin";
import babel from "@rolldown/plugin-babel";

export default defineConfig(({ mode }) => {
  const isContent = mode === "content";
  const babelPresets = [
    linguiTransformerBabelPreset(),
    ...(isContent ? [reactCompilerPreset()] : [])
  ];

  return {
    plugins: [
      react(),
      lingui(),
      babel({ presets: babelPresets })
    ],
    publicDir: isContent ? "public" : false,
    define: {
      "process.env.NODE_ENV": JSON.stringify("production")
    },
    build: {
      // dist/ は生成物。Xcode の "Build Web Extension" フェーズが appex へコピーする。
      outDir: "dist",
      emptyOutDir: isContent,
      copyPublicDir: isContent,
      lib: {
        entry: isContent ? "src/content/main.tsx" : "src/background/main.ts",
        name: isContent ? "WebPageChatContent" : undefined,
        formats: [isContent ? "iife" : "es"],
        fileName: () => isContent ? "content.js" : "background.js",
        cssFileName: "styles"
      }
    }
  };
});
