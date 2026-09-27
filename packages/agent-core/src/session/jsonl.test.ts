import { appendFileSync, rmSync, writeFileSync } from 'node:fs'
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
