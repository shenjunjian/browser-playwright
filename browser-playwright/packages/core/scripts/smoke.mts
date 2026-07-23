/**
 * Phase 1–4 smoke: Locator + input + expect/test + route/screenshot
 * Run from packages/core: pnpm smoke
 */
import { Window } from "happy-dom";

const window = new Window({ url: "https://example.test/" });

// PointerEvent may be missing in happy-dom.
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
  (globalThis as any).InputEvent = (window as any).InputEvent ?? class InputEvent extends (window as any).Event {
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
  fetch: window.fetch.bind(window),
  XMLHttpRequest: window.XMLHttpRequest,
  Response: (window as any).Response ?? (globalThis as any).Response,
  Headers: (window as any).Headers ?? (globalThis as any).Headers,
  Blob: (window as any).Blob ?? (globalThis as any).Blob,
  URL: window.URL,
  TextEncoder: (globalThis as any).TextEncoder,
  TextDecoder: (globalThis as any).TextDecoder,
});

const box = {
  x: 10,
  y: 10,
  width: 100,
  height: 20,
  top: 10,
  left: 10,
  bottom: 30,
  right: 110,
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
  return window.document.body?.querySelector("button") ?? null;
};
if ((window as any).Range) {
  (window as any).Range.prototype.getBoundingClientRect = function () {
    return { ...box };
  };
}

const {
  createPage,
  expect,
  test,
  runTests,
  runScript,
  _resetTests,
  clearScreenshotBaselines,
  hashBytes,
} = await import("../src/index.ts");

const document = window.document;

document.body.innerHTML = `
  <main>
    <h1>Hello World</h1>
    <button type="button" id="open">打开带事件弹窗</button>
    <button type="button" disabled>Disabled</button>
    <label>Email <input placeholder="you@example.com" data-testid="email" /></label>
    <img alt="logo" title="Brand" width="10" height="10" />
    <div class="is-message" style="display:none">hidden</div>
    <div class="is-message" id="msg">idle</div>
    <input type="checkbox" id="agree" />
    <select id="color">
      <option value="r">Red</option>
      <option value="g">Green</option>
    </select>
  </main>
`;

const openBtn = document.getElementById("open")!;
openBtn.addEventListener("click", () => {
  const msg = document.getElementById("msg")!;
  msg.textContent = "show 事件触发了";
});

const page = createPage({ document: document as unknown as Document, timeout: 3000 });

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// —— Phase 1 ——
const btn = page.getByRole("button", { name: "打开带事件弹窗" });
assert((await btn.count()) === 1, `getByRole button count got ${await btn.count()}`);
assert((await page.getByTestId("email").count()) === 1, "getByTestId");
assert((await page.getByPlaceholder("you@example.com").count()) === 1, "getByPlaceholder");
assert((await page.getByLabel("Email").count()) === 1, "getByLabel");
assert((await page.getByAltText("logo").count()) === 1, "getByAltText");
assert((await page.getByTitle("Brand").count()) === 1, "getByTitle");

const messages = page.locator(".is-message");
assert((await messages.count()) === 2, "locator css count");
assert((await messages.filter({ hasText: "show" }).count()) === 0, "filter before click");

await page.getByRole("heading", { name: "Hello World" }).waitFor({
  state: "visible",
  timeout: 1000,
});

// —— Phase 2: click / fill / events ——
const events: string[] = [];
openBtn.addEventListener("pointerdown", () => events.push("pointerdown"));
openBtn.addEventListener("mousedown", () => events.push("mousedown"));
openBtn.addEventListener("pointerup", () => events.push("pointerup"));
openBtn.addEventListener("mouseup", () => events.push("mouseup"));
openBtn.addEventListener("click", () => events.push("click"));

// Force elementFromPoint to return the open button during click
(window.Document.prototype as any).elementFromPoint = () => openBtn;

await btn.click();
assert(
  events.join(",") === "pointerdown,mousedown,pointerup,mouseup,click",
  `click sequence got ${events.join(",")}`,
);
assert(
  (await page.locator("#msg").innerText()).includes("show"),
  "click updated message",
);

await page.getByTestId("email").fill("a@b.com");
assert((await page.getByTestId("email").inputValue()) === "a@b.com", "fill");

await page.locator("#agree").check();
await expect(page.locator("#agree")).toBeChecked({ timeout: 1000 });

await page.locator("#color").selectOption("g");
assert((await page.locator("#color").inputValue()) === "g", "selectOption");

let consoleHit = false;
page.on("console", (msg) => {
  if (msg.text.includes("hello-bp")) consoleHit = true;
});
window.console.log("hello-bp");
assert(consoleHit, "page.on('console')");

const ev = await page.evaluate(() => 1 + 1);
assert(ev === 2, "evaluate");

await page.goto("modal#modal-event");
assert(
  String(window.location.hash).includes("modal-event"),
  `goto hash got ${window.location.hash}`,
);

// —— Phase 3: test + expect ——
_resetTests();
test("弹窗的事件", async ({ page: p }) => {
  const content = p.locator("#msg");
  await p.getByRole("button", { name: "打开带事件弹窗" }).first().click();
  await expect(content).toHaveText(/show 事件触发了/, { timeout: 2000 });
});

const result = await runTests({ page });
assert(result.passed === 1, `expected 1 passed, got ${JSON.stringify(result)}`);
assert(result.failed === 0, `expected 0 failed, got ${JSON.stringify(result)}`);

// —— Phase 4: route + screenshot ——
await page.route("**/api/hello", async (route) => {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    json: { ok: true, msg: "mocked" },
  });
});

const fetchFn = window.fetch.bind(window);
const res = await fetchFn("https://example.test/api/hello");
const data = await res.json();
assert(data.ok === true && data.msg === "mocked", `route fulfill got ${JSON.stringify(data)}`);

await page.unroute("**/api/hello");
await page.route(/\/api\/abort$/, async (route) => {
  await route.abort("failed");
});
let aborted = false;
try {
  await fetchFn("https://example.test/api/abort");
} catch {
  aborted = true;
}
assert(aborted, "route abort should reject fetch");
await page.unrouteAll();

clearScreenshotBaselines();
const shot = await page.locator("#msg").screenshot({ preferCanvas: false });
assert(shot.byteLength > 0, "locator.screenshot non-empty");
const pageShot = await page.screenshot({ preferCanvas: false });
assert(pageShot.byteLength > 0, "page.screenshot non-empty");
assert(typeof hashBytes(shot) === "string", "hashBytes");

await expect(page.locator("#msg")).toHaveScreenshot("msg-baseline", {
  preferCanvas: false,
  timeout: 2000,
});
await expect(page.locator("#msg")).toHaveScreenshot("msg-baseline", {
  preferCanvas: false,
  timeout: 2000,
});

// —— Phase 5: runScript play / step / events ——
_resetTests();
document.getElementById("msg")!.textContent = "idle";

const script = `
import { test, expect } from 'browser-playwright'

test('弹窗的事件', async ({ page }) => {
  const content = page.locator('#msg')
  await page.getByRole('button', { name: '打开带事件弹窗' }).first().click()
  await expect(content).toHaveText(/show 事件触发了/)
})
`;

const steps: Array<{ line: number; status: string }> = [];
const ctrl = runScript(script, {
  page,
  autoPlay: true,
  onStep: (e) => steps.push({ line: e.line, status: e.status }),
});
const scriptResult = await ctrl.result;
assert(scriptResult.passed === 1, `runScript passed got ${JSON.stringify(scriptResult)}`);
assert(scriptResult.failed === 0, `runScript failed got ${JSON.stringify(scriptResult)}`);
assert(steps.some((s) => s.status === "running"), "runScript emitted running steps");
assert(steps.some((s) => s.status === "passed"), "runScript emitted passed steps");

// step / pause control
_resetTests();
document.getElementById("msg")!.textContent = "idle";
const stepEvents: string[] = [];
const ctrl2 = runScript(
  `
test('step-demo', async ({ page }) => {
  await page.getByRole('button', { name: '打开带事件弹窗' }).first().click()
  await expect(page.locator('#msg')).toHaveText(/show/)
})
`,
  {
    page,
    autoPlay: false,
    onStep: (e) => stepEvents.push(`${e.line}:${e.status}`),
  },
);

// Allow microtasks to reach first checkpoint
await new Promise((r) => setTimeout(r, 20));
assert(
  stepEvents.some((e) => e.endsWith(":paused")),
  `expected paused before play, got ${stepEvents.join("|")}`,
);
ctrl2.play();
const r2 = await ctrl2.result;
assert(r2.passed === 1, `step-demo play got ${JSON.stringify(r2)}`);

// single-step then stop
_resetTests();
document.getElementById("msg")!.textContent = "idle";
let pausedCount = 0;
const ctrl3 = runScript(
  `
test('stop-demo', async ({ page }) => {
  await page.getByRole('button', { name: '打开带事件弹窗' }).first().click()
  await expect(page.locator('#msg')).toHaveText(/show/)
})
`,
  {
    page,
    autoPlay: false,
    onStep: (e) => {
      if (e.status === "paused") pausedCount++;
    },
  },
);
await new Promise((r) => setTimeout(r, 20));
ctrl3.step(); // advance past registration checkpoint(s)
await new Promise((r) => setTimeout(r, 30));
ctrl3.stop();
const r3 = await ctrl3.result;
assert(pausedCount >= 1, "stop-demo saw paused");
assert(typeof r3.passed === "number", "stop-demo returns TestResult");

console.log("Phase 1–5 smoke OK");
window.close();
