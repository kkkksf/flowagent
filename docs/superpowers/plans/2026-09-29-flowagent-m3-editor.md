# FlowAgent M3（Monaco 编辑器 + diff 确认）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三栏布局（文件树 / Monaco 多标签编辑器 / 聊天面板），用户可编辑保存文件，write_file/edit_file 确认门升级为中间编辑区 diff 标签页，三方冲突不静默覆盖用户未保存修改。

**Architecture:** renderer 新增 editor-store（标签状态机 + 冲突判定）与 FileTree/EditorArea 组件；main 新增 file-service（全部文件操作走 IPC + 复用 agent-core 的 workspace jail）；agent-core 唯一接口变更为 approve 增加可选 `ApprovalPayload` 第三参。

**Tech Stack:** monaco-editor（本地包 + Vite `?worker`，零外链）、zustand、vitest。

**Spec:** `docs/superpowers/specs/2026-09-29-flowagent-m3-editor-design.md`

## Global Constraints

- 全 TypeScript strict；renderer 禁止运行时 import `agent-core`（protocol.ts 的再导出仅 type-only）。
- Electron 安全基线不变：`contextIsolation: true`、`nodeIntegration: false`、preload 仅暴露 `fa`。
- 所有 UI 文件操作必须经 main 侧 file-service 的 `resolveInWorkspace` jail（路径逃逸一律抛错拒绝）。
- agent-core 禁止 import electron/react；`ApprovalPayload` 是纯数据。
- 测试命令：各包 `pnpm --filter <pkg> test`；全仓 `pnpm -r test`（当前基线 80/80）。
- 提交信息 conventional commits；文档中文。
- Monaco 资源全部本地打包（禁 CDN loader）。

## Review Focus

spec 未逐条展开、但最容易咬人的五类输入/故障模式（每条已把测试落到对应任务）：

1. **UI 侧路径逃逸**：`fa.fs.*` 收到 `..\..\etc` 或绝对路径必须拒绝，而不是读写工作区外 → Task 3 的 `rejects paths outside workspace`。
2. **CAS 写冲突**：保存时文件 mtime 与标签记录不符（外部已改）必须拒绝写并返回冲突标记，而不是覆盖 → Task 3 的 `write rejects when mtime mismatch`。
3. **脏修改 × agent 写入拦截**：允许按钮遇脏标签必须不发 allow（未保存优先原则）→ Task 5 的 `guard blocks allow on dirty tab`。
4. **悬空 toolCalls 恢复**：session.jsonl 里 assistant 带 toolCalls 但缺 tool 消息（中断残留）必须合成 `error: interrupted`，防下次 provider 400 → Task 1 的 `synthesizes missing tool results`。
5. **运行中 loadSession**：agent 运行中收到 F5 的恢复请求必须暂存而非重赋在飞历史 → Task 1 的 `defers loadSession while running`。

---

### Task 1: 前置小修（悬空 toolCalls / 运行中 loadSession / 导航守卫 / 契约注释）

**Files:**
- Create: `packages/agent-core/src/session/repair.ts`、`packages/agent-core/src/session/repair.test.ts`
- Modify: `packages/agent-core/src/index.ts`（导出 repair）
- Modify: `packages/main/src/agent-host.ts`（loadSession 暂存 + AgentLike 契约注释）
- Test: `packages/main/src/agent-host.test.ts`（追加）

**Interfaces:**
- Consumes: 现有 `AgentMessage`、`AgentHost`。
- Produces: `repairDanglingToolCalls(messages: AgentMessage[]): AgentMessage[]`（agent-core 导出，Task 7 接线时消费）。

- [ ] **Step 1: 写失败测试 `repair.test.ts`**

```typescript
import { describe, expect, it } from 'vitest'
import { repairDanglingToolCalls } from './repair.js'
import type { AgentMessage } from '../types.js'

describe('repairDanglingToolCalls', () => {
  it('synthesizes missing tool results', () => {
    const msgs: AgentMessage[] = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', toolCalls: [
        { id: 'a1', name: 'write_file', arguments: '{}' },
        { id: 'a2', name: 'run_command', arguments: '{}' },
      ] },
      { role: 'tool', toolCallId: 'a1', content: 'ok' },
      // a2 缺失：中断残留
      { role: 'assistant', content: 'done', toolCalls: [] },
    ]
    expect(repairDanglingToolCalls(msgs)).toEqual([
      msgs[0], msgs[1],
      { role: 'tool', toolCallId: 'a2', content: 'error: interrupted before completion' },
      msgs[3],
    ])
  })
  it('is a no-op when nothing dangles', () => {
    const msgs: AgentMessage[] = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'a1', name: 'x', arguments: '{}' }] },
      { role: 'tool', toolCallId: 'a1', content: 'ok' },
    ]
    expect(repairDanglingToolCalls(msgs)).toBe(msgs)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter agent-core test`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `repair.ts` + index.ts 导出**

```typescript
import type { AgentMessage } from '../types.js'

// 会话恢复修复：assistant 带 toolCalls 但缺对应 tool 结果消息（中断/崩溃残留）时，
// 合成 error 工具结果，避免下次 run 悬空 toolCalls 导致 provider 400（spec §8-2）
export function repairDanglingToolCalls(messages: AgentMessage[]): AgentMessage[] {
  const answered = new Set<string>()
  for (const m of messages) if (m.role === 'tool') answered.add(m.toolCallId)
  let dangling = 0
  const out: AgentMessage[] = []
  for (const m of messages) {
    out.push(m)
    if (m.role === 'assistant') {
      for (const c of m.toolCalls) {
        if (!answered.has(c.id)) { dangling++; out.push({ role: 'tool', toolCallId: c.id, content: 'error: interrupted before completion' }) }
      }
    }
  }
  return dangling === 0 ? messages : out
}
```

`index.ts` 追加：`export * from './session/repair.js'`。重新跑：PASS（agent-core 61/61）。

- [ ] **Step 4: agent-host 追加测试（运行中 loadSession 暂存）**

```typescript
  it('defers loadSession while running', async () => {
    let release!: () => void
    async function* gen(): AsyncGenerator<AgentEvent> {
      yield { type: 'message-delta', text: 'x' }
      await new Promise<void>((r) => { release = r })
      yield { type: 'done', reason: 'completed' }
    }
    const { sink } = eventsOf()
    const loaded: AgentMessage[][] = []
    const agent = { run: gen, stop: () => {}, loadHistory: (m: AgentMessage[]) => { loaded.push(m) } }
    const host = new AgentHost({ emit: sink.emit, makeAgent: () => agent })
    const p = host.send('first')
    host.loadSession([{ role: 'user', content: 'restored' }]) // running 中：暂存不打断在飞 run
    release()
    await p
    expect(loaded).toEqual([]) // 本次 run 未被重赋
    await host.send('second') // 下次 send 前灌入
    expect(loaded).toEqual([[{ role: 'user', content: 'restored' }]])
  })
```

- [ ] **Step 5: 修改 `agent-host.ts`**

`AgentLike` 接口上方加注释：

```typescript
// 契约：approve 在一次 run 内是串行的——agent-core 循环逐个 await 工具，
// 因此 AgentHost 的单槽 pending 挂起结构是安全的。引入并行工具执行前必须先改此处。
export interface AgentLike {
```

`loadSession` 改为：

```typescript
  loadSession(messages: AgentMessage[]): void {
    // running 期间不重赋在飞历史（F5 场景）：暂存 pendingHistory，下次 send 前灌入
    if (this.agent && !this.running) this.agent.loadHistory(messages)
    else this.pendingHistory = messages
    this.deps.emit({ type: 'history', messages })
  }
```

Run: `pnpm --filter main test`
Expected: PASS（15/15）

- [ ] **Step 6: `main/src/index.ts` 导航守卫**

```typescript
import { app, BrowserWindow, dialog, shell } from 'electron'
// createWindow 内，win 创建后追加：
  // 导航守卫：markdown 链接/新窗口一律外部浏览器打开，防止应用内导航离开聊天界面
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
  win.webContents.on('will-navigate', (e, url) => { e.preventDefault(); void shell.openExternal(url) })
```

- [ ] **Step 7: 全量验证 + 提交**

Run: `pnpm -r test` → 83 项全绿（agent-core 61 = 59+2 repair；main 15 = 14+1 loadSession；renderer 7；基线 80）

```bash
git add packages/agent-core/src packages/main/src
git commit -m "fix: session repair, deferred loadSession and navigation guard (M3 preflight)"
```

---

### Task 2: agent-core approve 载荷扩展（ApprovalPayload）

**Files:**
- Modify: `packages/agent-core/src/types.ts`、`packages/agent-core/src/loop.ts`（approve 闭包透传）、`packages/agent-core/src/tools/fs.ts`（write/edit 传 payload，edit detail 补预览）
- Test: `packages/agent-core/src/tools/fs.test.ts`（断言第三参）

**Interfaces:**
- Produces: `ApprovalPayload`（agent-core 导出，Task 4/5 消费）：

```typescript
export interface ApprovalPayload {
  path: string
  kind: 'write' | 'edit' | 'run'
  content?: string     // write_file 全文
  oldString?: string   // edit_file 原
  newString?: string   // edit_file 新
}
```

`ToolContext.approve` 与 `AgentConfig.approve` 均变为 `(action: string, detail: string, payload?: ApprovalPayload) => Promise<boolean>`（第三参可选，现有两参调用方兼容）。

- [ ] **Step 1: 写失败测试（fs.test.ts 追加；沿用文件内现有 fake approve 手法）**

```typescript
describe('approval payload', () => {
  it('write_file passes structured payload', async () => {
    const calls: { action: string; detail: string; payload?: unknown }[] = []
    const tool = fsTools.find((t) => t.name === 'write_file')!
    const res = await tool.execute({ path: 'p.txt', content: 'hello' }, {
      workspaceRoot: root,
      approve: async (action, detail, payload) => { calls.push({ action, detail, payload }); return true },
    })
    expect(res).toMatch(/^ok: wrote/)
    expect(calls[0]).toMatchObject({
      action: 'write_file',
      payload: { path: 'p.txt', kind: 'write', content: 'hello' },
    })
  })
  it('edit_file passes old/new payload and preview detail', async () => {
    const calls: { action: string; detail: string; payload?: unknown }[] = []
    writeSync(join(root, 'e.txt'), 'aaa bbb aaa')
    const tool = fsTools.find((t) => t.name === 'edit_file')!
    await tool.execute({ path: 'e.txt', old_string: 'bbb', new_string: 'ccc' }, {
      workspaceRoot: root,
      approve: async (action, detail, payload) => { calls.push({ action, detail, payload }); return true },
    })
    expect(calls[0].payload).toEqual({ path: 'e.txt', kind: 'edit', oldString: 'bbb', newString: 'ccc' })
    expect(String(calls[0].detail)).toContain('e.txt')
    expect(String(calls[0].detail)).toContain('bbb')
  })
})
```

（`root`/`writeSync` 用该测试文件现有的临时目录手法；没有就 mkdtempSync + writeFileSync。）

- [ ] **Step 2: 跑测试确认失败**（payload 为 undefined）

Run: `pnpm --filter agent-core test` → 新 2 例 FAIL

- [ ] **Step 3: 实现**

`types.ts`：新增 `ApprovalPayload`（上文代码块），`ToolContext.approve` 与 `AgentConfig.approve` 加可选第三参。

`loop.ts` approve 闭包（registry.run 的 ctx）改为：

```typescript
            approve: async (action, detail, payload) => {
              if (this.cfg.autoApprove) return true
              if (this.stopped) return false
              return this.cfg.approve?.(action, detail, payload) ?? false
            },
```

（注意保留 Task 1 最终修复已有的 `if (this.stopped) return false` 行——若已存在则只加 payload 透传。）

`fs.ts` write_file：

```typescript
      const detail = `${String(args.path)}\n\n${String(args.content).slice(0, 2000)}`
      const payload: ApprovalPayload = { path: String(args.path), kind: 'write', content: String(args.content) }
      if (!(await ctx.approve('write_file', detail, payload))) return 'error: user denied write_file'
```

edit_file（前置小修 #1：detail 补统一预览）：

```typescript
      const old = String(args.old_string); const neu = String(args.new_string)
      const detail = `${String(args.path)}\n\n${old.slice(0, 800)}\n→\n${neu.slice(0, 800)}`
      const payload: ApprovalPayload = { path: String(args.path), kind: 'edit', oldString: old, newString: neu }
      if (!(await ctx.approve('edit_file', detail, payload))) return 'error: user denied edit_file'
```

`fs.ts` 顶部 `import type { ToolDefinition, ApprovalPayload } from '../types.js'`。

- [ ] **Step 4: 跑测试**（`pnpm --filter agent-core test` 全绿，含既有 stop-守卫与审批断言用例——若旧用例断言 detail 为纯路径需同步更新）
- [ ] **Step 5: 提交** `feat(core): carry structured ApprovalPayload through approve gate`

---

### Task 3: main 侧 file-service（jail + CAS + watch）

**Files:**
- Create: `packages/main/src/file-service.ts`
- Test: `packages/main/src/file-service.test.ts`

**Interfaces:**
- Consumes: `resolveInWorkspace`（agent-core 已导出）。
- Produces（Task 4 的 IPC 直接映射这些方法）：

```typescript
export interface FileEntry { name: string; isDir: boolean }
export interface ReadResult { content: string; mtimeMs: number }
export type WriteResult = { ok: true; mtimeMs: number } | { ok: false; conflict: true; mtimeMs: number }
export class FileService {
  constructor(root: string, deps: { onFileChanged(relPath: string): void })
  read(p): Promise<ReadResult>
  list(p): Promise<FileEntry[]>          // 过滤 .flowagent，目录在前按名排序
  create(p, kind: 'file' | 'dir'): Promise<void>
  rename(from, to): Promise<void>
  delete(p): Promise<void>               // 目录递归删（UI 已确认）
  write(p, content, expectedMtimeMs?): Promise<WriteResult>  // CAS
  watch(p): void; unwatch(p): void; unwatchAll(): void
}
```

- [ ] **Step 1: 写失败测试 `file-service.test.ts`**

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileService } from './file-service.js'

let root: string
let changed: string[]
let svc: FileService
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fa-fs-'))
  changed = []
  svc = new FileService(root, { onFileChanged: (p) => changed.push(p) })
})
afterEach(() => svc.unwatchAll())

const waitFor = async (pred: () => boolean, ms = 2000): Promise<void> => {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, 50))
  }
}

describe('FileService', () => {
  it('read returns content and mtime', async () => {
    writeFileSync(join(root, 'a.txt'), 'hello', 'utf8')
    const r = await svc.read('a.txt')
    expect(r.content).toBe('hello')
    expect(typeof r.mtimeMs).toBe('number')
  })
  it('rejects paths outside workspace', async () => {
    await expect(svc.read('..\\..\\etc\\passwd')).rejects.toThrow(/outside the workspace/)
    await expect(svc.read('E:/Windows/win.ini')).rejects.toThrow(/outside the workspace/)
    await expect(svc.write('../x.txt', 'x')).rejects.toThrow(/outside the workspace/)
  })
  it('write roundtrips and supports CAS', async () => {
    const w1 = await svc.write('f.txt', 'v1')
    expect(w1.ok).toBe(true)
    const { mtimeMs } = await svc.read('f.txt')
    const stale = await svc.write('f.txt', 'v2', mtimeMs - 10_000)
    expect(stale).toMatchObject({ ok: false, conflict: true })   // 外部已改：拒绝覆盖
    expect(readFileSync(join(root, 'f.txt'), 'utf8')).toBe('v1')
    const fresh = await svc.write('f.txt', 'v3', mtimeMs)
    expect(fresh.ok).toBe(true)
    expect(readFileSync(join(root, 'f.txt'), 'utf8')).toBe('v3')
  })
  it('list sorts dirs first and hides .flowagent', async () => {
    mkdirSync(join(root, 'zz'))
    writeFileSync(join(root, 'b.txt'), '')
    mkdirSync(join(root, '.flowagent'))
    const es = await svc.list('.')
    expect(es.map((e) => e.name)).toEqual(['zz', 'b.txt'])
    expect(es[0].isDir).toBe(true)
  })
  it('create/rename/delete roundtrip', async () => {
    await svc.create('d1', 'dir')
    await svc.create('d1/n.txt', 'file')
    expect(existsSync(join(root, 'd1/n.txt'))).toBe(true)
    await svc.rename('d1/n.txt', 'd1/m.txt')
    expect(existsSync(join(root, 'd1/m.txt'))).toBe(true)
    await svc.delete('d1')
    expect(existsSync(join(root, 'd1'))).toBe(false)
  })
  it('watch reports relative path on change', async () => {
    writeFileSync(join(root, 'w.txt'), 'a', 'utf8')
    svc.watch('w.txt')
    await waitFor(() => changed.length > 0 || true) // 给 watcher 一点启动时间
    writeFileSync(join(root, 'w.txt'), 'b', 'utf8')
    await waitFor(() => changed.includes('w.txt'))
  })
  it('unwatchAll closes everything', () => {
    writeFileSync(join(root, 'u.txt'), '', 'utf8')
    svc.watch('u.txt'); svc.watch('u.txt') // 幂等
    svc.unwatchAll()
    // 无崩溃即通过；重复 close 的健壮性由实现保证
  })
})
```

- [ ] **Step 2: 跑测试确认失败**（模块不存在）
- [ ] **Step 3: 实现 `file-service.ts`**

```typescript
import { readFile, readdir, writeFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { watch, type FSWatcher } from 'node:fs'
import { dirname } from 'node:path'
import { resolveInWorkspace } from 'agent-core'

export interface FileEntry { name: string; isDir: boolean }
export interface ReadResult { content: string; mtimeMs: number }
export type WriteResult = { ok: true; mtimeMs: number } | { ok: false; conflict: true; mtimeMs: number }

export class FileService {
  private watchers = new Map<string, FSWatcher>()
  constructor(private root: string, private deps: { onFileChanged(relPath: string): void }) {}

  async read(p: string): Promise<ReadResult> {
    const abs = resolveInWorkspace(this.root, p)
    const content = await readFile(abs, 'utf8')
    return { content, mtimeMs: (await stat(abs)).mtimeMs }
  }
  async list(p: string): Promise<FileEntry[]> {
    const entries = await readdir(resolveInWorkspace(this.root, p), { withFileTypes: true })
    return entries
      .filter((e) => e.name !== '.flowagent')
      .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
      .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  }
  async create(p: string, kind: 'file' | 'dir'): Promise<void> {
    const abs = resolveInWorkspace(this.root, p)
    if (kind === 'dir') await mkdir(abs, { recursive: true })
    else { await mkdir(dirname(abs), { recursive: true }); await writeFile(abs, '', 'utf8') }
  }
  async rename(from: string, to: string): Promise<void> {
    const a = resolveInWorkspace(this.root, from); const b = resolveInWorkspace(this.root, to)
    await mkdir(dirname(b), { recursive: true })
    await rename(a, b)
  }
  async delete(p: string): Promise<void> {
    await rm(resolveInWorkspace(this.root, p), { recursive: true })
  }
  async write(p: string, content: string, expectedMtimeMs?: number): Promise<WriteResult> {
    const abs = resolveInWorkspace(this.root, p)
    let current: number | undefined
    try { current = (await stat(abs)).mtimeMs } catch { current = undefined }
    if (expectedMtimeMs !== undefined && current !== expectedMtimeMs) {
      return { ok: false, conflict: true, mtimeMs: current ?? 0 } // CAS 失败：外部已改，绝不静默覆盖
    }
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content, 'utf8')
    return { ok: true, mtimeMs: (await stat(abs)).mtimeMs }
  }
  watch(p: string): void {
    const abs = resolveInWorkspace(this.root, p)
    if (this.watchers.has(abs)) return
    try {
      const w = watch(abs, () => this.deps.onFileChanged(p))
      w.on('error', () => this.unwatch(p))
      this.watchers.set(abs, w)
    } catch { /* 文件不存在时静默；read 成功后再 watch */ }
  }
  unwatch(p: string): void {
    const abs = resolveInWorkspace(this.root, p)
    const w = this.watchers.get(abs)
    if (w) { w.close(); this.watchers.delete(abs) }
  }
  unwatchAll(): void { for (const p of [...this.watchers.keys()]) this.unwatch(p) }
}
```

- [ ] **Step 4: 跑测试**（`pnpm --filter main test` 全绿）
- [ ] **Step 5: 提交** `feat(main): add FileService with workspace jail, CAS writes and file watching`

---

### Task 4: IPC 扩展（fa.fs 通道 + payload/file-changed 透传）

**Files:**
- Modify: `packages/main/src/protocol.ts`、`agent-host.ts`、`ipc.ts`、`preload.ts`、`index.ts`
- Test: `packages/main/src/agent-host.test.ts`（payload 透传断言）、`packages/main/src/ipc.test.ts`（fs 通道映射）

**Interfaces:**
- Consumes: Task 2 `ApprovalPayload`、Task 3 `FileService`。
- Produces（renderer 消费）：`FaApi.fs: FsApi`（八方法，签名与 FileService 一致）；`FaEvent` 的 `approval-required` 带 `payload?: ApprovalPayload`；新事件 `{ type: 'file-changed'; path: string }`。

- [ ] **Step 1: `protocol.ts` 扩展**

```typescript
import type { AgentMessage, ToolCall, ApprovalPayload } from 'agent-core'
export type { AgentMessage, ToolCall, ApprovalPayload }

// FaEvent 中：
  | { type: 'approval-required'; id: string; action: string; detail: string; payload?: ApprovalPayload }
  | { type: 'file-changed'; path: string }   // 其余变体不变

export interface FsApi {
  read(path: string): Promise<{ content: string; mtimeMs: number }>
  list(path: string): Promise<{ name: string; isDir: boolean }[]>
  create(path: string, kind: 'file' | 'dir'): Promise<void>
  rename(from: string, to: string): Promise<void>
  delete(path: string): Promise<void>
  write(path: string, content: string, expectedMtimeMs?: number): Promise<{ ok: true; mtimeMs: number } | { ok: false; conflict: true; mtimeMs: number }>
  watch(path: string): Promise<void>
  unwatch(path: string): Promise<void>
}
// FaApi 增加：fs: FsApi
```

- [ ] **Step 2: agent-host 透传 payload + 测试**

`AgentHostDeps.makeAgent` 签名改为 `(action: string, detail: string, payload?: ApprovalPayload) => Promise<boolean>`；`send()` 里的 approve 回调与 `emit({ type: 'approval-required', id, action, detail, payload })` 加 payload。`approval roundtrip` 测试补断言：

```typescript
    expect(out.find((e) => e.type === 'approval-required')).toMatchObject({
      payload: { path: 'a.txt', kind: 'write' },
    })
//（fake approve 改为 approve('write_file', 'a.txt', { path: 'a.txt', kind: 'write' }) 调用）
```

- [ ] **Step 3: `ipc.ts` 注册 fs 通道**

`registerIpc` deps 增加 `fs: FileService`，`return { send }` 之前追加：

```typescript
  ipcMain.handle('fa:fs:read', (_e, p: unknown) => deps.fs.read(String(p)))
  ipcMain.handle('fa:fs:list', (_e, p: unknown) => deps.fs.list(String(p)))
  ipcMain.handle('fa:fs:create', (_e, p: unknown, kind: unknown) => deps.fs.create(String(p), kind === 'dir' ? 'dir' : 'file'))
  ipcMain.handle('fa:fs:rename', (_e, a: unknown, b: unknown) => deps.fs.rename(String(a), String(b)))
  ipcMain.handle('fa:fs:delete', (_e, p: unknown) => deps.fs.delete(String(p)))
  ipcMain.handle('fa:fs:write', (_e, p: unknown, c: unknown, m: unknown) =>
    deps.fs.write(String(p), String(c), typeof m === 'number' ? m : undefined))
  ipcMain.handle('fa:fs:watch', (_e, p: unknown) => { deps.fs.watch(String(p)) })
  ipcMain.handle('fa:fs:unwatch', (_e, p: unknown) => { deps.fs.unwatch(String(p)) })
```

`ipc.test.ts` 追加（沿用现有 handlers mock）：

```typescript
  it('maps fs channels to the service', async () => {
    const fs = { read: vi.fn(async () => ({ content: 'x', mtimeMs: 1 })), watch: vi.fn(), unwatch: vi.fn() }
    registerIpc({ host: fakeHost(), win: fakeWin(), getState: () => state, fs: fs as unknown as FileService })
    const r = await handlers.get('fa:fs:read')!('a.txt')
    expect(r).toEqual({ content: 'x', mtimeMs: 1 })
    expect(fs.read).toHaveBeenCalledWith('a.txt')
    handlers.get('fa:fs:watch')!('a.txt')
    expect(fs.watch).toHaveBeenCalledWith('a.txt')
  })
```

- [ ] **Step 4: `preload.ts` 暴露 `fa.fs`**

```typescript
  fs: {
    read: (path: string) => ipcRenderer.invoke('fa:fs:read', path),
    list: (path: string) => ipcRenderer.invoke('fa:fs:list', path),
    create: (path: string, kind: 'file' | 'dir') => ipcRenderer.invoke('fa:fs:create', path, kind),
    rename: (from: string, to: string) => ipcRenderer.invoke('fa:fs:rename', from, to),
    delete: (path: string) => ipcRenderer.invoke('fa:fs:delete', path),
    write: (path: string, content: string, expectedMtimeMs?: number) =>
      ipcRenderer.invoke('fa:fs:write', path, content, expectedMtimeMs),
    watch: (path: string) => ipcRenderer.invoke('fa:fs:watch', path),
    unwatch: (path: string) => ipcRenderer.invoke('fa:fs:unwatch', path),
  },
```

- [ ] **Step 5: `index.ts` 接线**

```typescript
import { FileService } from './file-service.js'
import { repairDanglingToolCalls } from 'agent-core'
// whenReady 内、创建 host 前：
  const emit = (ev: FaEvent): void => { if (!win.isDestroyed()) win.webContents.send('fa:event', ev) }
  const fileService = new FileService(workspaceRoot!, { onFileChanged: (p) => emit({ type: 'file-changed', path: p }) })
// host 的 emit 用上面的 emit；registerIpc 增加 fs: fileService；
// 会话恢复改为：
  host.loadSession(repairDanglingToolCalls(history))
// app.on('window-all-closed') 前追加 win.on('closed', () => fileService.unwatchAll())
```

- [ ] **Step 6: 验证 + 提交**

Run: `pnpm -r test && pnpm --filter main build`
```bash
git add packages/main/src
git commit -m "feat(main): expose fs ipc channels and carry approval payload"
```

---

### Task 5: renderer editor-store（标签状态机 + 冲突判定 + 审批守卫）

**Files:**
- Create: `packages/renderer/src/state/editor-store.ts`、`packages/renderer/src/state/approval-guard.ts`
- Test: `packages/renderer/src/state/editor-store.test.ts`

**Interfaces:**
- Consumes: `ApprovalPayload`（type-only from protocol）。
- Produces（Task 6/7/8 消费）：

```typescript
export interface FileTab { id: string; kind: 'file'; path: string; content: string; knownMtime: number; dirty: boolean; conflict: boolean }
export interface DiffTab { id: string; kind: 'diff'; approvalId: string; path: string; original: string; modified: string; resolved: 'allowed' | 'denied' | null }
export type EditorTab = FileTab | DiffTab
// useEditorStore actions:
openFile(path, content, mtimeMs): string         // 去重激活，返回 tab id
closeTab(id): void; activate(id): void
updateContent(id, content): void                 // Monaco onChange → dirty
markSaved(id, mtimeMs): void                     // 保存成功 → dirty/conflict 清
setConflict(id, conflict): void
reloadContent(id, content, mtimeMs): void        // 无脏自动重载
openDiff(approvalId, path, original, modified): string
resolveDiff(approvalId, allowed): void
agentTouched: string[]; markAgentTouched(path): void; clearAgentTouched(path): void
recentPaths: string[]                             // openFile 时前移，截 10
notice: string | null; setNotice(msg): void
hasDirtyTab(path): boolean
// 纯函数（buildDiffModified 与 makeApprovalGuard 见下）
```

- [ ] **Step 1: 写失败测试 `editor-store.test.ts`**

```typescript
import { describe, expect, it } from 'vitest'
import { createEditorStore, buildDiffModified } from './editor-store.js'
import { makeApprovalGuard } from './approval-guard.js'

describe('editor store', () => {
  it('openFile dedupes and activates', () => {
    const s = createEditorStore().getState()
    const a = s.openFile('a.txt', 'x', 1)
    const b = s.openFile('b.txt', 'y', 2)
    const a2 = s.openFile('a.txt', 'x', 1)
    expect(a2).toBe(a)
    expect(s.tabs.map((t) => (t.kind === 'file' ? t.path : t.kind))).toEqual(['a.txt', 'b.txt'])
    expect(s.activeTabId).toBe(a)
    expect(s.recentPaths).toEqual(['a.txt', 'b.txt'])
  })
  it('dirty flow: updateContent marks dirty, markSaved clears', () => {
    const s = createEditorStore().getState()
    const id = s.openFile('a.txt', 'x', 1)
    s.updateContent(id, 'x2')
    expect(s.hasDirtyTab('a.txt')).toBe(true)
    s.markSaved(id, 5)
    expect(s.hasDirtyTab('a.txt')).toBe(false)
  })
  it('reloadContent only when not dirty (caller checks); conflict flag settable', () => {
    const s = createEditorStore().getState()
    const id = s.openFile('a.txt', 'x', 1)
    s.reloadContent(id, 'y', 2)
    const t = s.tabs[0] as { content: string }
    expect(t.content).toBe('y')
    s.setConflict(id, true)
    expect((s.tabs[0] as { conflict: boolean }).conflict).toBe(true)
  })
  it('diff tab lifecycle', () => {
    const s = createEditorStore().getState()
    const id = s.openDiff('ap1', 'a.txt', 'old', 'new')
    expect(s.tabs[0]).toMatchObject({ kind: 'diff', approvalId: 'ap1', resolved: null })
    s.resolveDiff('ap1', true)
    expect((s.tabs[0] as { resolved: string }).resolved).toBe('allowed')
    expect(s.activeTabId).toBe(id)
  })
  it('agentTouched dot lifecycle', () => {
    const s = createEditorStore().getState()
    s.markAgentTouched('n.txt')
    expect(s.agentTouched).toEqual(['n.txt'])
    s.clearAgentTouched('n.txt')
    expect(s.agentTouched).toEqual([])
  })
  it('buildDiffModified applies edit payload', () => {
    expect(buildDiffModified({ path: 'a', kind: 'write', content: 'W' }, 'O')).toBe('W')
    expect(buildDiffModified({ path: 'a', kind: 'edit', oldString: 'b', newString: 'c' }, 'aba')).toBe('aca')
  })
})

describe('approval guard', () => {
  it('blocks allow on dirty tab and notifies', () => {
    const responded: [string, boolean][] = []
    const notices: string[] = []
    const guard = makeApprovalGuard({
      hasDirtyTab: (p) => p === 'a.txt',
      respond: (id, allow) => { responded.push([id, allow]) },
      notify: (m) => { notices.push(m) },
    })
    expect(guard('ap1', true, 'a.txt')).toBe(false)
    expect(responded).toEqual([])
    expect(notices[0]).toContain('a.txt')
    expect(guard('ap1', true, 'b.txt')).toBe(true)   // 非脏照常放行
    expect(guard('ap1', false, 'a.txt')).toBe(true)  // 拒绝永不需要守卫
    expect(responded).toEqual([['ap1', true], ['ap1', false]])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现 `editor-store.ts`（zustand，同 chat-store 的 create 工厂风格，不强制 commit 镜像——直接 set 即可，测试每次 getState()）与 `approval-guard.ts`**

```typescript
// approval-guard.ts
// 统一审批出口：diff 按钮条与聊天卡快路径共用。spec §7：用户未保存修改永远优先，
// 脏标签存在时允许按钮不发 allow（main/AgentHost 不感知编辑器状态）
export function makeApprovalGuard(deps: {
  hasDirtyTab(path: string): boolean
  respond(id: string, allow: boolean): void
  notify(msg: string): void
}): (id: string, allow: boolean, path?: string) => boolean {
  return (id, allow, path) => {
    if (allow && path && deps.hasDirtyTab(path)) {
      deps.notify(`该文件有未保存的修改，请先处理：${path}`)
      return false
    }
    deps.respond(id, allow)
    return true
  }
}
```

```typescript
// editor-store.ts 关键实现（纯逻辑，Monaco 不在此层）
import { create } from 'zustand'
import type { ApprovalPayload } from '../../../main/src/protocol.js'

export interface FileTab { id: string; kind: 'file'; path: string; content: string; knownMtime: number; dirty: boolean; conflict: boolean }
export interface DiffTab { id: string; kind: 'diff'; approvalId: string; path: string; original: string; modified: string; resolved: 'allowed' | 'denied' | null }
export type EditorTab = FileTab | DiffTab

export function buildDiffModified(payload: ApprovalPayload, original: string): string {
  if (payload.kind === 'write') return payload.content ?? ''
  return original.split(payload.oldString ?? '').join(payload.newString ?? '')
}

interface EditorStore { /* 上文 Interfaces 列出的字段与方法 */ }

export const createEditorStore = () => create<EditorStore>((set, get) => ({
  tabs: [], activeTabId: null, agentTouched: [], recentPaths: [], notice: null,
  setNotice: (msg) => set({ notice: msg }),
  openFile: (path, content, mtimeMs) => {
    const existing = get().tabs.find((t) => t.kind === 'file' && t.path === path)
    if (existing) { set({ activeTabId: existing.id }); return existing.id }
    const id = `f:${path}`
    set((s) => ({
      tabs: [...s.tabs, { id, kind: 'file', path, content, knownMtime: mtimeMs, dirty: false, conflict: false }],
      activeTabId: id,
      recentPaths: [path, ...s.recentPaths.filter((p) => p !== path)].slice(0, 10),
    }))
    return id
  },
  closeTab: (id) => set((s) => {
    const tabs = s.tabs.filter((t) => t.id !== id)
    return { tabs, activeTabId: s.activeTabId === id ? (tabs.at(-1)?.id ?? null) : s.activeTabId }
  }),
  activate: (id) => set({ activeTabId: id }),
  updateContent: (id, content) => set((s) => ({
    tabs: s.tabs.map((t) => t.id === id && t.kind === 'file' ? { ...t, content, dirty: true } : t),
  })),
  markSaved: (id, mtimeMs) => set((s) => ({
    tabs: s.tabs.map((t) => t.id === id && t.kind === 'file' ? { ...t, dirty: false, conflict: false, knownMtime: mtimeMs } : t),
  })),
  setConflict: (id, conflict) => set((s) => ({
    tabs: s.tabs.map((t) => t.id === id && t.kind === 'file' ? { ...t, conflict } : t),
  })),
  reloadContent: (id, content, mtimeMs) => set((s) => ({
    tabs: s.tabs.map((t) => t.id === id && t.kind === 'file' ? { ...t, content, knownMtime: mtimeMs } : t),
  })),
  openDiff: (approvalId, path, original, modified) => {
    const id = `d:${approvalId}`
    set((s) => ({ tabs: [...s.tabs.filter((t) => !(t.kind === 'diff' && t.approvalId === approvalId)), { id, kind: 'diff', approvalId, path, original, modified, resolved: null }], activeTabId: id }))
    return id
  },
  resolveDiff: (approvalId, allowed) => set((s) => ({
    tabs: s.tabs.map((t) => t.kind === 'diff' && t.approvalId === approvalId ? { ...t, resolved: (allowed ? 'allowed' : 'denied') as 'allowed' | 'denied' } : t),
  })),
  markAgentTouched: (path) => set((s) => ({ agentTouched: s.agentTouched.includes(path) ? s.agentTouched : [...s.agentTouched, path] })),
  clearAgentTouched: (path) => set((s) => ({ agentTouched: s.agentTouched.filter((p) => p !== path) })),
  hasDirtyTab: (path) => get().tabs.some((t) => t.kind === 'file' && t.path === path && t.dirty),
}))
```

- [ ] **Step 4: 跑测试**（`pnpm --filter renderer test` 全绿）
- [ ] **Step 5: 提交** `feat(renderer): editor store with tab lifecycle, conflict state and approval guard`

---

### Task 6: 三栏布局 + FileTree

**Files:**
- Create: `packages/renderer/src/components/FileTree.tsx`
- Modify: `packages/renderer/src/App.tsx`（三栏）、`packages/renderer/src/state/editor-events.ts`（新：fa 事件 → editor-store 的纯映射）

**Interfaces:**
- Consumes: Task 5 editor-store（模块单例 `packages/renderer/src/editor-store-instance.ts` 导出 `useEditorStore`）、`fa.fs.list/create/rename/delete`、`fa.onEvent`。
- Produces: 三栏骨架（左 240px 可折叠 FileTree，中 EditorArea 占位 div（Task 7 填充），右 M2 聊天面板不变）；`editor-events.ts` 导出 `applyEditorEvent(store, ev, fa)`（file-changed/tool-call/tool-result/approval-resolved → editor-store 动作，Task 7/8 复用）。

- [ ] **Step 1: `editor-store-instance.ts` 与 `editor-events.ts`**

```typescript
// editor-store-instance.ts
import { createEditorStore } from './state/editor-store.js'
export const useEditorStore = createEditorStore()
```

```typescript
// editor-events.ts —— fa 事件到 editor-store 的编排（异步读盘等副作用集中在此，store 保持纯）
import type { FaEvent } from '../../../main/src/protocol.js'
import type { useEditorStore } from '../editor-store-instance.js'

export async function applyEditorEvent(ev: FaEvent): Promise<void> {
  const s = useEditorStore.getState()
  switch (ev.type) {
    case 'file-changed': {
      const tab = useEditorStore.getState().tabs.find((t) => t.kind === 'file' && t.path === ev.path)
      if (!tab || tab.kind !== 'file') return
      if (tab.dirty) { s.setConflict(tab.id, true); return }  // 脏：只标记不覆盖（spec §7）
      const r = await window.fa.fs.read(ev.path).catch(() => null)
      if (r) s.reloadContent(tab.id, r.content, r.mtimeMs)
      return
    }
    case 'tool-call': {
      // agent 新建/修改的文件路径：从 tool-call 参数解析（spec §3 联动）
      try {
        const args = JSON.parse(ev.call.arguments) as Record<string, unknown>
        if (typeof args.path === 'string' && (ev.call.name === 'write_file' || ev.call.name === 'edit_file')) {
          s.markAgentTouched(args.path)
        }
      } catch { /* 非 JSON 参数忽略 */ }
      return
    }
    case 'tool-result': {
      // 打开中的文件在 agent 工具完成后刷新（等同 file-changed 路径）
      const touched = useEditorStore.getState().agentTouched
      for (const p of touched) {
        const tab = useEditorStore.getState().tabs.find((t) => t.kind === 'file' && t.path === p)
        if (tab && tab.kind === 'file' && !tab.dirty) {
          const r = await window.fa.fs.read(p).catch(() => null)
          if (r) s.reloadContent(tab.id, r.content, r.mtimeMs)
        }
        s.clearAgentTouched(p)
      }
      return
    }
    case 'approval-resolved': {
      s.resolveDiff(ev.id, ev.allowed)
      return
    }
    default: return
  }
}
```

（App.tsx 的 onEvent 里 `void applyEditorEvent(ev)` 与 chat-store 并行喂。）

- [ ] **Step 2: `FileTree.tsx`**（懒加载树 + 右键菜单 + window.confirm 删除确认 + 行内重命名输入；核心结构）

```tsx
import { useState } from 'react'
import { fa } from '../api/fa.js'
import { useEditorStore } from '../editor-store-instance.js'

interface Node { path: string; name: string; isDir: boolean; expanded?: boolean; loaded?: boolean; children?: Node[] }

export function FileTree({ onOpenFile }: { onOpenFile(path: string): void }): React.JSX.Element {
  const [roots, setRoots] = useState<Node[]>([])
  const [refreshKey, setRefreshKey] = useState(0)
  const [menu, setMenu] = useState<{ x: number; y: number; node: Node | null } | null>(null)
  const [renaming, setRenaming] = useState<{ path: string; value: string } | null>(null)
  const [creating, setCreating] = useState<{ dir: string; kind: 'file' | 'dir'; value: string } | null>(null)
  const agentTouched = useEditorStore((s) => s.agentTouched)

  const reload = async (path: string): Promise<Node[]> =>
    (await fa.fs.list(path)).map((e) => ({ path: path === '.' ? e.name : `${path}/${e.name}`, name: e.name, isDir: e.isDir }))

  useState(() => { void reload('.').then(setRoots) }) // 挂载即加载根（实现时换成 useEffect + [refreshKey]）
  // ……展开（点击目录 → 若未 loaded 则 reload 子项）、点击文件 → onOpenFile(node.path)、
  // 右键 → setMenu；菜单项：新建文件/文件夹（setCreating 到该目录）、重命名（setRenaming）、
  // 删除（window.confirm 后 fa.fs.delete → 局部刷新）
  // creating/renaming 确认 → fa.fs.create / fa.fs.rename → 刷新受影响目录
  // 顶栏：⟳ 手动刷新按钮（setRefreshKey(k => k+1)）
  return (/* 树渲染 + 自定义右键菜单 div + 行内输入行；agentTouched 中的路径名旁渲染小圆点 */)
}
```

（完整 JSX 结构由实现者按上述骨架补齐——组件是薄壳无渲染测试，交互清单见验收；每个 fa.fs 调用的 rejection 用 `.catch((e) => useEditorStore.getState().setNotice(String(e)))` 兜底显示。）

- [ ] **Step 3: `App.tsx` 三栏**

```tsx
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header>{/* M2 顶栏不变 */}</header>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ width: 240, borderRight: '1px solid #ddd', overflowY: 'auto' }}>
          <FileTree onOpenFile={(p) => void openFileFromDisk(p)} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }} id="editor-area"><!-- Task 7 EditorArea --></div>
        <div style={{ width: 420, borderLeft: '1px solid #ddd', display: 'flex', flexDirection: 'column' }}>
          <ChatPanel /><Composer />
        </div>
      </div>
    </div>
  )
// openFileFromDisk(p): const r = await fa.fs.read(p); useEditorStore.getState().openFile(p, r.content, r.mtimeMs); void fa.fs.watch(p)
```

- [ ] **Step 4: 验证 + 提交**

Run: `pnpm --filter renderer test`（全绿，无新测）+ `npx tsc --noEmit`（packages/renderer）
```bash
git add packages/renderer/src
git commit -m "feat(renderer): three-column layout with lazy file tree"
```

---

### Task 7: Monaco EditorArea（多标签、保存、冲突横幅、watch 接线）

**Files:**
- Create: `packages/renderer/src/components/EditorArea.tsx`、`packages/renderer/src/components/MonacoPane.tsx`（React.lazy 目标）
- Modify: `packages/renderer/package.json`（+monaco-editor）、`packages/renderer/src/App.tsx`（挂 EditorArea）

**Interfaces:**
- Consumes: Task 5/6 editor-store、`fa.fs.write/read/watch/unwatch`、FaEvent 路由（App 已喂 applyEditorEvent）。
- Produces: 完整编辑体验；`EditorArea` 导出供 App 使用。

- [ ] **Step 1: 依赖** — `pnpm --filter renderer add monaco-editor`
- [ ] **Step 2: `MonacoPane.tsx`**（lazy 加载的 Monaco 封装；每 path 一个 model，切标签复用）

```tsx
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { useEffect, useRef } from 'react'
import { useEditorStore } from '../editor-store-instance.js'

// 本地 worker：语法高亮基础能力零外链（spec §2：禁 CDN）
self.MonacoEnvironment = { getWorker: () => new EditorWorker() }

export function MonacoPane(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const activeFile = useEditorStore((s) => s.tabs.find((t) => t.id === s.activeTabId))

  useEffect(() => {
    const editor = monaco.editor.create(ref.current!, { automaticLayout: true, theme: 'vs' })
    editorRef.current = editor
    editor.onDidChangeModelContent(() => {
      const id = useEditorStore.getState().activeTabId
      if (id) useEditorStore.getState().updateContent(id, editor.getValue())
    })
    return () => editor.dispose()
  }, [])

  useEffect(() => { // 激活/内容变化 → 绑定对应 model
    if (!editorRef.current || !activeFile || activeFile.kind !== 'file') return
    const uri = monaco.Uri.parse('inmemory:///' + activeFile.path)
    let model = monaco.editor.getModel(uri)
    if (!model) model = monaco.editor.createModel(activeFile.content, undefined, uri)
    else if (model.getValue() !== activeFile.content && !activeFile.dirty) model.setValue(activeFile.content)
    editorRef.current.setModel(model)
  }, [activeTabId, activeFile?.kind === 'file' ? (activeFile as { content: string }).content : null])

  // Ctrl+S：保存当前文件标签（脏或非文件标签不响应）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && !e.nativeEvent.isComposing) {
        e.preventDefault()
        const s = useEditorStore.getState()
        const t = s.tabs.find((x) => x.id === s.activeTabId)
        if (!t || t.kind !== 'file') return
        void fa.fs.write(t.path, t.content, t.knownMtime).then((r) => {
          if (r.ok) { s.markSaved(t.id, r.mtimeMs); void fa.fs.watch(t.path) }
          else { s.setConflict(t.id, true); s.setNotice('保存冲突：文件已在磁盘上更改') }
        }).catch((err: unknown) => s.setNotice(String(err)))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}
```

- [ ] **Step 3: `EditorArea.tsx`**（标签栏 + 欢迎页 + 冲突横幅 + lazy Monaco + 关标签时 unwatch）

```tsx
import { lazy, Suspense } from 'react'
import { fa } from '../api/fa.js'
import { useEditorStore } from '../editor-store-instance.js'
const MonacoPane = lazy(() => import('./MonacoPane.js').then((m) => ({ default: m.MonacoPane })))

export function EditorArea(): React.JSX.Element {
  const tabs = useEditorStore((s) => s.tabs)
  const activeId = useEditorStore((s) => s.activeTabId)
  const notice = useEditorStore((s) => s.notice)
  const recents = useEditorStore((s) => s.recentPaths)
  const active = tabs.find((t) => t.id === activeId)
  const close = (id: string) => {
    const t = tabs.find((x) => x.id === id)
    if (t?.kind === 'file' && t.dirty && !window.confirm('有未保存的修改，确定关闭？')) return
    if (t?.kind === 'file') void fa.fs.unwatch(t.path).catch(() => {})
    useEditorStore.getState().closeTab(id)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid #ddd' }}>
        {tabs.map((t) => (
          <div key={t.id} onClick={() => useEditorStore.getState().activate(t.id)}
               onAuxClick={(e) => { if (e.button === 1) close(t.id) }}
               style={{ padding: '4px 10px', cursor: 'pointer', borderBottom: activeId === t.id ? '2px solid #1a73e8' : 'none',
                        color: t.kind === 'file' && t.conflict ? '#b8860b' : undefined }}>
            {t.kind === 'file' ? `${t.path.split('/').at(-1)}${t.dirty ? ' •' : ''}` : `diff: ${t.path.split('/').at(-1)}`}
            <span onClick={(e) => { e.stopPropagation(); close(t.id) }} style={{ marginLeft: 6 }}>×</span>
          </div>
        ))}
      </div>
      {notice && <div style={{ background: '#fff3cd', padding: 6 }}>{notice} <button onClick={() => useEditorStore.getState().setNotice(null)}>×</button></div>}
      {active?.kind === 'file' && active.conflict && (
        <div style={{ background: '#ffe9a8', padding: 6, display: 'flex', gap: 8 }}>
          <span style={{ flex: 1 }}>文件已在磁盘上更改（{active.path}）</span>
          <button onClick={() => { const s = useEditorStore.getState(); void fa.fs.read(active.path).then((r) => { s.reloadContent(active.id, r.content, r.mtimeMs); s.setConflict(active.id, false); s.setNotice(null) }) }}>加载磁盘版本（丢弃我的修改）</button>
          <button onClick={() => useEditorStore.getState().setConflict(active.id, false)}>保留我的版本（继续编辑）</button>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        {active?.kind === 'diff' ? (
          /* Task 8 填充 DiffPane 占位 */ <div>diff 预留</div>
        ) : tabs.length === 0 ? (
          <div style={{ padding: 24, color: '#888' }}>欢迎。<div>最近打开：{recents.map((p) => <div key={p} style={{ cursor: 'pointer', color: '#1a73e8' }}>{p}</div>)}</div></div>
        ) : (
          <Suspense fallback={<div style={{ padding: 24, color: '#888' }}>编辑器加载中…</div>}><MonacoPane /></Suspense>
        )}
      </div>
    </div>
  )
}
```

（App.tsx 中间栏替换为 `<EditorArea />`；`fa` 在 MonacoPane 中从 `../api/fa.js` 导入。）

- [ ] **Step 4: 构建验证** — `pnpm --filter main build`（electron-vite 会打包 renderer 的 worker；若 `?worker` 报错，按 electron-vite 文档改用 `new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url), { type: 'module' })` 等价写法）+ `pnpm -r test` + renderer `npx tsc --noEmit`
- [ ] **Step 5: 提交** `feat(renderer): monaco editor area with tabs, save and conflict banner`

---

### Task 8: diff 确认门 UI（DiffPane + 审批卡升级 + 守卫接线 + 路径跳转）

**Files:**
- Create: `packages/renderer/src/components/DiffPane.tsx`
- Modify: `packages/renderer/src/components/ApprovalCard.tsx`（统计行 + 查看 diff + 快路径走守卫）、`ToolCard.tsx`（路径可点击）、`chat-store.ts`（approval item 带 payload）、`EditorArea.tsx`（挂 DiffPane）

**Interfaces:**
- Consumes: Task 5 `buildDiffModified`/`makeApprovalGuard`、Task 4 `approval-required.payload`。
- Produces: 完整 diff 门（spec §6）；`requestApproval(id, allow, path?)` 模块级守卫实例（`packages/renderer/src/approval-guard-instance.ts`）。

- [ ] **Step 1: chat-store 扩展** — `ChatItem` approval 分支加 `payload?: ApprovalPayload`，`approval-required` case 带上；补一条 store 测试（payload 进 item）。
- [ ] **Step 2: `approval-guard-instance.ts`**

```typescript
import { fa } from './api/fa.js'
import { useEditorStore } from './editor-store-instance.js'
import { makeApprovalGuard } from './state/approval-guard.js'

export const requestApproval = makeApprovalGuard({
  hasDirtyTab: (p) => useEditorStore.getState().hasDirtyTab(p),
  respond: (id, allow) => { void fa.respondApproval(id, allow) },
  notify: (msg) => { useEditorStore.getState().setNotice(msg) },
})
```

- [ ] **Step 3: `DiffPane.tsx`**

```tsx
import { lazy, Suspense, useEffect, useRef } from 'react'
import { fa } from '../api/fa.js'
import { requestApproval } from '../approval-guard-instance.js'
const MonacoDiff = lazy(() => import('./MonacoDiff.js').then((m) => ({ default: m.MonacoDiff })))

export function DiffPane({ tab }: { tab: DiffTab }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 8, padding: 8, borderBottom: '1px solid #ddd', alignItems: 'center' }}>
        <strong>{tab.path}</strong>
        {tab.resolved === null ? (<>
          <button onClick={() => requestApproval(tab.approvalId, true, tab.path)}>✓ 允许</button>
          <button onClick={() => requestApproval(tab.approvalId, false)}>✗ 拒绝</button>
          <button onClick={() => { void fa.setAutoApprove(true); requestApproval(tab.approvalId, true, tab.path) }}>✓ 允许且本会话不再询问</button>
        </>) : <span style={{ color: '#666' }}>已{tab.resolved === 'allowed' ? '允许' : '拒绝'}</span>}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Suspense fallback={<div style={{ padding: 24 }}>diff 加载中…</div>}><MonacoDiff original={tab.original} modified={tab.modified} /></Suspense>
      </div>
    </div>
  )
}
```

`MonacoDiff.tsx`（与 MonacoPane 同款 worker 配置，`monaco.editor.createDiffEditor(el, { readOnly: true, automaticLayout: true, renderSideBySide: true })`，`setModel({ original: createModel(original), modified: createModel(modified) })`，卸载 dispose）。

- [ ] **Step 4: 审批卡升级（ApprovalCard.tsx）**

统计行（纯函数放 `state/diff-stats.ts` + 测试：`+A/−B 行`、write 新文件/覆盖判定）：

```typescript
export function diffStats(payload: ApprovalPayload | undefined, original: string): string {
  if (!payload) return ''
  const lines = (s: string) => s.split('\n').length
  if (payload.kind === 'write') return original === '' ? `新文件 · ${lines(payload.content ?? '')} 行` : `覆盖 · +${lines(payload.content ?? '')}/−${lines(original)} 行`
  const modified = original.split(payload.oldString ?? '').join(payload.newString ?? '')
  return `替换 1 处 · +${lines(payload.newString ?? '')}/−${lines(payload.oldString ?? '')} 行`
}
```

卡片结构：`<strong>{action}</strong> {payload?.path ?? ''} · {diffStats(...)}` + 三按钮 `[查看 diff] [允许] [拒绝]`；「查看 diff」→ `fa.fs.read(path)`（不存在则空串）→ `useEditorStore.getState().openDiff(id, path, original, buildDiffModified(payload, original))`；允许/拒绝均走 `requestApproval(id, allow, payload?.path)`；操作后定格沿用 M2 的 approval-resolved 机制。

- [ ] **Step 5: ToolCard 路径跳转 + EditorArea 挂 DiffPane**

ToolCard 组件加 `onOpenPath?: (path: string) => void`（从 `call.arguments` 解析 path，`argsSummary` 改为可点击的路径文本）；MessageItem 传入 `onOpenFile`（App 的 `openFileFromDisk` 下传或直接引模块函数）。EditorArea 的 diff 占位替换为 `<DiffPane tab={active as DiffTab} />`。

- [ ] **Step 6: 验证 + 提交**

Run: `pnpm -r test`（renderer 新增 payload/diff-stats 测试）+ `pnpm --filter main build`
```bash
git add packages/renderer/src
git commit -m "feat(renderer): diff approval gate with monaco diff pane and guarded approvals"
```

---

### Task 9: 全量验证 + README + 冒烟清单

**Files:**
- Modify: `README.md`（架构图更新 + 编辑器/diff 门使用说明）

- [ ] **Step 1: README 更新** — 架构段落补 `packages/renderer` 的 FileTree/EditorArea/DiffPane；使用说明补「Ctrl+S 保存」「审批卡查看 diff」「冲突横幅」三段中文说明。
- [ ] **Step 2: 全量验证**

Run: `pnpm -r test && pnpm --filter main build` → 全绿

- [ ] **Step 3: 手动冒烟清单（controller/用户执行，spec §10 十条逐条核对）**
- [ ] **Step 4: 提交** `docs: update README for M3 editor features`
