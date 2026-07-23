import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { lazyPlugins } from "vite-plus";

// https://vite.dev/config/
export default defineConfig({
  plugins: lazyPlugins(() => [vue()]),
});
