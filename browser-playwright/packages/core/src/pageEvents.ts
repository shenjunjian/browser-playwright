export type PageEventMap = {
  console: [message: ConsoleMessage];
  pageerror: [error: Error];
};

export type PageEvent = keyof PageEventMap;

export type ConsoleMessage = {
  type: string;
  text: string;
  args: unknown[];
};

type Handler<K extends PageEvent> = (...args: PageEventMap[K]) => void;

/**
 * In-page hooks for page.on('console' | 'pageerror').
 * console.* wrapping and window error/unhandledrejection listeners.
 */
export class PageEventEmitter {
  private _handlers = new Map<PageEvent, Set<Function>>();
  private _installed = false;
  private _origConsole: Partial<Record<string, (...args: unknown[]) => void>> =
    {};
  private _onError?: (ev: ErrorEvent) => void;
  private _onRejection?: (ev: PromiseRejectionEvent) => void;
  private _window: Window & typeof globalThis;
  private _consoleMessages: ConsoleMessage[] = [];
  private _pageErrors: Error[] = [];

  constructor(win: Window & typeof globalThis = globalThis as any) {
    this._window = win;
  }

  consoleMessages(): ConsoleMessage[] {
    this._ensureInstalled();
    return this._consoleMessages.slice();
  }

  pageErrors(): Error[] {
    this._ensureInstalled();
    return this._pageErrors.slice();
  }

  clearConsoleMessages(): void {
    this._consoleMessages.length = 0;
  }

  clearPageErrors(): void {
    this._pageErrors.length = 0;
  }

  on<K extends PageEvent>(event: K, handler: Handler<K>): void {
    this._ensureInstalled();
    let set = this._handlers.get(event);
    if (!set) {
      set = new Set();
      this._handlers.set(event, set);
    }
    set.add(handler as Function);
  }

  once<K extends PageEvent>(event: K, handler: Handler<K>): void {
    const wrap = ((...args: PageEventMap[K]) => {
      this.off(event, wrap as Handler<K>);
      handler(...args);
    }) as Handler<K>;
    this.on(event, wrap);
  }

  off<K extends PageEvent>(event: K, handler: Handler<K>): void {
    this._handlers.get(event)?.delete(handler as Function);
  }

  removeAllListeners(event?: PageEvent): void {
    if (event) this._handlers.delete(event);
    else this._handlers.clear();
  }

  private _emit<K extends PageEvent>(event: K, ...args: PageEventMap[K]): void {
    const set = this._handlers.get(event);
    if (!set) return;
    for (const h of [...set]) {
      try {
        (h as Handler<K>)(...args);
      } catch {
        /* listener errors should not break the page */
      }
    }
  }

  private _ensureInstalled(): void {
    if (this._installed) return;
    this._installed = true;
    const levels = ["log", "info", "warn", "error", "debug"] as const;
    for (const level of levels) {
      const orig = this._window.console[level]?.bind(this._window.console);
      this._origConsole[level] = orig;
      this._window.console[level] = (...args: unknown[]) => {
        const msg: ConsoleMessage = {
          type: level,
          text: args.map(String).join(" "),
          args,
        };
        this._consoleMessages.push(msg);
        this._emit("console", msg);
        orig?.(...args);
      };
    }
    this._onError = (ev: ErrorEvent) => {
      const err =
        ev.error instanceof Error
          ? ev.error
          : new Error(ev.message || "Script error");
      this._pageErrors.push(err);
      this._emit("pageerror", err);
    };
    this._onRejection = (ev: PromiseRejectionEvent) => {
      const err =
        ev.reason instanceof Error
          ? ev.reason
          : new Error(String(ev.reason ?? "Unhandled rejection"));
      this._pageErrors.push(err);
      this._emit("pageerror", err);
    };
    this._window.addEventListener("error", this._onError);
    this._window.addEventListener("unhandledrejection", this._onRejection);
  }

  dispose(): void {
    if (!this._installed) return;
    for (const [level, orig] of Object.entries(this._origConsole)) {
      if (orig) (this._window.console as any)[level] = orig;
    }
    if (this._onError) this._window.removeEventListener("error", this._onError);
    if (this._onRejection)
      this._window.removeEventListener("unhandledrejection", this._onRejection);
    this._handlers.clear();
    this._installed = false;
  }
}
