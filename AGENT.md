# AGENT.md — browser-playwright 开发规范

## 仓库结构

```
browser-playwright/                 # 仓库根（本文件所在处）
├── AGENT.md                        # 本规范（Agent / 开发者必读）
├── README.md                       # 产品目标
├── playwright-main/                # Playwright 官方源码快照（只读参考）
└── browser-playwright/             # 工程 monorepo（pnpm + Vite+，根包名 browser-playwright-monorepo）
    ├── apps/site                   # 演示与验收：core + runScript + Vue 组件
    ├── packages/core               # 包名 browser-playwright：页内 API + runScript
    └── packages/browser-playwright-vue
```

> 注意：monorepo 根 `package.json` 的 `name` 必须是 `browser-playwright-monorepo`，避免与 `packages/core` 的发布名 `browser-playwright` 冲突。

## 硬性约束

1. **禁止修改** `playwright-main/` 内任何文件。只可读、可移植思路与算法。
2. **不实现** Browser / BrowserServer / launch / CDP 会话。库运行在页面内，`page` 绑定当前 `window`/`document`。
3. **不实现** 模拟 Clock；一律使用真实 `setTimeout` / `setInterval` / `requestAnimationFrame`。
4. API 表面（Locator、断言、鼠标键盘、evaluate 等）应与官方 Playwright **用法对齐**；内部实现可为页内适配。
5. 业务代码落在 `browser-playwright/` monorepo；不要在仓库根另起平行源码树。

## 包职责

| 路径 | npm 名 | 职责 |
|------|--------|------|
| `packages/core` | `browser-playwright` | Page / Locator / expect / test / `runScript` |
| `packages/browser-playwright-vue` | `browser-playwright-vue` | 浮动调试 UI，驱动 `runScript` |
| `apps/site` | `site` | 嵌入式验收与演示，不发布 |

- `core` 无框架依赖。
- `browser-playwright-vue` 将 `vue` 作为 peerDependency，并将 `browser-playwright` 设为 workspace 依赖。
- 对外导入示例：`import { test, expect, runScript } from 'browser-playwright'`。

## 实现原则

### 选择器与 Role

- 优先移植 / 改编官方页内实现：`playwright-main/packages/injected`、`packages/isomorphic`（如 `roleUtils`、`roleSelectorEngine`、`consoleApi`）。
- Role 信息应通过 DOM / ARIA 计算获得，**不要**依赖浏览器扩展或 CDP。
- 仅当完整 ARIA 算法短期无法落地时，才允许临时用标签名 / 属性启发式，并在代码注释标明差距。

### 输入事件

- 鼠标点击等操作必须按接近真实浏览器的顺序合成，例如：
  `pointerdown` → `mousedown` → `pointerup` → `mouseup` → `click`。
- 参考：`playwright-main/packages/injected/src/webview/webViewInput.ts`。
- 合成事件 `isTrusted === false` 是预期限制；不要伪造可信输入。

### 网络与截图（能力边界）

- `page.route` / `unroute` / `unrouteAll`：拦截 `fetch` 与 `XMLHttpRequest`；支持 `Route.fulfill` / `abort` / `continue`。
- **不覆盖**：文档导航、`<img>`/`<script>` 等标签请求、Service Worker、WebSocket，以及完整 CDP Fetch 栈。
- `page.screenshot` / `locator.screenshot`：DOM→canvas（SVG foreignObject）；无 canvas 时退化为 HTML fingerprint。
- `expect(locator).toHaveScreenshot(name)`：内存基线 + 字节/哈希比对；**不承诺**与官方 CDP 像素一致。

### Page / Locator / expect API 对齐

- 应对齐官方非 Deprecated 的 Page / Locator / LocatorAssertions 方法表面。
- 依赖 Browser / CDP / Inspector 的方法应存在但抛出明确的 `not supported in-page`（见 `packages/core/src/unsupported.ts`）。
- 页内可实现的方法优先 DOM / 同 realm 实现；行为不完全等同官方的需在 README 标明降级。

### `page.goto`

- 页内场景解释为同应用路由 / hash / `location` 导航，而非跨进程打开新浏览器页。

### `runScript`

- 无框架依赖；接收脚本字符串，支持逐步执行并向前端发射步骤事件。
- 脚本与 `eval` 同信任模型：仅执行调用方显式传入的内容。

## 工程约定

- 包管理与脚本：在 `browser-playwright/` 下使用 `pnpm` / `vp`（Vite+）。
- 安装依赖：`vp install` 或 `pnpm install`。
- 本地演示：`pnpm dev` / `vp run site#dev`（根脚本已指向 `site`，不是 `website`）。
- 全量校验：`pnpm ready`（check + test + build）。
- 库包以 Vite `build.lib` 产出 ESM；类型用 `tsc` / `vue-tsc` 生成到 `dist/`。
- `apps/site` 开发期可通过 Vite alias 直连 packages 的 `src`，便于 HMR。
- 新增公开 API 时同步更新本文件与包内导出（`src/index.ts`）。

## 代码风格

- TypeScript strict；优先具名导出。
- 不引入与目标无关的依赖；能移植官方页内逻辑时不要重复造选择器轮子。
- 注释只解释非显而易见的限制或与官方行为的差异。
- 不要提交密钥、`.env` 实值，或对 `playwright-main` 的改动。

## 推荐参考路径（只读）

- 输入：`playwright-main/packages/injected/src/webview/webViewInput.ts`
- Role：`.../roleUtils.ts`、`roleSelectorEngine.ts`
- Locator 页内原型：`.../consoleApi.ts`
- expect 页内比较：`.../injectedScript.ts`
- API 形状：`playwright-main/packages/playwright-core/src/client/{page,locator}.ts`
