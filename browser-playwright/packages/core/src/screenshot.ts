/**
 * In-page screenshot (DOM → canvas / SVG foreignObject).
 *
 * Capability boundary vs Playwright CDP screenshots:
 * - Uses DOM serialization + canvas; pixels will NOT match official CDP output.
 * - Cross-origin images / external CSS may be missing or tainted.
 * - In environments without canvas (e.g. some happy-dom setups), falls back to
 *   a deterministic UTF-8 "fingerprint" of element HTML for hash comparison.
 */

export type ScreenshotOptions = {
  /** Target width; defaults to element/viewport width. */
  width?: number;
  /** Target height; defaults to element/viewport height. */
  height?: number;
  type?: "png" | "jpeg";
  quality?: number;
  /**
   * When true (default), try canvas capture; when false, always use HTML fingerprint.
   * Fingerprint mode is useful in headless DOM without canvas support.
   */
  preferCanvas?: boolean;
};

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function fingerprintBytes(label: string, html: string): Uint8Array {
  // Pseudo-PNG header prefix so callers can tell this is a degraded capture.
  const prefix = `BP-SCREENSHOT-FINGERPRINT\n${label}\n`;
  return utf8(prefix + html);
}

async function canvasToBytes(
  canvas: HTMLCanvasElement,
  type: "png" | "jpeg",
  quality?: number,
): Promise<Uint8Array | null> {
  const mime = type === "jpeg" ? "image/jpeg" : "image/png";
  if (typeof canvas.toBlob === "function") {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mime, quality),
    );
    if (blob) return new Uint8Array(await blob.arrayBuffer());
  }
  if (typeof canvas.toDataURL === "function") {
    const dataUrl = canvas.toDataURL(mime, quality);
    const base64 = dataUrl.split(",")[1];
    if (!base64) return null;
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  return null;
}

async function renderHtmlToCanvas(
  doc: Document,
  html: string,
  width: number,
  height: number,
  type: "png" | "jpeg",
  quality?: number,
): Promise<Uint8Array | null> {
  const win = doc.defaultView;
  if (!win) return null;

  const CanvasCtor = (win as any).HTMLCanvasElement
    ? undefined
    : undefined;
  void CanvasCtor;

  let canvas: HTMLCanvasElement;
  try {
    canvas = doc.createElement("canvas");
  } catch {
    return null;
  }
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  const ctx = canvas.getContext?.("2d");
  if (!ctx) return null;

  // SVG foreignObject technique (html-to-image style).
  const escaped = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Actually for foreignObject we need raw HTML, not escaped — use CDATA-safe wrap.
  const xhtml = `<div xmlns="http://www.w3.org/1999/xhtml">${html}</div>`;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}">
  <foreignObject width="100%" height="100%">${xhtml}</foreignObject>
</svg>`;

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    const ImageCtor = (win as any).Image ?? (globalThis as any).Image;
    if (!ImageCtor) {
      // No Image: draw placeholder text into canvas if possible.
      try {
        (ctx as CanvasRenderingContext2D).fillStyle = "#fff";
        (ctx as CanvasRenderingContext2D).fillRect(0, 0, canvas.width, canvas.height);
        (ctx as CanvasRenderingContext2D).fillStyle = "#000";
        (ctx as CanvasRenderingContext2D).fillText(escaped.slice(0, 200), 4, 16);
      } catch {
        /* ignore */
      }
      return canvasToBytes(canvas, type, quality);
    }

    const img = new ImageCtor();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("screenshot image load failed"));
      img.src = url;
    });
    (ctx as CanvasRenderingContext2D).drawImage(img, 0, 0);
    return canvasToBytes(canvas, type, quality);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function elementBounds(el: Element): { width: number; height: number } {
  try {
    const rect = el.getBoundingClientRect();
    return {
      width: Math.max(1, rect.width || (el as HTMLElement).offsetWidth || 1),
      height: Math.max(1, rect.height || (el as HTMLElement).offsetHeight || 1),
    };
  } catch {
    return { width: 1, height: 1 };
  }
}

function viewportSize(doc: Document): { width: number; height: number } {
  const win = doc.defaultView;
  return {
    width: Math.max(1, win?.innerWidth ?? doc.documentElement?.clientWidth ?? 800),
    height: Math.max(
      1,
      win?.innerHeight ?? doc.documentElement?.clientHeight ?? 600,
    ),
  };
}

/**
 * Capture an element screenshot. Returns PNG/JPEG bytes, or fingerprint bytes
 * when canvas is unavailable.
 */
export async function screenshotElement(
  element: Element,
  options: ScreenshotOptions = {},
): Promise<Uint8Array> {
  const type = options.type ?? "png";
  const bounds = elementBounds(element);
  const width = options.width ?? bounds.width;
  const height = options.height ?? bounds.height;
  const html = (element as HTMLElement).outerHTML ?? element.textContent ?? "";

  if (options.preferCanvas !== false) {
    const bytes = await renderHtmlToCanvas(
      element.ownerDocument,
      html,
      width,
      height,
      type,
      options.quality,
    );
    if (bytes) return bytes;
  }

  return fingerprintBytes("element", html);
}

/**
 * Capture the document viewport (body) screenshot.
 */
export async function screenshotPage(
  document: Document,
  options: ScreenshotOptions = {},
): Promise<Uint8Array> {
  const type = options.type ?? "png";
  const vp = viewportSize(document);
  const width = options.width ?? vp.width;
  const height = options.height ?? vp.height;
  const root = document.documentElement ?? document.body;
  const html = root?.outerHTML ?? "";

  if (options.preferCanvas !== false) {
    const bytes = await renderHtmlToCanvas(
      document,
      html,
      width,
      height,
      type,
      options.quality,
    );
    if (bytes) return bytes;
  }

  return fingerprintBytes("page", html);
}

/** Simple FNV-1a 32-bit hash for screenshot comparison. */
export function hashBytes(data: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Pixel / byte equality (exact). */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** In-memory baseline store for toHaveScreenshot (name → bytes). */
const baselines = new Map<string, Uint8Array>();

export function getScreenshotBaseline(name: string): Uint8Array | undefined {
  return baselines.get(name);
}

export function setScreenshotBaseline(name: string, data: Uint8Array): void {
  baselines.set(name, data);
}

export function clearScreenshotBaselines(): void {
  baselines.clear();
}
