import type { Page } from "./page";

export interface TestFixtures {
  page: Page;
}

export interface TestInfo {
  title: string;
  status: "passed" | "failed" | "skipped";
  error?: Error;
  duration: number;
}

export interface TestResult {
  passed: number;
  failed: number;
  skipped: number;
  tests: TestInfo[];
}

export interface StepEvent {
  line: number;
  status: "running" | "passed" | "failed" | "paused";
  message?: string;
}

export interface RunScriptOptions {
  /** When true, start in play mode; default is paused until `play()` / `step()`. */
  autoPlay?: boolean;
  /**
   * Delay in ms after each checkpoint while `play()` is running.
   * Ignored for pause / step. Default 100; pass 0 to disable.
   */
  stepDelay?: number;
  onStep?: (event: StepEvent) => void;
  /** Bind script `page` fixture; defaults to `createPage()`. */
  page?: Page;
}

export interface RunScriptController {
  play: () => void;
  pause: () => void;
  step: () => void;
  stop: () => void;
  result: Promise<TestResult>;
}
