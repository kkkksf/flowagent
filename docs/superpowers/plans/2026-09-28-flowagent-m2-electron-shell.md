# FlowAgent M2（Electron 壳 + 聊天面板）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 Electron 桌面应用：流式聊天、工具卡片、简易审批门（允许/拒绝 + 本次会话不再询问）、单会话自动恢复、首次启动工作区选择。

**Architecture:** pnpm monorepo 新增 `packages/main`（Electron 主进程 + preload，CJS 输出）与 `packages/renderer`（React SPA，electron-vite HMR）。核心新类 `AgentHost`（main 进程）把 `agent-core` 的事件流翻译成 IPC 推送，审批门用挂起 Promise 等 renderer 回应；renderer 永不直接 import `agent-core`。

**Tech Stack:** TypeScript（strict）、Electron + electron-vite、React 19、zustand、react-markdown、vitest。

**Spec:** `docs/superpowers/specs/2026-09-28-flowagent-m2-electron-shell-design.md`

## Global Constraints

- 全 TypeScript strict；main/preload 输出 CJS，renderer 为 ESM（electron-vite 默认）。
- renderer 禁止运行时 import `agent-core`；`main/src/protocol.ts` 的类型允许 type-only 导入（编译期擦除，运行时依赖方向不变）。
- Electron 安全基线：`contextIsolation: true`、`nodeIntegration: false`、preload 仅暴露 `fa` 命名空间。
- `agent-core` 禁止 import electron/react（M1 约束延续）。
- 测试命令：各包 `pnpm --filter <pkg> test`（vitest run）；全仓 `pnpm -r test`。
- 提交信息 conventional commits。
- 文档中文，代码/标识符/路径英文。
- Electron 层逻辑必须可在**不起 Electron** 的 vitest 中测试（依赖注入 fake webContents / fake agent）。

## Review Focus

spec 未逐条展开、但最容易咬人的五类输入/故障模式（每条已把测试落到对应任务）：

1. **HTTP 200 + HTML 网关拦截页**：provider 应抛含响应体摘录的错误，而不是静默空 result → Task 1 的 `throws on 200 with html body`。
2. **审批挂起时点「停止」或关窗**：挂起 Promise 必须按「拒绝」resolve，不留悬空 → Task 3 的 `stop resolves pending approval as deny`。
3. **agent 抛异常后 `agent-idle` 漏发**：renderer 输入框永久卡死禁用 → Task 3 的 `emits agent-idle even when run throws`。
4. **运行中重复发送**：第二轮 `sendUserMessage` 必须被拒绝，避免并发写坏历史 → Task 3 的 `rejects send while busy`。
5. **恢复会话时工具卡片配对**：JSONL 里的 tool 消息必须按 `toolCallId` 配对到 assistant 消息里的卡片，错位则历史渲染混乱 → Task 5 的 `history maps tool results onto cards by toolCallId`。

---

### Task 1: provider 非 SSE 响应修复（agent-core 前置修复）

**Files:**
- Modify: `packages/agent-core/src/providers/openai.ts`
- Test: `packages/agent-core/src/providers/openai.test.ts`

**Interfaces:**
- Consumes: `LlmProvider.stream`（现有签名不动）。
- Produces: 行为变更——200 + 非 `text/event-stream` 响应体、或 SSE 流零数据事件时，`stream()` 抛 `Error`（message 以 `LLM API:` 开头，含响应体前 200 字符摘录）。

- [ ] **Step 1: 写失败测试**（追加到 `openai.test.ts`，沿用文件里现成的假 fetch 手法）

```typescript
describe('non-SSE response guards', () => {
  const body = (text: string, contentType: string) =>
    new Response(text, { status: 200, headers: { 'content-type': contentType } })

  it('throws on 200 with html body', async () => {
    const p = new OpenAICompatProvider({
      baseURL: 'http://x', apiKey: 'k', model: 'm', maxRetries: 0, backoffMs: 1,
      fetchImpl: (async () => body('<!DOCTYPE html><html>blocked</html>', 'text/html')) as typeof fetch,
    })
    await expect(async () => {
      for await (const _ of p.stream([{ role: 'user', content: 'hi' }], [])) void _
    }).rejects.toThrow(/LLM API:.*blocked/)
  })

  it('throws on empty sse stream', async () => {
    const p = new OpenAICompatProvider({
      baseURL: 'http://x', apiKey: 'k', model: 'm', maxRetries: 0, backoffMs: 1,
      fetchImpl: (async () => body('', 'text/event-stream')) as typeof fetch,
    })
    await expect(async () => {
      for await (const _ of p.stream([{ role: 'user', content: 'hi' }], [])) void _
    }).rejects.toThrow(/LLM API: empty SSE stream/)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter agent-core test`
Expected: FAIL（当前静默返回空 result，不抛错）

- [ ] **Step 3: 最小实现**（`openai.ts`，`if (!res || !res.ok ...)` 之后、`let content = ''` 之前插入）

```typescript
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('text/event-stream')) {
      const text = await res.text().catch(() => '')
      throw new Error(`LLM API: unexpected content-type "${contentType}": ${text.slice(0, 200)}`)
    }
```

并把 SSE 消费循环改为带数据标记（`parseSse` 每产出一项就置位）：

```typescript
    let sawData = false
    for await (const data of parseSse(res.body)) {
      sawData = true
      // ……现有解析逻辑不变……
    }
    if (!sawData) throw new Error('LLM API: empty SSE stream')
```

- [ ] **Step 4: 跑测试确认全部通过**

Run: `pnpm --filter agent-core test`
Expected: PASS（新增 2 例 + 原有 8 个文件全过）

- [ ] **Step 5: 提交**

```bash
git add packages/agent-core/src/providers/openai.ts packages/agent-core/src/providers/openai.test.ts
git commit -m "fix(provider): throw on non-SSE 200 responses instead of silent empty result"
```

---

### Task 2: main 包脚手架 + 窗口 + 工作区记忆

**Files:**
- Create: `packages/main/package.json`、`packages/main/electron-vite.config.ts`、`packages/main/tsconfig.json`、`packages/main/src/index.ts`、`packages/main/src/preload.ts`、`packages/main/src/settings.ts`
- Test: `packages/main/src/settings.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: 无（纯脚手架）。
- Produces: `loadSettings(file): AppSettings`、`saveSettings(file, s): void`（`AppSettings = { workspaceRoot: string | null }`）；可启动的空窗口（安全基线生效）。

- [ ] **Step 1: `packages/main/package.json`**

```json
{
  "name": "main",
  "version": "0.1.0",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "agent-core": "workspace:*"
  },
  "devDependencies": {
    "electron": "^39.0.0",
    "electron-vite": "^4.0.0",
    "@vitejs/plugin-react": "^5.0.0",
    "typescript": "^7.0.2",
    "vitest": "^5.0.2",
    "@types/node": "^26.6.3"
  }
}
```

- [ ] **Step 2: `packages/main/electron-vite.config.ts`**（main/preload 全部打包进 bundle，只 external electron，避免 agent-core ESM 运行时加载问题）

```typescript
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { build: { rollupOptions: { external: ['electron'] }, outDir: 'out/main' } },
  preload: { build: { rollupOptions: { external: ['electron'] }, outDir: 'out/preload' } },
  renderer: {
    root: '../renderer',
    plugins: [react()],
    build: { outDir: '../main/out/renderer' },
  },
})
```

- [ ] **Step 3: `packages/main/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "types": ["node"],
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src", "electron-vite.config.ts"]
}
```

- [ ] **Step 4: `packages/main/src/settings.ts`**

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface AppSettings { workspaceRoot: string | null }

export function loadSettings(file: string): AppSettings {
  if (!existsSync(file)) return { workspaceRoot: null }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as AppSettings
    return typeof parsed.workspaceRoot === 'string' ? parsed : { workspaceRoot: null }
  } catch {
    return { workspaceRoot: null }
  }
}

export function saveSettings(file: string, s: AppSettings): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(s, null, 2), 'utf8')
}
```

- [ ] **Step 5: 写失败测试 `packages/main/src/settings.test.ts`**

```typescript
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSettings, saveSettings } from './settings.js'

describe('settings', () => {
  it('returns null workspace when file missing', () => {
    expect(loadSettings(join(mkdtempSync(join(tmpdir(), 'fa-')), 'settings.json'))).toEqual({ workspaceRoot: null })
  })
  it('roundtrips workspace root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fa-'))
    const file = join(dir, 'settings.json')
    saveSettings(file, { workspaceRoot: 'E:/play' })
    expect(loadSettings(file)).toEqual({ workspaceRoot: 'E:/play' })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ workspaceRoot: 'E:/play' })
  })
  it('falls back to null on corrupt json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fa-'))
    const file = join(dir, 'settings.json')
    saveSettings(file, { workspaceRoot: 'E:/play' })
    writeFileSync(file, '{broken', 'utf8')
    expect(loadSettings(file)).toEqual({ workspaceRoot: null })
  })
})
```

- [ ] **Step 6: 跑测试**（先 `pnpm install` 让 workspace 链接生效）

Run: `pnpm install; pnpm --filter main test`
Expected: Step 5 写完即应 PASS（settings 已实现）；若先跑测试再实现，FAIL 于模块不存在。

- [ ] **Step 7: `packages/main/src/preload.ts`**（空壳版，Task 4 补全通道）

```typescript
import { contextBridge } from 'electron'
contextBridge.exposeInMainWorld('fa', {})
```

- [ ] **Step 8: `packages/main/src/index.ts`**（最小窗口；AgentHost 接线在 Task 4/7）

```typescript
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const url = process.env['ELECTRON_RENDERER_URL']
  if (url) void win.loadURL(url)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => { createWindow() })
app.on('window-all-closed', () => { app.quit() })
```

- [ ] **Step 9: `.gitignore` 追加**

```
packages/main/out/
```

- [ ] **Step 10: 手动冒烟**（renderer 尚不存在，先建最小占位 `packages/renderer/index.html`，内容 `<html><body>flowagent m2</body></html>`）

Run: `pnpm --filter main dev`
Expected: 弹出窗口显示 "flowagent m2"；关闭窗口进程退出。Ctrl+C 结束。

- [ ] **Step 11: 提交**

```bash
git add packages/main .gitignore packages/renderer/index.html pnpm-lock.yaml
git commit -m "feat(main): scaffold electron main package with secure window and settings persistence"
```

---

### Task 3: AgentHost——事件流翻译与审批门（M2 核心）

**Files:**
- Create: `packages/main/src/protocol.ts`、`packages/main/src/agent-host.ts`
- Test: `packages/main/src/agent-host.test.ts`

**Interfaces:**
- Consumes: `agent-core` 的 `AgentEvent`、`AgentMessage`、`Agent`。
- Produces:
  - `protocol.ts` 导出 `FaEvent`、`FaState`、`FaApi`（Task 4/5 依赖）；
  - `AgentHost`：`send(text)`、`stop()`、`respondApproval(id, allow)`、`setAutoApprove(v)`、`loadSession(messages)`、`busy`。

- [ ] **Step 1: `packages/main/src/protocol.ts`**（协议单一事实来源；renderer 允许 type-only 导入）

```typescript
import type { AgentMessage, ToolCall } from 'agent-core'

export type { AgentMessage, ToolCall } // renderer 统一从此处 type-only 导入，不直接依赖 agent-core

export type FaEvent =
  | { type: 'history'; messages: AgentMessage[] }
  | { type: 'message-delta'; text: string }
  | { type: 'assistant-done' }
  | { type: 'tool-call'; call: ToolCall }
  | { type: 'tool-result'; id: string; result: string }
  | { type: 'approval-required'; id: string; action: string; detail: string }
  | { type: 'approval-resolved'; id: string; allowed: boolean }
  | { type: 'agent-idle' }
  | { type: 'error'; message: string }

export interface FaState { workspaceRoot: string | null; model: string | null; hasSession: boolean }

export interface FaApi {
  getState(): Promise<FaState>
  sendUserMessage(text: string): Promise<void>
  stop(): Promise<void>
  respondApproval(id: string, allow: boolean): Promise<void>
  setAutoApprove(v: boolean): Promise<void>
  onEvent(cb: (ev: FaEvent) => void): () => void
}
```

- [ ] **Step 2: `packages/main/src/agent-host.ts`**

```typescript
import { randomUUID } from 'node:crypto'
import type { AgentEvent, AgentMessage } from 'agent-core'
import type { FaEvent } from './protocol.js'

export interface AgentLike {
  run(input: string): AsyncGenerator<AgentEvent>
  stop(): void
  loadHistory(messages: AgentMessage[]): void
}

export interface AgentHostDeps {
  emit(ev: FaEvent): void
  makeAgent(approve: (action: string, detail: string) => Promise<boolean>): AgentLike
}

export class AgentHost {
  private agent: AgentLike | null = null
  private running = false
  private autoApprove = false
  private pending: { id: string; resolve: (allow: boolean) => void } | null = null

  constructor(private deps: AgentHostDeps) {}

  get busy(): boolean { return this.running }

  setAutoApprove(v: boolean): void { this.autoApprove = v }

  loadSession(messages: AgentMessage[]): void {
    this.agent ??= this.deps.makeAgent(async () => true)
    this.agent.loadHistory(messages)
    this.deps.emit({ type: 'history', messages })
  }

  async send(text: string): Promise<void> {
    if (this.running) throw new Error('agent is busy')
    this.running = true
    try {
      this.agent ??= this.deps.makeAgent(async (action, detail) => {
        if (this.autoApprove) return true
        const id = randomUUID()
        this.deps.emit({ type: 'approval-required', id, action, detail })
        return await new Promise<boolean>((resolve) => { this.pending = { id, resolve } })
      })
      try {
        for await (const ev of this.agent.run(text)) this.forward(ev)
      } catch (e) {
        this.deps.emit({ type: 'error', message: e instanceof Error ? e.message : String(e) })
      } finally {
        this.deps.emit({ type: 'agent-idle' }) // 必发：renderer 靠它解锁输入框
      }
    } finally {
      this.running = false
      this.pending = null
    }
  }

  respondApproval(id: string, allow: boolean): void {
    if (this.pending?.id === id) {
      const p = this.pending
      this.pending = null
      this.deps.emit({ type: 'approval-resolved', id, allowed: allow }) // 卡片定格为已处理态
      p.resolve(allow)
    }
  }

  stop(): void {
    if (this.pending) this.respondApproval(this.pending.id, false) // 挂起审批一律按拒绝收场
    this.agent?.stop()
  }

  private forward(ev: AgentEvent): void {
    switch (ev.type) {
      case 'message-delta': this.deps.emit({ type: 'message-delta', text: ev.text }); break
      case 'assistant-message': this.deps.emit({ type: 'assistant-done' }); break
      case 'tool-call': this.deps.emit({ type: 'tool-call', call: ev.call }); break
      case 'tool-result': this.deps.emit({ type: 'tool-result', id: ev.call.id, result: ev.result }); break
      case 'error': this.deps.emit({ type: 'error', message: ev.message }); break
      default: break // step / done 不透传给 UI
    }
  }
}
```

- [ ] **Step 3: 写测试 `packages/main/src/agent-host.test.ts`**（假 agent，不起 Electron）

```typescript
import { describe, expect, it } from 'vitest'
import type { AgentEvent, AgentMessage } from 'agent-core'
import { AgentHost, type AgentLike } from './agent-host.js'
import type { FaEvent } from './protocol.js'

function fakeAgent(run: (input: string) => AsyncGenerator<AgentEvent>): { agent: AgentLike; stopped: () => boolean } {
  let stopped = false
  return {
    agent: {
      run,
      stop: () => { stopped = true },
      loadHistory: (_m: AgentMessage[]) => {},
    },
    stopped: () => stopped,
  }
}

const eventsOf = (host: AgentHost) => {
  const out: FaEvent[] = []
  return { sink: { emit: (e: FaEvent) => out.push(e) }, out }
}

describe('AgentHost', () => {
  it('forwards stream events and ends with agent-idle', async () => {
    async function* gen(): AsyncGenerator<AgentEvent> {
      yield { type: 'message-delta', text: 'hi' }
      yield { type: 'assistant-message', message: { role: 'assistant', content: 'hi', toolCalls: [] } }
      yield { type: 'done', reason: 'completed' }
    }
    const { sink, out } = eventsOf(null as never)
    const host = new AgentHost({ emit: sink.emit, makeAgent: () => fakeAgent(gen).agent })
    await host.send('q')
    expect(out.map((e) => e.type)).toEqual(['message-delta', 'assistant-done', 'agent-idle'])
  })

  it('emits agent-idle even when run throws', async () => {
    const { sink, out } = eventsOf(null as never)
    const host = new AgentHost({
      emit: sink.emit,
      makeAgent: () => ({
        run: async function* (): AsyncGenerator<AgentEvent> { throw new Error('boom') },
        stop: () => {},
        loadHistory: () => {},
      }),
    })
    await host.send('q')
    expect(out).toContainEqual({ type: 'error', message: 'boom' })
    expect(out.at(-1)).toEqual({ type: 'agent-idle' })
  })

  it('rejects send while busy', async () => {
    async function* gen(): AsyncGenerator<AgentEvent> {
      yield new Promise<AgentEvent>((r) => setTimeout(() => r({ type: 'step', step: 1 }), 30)) as never
      yield { type: 'done', reason: 'completed' }
    }
    const { sink } = eventsOf(null as never)
    const host = new AgentHost({ emit: sink.emit, makeAgent: () => fakeAgent(gen).agent })
    const p = host.send('first')
    await expect(host.send('second')).rejects.toThrow('busy')
    await p
  })

  it('approval roundtrip: emit card, resolve allow', async () => {
    const { sink, out } = eventsOf(null as never)
    let approveDecision = false
    const host = new AgentHost({
      emit: sink.emit,
      makeAgent: (approve) => ({
        run: async function* (): AsyncGenerator<AgentEvent> {
          approveDecision = await approve('write_file', 'a.txt')
          yield { type: 'done', reason: 'completed' }
        },
        stop: () => {},
        loadHistory: () => {},
      }),
    })
    const p = host.send('q')
    await new Promise((r) => setTimeout(r, 10)) // 等 approval-required 发出
    const card = out.find((e) => e.type === 'approval-required')
    expect(card).toBeDefined()
    host.respondApproval((card as { id: string }).id, true)
    await p
    expect(approveDecision).toBe(true)
    expect(out).toContainEqual({ type: 'approval-resolved', id: (card as { id: string }).id, allowed: true })
  })

  it('stop resolves pending approval as deny and stops agent', async () => {
    const { sink, out } = eventsOf(null as never)
    const { agent, stopped } = fakeAgent(async function* (): AsyncGenerator<AgentEvent> {
      yield { type: 'done', reason: 'stopped' }
    })
    let decision: boolean | undefined
    const host = new AgentHost({
      emit: sink.emit,
      makeAgent: (approve) => ({
        run: async function* (): AsyncGenerator<AgentEvent> {
          decision = await approve('run_command', 'rm -rf /')
          yield { type: 'done', reason: 'stopped' }
        },
        stop: agent.stop,
        loadHistory: () => {},
      }),
    })
    const p = host.send('q')
    await new Promise((r) => setTimeout(r, 10))
    host.stop()
    await p
    expect(decision).toBe(false)
    expect(stopped()).toBe(true)
  })

  it('auto-approve skips approval event', async () => {
    const { sink, out } = eventsOf(null as never)
    let decision: boolean | undefined
    const host = new AgentHost({
      emit: sink.emit,
      makeAgent: (approve) => ({
        run: async function* (): AsyncGenerator<AgentEvent> {
          decision = await approve('write_file', 'a.txt')
          yield { type: 'done', reason: 'completed' }
        },
        stop: () => {},
        loadHistory: () => {},
      }),
    })
    host.setAutoApprove(true)
    await host.send('q')
    expect(decision).toBe(true)
    expect(out.some((e) => e.type === 'approval-required')).toBe(false)
  })
})
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter main test`
Expected: PASS（6 例）

- [ ] **Step 5: 提交**

```bash
git add packages/main/src/protocol.ts packages/main/src/agent-host.ts packages/main/src/agent-host.test.ts
git commit -m "feat(main): add AgentHost translating agent event stream to IPC with approval gate"
```

---

### Task 4: IPC 通道 + preload 完整暴露

**Files:**
- Create: `packages/main/src/ipc.ts`
- Modify: `packages/main/src/preload.ts`（替换 Task 2 空壳）

**Interfaces:**
- Consumes: `AgentHost`（Task 3）、`FaApi`（protocol.ts）。
- Produces: `registerIpc({ host, win, getState, onApprovalAuto? })`——ipcMain 通道 `fa:getState` / `fa:send` / `fa:stop` / `fa:approval` + `fa:event` 推送；`window.fa` 完整可用。

- [ ] **Step 1: `packages/main/src/ipc.ts`**

```typescript
import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import type { AgentHost } from './agent-host.js'
import type { FaEvent, FaState } from './protocol.js'

export function registerIpc(deps: {
  host: AgentHost
  win: BrowserWindow
  getState(): FaState
}): void {
  const send = (ev: FaEvent) => {
    if (!deps.win.isDestroyed()) deps.win.webContents.send('fa:event', ev)
  }
  ipcMain.handle('fa:getState', () => deps.getState())
  ipcMain.handle('fa:send', (_e, text: unknown) => {
    if (typeof text !== 'string' || !text.trim()) throw new Error('empty message')
    void deps.host.send(text).then(undefined, (err: unknown) =>
      send({ type: 'error', message: err instanceof Error ? err.message : String(err) }))
  })
  ipcMain.handle('fa:stop', () => { deps.host.stop() })
  ipcMain.handle('fa:approval', (_e, id: unknown, allow: unknown) => {
    deps.host.respondApproval(String(id), Boolean(allow))
  })
  ipcMain.handle('fa:setAutoApprove', (_e, v: unknown) => { deps.host.setAutoApprove(Boolean(v)) })
  return { send } // 供 index.ts 把 host 事件接到同一窗口；Task 7 使用
}
```

说明：`registerIpc` 返回 `send`（`fa:send` 的 rejection 兜底也用它转 `error` 事件，正是 Review Focus 第 4 条 busy 守卫的 UI 侧表现）。Task 7 的 `index.ts` 先建 win，再用等价的内联 `emit` 构造 `AgentHost`（`send` 与该 `emit` 逻辑一致：`webContents.send('fa:event', ev)`，两处各一份是有意的小重复，避免 host/ipc 的构造顺序循环依赖）。

- [ ] **Step 2: `packages/main/src/preload.ts`**（完整版）

```typescript
import { contextBridge, ipcRenderer } from 'electron'
import type { FaEvent } from './protocol.js'

contextBridge.exposeInMainWorld('fa', {
  getState: () => ipcRenderer.invoke('fa:getState'),
  sendUserMessage: (text: string) => ipcRenderer.invoke('fa:send', text),
  stop: () => ipcRenderer.invoke('fa:stop'),
  respondApproval: (id: string, allow: boolean) => ipcRenderer.invoke('fa:approval', id, allow),
  setAutoApprove: (v: boolean) => ipcRenderer.invoke('fa:setAutoApprove', v),
  onEvent: (cb: (ev: FaEvent) => void) => {
    const listener = (_e: unknown, ev: FaEvent) => cb(ev)
    ipcRenderer.on('fa:event', listener)
    return () => { ipcRenderer.removeListener('fa:event', listener) }
  },
})
```

- [ ] **Step 3: 类型检查 + 手动冒烟**

Run: `pnpm --filter main build && pnpm --filter main dev`
Expected: 构建通过；窗口仍显示占位页；DevTools console 里 `window.fa.getState()` 返回对象（main 侧尚未实现 getState 时可暂返回 `{ workspaceRoot: null, model: null, hasSession: false }` 占位——Task 7 接真）。

- [ ] **Step 4: 提交**

```bash
git add packages/main/src/ipc.ts packages/main/src/preload.ts
git commit -m "feat(main): wire ipc channels and expose typed fa api via contextBridge"
```

---

### Task 5: renderer 脚手架 + chat store（事件归并核心）

**Files:**
- Create: `packages/renderer/package.json`、`packages/renderer/tsconfig.json`、`packages/renderer/vitest.config.ts`、`packages/renderer/index.html`（替换占位）、`packages/renderer/src/main.tsx`、`packages/renderer/src/api/fa.ts`、`packages/renderer/src/state/chat-store.ts`
- Test: `packages/renderer/src/state/chat-store.test.ts`

**Interfaces:**
- Consumes: `FaEvent`（type-only，来自 `../../../main/src/protocol.js`）。
- Produces: `createChatStore()`，`ChatStore { items; running; meta; applyEvent(ev); setMeta(m); lastUserMessage(): string | null }`；`ChatItem = user | assistant | approval | error`。

- [ ] **Step 1: `packages/renderer/package.json`**

```json
{
  "name": "renderer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "vitest run" },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zustand": "^5.0.0",
    "react-markdown": "^10.0.0"
  },
  "devDependencies": { "typescript": "^7.0.2", "vitest": "^5.0.2", "@types/react": "^19.0.0", "@types/react-dom": "^19.0.0" }
}
```

- [ ] **Step 2: `packages/renderer/src/state/chat-store.ts`**（zustand + 事件归并；不渲染 DOM，纯逻辑可测。类型从 `protocol.ts` type-only 导入——它在 Task 3 已 re-export `AgentMessage`/`ToolCall`，renderer 不直接依赖 agent-core）

```typescript
import { create } from 'zustand'
import type { FaEvent, AgentMessage, ToolCall } from '../../../main/src/protocol.js'

export interface ToolCardState { id: string; name: string; argsSummary: string; status: 'running' | 'done' | 'error'; result: string }
export type ChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; tools: ToolCardState[] }
  | { kind: 'approval'; id: string; action: string; detail: string; resolved: 'allowed' | 'denied' | null }
  | { kind: 'error'; message: string }

export interface ChatMeta { workspaceRoot: string | null; model: string | null }

interface ChatStore {
  items: ChatItem[]
  running: boolean
  meta: ChatMeta
  applyEvent(ev: FaEvent): void
  setMeta(m: ChatMeta): void
  lastUserMessage(): string | null
}

function argsSummary(args: string): string {
  try {
    const o = JSON.parse(args) as Record<string, unknown>
    const first = Object.values(o)[0]
    return typeof first === 'string' ? first.slice(0, 120) : args.slice(0, 120)
  } catch { return args.slice(0, 120) }
}

function ensureAssistant(items: ChatItem[]): ChatItem[] {
  if (items.at(-1)?.kind === 'assistant') return items
  return [...items, { kind: 'assistant', text: '', tools: [] } as ChatItem]
}

function fromHistory(messages: AgentMessage[]): ChatItem[] {
  const out: ChatItem[] = []
  for (const m of messages) {
    if (m.role === 'user') out.push({ kind: 'user', text: m.content })
    else if (m.role === 'assistant') {
      out.push({
        kind: 'assistant',
        text: m.content,
        tools: m.toolCalls.map((c: ToolCall) => ({ id: c.id, name: c.name, argsSummary: argsSummary(c.arguments), status: 'running' as const, result: '' })),
      })
    } else if (m.role === 'tool') {
      for (let i = out.length - 1; i >= 0; i--) {
        const it = out[i]
        if (it.kind !== 'assistant') continue
        const card = it.tools.find((t) => t.id === m.toolCallId)
        if (card) {
          card.status = m.content.startsWith('error:') ? 'error' : 'done'
          card.result = m.content
          break
        }
      }
    }
  }
  return out
}

export const createChatStore = () => create<ChatStore>((set, get) => ({
  items: [],
  running: false,
  meta: { workspaceRoot: null, model: null },
  setMeta: (m) => set({ meta: m }),
  applyEvent: (ev) => set((s) => {
    switch (ev.type) {
      case 'history': return { items: fromHistory(ev.messages) }
      case 'message-delta': {
        const items = ensureAssistant(s.items)
        const last = items.at(-1) as { kind: 'assistant'; text: string; tools: ToolCardState[] }
        last.text += ev.text
        return { items: [...items], running: true }
      }
      case 'tool-call': {
        const items = ensureAssistant(s.items)
        const last = items.at(-1) as { kind: 'assistant'; text: string; tools: ToolCardState[] }
        last.tools = [...last.tools, { id: ev.call.id, name: ev.call.name, argsSummary: argsSummary(ev.call.arguments), status: 'running', result: '' }]
        return { items: [...items] }
      }
      case 'tool-result': {
        const items = s.items.map((it) => {
          if (it.kind !== 'assistant') return it
          const tools = it.tools.map((t) => t.id === ev.id
            ? { ...t, status: (ev.result.startsWith('error:') ? 'error' : 'done') as 'error' | 'done', result: ev.result }
            : t)
          return { ...it, tools }
        })
        return { items }
      }
      case 'approval-required': return { items: [...s.items, { kind: 'approval', id: ev.id, action: ev.action, detail: ev.detail, resolved: null }] }
      case 'agent-idle': return { running: false }
      case 'error': return { items: [...s.items, { kind: 'error', message: ev.message }] }
      default: return {}
    }
  }),
  lastUserMessage: () => {
    for (let i = get().items.length - 1; i >= 0; i--) {
      const it = get().items[i]
      if (it.kind === 'user') return it.text
    }
    return null
  },
}))
```

- [ ] **Step 3: 写测试 `chat-store.test.ts`**（覆盖 Review Focus 第 5 条 + 基本归并）

```typescript
import { describe, expect, it } from 'vitest'
import { createChatStore } from './chat-store.js'

describe('chat store', () => {
  it('accumulates deltas into one assistant bubble', () => {
    const s = createChatStore().getState()
    s.applyEvent({ type: 'message-delta', text: 'he' })
    s.applyEvent({ type: 'message-delta', text: 'llo' })
    s.applyEvent({ type: 'assistant-done' })
    expect(s.items).toEqual([{ kind: 'assistant', text: 'hello', tools: [] }])
  })

  it('pairs tool result to card by id', () => {
    const s = createChatStore().getState()
    s.applyEvent({ type: 'tool-call', call: { id: 't1', name: 'run_command', arguments: '{"command":"ls"}' } })
    s.applyEvent({ type: 'tool-result', id: 't1', result: 'file-a' })
    s.applyEvent({ type: 'agent-idle' })
    const asst = s.items.at(-1) as { kind: 'assistant'; tools: { id: string; status: string; result: string }[] }
    expect(asst.tools[0]).toMatchObject({ id: 't1', status: 'done', result: 'file-a' })
    expect(s.running).toBe(false)
  })

  it('marks tool card error when result starts with error:', () => {
    const s = createChatStore().getState()
    s.applyEvent({ type: 'tool-call', call: { id: 't9', name: 'write_file', arguments: '{"path":"x"}' } })
    s.applyEvent({ type: 'tool-result', id: 't9', result: 'error: tool "write_file" threw: denied' })
    const asst = s.items.at(-1) as { tools: { status: string }[] }
    expect(asst.tools[0].status).toBe('error')
  })

  it('history maps tool results onto cards by toolCallId', () => {
    const s = createChatStore().getState()
    s.applyEvent({
      type: 'history',
      messages: [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'a1', name: 'write_file', arguments: '{"path":"a.txt"}' }] },
        { role: 'tool', toolCallId: 'a1', content: 'wrote 3 bytes' },
        { role: 'assistant', content: 'done', toolCalls: [] },
      ],
    })
    expect(s.items).toEqual([
      { kind: 'user', text: 'go' },
      { kind: 'assistant', text: '', tools: [{ id: 'a1', name: 'write_file', argsSummary: 'a.txt', status: 'done', result: 'wrote 3 bytes' }] },
      { kind: 'assistant', text: 'done', tools: [] },
    ])
  })

  it('approval card then error then idle', () => {
    const s = createChatStore().getState()
    s.applyEvent({ type: 'approval-required', id: 'ap1', action: 'run_command', detail: 'python hello.py' })
    s.applyEvent({ type: 'error', message: 'LLM API: balance insufficient' })
    s.applyEvent({ type: 'agent-idle' })
    expect(s.items.map((i) => i.kind)).toEqual(['approval', 'error'])
    expect(s.running).toBe(false)
  })

  it('lastUserMessage finds latest user text', () => {
    const s = createChatStore().getState()
    s.applyEvent({ type: 'message-delta', text: 'x' })
    expect(s.lastUserMessage()).toBe(null)
    s.applyEvent({ type: 'history', messages: [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'ok', toolCalls: [] }] })
    expect(s.lastUserMessage()).toBe('earlier')
  })
})
```

- [ ] **Step 4: 其余脚手架**——`tsconfig.json`（同 main 的 Bundler 模式 + `"jsx": "react-jsx"`）；`vitest.config.ts`：

```typescript
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } })
```

`index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>FlowAgent</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/main.tsx`（组件在 Task 6 落地，先挂空 App）：

```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
createRoot(document.getElementById('root')!).render(<React.StrictMode><div>flowagent</div></React.StrictMode>)
```

`src/api/fa.ts`：

```typescript
import type { FaApi } from '../../../main/src/protocol.js'
export const fa = (window as unknown as { fa: FaApi }).fa
```

- [ ] **Step 5: 跑测试**

Run: `pnpm install; pnpm --filter renderer test`
Expected: PASS（6 例）

- [ ] **Step 6: 提交**

```bash
git add packages/renderer pnpm-lock.yaml
git commit -m "feat(renderer): scaffold react app with event-reducing chat store"
```

---

### Task 6: 聊天 UI 组件

**Files:**
- Create: `packages/renderer/src/App.tsx`、`packages/renderer/src/components/ChatPanel.tsx`、`MessageItem.tsx`、`ToolCard.tsx`、`ApprovalCard.tsx`、`Composer.tsx`
- Modify: `packages/renderer/src/main.tsx`（挂真 App）

**Interfaces:**
- Consumes: `useStore = createChatStore()`（模块级单例，App 与组件共享）、`fa`。
- Produces: 完整聊天界面（流式气泡、工具卡片、审批卡、输入区、停止按钮、空状态引导）。

- [ ] **Step 1: `src/store.ts`**（模块级单例 + 事件订阅，供组件用）

```typescript
import { createChatStore } from './state/chat-store.js'
export const useStore = createChatStore()
```

- [ ] **Step 2: `App.tsx`**（启动拉取状态 + 订阅事件 + 布局）

```tsx
import { useEffect } from 'react'
import { fa } from './api/fa.js'
import { useStore } from './store.js'
import { ChatPanel } from './components/ChatPanel.js'
import { Composer } from './components/Composer.js'

export function App(): React.JSX.Element {
  const meta = useStore((s) => s.meta)
  useEffect(() => {
    void fa.getState().then((st) => useStore.getState().setMeta({ workspaceRoot: st.workspaceRoot, model: st.model }))
    return fa.onEvent((ev) => useStore.getState().applyEvent(ev))
  }, [])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{ display: 'flex', gap: 12, padding: '8px 16px', borderBottom: '1px solid #ddd', alignItems: 'baseline' }}>
        <strong>FlowAgent</strong>
        <span style={{ color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {meta.workspaceRoot ?? '未选择工作区'}
        </span>
        <span style={{ color: '#999' }}>{meta.model ?? '模型未配置'}</span>
      </header>
      <ChatPanel />
      <Composer />
    </div>
  )
}
```

- [ ] **Step 3: `components/ChatPanel.tsx`**（自动跟随滚动 + 空状态引导）

```tsx
import { useEffect, useRef } from 'react'
import { useStore } from '../store.js'
import { MessageItem } from './MessageItem.js'

export function ChatPanel(): React.JSX.Element {
  const items = useStore((s) => s.items)
  const model = useStore((s) => s.meta.model)
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [items])
  return (
    <div ref={ref} onScroll={() => {
      const el = ref.current
      if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    }} style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
      {items.length === 0 && (
        <div style={{ color: '#888', textAlign: 'center', marginTop: 80 }}>
          {model ? '给 FlowAgent 发个任务试试，例如：写一个 hello.py 并运行。' : '模型未配置，请设置 FLOWAGENT_BASE_URL / FLOWAGENT_API_KEY / FLOWAGENT_MODEL 环境变量后重启。'}
        </div>
      )}
      {items.map((it, i) => <MessageItem key={i} item={it} />)}
    </div>
  )
}
```

- [ ] **Step 4: `components/MessageItem.tsx`**

```tsx
import ReactMarkdown from 'react-markdown'
import type { ChatItem } from '../state/chat-store.js'
import { ToolCard } from './ToolCard.js'
import { ApprovalCard } from './ApprovalCard.js'

export function MessageItem({ item }: { item: ChatItem }): React.JSX.Element {
  if (item.kind === 'user') return <div style={{ textAlign: 'right', margin: '8px 0' }}><span style={{ background: '#e8f0fe', padding: '6px 12px', borderRadius: 10, display: 'inline-block', maxWidth: '80%', whiteSpace: 'pre-wrap' }}>{item.text}</span></div>
  if (item.kind === 'assistant') return (
    <div style={{ margin: '8px 0' }}>
      <div style={{ maxWidth: '90%' }}><ReactMarkdown>{item.text}</ReactMarkdown></div>
      {item.tools.map((t) => <ToolCard key={t.id} card={t} />)}
    </div>
  )
  if (item.kind === 'approval') return <ApprovalCard item={item} />
  return <div style={{ color: '#b00', background: '#fdecea', padding: '6px 12px', borderRadius: 8, margin: '8px 0' }}>错误：{item.message}</div>
}
```

- [ ] **Step 5: `components/ToolCard.tsx`**（可折叠）

```tsx
import { useState } from 'react'
import type { ToolCardState } from '../state/chat-store.js'

export function ToolCard({ card }: { card: ToolCardState }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const icon = card.status === 'running' ? '⏳' : card.status === 'error' ? '✗' : '✓'
  const color = card.status === 'error' ? '#b00' : card.status === 'running' ? '#888' : '#080'
  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: '6px 10px', margin: '4px 0', fontFamily: 'monospace', fontSize: 13 }}>
      <div style={{ cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <span style={{ color }}>{icon}</span> {card.name} <span style={{ color: '#666' }}>{card.argsSummary}</span>
        {card.result ? <span style={{ color: '#999' }}> · {card.result.slice(0, 60)}</span> : null}
      </div>
      {open && (
        <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', color: '#444' }}>
          {card.result || '(运行中…)'}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 6: `components/ApprovalCard.tsx`**（允许/拒绝 + 不再询问；操作后定格）

```tsx
import { useState } from 'react'
import { fa } from '../api/fa.js'
import { useStore } from '../store.js'
import type { ChatItem } from '../state/chat-store.js'

export function ApprovalCard({ item }: { item: Extract<ChatItem, { kind: 'approval' }> }): React.JSX.Element {
  const [remember, setRemember] = useState(false)
  const done = item.resolved !== null
  const respond = (allow: boolean) => {
    if (remember && allow) void fa.setAutoApprove(true)
    void fa.respondApproval(item.id, allow)
  }
  return (
    <div style={{ border: '2px solid #f0ad4e', borderRadius: 8, padding: 10, margin: '8px 0' }}>
      <div style={{ fontFamily: 'monospace' }}><strong>{item.action}</strong> 即将执行：</div>
      <pre style={{ background: '#fafafa', padding: 8, borderRadius: 6, whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{item.detail}</pre>
      {done ? (
        <span style={{ color: '#666' }}>已{item.resolved === 'allowed' ? '允许' : '拒绝'}</span>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => respond(true)}>允许</button>
          <button onClick={() => respond(false)}>拒绝</button>
          <label style={{ fontSize: 13, color: '#666' }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> 本次会话不再询问
          </label>
        </div>
      )}
    </div>
  )
}
```

说明：卡片定格靠 main 发的 `approval-resolved` 事件（Task 3 已在 `AgentHost.respondApproval` 中 emit，Task 7 Step 2 在 store 中配对处理），`done` 分支据此渲染。`useStore` 导入在此文件暂未用到时可移除——保留给后续扩展，实现时以 lint 结果为准。

- [ ] **Step 7: `components/Composer.tsx`**（Enter 发送 / Shift+Enter 换行 / 运行中禁用 + 停止）

```tsx
import { useState } from 'react'
import { fa } from '../api/fa.js'
import { useStore } from '../store.js'

export function Composer(): React.JSX.Element {
  const [text, setText] = useState('')
  const running = useStore((s) => s.running)
  const model = useStore((s) => s.meta.model)
  const disabled = running || !model
  const submit = () => {
    const t = text.trim()
    if (!t || disabled) return
    setText('')
    // 用户气泡本地立即上屏并进入运行态；后续内容由事件流驱动
    //（core 的 run() 不 emit 用户消息事件，这是设计使然）
    useStore.setState((s) => ({ items: [...s.items, { kind: 'user', text: t }], running: true }))
    void fa.sendUserMessage(t)
  }
  if (running) {
    return <footer style={{ padding: 12, borderTop: '1px solid #ddd' }}><button style={{ width: '100%' }} onClick={() => void fa.stop()}>■ 停止</button></footer>
  }
  return (
    <footer style={{ padding: 12, borderTop: '1px solid #ddd' }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
        placeholder={model ? '输入任务，Enter 发送（Shift+Enter 换行）' : '请先配置环境变量'}
        disabled={disabled}
        rows={3}
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
    </footer>
  )
}
```

- [ ] **Step 8: `main.tsx` 挂真 App + 冒烟**

```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
```

Run: `pnpm --filter main dev`
Expected: 窗口显示顶栏 + 空状态引导（无环境变量时显示配置提示，输入框禁用）。

- [ ] **Step 9: 提交**

```bash
git add packages/renderer/src
git commit -m "feat(renderer): chat ui with streaming bubbles, tool cards and approval gate"
```

---

### Task 7: 启动编排——工作区选择、会话恢复、真实 getState

**Files:**
- Modify: `packages/main/src/index.ts`（完整接线）、`packages/main/src/protocol.ts`（approval-resolved 事件 + setAutoApprove 通道，Task 6 修正说明所列）、`packages/main/src/ipc.ts`、`packages/main/src/agent-host.ts`（respondApproval emit 定格事件）、`packages/renderer/src/state/chat-store.ts`（处理 approval-resolved）

**Interfaces:**
- Consumes: Task 2-6 全部产物。
- Produces: 完整可用应用（验收清单除"真实模型对话"外全部可验）。

- [ ] **Step 1: `index.ts` 完整逻辑**（关键段落）

```typescript
import { app, BrowserWindow, dialog } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Agent } from 'agent-core'
import { OpenAICompatProvider } from 'agent-core'
import { fsTools } from 'agent-core'
import { execTool } from 'agent-core'
import { todoTool } from 'agent-core'
import { JsonlSessionStore, TokenBudgetTrim } from 'agent-core'
import { AgentHost } from './agent-host.js'
import { registerIpc } from './ipc.js'
import { loadSettings, saveSettings } from './settings.js'

function buildRealAgent(approve: (action: string, detail: string) => Promise<boolean>, workspaceRoot: string, sessionFile: string): Agent {
  return new Agent({
    provider: new OpenAICompatProvider({
      baseURL: process.env.FLOWAGENT_BASE_URL ?? '',
      apiKey: process.env.FLOWAGENT_API_KEY ?? '',
      model: process.env.FLOWAGENT_MODEL ?? '',
    }),
    tools: [...fsTools, execTool, todoTool],
    systemPrompt: 'You are FlowAgent, a helpful coding agent working inside the user\'s workspace. Use the provided tools to complete tasks step by step.',
    maxSteps: 30,
    contextStrategy: new TokenBudgetTrim({ tokenBudget: 60_000 }),
    session: new JsonlSessionStore(sessionFile),
    workspaceRoot,
    approve,
  })
}

app.whenReady().then(() => {
  const settingsFile = join(app.getPath('userData'), 'settings.json')
  let workspaceRoot = loadSettings(settingsFile).workspaceRoot
  if (!workspaceRoot || !existsSync(workspaceRoot)) {
    const picked = dialog.showOpenDialogSync({ properties: ['openDirectory'] })
    if (!picked?.length) { app.quit(); return }
    workspaceRoot = picked[0]
    saveSettings(settingsFile, { workspaceRoot })
  }
  const sessionFile = join(workspaceRoot, '.flowagent', 'session.jsonl')
  const model = process.env.FLOWAGENT_MODEL ?? null

  const win = new BrowserWindow({
    width: 1200, height: 800,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false },
  })
  const url = process.env['ELECTRON_RENDERER_URL']
  if (url) void win.loadURL(url); else void win.loadFile(join(__dirname, '../renderer/index.html'))

  const host = new AgentHost({
    emit: (ev) => { if (!win.isDestroyed()) win.webContents.send('fa:event', ev) },
    makeAgent: (approve) => buildRealAgent(approve, workspaceRoot!, sessionFile),
  })
  registerIpc({
    host, win,
    getState: () => ({ workspaceRoot, model, hasSession: existsSync(sessionFile) }),
  })
  // 会话自动恢复
  const records = new JsonlSessionStore(sessionFile).load()
  if (records.length > 0) {
    host.loadSession(records.flatMap((r) => (r.kind === 'message' ? [r.message] : [])))
  }
  // 关窗：挂起审批按拒绝收场（host.stop 内含），进程干净退出
  win.on('closed', () => { host.stop() })
})
app.on('window-all-closed', () => { app.quit() })
```

- [ ] **Step 2: store 端处理 `approval-resolved`**（事件与 `setAutoApprove` 通道已在 Task 3/4 落地，这里只补渲染层配对）

```typescript
      case 'approval-resolved': {
        const items = s.items.map((it) => it.kind === 'approval' && it.id === ev.id
          ? { ...it, resolved: (ev.allowed ? 'allowed' : 'denied') as 'allowed' | 'denied' }
          : it)
        return { items }
      }
```

并补 store 测试：`approval-required` → `approval-resolved` 后卡片 `resolved === 'allowed'`。

Run: `pnpm --filter renderer test && pnpm --filter main test`
Expected: PASS

- [ ] **Step 3: 手动验收（无 key 路径 + 恢复路径）**

Run: `pnpm --filter main dev`
Expected: ① 首次启动弹文件夹选择，选 `E:\play\fa-demo`；② 无环境变量时空状态显示配置提示、输入禁用；③ 手工往 `.flowagent/session.jsonl` 追加一条 user/assistant JSONL 后重启，历史气泡恢复；④ 设置 `FLOWAGENT_*` 指向错误端点发消息 → 红色错误条显示 Task 1 的 `LLM API:` 错误原文 + 「重试」可用。

- [ ] **Step 4: 提交**

```bash
git add packages/main/src packages/renderer/src
git commit -m "feat: full startup orchestration with workspace picker and session resume"
```

---

### Task 8: README + 全量验证

**Files:**
- Create: `README.md`（根目录，中文）
- Modify: `packages/renderer/src/components/MessageItem.tsx`（error 条附「重试上一条」按钮——调 `fa.sendUserMessage(store.lastUserMessage())`）

**Interfaces:**
- Consumes: 全部。
- Produces: 交付文档 + 验收清单核对结果。

- [ ] **Step 1: 「重试上一条」按钮**（error 渲染处）

```tsx
return (
  <div style={{ color: '#b00', background: '#fdecea', padding: '6px 12px', borderRadius: 8, margin: '8px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
    <span style={{ flex: 1 }}>错误：{item.message}</span>
    <button onClick={() => { const t = useStore.getState().lastUserMessage(); if (t) void fa.sendUserMessage(t) }}>重试上一条</button>
  </div>
)
```

- [ ] **Step 2: `README.md`**

```markdown
# FlowAgent

桌面端 AI 编程应用：对话、读写文件、执行命令、自主多步任务，内置文本编辑器（M3）。

## 开发

    pnpm install
    pnpm -r test        # 全部单测
    pnpm --filter main dev   # 启动 Electron 应用（HMR）

模型配置（环境变量，与 CLI 一致）：

    FLOWAGENT_BASE_URL=https://api.deepseek.com/v1
    FLOWAGENT_API_KEY=sk-...
    FLOWAGENT_MODEL=deepseek-chat

首次启动选择工作区文件夹；会话自动持久化于 `<工作区>/.flowagent/session.jsonl`。

## 架构

    packages/agent-core   纯 TS 引擎（循环/工具/provider/会话），零 UI 依赖
    packages/main         Electron 主进程：窗口、AgentHost、IPC、preload
    packages/renderer     React 聊天界面：流式气泡、工具卡片、审批门

详细设计见 docs/superpowers/specs/。
```

- [ ] **Step 3: 全量验证**

Run: `pnpm -r test && pnpm --filter main build`
Expected: 全部 PASS + 构建成功

- [ ] **Step 4: 按验收清单人工核对**（spec §10 七条，逐条打勾，真实模型对话那条待用户提供有余额的 key 后补验）

- [ ] **Step 5: 提交**

```bash
git add README.md packages/renderer/src
git commit -m "docs: add README with dev workflow and retry control"
```
