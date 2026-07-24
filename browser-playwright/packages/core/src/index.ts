export { expect, test, runTests, getLastTestResult, _resetTests } from "./test";
export { runScript } from "./runScript";
export {
  Page,
  createPage,
} from "./page";
export {
  Locator,
  FrameLocator,
  setTestIdAttribute,
  getTestIdAttribute,
} from "./locator";
export { Route, Request, NetworkManager } from "./network/route";
export {
  screenshotElement,
  screenshotPage,
  hashBytes,
  clearScreenshotBaselines,
} from "./screenshot";
export {
  startRecording,
  generateLocator,
  generateScript,
  actionToStatement,
  resolveTargetElement,
} from "./recorder";
export type { ByRoleOptions, ExactOptions, LocatorOptions } from "./locator";
export type { PageOptions, ConsoleMessage } from "./page";
export type {
  URLMatch,
  RouteHandlerCallback,
  RouteFulfillOptions,
  RouteContinueOptions,
  Headers as RouteHeaders,
} from "./network/route";
export type { ScreenshotOptions } from "./screenshot";
export type {
  RunScriptController,
  RunScriptOptions,
  StepEvent,
  TestFixtures,
  TestInfo,
  TestResult,
} from "./types";
export type {
  RecordedAction,
  RecorderOptions,
  RecorderController,
  AssertKind,
} from "./recorder";
