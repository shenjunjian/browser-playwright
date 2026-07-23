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
  fillAction,
  focusAction,
  hoverElement,
  pressAction,
  selectOptions,
  typeAction,
  type SelectOption,
} from "./input/actions";
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
