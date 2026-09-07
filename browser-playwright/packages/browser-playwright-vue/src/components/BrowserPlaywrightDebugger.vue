<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  runScript,
  startRecording,
  type AssertKind,
  type RecorderController,
  type RunScriptController,
  type StepEvent,
  type TestInfo,
  type TestResult,
} from "browser-playwright";

const EMPTY_SCRIPT = `import { test, expect } from 'browser-playwright'

test('recorded', async ({ page }) => {
})
`;

const props = withDefaults(
  defineProps<{
    /** Initial script. Editable locally; emit `update:script` on change. */
    script?: string;
    autoPlay?: boolean;
  }>(),
  {
    script: "",
    autoPlay: false,
  },
);

const emit = defineEmits<{
  "update:script": [value: string];
}>();

const expanded = ref(false);
const editing = ref(false);
const scriptText = ref(props.script || EMPTY_SCRIPT);
const currentLine = ref<number | null>(null);
const stepStatus = ref<StepEvent["status"] | "idle" | "done">("idle");
const stepMessage = ref<string | undefined>();
const playing = ref(false);
const finished = ref(false);
const result = ref<TestResult | null>(null);
const assertions = ref<
  Array<{ line: number; status: "passed" | "failed"; message?: string }>
>([]);
const recording = ref(false);

type RecordIntent = "click" | AssertKind;

const RECORD_INTENTS: { value: RecordIntent; label: string }[] = [
  { value: "click", label: "点击" },
  { value: "toBeVisible", label: "断言可见" },
  { value: "toHaveText", label: "断言文本" },
];

const recordIntent = ref<RecordIntent>("click");
const recordMenuOpen = ref(false);
const recordMenuRoot = ref<HTMLElement | null>(null);

const recordIntentLabel = computed(
  () =>
    RECORD_INTENTS.find((item) => item.value === recordIntent.value)?.label ??
    "点击",
);

const lineRefs = ref<Record<number, HTMLElement | null>>({});

let controller: RunScriptController | null = null;
let recorder: RecorderController | null = null;
let runToken = 0;

const lines = computed(() =>
  scriptText.value.replace(/\r\n/g, "\n").split("\n"),
);

const KEYWORDS = new Set(
  "import from export const let var function async await return if else for while new class extends typeof true false null undefined try catch throw of in".split(
    " ",
  ),
);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Lightweight per-line JS/TS highlighter for the read-only preview. */
function highlightLine(line: string): string {
  if (!line) return " ";
  const re =
    /(\/\/.*$)|('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)|(\b\d+\.?\d*\b)|(\b[A-Za-z_$][\w$]*\b)|([^\s\w]+)|(\s+)/g;
  let out = "";
  for (const m of line.matchAll(re)) {
    const [tok, comment, str, num, ident, punct, space] = m;
    const esc = escapeHtml(tok);
    if (comment) out += `<span class="tok-comment">${esc}</span>`;
    else if (str) out += `<span class="tok-string">${esc}</span>`;
    else if (num) out += `<span class="tok-number">${esc}</span>`;
    else if (ident) {
      const cls = KEYWORDS.has(tok)
        ? "tok-keyword"
        : /^[A-Z]/.test(tok)
          ? "tok-type"
          : "tok-ident";
      out += `<span class="${cls}">${esc}</span>`;
    } else if (punct) out += `<span class="tok-punct">${esc}</span>`;
    else out += space ?? esc;
  }
  return out || " ";
}

const currentStatement = computed(() => {
  if (recording.value) return `Recording · ${recordIntentLabel.value}`;
  if (finished.value && result.value) {
    const { passed, failed } = result.value;
    if (failed > 0) return `Failed · ${passed} passed, ${failed} failed`;
    return `Task completed · ${passed} passed`;
  }
  if (currentLine.value == null) {
    if (stepStatus.value === "idle") return "Ready";
    return "…";
  }
  const text =
    lines.value[currentLine.value - 1]?.trim() || `Line ${currentLine.value}`;
  if (stepStatus.value === "paused") return `Paused · ${text}`;
  if (stepStatus.value === "failed")
    return `Failed · ${stepMessage.value || text}`;
  if (stepStatus.value === "running") return text;
  return text;
});

const statusTone = computed(() => {
  if (recording.value) return "recording";
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

function syncScript(next: string) {
  scriptText.value = next;
  emit("update:script", next);
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

  if (expanded.value && !editing.value) void scrollToCurrentLine();
}

function stopController() {
  try {
    controller?.stop();
  } catch {
    // ignore
  }
  controller = null;
}

function stopRecorder() {
  if (!recorder) return;
  try {
    const { script } = recorder.stop();
    syncScript(script);
  } catch {
    // ignore
  }
  recorder = null;
  recording.value = false;
  recordMenuOpen.value = false;
}

function startRun() {
  if (recording.value) return;
  stopController();
  const token = ++runToken;

  currentLine.value = null;
  stepStatus.value = "idle";
  stepMessage.value = undefined;
  playing.value = false;
  finished.value = false;
  result.value = null;
  assertions.value = [];
  editing.value = false;

  const ctrl = runScript(scriptText.value, {
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
  if (recording.value) stopRecorder();
  if (finished.value || !controller) {
    startRun();
    queueMicrotask(() => controller?.play());
    return;
  }
  controller.play();
  playing.value = true;
}

function onPause() {
  if (recording.value) {
    recorder?.pause();
    return;
  }
  controller?.pause();
  playing.value = false;
}

function onStepOnce() {
  if (recording.value) stopRecorder();
  if (finished.value || !controller) {
    startRun();
    queueMicrotask(() => controller?.step());
    return;
  }
  controller.step();
}

function onStop() {
  if (recording.value) {
    stopRecorder();
    stepStatus.value = "idle";
    finished.value = false;
    return;
  }
  stopController();
  playing.value = false;
  stepStatus.value = "idle";
  finished.value = true;
  if (!result.value) {
    result.value = { passed: 0, failed: 0, skipped: 0, tests: [] };
  }
}

function toggleRecord() {
  if (recording.value) {
    stopRecorder();
    expanded.value = true;
    return;
  }
  stopController();
  playing.value = false;
  finished.value = false;
  result.value = null;
  assertions.value = [];
  currentLine.value = null;
  stepStatus.value = "idle";
  expanded.value = true;
  editing.value = false;

  recorder = startRecording({
    testTitle: "recorded",
    onUpdate: (script) => {
      syncScript(script);
    },
  });
  recording.value = true;
  applyRecordIntent();
}

function applyRecordIntent() {
  if (!recorder) return;
  if (recordIntent.value === "click") {
    recorder.setAssertMode(false);
    return;
  }
  recorder.setAssertMode(true, recordIntent.value);
}

function toggleRecordMenu() {
  recordMenuOpen.value = !recordMenuOpen.value;
}

function setRecordIntent(intent: RecordIntent) {
  recordIntent.value = intent;
  recordMenuOpen.value = false;
  if (recording.value) applyRecordIntent();
}

function onDocPointerDown(event: PointerEvent) {
  if (!recordMenuOpen.value) return;
  const root = recordMenuRoot.value;
  if (root && event.target instanceof Node && root.contains(event.target)) {
    return;
  }
  recordMenuOpen.value = false;
}

function onDocKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") recordMenuOpen.value = false;
}

function toggleExpand() {
  expanded.value = !expanded.value;
  if (expanded.value && !editing.value) void scrollToCurrentLine();
}

function onEditorInput(event: Event) {
  const el = event.target as HTMLTextAreaElement;
  syncScript(el.value);
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

function assertionLabel(a: {
  line: number;
  status: string;
  message?: string;
}) {
  const base = `L${a.line} ${a.status}`;
  return a.message ? `${base}: ${a.message}` : base;
}

function testStatusLabel(t: TestInfo) {
  const ms = Math.round(t.duration);
  return `${t.status} · ${t.title} (${ms}ms)`;
}

watch(
  () => props.script,
  (next) => {
    if (next == null || next === scriptText.value) return;
    scriptText.value = next || EMPTY_SCRIPT;
    if (!recording.value) startRun();
  },
);

watch(
  () => props.autoPlay,
  () => {
    if (!recording.value) startRun();
  },
);

// Initial run (playback ready, not auto unless autoPlay)
startRun();

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onDocKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  document.removeEventListener("keydown", onDocKeydown);
  runToken++;
  stopController();
  if (recorder) {
    try {
      recorder.stop();
    } catch {
      // ignore
    }
    recorder = null;
  }
});
</script>

<template>
  <Teleport to="body">
    <div
      class="bpw-root"
      data-bpw-ui
      role="complementary"
      aria-label="browser-playwright inspector"
    >
      <div class="bpw-shell" :class="{ 'bpw-shell--expanded': expanded }">
        <div v-if="expanded" class="bpw-panel" :data-recording="recording ? 'true' : 'false'">
          <div class="bpw-panel-toolbar">
            <button
              type="button"
              class="bpw-chip"
              :class="{ 'bpw-chip--active': !editing }"
              title="查看高亮源码"
              @click="editing = false"
            >
              预览
            </button>
            <button
              type="button"
              class="bpw-chip"
              :class="{ 'bpw-chip--active': editing }"
              title="编辑脚本"
              @click="editing = true"
            >
              编辑
            </button>
            <span v-if="recording" class="bpw-rec-hint">
              悬停预览 locator · 点击录制操作
            </span>
          </div>

          <div class="bpw-body">
            <textarea
              v-if="editing"
              class="bpw-editor"
              :value="scriptText"
              spellcheck="false"
              aria-label="editable script"
              @input="onEditorInput"
            />

            <div v-else class="bpw-code" aria-label="source">
              <div
                v-for="(line, idx) in lines"
                :key="idx"
                :ref="(el) => setLineRef(idx + 1, el as Element | null)"
                :class="lineClass(idx + 1)"
              >
                <span class="bpw-gutter">{{ idx + 1 }}</span>
                <code class="bpw-code-text" v-html="highlightLine(line)"></code>
              </div>
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
            :aria-label="expanded ? '收起源码' : '展开源码'"
            @click="toggleExpand"
          >
            <span class="bpw-dot" aria-hidden="true" />
            <!-- aria-hidden: avoid script text becoming this button's accessible name
                 and colliding with page.getByRole({ name }) during playback -->
            <span class="bpw-status-text" aria-hidden="true">{{
              currentStatement
            }}</span>
            <span class="bpw-chevron" aria-hidden="true">{{
              expanded ? "▾" : "▴"
            }}</span>
          </button>

          <div class="bpw-actions" role="toolbar" aria-label="inspector controls">
            <button
              type="button"
              class="bpw-btn bpw-btn--record"
              :class="{ 'bpw-btn--rec-on': recording }"
              :title="recording ? '停止录制' : '开始录制'"
              :aria-label="recording ? '停止录制' : '开始录制'"
              :aria-pressed="recording"
              @click="toggleRecord"
            >
              <span class="bpw-rec-dot" aria-hidden="true" />
            </button>
            <div ref="recordMenuRoot" class="bpw-select">
              <button
                type="button"
                class="bpw-btn bpw-btn--ghost bpw-select-trigger"
                :class="{
                  'bpw-btn--assert-on': recording && recordIntent !== 'click',
                }"
                title="录制动作：点击 / 断言可见 / 断言文本"
                aria-label="录制动作类型"
                aria-haspopup="listbox"
                :aria-expanded="recordMenuOpen"
                @click="toggleRecordMenu"
              >
                <span>{{ recordIntentLabel }}</span>
                <span class="bpw-select-caret" aria-hidden="true">▾</span>
              </button>
              <div
                v-if="recordMenuOpen"
                class="bpw-select-menu"
                role="listbox"
                aria-label="录制动作类型"
              >
                <button
                  v-for="opt in RECORD_INTENTS"
                  :key="opt.value"
                  type="button"
                  role="option"
                  class="bpw-select-option"
                  :class="{
                    'bpw-select-option--active': recordIntent === opt.value,
                  }"
                  :aria-selected="recordIntent === opt.value"
                  @click="setRecordIntent(opt.value)"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>
            <button
              type="button"
              class="bpw-btn"
              title="播放"
              aria-label="播放"
              :disabled="recording"
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
              :disabled="recording"
              @click="onStepOnce"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M2.75 6.5h6.2L6.6 4.15 7.85 2.9 13.1 8l-5.25 5.1-1.25-1.25 2.35-2.35h-6.2V6.5z"
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
                <rect
                  fill="currentColor"
                  x="3.5"
                  y="3.5"
                  width="9"
                  height="9"
                  rx="1"
                />
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
  --bpw-record: #e11d48;
  --bpw-glow: 0 0 24px rgb(20 118 255 / 35%), 0 8px 28px rgb(0 0 0 / 45%);

  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 2147483646;
  width: min(560px, calc(100vw - 32px));
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
  width: 100%;
  gap: 0;
  pointer-events: auto;
  filter: drop-shadow(var(--bpw-glow));
}

.bpw-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  box-sizing: border-box;
  height: min(460px, calc(100vh - 120px));
  max-height: min(460px, calc(100vh - 120px));
  margin-bottom: 10px;
  overflow: hidden;
  border: 1px solid var(--bpw-border);
  border-radius: 14px;
  background: var(--bpw-bg);
  box-shadow: inset 3px 0 0 var(--bpw-passed);
}

.bpw-panel[data-recording="true"] {
  box-shadow: inset 3px 0 0 var(--bpw-record);
}

.bpw-panel-toolbar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid rgb(255 255 255 / 8%);
  background: var(--bpw-bg-elevated);
}

.bpw-chip {
  margin: 0;
  padding: 3px 10px;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 999px;
  background: transparent;
  color: var(--bpw-muted);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.bpw-chip--active {
  border-color: rgb(20 118 255 / 45%);
  background: rgb(20 118 255 / 18%);
  color: var(--bpw-text);
}

.bpw-rec-hint {
  margin-left: auto;
  color: var(--bpw-record);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bpw-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.bpw-editor {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  margin: 0;
  padding: 10px 12px;
  border: 0;
  resize: none;
  box-sizing: border-box;
  background: #12151b;
  color: var(--bpw-text);
  font-family:
    ui-monospace,
    SFMono-Regular,
    Menlo,
    Consolas,
    "Liberation Mono",
    monospace;
  font-size: 12px;
  line-height: 1.55;
  outline: none;
}

.bpw-code {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
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
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 8px;
  min-width: 0;
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
  min-width: 0;
  overflow: hidden;
  color: var(--bpw-text);
  font: inherit;
  text-overflow: ellipsis;
}

/* v-html tokens need :deep — scoped attrs are not on injected spans */
.bpw-code-text :deep(.tok-keyword) {
  color: #c678dd;
}

.bpw-code-text :deep(.tok-string) {
  color: #98c379;
}

.bpw-code-text :deep(.tok-number) {
  color: #d19a66;
}

.bpw-code-text :deep(.tok-comment) {
  color: #6b7385;
  font-style: italic;
}

.bpw-code-text :deep(.tok-type) {
  color: #e5c07b;
}

.bpw-code-text :deep(.tok-punct) {
  color: #56b6c2;
}

.bpw-code-text :deep(.tok-ident) {
  color: #abb2bf;
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
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 8px 10px 8px 12px;
  overflow: visible;
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

.bpw-status[data-tone="recording"] .bpw-dot {
  background: var(--bpw-record);
  box-shadow: 0 0 0 3px rgb(225 29 72 / 28%);
  animation: bpw-pulse 1s ease-in-out infinite;
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

.bpw-btn:hover:not(:disabled) {
  filter: brightness(1.08);
}

.bpw-btn:active:not(:disabled) {
  transform: translateY(1px);
}

.bpw-btn:focus-visible {
  outline: 2px solid #9ec5ff;
  outline-offset: 2px;
}

.bpw-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.bpw-btn--record {
  border-color: rgb(225 29 72 / 55%);
  background: linear-gradient(180deg, #2a2f3a 0%, #1e222b 100%);
}

.bpw-btn--rec-on {
  border-color: var(--bpw-record);
  background: rgb(225 29 72 / 22%);
}

.bpw-rec-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--bpw-record);
  box-shadow: 0 0 0 2px rgb(225 29 72 / 25%);
}

.bpw-btn--rec-on .bpw-rec-dot {
  animation: bpw-pulse 1s ease-in-out infinite;
}

.bpw-btn--ghost {
  border-color: rgb(255 255 255 / 16%);
  background: #2a2f3a;
  color: var(--bpw-muted);
  font-size: 12px;
  font-weight: 700;
}

.bpw-btn--assert-on {
  border-color: var(--bpw-paused);
  background: rgb(245 197 66 / 18%);
  color: var(--bpw-paused);
}

.bpw-select {
  position: relative;
  flex: 0 0 auto;
}

.bpw-select-trigger {
  width: auto;
  min-width: 92px;
  padding: 0 8px;
  font-size: 11px;
  font-weight: 600;
  gap: 4px;
  justify-content: space-between;
}

.bpw-select-caret {
  font-size: 10px;
  line-height: 1;
  opacity: 0.8;
}

.bpw-select-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  z-index: 3;
  min-width: 100%;
  padding: 4px;
  border: 1px solid var(--bpw-border);
  border-radius: 10px;
  background: var(--bpw-bg-elevated);
  box-shadow: 0 8px 24px rgb(0 0 0 / 45%);
}

.bpw-select-option {
  display: block;
  width: 100%;
  margin: 0;
  padding: 6px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--bpw-text);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}

.bpw-select-option:hover,
.bpw-select-option--active {
  background: rgb(20 118 255 / 18%);
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
