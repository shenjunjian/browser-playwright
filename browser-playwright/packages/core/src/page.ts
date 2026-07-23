import {
  getByAltTextSelector,
  getByLabelSelector,
  getByPlaceholderSelector,
  getByRoleSelector,
  getByTestIdSelector,
  getByTextSelector,
  getByTitleSelector,
  type ByRoleOptions,
} from "./vendor/isomorphic/locatorUtils";
import {
  FrameLocator,
  Locator,
  getTestIdAttribute,
  type ExactOptions,
  type FrameContext,
  type LocatorOptions,
} from "./locator";
import {
  PageEventEmitter,
  type ConsoleMessage,
  type PageEvent,
  type PageEventMap,
} from "./pageEvents";
import {
  NetworkManager,
  type RouteHandlerCallback,
  type URLMatch,
} from "./network/route";
import {
  screenshotPage,
  type ScreenshotOptions,
} from "./screenshot";
import { DEFAULT_TIMEOUT } from "./wait";

export type PageOptions = {
  /** Defaults to `window.document`. */
  document?: Document;
  /** Default action / wait timeout in ms. */
  timeout?: number;
};

type InitScript = { source: string } | { fn: Function; arg?: unknown };

/**
 * Page bound to the current browsing context (no Browser / CDP).
 * Query APIs mirror Playwright's Page locator surface.
 */
export class Page {
  readonly _context: FrameContext;
  private _events: PageEventEmitter;
  private _initScripts: InitScript[] = [];
  private _network: NetworkManager;

  constructor(options: PageOptions = {}) {
    this._context = {
      document: options.document ?? globalThis.document,
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
    };
    this._context.page = this;
    const win =
      (this._context.document.defaultView as Window & typeof globalThis) ??
      (globalThis as Window & typeof globalThis);
    this._events = new PageEventEmitter(win);
    this._network = new NetworkManager(win);
  }

  /** Underlying document this page is bound to. */
  document(): Document {
    return this._context.document;
  }

  setDefaultTimeout(timeout: number): void {
    this._context.timeout = timeout;
  }

  locator(selector: string, options?: LocatorOptions): Locator {
    return new Locator(this._context, selector, options);
  }

  getByTestId(testId: string | RegExp): Locator {
    return this.locator(getByTestIdSelector(getTestIdAttribute(), testId));
  }

  getByAltText(text: string | RegExp, options?: ExactOptions): Locator {
    return this.locator(getByAltTextSelector(text, options));
  }

  getByLabel(text: string | RegExp, options?: ExactOptions): Locator {
    return this.locator(getByLabelSelector(text, options));
  }

  getByPlaceholder(text: string | RegExp, options?: ExactOptions): Locator {
    return this.locator(getByPlaceholderSelector(text, options));
  }

  getByText(text: string | RegExp, options?: ExactOptions): Locator {
    return this.locator(getByTextSelector(text, options));
  }

  getByTitle(text: string | RegExp, options?: ExactOptions): Locator {
    return this.locator(getByTitleSelector(text, options));
  }

  getByRole(role: string, options: ByRoleOptions = {}): Locator {
    return this.locator(getByRoleSelector(role, options));
  }

  frameLocator(selector: string): FrameLocator {
    return new FrameLocator(this._context, selector);
  }

  on<K extends PageEvent>(
    event: K,
    handler: (...args: PageEventMap[K]) => void,
  ): this {
    this._events.on(event, handler);
    return this;
  }

  once<K extends PageEvent>(
    event: K,
    handler: (...args: PageEventMap[K]) => void,
  ): this {
    this._events.once(event, handler);
    return this;
  }

  off<K extends PageEvent>(
    event: K,
    handler: (...args: PageEventMap[K]) => void,
  ): this {
    this._events.off(event, handler);
    return this;
  }

  /**
   * In-page evaluate: run a function in the current document context.
   * Unlike CDP, this is same-realm — no serialization needed for DOM nodes.
   */
  async evaluate<R, Arg = unknown>(
    pageFunction: ((arg: Arg) => R | Promise<R>) | string,
    arg?: Arg,
  ): Promise<R> {
    if (typeof pageFunction === "string") {
      const fn = new Function(`return (${pageFunction})`)();
      return await fn(arg);
    }
    return await pageFunction(arg as Arg);
  }

  /**
   * Register init scripts. In-page: run immediately, and again on
   * hashchange / popstate (SPA-friendly; not a full navigation hook).
   */
  async addInitScript(
    script: Function | string | { path?: string; content?: string },
    arg?: unknown,
  ): Promise<void> {
    let entry: InitScript;
    if (typeof script === "function") entry = { fn: script, arg };
    else if (typeof script === "string") entry = { source: script };
    else if (script.content) entry = { source: script.content };
    else
      throw new Error(
        "addInitScript({ path }) is not supported in-page; pass content or a function",
      );

    this._initScripts.push(entry);
    await this._runInitScript(entry);

    if (this._initScripts.length === 1) {
      const win =
        this._context.document.defaultView ??
        (globalThis as Window & typeof globalThis);
      const rerun = () => {
        for (const s of this._initScripts) void this._runInitScript(s);
      };
      win.addEventListener?.("hashchange", rerun);
      win.addEventListener?.("popstate", rerun);
    }
  }

  private async _runInitScript(script: InitScript): Promise<void> {
    if ("source" in script) {
      const fn = new Function(script.source);
      await fn();
    } else {
      await script.fn(script.arg);
    }
  }

  /**
   * In-page navigation: hash / same-origin path assignment.
   * Not a cross-process browser navigation.
   * Accepts forms like `modal#modal-event` (sets hash) or `/path` (pushState).
   */
  async goto(
    url: string,
    _options?: { timeout?: number; waitUntil?: string },
  ): Promise<null> {
    const win =
      this._context.document.defaultView ??
      (globalThis as Window & typeof globalThis);

    const hashIdx = url.indexOf("#");
    if (hashIdx !== -1 && !url.includes("://")) {
      const path = url.slice(0, hashIdx);
      const hash = url.slice(hashIdx + 1);
      if (path) {
        try {
          win.history.pushState({}, "", path + (hash ? `#${hash}` : ""));
        } catch {
          /* happy-dom / restricted */
        }
      }
      try {
        win.location.hash = hash;
      } catch {
        /* ignore */
      }
      try {
        const PopStateEventCtor =
          (win as any).PopStateEvent ?? (globalThis as any).PopStateEvent;
        const HashChangeEventCtor =
          (win as any).HashChangeEvent ?? (globalThis as any).HashChangeEvent;
        if (PopStateEventCtor)
          win.dispatchEvent?.(new PopStateEventCtor("popstate"));
        else win.dispatchEvent?.(new Event("popstate"));
        if (HashChangeEventCtor)
          win.dispatchEvent?.(new HashChangeEventCtor("hashchange"));
        else win.dispatchEvent?.(new Event("hashchange"));
      } catch {
        /* ignore */
      }
      return null;
    }

    if (url.startsWith("#")) {
      win.location.hash = url.slice(1);
      return null;
    }

    if (url.startsWith("/") || !url.includes("://")) {
      try {
        win.history.pushState({}, "", url);
        const PopStateEventCtor =
          (win as any).PopStateEvent ?? (globalThis as any).PopStateEvent;
        if (PopStateEventCtor)
          win.dispatchEvent(new PopStateEventCtor("popstate"));
        else win.dispatchEvent(new Event("popstate"));
      } catch {
        try {
          win.location.assign(url);
        } catch {
          /* ignore in test DOM */
        }
      }
      return null;
    }

    win.location.assign(url);
    return null;
  }

  async click(
    selector: string,
    options?: Parameters<Locator["click"]>[0],
  ): Promise<void> {
    await this.locator(selector).click(options);
  }

  async fill(
    selector: string,
    value: string,
    options?: Parameters<Locator["fill"]>[1],
  ): Promise<void> {
    await this.locator(selector).fill(value, options);
  }

  async hover(
    selector: string,
    options?: Parameters<Locator["hover"]>[0],
  ): Promise<void> {
    await this.locator(selector).hover(options);
  }

  async press(
    selector: string,
    key: string,
    options?: Parameters<Locator["press"]>[1],
  ): Promise<void> {
    await this.locator(selector).press(key, options);
  }

  /**
   * Intercept fetch/XHR matching `url`.
   * Does not cover navigation, subresource tags, or Service Worker requests.
   */
  async route(
    url: URLMatch,
    handler: RouteHandlerCallback,
    options?: { times?: number },
  ): Promise<void> {
    await this._network.route(url, handler, options);
  }

  async unroute(
    url: URLMatch,
    handler?: RouteHandlerCallback,
  ): Promise<void> {
    await this._network.unroute(url, handler);
  }

  async unrouteAll(): Promise<void> {
    await this._network.unrouteAll();
  }

  /**
   * Viewport screenshot via DOM→canvas (not CDP-identical).
   * Returns `Uint8Array` (PNG/JPEG or fingerprint fallback).
   */
  async screenshot(options?: ScreenshotOptions): Promise<Uint8Array> {
    return screenshotPage(this._context.document, options);
  }
}

/** Create a Page bound to the current window document. */
export function createPage(options?: PageOptions): Page {
  return new Page(options);
}

export type { ConsoleMessage };
