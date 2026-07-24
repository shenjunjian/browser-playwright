import { escapeWithQuotes } from "../vendor/isomorphic/stringUtils";
import type { RecordedAction } from "./types";

function quote(text: string): string {
  return escapeWithQuotes(text, "'");
}

/** Emit a single action as an await statement (without leading indent). */
export function actionToStatement(action: RecordedAction): string {
  switch (action.kind) {
    case "click":
      return `await ${action.locator}.click()`;
    case "dblclick":
      return `await ${action.locator}.dblclick()`;
    case "fill":
      return `await ${action.locator}.fill(${quote(action.value)})`;
    case "selectOption":
      return `await ${action.locator}.selectOption(${quote(action.value)})`;
    case "check":
      return `await ${action.locator}.check()`;
    case "uncheck":
      return `await ${action.locator}.uncheck()`;
    case "press":
      return `await ${action.locator}.press(${quote(action.key)})`;
    case "expect":
      if (action.assertion === "toHaveText" && action.text != null) {
        return `await expect(${action.locator}).toHaveText(${quote(action.text)})`;
      }
      return `await expect(${action.locator}).toBeVisible()`;
  }
}

/**
 * Assemble a full `test(...)` script from recorded actions.
 */
export function generateScript(
  actions: RecordedAction[],
  testTitle = "recorded",
): string {
  const body = actions.map((a) => `  ${actionToStatement(a)}`).join("\n");
  const inner = body ? `\n${body}\n` : "\n";
  return [
    `import { test, expect } from 'browser-playwright'`,
    ``,
    `test(${quote(testTitle)}, async ({ page }) => {${inner}})`,
    ``,
  ].join("\n");
}
