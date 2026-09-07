import { createPage, type Page } from "./page";
import { expect, test, runTests, _resetTests } from "./test";
import { instrumentScript } from "./scriptTransform";
import type {
  RunScriptController,
  RunScriptOptions,
  StepEvent,
  TestResult,
} from "./types";

class RunScriptStoppedError extends Error {
  constructor() {
    super("runScript stopped");
    this.name = "RunScriptStoppedError";
  }
}

type PlayMode = "play" | "pause" | "stop";

type Bridge = {
  checkpoint: (line: number) => Promise<void>;
};

function emptyResult(): TestResult {
  return { passed: 0, failed: 0, skipped: 0, tests: [] };
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * Run a Playwright-style script string in-page with step events and
 * play / pause / step / stop controls. Trust model matches `eval`.
 */
export function runScript(
  script: string,
  options?: RunScriptOptions,
): RunScriptController {
  const page: Page = options?.page ?? createPage();
  const onStep = options?.onStep;
  const stepDelay = options?.stepDelay ?? 100;

  let mode: PlayMode = options?.autoPlay ? "play" : "pause";
  let stepCredits = 0;
  let wake: (() => void) | null = null;
  let lastLine: number | undefined;
  let stopped = false;

  const emit = (event: StepEvent) => {
    try {
      onStep?.(event);
    } catch {
      // Listener errors must not break script execution.
    }
  };

  const signal = () => {
    const w = wake;
    wake = null;
    w?.();
  };

  const waitForContinue = (): Promise<void> =>
    new Promise<void>((resolve) => {
      wake = resolve;
    });

  const markFailed = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (lastLine !== undefined) {
      emit({ line: lastLine, status: "failed", message });
    }
  };

  const markLastPassed = () => {
    if (lastLine !== undefined) {
      emit({ line: lastLine, status: "passed" });
      lastLine = undefined;
    }
  };

  const shouldStop = () => stopped || mode === "stop";

  const bridge: Bridge = {
    async checkpoint(line: number) {
      if (shouldStop()) throw new RunScriptStoppedError();

      if (lastLine !== undefined && lastLine !== line) {
        emit({ line: lastLine, status: "passed" });
      }
      lastLine = line;

      while (true) {
        if (shouldStop()) throw new RunScriptStoppedError();
        if (mode === "play") break;
        if (stepCredits > 0) {
          stepCredits--;
          break;
        }
        emit({ line, status: "paused" });
        await waitForContinue();
      }

      if (shouldStop()) throw new RunScriptStoppedError();
      emit({ line, status: "running" });

      if (mode === "play" && stepDelay > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, stepDelay));
      }
    },
  };

  let registered = 0;
  const testProxy = (
    title: string,
    fn: (fixtures: { page: Page }) => void | Promise<void>,
  ) => {
    registered++;
    test(title, async (fixtures) => {
      try {
        await fn(fixtures);
        markLastPassed();
      } catch (e) {
        markFailed(e);
        throw e;
      }
    });
  };

  const result = (async (): Promise<TestResult> => {
    _resetTests();
    registered = 0;

    const body = instrumentScript(script);
    const AsyncFunction = Object.getPrototypeOf(async function () {})
      .constructor as new (
      ...args: string[]
    ) => (...args: unknown[]) => Promise<unknown>;

    const run = new AsyncFunction(
      "test",
      "expect",
      "page",
      "__bp",
      `"use strict";\n${body}`,
    );

    const start = now();

    try {
      await run(testProxy, expect, page, bridge);

      if (shouldStop()) {
        markFailed(new RunScriptStoppedError());
        return emptyResult();
      }

      if (registered > 0) {
        return await runTests({ page });
      }

      markLastPassed();
      return {
        passed: 1,
        failed: 0,
        skipped: 0,
        tests: [{ title: "(script)", status: "passed", duration: now() - start }],
      };
    } catch (e) {
      if (e instanceof RunScriptStoppedError || stopped) {
        markFailed(e);
        return emptyResult();
      }

      markFailed(e);
      const error = e instanceof Error ? e : new Error(String(e));
      return {
        passed: 0,
        failed: 1,
        skipped: 0,
        tests: [
          { title: "(script)", status: "failed", error, duration: now() - start },
        ],
      };
    }
  })();

  return {
    play() {
      if (stopped) return;
      mode = "play";
      signal();
    },
    pause() {
      if (stopped) return;
      mode = "pause";
    },
    step() {
      if (stopped) return;
      mode = "pause";
      stepCredits++;
      signal();
    },
    stop() {
      stopped = true;
      mode = "stop";
      signal();
    },
    result,
  };
}
