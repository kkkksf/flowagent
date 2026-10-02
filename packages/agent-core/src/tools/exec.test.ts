import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ToolContext } from '../types.js'
import { execTool, decodeChunk } from './exec.js'
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
  it('truncates output over cap with marker', async () => {
    const out = await execTool.execute(
      { command: `node -e "process.stdout.write('x'.repeat(40000))"` },
      ctx,
    )
    expect(out).toContain('[truncated]')
    expect(out.length).toBeLessThanOrEqual(30_000 + '\n...[truncated]'.length + '\n[exit code: 0]'.length)
  })
  it('requires approval', async () => {
    const c2: ToolContext = { ...ctx, approve: async () => false }
    expect(await execTool.execute({ command: 'echo hi' }, c2)).toMatch(/denied/i)
  })
  it('interactive command fails fast on EOF instead of hanging (stdin ignored)', async () => {
    // 等待 stdin 的进程在 stdio:'ignore' 下立即收到 EOF 退出；
    // setInterval 保活确保退出只能来自 stdin end（而非事件循环空转）
    const out = await execTool.execute(
      { command: 'node -e "process.stdin.resume(); process.stdin.on(\'end\', () => process.exit(0)); setInterval(()=>{}, 1000)"', timeout_ms: 5000 },
      ctx,
    )
    expect(out).toMatch(/exit code: 0/i)
    expect(out).not.toMatch(/timed out/i)
  }, 8000)
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

describe('decodeChunk', () => {
  it('decodes valid utf-8 as-is', () => {
    expect(decodeChunk(Buffer.from('hello 中文', 'utf8'))).toBe('hello 中文')
  })
  it('falls back to gbk for chinese windows console output', () => {
    // GBK 编码的"系统找不到指定的路径。"（Windows 中文 cmd 报错原文）
    const gbk = Buffer.from([0xcf, 0xb5, 0xcd, 0xb3, 0xd5, 0xd2, 0xb2, 0xbb, 0xb5, 0xbd])
    expect(decodeChunk(gbk)).toBe('系统找不到')
  })
  it('degrades to lossy utf-8 when both fail', () => {
    // 0xff 在 UTF-8 与 GBK 下均非法（GBK 单区也覆盖不到），走退化分支不抛错
    expect(typeof decodeChunk(Buffer.from([0xff, 0xfe, 0xfd]))).toBe('string')
  })
})
