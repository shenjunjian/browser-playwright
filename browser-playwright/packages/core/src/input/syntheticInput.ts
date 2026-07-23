/**
 * Synthetic pointer/mouse/keyboard input for in-page use.
 * Adapted from Playwright webViewInput; click also emits pointerdown/up
 * to match real browser sequences (plan requirement).
 */

type Modifiers = {
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
};

export type Point = { x: number; y: number };

const defaultModifiers = (): Modifiers => ({
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
});

function markAndDispatch(node: EventTarget, event: Event): boolean {
  return node.dispatchEvent(event);
}

function ownerWindow(document: Document): Window & typeof globalThis {
  return (document.defaultView ?? globalThis) as Window & typeof globalThis;
}

function ctor(win: Window & typeof globalThis, name: string): any {
  return (win as any)[name] ?? (globalThis as any)[name];
}

function centerOf(element: Element): Point {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function deepElementFromPoint(
  document: Document,
  x: number,
  y: number,
): Element | null {
  let el = document.elementFromPoint(x, y);
  while (el?.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

function deepActiveElement(document: Document): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement)
    active = active.shadowRoot.activeElement;
  return active;
}

export class SyntheticInput {
  private _document: Document;
  private _window: Window & typeof globalThis;
  private _hoverTarget: Element | null = null;
  private _modifiers: Modifiers = defaultModifiers();

  constructor(document: Document) {
    this._document = document;
    this._window = ownerWindow(document);
  }

  private _postTask(task: () => void): Promise<void> {
    return new Promise((resolve) => {
      this._window.setTimeout(() => {
        try {
          task();
        } finally {
          resolve();
        }
      }, 0);
    });
  }

  private _baseInit(point: Point, button = 0, buttons = 0, detail = 1) {
    return {
      bubbles: true,
      cancelable: true,
      view: this._window,
      clientX: point.x,
      clientY: point.y,
      screenX: point.x,
      screenY: point.y,
      button,
      buttons,
      detail,
      ...this._modifiers,
    } satisfies MouseEventInit;
  }

  private _pointerInit(point: Point, button = 0, buttons = 0, detail = 1) {
    return {
      ...this._baseInit(point, button, buttons, detail),
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    } satisfies PointerEventInit;
  }

  /** Move pointer to element center; fires over/enter/move (pointer + mouse). */
  async hover(element: Element): Promise<Point> {
    if ("scrollIntoView" in element)
      (element as HTMLElement).scrollIntoView({ block: "center", inline: "center" });
    const point = centerOf(element);
    await this.mouseMove(point);
    return point;
  }

  async mouseMove(point: Point): Promise<void> {
    const target =
      deepElementFromPoint(this._document, point.x, point.y) ||
      this._document.documentElement!;
    const base = this._baseInit(point);
    const pointer = this._pointerInit(point);
    const PointerEvent = ctor(this._window, "PointerEvent");
    const MouseEvent = ctor(this._window, "MouseEvent");
    const prev = this._hoverTarget;
    let last = Promise.resolve();
    if (prev !== target) {
      if (prev?.isConnected) {
        void this._postTask(() =>
          markAndDispatch(
            prev,
            new PointerEvent("pointerout", { ...pointer, relatedTarget: target }),
          ),
        );
        void this._postTask(() =>
          markAndDispatch(
            prev,
            new MouseEvent("mouseout", { ...base, relatedTarget: target }),
          ),
        );
        void this._postTask(() =>
          markAndDispatch(
            prev,
            new PointerEvent("pointerleave", {
              ...pointer,
              bubbles: false,
              cancelable: false,
              relatedTarget: target,
            }),
          ),
        );
        last = this._postTask(() =>
          markAndDispatch(
            prev,
            new MouseEvent("mouseleave", {
              ...base,
              bubbles: false,
              cancelable: false,
              relatedTarget: target,
            }),
          ),
        );
      }
      void this._postTask(() =>
        markAndDispatch(
          target,
          new PointerEvent("pointerover", { ...pointer, relatedTarget: prev }),
        ),
      );
      void this._postTask(() =>
        markAndDispatch(
          target,
          new MouseEvent("mouseover", { ...base, relatedTarget: prev }),
        ),
      );
      void this._postTask(() =>
        markAndDispatch(
          target,
          new PointerEvent("pointerenter", {
            ...pointer,
            bubbles: false,
            cancelable: false,
            relatedTarget: prev,
          }),
        ),
      );
      last = this._postTask(() =>
        markAndDispatch(
          target,
          new MouseEvent("mouseenter", {
            ...base,
            bubbles: false,
            cancelable: false,
            relatedTarget: prev,
          }),
        ),
      );
      this._hoverTarget = target;
    }
    void this._postTask(() =>
      markAndDispatch(target, new PointerEvent("pointermove", pointer)),
    );
    await this._postTask(() =>
      markAndDispatch(target, new MouseEvent("mousemove", base)),
    );
    await last;
  }

  /**
   * Full click sequence:
   * pointerdown → mousedown → pointerup → mouseup → click
   */
  /**
   * Full click sequence on the given element:
   * pointerdown → mousedown → pointerup → mouseup → click
   */
  async click(
    element: Element,
    options: { clickCount?: number; button?: "left" | "right" | "middle" } = {},
  ): Promise<void> {
    const clickCount = options.clickCount ?? 1;
    const button =
      options.button === "right" ? 2 : options.button === "middle" ? 1 : 0;
    const point = await this.hover(element);
    const MouseEvent = ctor(this._window, "MouseEvent");

    for (let i = 1; i <= clickCount; i++) {
      await this._dispatchPointerMouse(element, point, "down", button, i);
      await this._dispatchPointerMouse(element, point, "up", button, i);
      await this._postTask(() => {
        const type = button === 2 ? "contextmenu" : "click";
        markAndDispatch(
          element,
          new MouseEvent(type, this._baseInit(point, button, 0, i)),
        );
      });
    }
    if (clickCount === 2) {
      await this._postTask(() => {
        markAndDispatch(
          element,
          new MouseEvent("dblclick", this._baseInit(point, button, 0, 2)),
        );
      });
    }
  }

  private async _dispatchPointerMouse(
    element: Element,
    point: Point,
    phase: "down" | "up",
    button: number,
    detail: number,
  ): Promise<void> {
    const buttons = phase === "down" ? 1 << button : 0;
    const PointerEvent = ctor(this._window, "PointerEvent");
    const MouseEvent = ctor(this._window, "MouseEvent");
    await this._postTask(() => {
      const pointerType = phase === "down" ? "pointerdown" : "pointerup";
      const mouseType = phase === "down" ? "mousedown" : "mouseup";
      try {
        markAndDispatch(
          element,
          new PointerEvent(
            pointerType,
            this._pointerInit(point, button, buttons, detail),
          ),
        );
      } catch {
        /* PointerEvent unsupported in some test DOMs */
      }
      markAndDispatch(
        element,
        new MouseEvent(
          mouseType,
          this._baseInit(point, button, buttons, detail),
        ),
      );
    });
  }

  async keydown(resolved: {
    code: string;
    key: string;
    keyCode: number;
    location: number;
    text?: string;
  }): Promise<void> {
    const target = deepActiveElement(this._document) || this._document.body;
    if (!target) return;
    this._updateModifiers(resolved.key, true);
    const init: KeyboardEventInit = {
      bubbles: true,
      cancelable: true,
      view: this._window,
      code: resolved.code,
      key: resolved.key,
      keyCode: resolved.keyCode,
      which: resolved.keyCode,
      location: resolved.location,
      ...this._modifiers,
    };
    const KeyboardEvent = ctor(this._window, "KeyboardEvent");
    let notPrevented = true;
    await this._postTask(() => {
      notPrevented = markAndDispatch(target, new KeyboardEvent("keydown", init));
    });
    if (resolved.text !== undefined && notPrevented) {
      let charOk = true;
      await this._postTask(() => {
        const charCode = resolved.text!.charCodeAt(0);
        charOk = markAndDispatch(
          target,
          new KeyboardEvent("keypress", {
            ...init,
            charCode,
            keyCode: charCode,
            which: charCode,
          }),
        );
      });
      if (charOk) {
        await this._postTask(() => {
          this._insertText(target, resolved.text === "\r" ? "\n" : resolved.text!);
        });
      }
    }
  }

  async keyup(resolved: {
    code: string;
    key: string;
    keyCode: number;
    location: number;
  }): Promise<void> {
    const target = deepActiveElement(this._document) || this._document.body;
    if (!target) return;
    this._updateModifiers(resolved.key, false);
    const KeyboardEvent = ctor(this._window, "KeyboardEvent");
    await this._postTask(() => {
      markAndDispatch(
        target,
        new KeyboardEvent("keyup", {
          bubbles: true,
          cancelable: true,
          view: this._window,
          code: resolved.code,
          key: resolved.key,
          keyCode: resolved.keyCode,
          which: resolved.keyCode,
          location: resolved.location,
          ...this._modifiers,
        }),
      );
    });
  }

  async insertText(text: string): Promise<void> {
    await this._postTask(() => {
      this._insertText(deepActiveElement(this._document), text);
    });
  }

  private _updateModifiers(key: string, down: boolean) {
    if (key === "Control") this._modifiers.ctrlKey = down;
    if (key === "Shift") this._modifiers.shiftKey = down;
    if (key === "Alt") this._modifiers.altKey = down;
    if (key === "Meta") this._modifiers.metaKey = down;
  }

  private _insertText(target: Element | null, text: string) {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? target.value.length;
      target.value = target.value.slice(0, start) + text + target.value.slice(end);
      const pos = start + text.length;
      try {
        target.setSelectionRange(pos, pos);
      } catch {
        /* some inputs disallow selection */
      }
      target.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: false,
          data: text,
          inputType: "insertText",
        }),
      );
    } else if (target && (target as HTMLElement).isContentEditable) {
      target.ownerDocument.execCommand("insertText", false, text);
    }
  }
}

export function getInputFor(document: Document): SyntheticInput {
  return new SyntheticInput(document);
}
