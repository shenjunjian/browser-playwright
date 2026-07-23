# browser-playwright（core）

在**当前页面**内运行的 Playwright 风格自动化库。发布名为 `browser-playwright`，无框架依赖，可直接嵌入 Vue / React 等前端工程，也可配合 `runScript` 做页内逐步调试。

## 目的

官方 Playwright 在 Node.js 中通过 CDP 操控浏览器。本包把常用的 **Page / Locator / expect / test** 搬到浏览器里执行，让既有 Playwright 风格脚本可以在页面上跑：

```ts
import { test, expect } from 'browser-playwright'

test('弹窗的事件', async ({ page }) => {
  page.on('pageerror', (exception) => expect(exception).toBeNull())
  await page.goto('modal#modal-event')
  const content = page.locator('.is-message')
  await page.getByRole('button', { name: '打开带事件弹窗' }).first().click()
  await expect(content).toHaveText(/show 事件触发了/)
})
```

设计目标：

| 目标 | 说明 |
|------|------|
| API 对齐 | Locator、断言、鼠标键盘、evaluate 等用法尽量与官方一致 |
| 页内执行 | 不启动浏览器；`page` 绑定当前 `window` / `document` |
| 真实事件序列 | 点击等操作按浏览器真实顺序合成（pointer → mouse → click） |
| Role 查询 | 基于 DOM / ARIA 计算，移植官方页内选择器实现 |
| 真实定时器 | 使用 `setTimeout` 等，不模拟 Clock |
| 可嵌入 | 配合 `runScript` 或 Vue 调试组件，在业务页里跑测试脚本 |

## 安装与构建

在 monorepo 内：

```bash
cd browser-playwright
pnpm install
pnpm --filter browser-playwright build
```

产物：`dist/browser-playwright.js` + `dist/index.d.ts`。

```ts
import {
  test,
  expect,
  runScript,
  createPage,
  // …
} from 'browser-playwright'
```

## 与 Playwright 官方 API 的差异

本库**刻意不做** Browser / CDP 层，因此下列能力与官方不同或仅有降级实现。

### 不做 / 不适用

| Playwright 官方 | 本库 |
|-----------------|------|
| `chromium.launch` / `Browser` / `BrowserServer` | 不实现；直接使用当前页 |
| CDP、多标签、多浏览器上下文 | 不实现 |
| 跨进程导航到任意 URL | `page.goto` 解释为同应用 hash / `pushState` / `location` |
| 模拟 Clock | 不实现；一律真实定时器 |
| 可信输入（`isTrusted === true`） | 合成事件，`isTrusted === false`（预期限制） |

### 行为有差异的 API

| API | 官方 | 本库 |
|-----|------|------|
| `page.goto(url)` | 浏览器导航，返回 Response | 同应用路由：`modal#hash`、`#hash`、`/path` 用 `pushState` / `hash`；完整 `http(s)://` 才 `location.assign`。返回 `null` |
| `page.evaluate` | 跨进程序列化 | 同 realm 直接执行；可直接操作 DOM，无需序列化 |
| `page.addInitScript` | 每次导航前注入 | 立即执行；并在 `hashchange` / `popstate` 上尽量重跑。不支持 `{ path }`，请用函数或 `content` |
| `page.on(...)` | 多种页面事件 | 当前支持 `console`、`pageerror`（挂 console hook / `error` / `unhandledrejection`） |
| `page.route` | CDP Fetch，覆盖导航与多数请求 | 仅拦截 `fetch` 与 `XMLHttpRequest`；**不覆盖**文档导航、`<img>`/`<script>`、Service Worker、WebSocket |
| `page.screenshot` / `locator.screenshot` | CDP 像素截图 | DOM → canvas（SVG foreignObject）；无 canvas 时退化为 HTML fingerprint。像素**不承诺**与官方一致 |
| `expect(...).toHaveScreenshot` | 文件基线 + 像素比对 | 内存基线 + 字节/哈希比对；首次命名调用会建立基线并视为通过 |
| `test` | Playwright Test Runner | 轻量注册表：`test()` 注册，`runTests()` / `runScript` 执行；fixture 仅 `{ page }` |
| `FrameLocator` | 可进任意 frame | 同源 iframe 优先；跨域受限 |

### 对齐较好的部分

- **查询**：`locator`、`getByRole` / `getByText` / `getByTestId` / `getByLabel` / `getByPlaceholder` / `getByAltText` / `getByTitle`、`filter`、`first` / `nth` / `last`、`and` / `or`
- **动作**：`click`、`dblclick`、`hover`、`fill`、`type`、`press`、`check` / `uncheck`、`selectOption`、`focus` / `blur`（带 auto-wait）
- **点击事件顺序**：`pointerdown` → `mousedown` → `pointerup` → `mouseup` → `click`
- **断言**：`toBeVisible`、`toHaveText`、`toHaveCount`、`toHaveAttribute` 等，带轮询重试
- **网络 Route 表面**：`fulfill` / `abort` / `continue` 形状接近官方

## 导出一览

来自包入口 `src/index.ts`：

### 运行时值

| 导出 | 说明 |
|------|------|
| `test` | 注册测试用例 |
| `expect` | 断言（Locator 或通用值） |
| `runTests` | 顺序执行已注册测试，返回 `TestResult` |
| `getLastTestResult` | 最近一次 `runTests` 结果 |
| `_resetTests` | 清空注册表（内部 / smoke 用） |
| `runScript` | 按字符串脚本步进执行，带播放控制 |
| `Page` | 页面类 |
| `createPage` | 创建绑定当前文档的 `Page` |
| `Locator` | 定位器类 |
| `FrameLocator` | iframe 定位器 |
| `setTestIdAttribute` / `getTestIdAttribute` | 自定义 test id 属性名（默认 `data-testid`） |
| `Route` / `Request` / `NetworkManager` | 网络拦截相关 |
| `screenshotElement` / `screenshotPage` | 底层截图工具 |
| `hashBytes` / `clearScreenshotBaselines` | 截图哈希与清空内存基线 |

### 类型

`ByRoleOptions`、`ExactOptions`、`LocatorOptions`、`PageOptions`、`ConsoleMessage`、`URLMatch`、`RouteHandlerCallback`、`RouteFulfillOptions`、`RouteContinueOptions`、`RouteHeaders`、`ScreenshotOptions`、`RunScriptController`、`RunScriptOptions`、`StepEvent`、`TestFixtures`、`TestInfo`、`TestResult`。

---

## 用法说明

### `createPage` / `Page`

```ts
import { createPage } from 'browser-playwright'

const page = createPage()
// 或绑定指定 document / 默认超时
const page2 = createPage({ document: someIframe.contentDocument!, timeout: 10_000 })

page.setDefaultTimeout(15_000)
```

常用方法：

```ts
// 查询
page.locator('.item')
page.getByRole('button', { name: '提交' })
page.getByText('你好')
page.getByTestId('submit')
page.frameLocator('iframe#app')

// 导航（页内）
await page.goto('modal#modal-event')
await page.goto('#section')
await page.goto('/settings')

// 事件
page.on('pageerror', (err) => console.error(err))
page.on('console', (msg) => console.log(msg.type, msg.text))

// 脚本与操作
await page.evaluate(() => document.title)
await page.addInitScript(() => { (window as any).__ready = true })
await page.click('button')
await page.fill('#email', 'a@b.com')

// 网络（仅 fetch / XHR）
await page.route('**/api/user', async (route) => {
  await route.fulfill({ json: { id: 1, name: 'Ada' } })
})
await page.unroute('**/api/user')
await page.unrouteAll()

// 截图
const bytes = await page.screenshot({ type: 'png' })
```

### `Locator` / `FrameLocator`

```ts
const btn = page.getByRole('button', { name: '打开' }).first()

await btn.click()
await btn.dblclick()
await btn.hover()
await btn.fill('text')      // 对输入类元素
await btn.type('abc', { delay: 20 })
await btn.press('Enter')
await btn.check()
await btn.uncheck()
await btn.selectOption({ label: '选项 A' })
await btn.focus()
await btn.blur()

await btn.waitFor({ state: 'visible' })
await expect(btn).toBeVisible()

const count = await page.locator('.row').count()
const text = await page.locator('h1').innerText()
const html = await page.locator('.card').innerHTML()
const value = await page.locator('input').inputValue()
const attr = await page.locator('a').getAttribute('href')

// 组合
page.locator('ul').locator('li').filter({ hasText: 'foo' }).nth(1)
page.getByRole('listitem').and(page.getByText('重要'))
page.getByText('A').or(page.getByText('B'))

// iframe
const frame = page.frameLocator('iframe.editor')
await frame.getByRole('textbox').fill('hello')
```

自定义 test id 属性：

```ts
import { setTestIdAttribute } from 'browser-playwright'

setTestIdAttribute('data-test')
page.getByTestId('login') // 匹配 [data-test="login"]
```

### `expect`

Locator 断言会**自动重试**直到超时（默认与 wait 超时一致）：

```ts
await expect(page.locator('.msg')).toBeVisible()
await expect(page.locator('.msg')).toBeHidden()
await expect(page.locator('.item')).toHaveCount(3)
await expect(page.locator('.msg')).toHaveText(/成功/)
await expect(page.locator('.msg')).toContainText('成功')
await expect(page.locator('input')).toHaveValue('Ada')
await expect(page.locator('a')).toHaveAttribute('href', /docs/)
await expect(page.locator('#agree')).toBeChecked()
await expect(page.locator('button')).toBeEnabled()
await expect(page.locator('button')).toBeDisabled()
await expect(page.locator('.x')).toBeAttached()
await expect(page.locator('.panel')).not.toBeVisible()

// 截图断言（内存基线；非 CDP 像素级）
await expect(page.locator('.chart')).toHaveScreenshot('chart-v1')
```

通用值断言（不重试）：

```ts
expect(null).toBeNull()
expect(1).toBe(1)
expect({ a: 1 }).toEqual({ a: 1 })
expect('x').toBeTruthy()
expect('').toBeFalsy()
```

### `test` / `runTests`

```ts
import { test, expect, runTests, getLastTestResult } from 'browser-playwright'

test('示例', async ({ page }) => {
  await page.getByRole('button', { name: '打开' }).click()
  await expect(page.locator('.is-message')).toHaveText(/show/)
})

const result = await runTests()
// result: { passed, failed, skipped, tests: TestInfo[] }

console.log(getLastTestResult())
```

也可传入已有 page：

```ts
const page = createPage()
await runTests({ page })
```

### `runScript`

无框架依赖：把 Playwright 风格脚本当作字符串执行，按语句边界步进，并暴露播放控制。

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
    // e.line, e.status: 'running' | 'passed' | 'failed' | 'paused'
    // e.message? 失败时有错误信息
    console.log(e)
  },
})

ctrl.play()   // 连续执行
ctrl.pause()  // 暂停在下一步检查点
ctrl.step()   // 单步一步
ctrl.stop()   // 停止

const result = await ctrl.result
console.log(result.passed, result.failed)
```

脚本内可使用注入的 `test`、`expect`、`page`。信任模型与 `eval` 相同：只应执行调用方明确传入的内容。

若脚本未调用 `test()`，整段脚本会作为单个 `(script)` 用例汇总结果。

### 网络：`Route` / `Request`

```ts
await page.route(/\/api\/items/, async (route) => {
  const req = route.request()
  console.log(req.method(), req.url(), req.postData())

  // 三种处理（需调用其一）
  await route.fulfill({
    status: 200,
    json: [{ id: 1 }],
  })
  // await route.abort()
  // await route.continue({ headers: { ...req.headers(), 'x-debug': '1' } })
})
```

`URLMatch` 可为字符串 glob、`RegExp` 或谓词函数。

### 截图工具函数

多数场景用 `page.screenshot` / `locator.screenshot` / `toHaveScreenshot` 即可。底层也可直接：

```ts
import {
  screenshotPage,
  screenshotElement,
  hashBytes,
  clearScreenshotBaselines,
} from 'browser-playwright'

const bytes = await screenshotPage(document, { type: 'png' })
const h = hashBytes(bytes)
clearScreenshotBaselines() // 清空 toHaveScreenshot 内存基线
```

## 能力边界小结

1. **环境**：浏览器页面（或兼容 DOM 的环境，如部分 happy-dom）；不是 Node 里的 Playwright Runner。
2. **网络**：仅 `fetch` / XHR；导航级与资源标签请求拦截不到。
3. **截图**：DOM 渲染近似图 / fingerprint，不能当官方视觉回归的像素金标准。
4. **输入**：事件序列真实，但不可信（`isTrusted=false`）；依赖信任检查的页面行为可能不同。
5. **安全**：`runScript` / `evaluate` / `addInitScript` 会执行任意代码，仅用于受信脚本。

## 相关包

| 包 | 职责 |
|----|------|
| `browser-playwright`（本包） | 页内 API + `runScript` |
| `browser-playwright-vue` | 浮动调试 UI，驱动 `runScript` |
| `apps/site` | monorepo 内演示与验收 |

更多仓库约定见仓库根目录 [`AGENT.md`](../../../AGENT.md)。
