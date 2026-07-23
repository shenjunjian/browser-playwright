<script setup lang="ts">
/**
 * Placeholder debugger UI — full controls land in a later phase.
 * Props match the planned public API so site can wire them early.
 */
defineProps<{
  script: string;
  autoPlay?: boolean;
}>();
</script>

<template>
  <div class="bpw-debugger" role="complementary" aria-label="browser-playwright debugger">
    <header class="bpw-debugger__header">browser-playwright</header>
    <pre class="bpw-debugger__script">{{ script }}</pre>
    <p class="bpw-debugger__hint">调试面板占位：播放 / 单步 / 暂停将在后续阶段实现</p>
  </div>
</template>

<style scoped>
.bpw-debugger {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483646;
  width: min(420px, calc(100vw - 32px));
  max-height: min(480px, calc(100vh - 32px));
  overflow: auto;
  padding: 12px;
  border: 1px solid #c8c8c8;
  background: #f7f7f7;
  color: #1a1a1a;
  font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
}

.bpw-debugger__header {
  margin-bottom: 8px;
  font-weight: 700;
}

.bpw-debugger__script {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.bpw-debugger__hint {
  margin: 8px 0 0;
  color: #555;
}
</style>
