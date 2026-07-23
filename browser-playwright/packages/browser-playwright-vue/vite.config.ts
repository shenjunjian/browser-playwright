import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  plugins: lazyPlugins(() => [vue()]),
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/index.ts"),
      name: "BrowserPlaywrightVue",
      formats: ["es"],
      fileName: "browser-playwright-vue",
      cssFileName: "browser-playwright-vue",
    },
    rollupOptions: {
      external: ["vue", "browser-playwright"],
    },
    sourcemap: true,
  },
});
