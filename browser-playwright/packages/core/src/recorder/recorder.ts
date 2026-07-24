import { generateScript } from "./codegen";
import { generateLocator, resolveTargetElement } from "./generateLocator";
import type {
  AssertKind,
  RecordedAction,
  RecorderController,
  RecorderOptions,
} from "./types";

const HIGHLIGHT_TAG = "x-bp-recorder-highlight";
const TOOLTIP_TAG = "x-bp-recorder-tooltip";
const FILL_DEBOUNCE_MS = 400;

function isTrusted(event: Event): boolean {
  return event.isTrusted === true;
}

function isTextLikeInput(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  const type = (el.type || "text").toLowerCase();
  return (
    type === "text" ||
    type === "email" ||
    type === "password" ||
    type === "search" ||
    type === "tel" ||
    type === "url" ||
    type === "number" ||
    type === "" ||
    type === "date" ||
    type === "datetime-local" ||
    type === "time" ||
    type === "month" ||
    type === "week"
  );
}

function isCheckboxOrRadio(el: Element): el is HTMLInputElement {
  return (
    el instanceof HTMLInputElement &&
    (el.type === "checkbox" || el.type === "radio")
  );
}

function normalizeVisibleText(el: Element): string {
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}

class RecorderImpl implements RecorderController {
  recording = true;
  assertMode = false;
  assertKind: AssertKind = "toBeVisible";

  private readonly doc: Document;
  private readonly uiAttr: string;
  private readonly testTitle: string;
  private readonly onUpdate?: RecorderOptions["onUpdate"];
  private readonly actionsList: RecordedAction[] = [];
  private paused = false;
  private disposed = false;

  private highlightEl: HTMLElement | null = null;
  private tooltipEl: HTMLElement | null = null;
  private lastHoverTarget: Element | null = null;
  private lastHoverLocator = "";

  private fillTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingFill: { locator: string; value: string; element: Element } | null =
    null;

  private readonly onClick: (e: MouseEvent) => void;
  private readonly onDblClick: (e: MouseEvent) => void;
  private readonly onInput: (e: Event) => void;
  private readonly onChange: (e: Event) => void;
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onPointerMove: (e: PointerEvent) => void;
  private readonly onScroll: () => void;

  constructor(options: RecorderOptions = {}) {
    this.doc = options.document ?? globalThis.document;
    this.uiAttr = options.uiAttribute ?? "data-bpw-ui";
    this.testTitle = options.testTitle ?? "recorded";
    this.onUpdate = options.onUpdate;

    this.onClick = (e) => this.handleClick(e);
    this.onDblClick = (e) => this.handleDblClick(e);
    this.onInput = (e) => this.handleInput(e);
    this.onChange = (e) => this.handleChange(e);
    this.onKeyDown = (e) => this.handleKeyDown(e);
    this.onPointerMove = (e) => this.handlePointerMove(e);
    this.onScroll = () => this.repositionHighlight();

    const opts: AddEventListenerOptions = { capture: true, passive: false };
    this.doc.addEventListener("click", this.onClick, opts);
    this.doc.addEventListener("dblclick", this.onDblClick, opts);
    this.doc.addEventListener("input", this.onInput, opts);
    this.doc.addEventListener("change", this.onChange, opts);
    this.doc.addEventListener("keydown", this.onKeyDown, opts);
    this.doc.addEventListener("pointermove", this.onPointerMove, {
      capture: true,
      passive: true,
    });
    this.doc.defaultView?.addEventListener("scroll", this.onScroll, true);
    this.doc.defaultView?.addEventListener("resize", this.onScroll);

    this.ensureOverlay();
    this.emit();
  }

  pause(): void {
    this.paused = true;
    this.clearHighlight();
  }

  resume(): void {
    this.paused = false;
  }

  setAssertMode(on: boolean, kind?: AssertKind): void {
    this.assertMode = on;
    if (kind) this.assertKind = kind;
  }

  script(): string {
    return generateScript(this.actionsList, this.testTitle);
  }

  actions(): RecordedAction[] {
    return this.actionsList.slice();
  }

  stop(): { script: string; actions: RecordedAction[] } {
    this.flushFill();
    this.disposed = true;
    this.recording = false;
    this.teardown();
    const script = this.script();
    const actions = this.actions();
    this.emit();
    return { script, actions };
  }

  private emit(): void {
    this.onUpdate?.(this.script(), this.actions());
  }

  private push(action: RecordedAction): void {
    this.actionsList.push(action);
    this.emit();
  }

  private canCapture(event: Event): boolean {
    return this.recording && !this.paused && !this.disposed && isTrusted(event);
  }

  private targetFromEvent(event: Event): Element | null {
    return resolveTargetElement(event.target, this.uiAttr);
  }

  private locatorFor(el: Element): string {
    return generateLocator(el, this.doc);
  }

  private handleClick(e: MouseEvent): void {
    if (!this.canCapture(e)) return;
    // Let dblclick own the double-click sequence; skip synthetic second click pairing via detail
    if (e.detail === 2) return;

    const el = this.targetFromEvent(e);
    if (!el) return;

    // Text inputs: click alone is usually not useful; fill/change covers them
    if (isTextLikeInput(el) && !this.assertMode) return;
    if (el instanceof HTMLSelectElement && !this.assertMode) return;

    if (this.assertMode) {
      e.preventDefault();
      e.stopPropagation();
      const locator = this.locatorFor(el);
      if (this.assertKind === "toHaveText") {
        const text = normalizeVisibleText(el);
        this.push({
          kind: "expect",
          locator,
          assertion: "toHaveText",
          text: text || undefined,
        });
      } else {
        this.push({ kind: "expect", locator, assertion: "toBeVisible" });
      }
      return;
    }

    if (isCheckboxOrRadio(el)) {
      // change handler records check/uncheck
      return;
    }

    const locator = this.locatorFor(el);
    this.push({ kind: "click", locator });
  }

  private handleDblClick(e: MouseEvent): void {
    if (!this.canCapture(e) || this.assertMode) return;
    const el = this.targetFromEvent(e);
    if (!el || isTextLikeInput(el)) return;
    // Remove trailing click from the first half of the double-click if present
    const last = this.actionsList[this.actionsList.length - 1];
    const locator = this.locatorFor(el);
    if (last?.kind === "click" && last.locator === locator) {
      this.actionsList.pop();
    }
    this.push({ kind: "dblclick", locator });
  }

  private handleInput(e: Event): void {
    if (!this.canCapture(e) || this.assertMode) return;
    const el = this.targetFromEvent(e);
    if (!el || !isTextLikeInput(el)) return;
    const locator = this.locatorFor(el);
    const value = el.value;
    this.scheduleFill(locator, value, el);
  }

  private handleChange(e: Event): void {
    if (!this.canCapture(e) || this.assertMode) return;
    const el = this.targetFromEvent(e);
    if (!el) return;

    if (isCheckboxOrRadio(el)) {
      this.flushFill();
      const locator = this.locatorFor(el);
      this.push({ kind: el.checked ? "check" : "uncheck", locator });
      return;
    }

    if (el instanceof HTMLSelectElement) {
      this.flushFill();
      const locator = this.locatorFor(el);
      this.push({ kind: "selectOption", locator, value: el.value });
      return;
    }

    if (isTextLikeInput(el)) {
      const locator = this.locatorFor(el);
      this.scheduleFill(locator, el.value, el);
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.canCapture(e) || this.assertMode) return;
    const key = e.key;
    if (key !== "Enter" && key !== "Tab" && key !== "Escape") return;
    const el = this.targetFromEvent(e);
    if (!el || !isTextLikeInput(el)) return;
    this.flushFill();
    const locator = this.locatorFor(el);
    this.push({ kind: "press", locator, key });
  }

  private scheduleFill(locator: string, value: string, element: Element): void {
    this.pendingFill = { locator, value, element };
    if (this.fillTimer) clearTimeout(this.fillTimer);
    this.fillTimer = setTimeout(() => this.flushFill(), FILL_DEBOUNCE_MS);
  }

  private flushFill(): void {
    if (this.fillTimer) {
      clearTimeout(this.fillTimer);
      this.fillTimer = null;
    }
    const pending = this.pendingFill;
    this.pendingFill = null;
    if (!pending) return;

    // Merge into previous fill on same locator
    const last = this.actionsList[this.actionsList.length - 1];
    if (last?.kind === "fill" && last.locator === pending.locator) {
      last.value = pending.value;
      this.emit();
      return;
    }
    this.push({
      kind: "fill",
      locator: pending.locator,
      value: pending.value,
    });
  }

  private ensureOverlay(): void {
    if (this.highlightEl) return;
    const highlight = this.doc.createElement(HIGHLIGHT_TAG) as HTMLElement;
    Object.assign(highlight.style, {
      position: "fixed",
      pointerEvents: "none",
      zIndex: "2147483645",
      border: "2px solid #e11d48",
      background: "rgb(225 29 72 / 12%)",
      borderRadius: "2px",
      display: "none",
      boxSizing: "border-box",
    });
    highlight.setAttribute(this.uiAttr, "");
    this.doc.documentElement.appendChild(highlight);
    this.highlightEl = highlight;

    const tip = this.doc.createElement(TOOLTIP_TAG) as HTMLElement;
    Object.assign(tip.style, {
      position: "fixed",
      pointerEvents: "none",
      zIndex: "2147483645",
      maxWidth: "min(480px, calc(100vw - 24px))",
      padding: "4px 8px",
      borderRadius: "6px",
      background: "#1a1d24",
      color: "#e8ecf4",
      font:
        "12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      boxShadow: "0 4px 16px rgb(0 0 0 / 35%)",
      display: "none",
      whiteSpace: "pre-wrap",
      wordBreak: "break-all",
    });
    tip.setAttribute(this.uiAttr, "");
    this.doc.documentElement.appendChild(tip);
    this.tooltipEl = tip;
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.recording || this.paused || this.disposed) {
      this.clearHighlight();
      return;
    }
    const el = resolveTargetElement(e.target, this.uiAttr);
    if (!el) {
      this.clearHighlight();
      return;
    }
    if (el === this.lastHoverTarget) {
      this.repositionHighlight();
      return;
    }
    this.lastHoverTarget = el;
    try {
      this.lastHoverLocator = this.locatorFor(el);
    } catch {
      this.lastHoverLocator = "page.locator('…')";
    }
    this.repositionHighlight();
  }

  private repositionHighlight(): void {
    const el = this.lastHoverTarget;
    const highlight = this.highlightEl;
    const tip = this.tooltipEl;
    if (!el || !highlight || !tip || !el.isConnected) {
      this.clearHighlight();
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) {
      this.clearHighlight();
      return;
    }
    Object.assign(highlight.style, {
      display: "block",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });

    const prefix = this.assertMode ? `[assert:${this.assertKind}] ` : "";
    tip.textContent = prefix + this.lastHoverLocator;
    tip.style.display = "block";
    const tipTop = Math.max(8, rect.top - 28);
    let tipLeft = rect.left;
    tip.style.left = `${tipLeft}px`;
    tip.style.top = `${tipTop}px`;
    // Keep tooltip in viewport
    const tipRect = tip.getBoundingClientRect();
    if (tipRect.right > window.innerWidth - 8) {
      tipLeft = Math.max(8, window.innerWidth - tipRect.width - 8);
      tip.style.left = `${tipLeft}px`;
    }
  }

  private clearHighlight(): void {
    this.lastHoverTarget = null;
    this.lastHoverLocator = "";
    if (this.highlightEl) this.highlightEl.style.display = "none";
    if (this.tooltipEl) this.tooltipEl.style.display = "none";
  }

  private teardown(): void {
    const opts: EventListenerOptions = { capture: true };
    this.doc.removeEventListener("click", this.onClick, opts);
    this.doc.removeEventListener("dblclick", this.onDblClick, opts);
    this.doc.removeEventListener("input", this.onInput, opts);
    this.doc.removeEventListener("change", this.onChange, opts);
    this.doc.removeEventListener("keydown", this.onKeyDown, opts);
    this.doc.removeEventListener("pointermove", this.onPointerMove, opts);
    this.doc.defaultView?.removeEventListener("scroll", this.onScroll, true);
    this.doc.defaultView?.removeEventListener("resize", this.onScroll);
    this.clearHighlight();
    this.highlightEl?.remove();
    this.tooltipEl?.remove();
    this.highlightEl = null;
    this.tooltipEl = null;
    if (this.fillTimer) clearTimeout(this.fillTimer);
  }
}

/**
 * Start in-page action recording. Listeners capture trusted user events and
 * build a `test(...)` script suitable for `runScript`.
 */
export function startRecording(options?: RecorderOptions): RecorderController {
  return new RecorderImpl(options);
}

export type { RecordedAction, RecorderOptions, RecorderController, AssertKind };
