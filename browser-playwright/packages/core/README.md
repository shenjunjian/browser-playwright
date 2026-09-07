# browser-playwright 

在**浏览器页面**内运行的 Playwright 脚本的自动化库 ，无框架依赖，可直接嵌入任意 Vue / React 等前端工程，也可配合 `runScript` 做页内逐步调试，或用 `startRecording` 录制操作生成脚本。

## 目的

官方 Playwright 在 Node.js 中通过 CDP 操控浏览器。本包把常用的 **Page / Locator / expect / test** 搬到浏览器里执行，让既有 Playwright 脚本可以在页面上跑。

## 快速上手

它支持在浏览器运行playwright的脚本，请参考[playwright API](https://playwright.dev/docs/api/class-playwright)。

```ts
import { test, expect } from 'browser-playwright'

test('弹窗的事件', async ({ page }) => {
  const content = page.locator('.is-message')
  await page.getByRole('button', { name: '点击我' }).click()
  await expect(content).toHaveText(/点击事件触发了/)
})
```

`browser-playwright 库`移除了`chromium.launch` / `Browser` / `BrowserServer`等对象，且不支持配置playwright那一套东西了。 Page对象即当前执行的页面对象，它就是顶层对象了。 

库的默认超时时间统一修改为 `5秒`，你可以自定义超时时间：

```ts
// page的操作超时，可以通过初始化设置，也可以调用 setDefaultTimeout 设置
const page = createPage({ timeout: 1000 });
page.setDefaultTimeout(1000)

// expect的等待超时,通过方法的最后一个参数ExpectOptions 来设置
await expect(locator).toHaveCount(1, { timeout: 1000 });

```

`browser-playwright 库` 增加了 runScript 函数，它无框架依赖：接收Playwright脚本后，按语句边界步进，并暴露播放控制。详见底部的 runScript 小节。如果你需要在Vue的前端项目中运行Playwright脚本，
可以安装 `browser-playwright-vue`, 它暴露一个`BrowserPlaywrightDebugger`组件，可以直接集成在页面。详见： [browser-playwright-vue](https://www.npmjs.com/package/browser-playwright-vue)

## 设计目标：

| 目标 | 说明 |
|------|------|
| API 对齐 | Locator、断言、鼠标键盘、evaluate 等用法尽量与官方一致 |
| 页内执行 | 不启动浏览器；`page` 绑定当前 `window` / `document` |
| 真实事件序列 | 点击等操作按浏览器真实顺序合成（pointer → mouse → click） |
| Role 查询 | 基于 DOM / ARIA 计算，移植官方页内选择器实现 |
| 真实定时器 | 使用 `setTimeout` 等，不模拟 Clock |
| 可嵌入 | 配合 `runScript` 或 Vue 调试组件，在业务页里跑测试脚本 |

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
| `page.evaluate` / `locator.evaluate` | 跨进程序列化 | 同 realm 直接执行；可直接操作 DOM，无需序列化。`locator.evaluate` 将匹配元素作为首参传入 |
| `locator.boundingBox` | 相对页面坐标系 | 基于 `getBoundingClientRect`（视口坐标）；不可见时返回 `null` |
| `page.addInitScript` | 每次导航前注入 | 立即执行；并在 `hashchange` / `popstate` 上尽量重跑。不支持 `{ path }`，请用函数或 `content` |
| `page.on(...)` | 多种页面事件 | 当前支持 `console`、`pageerror`（挂 console hook / `error` / `unhandledrejection`） |
| `page.route` | CDP Fetch，覆盖导航与多数请求 | 仅拦截 `fetch` 与 `XMLHttpRequest`；**不覆盖**文档导航、`<img>`/`<script>`、Service Worker、WebSocket |
| `page.screenshot` / `locator.screenshot` | CDP 像素截图 | DOM → canvas（SVG foreignObject）；无 canvas 时退化为 HTML fingerprint。像素**不承诺**与官方一致 |
| `locator.ariaSnapshot` / `toMatchAriaSnapshot` | 完整 ARIA 树 + refs | 降级为 role/name YAML 片段；不承诺与官方树一致 |
| `locator.dragTo` / `page.dragAndDrop` | CDP 拖拽 | 合成 mousedown/drag/drop/mouseup，非完整 HTML5 DnD |
| `page.setViewportSize` / `emulateMedia` | 浏览器级 | 尽力改写；matchMedia / 真实视口可能无效 |
| `expect(...).toHaveScreenshot` | 文件基线 + 像素比对 | 内存基线 + 字节/哈希比对；首次命名调用会建立基线并视为通过 |
| `test` | Playwright Test Runner | 轻量注册表：`test()` 注册，`runTests()` / `runScript` 执行；fixture 仅 `{ page }` |
| `FrameLocator` | 可进任意 frame | 同源 iframe 优先；跨域受限 |

### 显式不支持（调用即抛错）

依赖 Browser / CDP / Inspector 的 API 已挂在 `Page` 上，但会抛出 `not supported in-page`， page上的许多方案，官方已标记为`废弃`,统一没有适配：

`page.$` / `$$` / `$eval` / `$$eval`、`context`、`opener`、`bringToFront`、`pdf`、`video`、`workers`、`pause`、`pickLocator`、`cancelPickLocator`、`requestGC`、`requests`、`routeFromHAR`、`routeWebSocket`、`setExtraHTTPHeaders`、`addLocatorHandler`、`removeLocatorHandler`、`exposeBinding`、`waitForRequest`、`waitForResponse`。

`page.close()` 仅标记关闭并拆除事件 hook，不关闭真实浏览器标签。

### 对齐较好的部分

- **查询**：`locator`、`getByRole` / `getByText` / `getByTestId` / `getByLabel` / `getByPlaceholder` / `getByAltText` / `getByTitle`、`filter`、`first` / `nth` / `last`、`and` / `or`、`describe` / `description`
- **读取**：`count`、`all` / `allInnerTexts` / `allTextContents`、`innerText` / `innerHTML` / `textContent`、`inputValue`、`getAttribute`、`evaluate` / `evaluateAll` / `evaluateHandle`、`boundingBox`、`ariaSnapshot`、`screenshot`、状态查询（`isVisible` / `isEditable` / `isChecked` 等）
- **动作**：`click`、`dblclick`、`hover`、`fill`、`clear`、`type` / `pressSequentially`、`press`、`check` / `uncheck` / `setChecked`、`selectOption`、`selectText`、`focus` / `blur`、`tap`、`dispatchEvent`、`scrollIntoViewIfNeeded`、`setInputFiles`、`dragTo`（带 auto-wait）
- **Page 快捷方法**：上述 selector 版快捷方法（`page.click` / `fill` / `isVisible`…）以及 `title` / `url` / `content` / `setContent` / `waitFor*` / `exposeFunction` / `addScriptTag` / `addStyleTag` 等
- **点击事件顺序**：`pointerdown` → `mousedown` → `pointerup` → `mouseup` → `click`
- **断言**：Locator 断言全集（含 `toHaveRole`、`toHaveClass`、`toBeInViewport`、`toMatchAriaSnapshot` 等），带轮询重试；支持 `.not`
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
| `startRecording` | 页内录制用户操作，生成 `test(...)` 脚本 |
| `generateLocator` / `generateScript` | 从 Element / 动作列表生成定位器与脚本 |
| `Page` | 页面类 |
| `createPage` | 创建绑定当前文档的 `Page` |
| `Locator` | 定位器类 |
| `FrameLocator` | iframe 定位器 |
| `setTestIdAttribute` / `getTestIdAttribute` | 自定义 test id 属性名（默认 `data-testid`） |
| `Route` / `Request` / `NetworkManager` | 网络拦截相关 |
| `screenshotElement` / `screenshotPage` | 底层截图工具 |
| `hashBytes` / `clearScreenshotBaselines` | 截图哈希与清空内存基线 |

### 类型

`ByRoleOptions`、`ExactOptions`、`LocatorOptions`、`PageOptions`、`ConsoleMessage`、`URLMatch`、`RouteHandlerCallback`、`RouteFulfillOptions`、`RouteContinueOptions`、`RouteHeaders`、`ScreenshotOptions`、`RunScriptController`、`RunScriptOptions`、`StepEvent`、`TestFixtures`、`TestInfo`、`TestResult`、`RecordedAction`、`RecorderOptions`、`RecorderController`、`AssertKind`。

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
const tag = await page.locator('h1').evaluate((el) => el.tagName)
const box = await page.locator('h1').boundingBox() // { x, y, width, height } | null

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
await expect(page.locator('input')).toBeEditable()
await expect(page.locator('input')).toBeFocused()
await expect(page.locator('input')).toBeEmpty()
await expect(page.locator('.card')).toBeInViewport()
await expect(page.locator('.row')).toHaveClass(/selected/)
await expect(page.locator('.row')).toContainClass('selected')
await expect(page.locator('.box')).toHaveCSS('display', 'flex')
await expect(page.locator('#lastname')).toHaveId('lastname')
await expect(page.locator('.x')).toHaveJSProperty('hidden', false)
await expect(page.getByRole('button')).toHaveRole('button')
await expect(page.locator('select')).toHaveValues(['a', 'b'])
await expect(page.getByRole('button')).toHaveAccessibleName('提交')
await expect(page.locator('body')).toMatchAriaSnapshot(`- main`)
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

无框架依赖：把 Playwright 风格脚本当作字符串执行，按语句边界步进，并暴露播放控制。`play()` 时每个检查点之后默认等待 `stepDelay`（100ms）；暂停 / 单步不生效，传 `0` 关闭。

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
  stepDelay: 100, // 播放模式下每个检查点之后的间隔（ms）；暂停 / 单步不生效，0 关闭
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

### 录制 / Recorder

页内等价于官方 `codegen`：在当前文档捕获**真实用户操作**（`isTrusted`），生成可直接交给 `runScript` 的脚本。不依赖 Node / CDP。

```ts
import { startRecording, runScript } from 'browser-playwright'

const rec = startRecording({
  testTitle: '弹窗流程',
  onUpdate: (script) => console.log(script),
})

// 用户在页面上点击 / 输入 …
// 悬停时会高亮元素并显示候选 locator

rec.setAssertMode(true)              // 下次点击 → expect(...).toBeVisible()
rec.setAssertMode(true, 'toHaveText') // 或 toHaveText

rec.pause()
rec.resume()

const { script, actions } = rec.stop()
await runScript(script, { autoPlay: true }).result
```

生成形态固定为：

```ts
import { test, expect } from 'browser-playwright'

test('弹窗流程', async ({ page }) => {
  await page.getByRole('button', { name: '打开带事件弹窗' }).click()
  await expect(page.getByTestId('modal-message')).toBeVisible()
})
```

| 能力 | 说明 |
|------|------|
| 动作 | click / dblclick / fill（防抖合并）/ selectOption / check / uncheck / press(Enter\|Tab\|Escape) |
| 断言模式 | `setAssertMode(true)` 后点击生成 `expect` |
| Locator | 优先 role → testid → label/placeholder → text → CSS |
| 忽略 UI | `[data-bpw-ui]` 及其子树不录制（调试面板自带） |
| 与官方差异 | 无 CLI；无跨标签页；合成回放事件仍为 `isTrusted=false` |

也可单独使用：

```ts
import { generateLocator, generateScript } from 'browser-playwright'

const locator = generateLocator(document.querySelector('button')!)
const script = generateScript([{ kind: 'click', locator }])
```

Vue 场景请用 `browser-playwright-vue` 的 Record / Assert / 编辑面板。

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
| `browser-playwright`（本包） | 页内 API + `runScript` + `startRecording` |
| `browser-playwright-vue` | 浮动 Inspector（录制 / 编辑 / 回放） |
| `apps/site` | monorepo 内演示与验收 |

更多仓库约定见仓库根目录 [`AGENT.md`](../../../AGENT.md)。
