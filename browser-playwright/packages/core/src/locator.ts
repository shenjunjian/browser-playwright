import {
  getByAltTextSelector,
  getByLabelSelector,
  getByPlaceholderSelector,
  getByRoleSelector,
  getByTestIdSelector,
  getByTextSelector,
  getByTitleSelector,
  type ByRoleOptions,
} from "./vendor/isomorphic/locatorUtils";
import { escapeForTextSelector } from "./vendor/isomorphic/stringUtils";
import { isElementVisible } from "./vendor/injected/domUtils";
import { getAriaDisabled } from "./vendor/injected/roleUtils";
import {
  blurAction,
  checkAction,
  clickElement,
  dblclickElement,
  dispatchEventAction,
  dragToAction,
  fillAction,
  focusAction,
  hoverElement,
  isChecked,
  isEditableElement,
  pressAction,
  selectOptions,
  selectTextAction,
  setInputFilesAction,
  tapElement,
  typeAction,
  type SelectOption,
} from "./input/actions";
import { buildAriaSnapshot } from "./ariaSnapshot";
import {
  elementMatchesState,
  queryAllInDocument,
  type WaitState,
} from "./selectors/query";
import {
  screenshotElement,
  type ScreenshotOptions,
} from "./screenshot";
import { pollUntil, resolveTimeout, type TimeoutOptions } from "./wait";

export type { ByRoleOptions };

export type LocatorOptions = {
  hasText?: string | RegExp;
  hasNotText?: string | RegExp;
  has?: Locator;
  hasNot?: Locator;
  visible?: boolean;
};

export type ExactOptions = { exact?: boolean };

let testIdAttributeName = "data-testid";

export function setTestIdAttribute(attributeName: string): void {
  testIdAttributeName = attributeName;
}

export function getTestIdAttribute(): string {
  return testIdAttributeName;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** Shared document root for Page / Locator / FrameLocator. */
export interface FrameContext {
  document: Document;
  timeout: number;
  /** Set by Page after construction. */
  page?: import("./page").Page;
}

function locTimeout(
  context: FrameContext,
  options?: TimeoutOptions,
): number {
  return resolveTimeout(options, context.timeout);
}

export class Locator {
  readonly _selector: string;
  readonly _context: FrameContext;

  constructor(
    context: FrameContext,
    selector: string,
    options?: LocatorOptions,
  ) {
    this._context = context;
    this._selector = selector;

    if (options?.hasText)
      this._selector += ` >> internal:has-text=${escapeForTextSelector(options.hasText, false)}`;
    if (options?.hasNotText)
      this._selector += ` >> internal:has-not-text=${escapeForTextSelector(options.hasNotText, false)}`;
    if (options?.has) {
      if (options.has._context !== context)
        throw new Error(`Inner "has" locator must belong to the same frame.`);
      this._selector += ` >> internal:has=` + JSON.stringify(options.has._selector);
    }
    if (options?.hasNot) {
      if (options.hasNot._context !== context)
        throw new Error(`Inner "hasNot" locator must belong to the same frame.`);
      this._selector +=
        ` >> internal:has-not=` + JSON.stringify(options.hasNot._selector);
    }
    if (options?.visible !== undefined)
      this._selector += ` >> visible=${options.visible ? "true" : "false"}`;
  }

  page(): import("./page").Page {
    if (!this._context.page)
      throw new Error("Page is not available on this locator context");
    return this._context.page;
  }

  locator(
    selectorOrLocator: string | Locator,
    options?: Omit<LocatorOptions, "visible">,
  ): Locator {
    if (isString(selectorOrLocator))
      return new Locator(
        this._context,
        this._selector + " >> " + selectorOrLocator,
        options,
      );
    if (selectorOrLocator._context !== this._context)
      throw new Error(`Locators must belong to the same frame.`);
    return new Locator(
      this._context,
      this._selector +
        " >> internal:chain=" +
        JSON.stringify(selectorOrLocator._selector),
      options,
    );
  }

  getByTestId(testId: string | RegExp): Locator {
    return this.locator(getByTestIdSelector(testIdAttributeName, testId));
  }

  getByAltText(text: string | RegExp, options?: ExactOptions): Locator {
    return this.locator(getByAltTextSelector(text, options));
  }

  getByLabel(text: string | RegExp, options?: ExactOptions): Locator {
    return this.locator(getByLabelSelector(text, options));
  }

  getByPlaceholder(text: string | RegExp, options?: ExactOptions): Locator {
    return this.locator(getByPlaceholderSelector(text, options));
  }

  getByText(text: string | RegExp, options?: ExactOptions): Locator {
    return this.locator(getByTextSelector(text, options));
  }

  getByTitle(text: string | RegExp, options?: ExactOptions): Locator {
    return this.locator(getByTitleSelector(text, options));
  }

  getByRole(role: string, options: ByRoleOptions = {}): Locator {
    return this.locator(getByRoleSelector(role, options));
  }

  filter(options?: LocatorOptions): Locator {
    return new Locator(this._context, this._selector, options);
  }

  first(): Locator {
    return new Locator(this._context, this._selector + " >> nth=0");
  }

  last(): Locator {
    return new Locator(this._context, this._selector + ` >> nth=-1`);
  }

  nth(index: number): Locator {
    return new Locator(this._context, this._selector + ` >> nth=${index}`);
  }

  and(locator: Locator): Locator {
    if (locator._context !== this._context)
      throw new Error(`Locators must belong to the same frame.`);
    return new Locator(
      this._context,
      this._selector + ` >> internal:and=` + JSON.stringify(locator._selector),
    );
  }

  or(locator: Locator): Locator {
    if (locator._context !== this._context)
      throw new Error(`Locators must belong to the same frame.`);
    return new Locator(
      this._context,
      this._selector + ` >> internal:or=` + JSON.stringify(locator._selector),
    );
  }

  frameLocator(selector: string): FrameLocator {
    return new FrameLocator(this._context, this._selector + " >> " + selector);
  }

  contentFrame(): FrameLocator {
    return new FrameLocator(this._context, this._selector);
  }

  /** Query all matching elements now (no wait). */
  _queryAll(): Element[] {
    return queryAllInDocument(this._selector, this._context.document);
  }

  async count(): Promise<number> {
    return this._queryAll().length;
  }

  async elementHandles(): Promise<Element[]> {
    return this._queryAll();
  }

  /**
   * Wait until the locator reaches the given state (auto-wait).
   * Mirrors Playwright `locator.waitFor`.
   */
  async waitFor(
    options: TimeoutOptions & { state?: WaitState } = {},
  ): Promise<void> {
    const state = options.state ?? "visible";
    const timeout = locTimeout(this._context, options);
    await pollUntil(
      () => {
        const elements = this._queryAll();
        if (state === "hidden") {
          if (elements.length === 0) return true;
          if (elements.length > 1)
            throw new Error(
              `strict mode violation: "${this._selector}" resolved to ${elements.length} elements`,
            );
          return elementMatchesState(elements[0], "hidden") ? true : undefined;
        }
        if (elements.length > 1)
          throw new Error(
            `strict mode violation: "${this._selector}" resolved to ${elements.length} elements`,
          );
        const el = elements[0];
        return elementMatchesState(el, state) ? true : undefined;
      },
      {
        timeout,
        message: `Timeout ${timeout}ms exceeded waiting for ${state} locator "${this._selector}"`,
      },
    );
  }

  /** Resolve one attached element with auto-wait. Strict. */
  async elementHandle(options?: TimeoutOptions): Promise<Element> {
    const timeout = locTimeout(this._context, options);
    return pollUntil(
      () => {
        const elements = this._queryAll();
        if (elements.length > 1)
          throw new Error(
            `strict mode violation: "${this._selector}" resolved to ${elements.length} elements`,
          );
        return elements[0];
      },
      {
        timeout,
        message: `Timeout ${timeout}ms exceeded waiting for locator "${this._selector}"`,
      },
    );
  }

  /**
   * Auto-wait for a visible & enabled element before actions (Phase 2 hook).
   */
  async _waitForActionable(options?: TimeoutOptions): Promise<Element> {
    const timeout = locTimeout(this._context, options);
    return pollUntil(
      () => {
        const elements = this._queryAll();
        if (elements.length > 1)
          throw new Error(
            `strict mode violation: "${this._selector}" resolved to ${elements.length} elements`,
          );
        const el = elements[0];
        if (!el) return undefined;
        if (!isElementVisible(el)) return undefined;
        if (getAriaDisabled(el)) return undefined;
        return el;
      },
      {
        timeout,
        message: `Timeout ${timeout}ms exceeded waiting for actionable locator "${this._selector}"`,
      },
    );
  }

  async isVisible(_options?: TimeoutOptions): Promise<boolean> {
    const el = this._queryAll()[0];
    return !!el && isElementVisible(el);
  }

  async isHidden(options?: TimeoutOptions): Promise<boolean> {
    return !(await this.isVisible(options));
  }

  async isEnabled(options?: TimeoutOptions): Promise<boolean> {
    const el = await this.elementHandle(options);
    return !getAriaDisabled(el);
  }

  async isDisabled(options?: TimeoutOptions): Promise<boolean> {
    return !(await this.isEnabled(options));
  }

  async getAttribute(
    name: string,
    options?: TimeoutOptions,
  ): Promise<string | null> {
    const el = await this.elementHandle(options);
    return el.getAttribute(name);
  }

  async textContent(options?: TimeoutOptions): Promise<string | null> {
    const el = await this.elementHandle(options);
    return el.textContent;
  }

  async innerText(options?: TimeoutOptions): Promise<string> {
    await this.waitFor({ ...options, state: "visible" });
    const el = await this.elementHandle(options);
    return (el as HTMLElement).innerText;
  }

  async innerHTML(options?: TimeoutOptions): Promise<string> {
    const el = await this.elementHandle(options);
    return el.innerHTML;
  }

  async inputValue(options?: TimeoutOptions): Promise<string> {
    await this.waitFor({ ...options, state: "visible" });
    const el = await this.elementHandle(options);
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
    )
      return el.value;
    throw new Error("Not an input / textarea / select element");
  }

  async click(
    options?: TimeoutOptions & {
      button?: "left" | "right" | "middle";
      clickCount?: number;
    },
  ): Promise<void> {
    const el = await this._waitForActionable(options);
    await clickElement(this._context.document, el, options);
  }

  async dblclick(options?: TimeoutOptions): Promise<void> {
    const el = await this._waitForActionable(options);
    await dblclickElement(this._context.document, el);
  }

  async hover(options?: TimeoutOptions): Promise<void> {
    const el = await this._waitForActionable(options);
    await hoverElement(this._context.document, el);
  }

  async fill(value: string, options?: TimeoutOptions): Promise<void> {
    const el = await this._waitForActionable(options);
    await fillAction(this._context.document, el, value);
  }

  async type(
    text: string,
    options?: TimeoutOptions & { delay?: number },
  ): Promise<void> {
    const el = await this._waitForActionable(options);
    await typeAction(this._context.document, el, text, options);
  }

  async press(
    key: string,
    options?: TimeoutOptions & { delay?: number },
  ): Promise<void> {
    const el = await this._waitForActionable(options);
    await pressAction(this._context.document, el, key, options);
  }

  async check(options?: TimeoutOptions): Promise<void> {
    const el = await this._waitForActionable(options);
    await checkAction(this._context.document, el, true);
  }

  async uncheck(options?: TimeoutOptions): Promise<void> {
    const el = await this._waitForActionable(options);
    await checkAction(this._context.document, el, false);
  }

  async selectOption(
    values: SelectOption | SelectOption[],
    options?: TimeoutOptions,
  ): Promise<string[]> {
    const el = await this._waitForActionable(options);
    return selectOptions(el, values);
  }

  async focus(options?: TimeoutOptions): Promise<void> {
    const el = await this.elementHandle(options);
    await focusAction(el);
  }

  async blur(options?: TimeoutOptions): Promise<void> {
    const el = await this.elementHandle(options);
    await blurAction(el);
  }

  async clear(options?: TimeoutOptions): Promise<void> {
    const el = await this._waitForActionable(options);
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement
    ) {
      el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    await this.fill("", options);
  }

  async pressSequentially(
    text: string,
    options?: TimeoutOptions & { delay?: number },
  ): Promise<void> {
    await this.type(text, options);
  }

  async setChecked(
    checked: boolean,
    options?: TimeoutOptions,
  ): Promise<void> {
    if (checked) await this.check(options);
    else await this.uncheck(options);
  }

  async isChecked(options?: TimeoutOptions): Promise<boolean> {
    const el = await this.elementHandle(options);
    return isChecked(el);
  }

  async isEditable(options?: TimeoutOptions): Promise<boolean> {
    const el = await this.elementHandle(options);
    return isEditableElement(el);
  }

  async dispatchEvent(
    type: string,
    eventInit?: EventInit,
    options?: TimeoutOptions,
  ): Promise<void> {
    const el = await this.elementHandle(options);
    await dispatchEventAction(el, type, eventInit);
  }

  async tap(options?: TimeoutOptions): Promise<void> {
    const el = await this._waitForActionable(options);
    await tapElement(this._context.document, el);
  }

  async selectText(options?: TimeoutOptions): Promise<void> {
    const el = await this._waitForActionable(options);
    await selectTextAction(el);
  }

  async scrollIntoViewIfNeeded(options?: TimeoutOptions): Promise<void> {
    const el = await this.elementHandle(options);
    (el as HTMLElement).scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
    });
  }

  async setInputFiles(
    files:
      | string
      | string[]
      | { name: string; mimeType: string; buffer: ArrayBuffer | Uint8Array }[]
      | File[],
    options?: TimeoutOptions,
  ): Promise<void> {
    const el = await this.elementHandle(options);
    await setInputFilesAction(el, files);
  }

  async dragTo(target: Locator, options?: TimeoutOptions): Promise<void> {
    const source = await this._waitForActionable(options);
    const dest = await target._waitForActionable(options);
    await dragToAction(this._context.document, source, dest);
  }

  async drop(
    _payload: unknown,
    _options?: TimeoutOptions,
  ): Promise<void> {
    // Degraded stub: Playwright drop uses CDP file payloads.
    throw new Error(
      "locator.drop() is not fully supported in-page; use dragTo or setInputFiles",
    );
  }

  async all(): Promise<Locator[]> {
    const n = await this.count();
    return Array.from({ length: n }, (_, i) => this.nth(i));
  }

  async allInnerTexts(): Promise<string[]> {
    return this._queryAll().map((el) => (el as HTMLElement).innerText ?? "");
  }

  async allTextContents(): Promise<string[]> {
    return this._queryAll().map((el) => el.textContent ?? "");
  }

  /**
   * Same-realm evaluateHandle: returns the raw result (no JSHandle wrapper).
   */
  async evaluateHandle<R, Arg = unknown>(
    pageFunction: ((element: Element, arg: Arg) => R | Promise<R>) | string,
    arg?: Arg,
    options?: TimeoutOptions,
  ): Promise<R> {
    return this.evaluate(pageFunction, arg, options);
  }

  async waitForFunction<R, Arg = unknown>(
    pageFunction: ((element: Element, arg: Arg) => R | Promise<R>) | string,
    arg?: Arg,
    options?: TimeoutOptions & { polling?: number },
  ): Promise<R> {
    const timeout = locTimeout(this._context, options);
    const interval = options?.polling ?? 100;
    const deadline = timeout > 0 ? Date.now() + timeout : 0;
    for (;;) {
      const el = this._queryAll()[0];
      if (el) {
        const value =
          typeof pageFunction === "string"
            ? await new Function(
                "element",
                "arg",
                `return (${pageFunction})(element, arg)`,
              )(el, arg)
            : await pageFunction(el, arg as Arg);
        if (value) return value as R;
      }
      if (deadline && Date.now() >= deadline)
        throw new Error(
          `Timeout ${timeout}ms exceeded waiting for locator.waitForFunction`,
        );
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  async ariaSnapshot(options?: TimeoutOptions): Promise<string> {
    const el = await this.elementHandle(options);
    return buildAriaSnapshot(el);
  }

  describe(description: string): Locator {
    return new Locator(
      this._context,
      this._selector + " >> internal:describe=" + JSON.stringify(description),
    );
  }

  description(): string | null {
    const marker = "internal:describe=";
    const idx = this._selector.lastIndexOf(marker);
    if (idx === -1) return null;
    const raw = this._selector.slice(idx + marker.length);
    // Body may be followed by ` >> ...`
    const end = raw.indexOf(" >> ");
    const json = end === -1 ? raw : raw.slice(0, end);
    try {
      return JSON.parse(json);
    } catch {
      return json || null;
    }
  }

  /** In-page: return self (no CDP selector resolve). */
  async normalize(): Promise<Locator> {
    return this;
  }

  async highlight(options?: {
    style?: string | Record<string, string | number>;
  }): Promise<{ dispose(): void }> {
    const el = await this.elementHandle();
    const rect = el.getBoundingClientRect();
    const doc = this._context.document;
    const overlay = doc.createElement("x-bp-highlight");
    const styleObj =
      typeof options?.style === "object" && options.style
        ? options.style
        : undefined;
    const styleStr =
      typeof options?.style === "string"
        ? options.style
        : styleObj
          ? Object.entries(styleObj)
              .map(([k, v]) => `${k}:${v}`)
              .join(";")
          : "outline:2px solid #f00;background:rgb(255 0 0 / 15%);";
    Object.assign(overlay.style, {
      position: "fixed",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      pointerEvents: "none",
      zIndex: "2147483647",
    });
    overlay.setAttribute(
      "style",
      (overlay.getAttribute("style") || "") + ";" + styleStr,
    );
    overlay.dataset.bpHighlight = this._selector;
    doc.documentElement.appendChild(overlay);
    return { dispose: () => overlay.remove() };
  }

  async hideHighlight(): Promise<void> {
    const doc = this._context.document;
    for (const node of doc.querySelectorAll("x-bp-highlight")) {
      if ((node as HTMLElement).dataset.bpHighlight === this._selector)
        node.remove();
    }
  }

  /**
   * Run a function on the matched element (same-realm; no CDP serialization).
   * Mirrors Playwright `locator.evaluate`.
   */
  async evaluate<R, Arg = unknown>(
    pageFunction: ((element: Element, arg: Arg) => R | Promise<R>) | string,
    arg?: Arg,
    options?: TimeoutOptions,
  ): Promise<R> {
    const el = await this.elementHandle(options);
    if (typeof pageFunction === "string") {
      const fn = new Function(
        "element",
        "arg",
        `return (${pageFunction})(element, arg)`,
      );
      return await fn(el, arg);
    }
    return await pageFunction(el, arg as Arg);
  }

  /**
   * Run a function on all matched elements (no auto-wait).
   * Mirrors Playwright `locator.evaluateAll`.
   */
  async evaluateAll<R, Arg = unknown>(
    pageFunction: ((elements: Element[], arg: Arg) => R | Promise<R>) | string,
    arg?: Arg,
  ): Promise<R> {
    const elements = this._queryAll();
    if (typeof pageFunction === "string") {
      const fn = new Function(
        "elements",
        "arg",
        `return (${pageFunction})(elements, arg)`,
      );
      return await fn(elements, arg);
    }
    return await pageFunction(elements, arg as Arg);
  }

  /**
   * Element bounding box relative to the viewport (`getBoundingClientRect`).
   * Returns `null` when the element is not visible.
   */
  async boundingBox(
    options?: TimeoutOptions,
  ): Promise<{ x: number; y: number; width: number; height: number } | null> {
    const el = await this.elementHandle(options);
    if (!isElementVisible(el)) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  }

  /**
   * Element screenshot via DOM→canvas (not CDP-identical).
   * Returns `Uint8Array` (PNG/JPEG or fingerprint fallback).
   */
  async screenshot(
    options?: TimeoutOptions & ScreenshotOptions,
  ): Promise<Uint8Array> {
    await this.waitFor({ ...options, state: "visible" });
    const el = await this.elementHandle(options);
    return screenshotElement(el, options);
  }

  toString(): string {
    return `Locator('${this._selector}')`;
  }
}

export class FrameLocator {
  readonly _frameSelector: string;
  readonly _context: FrameContext;

  constructor(context: FrameContext, frameSelector: string) {
    this._context = context;
    this._frameSelector = frameSelector;
  }

  locator(
    selectorOrLocator: string | Locator,
    options?: LocatorOptions,
  ): Locator {
    if (isString(selectorOrLocator))
      return new Locator(
        this._context,
        this._frameSelector +
          " >> internal:control=enter-frame >> " +
          selectorOrLocator,
        options,
      );
    if (selectorOrLocator._context !== this._context)
      throw new Error(`Locators must belong to the same frame.`);
    return new Locator(
      this._context,
      this._frameSelector +
        " >> internal:control=enter-frame >> " +
        selectorOrLocator._selector,
      options,
    );
  }

  getByTestId(testId: string | RegExp): Locator {
    return this.locator(getByTestIdSelector(testIdAttributeName, testId));
  }

  getByAltText(text: string | RegExp, options?: ExactOptions): Locator {
    return this.locator(getByAltTextSelector(text, options));
  }

  getByLabel(text: string | RegExp, options?: ExactOptions): Locator {
    return this.locator(getByLabelSelector(text, options));
  }

  getByPlaceholder(text: string | RegExp, options?: ExactOptions): Locator {
    return this.locator(getByPlaceholderSelector(text, options));
  }

  getByText(text: string | RegExp, options?: ExactOptions): Locator {
    return this.locator(getByTextSelector(text, options));
  }

  getByTitle(text: string | RegExp, options?: ExactOptions): Locator {
    return this.locator(getByTitleSelector(text, options));
  }

  getByRole(role: string, options: ByRoleOptions = {}): Locator {
    return this.locator(getByRoleSelector(role, options));
  }

  frameLocator(selector: string): FrameLocator {
    return new FrameLocator(
      this._context,
      this._frameSelector +
        " >> internal:control=enter-frame >> " +
        selector,
    );
  }

  first(): FrameLocator {
    return new FrameLocator(this._context, this._frameSelector + " >> nth=0");
  }

  last(): FrameLocator {
    return new FrameLocator(this._context, this._frameSelector + ` >> nth=-1`);
  }

  nth(index: number): FrameLocator {
    return new FrameLocator(
      this._context,
      this._frameSelector + ` >> nth=${index}`,
    );
  }

  owner(): Locator {
    return new Locator(this._context, this._frameSelector);
  }
}
