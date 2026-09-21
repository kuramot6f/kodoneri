import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const isContent = mode === "content";

  return {
    plugins: isContent ? [react()] : [],
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
