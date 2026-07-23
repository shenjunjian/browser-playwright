<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  runScript,
  type RunScriptController,
  type StepEvent,
  type TestInfo,
  type TestResult,
} from "browser-playwright";

const props = withDefaults(
  defineProps<{
    script: string;
    autoPlay?: boolean;
  }>(),
  {
    autoPlay: false,
  },
);

const expanded = ref(false);
const currentLine = ref<number | null>(null);
const stepStatus = ref<StepEvent["status"] | "idle" | "done">("idle");
const stepMessage = ref<string | undefined>();
const playing = ref(false);
const finished = ref(false);
const result = ref<TestResult | null>(null);
const assertions = ref<
  Array<{ line: number; status: "passed" | "failed"; message?: string }>
>([]);

const lineRefs = ref<Record<number, HTMLElement | null>>({});

let controller: RunScriptController | null = null;
let runToken = 0;

const lines = computed(() => props.script.replace(/\r\n/g, "\n").split("\n"));

const currentStatement = computed(() => {
  if (finished.value && result.value) {
    const { passed, failed } = result.value;
    if (failed > 0) return `Failed · ${passed} passed, ${failed} failed`;
    return `Task completed · ${passed} passed`;
  }
  if (currentLine.value == null) {
    if (stepStatus.value === "idle") return "Ready";
    return "…";
  }
  const text = lines.value[currentLine.value - 1]?.trim() || `Line ${currentLine.value}`;
  if (stepStatus.value === "paused") return `Paused · ${text}`;
  if (stepStatus.value === "failed")
    return `Failed · ${stepMessage.value || text}`;
  if (stepStatus.value === "running") return text;
  return text;
});

const statusTone = computed(() => {
  if (finished.value && result.value) {
    return result.value.failed > 0 ? "failed" : "passed";
  }
  if (stepStatus.value === "failed") return "failed";
  if (stepStatus.value === "paused") return "paused";
  if (stepStatus.value === "running" || playing.value) return "running";
  if (stepStatus.value === "passed") return "passed";
  return "idle";
});

const summaryText = computed(() => {
  if (!result.value) return "";
  const { passed, failed, skipped, tests } = result.value;
  const parts = [`${passed} passed`, `${failed} failed`];
  if (skipped) parts.push(`${skipped} skipped`);
  if (tests.length) parts.push(`${tests.length} tests`);
  return parts.join(" · ");
});

function setLineRef(line: number, el: Element | null) {
  lineRefs.value[line] = el as HTMLElement | null;
}

async function scrollToCurrentLine() {
  await nextTick();
  const line = currentLine.value;
  if (line == null) return;
  const el = lineRefs.value[line];
  el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function onStep(event: StepEvent) {
  currentLine.value = event.line;
  stepStatus.value = event.status;
  stepMessage.value = event.message;

  if (event.status === "running") {
    playing.value = true;
  }
  if (event.status === "paused") {
    playing.value = false;
  }
  if (event.status === "failed") {
    assertions.value.push({
      line: event.line,
      status: "failed",
      message: event.message,
    });
    playing.value = false;
  }

  if (expanded.value) void scrollToCurrentLine();
}

function stopController() {
  try {
    controller?.stop();
  } catch {
    // ignore
  }
  controller = null;
}

function startRun() {
  stopController();
  const token = ++runToken;

  currentLine.value = null;
  stepStatus.value = "idle";
  stepMessage.value = undefined;
  playing.value = false;
  finished.value = false;
  result.value = null;
  assertions.value = [];

  const ctrl = runScript(props.script, {
    autoPlay: props.autoPlay,
    onStep,
  });
  controller = ctrl;

  void ctrl.result.then((res) => {
    if (token !== runToken) return;
    result.value = res;
    finished.value = true;
    playing.value = false;
    if (stepStatus.value !== "failed") {
      stepStatus.value = "done";
    }
    controller = null;
  });
}

function onPlay() {
  if (finished.value || !controller) {
    startRun();
    // autoPlay false by default; kick play after recreate
    queueMicrotask(() => controller?.play());
    return;
  }
  controller.play();
  playing.value = true;
}

function onPause() {
  controller?.pause();
  playing.value = false;
}

function onStepOnce() {
  if (finished.value || !controller) {
    startRun();
    queueMicrotask(() => controller?.step());
    return;
  }
  controller.step();
}

function onStop() {
  stopController();
  playing.value = false;
  stepStatus.value = "idle";
  finished.value = true;
  if (!result.value) {
    result.value = { passed: 0, failed: 0, skipped: 0, tests: [] };
  }
}

function toggleExpand() {
  expanded.value = !expanded.value;
  if (expanded.value) void scrollToCurrentLine();
}

function lineClass(lineNo: number) {
  const active = currentLine.value === lineNo;
  return {
    "bpw-line": true,
    "bpw-line--active": active,
    "bpw-line--running": active && stepStatus.value === "running",
    "bpw-line--paused": active && stepStatus.value === "paused",
    "bpw-line--failed": active && stepStatus.value === "failed",
    "bpw-line--passed": active && stepStatus.value === "passed",
  };
}

function assertionLabel(a: { line: number; status: string; message?: string }) {
  const base = `L${a.line} ${a.status}`;
  return a.message ? `${base}: ${a.message}` : base;
}

function testStatusLabel(t: TestInfo) {
  const ms = Math.round(t.duration);
  return `${t.status} · ${t.title} (${ms}ms)`;
}

watch(
  () => [props.script, props.autoPlay] as const,
  () => {
    startRun();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  runToken++;
  stopController();
});
</script>

<template>
  <Teleport to="body">
    <div
      class="bpw-root"
      role="complementary"
      aria-label="browser-playwright debugger"
    >
      <div class="bpw-shell" :class="{ 'bpw-shell--expanded': expanded }">
        <div v-if="expanded" class="bpw-panel">
          <div class="bpw-code" aria-label="source">
            <div
              v-for="(line, idx) in lines"
              :key="idx"
              :ref="(el) => setLineRef(idx + 1, el as Element | null)"
              :class="lineClass(idx + 1)"
            >
              <span class="bpw-gutter">{{ idx + 1 }}</span>
              <code class="bpw-code-text">{{ line || " " }}</code>
            </div>
          </div>

          <div v-if="assertions.length || result" class="bpw-meta">
            <div v-if="result" class="bpw-meta-block">
              <div class="bpw-meta-title">结果</div>
              <p class="bpw-summary">{{ summaryText }}</p>
              <ul v-if="result.tests.length" class="bpw-list">
                <li
                  v-for="(t, i) in result.tests"
                  :key="`${t.title}-${i}`"
                  :class="[
                    'bpw-list-item',
                    t.status === 'failed'
                      ? 'bpw-list-item--failed'
                      : t.status === 'passed'
                        ? 'bpw-list-item--passed'
                        : 'bpw-list-item--skipped',
                  ]"
                >
                  {{ testStatusLabel(t) }}
                  <span v-if="t.error" class="bpw-error">{{ t.error.message }}</span>
                </li>
              </ul>
            </div>
            <div v-if="assertions.length" class="bpw-meta-block">
              <div class="bpw-meta-title">失败步骤</div>
              <ul class="bpw-list">
                <li
                  v-for="(a, i) in assertions"
                  :key="`${a.line}-${i}`"
                  class="bpw-list-item bpw-list-item--failed"
                >
                  {{ assertionLabel(a) }}
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div class="bpw-bar">
          <button
            type="button"
            class="bpw-status"
            :data-tone="statusTone"
            :title="expanded ? '收起源码' : '展开源码'"
            @click="toggleExpand"
          >
            <span class="bpw-dot" aria-hidden="true" />
            <span class="bpw-status-text">{{ currentStatement }}</span>
            <span class="bpw-chevron" aria-hidden="true">{{
              expanded ? "▾" : "▴"
            }}</span>
          </button>

          <div class="bpw-actions" role="toolbar" aria-label="playback controls">
            <button
              type="button"
              class="bpw-btn"
              title="播放"
              aria-label="播放"
              @click="onPlay"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path fill="currentColor" d="M4 2.5v11l9-5.5L4 2.5z" />
              </svg>
            </button>
            <button
              type="button"
              class="bpw-btn"
              title="暂停"
              aria-label="暂停"
              @click="onPause"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path fill="currentColor" d="M4 2h3v12H4V2zm5 0h3v12H9V2z" />
              </svg>
            </button>
            <button
              type="button"
              class="bpw-btn"
              title="单步"
              aria-label="单步"
              @click="onStepOnce"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M3 2h2v12H3V2zm4 5.5L13 2v12L7 8.5z"
                />
              </svg>
            </button>
            <button
              type="button"
              class="bpw-btn"
              title="停止"
              aria-label="停止"
              @click="onStop"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <rect fill="currentColor" x="3.5" y="3.5" width="9" height="9" rx="1" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.bpw-root {
  --bpw-primary: #1476ff;
  --bpw-bg: #1a1d24;
  --bpw-bg-elevated: #22262f;
  --bpw-border: rgb(20 118 255 / 28%);
  --bpw-text: #e8ecf4;
  --bpw-muted: #8b93a7;
  --bpw-passed: #3dd68c;
  --bpw-failed: #ff5d5d;
  --bpw-paused: #f5c542;
  --bpw-running: var(--bpw-primary);
  --bpw-glow: 0 0 24px rgb(20 118 255 / 35%), 0 8px 28px rgb(0 0 0 / 45%);

  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 2147483646;
  max-width: min(560px, calc(100vw - 32px));
  font-family:
    ui-sans-serif,
    system-ui,
    -apple-system,
    "Segoe UI",
    Roboto,
    "Helvetica Neue",
    Arial,
    sans-serif;
  color: var(--bpw-text);
  pointer-events: none;
}

.bpw-shell {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  pointer-events: auto;
  filter: drop-shadow(var(--bpw-glow));
}

.bpw-panel {
  display: flex;
  flex-direction: column;
  max-height: min(420px, calc(100vh - 120px));
  margin-bottom: 10px;
  overflow: hidden;
  border: 1px solid var(--bpw-border);
  border-radius: 14px;
  background: var(--bpw-bg);
  box-shadow: inset 3px 0 0 var(--bpw-passed);
}

.bpw-code {
  flex: 1 1 auto;
  overflow: auto;
  padding: 10px 0;
  font-family:
    ui-monospace,
    SFMono-Regular,
    Menlo,
    Consolas,
    "Liberation Mono",
    monospace;
  font-size: 12px;
  line-height: 1.55;
}

.bpw-line {
  display: grid;
  grid-template-columns: 40px 1fr;
  gap: 8px;
  padding: 0 12px 0 0;
  white-space: pre;
}

.bpw-line--active {
  background: rgb(20 118 255 / 14%);
}

.bpw-line--running {
  box-shadow: inset 3px 0 0 var(--bpw-running);
}

.bpw-line--paused {
  box-shadow: inset 3px 0 0 var(--bpw-paused);
}

.bpw-line--failed {
  background: rgb(255 93 93 / 12%);
  box-shadow: inset 3px 0 0 var(--bpw-failed);
}

.bpw-line--passed {
  box-shadow: inset 3px 0 0 var(--bpw-passed);
}

.bpw-gutter {
  padding-left: 10px;
  color: var(--bpw-muted);
  text-align: right;
  user-select: none;
}

.bpw-code-text {
  overflow: hidden;
  color: var(--bpw-text);
  font: inherit;
  text-overflow: ellipsis;
}

.bpw-meta {
  flex: 0 0 auto;
  max-height: 140px;
  overflow: auto;
  border-top: 1px solid rgb(255 255 255 / 8%);
  padding: 8px 12px 10px;
  background: var(--bpw-bg-elevated);
}

.bpw-meta-block + .bpw-meta-block {
  margin-top: 8px;
}

.bpw-meta-title {
  margin-bottom: 4px;
  color: var(--bpw-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.bpw-summary {
  margin: 0 0 4px;
  color: var(--bpw-text);
  font-size: 12px;
}

.bpw-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.bpw-list-item {
  margin: 2px 0;
  font-size: 12px;
  line-height: 1.4;
  word-break: break-word;
}

.bpw-list-item--passed {
  color: var(--bpw-passed);
}

.bpw-list-item--failed {
  color: var(--bpw-failed);
}

.bpw-list-item--skipped {
  color: var(--bpw-muted);
}

.bpw-error {
  display: block;
  color: rgb(255 93 93 / 85%);
  font-size: 11px;
}

.bpw-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: min(420px, calc(100vw - 32px));
  padding: 8px 10px 8px 12px;
  border: 1px solid var(--bpw-border);
  border-radius: 999px;
  background: linear-gradient(180deg, #232833 0%, #1a1d24 100%);
}

.bpw-status {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin: 0;
  padding: 4px 6px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.bpw-status:hover {
  background: rgb(255 255 255 / 4%);
}

.bpw-dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--bpw-muted);
  box-shadow: 0 0 0 3px rgb(139 147 167 / 18%);
}

.bpw-status[data-tone="passed"] .bpw-dot {
  background: var(--bpw-passed);
  box-shadow: 0 0 0 3px rgb(61 214 140 / 22%);
}

.bpw-status[data-tone="failed"] .bpw-dot {
  background: var(--bpw-failed);
  box-shadow: 0 0 0 3px rgb(255 93 93 / 22%);
}

.bpw-status[data-tone="paused"] .bpw-dot {
  background: var(--bpw-paused);
  box-shadow: 0 0 0 3px rgb(245 197 66 / 22%);
}

.bpw-status[data-tone="running"] .bpw-dot {
  background: var(--bpw-running);
  box-shadow: 0 0 0 3px rgb(20 118 255 / 28%);
  animation: bpw-pulse 1.2s ease-in-out infinite;
}

.bpw-status-text {
  flex: 1 1 auto;
  overflow: hidden;
  color: var(--bpw-text);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bpw-chevron {
  flex: 0 0 auto;
  color: var(--bpw-muted);
  font-size: 12px;
}

.bpw-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
}

.bpw-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  margin: 0;
  padding: 0;
  border: 1px solid rgb(20 118 255 / 45%);
  border-radius: 8px;
  background: linear-gradient(180deg, #1f6feb 0%, #1476ff 100%);
  color: #fff;
  cursor: pointer;
  transition:
    transform 0.12s ease,
    filter 0.12s ease,
    background 0.12s ease;
}

.bpw-btn:hover {
  filter: brightness(1.08);
}

.bpw-btn:active {
  transform: translateY(1px);
}

.bpw-btn:focus-visible {
  outline: 2px solid #9ec5ff;
  outline-offset: 2px;
}

@keyframes bpw-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}
</style>
