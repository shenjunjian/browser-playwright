import { resolve } from "node:path";
import { defineConfig } from "vite-plus";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/index.ts"),
      name: "BrowserPlaywright",
      formats: ["es"],
      fileName: "browser-playwright",
    },
    sourcemap: true,
  },
});
