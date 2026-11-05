import { defineConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { lingui, linguiTransformerBabelPreset } from "@lingui/vite-plugin";
import babel from "@rolldown/plugin-babel";

export default defineConfig(({ mode }) => {
  const isContent = mode === "content";
  const isInterpreter = mode === "interpreter";
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
        entry: isInterpreter ? "src/page/interpreter.ts" : isContent ? "src/content/main.tsx" : "src/background/main.ts",
        name: isInterpreter ? "ChatextInterpreter" : isContent ? "WebPageChatContent" : undefined,
        formats: [isContent || isInterpreter ? "iife" : "es"],
        fileName: () => isInterpreter ? "interpreter.js" : isContent ? "content.js" : "background.js",
        cssFileName: "styles"
      }
    }
  };
});
