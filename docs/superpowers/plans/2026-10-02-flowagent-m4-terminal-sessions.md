# FlowAgent M4（终端 + 多会话）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 内置 pty 终端（xterm，分离式）、多会话管理（sessions 目录 + 下拉列表 + 切换/删除 + 旧文件迁移）、token 精确计量、Monaco URI 前置小修。

**Architecture:** main 新增 TerminalService（注入 pty 工厂，attach 缓冲协议）与 session-service（纯函数）；AgentHost 增加 reset() 支持会话切换；agent-core provider 增加 stream_options/usage 事件并沿既有事件管道透传到顶栏。renderer 中间列拆上下（EditorArea + TerminalPanel），聊天面板顶栏加会话下拉。

**Tech Stack:** node-pty（或 @homebridge/node-pty-prebuilt-multiarch 兜底）、@xterm/xterm + @xterm/addon-fit、vitest。

**Spec:** `docs/superpowers/specs/2026-10-02-flowagent-m4-terminal-sessions-design.md`

## Global Constraints

- 全 TypeScript strict；renderer 禁止运行时 import `agent-core`（protocol.ts 再导出仅 type-only）。
- Electron 安全基线不变：`contextIsolation: true`、`nodeIntegration: false`、preload 仅暴露 `fa`。
- 组件薄壳不写渲染测试；main 侧新服务必须注入依赖可测（假 pty / 临时目录）。
- usage 为覆盖式累计（单次请求已含全量历史，不逐条相加）。
- 测试命令：`pnpm -r test`（基线 115/115：agent-core 67 + main 25 + renderer 23）。
- 提交信息 conventional commits；文档中文。
- Windows 优先（pwsh → powershell 回退）；注意清理 `ELECTRON_RUN_AS_NODE` 后再跑 electron。

## Review Focus

spec 未逐条展开、但最容易咬人的五类故障模式（每条已把测试落到对应任务）：

1. **attach 前的 pty 输出丢头**：shell 横幅在 renderer 订阅前产出会被丢——attach 必须返回缓冲且此后转推送 → Task 3 的 `attach returns buffered output then streams`。
2. **运行中切会话**：reset 必须抛错（UI 禁用只是第一道防线）→ Task 4 的 `reset throws while running`。
3. **usage 覆盖式累计被写成累加**：逐条相加会把历史重复计费数倍 → Task 6 的 `usage takes latest not sum`。
4. **旧 session.jsonl 迁移丢历史**：迁移后必须可完整 load、原文件删除 → Task 4 的 `migrateLegacy moves file and keeps history`。
5. **端点不带 usage 的流**：无 usage 字段时不得产出 usage 事件或报错（优雅降级）→ Task 2 的 `no usage in stream yields no usage event`。

---

### Task 1: pty spike（原生模块可行性）+ Monaco URI 前置小修

**Files:**
- Create: `scripts/pty-spike.cjs`
- Modify: `packages/main/package.json`（+node-pty、+@electron/rebuild devDep）、`packages/renderer/src/components/MonacoPane.tsx`（URI 按段转义）、`.gitignore`（无需——spike 脚本入库备诊断用）

**Interfaces:**
- Produces: 可在 Electron 主进程加载的 pty 依赖（后续 Task 3/5 消费 `require('node-pty')` 或兜底包）；spike 结论记入提交信息/报告。

- [ ] **Step 1: 安装依赖与重编译工具**

```powershell
pnpm --filter main add node-pty
pnpm --filter main add -D @electron/rebuild
```

- [ ] **Step 2: 针对当前 Electron 版本重编译 node-pty**

```powershell
cd packages/main
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"   # 头文件下载走镜像（本机直连 github 不通）
npx electron-rebuild -f -w node-pty
```

（若头文件下载仍失败：`$env:electron_config_cache` 指向已有缓存目录，或改用 npm 镜像 headers：`$env:npm_config_disturl = "https://npmmirror.com/mirrors/electron"`。）

- [ ] **Step 3: 写 spike 脚本 `scripts/pty-spike.cjs`**

```javascript
// 诊断脚本：验证 node-pty 在 Electron 主进程可加载并产出数据。
// 用法（仓库根，必须先清掉 ELECTRON_RUN_AS_NODE）：
//   pnpm --filter main exec electron ../../scripts/pty-spike.cjs
const pty = require('node-pty')
const proc = pty.spawn('powershell.exe', ['-NoProfile', '-Command', 'Write-Output PTY_OK'], { name: 'xterm', cols: 80, rows: 24, cwd: process.cwd() })
let out = ''
proc.onData((d) => { out += d })
proc.onExit(({ exitCode }) => {
  console.log('CHUNK:', JSON.stringify(out))
  console.log(exitCode === 0 && out.includes('PTY_OK') ? 'SPIKE_PASS' : 'SPIKE_FAIL')
  process.exit(exitCode === 0 && out.includes('PTY_OK') ? 0 : 1)
})
setTimeout(() => { console.error('SPIKE_TIMEOUT', JSON.stringify(out)); process.exit(2) }, 15000)
```

- [ ] **Step 4: 运行 spike（新开的干净终端或先 `Remove-Item Env:ELECTRON_RUN_AS_NODE`）**

Run: `pnpm --filter main exec electron ../../scripts/pty-spike.cjs`
Expected: 输出含 `PTY_OK` 与 `SPIKE_PASS`，exit 0。

- [ ] **Step 5: 失败兜底**

node-pty 重编译或加载失败 → `pnpm --filter main remove node-pty && pnpm --filter main add @homebridge/node-pty-prebuilt-multiarch`，spike 脚本改 `require('@homebridge/node-pty-prebuilt-multiarch')`，重复 Step 4（prebuilt 含 Electron 预编译，通常免重编译）。两个包 API 完全一致，后续任务统一从 `packages/main/src/pty-factory.ts` 导入以便一键切换。**两个都失败则报告 BLOCKED（M4 阻断项，spec §7 明示）。**

- [ ] **Step 6: 建统一入口 `packages/main/src/pty-factory.ts`**（`PtyLike` 接口在此定义，Task 3 的 terminal-service 从这里导入，避免前向依赖）

```typescript
// 统一 pty 入口：spike 结论决定 require 哪个包，切换只改此文件
import nodePty from 'node-pty' // 或 '@homebridge/node-pty-prebuilt-multiarch'

export interface PtyLike {
  write(d: string): void
  resize(c: number, r: number): void
  kill(): void
  onData(cb: (d: string) => void): void
  onExit(cb: () => void): void
}

export function spawnPty(opts: { cwd: string; cols: number; rows: number; shell?: string }): PtyLike {
  const shell = opts.shell ?? (process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL ?? 'bash')
  return nodePty.spawn(shell, [], { name: 'xterm-256color', cols: opts.cols, rows: opts.rows, cwd: opts.cwd }) as unknown as PtyLike
}
```

- [ ] **Step 7: Monaco URI 前置小修（MonacoPane.tsx）**

```typescript
// 原：const uri = monaco.Uri.parse('inmemory:///' + encodeURI(activeFile.path))
// 改为按段转义（encodeURI 不处理 # 和 ?，含此类字符的文件名会映射错乱）：
const uri = monaco.Uri.parse('inmemory:///' + activeFile.path.split('/').map(encodeURIComponent).join('/'))
```

- [ ] **Step 8: 验证 + 提交**

Run: `pnpm -r test`（115/115 无回归）+ `pnpm --filter main build`

```bash
git add packages/main/package.json packages/main/src/pty-factory.ts scripts/pty-spike.cjs pnpm-lock.yaml packages/renderer/src/components/MonacoPane.tsx
git commit -m "chore(main): verify pty under electron and fix monaco uri escaping"
```

---

### Task 2: agent-core usage 计量（stream_options + ProviderEvent）

**Files:**
- Modify: `packages/agent-core/src/types.ts`（ProviderEvent/AgentEvent 各加 usage 变体）、`packages/agent-core/src/providers/openai.ts`、`packages/agent-core/src/loop.ts`
- Test: `packages/agent-core/src/providers/openai.test.ts`（追加）、`packages/agent-core/src/loop.test.ts`（追加）

**Interfaces:**
- Produces（Task 5 透传、Task 7 显示）：

```typescript
// ProviderEvent 与 AgentEvent 各新增：
| { type: 'usage'; promptTokens: number; completionTokens: number }
```

- [ ] **Step 1: 写失败测试（openai.test.ts 追加，沿用 sseResponse 假 fetch 手法；另需捕获请求体）**

```typescript
describe('usage accounting', () => {
  it('parses usage chunk and requests include_usage', async () => {
    let capturedBody = ''
    const sse = sseResponse([
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
      'data: [DONE]\n\n',
    ])
    const p = new OpenAICompatProvider({
      baseURL: 'http://x', apiKey: 'k', model: 'm', maxRetries: 0, backoffMs: 1,
      fetchImpl: (async (_u: unknown, init?: RequestInit) => {
        capturedBody = String(init?.body)
        return sse
      }) as unknown as typeof fetch,
    })
    const events: string[] = []
    for await (const ev of p.stream([{ role: 'user', content: 'q' }], [])) events.push(ev.type)
    expect(capturedBody).toContain('"stream_options":{"include_usage":true}')
    expect(events).toEqual(['text-delta', 'usage', 'result'])
    // 具体数值断言（收集事件对象）：
  })
  it('no usage in stream yields no usage event', async () => {
    const sse = sseResponse([
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: [DONE]\n\n',
    ])
    const p = new OpenAICompatProvider({ baseURL: 'http://x', apiKey: 'k', model: 'm', maxRetries: 0, backoffMs: 1, fetchImpl: (async () => sse) as unknown as typeof fetch })
    const events: string[] = []
    for await (const ev of p.stream([{ role: 'user', content: 'q' }], [])) events.push(ev.type)
    expect(events).not.toContain('usage')
  })
})
```

（第一个用例把 events 收集为对象数组，补 `expect(usageEvent).toEqual({ type: 'usage', promptTokens: 10, completionTokens: 5 })` 形式断言。）

- [ ] **Step 2: 跑测试确认失败**（usage 事件不存在、请求体无 stream_options）
- [ ] **Step 3: 实现**

`types.ts`：ProviderEvent 与 AgentEvent 各加上述 usage 变体。

`openai.ts`：body 加 `stream_options: { include_usage: true }`；SSE 解析块改为一次 parse、先查 usage：

```typescript
    for await (const data of parseSse(res.body)) {
      sawData = true
      if (data === '[DONE]') break
      let obj: { choices?: { delta: OpenAiDelta }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }
      try { obj = JSON.parse(data) } catch { continue }
      if (obj.usage && typeof obj.usage.prompt_tokens === 'number') {
        yield { type: 'usage', promptTokens: obj.usage.prompt_tokens, completionTokens: obj.usage.completion_tokens ?? 0 }
      }
      const delta = obj.choices?.[0]?.delta ?? {}
      if (delta.content) { content += delta.content; yield { type: 'text-delta', text: delta.content } }
      // ……tool_calls 逻辑不变……
    }
```

`loop.ts`：provider 消费循环的 else 分支（现处理 result）前加：

```typescript
          if (ev.type === 'usage') { yield { type: 'usage', promptTokens: ev.promptTokens, completionTokens: ev.completionTokens }; continue }
```

`loop.test.ts` 追加：假 provider yield usage 后 result → 断言 Agent 事件序列含 `{type:'usage', promptTokens: 3, completionTokens: 2}`。

- [ ] **Step 4: 跑测试**（agent-core 71/71 = 67+4）
- [ ] **Step 5: 提交** `feat(core): stream usage accounting via include_usage`

---

### Task 3: main TerminalService（attach 缓冲协议）

**Files:**
- Create: `packages/main/src/terminal-service.ts`
- Test: `packages/main/src/terminal-service.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `PtyLike` 与 `spawnPty`（pty-factory.ts 导出，本文件 `import type { PtyLike } from './pty-factory.js'`）。
- Produces（Task 5 IPC 映射）：

```typescript
export class TerminalService {
  constructor(deps: { spawnPty(o: { cwd: string; cols: number; rows: number }): PtyLike; onChunk(d: string): void; onExit(): void })
  start(cwd: string): void        // 幂等：已启动则先 kill
  write(data: string): void
  resize(cols: number, rows: number): void
  attach(cols: number, rows: number): string  // 返回缓冲（64KB 滚动窗口），此后 onChunk 直推
  kill(): void
  restart(): void                 // kill + start；已 attach 则继续直推，缓冲重置
}
```

- [ ] **Step 1: 写失败测试（假 pty 工厂）**

```typescript
import { describe, expect, it, vi } from 'vitest'
import { TerminalService, type PtyLike } from './terminal-service.js'

function fakePty(): { pty: PtyLike; emitData: (d: string) => void; emitExit: () => void; writes: string[] } {
  let dataCb: ((d: string) => void) | undefined
  let exitCb: (() => void) | undefined
  return {
    pty: {
      write: (d) => { writes.push(d) }, // 注意：闭包引用见下——实现时用对象级数组
      resize: () => {}, kill: () => { exitCb?.() },
      onData: (cb) => { dataCb = cb }, onExit: (cb) => { exitCb = cb },
    },
    emitData: (d) => dataCb?.(d), emitExit: () => exitCb?.(),
    writes: [] as string[],
  }
}
// （上面 write 闭包引用自身数组的写法在实现时修正：const writes: string[] = [] 先声明再引用。）

describe('TerminalService', () => {
  it('attach returns buffered output then streams', () => {
    const chunks: string[] = []
    const f = fakePty()
    const svc = new TerminalService({ spawnPty: () => f.pty, onChunk: (d) => chunks.push(d), onExit: () => {} })
    svc.start('E:/w')
    f.emitData('banner\r\n')          // attach 前的输出 → 进缓冲
    expect(chunks).toEqual([])        // 未 attach：不推送
    const buffered = svc.attach(100, 30)
    expect(buffered).toBe('banner\r\n')
    f.emitData('live')
    expect(chunks).toEqual(['live'])  // attach 后：直推
  })
  it('write and resize pass through', () => {
    const f = fakePty()
    const resized: [number, number][] = []
    f.pty.resize = (c, r) => { resized.push([c, r]) }
    const svc = new TerminalService({ spawnPty: () => f.pty, onChunk: () => {}, onExit: () => {} })
    svc.start('E:/w'); svc.attach(80, 24)
    svc.write('dir\r')
    expect(f.writes).toEqual(['dir\r'])
    svc.resize(120, 40)
    expect(resized).toEqual([[120, 40]])
  })
  it('exit fires onExit once and restart keeps streaming', () => {
    const chunks: string[] = []
    let exited = 0
    const f = fakePty()
    const svc = new TerminalService({ spawnPty: () => f.pty, onChunk: (d) => chunks.push(d), onExit: () => { exited++ } })
    svc.start('E:/w'); svc.attach(80, 24)
    f.emitExit()
    expect(exited).toBe(1)
    svc.restart()
    f.emitData('new banner')
    expect(chunks).toEqual(['new banner']) // 已 attach：restart 后仍直推（不回缓冲）
  })
  it('buffer caps at 64KB with tail kept', () => {
    const f = fakePty()
    const svc = new TerminalService({ spawnPty: () => f.pty, onChunk: () => {}, onExit: () => {} })
    svc.start('E:/w')
    f.emitData('x'.repeat(80_000))
    expect(svc.attach(80, 24).length).toBeLessThanOrEqual(65_536)
    expect(svc.attach.length).toBe(1) // 幂等提示：attach 二次调用返回空串（实现约定）
  })
})
```

（第 4 个用例补二次 attach 返回 `''` 的断言：`expect(svc.attach(80,24)).toBe('')`。）

- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**（要点：`private buffer = ''`、`attached = false`；onData → attached ? onChunk : buffer 追加且超 64KB 保留尾部；attach：apply resize、返回 buffer、清空、attached = true；kill 触发 onExit 一次防重；start 幂等。）
- [ ] **Step 4: 跑测试**（main 30/30 = 25+5）
- [ ] **Step 5: 提交** `feat(main): terminal service with attach-buffer protocol`

---

### Task 4: session-service + AgentHost.reset

**Files:**
- Create: `packages/main/src/session-service.ts`
- Modify: `packages/main/src/agent-host.ts`
- Test: `packages/main/src/session-service.test.ts`、`packages/main/src/agent-host.test.ts`（追加）

**Interfaces:**
- Produces（Task 5/6 消费）：

```typescript
export interface SessionMeta { file: string; title: string; mtimeMs: number }
listSessions(dir: string): SessionMeta[]          // 按 mtimeMs 降序；title=首条 user 消息前 40 字符，无则 '(空会话)'
createSession(dir: string): SessionMeta           // 文件名 `${YYYY-MM-DDTHHmmss}-${随机4位hex}.jsonl`（冒号已剔除，Windows 合法）
deleteSession(dir: string, file: string): void    // 文件名 jail：basename 校验，拒绝路径分隔符
migrateLegacy(dir: string): string | null         // ../session.jsonl → sessions/；同名加 -1 后缀重试一次
// AgentHost 新增：
reset(): void                                     // agent=null、pendingHistory=null；running 时抛 'agent is busy'
```

- [ ] **Step 1: 写失败测试 session-service.test.ts**

```typescript
import { describe, expect, it, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listSessions, createSession, deleteSession, migrateLegacy } from './session-service.js'

let dir: string
beforeEach(() => { dir = join(mkdtempSync(join(tmpdir(), 'fa-sess-')), 'sessions'); mkdirSync(dir) })

const line = (o: unknown) => JSON.stringify(o) + '\n'

describe('session-service', () => {
  it('listSessions derives title from first user message, sorted by mtime desc', () => {
    writeFileSync(join(dir, 'a.jsonl'), line({ kind: 'message', message: { role: 'user', content: '帮我写一个爬虫脚本，要求支持重试' } }))
    writeFileSync(join(dir, 'b.jsonl'), line({ kind: 'message', message: { role: 'system', content: 'sys' } }) + line({ kind: 'message', message: { role: 'user', content: '第二个会话' } }))
    writeFileSync(join(dir, 'c.jsonl'), '') // 空会话
    const list = listSessions(dir)
    expect(list.map((s) => s.file)).toEqual(['c.jsonl', 'b.jsonl', 'a.jsonl']) // mtime 同秒内按写入序，此断言允许乱序容差——实现时改为稳定排序：mtime 相等时按文件名降序
    expect(list.find((s) => s.file === 'a.jsonl')?.title).toBe('帮我写一个爬虫脚本，要求支持重试'.slice(0, 40))
    expect(list.find((s) => s.file === 'c.jsonl')?.title).toBe('(空会话)')
  })
  it('createSession makes empty file with timestamped name', () => {
    const meta = createSession(dir)
    expect(meta.title).toBe('(空会话)')
    expect(meta.file).toMatch(/^\d{4}-\d{2}-\d{2}T\d{6}-[0-9a-f]{4}\.jsonl$/)
    expect(existsSync(join(dir, meta.file))).toBe(true)
  })
  it('deleteSession rejects path separators', () => {
    expect(() => deleteSession(dir, '..\\evil.jsonl')).toThrow()
    expect(() => deleteSession(dir, 'sub/x.jsonl')).toThrow()
    writeFileSync(join(dir, 'ok.jsonl'), '')
    deleteSession(dir, 'ok.jsonl')
    expect(readdirSync(dir)).not.toContain('ok.jsonl')
  })
  it('migrateLegacy moves old session.jsonl keeping history', () => {
    const root = dirnameOf(dir) // 测试里用 dir 的父目录放 session.jsonl
    writeFileSync(join(root, 'session.jsonl'), line({ kind: 'message', message: { role: 'user', content: '旧会话' } }))
    const moved = migrateLegacy(dir)
    expect(moved).toBeTruthy()
    expect(existsSync(join(root, 'session.jsonl'))).toBe(false)
    const list = listSessions(dir)
    expect(list.some((s) => s.file === moved && s.title === '旧会话')).toBe(true)
  })
  it('migrateLegacy is noop when no legacy file', () => {
    expect(migrateLegacy(dir)).toBeNull()
  })
})
```

（`dirnameOf` 用 `dirname(dir)` 导入实现；mtime 同秒排序按注释采用“mtime 相等按文件名降序”稳定化，测试断言相应固定。）

- [ ] **Step 2: agent-host 追加测试**

```typescript
  it('reset throws while running and clears state when idle', async () => {
    let release!: () => void
    async function* gen(): AsyncGenerator<AgentEvent> {
      yield { type: 'message-delta', text: 'x' }
      await new Promise<void>((r) => { release = r })
      yield { type: 'done', reason: 'completed' }
    }
    const { sink } = eventsOf()
    let created = 0
    const agent = { run: gen, stop: () => {}, loadHistory: () => {} }
    const host = new AgentHost({ emit: sink.emit, makeAgent: () => { created++; return agent } })
    const p = host.send('first')
    await new Promise((r) => setTimeout(r, 10))
    expect(() => host.reset()).toThrow('busy')
    release(); await p
    host.reset()
    await host.send('second')          // reset 后惰性重建
    expect(created).toBe(2)
  })
```

- [ ] **Step 3: 实现**（session-service 纯函数按接口；AgentHost.reset：`if (this.running) throw new Error('agent is busy'); this.agent = null; this.pendingHistory = null`）
- [ ] **Step 4: 跑测试**（main 36/36 = 30+5+1）
- [ ] **Step 5: 提交** `feat(main): session service and agent host reset for session switching`

---

### Task 5: IPC 扩展（term/session 通道 + 事件透传）+ index.ts 接线

**Files:**
- Modify: `packages/main/src/protocol.ts`、`agent-host.ts`（forward 加 usage）、`ipc.ts`、`preload.ts`、`index.ts`
- Test: `packages/main/src/ipc.test.ts`（追加）

**Interfaces:**
- Produces（renderer 消费）：

```typescript
// FaEvent 新增：
| { type: 'term-data'; data: string }
| { type: 'term-exit' }
| { type: 'usage'; promptTokens: number; completionTokens: number }
| { type: 'session-changed'; file: string }
// FaApi 新增：
term: { write(d: string): Promise<void>; resize(c: number, r: number): Promise<void>; attach(c: number, r: number): Promise<string>; restart(): Promise<void> }
session: { list(): Promise<SessionMeta[]>; new(): Promise<SessionMeta>; switch(file: string): Promise<void>; delete(file: string): Promise<SessionMeta[]> }
```

- [ ] **Step 1: protocol.ts 扩展**（上文类型；`SessionMeta` 从 session-service 导入再导出 type。）
- [ ] **Step 2: agent-host forward 加 usage case**（`case 'usage': emit 透传`）。
- [ ] **Step 3: ipc.ts 注册通道**（deps 增加 `term: TerminalService`、`sessions: { list/new/switch_/delete 分工在 index.ts 编排 }`——为可测性 ipc 只透传：`fa:term:*` → deps.term 方法；`fa:session:list/new/delete` → deps.session 对应函数；`fa:session:switch` → deps.onSwitchSession(file)。测试沿用 handlers mock + 假服务，断言映射。）
- [ ] **Step 4: preload.ts 暴露 `fa.term` / `fa.session`**（与既有 fs 子对象同款字面量）。
- [ ] **Step 5: index.ts 接线**

```typescript
// 关键编排（whenReady 内）：
const sessionsDir = join(workspaceRoot!, '.flowagent', 'sessions')
mkdirSync(sessionsDir, { recursive: true })
const migrated = migrateLegacy(sessionsDir)
let currentFile = listSessions(sessionsDir)[0]?.file ?? createSession(sessionsDir).file // mtime 最新；无则新建
const term = new TerminalService({ spawnPty, onChunk: (d) => emit({ type: 'term-data', data: d }), onExit: () => emit({ type: 'term-exit' }) })
term.start(workspaceRoot!)
// sessionFile 变量化：buildRealAgent 闭包读 () => join(sessionsDir, currentFile)
// switchSession(file)：
//   if (host.busy) throw new Error('agent is busy')
//   host.reset()
//   currentFile = file
//   const msgs = repairDanglingToolCalls(loadHistoryOf(file))
//   host.loadSession(msgs) // 既 emit history，又让下次 send 绑定新文件
//   emit({ type: 'session-changed', file })
// 启动恢复：host.loadSession(repairDanglingToolCalls(loadHistoryOf(currentFile)))（保留 ready-gate onReady）
// fa:session:new → createSession + switchSession；fa:session:delete → deleteSession（UI 保证非当前）→ 返回 list()
// win.on('closed') 追加 term.kill()
```

- [ ] **Step 6: 验证 + 提交**（`pnpm -r test` + build；ipc.test 新增 term/session 映射用例）

```bash
git add packages/main/src
git commit -m "feat(main): term and session ipc channels with usage passthrough"
```

---

### Task 6: renderer chat-store usage + TerminalPanel + 布局拆分

**Files:**
- Modify: `packages/renderer/src/state/chat-store.ts`（usage 字段）、`packages/renderer/src/App.tsx`（中间列拆分 + 事件路由）
- Create: `packages/renderer/src/components/TerminalPanel.tsx`
- Test: `packages/renderer/src/state/chat-store.test.ts`（追加）

**Interfaces:**
- Consumes: `fa.term.*`、`term-data/term-exit` 事件（Task 5）。
- Produces: chat-store `usage: { prompt: number; completion: number } | null`（usage 事件覆盖式；history 事件重置 null）；TerminalPanel 组件。

- [ ] **Step 1: chat-store 测试**

```typescript
  it('usage takes latest not sum; history resets', () => {
    const s = createChatStore().getState()
    s.applyEvent({ type: 'usage', promptTokens: 10, completionTokens: 5 })
    s.applyEvent({ type: 'usage', promptTokens: 25, completionTokens: 8 }) // 第二次请求已含全部历史
    expect(s.usage).toEqual({ prompt: 25, completion: 8 })
    s.applyEvent({ type: 'history', messages: [] })                          // 切会话
    expect(s.usage).toBeNull()
  })
```

- [ ] **Step 2: chat-store 实现**（state 加 usage，reduce 两 case：`usage` 覆盖、`history` 时 `usage: null`。）
- [ ] **Step 3: TerminalPanel.tsx**（React.lazy 加载 xterm）

```tsx
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type React from 'react'
import { fa } from '../api/fa.js'
const XtermPane = lazy(() => import('./XtermPane.js').then((m) => ({ default: m.XtermPane })))

export function TerminalPanel({ collapsed }: { collapsed: boolean }): React.JSX.Element {
  const [exited, setExited] = useState(false)
  return (
    <div style={{ height: collapsed ? 28 : 220, borderTop: '1px solid #ddd', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      <div style={{ height: 28, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', fontSize: 13, color: '#666' }}>
        <span>终端</span>
        {exited && <button onClick={() => { setExited(false); void fa.term.restart() }}>重启</button>}
      </div>
      {!collapsed && (
        exited
          ? <div style={{ padding: 12, color: '#888' }}>终端已退出</div>
          : <Suspense fallback={<div style={{ padding: 8, color: '#888', fontSize: 12 }}>终端加载中…</div>}><XtermPane /></Suspense>
      )}
    </div>
  )
}
```

`XtermPane.tsx`（不折叠时才挂载，卸载不杀 pty——面板组件卸载仅隐藏；xterm 实例随组件卸载 dispose，重新展开重建并重新 attach 取缓冲）：

```tsx
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { fa } from '../api/fa.js'

export function XtermPane(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const term = new Terminal({ fontSize: 13, cursorBlink: true })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(ref.current!)
    fit.fit()
    const off = fa.onEvent((ev) => {
      if (ev.type === 'term-data') term.write(ev.data)
    })
    void fa.term.attach(term.cols, term.rows).then((buffered) => {
      if (buffered) term.write(buffered)
      term.focus()
    })
    term.onData((d) => { void fa.term.write(d) })
    const ro = new ResizeObserver(() => { fit.fit(); void fa.term.resize(term.cols, term.rows) })
    ro.observe(ref.current!)
    return () => { ro.disconnect(); off(); term.dispose() } // 面板卸载不杀 pty（App 层管理折叠）
  }, [])
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}
```

（term-exit 事件经 App 路由调 TerminalPanel 的 setExited——用模块级事件桥或 props 回调，实现取简；exit 后 term-data 不再到达，无需特殊处理。）

- [ ] **Step 4: App.tsx**——中间列改 `flex-direction: column`：EditorArea（flex:1）+ `<TerminalPanel collapsed={termCollapsed} />`；`const [termCollapsed, setTermCollapsed] = useState(false)`；折叠按钮放 TerminalPanel 头部（props 传 onToggle）；事件路由 switch 增加 `case 'term-exit'` 分发。
- [ ] **Step 5: 依赖与验证** — `pnpm --filter renderer add @xterm/xterm @xterm/addon-fit`；`pnpm -r test` + renderer tsc + main build。
- [ ] **Step 6: 提交** `feat(renderer): terminal panel with xterm and usage state`

---

### Task 7: 会话下拉 UI + token 显示

**Files:**
- Modify: `packages/renderer/src/components/ChatPanel.tsx`（顶栏会话下拉）、`packages/renderer/src/App.tsx`（顶栏 token 显示）

**Interfaces:**
- Consumes: `fa.session.list/new/switch/delete`、`session-changed` 事件、chat-store `usage`/`running`。
- Produces: 完整会话管理 UI + `fmtTokens(n)` 工具。

- [ ] **Step 1: 会话下拉（ChatPanel 顶部 header）**

行为契约：
1. 挂载时 `fa.session.list()` 载入列表；收到 `session-changed {file}` 事件时刷新列表并把当前项置为 file。
2. 当前会话显示 title + ▾；点开浮层列表（title + 相对时间），项悬停显示 🗑——**当前项的 🗑 置灰不可点**。
3. 「+ 新会话」→ `fa.session.new()`（main 已切到新会话并 emit history + session-changed）。
4. 点列表项 → `fa.session.switch(file)`；`running === true` 时下拉整体禁用（title 灰显 + 浮层不可开，tooltip「运行中不可切换」）。
5. 删除 → `window.confirm('删除会话 "xxx"？不可恢复。')` → `fa.session.delete(file)` → 用返回的列表刷新。
6. 所有 rejection → `useEditorStore.getState().setNotice(String(e))`。
7. 相对时间工具 `fmtAgo(mtimeMs)`（刚刚/X 分钟前/X 小时前/昨天/X 天前）放同文件导出。

- [ ] **Step 2: token 显示（App header 右侧灰字）**

```tsx
const usage = useStore((s) => s.usage)
<span style={{ color: '#999' }}>
  {usage ? `${fmtTokens(usage.prompt)} / ${fmtTokens(usage.completion)} tokens` : '—'}
</span>
// fmtTokens: n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)——放 ChatPanel 同文件导出或 utils
```

- [ ] **Step 3: 验证 + 提交**（`pnpm -r test` + tsc + build）

```bash
git add packages/renderer/src
git commit -m "feat(renderer): session dropdown and token usage display"
```

---

### Task 8: README + 全量验证

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README** — 简介补「内置终端与多会话管理（M4）」；架构行不变；新增「## 终端与会话（M4）」小节：终端用法（PowerShell、折叠后台运行、退出重启）、会话管理（新建/切换/删除、自动迁移、恢复最新）、token 显示说明（不支持 include_usage 的端点显示 "—"）。
- [ ] **Step 2: 全量验证** — `pnpm -r test` + `pnpm --filter main build` + main/renderer tsc。
- [ ] **Step 3: 手动冒烟清单（controller/用户，spec §9 八条）**
- [ ] **Step 4: 提交** `docs: update README for M4 terminal and sessions`
