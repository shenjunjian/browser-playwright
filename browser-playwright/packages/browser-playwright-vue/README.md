# browser-playwright-vue

面向 Vue 3 的**页内 Playwright 调试组件**。在业务页面右下角挂载浮动面板，把一段 Playwright 风格脚本交给 `browser-playwright` 的 `runScript` 执行，支持播放 / 暂停 / 单步 / 停止，并展示逐步高亮与测试结果。

## 目的

`browser-playwright`（core）提供页内 API 与无框架的 `runScript`。本包在其上提供可视化调试壳：

| 目标 | 说明 |
|------|------|
| 页面级调试 | 不启动 Node Playwright；脚本在当前业务页里跑 |
| 悬浮 UI | `Teleport` 到 `body`，固定右下角，不侵入业务布局 |
| 播放控制 | 播放、暂停、单步、停止，对应 `runScript` 控制器 |
| 源码同步 | 展开后按行高亮当前语句，失败步骤可回溯 |
| 结果汇总 | 结束后展示 passed / failed / skipped 与各 `test()` 用例状态 |

典型场景：在 Vue 工程里挂上调试条，把已有 Playwright 风格脚本当字符串传入，边看页面边逐步验收。

## 安装与构建

依赖：

- Vue `^3.5`（peer）
- `browser-playwright`（workspace / 同版本 core）

在 monorepo 内：

```bash
cd browser-playwright
pnpm install
pnpm --filter browser-playwright-vue build
```

产物：

| 文件 | 说明 |
|------|------|
| `dist/browser-playwright-vue.js` | ESM 组件 |
| `dist/index.d.ts` | 类型声明 |
| `dist/browser-playwright-vue.css` | 组件样式（需单独引入） |

## 快速接入

```ts
// 例如 App.vue
import { BrowserPlaywrightDebugger } from 'browser-playwright-vue'
import 'browser-playwright-vue/style.css'
```

```vue
<script setup lang="ts">
import { BrowserPlaywrightDebugger } from 'browser-playwright-vue'
import 'browser-playwright-vue/style.css'

const script = `import { test, expect } from 'browser-playwright'

test('弹窗的事件', async ({ page }) => {
  page.on('pageerror', (exception) => expect(exception).toBeNull())
  await page.goto('modal#modal-event')
  const content = page.locator('.is-message')
  await page.getByRole('button', { name: '打开带事件弹窗' }).first().click()
  await expect(content).toHaveText(/show 事件触发了/)
})
`
</script>

<template>
  <!-- 业务页面 … -->
  <BrowserPlaywrightDebugger :script="script" />
</template>
```

演示站 `apps/site` 即按此方式挂载；本地可 `pnpm dev` 打开页面右下角面板试用。

## Props

| Prop | 类型 | 默认 | 说明 |
|------|------|------|------|
| `script` | `string` | （必填） | Playwright 风格脚本全文。变更后会重新 `runScript` |
| `autoPlay` | `boolean` | `false` | 为 `true` 时挂载 / 脚本变更后自动连续执行；默认需点「播放」或「单步」 |

导出：

```ts
import BrowserPlaywrightDebugger from 'browser-playwright-vue'
// 或
import { BrowserPlaywrightDebugger } from 'browser-playwright-vue'
```

## 界面与操作

面板通过 `Teleport` 挂到 `document.body`，`z-index` 极高，避免被业务遮挡。

### 折叠条（默认）

- 状态点 + 当前语句摘要（Ready / 运行中文案 / Paused / Failed / 完成汇总）
- 点击摘要区域：展开或收起源码面板
- 右侧工具栏：

| 按钮 | 行为 |
|------|------|
| 播放 | 连续执行；若已结束或无控制器则重新开跑并播放 |
| 暂停 | 停在下一检查点（`controller.pause()`） |
| 单步 | 执行下一步；结束后同样可重新开跑再单步 |
| 停止 | `stop()`，结束本次运行 |

### 展开面板

- **源码区**：按行展示 `script`，当前行高亮（running / paused / failed / passed）
- **结果**：`passed · failed · skipped · N tests`，以及每个 `test()` 的 `status · title · duration`
- **失败步骤**：步进失败时记录行号与错误信息

状态色：绿 = 通过，红 = 失败，黄 = 暂停，蓝 = 运行中。

## 与 `runScript` 的关系

组件内部调用 core 的 `runScript(script, { autoPlay, onStep })`：

```ts
import { runScript } from 'browser-playwright'

const ctrl = runScript(props.script, {
  autoPlay: props.autoPlay,
  onStep: (e) => {
    // e.line, e.status: 'running' | 'passed' | 'failed' | 'paused'
    // e.message? 失败时有错误信息
  },
})

ctrl.play()
ctrl.pause()
ctrl.step()
ctrl.stop()
await ctrl.result // TestResult
```

脚本内可使用注入的 `test`、`expect`、`page`（与 core README 中 `runScript` 说明一致）。信任模型与 `eval` 相同：只应传入调用方明确可控的脚本。

`script` 或 `autoPlay` 变化时组件会停止旧控制器并重新 `startRun()`。卸载时自动 `stop()`。

## 样式

务必引入包样式，否则浮动条无布局与配色：

```ts
import 'browser-playwright-vue/style.css'
```

样式为组件 `scoped` 产物；根节点 class 前缀为 `bpw-`（如 `bpw-root`、`bpw-bar`）。若需覆盖主题，可在业务里针对这些类写更高优先级规则，或后续再扩展 CSS 变量覆盖方式。

当前内置 CSS 变量（组件根上）：

| 变量 | 用途 |
|------|------|
| `--bpw-primary` | 主色 / 运行中 |
| `--bpw-bg` / `--bpw-bg-elevated` | 面板背景 |
| `--bpw-text` / `--bpw-muted` | 正文 / 次要文字 |
| `--bpw-passed` / `--bpw-failed` / `--bpw-paused` | 状态色 |

## 使用注意

1. **环境**：在浏览器里的 Vue 3 应用中使用；不是 Node 端 Playwright UI。
2. **脚本能力边界**：与 `browser-playwright` 相同——页内导航、合成事件、`fetch`/`XHR` 拦截等，详见 [core README](../core/README.md)。
3. **安全**：`script` 会被执行；勿拼接不可信用户输入。
4. **样式引入**：忘记 `style.css` 时面板几乎不可见或错位。
5. **业务页面**：脚本操作的是当前真实 DOM；请保证演示页上有对应按钮、文案、路由等目标。

## 相关包

| 包 | 职责 |
|----|------|
| `browser-playwright` | 页内 API + `runScript` |
| `browser-playwright-vue`（本包） | 浮动调试 UI |
| `apps/site` | monorepo 演示与验收 |

更多仓库约定见仓库根目录 [`AGENT.md`](../../../AGENT.md)。
