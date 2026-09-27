import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildAgent } from './cli.js'

describe('buildAgent', () => {
  it('assembles an Agent with all 8 tools wired', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fa-'))
    const agent = buildAgent({
      baseURL: 'http://x', apiKey: 'k', model: 'm',
      workspaceRoot: root,
      sessionFile: join(root, '.flowagent', 'session.jsonl'),
      autoApprove: true,
    })
    expect(agent).toBeDefined()
    // fsTools 6 + execTool + todoTool = 8 个工具
    expect(agent.tools).toHaveLength(8)
    expect(agent.tools).toEqual(
      expect.arrayContaining(['read_file', 'write_file', 'edit_file', 'list_dir', 'glob', 'grep', 'run_command', 'todo']),
    )
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
    const raw = readFileSync(sessionFile, 'utf8')
    expect(raw).toContain('"role":"user"')
  })
})
