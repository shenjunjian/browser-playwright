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
import { buildAriaSnapshot } from "./ariaSnapshot";
import { notSupported } from "./unsupported";
import { DEFAULT_TIMEOUT, pollUntil, resolveTimeout } from "./wait";

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
  private _closed = false;
  private _viewport: { width: number; height: number } | null = null;

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

  setDefaultNavigationTimeout(timeout: number): void {
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

  addListener<K extends PageEvent>(
    event: K,
    handler: (...args: PageEventMap[K]) => void,
  ): this {
    return this.on(event, handler);
  }

  removeListener<K extends PageEvent>(
    event: K,
    handler: (...args: PageEventMap[K]) => void,
  ): this {
    return this.off(event, handler);
  }

  prependListener<K extends PageEvent>(
    event: K,
    handler: (...args: PageEventMap[K]) => void,
  ): this {
    return this.on(event, handler);
  }

  removeAllListeners(event?: PageEvent): this {
    this._events.removeAllListeners(event);
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

  /** Same-realm: returns raw result (no JSHandle). */
  async evaluateHandle<R, Arg = unknown>(
    pageFunction: ((arg: Arg) => R | Promise<R>) | string,
    arg?: Arg,
  ): Promise<R> {
    return this.evaluate(pageFunction, arg);
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

  async exposeFunction(name: string, fn: Function): Promise<void> {
    const win =
      this._context.document.defaultView ??
      (globalThis as Window & typeof globalThis);
    (win as any)[name] = (...args: unknown[]) => fn(...args);
  }

  /**
   * In-page navigation: hash / same-origin path assignment.
   * Not a cross-process browser navigation.
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

  async goBack(_options?: { timeout?: number }): Promise<null> {
    const win =
      this._context.document.defaultView ??
      (globalThis as Window & typeof globalThis);
    win.history.back();
    return null;
  }

  async goForward(_options?: { timeout?: number }): Promise<null> {
    const win =
      this._context.document.defaultView ??
      (globalThis as Window & typeof globalThis);
    win.history.forward();
    return null;
  }

  async reload(_options?: { timeout?: number }): Promise<null> {
    const win =
      this._context.document.defaultView ??
      (globalThis as Window & typeof globalThis);
    win.location.reload();
    return null;
  }

  async setContent(
    html: string,
    _options?: { timeout?: number; waitUntil?: string },
  ): Promise<void> {
    this._context.document.open();
    this._context.document.write(html);
    this._context.document.close();
  }

  async content(): Promise<string> {
    const doctype = this._context.document.doctype;
    const dt = doctype ? `<!DOCTYPE ${doctype.name}>` : "<!DOCTYPE html>";
    return dt + "\n" + this._context.document.documentElement.outerHTML;
  }

  url(): string {
    const win =
      this._context.document.defaultView ??
      (globalThis as Window & typeof globalThis);
    try {
      return win.location.href;
    } catch {
      return "";
    }
  }

  async title(): Promise<string> {
    return this._context.document.title;
  }

  viewportSize(): { width: number; height: number } | null {
    if (this._viewport) return { ...this._viewport };
    const win =
      this._context.document.defaultView ??
      (globalThis as Window & typeof globalThis);
    return {
      width: win.innerWidth ?? 0,
      height: win.innerHeight ?? 0,
    };
  }

  async setViewportSize(size: {
    width: number;
    height: number;
  }): Promise<void> {
    this._viewport = { ...size };
    const win =
      this._context.document.defaultView ??
      (globalThis as Window & typeof globalThis);
    try {
      Object.defineProperty(win, "innerWidth", {
        value: size.width,
        configurable: true,
      });
      Object.defineProperty(win, "innerHeight", {
        value: size.height,
        configurable: true,
      });
    } catch {
      /* ignore */
    }
  }

  isClosed(): boolean {
    return this._closed;
  }

  async waitForTimeout(timeout: number): Promise<void> {
    await new Promise((r) => setTimeout(r, timeout));
  }

  async waitForFunction<R, Arg = unknown>(
    pageFunction: ((arg: Arg) => R | Promise<R>) | string,
    arg?: Arg,
    options?: { timeout?: number; polling?: number },
  ): Promise<R> {
    const timeout = resolveTimeout(options, this._context.timeout);
    const interval = options?.polling ?? 100;
    const deadline = timeout > 0 ? Date.now() + timeout : 0;
    for (;;) {
      const value =
        typeof pageFunction === "string"
          ? await new Function(`return (${pageFunction})`)()(arg)
          : await pageFunction(arg as Arg);
      if (value) return value as R;
      if (deadline && Date.now() >= deadline)
        throw new Error(
          `Timeout ${timeout}ms exceeded waiting for page.waitForFunction`,
        );
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  async waitForSelector(
    selector: string,
    options?: Parameters<Locator["waitFor"]>[0],
  ): Promise<Element | null> {
    const state = options?.state ?? "visible";
    if (state === "hidden") {
      await this.locator(selector).waitFor(options);
      return null;
    }
    await this.locator(selector).waitFor(options);
    return this.locator(selector).elementHandle(options);
  }

  async waitForLoadState(
    state: "load" | "domcontentloaded" | "networkidle" = "load",
    options?: { timeout?: number },
  ): Promise<void> {
    const doc = this._context.document;
    const timeout = resolveTimeout(options, this._context.timeout);
    if (state === "networkidle") {
      await this.waitForTimeout(Math.min(500, timeout));
      return;
    }
    if (
      (state === "domcontentloaded" &&
        (doc.readyState === "interactive" || doc.readyState === "complete")) ||
      (state === "load" && doc.readyState === "complete")
    )
      return;
    await pollUntil(
      () => {
        if (state === "domcontentloaded")
          return doc.readyState === "interactive" ||
            doc.readyState === "complete"
            ? true
            : undefined;
        return doc.readyState === "complete" ? true : undefined;
      },
      {
        timeout,
        message: `Timeout ${timeout}ms waiting for load state "${state}"`,
      },
    );
  }

  async waitForURL(
    url: string | RegExp | ((url: URL) => boolean),
    options?: { timeout?: number },
  ): Promise<void> {
    const timeout = resolveTimeout(options, this._context.timeout);
    await pollUntil(
      () => {
        const href = this.url();
        let ok = false;
        if (typeof url === "string") ok = href.includes(url) || href === url;
        else if (url instanceof RegExp) ok = url.test(href);
        else {
          try {
            ok = url(new URL(href, "http://localhost"));
          } catch {
            ok = false;
          }
        }
        return ok ? true : undefined;
      },
      {
        timeout,
        message: `Timeout ${timeout}ms waiting for URL`,
      },
    );
  }

  async waitForEvent<K extends PageEvent>(
    event: K,
    options?: {
      timeout?: number;
      predicate?: (...args: PageEventMap[K]) => boolean;
    },
  ): Promise<PageEventMap[K][0]> {
    const timeout = resolveTimeout(options, this._context.timeout);
    return new Promise((resolve, reject) => {
      const timer =
        timeout > 0
          ? setTimeout(() => {
              this.off(event, handler);
              reject(
                new Error(`Timeout ${timeout}ms waiting for event "${event}"`),
              );
            }, timeout)
          : undefined;
      const handler = ((...args: PageEventMap[K]) => {
        if (options?.predicate && !options.predicate(...args)) return;
        if (timer) clearTimeout(timer);
        this.off(event, handler);
        resolve(args[0]);
      }) as (...args: PageEventMap[K]) => void;
      this.on(event, handler);
    });
  }

  async addScriptTag(options: {
    url?: string;
    path?: string;
    content?: string;
    type?: string;
  }): Promise<HTMLScriptElement> {
    if (options.path)
      throw new Error("addScriptTag({ path }) is not supported in-page");
    const doc = this._context.document;
    const script = doc.createElement("script");
    if (options.type) script.type = options.type;
    if (options.url) {
      script.src = options.url;
      doc.head.appendChild(script);
      await new Promise<void>((resolve, reject) => {
        script.onload = () => resolve();
        script.onerror = () =>
          reject(new Error(`Failed to load ${options.url}`));
      });
    } else {
      script.textContent = options.content ?? "";
      doc.head.appendChild(script);
    }
    return script;
  }

  async addStyleTag(options: {
    url?: string;
    path?: string;
    content?: string;
  }): Promise<HTMLStyleElement | HTMLLinkElement> {
    if (options.path)
      throw new Error("addStyleTag({ path }) is not supported in-page");
    const doc = this._context.document;
    if (options.url) {
      const link = doc.createElement("link");
      link.rel = "stylesheet";
      link.href = options.url;
      doc.head.appendChild(link);
      await new Promise<void>((resolve, reject) => {
        link.onload = () => resolve();
        link.onerror = () => reject(new Error(`Failed to load ${options.url}`));
      });
      return link;
    }
    const style = doc.createElement("style");
    style.textContent = options.content ?? "";
    doc.head.appendChild(style);
    return style;
  }

  async emulateMedia(options: {
    media?: "screen" | "print" | null;
    colorScheme?: "light" | "dark" | "no-preference" | null;
    reducedMotion?: "reduce" | "no-preference" | null;
    forcedColors?: "active" | "none" | null;
  }): Promise<void> {
    const doc = this._context.document;
    if (options.media === "print")
      doc.documentElement.setAttribute("data-bp-media", "print");
    else if (options.media === "screen" || options.media === null)
      doc.documentElement.removeAttribute("data-bp-media");
    if (options.colorScheme)
      doc.documentElement.setAttribute(
        "data-bp-color-scheme",
        options.colorScheme,
      );
  }

  async ariaSnapshot(_options?: { timeout?: number }): Promise<string> {
    const root =
      this._context.document.body ?? this._context.document.documentElement;
    return buildAriaSnapshot(root);
  }

  frame(
    selectorOrName: string | { name?: string; url?: string | RegExp },
  ): Locator | null {
    if (typeof selectorOrName === "string") {
      const byName = this._context.document.querySelector(
        `iframe[name="${CSS.escape(selectorOrName)}"]`,
      );
      if (byName) return this.locator(`iframe[name="${selectorOrName}"]`);
      return this.locator(selectorOrName);
    }
    if (selectorOrName.name)
      return this.locator(`iframe[name="${selectorOrName.name}"]`);
    return this.locator("iframe");
  }

  frames(): Element[] {
    return [...this._context.document.querySelectorAll("iframe")];
  }

  mainFrame(): Page {
    return this;
  }

  consoleMessages(): ConsoleMessage[] {
    return this._events.consoleMessages();
  }

  pageErrors(): Error[] {
    return this._events.pageErrors();
  }

  async clearConsoleMessages(): Promise<void> {
    this._events.clearConsoleMessages();
  }

  async clearPageErrors(): Promise<void> {
    this._events.clearPageErrors();
  }

  async hideHighlight(): Promise<void> {
    const doc = this._context.document;
    for (const node of doc.querySelectorAll("x-bp-highlight")) node.remove();
  }

  // —— selector shortcuts ——

  async click(
    selector: string,
    options?: Parameters<Locator["click"]>[0],
  ): Promise<void> {
    await this.locator(selector).click(options);
  }

  async dblclick(
    selector: string,
    options?: Parameters<Locator["dblclick"]>[0],
  ): Promise<void> {
    await this.locator(selector).dblclick(options);
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

  async check(
    selector: string,
    options?: Parameters<Locator["check"]>[0],
  ): Promise<void> {
    await this.locator(selector).check(options);
  }

  async uncheck(
    selector: string,
    options?: Parameters<Locator["uncheck"]>[0],
  ): Promise<void> {
    await this.locator(selector).uncheck(options);
  }

  async setChecked(
    selector: string,
    checked: boolean,
    options?: Parameters<Locator["setChecked"]>[1],
  ): Promise<void> {
    await this.locator(selector).setChecked(checked, options);
  }

  async focus(
    selector: string,
    options?: Parameters<Locator["focus"]>[0],
  ): Promise<void> {
    await this.locator(selector).focus(options);
  }

  async tap(
    selector: string,
    options?: Parameters<Locator["tap"]>[0],
  ): Promise<void> {
    await this.locator(selector).tap(options);
  }

  async dispatchEvent(
    selector: string,
    type: string,
    eventInit?: EventInit,
    options?: Parameters<Locator["dispatchEvent"]>[2],
  ): Promise<void> {
    await this.locator(selector).dispatchEvent(type, eventInit, options);
  }

  async selectOption(
    selector: string,
    values: Parameters<Locator["selectOption"]>[0],
    options?: Parameters<Locator["selectOption"]>[1],
  ): Promise<string[]> {
    return this.locator(selector).selectOption(values, options);
  }

  async setInputFiles(
    selector: string,
    files: Parameters<Locator["setInputFiles"]>[0],
    options?: Parameters<Locator["setInputFiles"]>[1],
  ): Promise<void> {
    await this.locator(selector).setInputFiles(files, options);
  }

  async dragAndDrop(
    source: string,
    target: string,
    options?: Parameters<Locator["dragTo"]>[1],
  ): Promise<void> {
    await this.locator(source).dragTo(this.locator(target), options);
  }

  async getAttribute(
    selector: string,
    name: string,
    options?: Parameters<Locator["getAttribute"]>[1],
  ): Promise<string | null> {
    return this.locator(selector).getAttribute(name, options);
  }

  async innerHTML(
    selector: string,
    options?: Parameters<Locator["innerHTML"]>[0],
  ): Promise<string> {
    return this.locator(selector).innerHTML(options);
  }

  async innerText(
    selector: string,
    options?: Parameters<Locator["innerText"]>[0],
  ): Promise<string> {
    return this.locator(selector).innerText(options);
  }

  async textContent(
    selector: string,
    options?: Parameters<Locator["textContent"]>[0],
  ): Promise<string | null> {
    return this.locator(selector).textContent(options);
  }

  async inputValue(
    selector: string,
    options?: Parameters<Locator["inputValue"]>[0],
  ): Promise<string> {
    return this.locator(selector).inputValue(options);
  }

  async isChecked(
    selector: string,
    options?: Parameters<Locator["isChecked"]>[0],
  ): Promise<boolean> {
    return this.locator(selector).isChecked(options);
  }

  async isDisabled(
    selector: string,
    options?: Parameters<Locator["isDisabled"]>[0],
  ): Promise<boolean> {
    return this.locator(selector).isDisabled(options);
  }

  async isEditable(
    selector: string,
    options?: Parameters<Locator["isEditable"]>[0],
  ): Promise<boolean> {
    return this.locator(selector).isEditable(options);
  }

  async isEnabled(
    selector: string,
    options?: Parameters<Locator["isEnabled"]>[0],
  ): Promise<boolean> {
    return this.locator(selector).isEnabled(options);
  }

  async isHidden(
    selector: string,
    options?: Parameters<Locator["isHidden"]>[0],
  ): Promise<boolean> {
    return this.locator(selector).isHidden(options);
  }

  async isVisible(
    selector: string,
    options?: Parameters<Locator["isVisible"]>[0],
  ): Promise<boolean> {
    return this.locator(selector).isVisible(options);
  }

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

  async screenshot(options?: ScreenshotOptions): Promise<Uint8Array> {
    return screenshotPage(this._context.document, options);
  }

  // —— not supported (Browser / CDP) ——

  $(..._args: unknown[]): never {
    return notSupported("page.$");
  }
  $$(..._args: unknown[]): never {
    return notSupported("page.$$");
  }
  $eval(..._args: unknown[]): never {
    return notSupported("page.$eval");
  }
  $$eval(..._args: unknown[]): never {
    return notSupported("page.$$eval");
  }
  context(): never {
    return notSupported("page.context");
  }
  async close(): Promise<void> {
    this._closed = true;
    this._events.dispose();
  }
  opener(): never {
    return notSupported("page.opener");
  }
  async bringToFront(): Promise<void> {
    notSupported("page.bringToFront");
  }
  async pdf(): Promise<never> {
    return notSupported("page.pdf");
  }
  video(): never {
    return notSupported("page.video");
  }
  workers(): never {
    return notSupported("page.workers");
  }
  async pause(): Promise<never> {
    return notSupported("page.pause");
  }
  async pickLocator(): Promise<never> {
    return notSupported("page.pickLocator");
  }
  async cancelPickLocator(): Promise<never> {
    return notSupported("page.cancelPickLocator");
  }
  async requestGC(): Promise<never> {
    return notSupported("page.requestGC");
  }
  requests(): never {
    return notSupported("page.requests");
  }
  async routeFromHAR(): Promise<never> {
    return notSupported("page.routeFromHAR");
  }
  async routeWebSocket(): Promise<never> {
    return notSupported("page.routeWebSocket");
  }
  async setExtraHTTPHeaders(): Promise<never> {
    return notSupported("page.setExtraHTTPHeaders");
  }
  async addLocatorHandler(): Promise<never> {
    return notSupported("page.addLocatorHandler");
  }
  async removeLocatorHandler(): Promise<never> {
    return notSupported("page.removeLocatorHandler");
  }
  async exposeBinding(): Promise<never> {
    return notSupported("page.exposeBinding");
  }
  async waitForRequest(): Promise<never> {
    return notSupported("page.waitForRequest");
  }
  async waitForResponse(): Promise<never> {
    return notSupported("page.waitForResponse");
  }
}

/** Create a Page bound to the current window document. */
export function createPage(options?: PageOptions): Page {
  return new Page(options);
}

export type { ConsoleMessage };
