/**
 * In-page network interception (fetch + XHR).
 *
 * Capability boundary vs Playwright CDP Fetch:
 * - Intercepts window.fetch and XMLHttpRequest only.
 * - Does not cover navigation, <img>/<script> loads, Service Worker, or WebSocket.
 * - Same-origin and CORS rules still apply to continued requests.
 */

import { urlMatches, type URLMatch } from "./urlMatch";

export type { URLMatch };

export type Headers = Record<string, string>;

export type RouteFulfillOptions = {
  status?: number;
  headers?: Headers;
  contentType?: string;
  body?: string | Uint8Array | ArrayBuffer;
  json?: unknown;
};

export type RouteContinueOptions = {
  url?: string;
  method?: string;
  headers?: Headers;
  postData?: string | Uint8Array | ArrayBuffer;
};

export type RouteHandlerCallback = (
  route: Route,
) => void | Promise<void>;

type RouteAction =
  | { type: "fulfill"; options: RouteFulfillOptions }
  | { type: "abort"; errorCode?: string }
  | { type: "continue"; options: RouteContinueOptions };

export class Request {
  private readonly _url: string;
  private readonly _method: string;
  private readonly _headers: Headers;
  private readonly _postData: string | null;
  private readonly _resourceType: string;

  constructor(init: {
    url: string;
    method: string;
    headers?: Headers;
    postData?: string | null;
    resourceType?: string;
  }) {
    this._url = init.url;
    this._method = init.method;
    this._headers = { ...(init.headers ?? {}) };
    this._postData = init.postData ?? null;
    this._resourceType = init.resourceType ?? "fetch";
  }

  url(): string {
    return this._url;
  }

  method(): string {
    return this._method;
  }

  headers(): Headers {
    return { ...this._headers };
  }

  headerValue(name: string): string | null {
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(this._headers)) {
      if (k.toLowerCase() === lower) return v;
    }
    return null;
  }

  postData(): string | null {
    return this._postData;
  }

  postDataJSON(): unknown {
    if (!this._postData) return null;
    return JSON.parse(this._postData);
  }

  resourceType(): string {
    return this._resourceType;
  }
}

/**
 * A stalled request that can be fulfilled, aborted, or continued.
 * Mirrors Playwright's Route API surface (subset).
 */
export class Route {
  private readonly _request: Request;
  private _handled = false;
  private _action: RouteAction | null = null;
  private readonly _resolve: (action: RouteAction) => void;

  constructor(
    request: Request,
    resolve: (action: RouteAction) => void,
  ) {
    this._request = request;
    this._resolve = resolve;
  }

  request(): Request {
    return this._request;
  }

  private _ensureNotHandled(): void {
    if (this._handled) throw new Error("Route is already handled!");
  }

  async fulfill(options: RouteFulfillOptions = {}): Promise<void> {
    this._ensureNotHandled();
    this._handled = true;
    this._action = { type: "fulfill", options };
    this._resolve(this._action);
  }

  async abort(errorCode?: string): Promise<void> {
    this._ensureNotHandled();
    this._handled = true;
    this._action = { type: "abort", errorCode };
    this._resolve(this._action);
  }

  async continue(options: RouteContinueOptions = {}): Promise<void> {
    this._ensureNotHandled();
    this._handled = true;
    this._action = { type: "continue", options };
    this._resolve(this._action);
  }

  /** @internal — if handler returns without calling fulfill/abort/continue, continue. */
  _autoContinueIfUnhandled(): void {
    if (!this._handled) {
      this._handled = true;
      this._action = { type: "continue", options: {} };
      this._resolve(this._action);
    }
  }
}

type RouteEntry = {
  url: URLMatch;
  handler: RouteHandlerCallback;
  times: number;
  handledCount: number;
};

function headersFromInit(init?: HeadersInit): Headers {
  const out: Headers = {};
  if (!init) return out;
  if (init instanceof Headers) {
    init.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  if (Array.isArray(init)) {
    for (const [k, v] of init) out[k] = v;
    return out;
  }
  for (const [k, v] of Object.entries(init)) out[k] = String(v);
  return out;
}

function mergeHeaders(base: Headers, override?: Headers): Headers {
  const out = { ...base };
  if (!override) return out;
  for (const [k, v] of Object.entries(override)) out[k] = v;
  return out;
}

function bodyToUint8Array(
  body: string | Uint8Array | ArrayBuffer | undefined,
): Uint8Array | undefined {
  if (body === undefined) return undefined;
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  return new Uint8Array(body);
}

function buildFulfillResponse(options: RouteFulfillOptions): Response {
  let body: BodyInit | null = null;
  const headers = mergeHeaders({}, options.headers);

  if (options.json !== undefined) {
    body = JSON.stringify(options.json);
    if (!headers["content-type"] && !headers["Content-Type"])
      headers["content-type"] = "application/json";
  } else if (options.body !== undefined) {
    const bytes = bodyToUint8Array(options.body);
    body = bytes ? (bytes as unknown as BodyInit) : null;
  }

  if (options.contentType) headers["content-type"] = options.contentType;

  return new Response(body, {
    status: options.status ?? 200,
    headers,
  });
}

function readBodyAsText(
  body: BodyInit | null | undefined,
): Promise<string | null> {
  if (body == null) return Promise.resolve(null);
  if (typeof body === "string") return Promise.resolve(body);
  if (body instanceof Uint8Array)
    return Promise.resolve(new TextDecoder().decode(body));
  if (body instanceof ArrayBuffer)
    return Promise.resolve(new TextDecoder().decode(body));
  if (typeof Blob !== "undefined" && body instanceof Blob)
    return body.text();
  if (typeof FormData !== "undefined" && body instanceof FormData)
    return Promise.resolve(null);
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams)
    return Promise.resolve(body.toString());
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream)
    return new Response(body).text();
  return Promise.resolve(null);
}

/**
 * Patches fetch + XHR on a window. One manager per Page.
 */
export class NetworkManager {
  private readonly _win: Window & typeof globalThis;
  private readonly _baseURL: string;
  private _routes: RouteEntry[] = [];
  private _installed = false;
  private _originalFetch?: typeof fetch;
  private _OriginalXHR?: typeof XMLHttpRequest;

  constructor(win: Window & typeof globalThis, baseURL?: string) {
    this._win = win;
    this._baseURL =
      baseURL ??
      (typeof win.location?.href === "string" ? win.location.href : "http://localhost/");
  }

  async route(
    url: URLMatch,
    handler: RouteHandlerCallback,
    options?: { times?: number },
  ): Promise<void> {
    this._install();
    this._routes.unshift({
      url,
      handler,
      times: options?.times ?? Number.MAX_SAFE_INTEGER,
      handledCount: 0,
    });
  }

  async unroute(
    url: URLMatch,
    handler?: RouteHandlerCallback,
  ): Promise<void> {
    this._routes = this._routes.filter((r) => {
      if (r.url !== url) return true;
      if (handler && r.handler !== handler) return true;
      return false;
    });
    if (!this._routes.length) this._uninstall();
  }

  async unrouteAll(): Promise<void> {
    this._routes = [];
    this._uninstall();
  }

  private _install(): void {
    if (this._installed) return;
    this._installed = true;
    this._patchFetch();
    this._patchXHR();
  }

  private _uninstall(): void {
    if (!this._installed) return;
    this._installed = false;
    if (this._originalFetch) {
      this._win.fetch = this._originalFetch;
      this._originalFetch = undefined;
    }
    if (this._OriginalXHR) {
      this._win.XMLHttpRequest = this._OriginalXHR;
      this._OriginalXHR = undefined;
    }
  }

  private async _handleRequest(request: Request): Promise<RouteAction> {
    const handlers = this._routes.slice();
    for (const entry of handlers) {
      if (!urlMatches(request.url(), entry.url, this._baseURL)) continue;
      entry.handledCount++;
      if (entry.handledCount >= entry.times) {
        const idx = this._routes.indexOf(entry);
        if (idx !== -1) this._routes.splice(idx, 1);
      }

      let resolve!: (action: RouteAction) => void;
      const actionPromise = new Promise<RouteAction>((r) => {
        resolve = r;
      });
      const route = new Route(request, resolve);
      try {
        await entry.handler(route);
      } catch (e) {
        route._autoContinueIfUnhandled();
        throw e;
      }
      route._autoContinueIfUnhandled();
      const action = await actionPromise;
      if (!this._routes.length) this._uninstall();
      return action;
    }
    return { type: "continue", options: {} };
  }

  private _patchFetch(): void {
    const original = this._win.fetch.bind(this._win);
    this._originalFetch = this._win.fetch;
    const self = this;

    this._win.fetch = async function patchedFetch(
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      let url: string;
      let method = "GET";
      let headers: Headers = {};
      let postData: string | null = null;

      if (typeof input === "string" || input instanceof URL) {
        url = String(input);
        method = (init?.method ?? "GET").toUpperCase();
        headers = headersFromInit(init?.headers);
        postData = await readBodyAsText(init?.body ?? null);
      } else {
        // global Request
        url = input.url;
        method = (init?.method ?? input.method ?? "GET").toUpperCase();
        headers = headersFromInit(init?.headers ?? input.headers);
        if (init?.body !== undefined)
          postData = await readBodyAsText(init.body);
        else {
          try {
            postData = await input.clone().text();
          } catch {
            postData = null;
          }
        }
      }

      try {
        url = new URL(url, self._baseURL).href;
      } catch {
        /* keep relative */
      }

      const req = new Request({
        url,
        method,
        headers,
        postData,
        resourceType: "fetch",
      });
      const action = await self._handleRequest(req);

      if (action.type === "abort") {
        throw new TypeError(
          `Failed to fetch: aborted${action.errorCode ? ` (${action.errorCode})` : ""}`,
        );
      }

      if (action.type === "fulfill") {
        return buildFulfillResponse(action.options);
      }

      const cont = action.options;
      const nextUrl = cont.url ?? url;
      const nextMethod = cont.method ?? method;
      const nextHeaders = mergeHeaders(headers, cont.headers);
      let nextBody: BodyInit | null | undefined = init?.body;
      if (cont.postData !== undefined) {
        const bytes = bodyToUint8Array(cont.postData);
        nextBody = bytes
          ? (bytes as unknown as BodyInit)
          : undefined;
      }

      const nextInit: RequestInit = {
        ...(init ?? {}),
        method: nextMethod,
        headers: nextHeaders,
        body: nextMethod === "GET" || nextMethod === "HEAD" ? undefined : nextBody,
      };

      if (typeof input === "string" || input instanceof URL) {
        return original(nextUrl, nextInit);
      }
      return original(nextUrl, nextInit);
    } as typeof fetch;
  }

  private _patchXHR(): void {
    const Original = this._win.XMLHttpRequest;
    if (!Original) return;
    this._OriginalXHR = Original;
    const self = this;

    class PatchedXHR extends Original {
      private _bpUrl = "";
      private _bpMethod = "GET";
      private _bpHeaders: Headers = {};
      private _bpBody: Document | XMLHttpRequestBodyInit | null = null;

      open(
        method: string,
        url: string | URL,
        async?: boolean,
        username?: string | null,
        password?: string | null,
      ): void {
        this._bpMethod = method.toUpperCase();
        try {
          this._bpUrl = new URL(String(url), self._baseURL).href;
        } catch {
          this._bpUrl = String(url);
        }
        super.open(
          method,
          url as string,
          async ?? true,
          username,
          password,
        );
      }

      setRequestHeader(name: string, value: string): void {
        this._bpHeaders[name] = value;
        super.setRequestHeader(name, value);
      }

      send(body?: Document | XMLHttpRequestBodyInit | null): void {
        void this._bpSend(body ?? null);
      }

      private async _bpSend(
        body: Document | XMLHttpRequestBodyInit | null,
      ): Promise<void> {
        this._bpBody = body;
        let postData: string | null = null;
        if (typeof body === "string") postData = body;
        else if (body instanceof Uint8Array)
          postData = new TextDecoder().decode(body);
        else if (body instanceof ArrayBuffer)
          postData = new TextDecoder().decode(body);

        const req = new Request({
          url: this._bpUrl,
          method: this._bpMethod,
          headers: { ...this._bpHeaders },
          postData,
          resourceType: "xhr",
        });

        let action: RouteAction;
        try {
          action = await self._handleRequest(req);
        } catch (e) {
          this.dispatchEvent(new Event("error"));
          return;
        }

        if (action.type === "abort") {
          this.abort();
          this.dispatchEvent(new Event("error"));
          return;
        }

        if (action.type === "fulfill") {
          const status = action.options.status ?? 200;
          let responseText = "";
          if (action.options.json !== undefined)
            responseText = JSON.stringify(action.options.json);
          else if (typeof action.options.body === "string")
            responseText = action.options.body;
          else if (action.options.body)
            responseText = new TextDecoder().decode(
              bodyToUint8Array(action.options.body)!,
            );

          const headers = mergeHeaders({}, action.options.headers);
          if (action.options.contentType)
            headers["content-type"] = action.options.contentType;
          const headerLines = Object.entries(headers)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\r\n");

          Object.defineProperty(this, "readyState", { get: () => 4, configurable: true });
          Object.defineProperty(this, "status", { get: () => status, configurable: true });
          Object.defineProperty(this, "statusText", {
            get: () => (status === 200 ? "OK" : ""),
            configurable: true,
          });
          Object.defineProperty(this, "responseText", {
            get: () => responseText,
            configurable: true,
          });
          Object.defineProperty(this, "response", {
            get: () => responseText,
            configurable: true,
          });
          Object.defineProperty(this, "getAllResponseHeaders", {
            value: () => headerLines,
            configurable: true,
          });
          Object.defineProperty(this, "getResponseHeader", {
            value: (name: string) => {
              const lower = name.toLowerCase();
              for (const [k, v] of Object.entries(headers)) {
                if (k.toLowerCase() === lower) return v;
              }
              return null;
            },
            configurable: true,
          });

          this.dispatchEvent(new Event("readystatechange"));
          this.dispatchEvent(new Event("load"));
          this.dispatchEvent(new Event("loadend"));
          return;
        }

        const cont = action.options;
        if (cont.url) {
          try {
            this._bpUrl = new URL(cont.url, self._baseURL).href;
          } catch {
            this._bpUrl = cont.url;
          }
          super.open(cont.method ?? this._bpMethod, this._bpUrl, true);
          for (const [k, v] of Object.entries(
            mergeHeaders(this._bpHeaders, cont.headers),
          ))
            super.setRequestHeader(k, v);
        } else if (cont.method || cont.headers) {
          if (cont.method) this._bpMethod = cont.method;
          for (const [k, v] of Object.entries(cont.headers ?? {}))
            super.setRequestHeader(k, v);
        }

        let sendBody = this._bpBody;
        if (cont.postData !== undefined) {
          const bytes = bodyToUint8Array(cont.postData);
          sendBody = bytes
            ? (bytes as unknown as XMLHttpRequestBodyInit)
            : null;
        }
        super.send(sendBody);
      }
    }

    this._win.XMLHttpRequest = PatchedXHR as typeof XMLHttpRequest;
  }
}
