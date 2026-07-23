import { createPage, type Page } from "./page";
import { expect } from "./expect";
import type { TestFixtures, TestInfo, TestResult } from "./types";

type TestFn = (fixtures: TestFixtures) => void | Promise<void>;

type RegisteredTest = {
  title: string;
  fn: TestFn;
};

const registry: RegisteredTest[] = [];
let currentPage: Page | undefined;
let lastResult: TestResult | undefined;

/**
 * Register a test case. Call `runTests()` (or `runScript`) to execute.
 */
export function test(title: string, fn: TestFn): void {
  registry.push({ title, fn });
}

/** Run all registered tests sequentially with a shared `{ page }` fixture. */
export async function runTests(options?: {
  page?: Page;
}): Promise<TestResult> {
  const page = options?.page ?? currentPage ?? createPage();
  currentPage = page;
  const tests: TestInfo[] = [];
  let passed = 0;
  let failed = 0;
  const skipped = 0;

  const queue = registry.splice(0, registry.length);
  for (const t of queue) {
    const start =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      await t.fn({ page });
      const duration =
        (typeof performance !== "undefined" ? performance.now() : Date.now()) -
        start;
      tests.push({ title: t.title, status: "passed", duration });
      passed++;
    } catch (e) {
      const duration =
        (typeof performance !== "undefined" ? performance.now() : Date.now()) -
        start;
      const error = e instanceof Error ? e : new Error(String(e));
      tests.push({ title: t.title, status: "failed", error, duration });
      failed++;
    }
  }

  const result: TestResult = { passed, failed, skipped, tests };
  lastResult = result;
  return result;
}

export function getLastTestResult(): TestResult | undefined {
  return lastResult;
}

/** Reset registry (useful in smoke tests). */
export function _resetTests(): void {
  registry.length = 0;
  lastResult = undefined;
  currentPage = undefined;
}

export { expect };
