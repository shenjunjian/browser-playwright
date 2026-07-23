/** Throw for Playwright APIs that require Browser / CDP and cannot work in-page. */
export function notSupported(api: string): never {
  throw new Error(
    `${api} is not supported in-page (no Browser / CDP). See package README for capability boundaries.`,
  );
}
