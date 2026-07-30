# browser-playwright：在浏览器里直接运行 Playwright 脚本

## 为什么需要 browser-playwright？

[Playwright](https://playwright.dev/) 是当今最受欢迎的 Web 自动化与端到端测试框架之一。但要在本地正常使用官方 Playwright，通常需要：

1. 安装 Node.js 运行时与 npm/pnpm 依赖；
2. 执行 `npx playwright install` 下载并绑定特定版本的 Chromium / Firefox / WebKit；
3. 在 CI 或本地以 Node 进程启动浏览器，再通过 CDP 协议远程操控页面。

这套流程对自动化测试非常成熟，却也带来明显的门槛：**无法在纯前端环境里「开箱即用」**。如果你想在 Vue / React 业务页面里直接调试一段 Playwright 脚本、让 QA 在页面上录制操作、或在无 Node 环境的场景里做页内验收，官方方案并不顺手。

于是我们开发了 **browser-playwright**——一个**纯前端运行**的 Playwright 兼容库。它把常用的 `Page`、`Locator`、`expect`、`test` 等 API 搬到了浏览器页面内部执行，无需安装专用 Chrome、无需启动 Browser / BrowserServer，**当前页面就是测试上下文**。既有脚本可以较低成本迁移到页内运行，也可以配合录制与调试工具，嵌入任意前端工程。开源地址：[https://github.com/shenjunjian/browser-playwright](https://github.com/shenjunjian/browser-playwright)，欢迎大家来 Star 一下，或提建议！

### 适用场景

| 场景 | 说明 |
|------|------|
| **前端自动化测试** | 在 Vue / React 等业务页内直接运行 Playwright 风格脚本，做组件级或页面级 E2E 验收，无需单独起 Node Playwright 进程 |
| **交互测试** | 通过 `runScript` 逐步调试点击、输入、断言等交互流程，实时查看每一步的执行状态与失败位置 |
| **前端录制 Playwright 脚本** | 用 `startRecording` 或 `browser-playwright-vue` 的 Record 功能，在真实页面上操作并自动生成可回放的 `test(...)` 脚本 |
| **构建 Web MCP 工具函数** | 将 `page`、`locator`、`runScript` 等能力封装为浏览器侧 MCP Tool，智能体在页内调用，实现「看页面 → 执行动作 → 断言结果」的闭环 |

同一套 Playwright 兼容 API 贯穿测试、调试与 Agent 集成，降低多套自动化方案之间的切换成本。

---

## browser-playwright 快速上手


### 安装

```bash
npm install browser-playwright
# 或
pnpm add browser-playwright
# 或
yarn add browser-playwright
```

### 基础用法

在前端工程中像使用官方 Playwright 一样引入 `test`、`expect`，以及 `createPage` 获取页面对象：

```ts
import { test, expect, createPage, runTests } from 'browser-playwright'

// 可选：显式创建 Page（默认绑定当前 window / document）
const page = createPage()

test('弹窗的事件', async ({ page }) => {
  const content = page.locator('.is-message')
  await page.getByRole('button', { name: '打开带事件弹窗' }).first().click()
  await expect(content).toHaveText(/show 事件触发了/)
})

// 执行已注册的测试用例
const result = await runTests()
console.log(result.passed, result.failed) // 通过 / 失败数量
```

常用导入一览：

| 导入 | 说明 |
|------|------|
| `test` | 注册测试用例（轻量注册表，非完整 Playwright Test Runner） |
| `expect` | Locator 断言与通用值断言 |
| `createPage` / `Page` | 绑定当前文档的页面对象 |
| `runTests` | 顺序执行已注册的 `test()` |
| `runScript` | 字符串脚本逐步调试执行 |
| `startRecording` | 页内录制用户操作并生成脚本 |

`page` 即当前执行的页面对象，是顶层上下文——**没有** `chromium.launch()`、`Browser`、`BrowserServer` 等 Node 侧概念。

### 自定义超时

官方 Playwright 默认超时较长（如 30s）。browser-playwright 为页内场景统一改为 **5 秒**，可按需覆盖：

```ts
import { createPage, expect } from 'browser-playwright'

// 创建 Page 时指定默认超时
const page = createPage({ timeout: 10_000 })

// 或运行时修改
page.setDefaultTimeout(10_000)
page.setDefaultNavigationTimeout(10_000)

// expect 断言超时通过最后一个参数设置
await expect(page.locator('.msg')).toHaveCount(1, { timeout: 3_000 })
```

---

## 新增能力：runScript 与 startRecording

除了对齐官方 Page / Locator API，browser-playwright 还提供了页内调试与录制能力，便于在业务页面里「写脚本 → 逐步跑 → 看结果」。

### runScript

在页面内执行 Playwright 风格脚本文本，按语句边界步进，并提供播放 / 暂停 / 单步 / 停止控制。

**函数声明：**

```ts
function runScript(
  script: string,
  options?: RunScriptOptions,
): RunScriptController

interface RunScriptOptions {
  /** 为 true 时启动即连续执行；默认暂停，需调用 play() / step() */
  autoPlay?: boolean
  /** 每步执行时的回调 */
  onStep?: (event: StepEvent) => void
  /** 脚本内 page fixture 绑定的 Page；默认 createPage() */
  page?: Page
}

interface RunScriptController {
  play(): void    // 连续执行
  pause(): void   // 暂停在下一检查点
  step(): void    // 单步执行一步
  stop(): void    // 停止执行
  result: Promise<TestResult>  // 最终测试结果
}

interface StepEvent {
  line: number
  status: 'running' | 'passed' | 'failed' | 'paused'
  message?: string  // 失败时的错误信息
}

interface TestResult {
  passed: number
  failed: number
  skipped: number
  tests: TestInfo[]
}
```

**使用示例：**

```ts
import { runScript } from 'browser-playwright'

const script = `
test('弹窗的事件', async ({ page }) => {
  await page.goto('modal#modal-event')
  await page.getByRole('button', { name: '打开带事件弹窗' }).first().click()
  await expect(page.locator('.is-message')).toHaveText(/show 事件触发了/)
})
`

const ctrl = runScript(script, {
  autoPlay: false,
  onStep: (e) => {
    console.log(`第 ${e.line} 行`, e.status, e.message ?? '')
  },
})

ctrl.play()   // 开始连续执行
ctrl.pause()  // 暂停
ctrl.step()   // 单步
ctrl.stop()   // 停止

const result = await ctrl.result
console.log(`通过 ${result.passed}，失败 ${result.failed}`)
```

脚本内自动注入 `test`、`expect`、`page`。若脚本未调用 `test()`，整段会作为单个 `(script)` 用例汇总结果。信任模型与 `eval` 相同，**只应执行可信来源的脚本**。

---

### startRecording

页内等价于官方 Codegen：监听**真实用户操作**（`isTrusted === true`），生成可直接交给 `runScript` 回放的 `test(...)` 脚本。

**函数声明：**

```ts
function startRecording(options?: RecorderOptions): RecorderController

interface RecorderOptions {
  /** 生成 test(...) 的标题，默认 'recorded' */
  testTitle?: string
  /** 监听的 Document，默认 globalThis.document */
  document?: Document
  /** 脚本每次更新时的回调 */
  onUpdate?: (script: string, actions: RecordedAction[]) => void
  /** 忽略 UI 区域的属性名，默认 'data-bpw-ui' */
  uiAttribute?: string
}

interface RecorderController {
  readonly recording: boolean
  readonly assertMode: boolean
  assertKind: AssertKind  // 'toBeVisible' | 'toHaveText'

  pause(): void
  resume(): void
  setAssertMode(on: boolean, kind?: AssertKind): void
  script(): string
  actions(): RecordedAction[]
  stop(): { script: string; actions: RecordedAction[] }
}
```

**使用示例：**

```ts
import { startRecording, runScript } from 'browser-playwright'

const rec = startRecording({
  testTitle: '弹窗流程',
  onUpdate: (script) => console.log('脚本已更新：\n', script),
})

// 用户在页面上正常点击、输入、选择…
// 悬停时会高亮元素并显示候选 locator

// 开启断言模式：下次点击生成 expect(...).toBeVisible()
rec.setAssertMode(true)
rec.setAssertMode(true, 'toHaveText')  // 或 toHaveText

rec.pause()   // 暂停录制
rec.resume()  // 恢复

const { script, actions } = rec.stop()

// 回放录制的脚本
await runScript(script, { autoPlay: true }).result
```

生成脚本形态示例：

```ts
import { test, expect } from 'browser-playwright'

test('弹窗流程', async ({ page }) => {
  await page.getByRole('button', { name: '打开带事件弹窗' }).click()
  await expect(page.getByTestId('modal-message')).toBeVisible()
})
```

**录制能力摘要：**

| 能力 | 说明 |
|------|------|
| 支持动作 | click、dblclick、fill（防抖合并）、selectOption、check、uncheck、press(Enter/Tab/Escape) |
| 断言模式 | `setAssertMode(true)` 后点击生成 `expect` |
| Locator 策略 | 优先 role → testid → label/placeholder → text → CSS |
| UI 忽略 | 带 `[data-bpw-ui]` 的元素（如调试面板）不会被录制 |

**辅助函数：**

```ts
import { generateLocator, generateScript } from 'browser-playwright'

const locator = generateLocator(document.querySelector('button')!)
const script = generateScript([{ kind: 'click', locator }])
```

---

## 与官方 Playwright 的差异

browser-playwright **刻意不做** Browser / CDP 层，因此在能力边界上与官方有明确区别。下列 API 对齐较好：Locator 查询、`getByRole` / `getByText` / `getByTestId`、鼠标键盘操作、大部分 `expect` 断言、同源 iframe 的 `FrameLocator` 等。

### 不提供的能力

| 官方 Playwright | browser-playwright |
|-----------------|-------------------|
| `chromium.launch` / `Browser` / `BrowserServer` | 不实现；直接使用当前页 |
| CDP、多标签、多 BrowserContext | 不实现 |
| 跨进程导航到任意 URL | `page.goto` 仅支持同应用 hash / pushState / location |
| 模拟 Clock（假定时器） | 不实现；一律真实定时器 |
| 可信输入（`isTrusted === true`） | 合成事件，`isTrusted === false` |

### 行为有差异的 API

| API | 官方 | browser-playwright |
|-----|------|-------------------|
| `page.goto(url)` | 浏览器导航，返回 Response | 同应用路由；完整 `http(s)://` 才 `location.assign`；返回 `null` |
| `page.evaluate` | 跨进程序列化 | 同 realm 直接执行 DOM |
| `page.route` | CDP Fetch，覆盖导航与多数请求 | **仅拦截 fetch 与 XMLHttpRequest** |
| `page.screenshot` | CDP 像素截图 | DOM → canvas 近似图，像素不承诺与官方一致 |
| `expect(...).toHaveScreenshot` | 文件基线 + 像素比对 | 内存基线 + 字节/哈希比对 |
| `test` | Playwright Test Runner | 轻量注册表；fixture 仅 `{ page }` |
| `FrameLocator` | 可进任意 frame | 同源 iframe 优先；跨域受限 |

### 调用即抛错的 API

依赖 Browser / CDP / Inspector 的 API 会抛出 `not supported in-page` 错误，例如：

`page.$` / `$$` / `$eval` / `$$eval`、`context`、`opener`、`bringToFront`、`pdf`、`video`、`workers`、`pause`、`pickLocator`、`routeFromHAR`、`routeWebSocket`、`waitForRequest`、`waitForResponse` 等。

`page.close()` 仅标记关闭并拆除事件 hook，**不会关闭真实浏览器标签**。

### 默认超时对比

| 场景 | 官方 Playwright（典型） | browser-playwright |
|------|------------------------|-------------------|
| 默认 action / navigation 超时 | 30_000 ms | **5_000 ms** |
| expect 断言超时 | 与 test 配置相关 | 默认 **5_000 ms**，可通过 `{ timeout }` 覆盖 |

---

## browser-playwright-vue：Vue 3 页内 Inspector

若希望在 Vue 业务项目中获得**可视化**的录制、编辑与回放体验，可以使用配套组件库 **browser-playwright-vue**。它在 `browser-playwright` 之上封装浮动调试面板，Teleport 到页面右下角，提供播放 / 暂停 / 单步 / 停止、Record 录制、Assert 断言、源码编辑等能力。

### 安装

```bash
npm install browser-playwright browser-playwright-vue
# 或
pnpm add browser-playwright browser-playwright-vue
```

**Peer 依赖：** Vue `^3.5`

### 接入示例

```ts
import { BrowserPlaywrightDebugger } from 'browser-playwright-vue'
import 'browser-playwright-vue/style.css'  // 务必引入样式
```

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { BrowserPlaywrightDebugger } from 'browser-playwright-vue'
import 'browser-playwright-vue/style.css'

const script = ref(`import { test, expect } from 'browser-playwright'

test('弹窗的事件', async ({ page }) => {
  await page.getByRole('button', { name: '打开带事件弹窗' }).click()
  await expect(page.getByTestId('modal-message')).toHaveText('show 事件触发了')
})
`)
</script>

<template>
  <!-- 你的业务页面 … -->
  <BrowserPlaywrightDebugger v-model:script="script" />
</template>
```

### Props 与 Events

| Prop | 类型 | 默认 | 说明 |
|------|------|------|------|
| `script` | `string` | 空骨架 `test('recorded'…)` | 初始脚本；变更会重新准备回放 |
| `autoPlay` | `boolean` | `false` | 为 `true` 时挂载或脚本变更后自动连续执行 |

| Event | 说明 |
|-------|------|
| `update:script` | 录制更新或用户编辑时同步脚本，支持 `v-model:script` |

### 面板功能

- **Record（红点）**：开始 / 停止录制；悬停高亮 locator，点击写入脚本
- **Assert（∃）**：录制中开启后，点击元素生成 `expect(...).toBeVisible()` 或 `toHaveText`
- **播放 / 暂停 / 单步 / 停止**：基于底层 `runScript` 控制回放
- **预览 / 编辑**：展开面板可查看高亮当前行，或直接编辑脚本再回放
- **结果汇总**：展示 `passed · failed · skipped` 与各 `test()` 状态

面板根节点带 `data-bpw-ui` 属性，录制时会自动忽略，避免录到自己。业务侧若有其他浮动工具条不想被录，也可加上 `data-bpw-ui`。

### 典型工作流

1. 在页面右下角点击 **Record**，在业务页正常操作；
2. （可选）打开 **Assert**，点击元素追加断言；
3. 再次点击 **Record** 停止，脚本已写入面板；
4. 点击 **播放**，通过 `runScript` 回放并查看逐步结果。

---

## 两个库如何配合

```
┌─────────────────────────────────────────────────────────┐
│  browser-playwright-vue（Vue 3 浮动 Inspector UI）       │
│  Record · Assert · 编辑 · 播放控制 · 结果展示            │
└──────────────────────────┬──────────────────────────────┘
                           │ 依赖
┌──────────────────────────▼──────────────────────────────┐
│  browser-playwright（核心库，无框架依赖）                  │
│  Page · Locator · expect · test · runScript · startRecording │
└─────────────────────────────────────────────────────────┘
```

- **只要 API / 脚本能力**：安装 `browser-playwright` 即可；
- **要在 Vue 项目里悬浮调试工具**：再加 `browser-playwright-vue`；
- **脚本能力边界**以 core 为准，Vue 包只做 UI 壳。

---

## 适用场景

- 在前端项目里嵌入页内 E2E 脚本，无需单独起 Node Playwright 进程；
- QA / 开发在真实页面上录制操作，生成可回放的 Playwright 风格脚本；
- 逐步调试失败用例，看清每一行断言与操作的执行状态；
- 演示、验收、内网环境等不便安装 Playwright 浏览器的场景。

## 相关链接

- npm：[browser-playwright](https://www.npmjs.com/package/browser-playwright)
- npm：[browser-playwright-vue](https://www.npmjs.com/package/browser-playwright-vue)
- Playwright 官方 API 参考：[playwright.dev](https://playwright.dev/docs/api/class-playwright)

---

*browser-playwright 让 Playwright 脚本走出 Node 进程，直接在浏览器里运行——写一次脚本，在页面上录、编、播、验，一气呵成。*
