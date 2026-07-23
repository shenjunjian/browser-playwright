<script setup lang="ts">
import { BrowserPlaywrightDebugger } from "browser-playwright-vue";

const demoScript = `import { test, expect } from 'browser-playwright'

test('demo', async ({ page }) => {
  await page.getByRole('button', { name: 'demo' }).click()
})
`;
</script>

<template>
  <main class="site">
    <h1>browser-playwright site</h1>
    <p>测试工程：用于验证 core + runScript + Vue 调试组件。</p>
    <button type="button">demo</button>
  </main>
  <BrowserPlaywrightDebugger :script="demoScript" />
</template>

<style scoped>
.site {
  padding: 24px;
  font-family: Georgia, "Times New Roman", serif;
}
</style>
