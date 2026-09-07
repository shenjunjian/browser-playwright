# browser-playwright-vue

面向 Vue 3 的**页内 Playwright Inspector**。在业务页面右下角挂载浮动面板，支持：

- 把 Playwright 风格脚本交给 `runScript` **播放 / 暂停 / 单步**
- **Record** 录制真实用户操作，生成带 `test()` 包装的脚本
- **Assert** 模式点击元素追加 `expect`
- **编辑** 源码后直接回放

## 目的

`browser-playwright`（core）提供页内 API、`runScript` 与 `startRecording`。本包在其上提供可视化壳：

| 目标 | 说明 |
|------|------|
| 页面级调试 | 不启动 Node Playwright；脚本在当前业务页里跑 |
| 录制 codegen | 监听可信用户事件，生成可回放脚本 |
| 悬浮 UI | `Teleport` 到 `body`，固定右下角；根节点带 `data-bpw-ui` 避免录到自己 |
| 播放控制 | 播放、暂停、单步、停止 |
| 可编辑源码 | 展开后可在「预览 / 编辑」间切换 |

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
import { BrowserPlaywrightDebugger } from 'browser-playwright-vue'
import 'browser-playwright-vue/style.css'
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
  <!-- 业务页面 … -->
  <BrowserPlaywrightDebugger v-model:script="script" />
</template>
```

演示站 `apps/site` 即按此方式挂载；本地可 `pnpm dev` 打开页面右下角面板试用。

## Props / Events

| Prop | 类型 | 默认 | 说明 |
|------|------|------|------|
| `script` | `string` | 空骨架 `test('recorded'…)` | 初始脚本；变更会重新准备回放 |
| `autoPlay` | `boolean` | `false` | 为 `true` 时挂载 / 脚本变更后自动连续执行 |
| `stepDelay` | `number` | `100` | 播放模式下每步检查点之后的间隔（毫秒）；面板不展示该控件，传 `0` 关闭 |

| Event | 说明 |
|-------|------|
| `update:script` | 录制更新或用户编辑时同步脚本（支持 `v-model:script`） |

导出：

```ts
import BrowserPlaywrightDebugger from 'browser-playwright-vue'
// 或
import { BrowserPlaywrightDebugger } from 'browser-playwright-vue'
```

## 界面与操作

面板通过 `Teleport` 挂到 `document.body`，`z-index` 极高，避免被业务遮挡。根节点带 `data-bpw-ui`，录制时忽略面板自身。

### 折叠条（默认）

- 状态点 + 当前摘要（Ready / Recording / 运行中 / Paused / Failed / 完成汇总）
- 点击摘要区域：展开或收起源码面板
- 右侧工具栏：

| 按钮 | 行为 |
|------|------|
| 红点 Record | 开始 / 停止录制；录制时悬停高亮 locator，点击写入脚本 |
| 录制动作 | 下拉选择：点击 / 断言可见（`toBeVisible`）/ 断言文本（`toHaveText`） |
| 播放 | 连续执行当前脚本 |
| 暂停 | 回放暂停，或录制暂停捕获 |
| 单步 | 执行下一步 |
| 停止 | 结束回放，或停止录制并保留脚本 |

### 展开面板

- **预览**：按行展示脚本，当前行高亮
- **编辑**：`<textarea>` 直接改脚本，可再点播放验收
- **结果**：`passed · failed · skipped` 与各 `test()` 状态
- **失败步骤**：步进失败时的行号与错误

## 录制 → 回放闭环

1. 点红点开始 Record
2. 在业务页操作（可选打开 Assert 再点元素加断言）
3. 再点红点停止；脚本已写入面板
4. 点播放用 `runScript` 回放

底层 API 见 [core README · 录制 / Recorder](../core/README.md)。

## 与 `runScript` / `startRecording` 的关系

```ts
import { runScript, startRecording } from 'browser-playwright'

// 回放
const ctrl = runScript(script, { autoPlay, stepDelay, onStep })

// 录制
const rec = startRecording({
  onUpdate: (script) => { /* 写入面板 */ },
})
rec.setAssertMode(true)
rec.stop()
```

信任模型与 `eval` 相同：只应传入调用方明确可控的脚本。

## 样式

务必引入包样式：

```ts
import 'browser-playwright-vue/style.css'
```

根节点 class 前缀为 `bpw-`。内置 CSS 变量：

| 变量 | 用途 |
|------|------|
| `--bpw-primary` | 主色 / 运行中 |
| `--bpw-record` | 录制红点 |
| `--bpw-bg` / `--bpw-bg-elevated` | 面板背景 |
| `--bpw-text` / `--bpw-muted` | 正文 / 次要文字 |
| `--bpw-passed` / `--bpw-failed` / `--bpw-paused` | 状态色 |

## 使用注意

1. **环境**：在浏览器里的 Vue 3 应用中使用；不是 Node 端 Playwright UI。
2. **脚本能力边界**：与 `browser-playwright` 相同，详见 [core README](../core/README.md)。
3. **安全**：`script` 会被执行；勿拼接不可信用户输入。
4. **样式引入**：忘记 `style.css` 时面板几乎不可见或错位。
5. **录制忽略**：业务侧若有浮动工具条不想被录，也可加 `data-bpw-ui`。

## 相关包

| 包 | 职责 |
|----|------|
| `browser-playwright` | 页内 API + `runScript` + `startRecording` |
| `browser-playwright-vue`（本包） | 浮动 Inspector UI |
| `apps/site` | monorepo 演示与验收 |

更多仓库约定见仓库根目录 [`AGENT.md`](../../../AGENT.md)。
