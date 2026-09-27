import { mkdtemp } from 'node:fs/promises'
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
