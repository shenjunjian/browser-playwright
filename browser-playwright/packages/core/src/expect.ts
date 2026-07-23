import type { Locator } from "./locator";
import { isChecked, isEditableElement } from "./input/actions";
import {
  bytesEqual,
  getScreenshotBaseline,
  hashBytes,
  setScreenshotBaseline,
  type ScreenshotOptions,
} from "./screenshot";
import { buildAriaSnapshot, matchAriaSnapshot } from "./ariaSnapshot";
import { isElementVisible } from "./vendor/injected/domUtils";
import {
  getAriaRole,
  getAriaDisabled,
  getElementAccessibleDescription,
  getElementAccessibleErrorMessage,
  getElementAccessibleNameText,
} from "./vendor/injected/roleUtils";
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

  async toBeEditable(
    options?: ExpectOptions & { editable?: boolean },
  ): Promise<void> {
    const want = options?.editable ?? true;
    await pollExpect(this._isNot, options, async () => {
      const el = this._locator._queryAll()[0];
      if (!el) return { pass: false, message: "Element not found for toBeEditable" };
      const pass = isEditableElement(el) === want;
      return {
        pass,
        message: `Expected locator ${this._isNot ? "not " : ""}to be editable=${want}`,
      };
    });
  }

  async toBeEmpty(options?: ExpectOptions): Promise<void> {
    await pollExpect(this._isNot, options, async () => {
      const el = this._locator._queryAll()[0];
      if (!el) return { pass: false, message: "Element not found for toBeEmpty" };
      let empty = false;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement
      )
        empty = el.value === "";
      else empty = !(el.textContent ?? "").trim();
      return {
        pass: empty,
        message: `Expected locator ${this._isNot ? "not " : ""}to be empty`,
      };
    });
  }

  async toBeFocused(options?: ExpectOptions): Promise<void> {
    await pollExpect(this._isNot, options, async () => {
      const el = this._locator._queryAll()[0];
      if (!el) return { pass: false, message: "Element not found for toBeFocused" };
      const active = el.ownerDocument.activeElement;
      const pass = active === el || el.contains(active);
      return {
        pass,
        message: `Expected locator ${this._isNot ? "not " : ""}to be focused`,
      };
    });
  }

  async toBeInViewport(
    options?: ExpectOptions & { ratio?: number },
  ): Promise<void> {
    const ratio = options?.ratio ?? 0;
    await pollExpect(this._isNot, options, async () => {
      const el = this._locator._queryAll()[0];
      if (!el || !isElementVisible(el))
        return { pass: false, message: "Element not visible for toBeInViewport" };
      const rect = el.getBoundingClientRect();
      const win = el.ownerDocument.defaultView ?? globalThis;
      const vw = win.innerWidth ?? 0;
      const vh = win.innerHeight ?? 0;
      const overlapX = Math.max(
        0,
        Math.min(rect.right, vw) - Math.max(rect.left, 0),
      );
      const overlapY = Math.max(
        0,
        Math.min(rect.bottom, vh) - Math.max(rect.top, 0),
      );
      const overlap = overlapX * overlapY;
      const area = Math.max(rect.width * rect.height, 1);
      const pass = overlap / area >= ratio && overlap > 0;
      return {
        pass,
        message: `Expected locator ${this._isNot ? "not " : ""}to be in viewport (ratio>=${ratio})`,
      };
    });
  }

  async toHaveClass(
    expected: string | RegExp | (string | RegExp)[],
    options?: ExpectOptions,
  ): Promise<void> {
    await pollExpect(this._isNot, options, async () => {
      const els = this._locator._queryAll();
      if (Array.isArray(expected)) {
        if (els.length !== expected.length)
          return {
            pass: false,
            message: `Expected ${expected.length} elements for toHaveClass, got ${els.length}`,
          };
        const pass = expected.every((e, i) => {
          const cls = els[i].className?.toString?.() ?? String(els[i].className);
          return e instanceof RegExp ? e.test(cls) : cls === e;
        });
        return {
          pass,
          message: `Expected class list ${this._isNot ? "not " : ""}to match ${String(expected)}`,
        };
      }
      const el = els[0];
      if (!el) return { pass: false, message: "Element not found for toHaveClass" };
      const cls = el.className?.toString?.() ?? String(el.className);
      const pass =
        expected instanceof RegExp ? expected.test(cls) : cls === expected;
      return {
        pass,
        message: `Expected class ${JSON.stringify(cls)} ${this._isNot ? "not " : ""}to match ${String(expected)}`,
      };
    });
  }

  async toContainClass(
    expected: string | string[],
    options?: ExpectOptions,
  ): Promise<void> {
    await pollExpect(this._isNot, options, async () => {
      const els = this._locator._queryAll();
      if (Array.isArray(expected)) {
        if (els.length !== expected.length)
          return {
            pass: false,
            message: `Expected ${expected.length} elements for toContainClass, got ${els.length}`,
          };
        const pass = expected.every((e, i) => {
          const tokens = e.trim().split(/\s+/).filter(Boolean);
          return tokens.every((t) => els[i].classList.contains(t));
        });
        return {
          pass,
          message: `Expected classList ${this._isNot ? "not " : ""}to contain ${String(expected)}`,
        };
      }
      const el = els[0];
      if (!el)
        return { pass: false, message: "Element not found for toContainClass" };
      const tokens = expected.trim().split(/\s+/).filter(Boolean);
      const pass = tokens.every((t) => el.classList.contains(t));
      return {
        pass,
        message: `Expected classList ${this._isNot ? "not " : ""}to contain ${JSON.stringify(expected)}`,
      };
    });
  }

  async toHaveCSS(
    name: string,
    value: string | RegExp,
    options?: ExpectOptions,
  ): Promise<void> {
    await pollExpect(this._isNot, options, async () => {
      const el = this._locator._queryAll()[0];
      if (!el) return { pass: false, message: "Element not found for toHaveCSS" };
      const win = el.ownerDocument.defaultView;
      const actual = win?.getComputedStyle(el).getPropertyValue(name)?.trim() ?? "";
      const pass =
        value instanceof RegExp ? value.test(actual) : actual === value;
      return {
        pass,
        message: `Expected CSS ${name}=${JSON.stringify(actual)} ${this._isNot ? "not " : ""}to match ${String(value)}`,
      };
    });
  }

  async toHaveId(
    id: string | RegExp,
    options?: ExpectOptions,
  ): Promise<void> {
    return this.toHaveAttribute("id", id, options);
  }

  async toHaveJSProperty(
    name: string,
    value: unknown,
    options?: ExpectOptions,
  ): Promise<void> {
    await pollExpect(this._isNot, options, async () => {
      const el = this._locator._queryAll()[0] as any;
      if (!el)
        return { pass: false, message: "Element not found for toHaveJSProperty" };
      const actual = el[name];
      const pass = JSON.stringify(actual) === JSON.stringify(value);
      return {
        pass,
        message: `Expected JS property ${name}=${JSON.stringify(actual)} ${this._isNot ? "not " : ""}to equal ${JSON.stringify(value)}`,
      };
    });
  }

  async toHaveRole(
    role: string,
    options?: ExpectOptions,
  ): Promise<void> {
    await pollExpect(this._isNot, options, async () => {
      const el = this._locator._queryAll()[0];
      if (!el) return { pass: false, message: "Element not found for toHaveRole" };
      const actual = getAriaRole(el);
      const pass = actual === role;
      return {
        pass,
        message: `Expected role ${JSON.stringify(actual)} ${this._isNot ? "not " : ""}to be ${JSON.stringify(role)}`,
      };
    });
  }

  async toHaveValues(
    values: ReadonlyArray<string | RegExp>,
    options?: ExpectOptions,
  ): Promise<void> {
    await pollExpect(this._isNot, options, async () => {
      const el = this._locator._queryAll()[0];
      if (!(el instanceof HTMLSelectElement) || !el.multiple)
        return {
          pass: false,
          message: "Expected multi-select for toHaveValues",
        };
      const selected = [...el.selectedOptions].map((o) => o.value);
      const pass =
        selected.length === values.length &&
        values.every((v, i) =>
          v instanceof RegExp ? v.test(selected[i] ?? "") : selected[i] === v,
        );
      return {
        pass,
        message: `Expected values ${JSON.stringify(selected)} ${this._isNot ? "not " : ""}to match ${String(values)}`,
      };
    });
  }

  async toHaveAccessibleName(
    name: string | RegExp,
    options?: ExpectOptions,
  ): Promise<void> {
    await pollExpect(this._isNot, options, async () => {
      const el = this._locator._queryAll()[0];
      if (!el)
        return {
          pass: false,
          message: "Element not found for toHaveAccessibleName",
        };
      const actual = getElementAccessibleNameText(el, false);
      const pass =
        name instanceof RegExp ? name.test(actual) : normalizeWhiteSpace(actual) === normalizeWhiteSpace(name);
      return {
        pass,
        message: `Expected accessible name ${JSON.stringify(actual)} ${this._isNot ? "not " : ""}to match ${String(name)}`,
      };
    });
  }

  async toHaveAccessibleDescription(
    description: string | RegExp,
    options?: ExpectOptions,
  ): Promise<void> {
    await pollExpect(this._isNot, options, async () => {
      const el = this._locator._queryAll()[0];
      if (!el)
        return {
          pass: false,
          message: "Element not found for toHaveAccessibleDescription",
        };
      const actual = getElementAccessibleDescription(el, false);
      const pass =
        description instanceof RegExp
          ? description.test(actual)
          : normalizeWhiteSpace(actual) === normalizeWhiteSpace(description);
      return {
        pass,
        message: `Expected accessible description ${JSON.stringify(actual)} ${this._isNot ? "not " : ""}to match ${String(description)}`,
      };
    });
  }

  async toHaveAccessibleErrorMessage(
    errorMessage: string | RegExp,
    options?: ExpectOptions,
  ): Promise<void> {
    await pollExpect(this._isNot, options, async () => {
      const el = this._locator._queryAll()[0];
      if (!el)
        return {
          pass: false,
          message: "Element not found for toHaveAccessibleErrorMessage",
        };
      const actual = getElementAccessibleErrorMessage(el);
      const pass =
        errorMessage instanceof RegExp
          ? errorMessage.test(actual)
          : normalizeWhiteSpace(actual) === normalizeWhiteSpace(errorMessage);
      return {
        pass,
        message: `Expected accessible error message ${JSON.stringify(actual)} ${this._isNot ? "not " : ""}to match ${String(errorMessage)}`,
      };
    });
  }

  async toMatchAriaSnapshot(
    expectedOrOptions?:
      | string
      | (ExpectOptions & { name?: string; expected?: string }),
    maybeOptions?: ExpectOptions,
  ): Promise<void> {
    const expected =
      typeof expectedOrOptions === "string"
        ? expectedOrOptions
        : expectedOrOptions?.expected;
    const options =
      typeof expectedOrOptions === "string" ? maybeOptions : expectedOrOptions;

    await pollExpect(this._isNot, options, async () => {
      const el = this._locator._queryAll()[0];
      if (!el)
        return {
          pass: false,
          message: "Element not found for toMatchAriaSnapshot",
        };
      const actual = buildAriaSnapshot(el);
      if (!expected) {
        return {
          pass: true,
          message: `Aria snapshot captured:\n${actual}`,
        };
      }
      const pass = matchAriaSnapshot(actual, expected);
      return {
        pass,
        message: `Expected aria snapshot ${this._isNot ? "not " : ""}to match.\nActual:\n${actual}\nExpected:\n${expected}`,
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
