# FlowAgent M5 UI 重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** renderer 全量迁移到 Codex 风格双主题设计系统（Tailwind v4 语义 token），M2–M4 行为零回归。

**Architecture:** 单一 token 源（`themes.ts` 色板 → `index.css` @theme CSS variables + `[data-theme]` 覆盖），`theme-store`（zustand）驱动 html 属性、Monaco、xterm、原生标题栏四处联动；14 个组件去 inline style 换 utilities；main 侧仅加 titleBarOverlay 与一条 IPC。

**Tech Stack:** Tailwind v4（`@tailwindcss/vite`）、lucide-react、既有 React 19 + zustand + electron-vite 4 / Vite 7 / Electron 39。

**Spec:** `docs/superpowers/specs/2026-10-03-flowagent-m5-ui-redesign-design.md`（执行者必须同时读 spec 与本计划）

## Global Constraints

- 组件代码（`.tsx`）禁止裸色值：无 hex、无 `rgb()`、无具名 CSS 颜色；颜色一律语义 token utilities（`bg-surface-1`、`text-ink` 等）。色板 hex 只允许出现在 `themes.ts`、`index.css`、`packages/main/src/index.ts`（titleBarOverlay 初值）。
- 三栏骨架、折叠行为、store/IPC 既有契约全部不变；唯一新 IPC：`fa:chrome:set-theme`。
- 间距只用 Tailwind 内置 4px 刻度；圆角 `rounded-md`(6px)/`rounded-lg`(8px)；过渡 150ms。
- UI 文案维持中文；commit 用 conventional commits；每个 Task 结束时 `pnpm -r test` 必须全绿（基线 132 + 新增）。
- 新依赖仅三个：`tailwindcss` + `@tailwindcss/vite`（加到 `packages/main`，构建编排方）、`lucide-react`（`packages/renderer`）。pnpm 隔离布局下 `electron.vite.config.ts` 在 main 包内，插件依赖必须声明在 main。
- Windows 环境：agent 执行命令用 pwsh；工作目录 `E:\projects\flowagent`；分支 `feat/m5-ui-redesign`（Task 0 创建，完成后本地合 master 推送）。
- 单所有者工作区规则：任务严格串行执行，不并行派发实施者。

## Review Focus

1. **亮色主题漏色**（.tsx 残留 hex / style 属性硬编码颜色）→ Task 3 卫兵测试 + 每 Task 从 allowlist 移除已迁移文件，Task 10 清空断言。
2. **切主题时 Monaco/xterm 不跟随**（编辑器仍暗底）→ Task 7 xterm options.theme 联动、Task 9 defineTheme+setTheme 联动，各有验收步骤。
3. **localStorage 非法主题值**（手改成 `darkk`/null）→ `resolveStoredTheme` 兜底 dark，Task 2 单测覆盖三种非法输入。
4. **setTitleBarOverlay 抛错**（平台不支持/窗口已销毁）→ ipc handler try/catch 静默 + preload `.catch(() => {})`，Task 2 代码即含。
5. **会话下拉迁移后行为回归**（running 禁用/删除确认/浮层外点关闭/新会话切换）→ Task 4 验收清单逐契约核对（M4 spec §4.3 契约 1–8）。

---

### Task 0: 建分支

**Files:** 无（git 操作）

- [ ] **Step 1: 从 master 创建分支**

```bash
git -C E:\projects\flowagent checkout -b feat/m5-ui-redesign master
```

- [ ] **Step 2: 确认基线**

Run: `pnpm -r test`（在 E:\projects\flowagent）
Expected: 132/132 通过

---

### Task 1: 依赖与 token 基座（Tailwind 接入 + index.css + 字体）

**Files:**
- Modify: `packages/main/package.json`（devDeps + 1：`@tailwindcss/vite`、`tailwindcss`）
- Modify: `packages/renderer/package.json`（deps + 1：`lucide-react`）
- Modify: `packages/main/electron.vite.config.ts:12`（renderer.plugins 加 tailwindcss()）
- Create: `packages/renderer/src/index.css`
- Modify: `packages/renderer/src/main.tsx`（顶部 `import './index.css'`）
- Modify: `packages/renderer/index.html`（无实质改动；body 样式由 index.css 全量接管）

**Interfaces:**
- Produces: 全局 utilities 集（`bg-surface-0..3`、`text-ink`、`text-ink-secondary`、`text-ink-faint`、`border-border-subtle`、`border-border`、`bg-accent`、`text-on-accent`、`bg-success/danger/warning/diff-added/diff-removed`、`font-ui`、`font-mono`），后续所有任务消费。默认主题=dark；`html[data-theme="light"]` 切换。

- [ ] **Step 1: 安装依赖**

```bash
cd E:\projects\flowagent
pnpm --filter main add -D tailwindcss @tailwindcss/vite
pnpm --filter renderer add lucide-react
```

- [ ] **Step 2: electron.vite.config.ts renderer 段接入插件**

```ts
import tailwindcss from '@tailwindcss/vite'
// ...
  renderer: {
    root: '../renderer',
    plugins: [react(), tailwindcss()],
    // build 段不变
  },
```

- [ ] **Step 3: 创建 index.css（完整内容）**

```css
@import "tailwindcss";

@theme {
  --color-surface-0: #0e0f11;
  --color-surface-1: #16181b;
  --color-surface-2: #1d2023;
  --color-surface-3: #25292d;
  --color-border-subtle: #26292d;
  --color-border: #33373c;
  --color-ink: #ececf1;
  --color-ink-secondary: #a5a9b3;
  --color-ink-faint: #6b7078;
  --color-accent: #7da2f7;
  --color-accent-hover: #9db9f9;
  --color-text-on-accent: #ffffff;
  --color-success: #4cc38a;
  --color-danger: #ef6b7d;
  --color-warning: #e0a458;
  --color-diff-added: #3fb27f;
  --color-diff-removed: #e5617c;
  --font-ui: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  --font-mono: 'Cascadia Code', Consolas, 'PingFang SC', 'Microsoft YaHei', monospace;
}

:root[data-theme='light'] {
  --color-surface-0: #ffffff;
  --color-surface-1: #f7f7f8;
  --color-surface-2: #f0f1f2;
  --color-surface-3: #e8e9eb;
  --color-border-subtle: #e8e9eb;
  --color-border: #d5d7da;
  --color-ink: #1a1c1f;
  --color-ink-secondary: #565b64;
  --color-ink-faint: #8a9099;
  --color-accent: #3358d4;
  --color-accent-hover: #2747b8;
  --color-text-on-accent: #ffffff;
  --color-success: #1c7c4d;
  --color-danger: #c03550;
  --color-warning: #8f6a2f;
  --color-diff-added: #1a7f4b;
  --color-diff-removed: #b3364e;
}

/* 基础层 */
html, body, #root { height: 100%; }
body {
  margin: 0;
  background: var(--color-surface-0);
  color: var(--color-ink);
  font-family: var(--font-ui);
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
}

/* 滚动条/选区/焦点环（全局细化） */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: var(--color-surface-3); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--color-border); }
::-webkit-scrollbar-track { background: transparent; }
::selection { background: color-mix(in srgb, var(--color-accent) 25%, transparent); }
:focus-visible { outline: 2px solid color-mix(in srgb, var(--color-accent) 50%, transparent); outline-offset: -1px; }

/* markdown（.fa-md 挂在 assistant 文本容器上） */
.fa-md { line-height: 1.65; }
.fa-md > :first-child { margin-top: 0; } .fa-md > :last-child { margin-bottom: 0; }
.fa-md p { margin: 0.5em 0; }
.fa-md h1, .fa-md h2, .fa-md h3, .fa-md h4 { margin: 0.9em 0 0.4em; font-weight: 600; line-height: 1.3; }
.fa-md h1 { font-size: 1.25em; } .fa-md h2 { font-size: 1.15em; } .fa-md h3 { font-size: 1.05em; }
.fa-md ul, .fa-md ol { margin: 0.5em 0; padding-left: 1.4em; }
.fa-md li { margin: 0.15em 0; }
.fa-md a { color: var(--color-accent); text-decoration: underline; }
.fa-md code {
  font-family: var(--font-mono); font-size: 0.85em;
  background: var(--color-surface-0); border: 1px solid var(--color-border-subtle);
  border-radius: 4px; padding: 0.1em 0.35em;
}
.fa-md pre {
  background: var(--color-surface-0); border: 1px solid var(--color-border-subtle);
  border-radius: 8px; padding: 10px 12px; overflow-x: auto; margin: 0.6em 0;
}
.fa-md pre code { background: none; border: none; padding: 0; font-size: 12px; }
.fa-md table { border-collapse: collapse; margin: 0.6em 0; }
.fa-md th, .fa-md td { border: 1px solid var(--color-border-subtle); padding: 4px 10px; }
.fa-md blockquote { margin: 0.6em 0; padding-left: 0.8em; border-left: 2px solid var(--color-border); color: var(--color-ink-secondary); }

/* 运行呼吸点（.fa-dots 容器内三个 .fa-dot，Task 8 使用） */
@keyframes fa-breathe { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
.fa-dot { width: 4px; height: 4px; border-radius: 9999px; background: var(--color-ink-secondary); animation: fa-breathe 1.5s infinite ease-in-out; }
.fa-dot:nth-child(2) { animation-delay: 0.2s; }
.fa-dot:nth-child(3) { animation-delay: 0.4s; }

/* 文件树/菜单 hover（从组件 <style> 注入迁移至此） */
.fa-tree-row:hover, .fa-sess-row:hover { background: var(--color-surface-3); }
.fa-sess-del { opacity: 0; } .fa-sess-row:hover .fa-sess-del { opacity: 1; }

/* lucide 图标默认尺寸对齐 */
svg.lucide { width: 14px; height: 14px; }
```

- [ ] **Step 4: main.tsx 顶部引入 CSS；index.html body 样式**

`packages/renderer/src/main.tsx` 第一行（在其它 import 之前）加 `import './index.css'`。index.html 不改（body 样式由 index.css 接管）。

- [ ] **Step 5: 验证构建与基线**

Run: `pnpm -r test`
Expected: 132/132 通过（CSS 不影响测试）
Run: `pnpm --filter main dev`（手动起一次，窗口出现暗色背景、默认字体生效后关闭）
Expected: 窗口整体深灰底、无白边；控制台无 CSS/构建报错

- [ ] **Step 6: Commit**

```bash
git add packages/main/package.json packages/main/electron.vite.config.ts packages/renderer/package.json packages/renderer/src/index.css packages/renderer/src/main.tsx packages/renderer/index.html pnpm-lock.yaml
git commit -m "feat(m5): add tailwind v4 design token base with dual-theme css variables"
```

---

### Task 2: themes.ts + theme-store + 标题栏联动（双主题闭环）

**Files:**
- Create: `packages/renderer/src/themes.ts`
- Create: `packages/renderer/src/theme-store.ts`
- Create: `packages/renderer/src/theme-store.test.ts`
- Modify: `packages/renderer/src/main.tsx`（渲染前 init）
- Modify: `packages/renderer/src/App.tsx`（header 右端临时主题按钮，Task 4 重排时保留）
- Modify: `packages/main/src/index.ts:44-47`（titleBarOverlay）
- Modify: `packages/main/src/ipc.ts`（新 handler）
- Modify: `packages/main/src/preload.ts`（fa.chrome）

**Interfaces:**
- Produces（后续任务消费，签名逐字）:
  - `themes.ts`: `export type ThemeVariant = 'dark' | 'light'`；`export interface Palette { surface0: string; surface1: string; surface2: string; surface3: string; borderSubtle: string; border: string; ink: string; inkSecondary: string; inkFaint: string; accent: string; accentHover: string; textOnAccent: string; success: string; danger: string; warning: string; diffAdded: string; diffRemoved: string }`；`export const PALETTES: Record<ThemeVariant, Palette>`；`export function chromeColors(v: ThemeVariant): { color: string; symbolColor: string }`；`export function xtermTheme(v: ThemeVariant): Record<string, string>`（Task 7）；`export function monacoThemeData(v: ThemeVariant): { base: 'vs-dark' | 'vs'; inherit: true; rules: { token: string; foreground: string }[]; colors: Record<string, string> }`（Task 9）
  - `theme-store.ts`: `export const THEME_STORAGE_KEY = 'fa-theme'`；`export function resolveStoredTheme(raw: string | null): ThemeVariant`；`export const useThemeStore`（zustand：`theme: ThemeVariant`、`init(): void`、`setTheme(t): void`）
  - preload: `window.fa.chrome.setTheme(c: { color: string; symbolColor: string }): Promise<void>`

- [ ] **Step 1: 写失败测试**

`packages/renderer/src/theme-store.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { PALETTES, chromeColors } from './themes.js'
import { resolveStoredTheme, THEME_STORAGE_KEY } from './theme-store.js'

describe('resolveStoredTheme', () => {
  it('合法值透传', () => {
    expect(resolveStoredTheme('dark')).toBe('dark')
    expect(resolveStoredTheme('light')).toBe('light')
  })
  it('null / 非法值兜底 dark', () => {
    expect(resolveStoredTheme(null)).toBe('dark')
    expect(resolveStoredTheme('darkk')).toBe('dark')
    expect(resolveStoredTheme('')).toBe('dark')
  })
})

describe('palette 一致性', () => {
  it('双主题 18 项全定义且 chromeColors 取 surface0/ink', () => {
    for (const v of ['dark', 'light'] as const) {
      const p = PALETTES[v]
      expect(Object.keys(p).length).toBe(18)
      for (const val of Object.values(p)) expect(val).toMatch(/^#[0-9a-f]{6}$/)
      expect(chromeColors(v)).toEqual({ color: p.surface0, symbolColor: p.ink })
    }
  })
  it('storage key 稳定', () => expect(THEME_STORAGE_KEY).toBe('fa-theme'))
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter renderer test`
Expected: FAIL（`./themes.js` 不存在）

- [ ] **Step 3: 写 themes.ts（完整内容）**

```ts
export type ThemeVariant = 'dark' | 'light'

export interface Palette {
  surface0: string; surface1: string; surface2: string; surface3: string
  borderSubtle: string; border: string
  ink: string; inkSecondary: string; inkFaint: string
  accent: string; accentHover: string; textOnAccent: string
  success: string; danger: string; warning: string; diffAdded: string; diffRemoved: string
}

// 与 index.css @theme / :root[data-theme='light'] 逐值一致（单一事实源的本体）
export const PALETTES: Record<ThemeVariant, Palette> = {
  dark: {
    surface0: '#0e0f11', surface1: '#16181b', surface2: '#1d2023', surface3: '#25292d',
    borderSubtle: '#26292d', border: '#33373c',
    ink: '#ececf1', inkSecondary: '#a5a9b3', inkFaint: '#6b7078',
    accent: '#7da2f7', accentHover: '#9db9f9', textOnAccent: '#ffffff',
    success: '#4cc38a', danger: '#ef6b7d', warning: '#e0a458',
    diffAdded: '#3fb27f', diffRemoved: '#e5617c',
  },
  light: {
    surface0: '#ffffff', surface1: '#f7f7f8', surface2: '#f0f1f2', surface3: '#e8e9eb',
    borderSubtle: '#e8e9eb', border: '#d5d7da',
    ink: '#1a1c1f', inkSecondary: '#565b64', inkFaint: '#8a9099',
    accent: '#3358d4', accentHover: '#2747b8', textOnAccent: '#ffffff',
    success: '#1c7c4d', danger: '#c03550', warning: '#8f6a2f',
    diffAdded: '#1a7f4b', diffRemoved: '#b3364e',
  },
}

export function chromeColors(v: ThemeVariant): { color: string; symbolColor: string } {
  const p = PALETTES[v]
  return { color: p.surface0, symbolColor: p.ink }
}

export function xtermTheme(v: ThemeVariant): Record<string, string> {
  const p = PALETTES[v]
  const dark = v === 'dark'
  return {
    background: p.surface0, foreground: p.ink, cursor: p.accent,
    cursorAccent: p.surface0,
    selectionBackground: dark ? '#7da2f740' : '#3358d433',
    black: dark ? '#1d2023' : '#3a3d42', red: p.danger, green: p.success,
    yellow: p.warning, blue: p.accent, magenta: dark ? '#b58cf0' : '#7a4fd1',
    cyan: dark ? '#6cc4d4' : '#2a7d8f', white: dark ? '#a5a9b3' : '#565b64',
    brightBlack: dark ? '#6b7078' : '#8a9099', brightRed: p.danger,
    brightGreen: p.success, brightYellow: p.warning, brightBlue: p.accentHover,
    brightMagenta: dark ? '#c9aaf5' : '#6641c4', brightCyan: dark ? '#93d8e5' : '#1f6675',
    brightWhite: p.ink,
  }
}

export function monacoThemeData(v: ThemeVariant): { base: 'vs-dark' | 'vs'; inherit: true; rules: { token: string; foreground: string }[]; colors: Record<string, string> } {
  const p = PALETTES[v]
  const hex = (s: string): string => s.replace('#', '')
  return {
    base: v === 'dark' ? 'vs-dark' : 'vs', inherit: true,
    rules: [
      { token: 'comment', foreground: hex(p.inkFaint), fontStyle: 'italic' },
      { token: 'string', foreground: hex(p.diffAdded) },
      { token: 'keyword', foreground: hex(p.accent) },
      { token: 'number', foreground: hex(p.success) },
      { token: 'type', foreground: hex(p.accentHover) },
      { token: 'function', foreground: hex(p.ink) },
    ],
    colors: {
      'editor.background': p.surface0,
      'editor.foreground': p.ink,
      'editorLineNumber.color': p.inkFaint,
      'editorLineNumber.activeForeground': p.inkSecondary,
      'editor.selectionBackground': v === 'dark' ? '#7da2f740' : '#3358d433',
      'editor.lineHighlightBackground': p.surface1,
      'editorIndentGuide.background1': p.surface3,
      'diffEditor.insertedTextBackground': v === 'dark' ? '#3fb27f26' : '#1a7f4b20',
      'diffEditor.removedTextBackground': v === 'dark' ? '#e5617c26' : '#b3364e20',
      'editorGutter.background': p.surface0,
    },
  }
}
```

- [ ] **Step 4: 写 theme-store.ts**

```ts
import { create } from 'zustand'
import { chromeColors, type ThemeVariant } from './themes.js'

export const THEME_STORAGE_KEY = 'fa-theme'

export function resolveStoredTheme(raw: string | null): ThemeVariant {
  return raw === 'light' ? 'light' : 'dark'
}

function applyTheme(t: ThemeVariant): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = t
  try { localStorage.setItem(THEME_STORAGE_KEY, t) } catch { /* 隐私模式等 */ }
  // 标题栏跟随；fa 在 renderer 测试环境不存在，静默跳过
  const fa = (globalThis as { fa?: { chrome?: { setTheme(c: { color: string; symbolColor: string }): Promise<void> } } }).fa
  if (fa?.chrome) fa.chrome.setTheme(chromeColors(t)).catch(() => {})
}

interface ThemeState {
  theme: ThemeVariant
  init(): void
  setTheme(t: ThemeVariant): void
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: 'dark',
  init: () => {
    const t = resolveStoredTheme(typeof localStorage === 'undefined' ? null : localStorage.getItem(THEME_STORAGE_KEY))
    set({ theme: t }); applyTheme(t)
  },
  setTheme: (t) => { set({ theme: t }); applyTheme(t) },
}))
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter renderer test`
Expected: PASS（新增 4 个用例）

- [ ] **Step 6: main 侧 titleBarOverlay + IPC + preload**

`packages/main/src/index.ts` BrowserWindow（44 行附近）：

```ts
const win = new BrowserWindow({
  width: 1200, height: 800,
  titleBarOverlay: { color: '#0e0f11', symbolColor: '#ececf1', height: 40 },
  webPreferences: { preload: join(__dirname, '../preload/preload.js'), contextIsolation: true, nodeIntegration: false },
})
```

`packages/main/src/ipc.ts`（registerIpc 内，紧跟 `fa:setAutoApprove` handler 之后）：

```ts
ipcMain.handle('fa:chrome:set-theme', (_e, c: unknown) => {
  const v = c as { color?: unknown; symbolColor?: unknown }
  try {
    deps.win.setTitleBarOverlay({ color: String(v?.color ?? '#0e0f11'), symbolColor: String(v?.symbolColor ?? '#ececf1') })
  } catch { /* 平台不支持/窗口销毁：静默（spec §7） */ }
})
```

`packages/main/src/preload.ts` fa 对象内新增：

```ts
chrome: {
  setTheme: (c: { color: string; symbolColor: string }) => ipcRenderer.invoke('fa:chrome:set-theme', c),
},
```

同步 `packages/renderer/src/env.d.ts` 的 `fa` 类型声明（跟随现有 FaApi 接口风格加 `chrome`）。

- [ ] **Step 7: main.tsx 渲染前 init + App 主题按钮**

`main.tsx` 在 `createRoot(...).render(...)` 之前：

```ts
useThemeStore.getState().init()
```

（import 自 `./theme-store.js`；同步读取，防首帧闪烁。）

`App.tsx` header 末尾（现有 usage span 之后，临时位置，Task 4 重排保留该按钮）：

```tsx
<button
  type="button"
  title="切换主题"
  onClick={() => useThemeStore.getState().setTheme(useThemeStore.getState().theme === 'dark' ? 'light' : 'dark')}
  className="ml-auto h-6 w-6 flex items-center justify-center rounded-md text-ink-secondary hover:bg-surface-3 hover:text-ink"
>
  {useThemeStore.getState().theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
</button>
```

（按钮显隐跟随 store：改用 `const theme = useThemeStore((s) => s.theme)` 后三处引用 `theme`；import `{ Sun, Moon } from 'lucide-react'`。）

- [ ] **Step 8: 手动验证闭环**

Run: `pnpm --filter main dev`
Expected: 点 header 太阳/月亮按钮——全窗口背景/文字/滚动条即时切换、无白闪、标题栏颜色跟随、刷新后主题保持（localStorage）、DevTools Application 面板可见 `fa-theme` 值

- [ ] **Step 9: 回归 + Commit**

Run: `pnpm -r test`
Expected: 136/136（132 + 4）

```bash
git add packages/renderer/src/themes.ts packages/renderer/src/theme-store.ts packages/renderer/src/theme-store.test.ts packages/renderer/src/main.tsx packages/renderer/src/App.tsx packages/renderer/src/env.d.ts packages/main/src/index.ts packages/main/src/ipc.ts packages/main/src/preload.ts
git commit -m "feat(m5): dual-theme store with palette source, titlebar overlay sync and ipc"
```

---

### Task 3: 裸色值卫兵测试（allowlist 收缩机制）

**Files:**
- Create: `packages/renderer/src/no-raw-colors.test.ts`

**Interfaces:**
- Produces: `LEGACY_FILES` allowlist（后续每任务迁移完自己的文件就把文件名从此数组删掉；Task 10 断言清空）。

- [ ] **Step 1: 写测试（先带 allowlist，立即可绿）**

```ts
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// 尚未迁移到语义 token 的文件；每完成一个组件任务就删一行，Task 10 必须清空
const LEGACY_FILES = new Set([
  'App.tsx', 'ChatPanel.tsx', 'Composer.tsx', 'MessageItem.tsx', 'ToolCard.tsx',
  'ApprovalCard.tsx', 'DiffPane.tsx', 'EditorArea.tsx', 'FileTree.tsx',
  'MonacoPane.tsx', 'MonacoDiff.tsx', 'TerminalPanel.tsx', 'XtermPane.tsx',
])

const HEX = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\b(?:red|blue|green|white|black|gray|grey|yellow|orange|purple|pink|cyan|magenta)\b/i

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

describe('renderer 源码禁止裸色值（.tsx；色板只许在 themes.ts/index.css）', () => {
  it('非 allowlist 的 .tsx 无 hex/rgb/具名色', () => {
    const offenders: string[] = []
    for (const f of walk(join(__dirname, '..'))) {
      if (!f.endsWith('.tsx')) continue
      const rel = f.split(/[\\/]/).pop()!
      if (LEGACY_FILES.has(rel)) continue
      if (HEX.test(readFileSync(f, 'utf8'))) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认通过（allowlist 生效）**

Run: `pnpm --filter renderer test`
Expected: PASS（13 个文件全部在 allowlist 中）

- [ ] **Step 3: Commit**

```bash
git add packages/renderer/src/no-raw-colors.test.ts
git commit -m "test(m5): raw-color guard with shrinking legacy allowlist"
```

---

### Task 4: App 骨架 + header 重排 + 会话下拉迁移

**Files:**
- Modify: `packages/renderer/src/App.tsx`（全量改造）
- Modify: `packages/renderer/src/components/ChatPanel.tsx`（删会话行与相关 state/effect，保留消息流/空状态/滚动逻辑）
- Modify: `packages/renderer/src/no-raw-colors.test.ts`（allowlist 删 `App.tsx`、`ChatPanel.tsx`）

**Interfaces:**
- Consumes: `useThemeStore`（Task 2）、utilities（Task 1）、lucide 图标。
- Produces: `SessionPicker` 组件（新建于 `App.tsx` 内导出，供 header 使用——不单独建文件，与 header 强绑定）；ChatPanel 不再含会话逻辑（`sessions/current/open` state 与 `fmtAgo` 保留迁入 SessionPicker）。

- [ ] **Step 1: App.tsx 改造（结构如下，逻辑不动）**

```tsx
import type React from 'react'
import { useEffect, useState } from 'react'
import { ChevronDown, Moon, PanelRight, Plus, Sun, Trash2 } from 'lucide-react'
import { fa } from './api/fa.js'
import { useStore } from './store.js'
import { useEditorStore } from './editor-store-instance.js'
import { useThemeStore } from './theme-store.js'
import { applyEditorEvent, openFileFromDisk } from './editor-events.js'
import { ChatPanel, fmtTokens } from './components/ChatPanel.js'
import { Composer } from './components/Composer.js'
import { FileTree } from './components/FileTree.js'
import { EditorArea } from './components/EditorArea.js'
import { TerminalPanel } from './components/TerminalPanel.js'
import type { SessionMeta } from '../main/src/protocol.js'

// ……fmtAgo/clip/sessErr 从 ChatPanel 迁入（代码原样搬）……

function SessionPicker(): React.JSX.Element {
  // 原 ChatPanel 的 sessions/current/open state + 契约 1/2/6/7/8 的三个 useEffect
  // + doDelete 原样迁入；仅样式替换：
  // 触发行（header 内）：
  //   className="flex items-center gap-1.5 h-6 px-2 rounded-md text-ink-secondary
  //              hover:bg-surface-3 hover:text-ink cursor-pointer select-none
  //              text-xs max-w-48" + running 时 "opacity-50 pointer-events-none"
  //   内容：<span className="truncate">{title}</span><ChevronDown size={12} />
  // 浮层：className="absolute top-full left-0 mt-1 w-72 z-50 bg-surface-2 border
  //   border-border rounded-md shadow-lg shadow-black/30 py-1"（light 下阴影由
  //   全局 body[data-theme] 无需区分——shadow-black/30 两主题都可接受，spec §4.3）
  // 列表行：className="fa-sess-row flex items-center gap-2 px-2.5 h-7 cursor-pointer
  //   text-xs" + 当前项 "bg-surface-3"；时间 <span className="text-ink-faint shrink-0">
  // 删除按钮：Trash2 size={12}，className="fa-sess-del shrink-0 text-ink-faint
  //   hover:text-danger"（当前项 opacity-30 pointer-events-none 保留内联）
  // 底部新增：className="fa-sess-row flex items-center gap-1.5 px-2.5 h-7 text-accent
  //   cursor-pointer text-xs" + <Plus size={12}/> 新会话
}

export function App(): React.JSX.Element {
  // meta/usage/treeCollapsed/termCollapsed + chatCollapsed 新增 useState(false)
  // useEffect 事件订阅不动；SessionPicker 内已含会话订阅
  const theme = useThemeStore((s) => s.theme)
  // header（h-10 = 40px）：
  //   <header className="flex items-center gap-3 h-10 px-3 border-b border-border-subtle shrink-0">
  //     左：<div className="w-4 h-4 rounded bg-accent shrink-0" /> <strong className="text-[13px]">FlowAgent</strong>
  //         <SessionPicker />
  //     右（ml-auto 组）：<span className="font-mono text-xs text-ink-secondary truncate
  //         max-w-64" title={...}>{workspaceRoot ?? '未选择工作区'}</span>
  //         <span className="bg-surface-2 border border-border-subtle rounded-md px-1.5 py-0.5 text-xs">{model ?? '模型未配置'}</span>
  //         <span className="font-mono text-xs text-ink-faint">{usage ? `${fmtTokens(usage.prompt)} / ${fmtTokens(usage.completion)} tokens` : '—'}</span>
  //         主题按钮（Task 2 已有，移入本组，className 不变）
  //   主体：<div className="flex flex-1 min-h-0">
  //     左栏 <div className={treeCollapsed ? 'w-8' : 'w-60'} + "border-r border-border-subtle overflow-y-auto shrink-0 transition-all duration-150">
  //     中栏 flex-1 min-w-0 flex flex-col（EditorArea + TerminalPanel 不动）
  //     右栏 <div className={chatCollapsed ? 'w-9' : 'w-[420px]'} + "border-l border-border-subtle flex flex-col min-h-0 shrink-0 transition-all duration-150">
  //       折叠竖条（chatCollapsed 时）：<div className="w-9 flex justify-center pt-2">
  //         <button title="展开聊天" onClick={() => setChatCollapsed(false)}
  //           className="h-6 w-6 flex items-center justify-center rounded-md text-ink-secondary hover:bg-surface-3"><PanelRight size={14} /></button>
  //       </div>；展开时正常渲染 ChatPanel/Composer，且 ChatPanel 顶加一行折叠柄
  //       （h-7 flex items-center justify-end px-1.5，按钮反向，图标 PanelRight）
}
```

- [ ] **Step 2: ChatPanel 移除会话行**

删除：sessions/current/open 三个 state、三个会话相关 useEffect、doDelete、`<style>` 注入行、`SessionMeta` import、顶栏 JSX；保留 fmtTokens 导出、消息流滚动 stick 逻辑、空状态、`MessageItem` 渲染。容器改 `className="flex-1 min-h-0 flex flex-col"`；滚动区 `className="flex-1 overflow-y-auto p-4"`；空状态 `className="text-ink-faint text-center mt-20"`。

- [ ] **Step 3: allowlist 收缩**

`no-raw-colors.test.ts` 的 `LEGACY_FILES` 删除 `'App.tsx'`、`'ChatPanel.tsx'` 两行。

- [ ] **Step 4: 验证**

Run: `pnpm -r test`
Expected: 全绿（卫兵测试随 allowlist 收缩仍绿）
手动（`pnpm --filter main dev`）逐契约核对 M4 §4.3：①挂载载入会话列表 ②session-changed 刷新 ③当前标题显示 ④列表项/截断/删除确认 ⑤当前项🗑置灰 ⑥+新会话自动切换 ⑦running 收起+禁点 ⑧外点关闭。另核对：聊天栏折叠/展开、三栏宽度 240/32/420/36、header 各元素不溢出。

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/App.tsx packages/renderer/src/components/ChatPanel.tsx packages/renderer/src/no-raw-colors.test.ts
git commit -m "feat(m5): restyled app shell, header with session picker, collapsible chat panel"
```

---

### Task 5: FileTree 图标化改造

**Files:**
- Modify: `packages/renderer/src/components/FileTree.tsx`
- Modify: `packages/renderer/src/no-raw-colors.test.ts`（删 `FileTree.tsx`）

**Interfaces:** 无新接口；行为（懒加载/右键菜单/行内输入/确认删除）零变化。

- [ ] **Step 1: 样式替换清单（逻辑与事件绑定不动）**

| 元素 | 替换为 |
|---|---|
| `rowStyle(depth)` 整个删去 | 行 className=`"fa-tree-row flex items-center h-[26px] cursor-pointer select-none truncate text-[13px] hover:bg-surface-3"` + `style={{ paddingLeft: 4 + depth * 16 }}`（缩进保留动态内联，非颜色不违规） |
| 目录图标 `📂/📁` | `<ChevronRight size={12} className={"shrink-0 mr-1 text-ink-faint transition-transform duration-150 " + (node.expanded ? 'rotate-90' : '')} />` + `<Folder size={14} className="shrink-0 mr-1 text-ink-secondary" />`（expanded 时 Folder 换 `FolderOpen`） |
| 文件行 | 行首 `<File size={14} className="shrink-0 mr-1 text-ink-faint" />`（与目录同级缩进对齐：无目录箭头时补 `ml-[18px]`） |
| agentTouched `●` | `<span className="ml-1 h-1.5 w-1.5 rounded-full bg-accent shrink-0" />` |
| 顶栏 | `className="sticky top-0 z-10 bg-surface-0 flex items-center justify-between h-7 px-1.5 pl-2.5 border-b border-border-subtle text-xs text-ink-secondary shrink-0"`；标题 `<span>工作区</span>`；按钮组：刷新 `<RotateCw size={13}/>`、折叠 `<PanelLeftClose size={13}/>`，按钮 className=`"flex items-center justify-center h-6 w-6 rounded-md text-ink-faint hover:bg-surface-3 hover:text-ink"` |
| 折叠窄条 | 32px 竖条容器不变；按钮换 `<PanelLeftOpen size={14}/>` 同上按钮 class |
| 右键菜单容器 | `className="fixed z-[1000] bg-surface-2 border border-border rounded-md shadow-lg shadow-black/30 py-1 min-w-30"`（fixed 定位与 left/top 保留 style） |
| 菜单项 menuItem | `className="fa-tree-row px-3 h-7 flex items-center cursor-pointer whitespace-nowrap text-[13px] hover:bg-surface-3"` |
| 行内输入行 | 容器 `className="flex items-center gap-1 h-[26px] text-[13px]"` + 动态 paddingLeft 保留；`<input className="flex-1 min-w-0 h-5 px-1.5 text-xs bg-surface-0 border border-border rounded-md focus:outline-none focus:border-accent" />`；确认/取消按钮 `<Check/>,<X/>` size={12}，class 同 iconBtn→`"flex items-center justify-center h-5 w-5 rounded text-ink-faint hover:bg-surface-3 hover:text-ink"` |
| 加载中… | `className="text-ink-faint text-xs px-2.5 py-1"` |
| `<style>` 注入行 | 删除（index.css 已有 .fa-tree-row:hover） |

import 增加：`import { Check, ChevronRight, File, Folder, FolderOpen, PanelLeftClose, PanelLeftOpen, RotateCw, X } from 'lucide-react'`；删除 iconBtn 常量。

- [ ] **Step 2: 验证**

Run: `pnpm -r test`（卫兵随 allowlist 收缩仍绿）
手动：展开/折叠箭头 90° 旋转过渡、hover 背景、右键菜单四项、新建/重命名行内输入 focus 边框 accent、agentTouched 圆点、折叠窄条展开往返。

- [ ] **Step 3: Commit**

```bash
git add packages/renderer/src/components/FileTree.tsx packages/renderer/src/no-raw-colors.test.ts
git commit -m "feat(m5): file tree restyle with lucide icons and themed context menu"
```

---

### Task 6: EditorArea + DiffPane

**Files:**
- Modify: `packages/renderer/src/components/EditorArea.tsx`
- Modify: `packages/renderer/src/components/DiffPane.tsx`
- Modify: `packages/renderer/src/no-raw-colors.test.ts`（删两项）

- [ ] **Step 1: EditorArea 样式替换清单**

| 元素 | 替换为 |
|---|---|
| 标签栏容器 | `className="flex h-8 border-b border-border-subtle overflow-x-auto shrink-0"` |
| 标签行（每项） | className 基础 `"flex items-center gap-1.5 h-8 px-2.5 cursor-pointer whitespace-nowrap text-[13px] border-b-2 "` + active ? `"border-accent text-ink"` : `"border-transparent text-ink-secondary hover:text-ink"`；conflict 时追加 `text-warning` |
| dirty 标记 ` •` | `<span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-accent inline-block" />` |
| 关闭 `×` | `<button className="flex items-center justify-center h-4 w-4 rounded text-ink-faint hover:bg-surface-3 hover:text-ink"><X size={11} /></button>`（stopPropagation 保留） |
| notice 条 | `className="flex items-center gap-2 px-2.5 h-7 bg-surface-2 border-l-2 border-warning text-[13px]"` + 关闭按钮同上 |
| conflict 条 | 同 notice（border-warning）；两按钮 className=`"h-6 px-2 rounded-md border border-border text-xs hover:bg-surface-3"` |
| 欢迎空态 | `className="p-6 pt-16 flex flex-col items-center gap-3 text-ink-secondary"`：`<div className="w-10 h-10 rounded-lg bg-accent/15 flex items-center justify-center"><div className="w-5 h-5 rounded bg-accent" /></div>` + 主文案 + 最近打开区（`text-xs font-mono`，每项 `<div className="cursor-pointer text-accent hover:underline py-0.5">`） |
| Suspense fallback | `className="p-6 text-ink-faint"` 文案不变 |

- [ ] **Step 2: DiffPane 样式替换**

头部容器 `className="flex items-center gap-2 px-2.5 h-9 border-b border-border-subtle"`；路径 `<strong className="font-mono text-xs font-semibold">`；三按钮：允许=`"h-6 px-2.5 rounded-md bg-accent text-on-accent text-xs hover:bg-accent-hover"`、拒绝=`"h-6 px-2.5 rounded-md border border-danger text-danger text-xs hover:bg-surface-3"`、允许且不再询问=`"h-6 px-2.5 rounded-md border border-border text-xs hover:bg-surface-3"`；已解决态 `className="text-xs text-ink-secondary"`；fallback `className="p-6 text-ink-faint"`。（onClick/请求参数全部不动）

- [ ] **Step 3: 验证 + Commit**

Run: `pnpm -r test`；手动：开多标签切换（active 线）、dirty 圆点、conflict 黄名、中键关闭、notice 出现（可造 fs 错误）、diff 标签三按钮、欢迎页最近打开可点。

```bash
git add packages/renderer/src/components/EditorArea.tsx packages/renderer/src/components/DiffPane.tsx packages/renderer/src/no-raw-colors.test.ts
git commit -m "feat(m5): editor tabs, notices and diff header restyle"
```

---

### Task 7: TerminalPanel + XtermPane 主题联动

**Files:**
- Modify: `packages/renderer/src/components/TerminalPanel.tsx`
- Modify: `packages/renderer/src/components/XtermPane.tsx`
- Create: `packages/renderer/src/xterm-theme.test.ts`（themes 纯函数补测）
- Modify: `packages/renderer/src/no-raw-colors.test.ts`（删两项）

**Interfaces:**
- Consumes: `xtermTheme(v)`（Task 2）、`useThemeStore`。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { PALETTES, xtermTheme } from './themes.js'

describe('xtermTheme', () => {
  it('背景/前景/光标取自色板，双主题切换值不同', () => {
    const d = xtermTheme('dark'); const l = xtermTheme('light')
    expect(d.background).toBe(PALETTES.dark.surface0)
    expect(d.foreground).toBe(PALETTES.dark.ink)
    expect(d.cursor).toBe(PALETTES.dark.accent)
    expect(l.background).toBe(PALETTES.light.surface0)
    expect(d.background).not.toBe(l.background)
  })
  it('16 色 + 亮色系齐全（xterm ITheme 必需键）', () => {
    const keys = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
      'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite']
    for (const k of keys) { expect(typeof xtermTheme('dark')[k]).toBe('string') }
  })
})
```

Run: `pnpm --filter renderer test` → 新用例 PASS（themes.ts 已有；此测试锁定接口防回归）。若 FAIL 说明 themes.ts 被改坏，先修。

- [ ] **Step 2: TerminalPanel 样式替换**

容器 `className={"flex flex-col shrink-0 transition-all duration-150 " + (collapsed ? 'h-7' : 'h-[220px]')} border-t border-border-subtle`（高度切到 class，去掉内联 height）；头部 `className="flex items-center gap-2 h-7 px-2 text-[13px] text-ink-secondary shrink-0"`：折叠钮 `<ChevronDown size={13}/>`（collapsed 时 `rotate-180`，class 同 FileTree 图标按钮）；「终端」`<span className="text-xs">`；退出态 `<span className="text-xs text-danger">已退出</span>` + 重启按钮 `"h-5 px-1.5 rounded-md border border-border text-xs hover:bg-surface-3"`（label 换 `<RotateCw size={11}/>` + 文字「重启」）。内容容器与折叠不卸载逻辑（spec 注释）原样保留。

- [ ] **Step 3: XtermPane 主题联动**

`new Terminal({ fontSize: 13, cursorBlink: true, theme: xtermTheme(useThemeStore.getState().theme) })`；effect 内追加订阅：

```ts
const unsubTheme = useThemeStore.subscribe((s) => { term.options.theme = xtermTheme(s.theme) })
```

cleanup 里调用 `unsubTheme()`（放在 `term.dispose()` 之前）。其余 attach/RO/折叠零尺寸守卫全部不动。

- [ ] **Step 4: 验证 + Commit**

Run: `pnpm -r test`；手动：终端可输入、切主题终端底色/前景即时变化且光标可见、折叠往返终端状态保留、`exit` 后「已退出/重启」按钮danger 色、重启可恢复。

```bash
git add packages/renderer/src/components/TerminalPanel.tsx packages/renderer/src/components/XtermPane.tsx packages/renderer/src/xterm-theme.test.ts packages/renderer/src/no-raw-colors.test.ts
git commit -m "feat(m5): terminal panel restyle and xterm theme sync"
```

---

### Task 8: 聊天消息流（MessageItem / ToolCard / ApprovalCard / Composer / 呼吸点）

**Files:**
- Modify: `packages/renderer/src/components/MessageItem.tsx`
- Modify: `packages/renderer/src/components/ToolCard.tsx`
- Modify: `packages/renderer/src/components/ApprovalCard.tsx`
- Modify: `packages/renderer/src/components/Composer.tsx`
- Modify: `packages/renderer/src/components/ChatPanel.tsx`（空状态 + running 呼吸点行）
- Modify: `packages/renderer/src/no-raw-colors.test.ts`（删四项）

- [ ] **Step 1: MessageItem**

| 元素 | 替换为 |
|---|---|
| 用户消息 | `<div className="flex justify-end my-2"><span className="max-w-[85%] bg-surface-2 border border-border-subtle rounded-lg px-3 py-1.5 whitespace-pre-wrap">{item.text}</span></div>` |
| assistant 容器 | `className="my-2"`；文本容器 `<div className="fa-md max-w-[90%]">`（ReactMarkdown 不变）；尾部模型名（有文本时）`<div className="mt-1 text-xs text-ink-faint">{model}</div>`（model 从 useStore 取，工具 map 不变） |
| error 条 | `className="my-2 flex items-center gap-2 bg-surface-1 border-l-2 border-danger rounded-lg px-3 py-2"`；文字 `<span className="flex-1">错误：{item.message}</span>`；重试按钮 `"h-6 px-2 rounded-md border border-border text-xs hover:bg-surface-3"` |

- [ ] **Step 2: ToolCard（默认折叠单行）**

```tsx
const [open, setOpen] = useState(false)   // 默认 false = 折叠，不变
const Icon = card.status === 'running' ? LoaderCircle : card.status === 'error' ? X : Check
const iconCls = card.status === 'error' ? 'text-danger' : card.status === 'running'
  ? 'text-ink-faint animate-spin' : 'text-success'
// 卡片：<div className="bg-surface-1 border border-border rounded-lg my-1 font-mono text-xs">
//   折叠柄（整行点击展开）：<div className="flex items-center gap-2 cursor-pointer px-2.5 h-7">
//     <Icon size={12} className={"shrink-0 " + iconCls} />
//     <span className="shrink-0">{card.name}</span>
//     路径链接（clickable 时）：<span role="link" tabIndex={0} onClick/onKeyDown 不变
//       className="truncate text-accent hover:underline cursor-pointer">{path}</span>
//     非路径：<span className="truncate text-ink-secondary">{card.argsSummary}</span>
//     结果摘要：<span className="truncate text-ink-faint"> · {card.result.slice(0, 60)}</span>
//   展开（open 时）：<div className="mx-2.5 mb-2 p-2 bg-surface-0 border border-border-subtle
//     rounded-md whitespace-pre-wrap text-xs">{card.result || '(运行中…)'}</div>
```

- [ ] **Step 3: ApprovalCard**

卡片 `className="my-2 bg-surface-1 border-l-2 border-warning rounded-lg p-2.5"`；标题行 `className="flex gap-2 items-baseline font-mono text-xs"`：`<strong className="font-semibold">{item.action}</strong>` + 路径 span + diffStats `<span className="text-diff-added">+{add}</span> <span className="text-diff-removed">−{del}</span>`（diffStats 返回字符串则整体 `<span className="text-ink-secondary">`，保持现状即可，不拆色）；按钮组 mt-1.5 flex gap-2：查看 diff=描边、✓ 允许=`"h-6 px-2.5 rounded-md bg-accent text-on-accent text-xs hover:bg-accent-hover"`、✗ 拒绝=danger 描边（同 Task 6 规范）；已解决 `<span className="text-xs text-ink-secondary">已允许/已拒绝</span>`。payload/read/diff 联动逻辑全部不动。

- [ ] **Step 4: Composer**

外框（非 running）`className="p-3 border-t border-border-subtle"` 内包 `<div className="rounded-lg border border-border bg-surface-2 focus-within:border-accent transition-colors duration-150">`：`<textarea className="w-full bg-transparent resize-none outline-none px-3 py-2.5 text-[13px] placeholder:text-ink-faint" rows={3} ... />`（受控/快捷键/placeholder 文案不变）+ 底部 `<div className="px-3 pb-1.5 text-xs text-ink-faint">Enter 发送 · Shift+Enter 换行</div>`。running 态替换为 `className="p-3 border-t border-border-subtle"` 内全宽按钮 `"w-full h-8 rounded-md border border-danger text-danger text-sm hover:bg-surface-3 flex items-center justify-center gap-2"` + `<Square size={12} />` 停止。

- [ ] **Step 5: ChatPanel 空状态 + 呼吸点**

空状态：`<div className="mt-20 flex flex-col items-center gap-3 text-center">` + `<div className="w-10 h-10 rounded-lg bg-accent/15 flex items-center justify-center"><div className="w-5 h-5 rounded bg-accent" /></div>` + 原有两段文案 `<div className="text-ink-secondary">`。消息流底部（items.length > 0 且 running 时）：

```tsx
{running && items.length > 0 && (
  <div className="flex items-center gap-2 py-1.5 text-xs text-ink-secondary">
    <span className="flex gap-1"><span className="fa-dot" /><span className="fa-dot" /><span className="fa-dot" /></span>
    正在处理…
  </div>
)}
```

（running 已在组件 store 订阅中，补一行 `const running = useStore((s) => s.running)` 如已删需恢复。）

- [ ] **Step 6: 验证 + Commit**

Run: `pnpm -r test`；手动（真实模型或假 provider 冒烟）：用户消息卡片右对齐、assistant markdown（代码块/表格/链接色）、工具卡折叠-展开-路径跳转、审批卡三按钮 + diff 联动 + 脏拦截、错误条重试、Composer focus 边框、running 停止按钮 + 呼吸点、停止后呼吸点消失、空状态两文案（有/无 model）。

```bash
git add packages/renderer/src/components/MessageItem.tsx packages/renderer/src/components/ToolCard.tsx packages/renderer/src/components/ApprovalCard.tsx packages/renderer/src/components/Composer.tsx packages/renderer/src/components/ChatPanel.tsx packages/renderer/src/no-raw-colors.test.ts
git commit -m "feat(m5): codex-style chat messages, tool/approval cards, composer and running indicator"
```

---

### Task 9: Monaco 双主题联动

**Files:**
- Modify: `packages/renderer/src/components/MonacoPane.tsx`
- Modify: `packages/renderer/src/components/MonacoDiff.tsx`
- Create: `packages/renderer/src/monaco-theme.test.ts`
- Modify: `packages/renderer/src/no-raw-colors.test.ts`（删两项）

**Interfaces:**
- Consumes: `monacoThemeData(v)`（Task 2）、`useThemeStore`。

- [ ] **Step 1: 写测试（纯数据，不加载 monaco）**

```ts
import { describe, expect, it } from 'vitest'
import { PALETTES, monacoThemeData } from './themes.js'

describe('monacoThemeData', () => {
  it('base 与主题匹配，背景取 surface0', () => {
    const d = monacoThemeData('dark'); const l = monacoThemeData('light')
    expect(d.base).toBe('vs-dark'); expect(l.base).toBe('vs')
    expect(d.colors['editor.background']).toBe(PALETTES.dark.surface0)
    expect(l.colors['editor.background']).toBe(PALETTES.light.surface0)
    expect(d.inherit).toBe(true)
  })
  it('rules 前缀无 #（Monaco 要求 6 位 hex 无 #）', () => {
    for (const r of monacoThemeData('dark').rules) expect(r.foreground).not.toContain('#')
  })
})
```

Run 确认 PASS（锁定契约）。

- [ ] **Step 2: MonacoPane 联动**

挂载 effect 中 `monaco.editor.defineTheme('fa-dark', monacoThemeData('dark'))`、`defineTheme('fa-light', monacoThemeData('light'))`，create 时 `theme: useThemeStore.getState().theme === 'dark' ? 'fa-dark' : 'fa-light'`（替换现有 `theme: 'vs'`）；追加订阅：

```ts
const unsubTheme = useThemeStore.subscribe((s) => {
  monaco.editor.setTheme(s.theme === 'dark' ? 'fa-dark' : 'fa-light')
})
```

cleanup 调 `unsubTheme()`。其余（worker/MonacoEnvironment/model 绑定/Ctrl+S）零改动。

- [ ] **Step 3: MonacoDiff 联动**

同样 defineTheme ×2 + createDiffEditor 加 `theme: useThemeStore.getState().theme === 'dark' ? 'fa-dark' : 'fa-light'` + subscribe/cleanup setTheme。

- [ ] **Step 4: 验证 + Commit**

Run: `pnpm -r test`；手动：打开 .ts/.md 文件（着色正常）、切主题编辑器底色/行号/diff 红绿即时切换、diff 标签页同切、Ctrl+S 保存仍工作、折叠终端/聊天往返无白闪。

```bash
git add packages/renderer/src/components/MonacoPane.tsx packages/renderer/src/components/MonacoDiff.tsx packages/renderer/src/monaco-theme.test.ts packages/renderer/src/no-raw-colors.test.ts
git commit -m "feat(m5): monaco dual-theme definitions with live switching"
```

---

### Task 10: 终验（allowlist 清空 + README + 验收清单）

**Files:**
- Modify: `packages/renderer/src/no-raw-colors.test.ts`（LEGACY_FILES 置空并加断言）
- Modify: `README.md`（M5 段落）

- [ ] **Step 1: allowlist 清空断言**

`LEGACY_FILES` 改为 `new Set<string>([])`，测试内追加：

```ts
it('allowlist 已清空（迁移完成）', () => {
  expect(LEGACY_FILES.size).toBe(0)
})
```

Run: `pnpm --filter renderer test` → 若 FAIL，按报出的文件继续清残留（唯一允许例外：无——色值必须进 token）。

- [ ] **Step 2: README 更新**

「开发」段后新增：

```markdown
## 界面主题（M5）

- Codex 风格暗/亮双主题：顶栏右侧按钮切换，选择持久化；Monaco、终端、原生标题栏全联动。
- 会话切换移至顶栏左侧；聊天面板可折叠；工具卡片默认折叠，点击展开。
```

并将「终端与会话（M4）」中"聊天面板顶栏可新建/切换/删除会话"改为"顶栏会话下拉可新建/切换/删除会话"。

- [ ] **Step 3: 全量回归**

Run: `pnpm -r test`
Expected: 全绿（132 基线 + themes/theme-store 4 + xterm 2 + monaco 2 + 卫兵 2 = 142）

- [ ] **Step 4: spec §9 验收清单逐项打勾（双主题截图自查）**

暗/亮各过一遍：header（会话下拉×8 契约、路径/model/token/主题钮）、FileTree（含右键菜单、行内输入）、编辑器（标签/dirty/conflict/欢迎页/diff 三按钮）、终端（输入/折叠/重启）、聊天（用户卡/assistant markdown/工具卡/审批卡/错误条/Composer/呼吸点/空状态/停止）。截图留档到 `docs/superpowers/` 之外（临时目录即可，不入库）。

- [ ] **Step 5: Commit + 分支收尾**

```bash
git add packages/renderer/src/no-raw-colors.test.ts README.md
git commit -m "docs(m5): finalize raw-color guard and readme for dual-theme ui"
```

之后走 finishing-a-development-branch：全分支 code review → 用户真机验收（spec §9 最后两项）→ 本地合 master → 推送 → 删分支。
