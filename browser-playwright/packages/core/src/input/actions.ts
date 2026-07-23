import { normalizeWhiteSpace } from "../vendor/isomorphic/stringUtils";
import { getCheckedWithoutMixed } from "../vendor/injected/roleUtils";
import { resolveKey, splitChord } from "./keyboardLayout";
import { getInputFor } from "./syntheticInput";

function retarget(element: Element): Element {
  if (element.nodeName === "LABEL" || element.closest?.("label")) {
    const label =
      element.nodeName === "LABEL"
        ? (element as HTMLLabelElement)
        : (element.closest("label") as HTMLLabelElement | null);
    if (label) {
      if (label.control) return label.control;
      const nested = label.querySelector(
        "input, textarea, select, [contenteditable]",
      );
      if (nested) return nested;
    }
  }
  return element;
}

function focusElement(element: Element): void {
  const el = retarget(element) as HTMLElement;
  el.focus?.();
  el.focus?.();
}

function blurElement(element: Element): void {
  (retarget(element) as HTMLElement).blur?.();
}

function selectText(element: Element): void {
  const el = retarget(element);
  if (el instanceof HTMLInputElement) {
    el.select();
    el.focus();
    return;
  }
  if (el instanceof HTMLTextAreaElement) {
    el.selectionStart = 0;
    el.selectionEnd = el.value.length;
    el.focus();
    return;
  }
  (el as HTMLElement).focus();
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  const selection = el.ownerDocument.defaultView?.getSelection();
  if (selection) {
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

function fillElement(element: Element, value: string): "needsinput" | "done" {
  const el = retarget(element);
  if (el.nodeName.toLowerCase() === "input") {
    const input = el as HTMLInputElement;
    const type = input.type.toLowerCase();
    const setValueTypes = new Set([
      "color",
      "date",
      "time",
      "datetime-local",
      "month",
      "range",
      "week",
    ]);
    const typeInto = new Set([
      "",
      "email",
      "number",
      "password",
      "search",
      "tel",
      "text",
      "url",
    ]);
    if (!typeInto.has(type) && !setValueTypes.has(type))
      throw new Error(`Input of type "${type}" cannot be filled`);
    if (type === "number") {
      value = value.trim();
      if (Number.isNaN(Number(value)))
        throw new Error("Cannot type text into input[type=number]");
    }
    if (type === "color") value = value.toLowerCase();
    if (setValueTypes.has(type)) {
      value = value.trim();
      input.focus();
      input.value = value;
      if (input.value !== value) throw new Error("Malformed value");
      el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return "done";
    }
  } else if (el.nodeName.toLowerCase() === "textarea") {
    /* ok */
  } else if (!(el as HTMLElement).isContentEditable) {
    throw new Error(
      "Element is not an <input>, <textarea> or [contenteditable] element",
    );
  }
  selectText(el);
  return "needsinput";
}

export type SelectOption =
  | string
  | { value?: string; label?: string; index?: number }
  | Element;

export function selectOptions(
  element: Element,
  values: SelectOption | SelectOption[],
): string[] {
  const el = retarget(element);
  if (el.nodeName.toLowerCase() !== "select")
    throw new Error("Element is not a <select> element");
  const select = el as HTMLSelectElement;
  const optionsToSelect = Array.isArray(values) ? values : [values];
  const normalized = optionsToSelect.map((v) => {
    if (typeof v === "string") return { valueOrLabel: v };
    if (v instanceof Element) return v;
    return v;
  });
  const options = [...select.options];
  const selected: HTMLOptionElement[] = [];
  let remaining = normalized.slice();
  for (let index = 0; index < options.length; index++) {
    const option = options[index];
    const optionLabel = option.label || option.textContent || "";
    const normalizedLabel = normalizeWhiteSpace(optionLabel);
    const filter = (
      optionToSelect:
        | Element
        | { valueOrLabel?: string; value?: string; label?: string; index?: number },
    ) => {
      if (optionToSelect instanceof Element) return option === optionToSelect;
      const matchesLabel = (label: string) =>
        label === optionLabel ||
        normalizeWhiteSpace(label) === normalizedLabel;
      let matches = true;
      if (optionToSelect.valueOrLabel !== undefined)
        matches =
          matches &&
          (optionToSelect.valueOrLabel === option.value ||
            matchesLabel(optionToSelect.valueOrLabel));
      if (optionToSelect.value !== undefined)
        matches = matches && optionToSelect.value === option.value;
      if (optionToSelect.label !== undefined)
        matches = matches && matchesLabel(optionToSelect.label);
      if (optionToSelect.index !== undefined)
        matches = matches && optionToSelect.index === index;
      return matches;
    };
    if (!remaining.some(filter)) continue;
    selected.push(option);
    if (select.multiple) remaining = remaining.filter((o) => !filter(o));
    else {
      remaining = [];
      break;
    }
  }
  if (remaining.length) throw new Error("Did not find some options to select");
  select.value = undefined as unknown as string;
  selected.forEach((o) => (o.selected = true));
  select.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return selected.map((o) => o.value);
}

function isChecked(element: Element): boolean {
  const el = retarget(element);
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio"))
    return el.checked;
  const state = getCheckedWithoutMixed(el);
  if (state === "error") return false;
  return !!state;
}

export async function clickElement(
  document: Document,
  element: Element,
  options?: { clickCount?: number; button?: "left" | "right" | "middle" },
): Promise<void> {
  const input = getInputFor(document);
  await input.click(element, options);
}

export async function hoverElement(
  document: Document,
  element: Element,
): Promise<void> {
  await getInputFor(document).hover(element);
}

export async function dblclickElement(
  document: Document,
  element: Element,
): Promise<void> {
  await getInputFor(document).click(element, { clickCount: 2 });
}

export async function focusAction(element: Element): Promise<void> {
  focusElement(element);
}

export async function blurAction(element: Element): Promise<void> {
  blurElement(element);
}

export async function fillAction(
  document: Document,
  element: Element,
  value: string,
): Promise<void> {
  const result = fillElement(element, value);
  if (result === "done") return;
  const input = getInputFor(document);
  if (value === "") {
    await pressAction(document, element, "Control+A");
    await pressAction(document, element, "Backspace");
    return;
  }
  await input.insertText(value);
  const el = retarget(element);
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export async function typeAction(
  document: Document,
  element: Element,
  text: string,
  options?: { delay?: number },
): Promise<void> {
  focusElement(element);
  const input = getInputFor(document);
  for (const char of text) {
    try {
      const resolved = resolveKey(char);
      await input.keydown(resolved);
      await input.keyup(resolved);
    } catch {
      await input.insertText(char);
    }
    if (options?.delay)
      await new Promise((r) => setTimeout(r, options.delay));
  }
}

export async function pressAction(
  document: Document,
  element: Element,
  key: string,
  options?: { delay?: number },
): Promise<void> {
  focusElement(element);
  const input = getInputFor(document);
  const tokens = splitChord(key);
  const main = tokens[tokens.length - 1];
  const mods = tokens.slice(0, -1);
  for (const mod of mods) await input.keydown(resolveKey(mod));
  const resolved = resolveKey(main, mods.some((m) => /shift/i.test(m)));
  await input.keydown(resolved);
  if (options?.delay) await new Promise((r) => setTimeout(r, options.delay));
  await input.keyup(resolved);
  for (let i = mods.length - 1; i >= 0; i--)
    await input.keyup(resolveKey(mods[i]));
}

export async function checkAction(
  document: Document,
  element: Element,
  checked: boolean,
): Promise<void> {
  if (isChecked(element) === checked) return;
  await clickElement(document, element);
  if (isChecked(element) !== checked) {
    // Fallback for elements that don't toggle via click alone.
    const el = retarget(element);
    if (el instanceof HTMLInputElement) {
      el.checked = checked;
      el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
}

export { isChecked, retarget, focusElement };
