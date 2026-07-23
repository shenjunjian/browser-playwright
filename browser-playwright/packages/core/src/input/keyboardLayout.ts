/** Minimal US keyboard layout for press/type (adapted from Playwright usKeyboardLayout). */

export type KeyDefinition = {
  key: string;
  keyCode: number;
  text?: string;
  location?: number;
  shiftKey?: string;
};

export type ResolvedKey = {
  code: string;
  key: string;
  keyCode: number;
  location: number;
  text?: string;
};

const USKeyboardLayout: Record<string, KeyDefinition> = {
  Escape: { keyCode: 27, key: "Escape" },
  Digit1: { keyCode: 49, key: "1", shiftKey: "!" },
  Digit2: { keyCode: 50, key: "2", shiftKey: "@" },
  Digit3: { keyCode: 51, key: "3", shiftKey: "#" },
  Digit4: { keyCode: 52, key: "4", shiftKey: "$" },
  Digit5: { keyCode: 53, key: "5", shiftKey: "%" },
  Digit6: { keyCode: 54, key: "6", shiftKey: "^" },
  Digit7: { keyCode: 55, key: "7", shiftKey: "&" },
  Digit8: { keyCode: 56, key: "8", shiftKey: "*" },
  Digit9: { keyCode: 57, key: "9", shiftKey: "(" },
  Digit0: { keyCode: 48, key: "0", shiftKey: ")" },
  Minus: { keyCode: 189, key: "-", shiftKey: "_" },
  Equal: { keyCode: 187, key: "=", shiftKey: "+" },
  Backspace: { keyCode: 8, key: "Backspace" },
  Tab: { keyCode: 9, key: "Tab" },
  KeyQ: { keyCode: 81, key: "q", shiftKey: "Q" },
  KeyW: { keyCode: 87, key: "w", shiftKey: "W" },
  KeyE: { keyCode: 69, key: "e", shiftKey: "E" },
  KeyR: { keyCode: 82, key: "r", shiftKey: "R" },
  KeyT: { keyCode: 84, key: "t", shiftKey: "T" },
  KeyY: { keyCode: 89, key: "y", shiftKey: "Y" },
  KeyU: { keyCode: 85, key: "u", shiftKey: "U" },
  KeyI: { keyCode: 73, key: "i", shiftKey: "I" },
  KeyO: { keyCode: 79, key: "o", shiftKey: "O" },
  KeyP: { keyCode: 80, key: "p", shiftKey: "P" },
  KeyA: { keyCode: 65, key: "a", shiftKey: "A" },
  KeyS: { keyCode: 83, key: "s", shiftKey: "S" },
  KeyD: { keyCode: 68, key: "d", shiftKey: "D" },
  KeyF: { keyCode: 70, key: "f", shiftKey: "F" },
  KeyG: { keyCode: 71, key: "g", shiftKey: "G" },
  KeyH: { keyCode: 72, key: "h", shiftKey: "H" },
  KeyJ: { keyCode: 74, key: "j", shiftKey: "J" },
  KeyK: { keyCode: 75, key: "k", shiftKey: "K" },
  KeyL: { keyCode: 76, key: "l", shiftKey: "L" },
  Enter: { keyCode: 13, key: "Enter", text: "\r" },
  ShiftLeft: { keyCode: 16, key: "Shift", location: 1 },
  Shift: { keyCode: 16, key: "Shift", location: 1 },
  KeyZ: { keyCode: 90, key: "z", shiftKey: "Z" },
  KeyX: { keyCode: 88, key: "x", shiftKey: "X" },
  KeyC: { keyCode: 67, key: "c", shiftKey: "C" },
  KeyV: { keyCode: 86, key: "v", shiftKey: "V" },
  KeyB: { keyCode: 66, key: "b", shiftKey: "B" },
  KeyN: { keyCode: 78, key: "n", shiftKey: "N" },
  KeyM: { keyCode: 77, key: "m", shiftKey: "M" },
  ControlLeft: { keyCode: 17, key: "Control", location: 1 },
  Control: { keyCode: 17, key: "Control", location: 1 },
  AltLeft: { keyCode: 18, key: "Alt", location: 1 },
  Alt: { keyCode: 18, key: "Alt", location: 1 },
  MetaLeft: { keyCode: 91, key: "Meta", location: 1 },
  Meta: { keyCode: 91, key: "Meta", location: 1 },
  Space: { keyCode: 32, key: " ", text: " " },
  Delete: { keyCode: 46, key: "Delete" },
  Home: { keyCode: 36, key: "Home" },
  End: { keyCode: 35, key: "End" },
  PageUp: { keyCode: 33, key: "PageUp" },
  PageDown: { keyCode: 34, key: "PageDown" },
  ArrowLeft: { keyCode: 37, key: "ArrowLeft" },
  ArrowUp: { keyCode: 38, key: "ArrowUp" },
  ArrowRight: { keyCode: 39, key: "ArrowRight" },
  ArrowDown: { keyCode: 40, key: "ArrowDown" },
};

const aliases: Record<string, string> = {
  "\n": "Enter",
  "\r": "Enter",
  " ": "Space",
  Control: "ControlLeft",
  Shift: "ShiftLeft",
  Alt: "AltLeft",
  Meta: "MetaLeft",
  Cmd: "MetaLeft",
  Command: "MetaLeft",
  Option: "AltLeft",
};

const byKey = new Map<string, ResolvedKey>();
const byCode = new Map<string, ResolvedKey>();

for (const [code, def] of Object.entries(USKeyboardLayout)) {
  const resolved: ResolvedKey = {
    code,
    key: def.key,
    keyCode: def.keyCode,
    location: def.location ?? 0,
    text: def.text ?? (def.key.length === 1 ? def.key : undefined),
  };
  byCode.set(code, resolved);
  byKey.set(def.key, resolved);
  if (def.shiftKey) byKey.set(def.shiftKey, { ...resolved, key: def.shiftKey, text: def.shiftKey });
}

for (const [from, to] of Object.entries(aliases)) {
  const target = byCode.get(to) ?? byKey.get(to);
  if (target) byKey.set(from, target);
}

/** Resolve a Playwright-style key name or single character. */
export function resolveKey(key: string, shift = false): ResolvedKey {
  const aliased = aliases[key] ?? key;
  const fromCode = byCode.get(aliased);
  if (fromCode) {
    if (shift && USKeyboardLayout[fromCode.code]?.shiftKey) {
      const sk = USKeyboardLayout[fromCode.code].shiftKey!;
      return { ...fromCode, key: sk, text: sk.length === 1 ? sk : fromCode.text };
    }
    return fromCode;
  }
  const fromKey = byKey.get(key) ?? byKey.get(aliased);
  if (fromKey) return fromKey;
  if (key.length === 1) {
    return {
      code: `Key${key.toUpperCase()}`,
      key,
      keyCode: key.toUpperCase().charCodeAt(0),
      location: 0,
      text: key,
    };
  }
  throw new Error(`Unknown key: "${key}"`);
}

export function splitChord(keyString: string): string[] {
  const keys: string[] = [];
  let building = "";
  for (const char of keyString) {
    if (char === "+" && building) {
      keys.push(building);
      building = "";
    } else {
      building += char;
    }
  }
  keys.push(building);
  return keys;
}
