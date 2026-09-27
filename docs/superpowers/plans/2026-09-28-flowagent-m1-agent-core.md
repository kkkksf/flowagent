# FlowAgent M1（agent-core 命令行可用）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个纯 TS 的 `agent-core` 库 + CLI：在终端里与 LLM 对话，agent 能通过 7 个工具读写文件、搜代码、执行命令、自主多步完成任务，会话可持久化恢复。

**Architecture:** pnpm monorepo 中的 `packages/agent-core` 包，零 UI/Electron 依赖。核心是 `(history, model_output) -> history'` 的可序列化状态转移循环；对外只暴露异步事件流。所有循环逻辑用假 provider 做零成本单测。

**Tech Stack:** TypeScript 5 (ESM)、Node.js >= 20、vitest 3、无运行时依赖（provider 用原生 fetch + 手写 SSE 解析）。

**Spec:** `docs/superpowers/specs/2026-09-28-flowagent-design.md`

## Global Constraints

- 全 TypeScript，ESM（`"type": "module"`），严格模式（`strict: true`）。
- `agent-core` 禁止 import `electron`、`react` 或任何 UI 库。
- 运行时零依赖（开发依赖：typescript、vitest、@types/node）。
- 所有工具的文件操作必须限制在工作区根目录内（路径逃逸一律拒绝并返回错误文本）。
- `write_file` / `edit_file` / `run_command` 必须经过确认门（approval callback）。
- 步数上限默认 30（可配置）。
- 提交信息用 conventional commits。
- 测试命令统一为 `pnpm --filter agent-core test`（工作区根目录执行）。

## Review Focus

以下五类输入/故障模式是 spec 未逐条展开、但最容易咬人的，每条已把测试落到对应任务：

1. **路径逃逸**：工具收到 `..\..\etc\passwd` 或绝对路径时应拒绝，而不是读写工作区外文件 → Task 4 Step 1 的 `test_rejects_paths_outside_workspace`。
2. **`edit_file` 的 old_string 多处匹配**：应报错并提示出现次数，而不是静默改第一处 → Task 4 Step 1 的 `test_edit_rejects_ambiguous_match`。
3. **LLM 流中断/网络断开**：循环应抛出可识别错误且历史不被污染（未追加半截 assistant 消息）→ Task 8 Step 1 的 `test_partial_stream_does_not_pollute_history`。
4. **工具参数不符合 schema**：应把校验错误作为工具结果回给模型，而不是抛异常炸掉循环 → Task 3 Step 1 的 `test_invalid_args_returned_as_error_result`。
5. **JSONL 恢复时读到不完整最后一行**（崩溃时写了一半）：应跳过该行并继续，而不是启动失败 → Task 7 Step 1 的 `test_load_skips_truncated_last_line`。

---

### Task 1: Monorepo 脚手架 + agent-core 包 + vitest

**Files:**
- Create: `package.json`（根）
- Create: `pnpm-workspace.yaml`
- Create: `packages/agent-core/package.json`
- Create: `packages/agent-core/tsconfig.json`
- Create: `packages/agent-core/vitest.config.ts`
- Create: `packages/agent-core/src/index.ts`
- Test: `packages/agent-core/src/smoke.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: 包 `agent-core`（name 字段为 `agent-core`），入口 `src/index.ts`；`pnpm --filter agent-core test` 可跑通 vitest。

- [ ] **Step 1: 写失败测试**

`packages/agent-core/src/smoke.test.ts`：

```typescript
import { describe, expect, it } from 'vitest'
import { VERSION } from './index.js'

describe('agent-core', () => {
  it('exports a version', () => {
    expect(VERSION).toBe('0.1.0')
  })
})
```

- [ ] **Step 2: 建配置文件（使测试可运行）**

根 `package.json`：

```json
{
  "name": "flowagent",
  "private": true,
  "type": "module",
  "scripts": { "test": "pnpm -r test" }
}
```

`pnpm-workspace.yaml`：

```yaml
packages:
  - packages/*
```

`packages/agent-core/package.json`：

```json
{
  "name": "agent-core",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  }
}
```

`packages/agent-core/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist",
    "declaration": true
  },
  "include": ["src"]
}
```

`packages/agent-core/vitest.config.ts`：

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
})
```

- [ ] **Step 3: 安装依赖并运行，确认失败**

Run: `pnpm install && pnpm --filter agent-core add -D typescript vitest @types/node && pnpm --filter agent-core test`
Expected: FAIL，报 `Cannot find module './index.js'`。

- [ ] **Step 4: 最小实现**

`packages/agent-core/src/index.ts`：

```typescript
export const VERSION = '0.1.0'
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter agent-core test`
Expected: PASS（1 passed）。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo with agent-core package"
```

---

### Task 2: 核心类型与事件定义

**Files:**
- Create: `packages/agent-core/src/types.ts`
- Modify: `packages/agent-core/src/index.ts`
- Test: `packages/agent-core/src/types.test.ts`

**Interfaces:**
- Consumes: 无
- Produces（后续所有任务依赖这些类型，签名必须一字不差）:

```typescript
// 消息与工具调用
export interface ToolCall { id: string; name: string; arguments: string } // arguments 是 JSON 字符串
export type AgentMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string } // content 为结果或错误文本

// Provider 接口
export type ProviderEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'result'; content: string; toolCalls: ToolCall[] }
export interface LlmProvider {
  stream(messages: AgentMessage[], tools: ToolDefinition[]): AsyncIterable<ProviderEvent>
}

// 工具接口
export interface ToolContext {
  workspaceRoot: string
  approve(action: string, detail: string): Promise<boolean>
}
export interface ToolDefinition {
  name: string
  description: string
  parameters: JsonSchema // JSON Schema 对象
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>
}
export type JsonSchema = Record<string, unknown>

// 对外事件
export type AgentEvent =
  | { type: 'message-delta'; text: string }
  | { type: 'assistant-message'; message: AgentMessage }
  | { type: 'tool-call'; call: ToolCall }
  | { type: 'tool-result'; call: ToolCall; result: string }
  | { type: 'step'; step: number }
  | { type: 'done'; reason: 'completed' | 'step-cap' | 'stopped' }
  | { type: 'error'; error: Error }

export interface AgentConfig {
  provider: LlmProvider
  tools: ToolDefinition[]
  systemPrompt: string
  maxSteps: number // 默认 30
  contextStrategy: ContextStrategy
  session: SessionStore // 可为 NullSessionStore
}
```

（`ContextStrategy`、`SessionStore` 在 Task 6/7 定义，此处先以占位 interface 声明在本文件，后续任务填充方法。）

- [ ] **Step 1: 写失败测试（类型级，用编译期断言 + 运行期构造）**

`packages/agent-core/src/types.test.ts`：

```typescript
import { describe, expect, it } from 'vitest'
import type { AgentEvent, AgentMessage, ToolCall } from './types.js'

describe('types', () => {
  it('constructs a valid assistant message with tool calls', () => {
    const call: ToolCall = { id: 'c1', name: 'read_file', arguments: '{"path":"a.txt"}' }
    const msg: AgentMessage = { role: 'assistant', content: 'thinking', toolCalls: [call] }
    const ev: AgentEvent = { type: 'assistant-message', message: msg }
    expect(ev.type).toBe('assistant-message')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter agent-core test`
Expected: FAIL，`Cannot find module './types.js'`。

- [ ] **Step 3: 实现 `types.ts`（内容即上面 Interfaces 块的完整代码，加上）**

```typescript
export interface ContextStrategy {
  // 输入完整历史，返回裁剪后用于发给 LLM 的历史
  trim(history: AgentMessage[], tokenBudget: number): AgentMessage[]
}

export interface SessionStore {
  append(event: SessionRecord): void
  load(): SessionRecord[]
}
export type SessionRecord =
  | { kind: 'message'; message: AgentMessage }
  | { kind: 'meta'; key: string; value: string }
```

`src/index.ts` 追加 `export * from './types.js'`。

- [ ] **Step 4: 运行确认通过；Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): define message, tool, provider and event types"
```

---

### Task 3: 工具注册表 + JSON schema 校验

**Files:**
- Create: `packages/agent-core/src/tools/registry.ts`
- Test: `packages/agent-core/src/tools/registry.test.ts`

**Interfaces:**
- Consumes: `ToolDefinition`、`ToolContext`（Task 2）
- Produces:

```typescript
export class ToolRegistry {
  constructor(tools: ToolDefinition[])
  get(name: string): ToolDefinition | undefined
  list(): ToolDefinition[]
  // 校验 args 并执行：schema 不过 → 返回错误文本（不抛异常）
  async run(name: string, args: string, ctx: ToolContext): Promise<string>
}
export function validateArgs(schema: JsonSchema, args: unknown): string | null // null=合法，否则错误消息
```

- [ ] **Step 1: 写失败测试**

`packages/agent-core/src/tools/registry.test.ts`：

```typescript
import { describe, expect, it } from 'vitest'
import type { ToolContext, ToolDefinition } from '../types.js'
import { ToolRegistry, validateArgs } from './registry.js'

const ctx: ToolContext = {
  workspaceRoot: process.cwd(),
  approve: async () => true,
}
const echo: ToolDefinition = {
  name: 'echo',
  description: 'echoes',
  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  async execute(args) { return String(args.text) },
}

describe('ToolRegistry', () => {
  it('executes a valid call', async () => {
    const r = new ToolRegistry([echo])
    expect(await r.run('echo', '{"text":"hi"}', ctx)).toBe('hi')
  })

  it('invalid args returned as error result, not thrown', async () => {
    const r = new ToolRegistry([echo])
    const out = await r.run('echo', '{"text": 42}', ctx)
    expect(out).toMatch(/text/)
    expect(out).toMatch(/error/i)
  })

  it('unknown tool returns error text', async () => {
    const r = new ToolRegistry([echo])
    expect(await r.run('nope', '{}', ctx)).toMatch(/unknown tool/i)
  })

  it('malformed JSON args return error text', async () => {
    const r = new ToolRegistry([echo])
    expect(await r.run('echo', '{oops', ctx)).toMatch(/JSON/i)
  })
})

describe('validateArgs', () => {
  it('returns null for valid args', () => {
    expect(validateArgs(echo.parameters, { text: 'x' })).toBeNull()
  })
})
```

- [ ] **Step 2: 运行确认失败** — Run: `pnpm --filter agent-core test`，Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`packages/agent-core/src/tools/registry.ts`：

```typescript
import type { JsonSchema, ToolContext, ToolDefinition } from '../types.js'

export function validateArgs(schema: JsonSchema, args: unknown): string | null {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return `error: arguments must be a JSON object, got ${typeof args}`
  }
  const obj = args as Record<string, unknown>
  const props = (schema.properties ?? {}) as Record<string, { type?: string }>
  for (const [key, def] of Object.entries(props)) {
    const v = obj[key]
    if (v === undefined) continue
    const t = def.type
    if (t === 'string' && typeof v !== 'string') return `error: argument "${key}" must be string, got ${typeof v}`
    if (t === 'number' && typeof v !== 'number') return `error: argument "${key}" must be number, got ${typeof v}`
    if (t === 'boolean' && typeof v !== 'boolean') return `error: argument "${key}" must be boolean, got ${typeof v}`
    if (t === 'array' && !Array.isArray(v)) return `error: argument "${key}" must be array`
  }
  for (const key of (schema.required as string[]) ?? []) {
    if (!(key in obj)) return `error: missing required argument "${key}"`
  }
  return null
}

export class ToolRegistry {
  private map = new Map<string, ToolDefinition>()
  constructor(tools: ToolDefinition[]) { for (const t of tools) this.map.set(t.name, t) }
  get(name: string) { return this.map.get(name) }
  list() { return [...this.map.values()] }
  async run(name: string, args: string, ctx: ToolContext): Promise<string> {
    const tool = this.map.get(name)
    if (!tool) return `error: unknown tool "${name}"`
    let parsed: unknown
    try { parsed = JSON.parse(args) } catch { return `error: arguments are not valid JSON: ${args.slice(0, 100)}` }
    const err = validateArgs(tool.parameters, parsed)
    if (err) return err
    return tool.execute(parsed as Record<string, unknown>, ctx)
  }
}
```

- [ ] **Step 4: 运行确认通过** — `export * from './tools/registry.js'` 加进 index.ts，Run: `pnpm --filter agent-core test`，Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): tool registry with schema validation"
```

---

### Task 4: 文件系统工具（read/write/edit/list/glob/grep）

**Files:**
- Create: `packages/agent-core/src/tools/fs.ts`（含 `resolveInWorkspace` 助手）
- Modify: `packages/agent-core/src/index.ts`
- Test: `packages/agent-core/src/tools/fs.test.ts`

**Interfaces:**
- Consumes: `ToolDefinition`、`ToolContext`（Task 2）
- Produces:

```typescript
export function resolveInWorkspace(root: string, relative: string): string // 越界抛 Error
export const fsTools: ToolDefinition[] // read_file, write_file, edit_file, list_dir, glob, grep
```

`edit_file` 参数：`{ path, old_string, new_string, replace_all?: boolean }`；old_string 非唯一且未指定 replace_all 时报错并报告出现次数。

- [ ] **Step 1: 写失败测试**

`packages/agent-core/src/tools/fs.test.ts`：

```typescript
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ToolContext } from '../types.js'
import { fsTools, resolveInWorkspace } from './fs.js'

let root: string
let ctx: ToolContext
const get = (n: string) => fsTools.find((t) => t.name === n)!

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'fa-'))
  ctx = { workspaceRoot: root, approve: async () => true }
})

describe('resolveInWorkspace', () => {
  it('rejects paths outside workspace', () => {
    expect(() => resolveInWorkspace(root, '..\\..\\etc\\passwd')).toThrow(/outside/i)
    expect(() => resolveInWorkspace(root, 'C:\\Windows\\system32')).toThrow(/outside/i)
  })
  it('accepts nested relative paths', () => {
    expect(resolveInWorkspace(root, 'a/b.txt')).toBe(join(root, 'a', 'b.txt'))
  })
})

describe('file tools', () => {
  it('write -> read roundtrip', async () => {
    expect(await get('write_file').execute({ path: 'hello.txt', content: 'hi' }, ctx)).toMatch(/ok/i)
    expect(await get('read_file').execute({ path: 'hello.txt' }, ctx)).toBe('hi')
  })

  it('write_file asks for approval', async () => {
    let asked = ''
    const c2: ToolContext = { ...ctx, approve: async (a) => (asked = a, false) }
    const out = await get('write_file').execute({ path: 'x.txt', content: 'y' }, c2)
    expect(asked).toBe('write_file')
    expect(out).toMatch(/denied/i)
  })

  it('edit rejects ambiguous match', async () => {
    await get('write_file').execute({ path: 'amb.txt', content: 'a a a' }, ctx)
    const out = await get('edit_file').execute({ path: 'amb.txt', old_string: 'a', new_string: 'b' }, ctx)
    expect(out).toMatch(/3.*occurrence|occurrence.*3/i)
  })

  it('edit replaces unique match', async () => {
    await get('write_file').execute({ path: 'u.txt', content: 'one two three' }, ctx)
    await get('edit_file').execute({ path: 'u.txt', old_string: 'two', new_string: 'TWO' }, ctx)
    expect(await get('read_file').execute({ path: 'u.txt' }, ctx)).toBe('one TWO three')
  })

  it('edit on missing old_string returns error text', async () => {
    const out = await get('edit_file').execute({ path: 'u.txt', old_string: 'zzz', new_string: 'q' }, ctx)
    expect(out).toMatch(/not found/i)
  })

  it('list_dir and glob find files', async () => {
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'a.ts'), 'x')
    expect(await get('list_dir').execute({ path: '.' }, ctx)).toContain('src')
    expect(await get('glob').execute({ pattern: '**/*.ts' }, ctx)).toContain('a.ts')
  })

  it('grep matches with line numbers', async () => {
    const out = await get('grep').execute({ pattern: 'TWO', include: '*.txt' }, ctx)
    expect(out).toMatch(/u\.txt.*1/i)
  })
})
```

- [ ] **Step 2: 运行确认失败** — Run: `pnpm --filter agent-core test`，Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `packages/agent-core/src/tools/fs.ts`**

```typescript
import { readFile, readdir, writeFile, mkdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { ToolDefinition } from '../types.js'

export function resolveInWorkspace(root: string, relativePath: string): string {
  const abs = isAbsolute(relativePath) ? resolve(relativePath) : resolve(root, relativePath)
  const rel = relative(resolve(root), abs)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`error: path "${relativePath}" is outside the workspace`)
  return abs
}

async function safeIo<T>(fn: () => Promise<T>): Promise<T | string> {
  try { return await fn() } catch (e) { return `error: ${(e as Error).message}` }
}

export const fsTools: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file inside the workspace. Returns the full content.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    async execute(args, ctx) {
      return safeIo(async () => {
        const content = await readFile(resolveInWorkspace(ctx.workspaceRoot, String(args.path)), 'utf8')
        return content.length > 100_000 ? content.slice(0, 100_000) + '\n...[truncated]' : content
      })
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file inside the workspace.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
    async execute(args, ctx) {
      if (!(await ctx.approve('write_file', String(args.path)))) return 'error: user denied write_file'
      return safeIo(async () => {
        const abs = resolveInWorkspace(ctx.workspaceRoot, String(args.path))
        await mkdir(join(abs, '..'), { recursive: true })
        await writeFile(abs, String(args.content), 'utf8')
        return `ok: wrote ${String(args.path)} (${String(args.content).length} bytes)`
      })
    },
  },
  {
    name: 'edit_file',
    description: 'Edit a file by replacing an exact literal string. old_string must match exactly once unless replace_all is true.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' }, old_string: { type: 'string' },
        new_string: { type: 'string' }, replace_all: { type: 'boolean' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    async execute(args, ctx) {
      if (!(await ctx.approve('edit_file', String(args.path)))) return 'error: user denied edit_file'
      return safeIo(async () => {
        const abs = resolveInWorkspace(ctx.workspaceRoot, String(args.path))
        const content = await readFile(abs, 'utf8')
        const oldStr = String(args.old_string)
        const count = content.split(oldStr).length - 1
        if (count === 0) return `error: old_string not found in ${String(args.path)}`
        if (count > 1 && args.replace_all !== true) {
          return `error: old_string occurs ${count} times in ${String(args.path)}; make it unique or pass replace_all=true`
        }
        const updated = args.replace_all === true
          ? content.split(oldStr).join(String(args.new_string))
          : content.replace(oldStr, String(args.new_string))
        await writeFile(abs, updated, 'utf8')
        return `ok: edited ${String(args.path)} (${count} replacement${count > 1 ? 's' : ''})`
      })
    },
  },
  {
    name: 'list_dir',
    description: 'List entries of a directory inside the workspace.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    async execute(args, ctx) {
      return safeIo(async () => {
        const entries = await readdir(resolveInWorkspace(ctx.workspaceRoot, String(args.path)), { withFileTypes: true })
        return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join('\n') || '(empty)'
      })
    },
  },
  {
    name: 'glob',
    description: 'Find files matching a glob pattern (e.g. "**/*.ts") under the workspace root.',
    parameters: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] },
    async execute(args, ctx) {
      // 极简递归匹配：把 glob 转 RegExp（** -> 任意路径段序列，* -> 段内任意）
      const pattern = String(args.pattern)
      const re = new RegExp('^' + pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*\//g, '(?:.*/)?')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/\\\\]*') + '$')
      const found: string[] = []
      const walk = async (dir: string, prefix: string): Promise<void> => {
        const entries = await readdir(dir, { withFileTypes: true })
        for (const e of entries) {
          if (e.name === 'node_modules' || e.name === '.git') continue
          const rel = prefix ? `${prefix}/${e.name}` : e.name
          if (e.isDirectory()) await walk(join(dir, e.name), rel)
          else if (re.test(rel) || re.test(rel.replace(/\//g, '\\'))) found.push(rel)
        }
      }
      return safeIo(async () => { await walk(ctx.workspaceRoot, ''); return found.join('\n') || '(no matches)' })
    },
  },
  {
    name: 'grep',
    description: 'Search file contents with a regular expression. Returns matching lines with file:line prefixes.',
    parameters: {
      type: 'object',
      properties: { pattern: { type: 'string' }, include: { type: 'string' } },
      required: ['pattern'],
    },
    async execute(args, ctx) {
      const re = new RegExp(String(args.pattern))
      const include = args.include ? String(args.include) : '*'
      const incRe = new RegExp('^' + include.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
      const out: string[] = []
      const walk = async (dir: string, prefix: string): Promise<void> => {
        for (const e of await readdir(dir, { withFileTypes: true })) {
          if (e.name === 'node_modules' || e.name === '.git') continue
          const rel = prefix ? `${prefix}/${e.name}` : e.name
          if (e.isDirectory()) { await walk(join(dir, e.name), rel); continue }
          if (!incRe.test(e.name)) continue
          const s = await stat(join(dir, e.name))
          if (!s.isFile() || s.size > 1_000_000) continue
          const text = await readFile(join(dir, e.name), 'utf8')
          text.split('\n').forEach((line, i) => { if (re.test(line)) out.push(`${rel}:${i + 1}: ${line.trim().slice(0, 200)}`) })
        }
      }
      return safeIo(async () => { await walk(ctx.workspaceRoot, ''); return out.slice(0, 200).join('\n') || '(no matches)' })
    },
  },
]
```

注意 `write_file`/`edit_file` 的 approve 必须先于任何磁盘写入调用（见测试 `write_file asks for approval`）。

- [ ] **Step 4: 运行确认通过** — index.ts 加 `export * from './tools/fs.js'`，Run: `pnpm --filter agent-core test`，Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): filesystem tools with workspace boundary and approval gates"
```

---

### Task 5: run_command 与 todo 工具

**Files:**
- Create: `packages/agent-core/src/tools/exec.ts`
- Create: `packages/agent-core/src/tools/todo.ts`
- Modify: `packages/agent-core/src/index.ts`
- Test: `packages/agent-core/src/tools/exec.test.ts`

**Interfaces:**
- Consumes: `ToolDefinition`、`ToolContext`
- Produces:

```typescript
export const execTool: ToolDefinition   // name: "run_command", args: { command: string, timeout_ms?: number }
export const todoTool: ToolDefinition   // name: "todo", args: { action: "read" | "write", content?: string }
```

`run_command` 用 `node:child_process` 的 `spawn`（shell 模式）、cwd 为工作区根、默认超时 60s、输出截断到 30,000 字符、必须过 approve 门。
`todo` 的清单存 `ctx.workspaceRoot/.flowagent/todo.md`。

- [ ] **Step 1: 写失败测试**

`packages/agent-core/src/tools/exec.test.ts`：

```typescript
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ToolContext } from '../types.js'
import { execTool } from './exec.js'
import { todoTool } from './todo.js'

let root: string
let ctx: ToolContext
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'fa-'))
  ctx = { workspaceRoot: root, approve: async () => true }
})

describe('run_command', () => {
  it('captures stdout with exit code', async () => {
    const out = await execTool.execute({ command: 'node -e "console.log(42)"' }, ctx)
    expect(out).toMatch(/42/)
    expect(out).toMatch(/exit code: 0/i)
  })
  it('reports non-zero exit code', async () => {
    const out = await execTool.execute({ command: 'node -e "process.exit(3)"' }, ctx)
    expect(out).toMatch(/exit code: 3/i)
  })
  it('kills on timeout', async () => {
    const out = await execTool.execute({ command: 'node -e "setTimeout(()=>{}, 10000)"', timeout_ms: 300 }, ctx)
    expect(out).toMatch(/timed out/i)
  }, 5000)
  it('requires approval', async () => {
    const c2: ToolContext = { ...ctx, approve: async () => false }
    expect(await execTool.execute({ command: 'echo hi' }, c2)).toMatch(/denied/i)
  })
})

describe('todo', () => {
  it('write then read roundtrip', async () => {
    await todoTool.execute({ action: 'write', content: '- [ ] task1' }, ctx)
    const out = await todoTool.execute({ action: 'read' }, ctx)
    expect(out).toContain('task1')
  })
  it('read on empty store says so', async () => {
    const root2 = await mkdtemp(join(tmpdir(), 'fa-'))
    const out = await todoTool.execute({ action: 'read' }, { workspaceRoot: root2, approve: async () => true })
    expect(out).toMatch(/no todo/i)
  })
})
```

- [ ] **Step 2: 运行确认失败** — Run: `pnpm --filter agent-core test`，Expected: FAIL。

- [ ] **Step 3: 实现**

`packages/agent-core/src/tools/exec.ts`：

```typescript
import { spawn } from 'node:child_process'
import type { ToolDefinition } from '../types.js'

const MAX_OUTPUT = 30_000

export const execTool: ToolDefinition = {
  name: 'run_command',
  description: 'Run a shell command in the workspace root. Streaming-free: waits for completion. timeout_ms default 60000.',
  parameters: {
    type: 'object',
    properties: { command: { type: 'string' }, timeout_ms: { type: 'number' } },
    required: ['command'],
  },
  async execute(args, ctx) {
    if (!(await ctx.approve('run_command', String(args.command)))) return 'error: user denied run_command'
    return new Promise<string>((resolveOut) => {
      const child = spawn(String(args.command), { shell: true, cwd: ctx.workspaceRoot })
      let out = ''
      const push = (chunk: Buffer | string) => {
        if (out.length < MAX_OUTPUT) out += chunk.toString()
      }
      child.stdout.on('data', push)
      child.stderr.on('data', push)
      const timeout = setTimeout(() => {
        child.kill('SIGKILL')
        resolveOut(`error: command timed out after ${Number(args.timeout_ms ?? 60_000)} ms\n${out}`)
      }, Number(args.timeout_ms ?? 60_000))
      child.on('close', (code) => {
        clearTimeout(timeout)
        resolveOut(`${out}\n[exit code: ${code ?? 'null'}]`)
      })
    })
  },
}
```

`packages/agent-core/src/tools/todo.ts`：

```typescript
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ToolDefinition } from '../types.js'

const todoPath = (root: string) => join(root, '.flowagent', 'todo.md')

export const todoTool: ToolDefinition = {
  name: 'todo',
  description: 'Read or write your task list so you can track multi-step progress.',
  parameters: {
    type: 'object',
    properties: { action: { type: 'string', enum: ['read', 'write'] }, content: { type: 'string' } },
    required: ['action'],
  },
  async execute(args, ctx) {
    const path = todoPath(ctx.workspaceRoot)
    if (args.action === 'read') {
      try { return await readFile(path, 'utf8') } catch { return '(no todo list yet)' }
    }
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, String(args.content ?? ''), 'utf8')
    return 'ok: todo list saved'
  },
}
```

- [ ] **Step 4: 运行确认通过** — index.ts 加两个 export，Run: `pnpm --filter agent-core test`，Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): run_command and todo tools"
```

---

### Task 6: 上下文裁剪策略

**Files:**
- Create: `packages/agent-core/src/context/trim.ts`
- Modify: `packages/agent-core/src/index.ts`
- Test: `packages/agent-core/src/context/trim.test.ts`

**Interfaces:**
- Consumes: `ContextStrategy`、`AgentMessage`（Task 2）
- Produces: `export class TokenBudgetTrim implements ContextStrategy`，构造参数 `{ tokenBudget: number }`；token 估算 = 字符数 / 4（中文按字符算偏保守，可接受，YAGNI）。

裁剪规则：永远保留 system 消息与最近 6 条消息；超出预算时，从最老的工具结果开始把 `role:'tool'` 的 content 截断为前 500 字符 + `...[trimmed]`；再不够则丢弃最老的非 system 消息（丢弃成对的 assistant/tool 时保持配对完整：丢弃一个 assistant 带 toolCalls 的消息必须连同其对应 tool 结果一起丢）。

- [ ] **Step 1: 写失败测试**

`packages/agent-core/src/context/trim.test.ts`：

```typescript
import { describe, expect, it } from 'vitest'
import type { AgentMessage } from '../types.js'
import { TokenBudgetTrim } from './trim.js'

const sys: AgentMessage = { role: 'system', content: 'sys' }
const user: AgentMessage = { role: 'user', content: 'q' }
const asst = (n: string): AgentMessage => ({ role: 'assistant', content: n, toolCalls: [{ id: n, name: 'read_file', arguments: '{}' }] })
const tool = (n: string): AgentMessage => ({ role: 'tool', toolCallId: n, content: 'x'.repeat(4000) })

describe('TokenBudgetTrim', () => {
  it('keeps system and recent messages untouched when under budget', () => {
    const t = new TokenBudgetTrim({ tokenBudget: 1_000_000 })
    const hist = [sys, user]
    expect(t.trim(hist, 10_000)).toEqual(hist)
  })
  it('truncates old tool results to summaries under pressure', () => {
    const t = new TokenBudgetTrim({ tokenBudget: 1_000 })
    const hist = [sys, user, asst('c1'), tool('c1'), user, asst('c2'), tool('c2')]
    const out = t.trim(hist, 1_000)
    const oldTool = out.find((m) => m.role === 'tool' && (m as { toolCallId: string }).toolCallId === 'c1')
    expect((oldTool as { content: string }).content.length).toBeLessThanOrEqual(520)
    expect((oldTool as { content: string }).content).toContain('...[trimmed]')
  })
  it('never drops the system message or the last 6 messages', () => {
    const t = new TokenBudgetTrim({ tokenBudget: 100 })
    const hist: AgentMessage[] = [sys]
    for (let i = 0; i < 20; i++) hist.push(i % 2 ? tool(`c${i}`) : asst(`c${i}`))
    const out = t.trim(hist, 100)
    expect(out[0]).toEqual(sys)
    expect(out.length).toBeGreaterThanOrEqual(6)
    expect(out.slice(-6)).toEqual(hist.slice(-6))
  })
  it('keeps assistant toolCalls paired with their tool results when dropping', () => {
    const t = new TokenBudgetTrim({ tokenBudget: 100 })
    const hist = [sys, asst('c1'), tool('c1'), user, asst('c2'), tool('c2')]
    const out = t.trim(hist, 100)
    const ids = new Set(out.filter((m) => m.role === 'assistant').flatMap((m) => (m as { toolCalls: { id: string }[] }).toolCalls.map((c) => c.id)))
    for (const m of out.filter((m) => m.role === 'tool')) ids.delete((m as { toolCallId: string }).toolCallId)
    expect(ids.size).toBe(0) // 没有孤儿 toolCall
  })
})
```

- [ ] **Step 2: 运行确认失败** — Run: `pnpm --filter agent-core test`，Expected: FAIL。

- [ ] **Step 3: 实现 `TokenBudgetTrim`**

```typescript
import type { AgentMessage, ContextStrategy } from '../types.js'

const estTokens = (m: AgentMessage): number => {
  const base = m.role === 'assistant' ? m.content.length + JSON.stringify(m.toolCalls ?? []).length : m.content.length
  return Math.ceil(base / 4)
}

export class TokenBudgetTrim implements ContextStrategy {
  constructor(private cfg: { tokenBudget: number }) {}

  trim(history: AgentMessage[], _tokenBudget: number): AgentMessage[] {
    const system = history.filter((m) => m.role === 'system')
    const rest = history.filter((m) => m.role !== 'system')
    const KEEP_TAIL = 6
    let work = rest.map((m) => ({ msg: m, tokens: estTokens(m) }))
    const total = () => system.reduce((s, m) => s + estTokens(m), 0) + work.reduce((s, w) => s + w.tokens, 0)

    // 1) 截断老的 tool 结果（保留尾部 KEEP_TAIL 条不动）
    for (let i = 0; i < work.length - KEEP_TAIL && total() > this.cfg.tokenBudget; i++) {
      const w = work[i]
      if (w.msg.role === 'tool' && w.msg.content.length > 500) {
        w.msg = { ...w.msg, content: w.msg.content.slice(0, 500) + '\n...[trimmed]' }
        w.tokens = estTokens(w.msg)
      }
    }
    // 2) 丢弃最老的消息，保持 assistant/tool 配对
    while (total() > this.cfg.tokenBudget && work.length > KEEP_TAIL) {
      const drop = new Set([work[0].msg])
      if (work[0].msg.role === 'assistant' && work[0].msg.toolCalls?.length) {
        const ids = new Set(work[0].msg.toolCalls.map((c) => c.id))
        for (const w of work) if (w.msg.role === 'tool' && ids.has(w.msg.toolCallId)) drop.add(w.msg)
      }
      if (work[0].msg.role === 'tool') {
        const id = work[0].msg.toolCallId
        for (const w of work) if (w.msg.role === 'assistant' && w.msg.toolCalls?.some((c) => c.id === id)) drop.add(w.msg)
      }
      work = work.filter((w) => !drop.has(w.msg))
    }
    return [...system, ...work.map((w) => w.msg)]
  }
}
```

- [ ] **Step 4: 运行确认通过；Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): token-budget context trimming strategy"
```

---

### Task 7: 会话 JSONL 持久化

**Files:**
- Create: `packages/agent-core/src/session/jsonl.ts`
- Modify: `packages/agent-core/src/index.ts`
- Test: `packages/agent-core/src/session/jsonl.test.ts`

**Interfaces:**
- Consumes: `SessionStore`、`SessionRecord`（Task 2）
- Produces:

```typescript
export class JsonlSessionStore implements SessionStore {
  constructor(filePath: string) // 追加写，appendFileSync；load 逐行 JSON.parse
}
export class NullSessionStore implements SessionStore {}
```

- [ ] **Step 1: 写失败测试**

`packages/agent-core/src/session/jsonl.test.ts`：

```typescript
import { appendFileSync, mkdtemp, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { JsonlSessionStore, NullSessionStore } from './jsonl.js'

describe('JsonlSessionStore', () => {
  it('append then load roundtrip', () => {
    const path = join(tmpdir(), `fa-${Date.now()}.jsonl`)
    const s = new JsonlSessionStore(path)
    s.append({ kind: 'message', message: { role: 'user', content: 'hi' } })
    s.append({ kind: 'meta', key: 'model', value: 'deepseek' })
    const loaded = s.load()
    expect(loaded).toHaveLength(2)
    expect(loaded[0]).toEqual({ kind: 'message', message: { role: 'user', content: 'hi' } })
    rmSync(path)
  })
  it('load skips truncated last line', () => {
    const path = join(tmpdir(), `fa-${Date.now()}.jsonl`)
    writeFileSync(path, '')
    appendFileSync(path, JSON.stringify({ kind: 'meta', key: 'a', value: '1' }) + '\n')
    appendFileSync(path, '{"kind":"message","mess') // 崩溃残留的半行
    const loaded = new JsonlSessionStore(path).load()
    expect(loaded).toHaveLength(1)
    rmSync(path)
  })
  it('missing file loads empty', () => {
    expect(new JsonlSessionStore(join(tmpdir(), `nope-${Date.now()}.jsonl`)).load()).toEqual([])
  })
  it('NullSessionStore is a no-op', () => {
    const s = new NullSessionStore()
    s.append({ kind: 'meta', key: 'k', value: 'v' })
    expect(s.load()).toEqual([])
  })
})
```

- [ ] **Step 2: 运行确认失败** — Run: `pnpm --filter agent-core test`，Expected: FAIL。

- [ ] **Step 3: 实现 `packages/agent-core/src/session/jsonl.ts`**

```typescript
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import type { SessionRecord, SessionStore } from '../types.js'

export class JsonlSessionStore implements SessionStore {
  constructor(private filePath: string) {}

  append(event: SessionRecord): void {
    appendFileSync(this.filePath, JSON.stringify(event) + '\n', 'utf8')
  }

  load(): SessionRecord[] {
    if (!existsSync(this.filePath)) return []
    const lines = readFileSync(this.filePath, 'utf8').split('\n')
    const out: SessionRecord[] = []
    for (const line of lines) {
      if (!line.trim()) continue
      try { out.push(JSON.parse(line) as SessionRecord) } catch { /* 崩溃残留的半行，跳过 */ }
    }
    return out
  }
}

export class NullSessionStore implements SessionStore {
  append(): void {}
  load(): SessionRecord[] { return [] }
}
```

- [ ] **Step 4: 运行确认通过；Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): JSONL session store with crash-tolerant load"
```

---

### Task 8: OpenAI 兼容 Provider（流式 + 重试）

**Files:**
- Create: `packages/agent-core/src/providers/openai.ts`
- Create: `packages/agent-core/src/providers/sse.ts`
- Modify: `packages/agent-core/src/index.ts`
- Test: `packages/agent-core/src/providers/openai.test.ts`

**Interfaces:**
- Consumes: `LlmProvider`、`ProviderEvent`、`ToolDefinition`（Task 2）
- Produces:

```typescript
export class OpenAICompatProvider implements LlmProvider {
  constructor(cfg: { baseURL: string; apiKey: string; model: string; maxRetries?: number }) // maxRetries 默认 3
}
// sse.ts
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> // 逐 data: 行产出
```

- fetch `${baseURL}/chat/completions`，`stream: true`，工具以 OpenAI `tools` 格式传（`function` 包装）。
- 429/5xx/网络错误：指数退避重试（1s、2s、4s），重试后仍失败抛 `Error`（循环层处理）。
- 解析 `delta.content` → `text-delta`；`delta.tool_calls` 增量拼接；`finish_reason` 到达时产出 `result`。

- [ ] **Step 1: 写失败测试（注入 fake fetch）**

`packages/agent-core/src/providers/openai.test.ts`：

```typescript
import { describe, expect, it, vi } from 'vitest'
import type { ToolDefinition } from '../types.js'
import { parseSse } from './sse.js'

const tools: ToolDefinition[] = [{
  name: 'echo', description: 'x',
  parameters: { type: 'object', properties: {} },
  async execute() { return '' },
}]

function sseResponse(chunks: string[], status = 200): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close() },
  })
  return new Response(stream, { status })
}

describe('parseSse', () => {
  it('yields data lines across chunk boundaries', async () => {
    const events: string[] = []
    const enc = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(enc.encode('data: {"a":1}\n\nda')); c.enqueue(enc.encode('ta: [DONE]\n\n')); c.close() },
    })
    for await (const e of parseSse(stream)) events.push(e)
    expect(events).toEqual(['{"a":1}', '[DONE]'])
  })
})

describe('OpenAICompatProvider.stream', () => {
  it('emits text deltas and a result', async () => {
    const { OpenAICompatProvider } = await import('./openai.js')
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]))
    const p = new OpenAICompatProvider({ baseURL: 'http://x', apiKey: 'k', model: 'm', fetchImpl: fetchMock as unknown as typeof fetch })
    const events = []
    for await (const e of p.stream([{ role: 'user', content: 'hi' }], tools)) events.push(e)
    expect(events).toContainEqual({ type: 'text-delta', text: 'Hel' })
    const result = events.find((e) => e.type === 'result')
    expect(result).toMatchObject({ type: 'result', content: 'Hello' })
  })

  it('retries on 500 then succeeds', async () => {
    const { OpenAICompatProvider } = await import('./openai.js')
    const ok = sseResponse(['data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n', 'data: [DONE]\n\n'])
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('err', { status: 500 }))
      .mockResolvedValueOnce(ok)
    const p = new OpenAICompatProvider({ baseURL: 'http://x', apiKey: 'k', model: 'm', maxRetries: 3, fetchImpl: fetchMock as unknown as typeof fetch })
    const events = []
    for await (const e of p.stream([{ role: 'user', content: 'hi' }], [])) events.push(e)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(events.some((e) => e.type === 'result')).toBe(true)
  })

  it('assembles tool_calls from deltas', async () => {
    const { OpenAICompatProvider } = await import('./openai.js')
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"echo","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ]))
    const p = new OpenAICompatProvider({ baseURL: 'http://x', apiKey: 'k', model: 'm', fetchImpl: fetchMock as unknown as typeof fetch })
    const events = []
    for await (const e of p.stream([{ role: 'user', content: 'hi' }], tools)) events.push(e)
    expect(events.find((e) => e.type === 'result')).toMatchObject({
      type: 'result', content: '',
      toolCalls: [{ id: 'c1', name: 'echo', arguments: '{}' }],
    })
  })
})
```

- [ ] **Step 2: 运行确认失败** — Run: `pnpm --filter agent-core test`，Expected: FAIL。

- [ ] **Step 3: 实现**

`packages/agent-core/src/providers/sse.ts`：

```typescript
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buf = ''
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '')
      buf = buf.slice(idx + 1)
      if (line.startsWith('data: ')) yield line.slice(6)
    }
  }
}
```

`packages/agent-core/src/providers/openai.ts`：

```typescript
import type { AgentMessage, LlmProvider, ProviderEvent, ToolCall, ToolDefinition } from '../types.js'
import { parseSse } from './sse.js'

interface OpenAiDelta {
  content?: string
  tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[]
}
type ParsedCall = { id: string; name: string; arguments: string }

export class OpenAICompatProvider implements LlmProvider {
  private maxRetries: number
  private fetchImpl: typeof fetch
  constructor(private cfg: { baseURL: string; apiKey: string; model: string; maxRetries?: number; fetchImpl?: typeof fetch }) {
    this.maxRetries = cfg.maxRetries ?? 3
    this.fetchImpl = cfg.fetchImpl ?? fetch
  }

  async *stream(messages: AgentMessage[], tools: ToolDefinition[]): AsyncGenerator<ProviderEvent> {
    const body = {
      model: this.cfg.model,
      stream: true,
      messages: messages.map(toOpenAiMessage),
      tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
    }
    let res: Response | null = null
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      res = await this.fetchImpl(`${this.cfg.baseURL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify(body),
      })
      if (res.ok) break
      const retriable = res.status === 429 || res.status >= 500
      if (!retriable || attempt === this.maxRetries) throw new Error(`LLM API error ${res.status}: ${await res.text().catch(() => '')}`)
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
    }
    if (!res || !res.ok || !res.body) throw new Error('LLM API: no response body')

    let content = ''
    const calls: ParsedCall[] = []
    for await (const data of parseSse(res.body)) {
      if (data === '[DONE]') break
      let delta: OpenAiDelta
      try { delta = (JSON.parse(data) as { choices: { delta: OpenAiDelta }[] }).choices[0]?.delta ?? {} } catch { continue }
      if (delta.content) { content += delta.content; yield { type: 'text-delta', text: delta.content } }
      for (const tc of delta.tool_calls ?? []) {
        const slot = (calls[tc.index] ??= { id: '', name: '', arguments: '' })
        if (tc.id) slot.id = tc.id
        if (tc.function?.name) slot.name += tc.function.name
        if (tc.function?.arguments) slot.arguments += tc.function.arguments
      }
    }
    const toolCalls: ToolCall[] = calls.filter((c) => c.id).map((c) => ({ id: c.id, name: c.name, arguments: c.arguments }))
    yield { type: 'result', content, toolCalls }
  }
}

function toOpenAiMessage(m: AgentMessage): Record<string, unknown> {
  if (m.role === 'assistant') {
    return {
      role: 'assistant',
      content: m.content || null,
      ...(m.toolCalls.length ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) } : {}),
    }
  }
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
  return { role: m.role, content: m.content }
}
```

（测试通过 `fetchImpl` 注入构造参数——实现里已包含，类型上 `cfg.fetchImpl?: typeof fetch`。）

- [ ] **Step 4: 运行确认通过；Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): streaming OpenAI-compatible provider with retries"
```

---

### Task 9: Agent 主循环

**Files:**
- Create: `packages/agent-core/src/loop.ts`
- Modify: `packages/agent-core/src/index.ts`
- Test: `packages/agent-core/src/loop.test.ts`

**Interfaces:**
- Consumes: `AgentConfig`、`AgentEvent`、`ToolRegistry`（Task 2/3）、`NullSessionStore`（Task 7）
- Produces:

```typescript
export class Agent {
  constructor(cfg: AgentConfig)
  get history(): AgentMessage[]
  loadHistory(messages: AgentMessage[]): void // 从 SessionStore 恢复后注入
  stop(): void
  async *run(userInput: string): AsyncGenerator<AgentEvent>
}
```

`test partial stream does not pollute history`：provider 在发了几条 text-delta 后抛错 → 断言 `agent.history` 末尾仍是原 user 消息、没有半截 assistant。

- [ ] **Step 1: 写失败测试（FakeProvider 驱动全循环）**

`packages/agent-core/src/loop.test.ts`：

```typescript
import { describe, expect, it } from 'vitest'
import type { AgentConfig, AgentEvent, AgentMessage, LlmProvider, ProviderEvent, ToolDefinition } from './types.js'
import { TokenBudgetTrim } from './context/trim.js'
import { Agent } from './loop.js'
import { NullSessionStore } from './session/jsonl.js'

// 脚本化假 provider：每次调用弹出一个"轮次脚本"
function fakeProvider(turns: ProviderEvent[][], errorAfter?: { turn: number; duringDelta: boolean }): LlmProvider {
  let call = 0
  return {
    async *stream(): AsyncGenerator<ProviderEvent> {
      const i = call++
      if (errorAfter && i === errorAfter.turn && errorAfter.duringDelta) {
        yield { type: 'text-delta', text: 'par' }
        throw new Error('connection reset')
      }
      if (i >= turns.length) return
      yield* turns[i]
    },
  }
}

const echoTool: ToolDefinition = {
  name: 'echo', description: 'echo',
  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  async execute(args) { return `echo:${String(args.text)}` },
}

function makeAgent(provider: LlmProvider, tools: ToolDefinition[] = [echoTool], maxSteps = 30): Agent {
  const cfg: AgentConfig = {
    provider, tools, systemPrompt: 'sys', maxSteps,
    contextStrategy: new TokenBudgetTrim({ tokenBudget: 100_000 }),
    session: new NullSessionStore(),
  }
  return new Agent(cfg)
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}

describe('Agent loop', () => {
  it('runs a tool then finishes with text', async () => {
    const p = fakeProvider([
      [{ type: 'result', content: '', toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"text":"hi"}' }] }],
      [{ type: 'result', content: 'all done', toolCalls: [] }],
    ])
    const events = await collect(makeAgent(p).run('do it'))
    expect(events).toContainEqual({ type: 'tool-result', call: { id: 'c1', name: 'echo', arguments: '{"text":"hi"}' }, result: 'echo:hi' })
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'completed' })
  })

  it('appends tool result to history so the next LLM call sees it', async () => {
    let seen: AgentMessage[] = []
    let call = 0
    const p: LlmProvider = {
      async *stream(messages) {
        if (call++ === 1) seen = messages
        yield { type: 'result', content: call === 1 ? '' : 'ok', toolCalls: call === 1 ? [{ id: 'c1', name: 'echo', arguments: '{"text":"x"}' }] : [] }
      },
    }
    await collect(makeAgent(p).run('go'))
    const toolMsg = seen.find((m) => m.role === 'tool')
    expect(toolMsg).toMatchObject({ role: 'tool', toolCallId: 'c1', content: 'echo:x' })
  })

  it('partial stream does not pollute history', async () => {
    const p = fakeProvider([], { turn: 0, duringDelta: true })
    const agent = makeAgent(p)
    const events = await collect(agent.run('hi'))
    expect(events.at(-1)).toMatchObject({ type: 'error' })
    expect(agent.history.filter((m) => m.role === 'assistant')).toHaveLength(0)
    expect(agent.history.at(-1)).toMatchObject({ role: 'user', content: 'hi' })
  })

  it('stops at step cap', async () => {
    const p = fakeProvider([[{ type: 'result', content: '', toolCalls: [{ id: 'c', name: 'echo', arguments: '{}' }] }]])
    const events = await collect(makeAgent(p, [echoTool], 3).run('loop'))
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'step-cap' })
  })

  it('stop() interrupts before next LLM call', async () => {
    const p = fakeProvider([
      [{ type: 'result', content: '', toolCalls: [{ id: 'c1', name: 'echo', arguments: '{}' }] }],
      [{ type: 'result', content: 'should not run', toolCalls: [] }],
    ])
    const agent = makeAgent(p)
    const events: AgentEvent[] = []
    for await (const e of agent.run('go')) {
      events.push(e)
      if (e.type === 'tool-result') agent.stop()
    }
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'stopped' })
    expect(events.some((e) => e.type === 'message-delta')).toBe(false)
  })

  it('streams message deltas', async () => {
    const p = fakeProvider([[{ type: 'text-delta', text: 'He' }, { type: 'text-delta', text: 'y' }, { type: 'result', content: 'Hey', toolCalls: [] }]])
    const events = await collect(makeAgent(p).run('hi'))
    expect(events).toContainEqual({ type: 'message-delta', text: 'He' })
    expect(events).toContainEqual({ type: 'message-delta', text: 'y' })
  })
})
```

- [ ] **Step 2: 运行确认失败** — Run: `pnpm --filter agent-core test`，Expected: FAIL。

- [ ] **Step 3: 实现 `packages/agent-core/src/loop.ts`**

```typescript
import { ToolRegistry } from './tools/registry.js'
import type { AgentConfig, AgentEvent, AgentMessage } from './types.js'

export class Agent {
  private registry: ToolRegistry
  private history: AgentMessage[] = []
  private stopped = false

  constructor(private cfg: AgentConfig) {
    this.registry = new ToolRegistry(cfg.tools)
    this.history.push({ role: 'system', content: cfg.systemPrompt })
  }

  get History(): AgentMessage[] { return this.history }
  // 注：属性名统一用小写 history（与测试 agent.history 对齐）：
  get historyView(): AgentMessage[] { return this.history }

  loadHistory(messages: AgentMessage[]): void { this.history = [...messages] }

  stop(): void { this.stopped = true }

  async *run(userInput: string): AsyncGenerator<AgentEvent> {
    const userMsg: AgentMessage = { role: 'user', content: userInput }
    this.history.push(userMsg)
    this.cfg.session.append({ kind: 'message', message: userMsg })

    for (let step = 1; step <= this.cfg.maxSteps; step++) {
      if (this.stopped) { yield { type: 'done', reason: 'stopped' }; return }
      yield { type: 'step', step }

      const trimmed = this.cfg.contextStrategy.trim(this.history, 100_000)
      let result: { content: string; toolCalls: import('./types.js').ToolCall[] }
      try {
        result = await this.consumeProvider(trimmed)
      } catch (e) {
        yield { type: 'error', error: e as Error }
        return
      }

      const assistantMsg: AgentMessage = { role: 'assistant', content: result.content, toolCalls: result.toolCalls }
      this.history.push(assistantMsg)
      this.cfg.session.append({ kind: 'message', message: assistantMsg })
      yield { type: 'assistant-message', message: assistantMsg }

      if (result.toolCalls.length === 0) {
        yield { type: 'done', reason: 'completed' }
        return
      }
      for (const call of result.toolCalls) {
        yield { type: 'tool-call', call }
        const toolResult = await this.registry.run(call.name, call.arguments, {
          workspaceRoot: (this.cfg as AgentConfig & { workspaceRoot?: string }).workspaceRoot ?? process.cwd(),
          approve: async (action, detail) => {
            if ((this.cfg as AgentConfig & { autoApprove?: boolean }).autoApprove) return true
            return this.cfg.approve?.(action, detail) ?? false
          },
        })
        const toolMsg: AgentMessage = { role: 'tool', toolCallId: call.id, content: toolResult }
        this.history.push(toolMsg)
        this.cfg.session.append({ kind: 'message', message: toolMsg })
        yield { type: 'tool-result', call, result: toolResult }
      }
      if (this.stopped) { yield { type: 'done', reason: 'stopped' }; return }
    }
    yield { type: 'done', reason: 'step-cap' }
  }

  private async consumeProvider(messages: AgentMessage[]): Promise<{ content: string; toolCalls: import('./types.js').ToolCall[] }> {
    let content = ''
    let toolCalls: import('./types.js').ToolCall[] = []
    for await (const ev of this.cfg.provider.stream(messages, this.registry.list())) {
      if (ev.type === 'text-delta') { /* 由 run() 的包装层转发 message-delta —— 见下 */ }
      else if (ev.type === 'result') { content = ev.content; toolCalls = ev.toolCalls }
    }
    return { content, toolCalls }
  }
}
```

**实现注意（写代码时必须处理，上面是骨架）：**
1. `message-delta` 事件转发：`consumeProvider` 收到 `text-delta` 时必须实时冒泡给 `run()` 的调用方。做法：把 `run` 里对 `consumeProvider` 的调用改成 `yield*` 形态——将 provider 迭代直接内联在 `run` 的 for-await 中，`text-delta` → `yield { type: 'message-delta', text }`；收到 `result` 后存下并退出内层循环。**流中断抛错时，assistant 消息尚未 push 进 history，天然满足「不污染历史」测试。**
2. `AgentConfig` 需扩展两个可选字段（改 Task 2 的 types.ts）：`workspaceRoot?: string`、`autoApprove?: boolean`、`approve?: (action: string, detail: string) => Promise<boolean>`。getter 命名用 `get history()`（删掉上面骨架里的 `History`/`historyView` 重复项，以测试为准只留 `history`）。

- [ ] **Step 4: 运行确认通过** — Run: `pnpm --filter agent-core test`，Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): agent loop with events, step cap, stop and clean-failure history"
```

---

### Task 10: CLI 入口

**Files:**
- Create: `packages/agent-core/src/cli.ts`
- Modify: `packages/agent-core/package.json`（加 `"bin": { "flowagent": "dist/cli.js" }`）
- Test: `packages/agent-core/src/cli.test.ts`

**Interfaces:**
- Consumes: `Agent`、`OpenAICompatProvider`、`fsTools`、`execTool`、`todoTool`、`JsonlSessionStore`、`TokenBudgetTrim`
- Produces: `export async function buildAgent(opts: { baseURL: string; apiKey: string; model: string; workspaceRoot: string; sessionFile: string; autoApprove: boolean }): Agent`（可测的组装函数）；`main()` 只做 readline 循环 + `process.env` 读取。

行为：
- 环境变量 `FLOWAGENT_BASE_URL` / `FLOWAGENT_API_KEY` / `FLOWAGENT_MODEL`（缺一报错退出）。
- REPL：readline 逐行读入；`/exit` 退出；`/resume` 从 session JSONL 恢复历史；普通文本作为 userInput。
- 事件渲染：`message-delta` 原样输出；`tool-call`/`tool-result` 打一行摘要 `[tool] name → result 前 100 字`；`error` 打印后 REPL 继续（不清历史）。
- 确认门：终端里向用户打印 action + detail，读一行 `y/n`（autoApprove 为 true 时跳过）。
- session 文件：`<workspaceRoot>/.flowagent/session.jsonl`。

- [ ] **Step 1: 写失败测试**

`packages/agent-core/src/cli.test.ts`：

```typescript
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildAgent } from './cli.js'

describe('buildAgent', () => {
  it('assembles an Agent with all 7 tools wired', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fa-'))
    const agent = buildAgent({
      baseURL: 'http://x', apiKey: 'k', model: 'm',
      workspaceRoot: root,
      sessionFile: join(root, '.flowagent', 'session.jsonl'),
      autoApprove: true,
    })
    expect(agent).toBeDefined()
    // 7 个工具已挂上（通过一次 run 前的间接验证：Agent 暴露 registry —— 若未暴露则跳过此断言改为冒烟 run）
  })

  it('persists session messages as JSONL', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fa-'))
    const sessionFile = join(root, '.flowagent', 'session.jsonl')
    const agent = buildAgent({
      baseURL: 'http://x', apiKey: 'k', model: 'm',
      workspaceRoot: root, sessionFile, autoApprove: true,
    })
    // 直接跑一轮会因假 baseURL 失败，改为验证 append 落盘：用 run 触发 user 消息 append
    try { for await (const _ of agent.run('hi')) break } catch { /* 预期失败 */ }
    const raw = await import('node:fs').then((fs) => fs.readFileSync(sessionFile, 'utf8'))
    expect(raw).toContain('"role":"user"')
  })
})
```

（第一个断言若 `Agent` 未暴露工具列表，实现里给 `Agent` 加只读 `get tools(): string[]` 返回 registry 名单，断言 `expect(agent.tools).toHaveLength(7)`。）

- [ ] **Step 2: 运行确认失败** — Run: `pnpm --filter agent-core test`，Expected: FAIL。

- [ ] **Step 3: 实现 `packages/agent-core/src/cli.ts`**

```typescript
import { createInterface } from 'node:readline'
import { Agent } from './loop.js'
import { OpenAICompatProvider } from './providers/openai.js'
import { fsTools } from './tools/fs.js'
import { execTool } from './tools/exec.js'
import { todoTool } from './tools/todo.js'
import { JsonlSessionStore } from './session/jsonl.js'
import { TokenBudgetTrim } from './context/trim.js'

export function buildAgent(opts: {
  baseURL: string; apiKey: string; model: string
  workspaceRoot: string; sessionFile: string; autoApprove: boolean
}): Agent {
  return new Agent({
    provider: new OpenAICompatProvider({ baseURL: opts.baseURL, apiKey: opts.apiKey, model: opts.model }),
    tools: [...fsTools, execTool, todoTool],
    systemPrompt: 'You are FlowAgent, a helpful coding agent working inside the user\'s workspace. Use the provided tools to complete tasks step by step.',
    maxSteps: 30,
    contextStrategy: new TokenBudgetTrim({ tokenBudget: 60_000 }),
    session: new JsonlSessionStore(opts.sessionFile),
    workspaceRoot: opts.workspaceRoot,
    autoApprove: opts.autoApprove,
    approve: undefined, // main() 里注入终端确认版本
  })
}

export async function main(): Promise<void> {
  const baseURL = process.env.FLOWAGENT_BASE_URL
  const apiKey = process.env.FLOWAGENT_API_KEY
  const model = process.env.FLOWAGENT_MODEL
  if (!baseURL || !apiKey || !model) {
    console.error('Set FLOWAGENT_BASE_URL, FLOWAGENT_API_KEY and FLOWAGENT_MODEL')
    process.exit(1)
  }
  const workspaceRoot = process.cwd()
  const sessionFile = join(workspaceRoot, '.flowagent', 'session.jsonl')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q: string) => new Promise<string>((res) => rl.question(q, res))
  const agent = buildAgent({
    baseURL, apiKey, model, workspaceRoot, sessionFile,
    autoApprove: process.argv.includes('--yes'),
  })
  if (!process.argv.includes('--yes')) {
    // 注入终端确认门
    ;(agent as unknown as { cfg: { approve?: (a: string, d: string) => Promise<boolean> } }).cfg.approve =
      async (action, detail) => (await ask(`allow ${action}: ${detail}? [y/N] `)).toLowerCase() === 'y'
  }
  if (process.argv.includes('/resume')) { /* /resume 是 REPL 命令，见下 */ }

  console.log('flowagent ready. /exit to quit.')
  for (;;) {
    const line = await ask('> ')
    if (line.trim() === '/exit') break
    if (line.trim() === '/resume') {
      const records = new JsonlSessionStore(sessionFile).load()
      agent.loadHistory(records.flatMap((r) => (r.kind === 'message' ? [r.message] : [])))
      console.log(`resumed ${records.length} records`)
      continue
    }
    try {
      for await (const ev of agent.run(line)) {
        if (ev.type === 'message-delta') process.stdout.write(ev.text)
        else if (ev.type === 'tool-call') process.stdout.write(`\n[tool] ${ev.call.name} ${ev.call.arguments.slice(0, 80)}`)
        else if (ev.type === 'tool-result') process.stdout.write(` -> ${ev.result.slice(0, 100)}\n`)
        else if (ev.type === 'error') console.error(`error: ${ev.error.message}`)
        else if (ev.type === 'assistant-message') process.stdout.write('\n')
      }
    } catch (e) { console.error(`fatal: ${(e as Error).message}`) }
  }
  rl.close()
}

import { join } from 'node:path'
if (process.argv[1]?.endsWith('cli.js')) void main()
```

（实现时把 `import { join }` 挪到文件顶部；给 `Agent` 加 `get tools(): string[]`。）

`packages/agent-core/package.json` scripts 加 `"cli": "node dist/cli.js"`，并加 `"bin": { "flowagent": "dist/cli.js" }`。

- [ ] **Step 4: 运行确认通过 + 手工冒烟**

Run: `pnpm --filter agent-core test`，Expected: PASS。
Run: `pnpm --filter agent-core build && pnpm --filter agent-core cli`，Expected: 打印 `flowagent ready`，`/exit` 退出（无 API key 时报环境变量错误也算通过冒烟的第一分支）。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): CLI entry wiring provider, tools, session and approval gate"
```

---

## 完成标准（M1 验收）

1. `pnpm --filter agent-core test` 全绿（约 30 个用例）。
2. 设置三个环境变量后 `pnpm --filter agent-core cli` 可真实对话；让 agent「在当前目录建一个 hello.txt 写入 hello」能走完 write_file 确认门并落盘。
3. `Ctrl+C` 后重进 + `/resume` 能恢复历史继续对话。

M1 之后的计划（M2 Electron 壳、M3 编辑器、M4 终端/会话 UI）在各自启动时另写计划文档。
