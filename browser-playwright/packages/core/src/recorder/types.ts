/** One recorded user action or assertion. */
export type RecordedAction =
  | {
      kind: "click" | "dblclick";
      locator: string;
    }
  | {
      kind: "fill";
      locator: string;
      value: string;
    }
  | {
      kind: "selectOption";
      locator: string;
      value: string;
    }
  | {
      kind: "check" | "uncheck";
      locator: string;
    }
  | {
      kind: "press";
      locator: string;
      key: string;
    }
  | {
      kind: "expect";
      locator: string;
      assertion: "toBeVisible" | "toHaveText";
      /** Used when assertion is `toHaveText`. */
      text?: string;
    };

export type AssertKind = "toBeVisible" | "toHaveText";

export type RecorderOptions = {
  /** Title for the generated `test(...)` wrapper. Defaults to `'recorded'`. */
  testTitle?: string;
  /** Document to attach listeners to. Defaults to `globalThis.document`. */
  document?: Document;
  /** Called whenever the generated script changes. */
  onUpdate?: (script: string, actions: RecordedAction[]) => void;
  /**
   * CSS selector / attribute used to ignore UI chrome (debugger panel).
   * Elements matching `[data-bpw-ui]` (and descendants) are never recorded.
   */
  uiAttribute?: string;
};

export type RecorderController = {
  /** Whether recording is currently capturing events. */
  readonly recording: boolean;
  /** Whether assert mode is on (next click → expect). */
  readonly assertMode: boolean;
  /** Current assert kind when assert mode is on. */
  assertKind: AssertKind;
  /** Pause capturing without disposing overlays / listeners teardown. */
  pause(): void;
  /** Resume after pause. */
  resume(): void;
  /** Toggle assert mode. When true, next click records an expect. */
  setAssertMode(on: boolean, kind?: AssertKind): void;
  /** Current generated script. */
  script(): string;
  /** Current action list (copy). */
  actions(): RecordedAction[];
  /** Stop recording and remove listeners / overlays. */
  stop(): { script: string; actions: RecordedAction[] };
};
