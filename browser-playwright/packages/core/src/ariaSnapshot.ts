/**
 * Degraded ARIA snapshot (YAML-ish lines of `- role "name"`).
 * Not identical to Playwright's full aria tree / refs / boxes.
 */
import {
  getAriaRole,
  getElementAccessibleNameText,
  isElementHiddenForAria,
} from "./vendor/injected/roleUtils";
import { isElementVisible } from "./vendor/injected/domUtils";

function yamlEscape(value: string): string {
  if (/[:#"'\n\\]/.test(value) || value !== value.trim())
    return JSON.stringify(value);
  return value;
}

function walk(
  element: Element,
  lines: string[],
  depth: number,
  maxDepth: number,
): void {
  if (depth > maxDepth) return;
  if (isElementHiddenForAria(element) && !isElementVisible(element)) return;

  const role = getAriaRole(element);
  if (role && role !== "none" && role !== "presentation") {
    const name = getElementAccessibleNameText(element, false);
    const indent = "  ".repeat(depth);
    lines.push(
      name
        ? `${indent}- ${role} ${yamlEscape(name)}`
        : `${indent}- ${role}`,
    );
    depth += 1;
  }

  for (const child of element.children) walk(child, lines, depth, maxDepth);
}

export function buildAriaSnapshot(
  root: Element,
  options?: { depth?: number },
): string {
  const lines: string[] = [];
  const maxDepth = options?.depth ?? 20;
  const role = getAriaRole(root);
  if (role && role !== "none" && role !== "presentation") {
    const name = getElementAccessibleNameText(root, false);
    lines.push(name ? `- ${role} ${yamlEscape(name)}` : `- ${role}`);
    for (const child of root.children)
      walk(child, lines, 1, maxDepth);
  } else {
    for (const child of root.children)
      walk(child, lines, 0, maxDepth);
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}

function normalizeSnapshot(s: string): string {
  return s
    .split("\n")
    .map((l) => l.replace(/\s+$/g, ""))
    .filter((l) => l.trim().length > 0)
    .join("\n");
}

/** Loose containment match of expected YAML fragment against actual. */
export function matchAriaSnapshot(actual: string, expected: string): boolean {
  const a = normalizeSnapshot(actual);
  const e = normalizeSnapshot(expected);
  if (!e) return true;
  return a.includes(e) || normalizeWhiteSpaceLines(a) === normalizeWhiteSpaceLines(e);
}

function normalizeWhiteSpaceLines(s: string): string {
  return s
    .split("\n")
    .map((l) => l.trim().replace(/\s+/g, " "))
    .join("\n");
}
