import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  plugins: lazyPlugins(() => [vue()]),
  appType: "spa",
  resolve: {
    alias: {
      "browser-playwright": resolve(
        import.meta.dirname,
        "../../packages/core/src/index.ts",
      ),
      "browser-playwright-vue": resolve(
        import.meta.dirname,
        "../../packages/browser-playwright-vue/src/index.ts",
      ),
    },
  },
});
