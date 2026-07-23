/**
 * Phase 7 acceptance: README-like script via runScript against a modal demo DOM.
 * Run: pnpm --filter site accept
 */
import { Window } from "happy-dom";

const window = new Window({ url: "https://example.test/" });

if (!(window as any).PointerEvent) {
  (window as any).PointerEvent = class PointerEvent extends (window as any)
    .MouseEvent {
    constructor(type: string, init?: PointerEventInit) {
      super(type, init);
    }
  };
}
if (!(globalThis as any).PointerEvent) {
  (globalThis as any).PointerEvent = (window as any).PointerEvent;
}
if (!(globalThis as any).InputEvent) {
  (globalThis as any).InputEvent =
    (window as any).InputEvent ??
    class InputEvent extends (window as any).Event {
      data?: string;
      inputType?: string;
      constructor(type: string, init?: InputEventInit) {
        super(type, init);
        this.data = init?.data;
        this.inputType = init?.inputType;
      }
    };
}

Object.assign(globalThis, {
  window,
  document: window.document,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  HTMLSelectElement: window.HTMLSelectElement,
  HTMLIFrameElement: window.HTMLIFrameElement,
  Node: window.Node,
  Document: window.Document,
  ShadowRoot: window.ShadowRoot,
  CSSStyleDeclaration: window.CSSStyleDeclaration,
  getComputedStyle: window.getComputedStyle.bind(window),
  MouseEvent: window.MouseEvent,
  KeyboardEvent: window.KeyboardEvent,
  Event: window.Event,
  PointerEvent: (window as any).PointerEvent,
  PopStateEvent: (window as any).PopStateEvent ?? class PopStateEvent extends (window as any).Event {},
  HashChangeEvent:
    (window as any).HashChangeEvent ??
    class HashChangeEvent extends (window as any).Event {},
  fetch: window.fetch.bind(window),
  XMLHttpRequest: window.XMLHttpRequest,
  Response: (window as any).Response ?? (globalThis as any).Response,
  Headers: (window as any).Headers ?? (globalThis as any).Headers,
  Blob: (window as any).Blob ?? (globalThis as any).Blob,
  URL: window.URL,
  TextEncoder: (globalThis as any).TextEncoder,
  TextDecoder: (globalThis as any).TextDecoder,
  location: window.location,
  history: window.history,
});

const box = {
  x: 10,
  y: 10,
  width: 120,
  height: 32,
  top: 10,
  left: 10,
  bottom: 42,
  right: 130,
  toJSON() {},
};
(window.Element.prototype as any).getBoundingClientRect = function (
  this: Element,
) {
  const style = window.getComputedStyle(this);
  if (style.display === "none" || style.visibility === "hidden")
    return { ...box, width: 0, height: 0, bottom: 0, right: 0 };
  return { ...box };
};
(window.Document.prototype as any).elementFromPoint = function () {
  return window.document.body;
};

window.document.body.innerHTML = `
  <main>
    <section id="modal-event">
      <button type="button">打开带事件弹窗</button>
      <p class="is-message">（等待 show 事件…）</p>
    </section>
  </main>
`;

const btn = window.document.querySelector("button")!;
const msg = window.document.querySelector(".is-message")!;
btn.addEventListener("click", () => {
  msg.textContent = "show 事件触发了";
});

const { runScript } = await import("browser-playwright");

const script = `import { test, expect } from 'browser-playwright'

test('弹窗的事件', async ({ page }) => {
  page.on('pageerror', (exception) => expect(exception).toBeNull())
  await page.goto('modal#modal-event')
  const content = page.locator('.is-message')
  await page.getByRole('button', { name: '打开带事件弹窗' }).first().click()
  await expect(content).toHaveText(/show 事件触发了/)
})
`;

const steps: Array<{ line: number; status: string }> = [];
const ctrl = runScript(script, {
  autoPlay: true,
  onStep: (e) => {
    steps.push({ line: e.line, status: e.status });
  },
});

const result = await ctrl.result;

if (result.failed !== 0 || result.passed < 1) {
  console.error("ACCEPT FAIL", result, steps.slice(-8));
  process.exit(1);
}

if (!steps.some((s) => s.status === "running")) {
  console.error("ACCEPT FAIL: expected running step events", steps);
  process.exit(1);
}

console.log(
  `ACCEPT OK: passed=${result.passed} failed=${result.failed} steps=${steps.length}`,
);
