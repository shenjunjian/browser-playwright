import type { Locator } from "./locator";
import { isChecked } from "./input/actions";
import {
  bytesEqual,
  getScreenshotBaseline,
  hashBytes,
  setScreenshotBaseline,
  type ScreenshotOptions,
} from "./screenshot";
import { isElementVisible } from "./vendor/injected/domUtils";
import { getAriaDisabled } from "./vendor/injected/roleUtils";
import { elementText } from "./vendor/injected/selectorUtils";
import { normalizeWhiteSpace } from "./vendor/isomorphic/stringUtils";
import { resolveTimeout, type TimeoutOptions } from "./wait";

export type ExpectOptions = TimeoutOptions & {
  timeout?: number;
};

function textOf(el: Element): string {
  return elementText(new Map(), el).full;
}

function matchText(
  received: string,
  expected: string | RegExp,
  exact?: boolean,
): boolean {
  if (expected instanceof RegExp) return expected.test(received);
  const a = normalizeWhiteSpace(received);
  const b = normalizeWhiteSpace(expected);
  return exact ? a === b : a.includes(b);
}

class ExpectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpectError";
  }
}

type MatcherResult = { pass: boolean; message: string };

async function pollExpect(
  isNot: boolean,
  options: ExpectOptions | undefined,
  run: () => Promise<MatcherResult> | MatcherResult,
): Promise<void> {
  const timeout = resolveTimeout(options);
  const deadline = timeout > 0 ? Date.now() + timeout : 0;
  let lastMessage = `expect${isNot ? ".not" : ""} failed`;
  for (;;) {
    try {
      const result = await run();
      const ok = isNot ? !result.pass : result.pass;
      if (ok) return;
      lastMessage = result.message;
    } catch (e) {
      lastMessage = e instanceof Error ? e.message : String(e);
    }
    if (deadline && Date.now() >= deadline) throw new ExpectError(lastMessage);
    await new Promise((r) => setTimeout(r, 100));
  }
}

export class LocatorAssertions {
  private readonly _locator: Locator;
  private readonly _isNot: boolean;

  constructor(locator: Locator, isNot = false) {
    this._locator = locator;
    this._isNot = isNot;
  }

  get not(): LocatorAssertions {
    return new LocatorAssertions(this._locator, !this._isNot);
  }

  async toBeVisible(options?: ExpectOptions): Promise<void> {
    await pollExpect(this._isNot, options, async () => {
      const el = this._locator._queryAll()[0];
      const pass = !!el && isElementVisible(el);
      return {
        pass,
        message: `Expected locator ${this._isNot ? "not " : ""}to be visible`,
      };
    });
  }

  async toBeHidden(options?: ExpectOptions): Promise<void> {
    await pollExpect(this._isNot, options, async () => {
      const els = this._locator._queryAll();
      const pass = els.length === 0 || !isElementVisible(els[0]);
      return {
        pass,
        message: `Expected locator ${this._isNot ? "not " : ""}to be hidden`,
      };
    });
  }

  async toHaveCount(count: number, options?: ExpectOptions): Promise<void> {
    await pollExpect(this._isNot, options, async () => {
      const actual = this._locator._queryAll().length;
      return {
        pass: actual === count,
        message: `Expected count ${this._isNot ? "not " : ""}to be ${count}, got ${actual}`,
      };
    });
  }

  async toHaveText(
    expected: string | RegExp | (string | RegExp)[],
    options?: ExpectOptions & { exact?: boolean },
  ): Promise<void> {
    await pollExpect(this._isNot, options, async () => {
      const els = this._locator._queryAll();
      if (Array.isArray(expected)) {
        const texts = els.map(textOf);
        const pass =
          texts.length === expected.length &&
          expected.every((e, i) => matchText(texts[i] ?? "", e, options?.exact));
        return {
          pass,
          message: `Expected texts ${JSON.stringify(texts)} ${this._isNot ? "not " : ""}to match ${String(expected)}`,
        };
      }
      if (els.length !== 1) {
        return {
          pass: false,
          message: `Expected 1 element for toHaveText, got ${els.length}`,
        };
      }
      const received = textOf(els[0]);
      return {
        pass: matchText(received, expected, options?.exact),
        message: `Expected text ${JSON.stringify(received)} ${this._isNot ? "not " : ""}to match ${String(expected)}`,
      };
    });
  }

  async toContainText(
    expected: string | RegExp,
    options?: ExpectOptions,
  ): Promise<void> {
    return this.toHaveText(expected, { ...options, exact: false });
  }

  async toHaveAttribute(
    name: string,
    value?: string | RegExp,
    options?: ExpectOptions,
  ): Promise<void> {
    await pollExpect(this._isNot, options, async () => {
      const el = this._locator._queryAll()[0];
      if (!el)
        return { pass: false, message: `Expected element to have attribute "${name}"` };
      const actual = el.getAttribute(name);
      if (value === undefined) {
        return {
          pass: actual !== null,
          message: `Expected attribute "${name}" ${this._isNot ? "not " : ""}to be present`,
        };
      }
      const pass =
        actual !== null &&
        (value instanceof RegExp ? value.test(actual) : actual === value);
      return {
        pass,
        message: `Expected attribute "${name}"=${JSON.stringify(actual)} ${this._isNot ? "not " : ""}to match ${String(value)}`,
      };
    });
  }

  async toHaveValue(
    value: string | RegExp,
    options?: ExpectOptions,
  ): Promise<void> {
    await pollExpect(this._isNot, options, async () => {
      const el = this._locator._queryAll()[0];
      if (
        !(
          el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement ||
          el instanceof HTMLSelectElement
        )
      )
        return { pass: false, message: "Expected input/textarea/select" };
      const actual = el.value;
      const pass =
        value instanceof RegExp ? value.test(actual) : actual === value;
      return {
        pass,
        message: `Expected value ${JSON.stringify(actual)} ${this._isNot ? "not " : ""}to match ${String(value)}`,
      };
    });
  }

  async toBeChecked(
    options?: ExpectOptions & { checked?: boolean },
  ): Promise<void> {
    const want = options?.checked ?? true;
    await pollExpect(this._isNot, options, async () => {
      const el = this._locator._queryAll()[0];
      if (!el) return { pass: false, message: "Element not found for toBeChecked" };
      const pass = isChecked(el) === want;
      return {
        pass,
        message: `Expected locator ${this._isNot ? "not " : ""}to be checked=${want}`,
      };
    });
  }

  async toBeEnabled(options?: ExpectOptions): Promise<void> {
    await pollExpect(this._isNot, options, async () => {
      const el = this._locator._queryAll()[0];
      if (!el) return { pass: false, message: "Element not found for toBeEnabled" };
      const pass = !getAriaDisabled(el);
      return {
        pass,
        message: `Expected locator ${this._isNot ? "not " : ""}to be enabled`,
      };
    });
  }

  async toBeDisabled(options?: ExpectOptions): Promise<void> {
    await pollExpect(this._isNot, options, async () => {
      const el = this._locator._queryAll()[0];
      if (!el) return { pass: false, message: "Element not found for toBeDisabled" };
      const pass = getAriaDisabled(el);
      return {
        pass,
        message: `Expected locator ${this._isNot ? "not " : ""}to be disabled`,
      };
    });
  }

  async toBeAttached(options?: ExpectOptions): Promise<void> {
    await pollExpect(this._isNot, options, async () => {
      const pass = this._locator._queryAll().length > 0;
      return {
        pass,
        message: `Expected locator ${this._isNot ? "not " : ""}to be attached`,
      };
    });
  }

  /**
   * Basic screenshot assertion (hash / byte compare).
   * Not pixel-identical to Playwright CDP `toHaveScreenshot`.
   *
   * - First call with a `name` stores an in-memory baseline.
   * - Later calls compare against that baseline (or `expected` bytes).
   */
  async toHaveScreenshot(
    nameOrOptions?:
      | string
      | (ExpectOptions &
          ScreenshotOptions & {
            name?: string;
            expected?: Uint8Array;
            maxDiffPixels?: number;
          }),
    maybeOptions?: ExpectOptions &
      ScreenshotOptions & {
        expected?: Uint8Array;
        maxDiffPixels?: number;
      },
  ): Promise<void> {
    const name =
      typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions?.name;
    const options =
      typeof nameOrOptions === "string" ? maybeOptions : nameOrOptions;

    await pollExpect(this._isNot, options, async () => {
      const actual = await this._locator.screenshot(options);
      const expected =
        options?.expected ??
        (name ? getScreenshotBaseline(name) : undefined);

      if (!expected) {
        if (name) setScreenshotBaseline(name, actual);
        // First snapshot: treat as pass (baseline established).
        return {
          pass: true,
          message: `Screenshot baseline created${name ? ` for "${name}"` : ""}`,
        };
      }

      const pass = bytesEqual(actual, expected);
      return {
        pass,
        message: `Expected screenshot ${this._isNot ? "not " : ""}to match${
          name ? ` "${name}"` : ""
        } (actual hash=${hashBytes(actual)}, expected hash=${hashBytes(expected)})`,
      };
    });
  }
}

class GenericAssertions {
  private readonly _actual: unknown;
  private readonly _isNot: boolean;

  constructor(actual: unknown, isNot = false) {
    this._actual = actual;
    this._isNot = isNot;
  }

  get not(): GenericAssertions {
    return new GenericAssertions(this._actual, !this._isNot);
  }

  toBeNull(): void {
    const pass = this._actual === null;
    if (this._isNot ? pass : !pass)
      throw new ExpectError(
        `Expected ${String(this._actual)} ${this._isNot ? "not " : ""}to be null`,
      );
  }

  toBe(expected: unknown): void {
    const pass = Object.is(this._actual, expected);
    if (this._isNot ? pass : !pass)
      throw new ExpectError(
        `Expected ${String(this._actual)} ${this._isNot ? "not " : ""}to be ${String(expected)}`,
      );
  }

  toEqual(expected: unknown): void {
    const pass = JSON.stringify(this._actual) === JSON.stringify(expected);
    if (this._isNot ? pass : !pass)
      throw new ExpectError(
        `Expected ${JSON.stringify(this._actual)} ${this._isNot ? "not " : ""}to equal ${JSON.stringify(expected)}`,
      );
  }

  toBeTruthy(): void {
    const pass = !!this._actual;
    if (this._isNot ? pass : !pass)
      throw new ExpectError(
        `Expected ${String(this._actual)} ${this._isNot ? "not " : ""}to be truthy`,
      );
  }

  toBeFalsy(): void {
    const pass = !this._actual;
    if (this._isNot ? pass : !pass)
      throw new ExpectError(
        `Expected ${String(this._actual)} ${this._isNot ? "not " : ""}to be falsy`,
      );
  }
}

function isLocator(value: unknown): value is Locator {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Locator)._queryAll === "function" &&
    typeof (value as Locator).waitFor === "function"
  );
}

export function expect(actual: Locator): LocatorAssertions;
export function expect(actual: unknown): GenericAssertions;
export function expect(actual: unknown): LocatorAssertions | GenericAssertions {
  if (isLocator(actual)) return new LocatorAssertions(actual);
  return new GenericAssertions(actual);
}
