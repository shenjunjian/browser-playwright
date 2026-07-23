<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { BrowserPlaywrightDebugger } from "browser-playwright-vue";

/** README 同类验收脚本：getByRole → click → toHaveText */
const demoScript = `import { test, expect } from 'browser-playwright'

test('弹窗的事件', async ({ page }) => {
  page.on('pageerror', (exception) => expect(exception).toBeNull())
  await page.goto('modal#modal-event')
  const content = page.locator('.is-message')
  await page.getByRole('button', { name: '打开带事件弹窗' }).first().click()
  await expect(content).toHaveText(/show 事件触发了/)
})
`;

const hash = ref(
  typeof location !== "undefined" ? location.hash.replace(/^#/, "") : "",
);
const modalOpen = ref(false);
const message = ref("");

const locationPath = computed(() =>
  typeof location !== "undefined"
    ? `${location.pathname}${location.hash}`
    : "/",
);

const isModalEventView = computed(
  () => hash.value === "modal-event" || hash.value.endsWith("modal-event"),
);

function syncHash() {
  hash.value = location.hash.replace(/^#/, "");
}

function openModal() {
  modalOpen.value = true;
  // 对齐 README 断言文案：弹窗 show 事件触发后写入消息区
  message.value = "show 事件触发了";
}

function closeModal() {
  modalOpen.value = false;
}

onMounted(() => {
  window.addEventListener("hashchange", syncHash);
  window.addEventListener("popstate", syncHash);
  syncHash();
});

onUnmounted(() => {
  window.removeEventListener("hashchange", syncHash);
  window.removeEventListener("popstate", syncHash);
});
</script>

<template>
  <main class="site">
    <header class="site__header">
      <h1>browser-playwright</h1>
      <p>
        演示页：按钮 / 弹窗 / 文案 + 浮动调试组件，验收 README 脚本
        <code>getByRole → click → toHaveText</code>。
      </p>
      <p class="site__route">
        当前路由：
        <code>{{ locationPath }}</code>
      </p>
    </header>

    <section
      id="modal-event"
      class="demo"
      :data-active="isModalEventView ? 'true' : 'false'"
      aria-labelledby="demo-title"
    >
      <h2 id="demo-title">弹窗事件演示</h2>
      <p class="demo__hint">
        点击下方按钮打开弹窗；消息区会写入
        <code>show 事件触发了</code>，供页内测试断言。
      </p>

      <button type="button" class="demo__btn" @click="openModal">
        打开带事件弹窗
      </button>

      <p class="is-message" data-testid="modal-message" aria-live="polite">
        {{ message || "（等待 show 事件…）" }}
      </p>

      <div
        v-if="modalOpen"
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div class="modal__backdrop" @click="closeModal" />
        <div class="modal__panel">
          <h3 id="modal-title">带事件弹窗</h3>
          <p>弹窗已打开（show）。</p>
          <button type="button" class="demo__btn demo__btn--ghost" @click="closeModal">
            关闭
          </button>
        </div>
      </div>
    </section>
  </main>

  <BrowserPlaywrightDebugger :script="demoScript" />
</template>

<style scoped>
.site {
  --accent: #1476ff;
  min-height: 100vh;
  padding: 32px 24px 120px;
  background:
    radial-gradient(ellipse 80% 50% at 100% 0%, rgb(20 118 255 / 12%), transparent),
    linear-gradient(180deg, #f7f9fc 0%, #eef2f8 100%);
  color: #1a2332;
  font-family:
    "Segoe UI",
    "PingFang SC",
    "Microsoft YaHei",
    sans-serif;
}

.site__header h1 {
  margin: 0 0 8px;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.site__header p {
  margin: 0 0 8px;
  max-width: 52rem;
  line-height: 1.55;
  color: #4a5568;
}

.site__route {
  font-size: 13px;
}

.site__route code,
.demo__hint code,
.site__header code {
  padding: 1px 6px;
  border-radius: 4px;
  background: rgb(20 118 255 / 10%);
  color: #0b4db3;
  font-size: 0.92em;
}

.demo {
  margin-top: 28px;
  max-width: 520px;
  padding: 24px;
  border: 1px solid rgb(20 118 255 / 18%);
  border-radius: 16px;
  background: rgb(255 255 255 / 88%);
  box-shadow: 0 12px 40px rgb(26 35 50 / 6%);
}

.demo[data-active="true"] {
  border-color: var(--accent);
  box-shadow:
    0 0 0 1px rgb(20 118 255 / 25%),
    0 12px 40px rgb(20 118 255 / 12%);
}

.demo h2 {
  margin: 0 0 8px;
  font-size: 18px;
}

.demo__hint {
  margin: 0 0 16px;
  color: #4a5568;
  font-size: 14px;
  line-height: 1.5;
}

.demo__btn {
  appearance: none;
  margin: 0 8px 0 0;
  padding: 10px 16px;
  border: 0;
  border-radius: 10px;
  background: linear-gradient(180deg, #1f6feb 0%, #1476ff 100%);
  color: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.demo__btn:hover {
  filter: brightness(1.05);
}

.demo__btn--ghost {
  background: #edf2f7;
  color: #1a2332;
}

.is-message {
  margin: 16px 0 0;
  padding: 12px 14px;
  border-left: 3px solid var(--accent);
  border-radius: 0 8px 8px 0;
  background: #f0f5ff;
  color: #1a2332;
  font-size: 14px;
  line-height: 1.45;
}

.modal {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
}

.modal__backdrop {
  position: absolute;
  inset: 0;
  background: rgb(10 16 28 / 45%);
}

.modal__panel {
  position: relative;
  z-index: 1;
  width: min(360px, calc(100vw - 48px));
  padding: 20px;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 20px 50px rgb(0 0 0 / 18%);
}

.modal__panel h3 {
  margin: 0 0 8px;
}

.modal__panel p {
  margin: 0 0 16px;
  color: #4a5568;
}
</style>
