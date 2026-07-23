import { isElementVisible } from "../vendor/injected/domUtils";
import { createRoleEngine } from "../vendor/injected/roleSelectorEngine";
import { getAriaDisabled } from "../vendor/injected/roleUtils";
import type { SelectorEngine, SelectorRoot } from "../vendor/injected/selectorEngine";
import {
  elementMatchesText,
  elementText,
  getElementLabels,
} from "../vendor/injected/selectorUtils";
import {
  parseAttributeSelector,
  parseSelector,
  splitSelectorByFrame,
  type NestedSelectorBody,
  type ParsedSelector,
  type ParsedSelectorPart,
} from "../vendor/isomorphic/selectorParser";
import { splitTestIdAttributeNames } from "../vendor/isomorphic/locatorUtils";
import { queryCSS, queryXPath, sortInDOMOrder } from "./domQuery";
import { createAttributeMatcher, createTextMatcher } from "./textMatcher";

const textCache = () => new Map<Element | ShadowRoot, ReturnType<typeof elementText>>();

function createTextEngine(internal: boolean): SelectorEngine {
  return {
    queryAll(root: SelectorRoot, selector: string): Element[] {
      const { matcher, kind } = createTextMatcher(selector, internal);
      const result: Element[] = [];
      let lastDidNotMatchSelf: Element | null = null;
      const cache = textCache();

      const appendElement = (element: Element) => {
        if (
          kind === "lax" &&
          lastDidNotMatchSelf &&
          lastDidNotMatchSelf.contains(element)
        )
          return;
        const matches = elementMatchesText(cache, element, matcher);
        if (matches === "none") lastDidNotMatchSelf = element;
        if (
          matches === "self" ||
          (matches === "selfAndChildren" && kind === "strict" && !internal)
        )
          result.push(element);
      };

      if (root.nodeType === Node.ELEMENT_NODE) appendElement(root as Element);
      for (const element of queryCSS(root, "*", true)) appendElement(element);
      return result;
    },
  };
}

function createInternalHasTextEngine(negate: boolean): SelectorEngine {
  return {
    queryAll(root: SelectorRoot, selector: string): Element[] {
      if (root.nodeType !== Node.ELEMENT_NODE) return [];
      const element = root as Element;
      const text = elementText(textCache(), element);
      const { matcher } = createTextMatcher(selector, true);
      const ok = matcher(text);
      if (negate) return ok ? [] : [element];
      return ok ? [element] : [];
    },
  };
}

function createInternalLabelEngine(): SelectorEngine {
  return {
    queryAll(root: SelectorRoot, selector: string): Element[] {
      const { matcher } = createTextMatcher(selector, true);
      const cache = textCache();
      return queryCSS(root, "*", true).filter((element) =>
        getElementLabels(cache, element).some((label) => matcher(label)),
      );
    },
  };
}

function createNamedAttributeEngine(): SelectorEngine {
  return {
    queryAll(root: SelectorRoot, selector: string): Element[] {
      const parsed = parseAttributeSelector(selector, true);
      if (parsed.name || parsed.attributes.length !== 1)
        throw new Error("Malformed attribute selector: " + selector);
      const { name } = parsed.attributes[0];
      const matcher = createAttributeMatcher(parsed.attributes[0]);
      return queryCSS(root, `[${name}]`, true).filter((e) =>
        matcher(e.getAttribute(name)!),
      );
    },
  };
}

function createTestIdEngine(): SelectorEngine {
  return {
    queryAll(root: SelectorRoot, selector: string): Element[] {
      const parsed = parseAttributeSelector(selector, true);
      if (parsed.name || parsed.attributes.length !== 1)
        throw new Error("Malformed test id selector: " + selector);
      const names = splitTestIdAttributeNames(parsed.attributes[0].name);
      const matcher = createAttributeMatcher(parsed.attributes[0]);
      const cssQuery = names.map((n) => `[${n}]`).join(",");
      return queryCSS(root, cssQuery, true).filter((e) =>
        names.some((n) => {
          const actual = e.getAttribute(n);
          return actual !== null && matcher(actual);
        }),
      );
    },
  };
}

function createVisibleEngine(): SelectorEngine {
  return {
    queryAll(root: SelectorRoot, body: string): Element[] {
      if (root.nodeType !== Node.ELEMENT_NODE) return [];
      const visible = body === "true";
      return isElementVisible(root as Element) === visible
        ? [root as Element]
        : [];
    },
  };
}

function createCSSEngine(): SelectorEngine {
  return {
    queryAll(root: SelectorRoot, body: unknown): Element[] {
      // Prefer original source string when available via part.source in caller.
      if (typeof body === "string") return queryCSS(root, body, true);
      return [];
    },
  };
}

function createXPathEngine(): SelectorEngine {
  return {
    queryAll(root: SelectorRoot, body: string): Element[] {
      return queryXPath(root, body);
    },
  };
}

function createControlEngine(): SelectorEngine {
  return {
    queryAll() {
      return [];
    },
  };
}

const engines = new Map<string, SelectorEngine>([
  ["css", createCSSEngine()],
  ["xpath", createXPathEngine()],
  ["text", createTextEngine(false)],
  ["internal:text", createTextEngine(true)],
  ["internal:has-text", createInternalHasTextEngine(false)],
  ["internal:has-not-text", createInternalHasTextEngine(true)],
  ["internal:label", createInternalLabelEngine()],
  ["internal:attr", createNamedAttributeEngine()],
  ["internal:testid", createTestIdEngine()],
  ["internal:role", createRoleEngine(true)],
  ["role", createRoleEngine(false)],
  ["visible", createVisibleEngine()],
  ["internal:control", createControlEngine()],
  ["internal:describe", {
    queryAll(root: SelectorRoot): Element[] {
      if (root.nodeType !== Node.ELEMENT_NODE) return [];
      return [root as Element];
    },
  }],
]);

function queryEngineAll(
  part: ParsedSelectorPart,
  root: SelectorRoot,
  queryAll: (selector: ParsedSelector, root: Node) => Element[],
): Element[] {
  if (part.name === "internal:has") {
    if (root.nodeType !== Node.ELEMENT_NODE) return [];
    const has = queryAll((part.body as NestedSelectorBody).parsed, root).length > 0;
    return has ? [root as Element] : [];
  }
  if (part.name === "internal:has-not") {
    if (root.nodeType !== Node.ELEMENT_NODE) return [];
    const has = queryAll((part.body as NestedSelectorBody).parsed, root).length > 0;
    return has ? [] : [root as Element];
  }
  if (part.name === "internal:chain") {
    return queryAll((part.body as NestedSelectorBody).parsed, root);
  }
  if (part.name === "css") {
    // Use source string with native CSS (AST from parseCSS not evaluated here).
    return queryCSS(root, part.source, true);
  }
  const engine = engines.get(part.name);
  if (!engine)
    throw new Error(`Unknown selector engine "${part.name}"`);
  return engine.queryAll(root, part.body as any);
}

function queryNth(elements: Set<Element>, part: ParsedSelectorPart): Set<Element> {
  const list = [...elements];
  let nth = +part.body;
  if (nth === -1) nth = list.length - 1;
  return new Set(list.slice(nth, nth + 1));
}

export function querySelectorAll(
  selector: ParsedSelector,
  root: Node,
): Element[] {
  if (!(root as ParentNode).querySelectorAll)
    throw new Error("Node is not queryable.");

  let roots = new Set<Element>([root as Element]);
  for (const part of selector.parts) {
    if (part.name === "nth") {
      roots = queryNth(roots, part);
    } else if (part.name === "internal:and") {
      const andElements = querySelectorAll(
        (part.body as NestedSelectorBody).parsed,
        root,
      );
      roots = new Set(andElements.filter((e) => roots.has(e)));
    } else if (part.name === "internal:or") {
      const orElements = querySelectorAll(
        (part.body as NestedSelectorBody).parsed,
        root,
      );
      roots = new Set(sortInDOMOrder(new Set([...roots, ...orElements])));
    } else {
      const next = new Set<Element>();
      for (const r of roots) {
        for (const one of queryEngineAll(part, r, querySelectorAll))
          next.add(one);
      }
      roots = next;
    }
  }
  return [...roots];
}

export function querySelector(
  selector: ParsedSelector,
  root: Node,
  strict: boolean,
): Element | undefined {
  const result = querySelectorAll(selector, root);
  if (strict && result.length > 1) {
    throw new Error(
      `strict mode violation: resolved to ${result.length} elements`,
    );
  }
  return result[0];
}

/** Resolve a selector string against a document, crossing same-origin iframes. */
export function queryAllInDocument(
  selector: string,
  document: Document,
): Element[] {
  const frames = splitSelectorByFrame(selector);
  if (frames.length === 1)
    return querySelectorAll(frames[0], document);

  let roots: (Document | Element)[] = [document];
  for (let i = 0; i < frames.length; i++) {
    const parsed = frames[i];
    const next: (Document | Element)[] = [];
    for (const root of roots) {
      const elements = querySelectorAll(parsed, root);
      if (i === frames.length - 1) {
        next.push(...elements);
      } else {
        for (const el of elements) {
          if (el.nodeName !== "IFRAME" && el.nodeName !== "FRAME")
            throw new Error("Frame selector did not resolve to an iframe");
          const doc = (el as HTMLIFrameElement).contentDocument;
          if (!doc)
            throw new Error(
              "Cannot access iframe contentDocument (cross-origin or not loaded)",
            );
          next.push(doc);
        }
      }
    }
    roots = next;
  }
  return roots as Element[];
}

export function parse(selector: string): ParsedSelector {
  return parseSelector(selector);
}

export type WaitState = "attached" | "visible" | "hidden" | "enabled";

export function elementMatchesState(
  element: Element | undefined,
  state: WaitState,
): boolean {
  if (!element) return state === "hidden";
  switch (state) {
    case "attached":
      return true;
    case "visible":
      return isElementVisible(element);
    case "hidden":
      return !isElementVisible(element);
    case "enabled":
      return !getAriaDisabled(element);
  }
}
