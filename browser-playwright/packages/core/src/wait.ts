export type TimeoutOptions = {
  timeout?: number;
};

// 默认超时修改为 5秒
export const DEFAULT_TIMEOUT = 5_000;

export function resolveTimeout(
  options?: TimeoutOptions,
  defaultTimeout = DEFAULT_TIMEOUT,
): number {
  return options?.timeout ?? defaultTimeout;
}

export async function pollUntil<T>(
  fn: () => T | undefined | null | false,
  options: {
    timeout?: number;
    interval?: number;
    message?: string;
  } = {},
): Promise<T> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const interval = options.interval ?? 100;
  const deadline = timeout > 0 ? Date.now() + timeout : 0;
  let lastError: Error | undefined;

  for (;;) {
    try {
      const result = fn();
      if (result) return result as T;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
    if (deadline && Date.now() >= deadline) {
      const msg =
        options.message ??
        `Timeout ${timeout}ms exceeded${lastError ? `: ${lastError.message}` : ""}`;
      throw new Error(msg);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}
