import { describe, expect, it, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { listSessions, createSession, deleteSession, migrateLegacy } from './session-service.js'

let flowDir: string
let dir: string
beforeEach(() => {
  flowDir = mkdtempSync(join(tmpdir(), 'fa-sess-'))
  dir = join(flowDir, 'sessions')
  mkdirSync(dir)
})

const line = (o: unknown) => JSON.stringify(o) + '\n'

describe('session-service', () => {
  it('listSessions derives title from first user message', () => {
    writeFileSync(join(dir, 'a.jsonl'), line({ kind: 'message', message: { role: 'user', content: '帮我写一个爬虫脚本，要求支持重试' } }))
    writeFileSync(join(dir, 'b.jsonl'), line({ kind: 'message', message: { role: 'system', content: 'sys' } }) + line({ kind: 'message', message: { role: 'user', content: '第二个会话' } }))
    writeFileSync(join(dir, 'c.jsonl'), '') // 空会话
    const byFile = Object.fromEntries(listSessions(dir).map((s) => [s.file, s]))
    expect(byFile['a.jsonl'].title).toBe('帮我写一个爬虫脚本，要求支持重试'.slice(0, 40))
    expect(byFile['b.jsonl'].title).toBe('第二个会话')      // 跳过 system 取首条 user
    expect(byFile['c.jsonl'].title).toBe('(空会话)')
  })
  it('listSessions sorts by mtime desc with filename-desc tiebreak', async () => {
    writeFileSync(join(dir, 'm.jsonl'), '')
    await new Promise((r) => setTimeout(r, 20))
    writeFileSync(join(dir, 'n.jsonl'), '')
    // mtime 可能同秒：tiebreak 按文件名降序 → n 在前；若 mtime 已区分则 n（新写）在前——两种情况 n.jsonl 都应居首
    expect(listSessions(dir)[0].file).toBe('n.jsonl')
  })
  it('createSession makes empty file with timestamped name', () => {
    const meta = createSession(dir)
    expect(meta.title).toBe('(空会话)')
    expect(meta.file).toMatch(/^\d{4}-\d{2}-\d{2}T\d{6}-[0-9a-f]{4}\.jsonl$/)
    expect(existsSync(join(dir, meta.file))).toBe(true)
  })
  it('deleteSession rejects path separators and traversal', () => {
    expect(() => deleteSession(dir, '..\\evil.jsonl')).toThrow()
    expect(() => deleteSession(dir, 'sub/x.jsonl')).toThrow()
    expect(() => deleteSession(dir, '../outside.jsonl')).toThrow()
    writeFileSync(join(dir, 'ok.jsonl'), '')
    deleteSession(dir, 'ok.jsonl')
    expect(readdirSync(dir)).not.toContain('ok.jsonl')
  })
  it('migrateLegacy moves old session.jsonl keeping history', () => {
    writeFileSync(join(flowDir, 'session.jsonl'), line({ kind: 'message', message: { role: 'user', content: '旧会话' } }))
    const moved = migrateLegacy(dir)
    expect(moved).toBeTruthy()
    expect(existsSync(join(flowDir, 'session.jsonl'))).toBe(false)
    expect(listSessions(dir).some((s) => s.file === moved && s.title === '旧会话')).toBe(true)
  })
  it('migrateLegacy is noop when no legacy file', () => {
    expect(migrateLegacy(dir)).toBeNull()
  })
})
