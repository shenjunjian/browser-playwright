import type { AttributeSelectorPart } from "../vendor/isomorphic/selectorParser";
import { normalizeWhiteSpace } from "../vendor/isomorphic/stringUtils";
import type { ElementText, TextMatcher } from "../vendor/injected/selectorUtils";

export function createAttributeMatcher(
  part: AttributeSelectorPart,
): (s: string) => boolean {
  const { value, caseSensitive } = part;
  if (value instanceof RegExp) return (s) => !!s.match(value);
  if (caseSensitive) return (s) => s === value;
  const lowerCaseValue = (value as string).toLowerCase();
  return (s) => s.toLowerCase().includes(lowerCaseValue);
}

function cssUnquote(s: string): string {
  s = s.substring(1, s.length - 1);
  if (!s.includes("\\")) return s;
  const r: string[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === "\\" && i + 1 < s.length) i++;
    r.push(s[i++]);
  }
  return r.join("");
}

/** Adapted from playwright injectedScript.createTextMatcher */
export function createTextMatcher(
  selector: string,
  internal: boolean,
): { matcher: TextMatcher; kind: "regex" | "strict" | "lax" } {
  if (selector[0] === "/" && selector.lastIndexOf("/") > 0) {
    const lastSlash = selector.lastIndexOf("/");
    const re = new RegExp(
      selector.substring(1, lastSlash),
      selector.substring(lastSlash + 1),
    );
    return {
      matcher: (elementText: ElementText) => re.test(elementText.full),
      kind: "regex",
    };
  }
  const unquote = internal ? JSON.parse.bind(JSON) : cssUnquote;
  let strict = false;
  let text = selector;
  if (
    text.length > 1 &&
    text[0] === '"' &&
    text[text.length - 1] === '"'
  ) {
    text = unquote(text);
    strict = true;
  } else if (
    internal &&
    text.length > 1 &&
    text[0] === '"' &&
    text[text.length - 2] === '"' &&
    text[text.length - 1] === "i"
  ) {
    text = unquote(text.substring(0, text.length - 1));
    strict = false;
  } else if (
    internal &&
    text.length > 1 &&
    text[0] === '"' &&
    text[text.length - 2] === '"' &&
    text[text.length - 1] === "s"
  ) {
    text = unquote(text.substring(0, text.length - 1));
    strict = true;
  } else if (
    text.length > 1 &&
    text[0] === "'" &&
    text[text.length - 1] === "'"
  ) {
    text = unquote(text);
    strict = true;
  }
  text = normalizeWhiteSpace(text);
  if (strict) {
    if (internal)
      return {
        kind: "strict",
        matcher: (elementText: ElementText) => elementText.normalized === text,
      };
    return {
      kind: "strict",
      matcher: (elementText: ElementText) => {
        if (!text && !elementText.immediate.length) return true;
        return elementText.immediate.some(
          (s) => normalizeWhiteSpace(s) === text,
        );
      },
    };
  }
  const lower = text.toLowerCase();
  return {
    kind: "lax",
    matcher: (elementText: ElementText) =>
      elementText.normalized.toLowerCase().includes(lower),
  };
}
