import {
  getByAltTextSelector,
  getByLabelSelector,
  getByPlaceholderSelector,
  getByRoleSelector,
  getByTestIdSelector,
  getByTextSelector,
  getByTitleSelector,
} from "../vendor/isomorphic/locatorUtils";
import { escapeWithQuotes } from "../vendor/isomorphic/stringUtils";
import {
  beginAriaCaches,
  endAriaCaches,
  getAriaRole,
  getElementAccessibleNameText,
} from "../vendor/injected/roleUtils";
import {
  elementText,
  getElementLabels,
} from "../vendor/injected/selectorUtils";
import { queryAllInDocument } from "../selectors/query";
import { getTestIdAttribute } from "../locator";

function quote(text: string): string {
  return escapeWithQuotes(text, "'");
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isRecorderChrome(el: Element, uiAttr: string): boolean {
  return !!el.closest(`[${uiAttr}]`);
}

/**
 * Walk up from target to find a useful semantic / interactive element.
 */
export function resolveTargetElement(
  target: EventTarget | null,
  uiAttr = "data-bpw-ui",
): Element | null {
  if (!(target instanceof Node)) return null;
  let el: Element | null =
    target.nodeType === Node.ELEMENT_NODE
      ? (target as Element)
      : target.parentElement;
  while (el) {
    if (isRecorderChrome(el, uiAttr)) return null;
    const tag = el.tagName;
    if (
      tag === "BUTTON" ||
      tag === "A" ||
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      tag === "SUMMARY" ||
      tag === "OPTION" ||
      el.hasAttribute("role") ||
      el.hasAttribute("contenteditable") ||
      el.hasAttribute(getTestIdAttribute())
    ) {
      return el;
    }
    // Prefer labelled control / clickable with text
    if (el.getAttribute("tabindex") != null) return el;
    el = el.parentElement;
  }
  // Fallback: original element if any
  if (target instanceof Element && !isRecorderChrome(target, uiAttr))
    return target;
  if (target instanceof Node && target.parentElement) {
    const p = target.parentElement;
    if (!isRecorderChrome(p, uiAttr)) return p;
  }
  return null;
}

function matchesExactly(
  selector: string,
  element: Element,
  document: Document,
): { unique: boolean; index: number } {
  const all = queryAllInDocument(selector, document);
  const index = all.indexOf(element);
  return { unique: all.length === 1 && index === 0, index };
}

function withNthIfNeeded(
  pageExpr: string,
  selector: string,
  element: Element,
  document: Document,
): string | null {
  const { unique, index } = matchesExactly(selector, element, document);
  if (index < 0) return null;
  if (unique) return pageExpr;
  return `${pageExpr}.nth(${index})`;
}

function tryRole(
  element: Element,
  document: Document,
): string | null {
  beginAriaCaches();
  try {
    const role = getAriaRole(element);
    if (!role || role === "generic" || role === "presentation" || role === "none")
      return null;
    const name = normalizeText(
      getElementAccessibleNameText(element, false),
    );
    if (!name || name.length > 80) {
      const selector = getByRoleSelector(role);
      return withNthIfNeeded(
        `page.getByRole(${quote(role)})`,
        selector,
        element,
        document,
      );
    }
    const selector = getByRoleSelector(role, { name, exact: true });
    return withNthIfNeeded(
      `page.getByRole(${quote(role)}, { name: ${quote(name)}, exact: true })`,
      selector,
      element,
      document,
    );
  } finally {
    endAriaCaches();
  }
}

function tryTestId(element: Element, document: Document): string | null {
  const attr = getTestIdAttribute();
  const value = element.getAttribute(attr);
  if (!value) return null;
  const selector = getByTestIdSelector(attr, value);
  return withNthIfNeeded(
    `page.getByTestId(${quote(value)})`,
    selector,
    element,
    document,
  );
}

function tryLabel(element: Element, document: Document): string | null {
  const cache = new Map();
  const labels = getElementLabels(cache, element);
  for (const label of labels) {
    const text = normalizeText(label.full);
    if (!text || text.length > 80) continue;
    const selector = getByLabelSelector(text, { exact: true });
    const expr = withNthIfNeeded(
      `page.getByLabel(${quote(text)})`,
      selector,
      element,
      document,
    );
    if (expr) return expr;
  }
  return null;
}

function tryAttrText(
  element: Element,
  document: Document,
  attr: "placeholder" | "alt" | "title",
  method: "getByPlaceholder" | "getByAltText" | "getByTitle",
  selectorFn: typeof getByPlaceholderSelector,
): string | null {
  const value = element.getAttribute(attr);
  if (!value) return null;
  const text = normalizeText(value);
  if (!text || text.length > 80) return null;
  const selector = selectorFn(text, { exact: true });
  return withNthIfNeeded(
    `page.${method}(${quote(text)})`,
    selector,
    element,
    document,
  );
}

function tryText(element: Element, document: Document): string | null {
  const cache = new Map();
  const text = normalizeText(elementText(cache, element).full);
  if (!text || text.length > 60 || text.includes("\n")) return null;
  // Prefer exact match when unique
  const selector = getByTextSelector(text, { exact: true });
  const exact = withNthIfNeeded(
    `page.getByText(${quote(text)})`,
    selector,
    element,
    document,
  );
  if (exact && !exact.includes(".nth(")) return exact;
  // Soft match if exact failed uniqueness without nth, or use nth
  if (exact) return exact;
  return null;
}

function cssEscapeIdent(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function")
    return CSS.escape(value);
  return value.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
}

function tryCss(element: Element, document: Document): string {
  const id = element.id;
  if (id && !/\s/.test(id)) {
    const sel = `#${cssEscapeIdent(id)}`;
    try {
      if (document.querySelectorAll(sel).length === 1)
        return `page.locator(${quote(sel)})`;
    } catch {
      // ignore invalid
    }
  }

  const classes = Array.from(element.classList).filter(
    (c) => c && !c.startsWith("bpw-") && c.length < 40,
  );
  if (classes.length) {
    const tag = element.tagName.toLowerCase();
    const sel = `${tag}.${classes.map(cssEscapeIdent).join(".")}`;
    try {
      const matches = document.querySelectorAll(sel);
      if (matches.length === 1 && matches[0] === element)
        return `page.locator(${quote(sel)})`;
      if (matches.length > 1) {
        const index = Array.from(matches).indexOf(element);
        if (index >= 0)
          return `page.locator(${quote(sel)}).nth(${index})`;
      }
    } catch {
      // ignore
    }
  }

  // Full path with nth-child
  const parts: string[] = [];
  let cur: Element | null = element;
  while (
    cur &&
    cur.nodeType === Node.ELEMENT_NODE &&
    cur !== document.documentElement
  ) {
    const tag = cur.tagName.toLowerCase();
    if (cur.id && !/\s/.test(cur.id)) {
      parts.unshift(`#${cssEscapeIdent(cur.id)}`);
      break;
    }
    const parentEl: Element | null = cur.parentElement;
    if (!parentEl) {
      parts.unshift(tag);
      break;
    }
    const sameTag = Array.from(parentEl.children).filter(
      (child): child is Element =>
        child instanceof Element && child.tagName === cur!.tagName,
    );
    if (sameTag.length === 1) parts.unshift(tag);
    else {
      const idx = sameTag.indexOf(cur) + 1;
      parts.unshift(`${tag}:nth-of-type(${idx})`);
    }
    cur = parentEl;
    if (parts.length > 6) break;
  }
  const path = parts.join(" > ");
  return `page.locator(${quote(path)})`;
}

/**
 * Build a Playwright-style locator source expression for `element`
 * (e.g. `page.getByRole('button', { name: 'Submit' })`).
 */
export function generateLocator(
  element: Element,
  document: Document = element.ownerDocument,
): string {
  const candidates: Array<() => string | null> = [
    () => tryTestId(element, document),
    () => tryRole(element, document),
    () => tryLabel(element, document),
    () =>
      tryAttrText(
        element,
        document,
        "placeholder",
        "getByPlaceholder",
        getByPlaceholderSelector,
      ),
    () =>
      tryAttrText(
        element,
        document,
        "alt",
        "getByAltText",
        getByAltTextSelector,
      ),
    () =>
      tryAttrText(
        element,
        document,
        "title",
        "getByTitle",
        getByTitleSelector,
      ),
    () => tryText(element, document),
  ];

  for (const tryFn of candidates) {
    try {
      const result = tryFn();
      if (result) return result;
    } catch {
      // try next strategy
    }
  }

  return tryCss(element, document);
}
