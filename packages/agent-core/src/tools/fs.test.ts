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

  it('edit writes new_string containing $& literally', async () => {
    await get('write_file').execute({ path: 'dollar.txt', content: 'one two three' }, ctx)
    const out = await get('edit_file').execute({ path: 'dollar.txt', old_string: 'two', new_string: '[$&]' }, ctx)
    expect(out).toMatch(/ok/i)
    expect(await get('read_file').execute({ path: 'dollar.txt' }, ctx)).toBe('one [$&] three')
  })

  it('grep with invalid regex returns error text, does not throw', async () => {
    const out = await get('grep').execute({ pattern: '(', include: '*.txt' }, ctx)
    expect(out).toMatch(/error/i)
  })

  it('read_file accepts a file named ..config', async () => {
    await writeFile(join(root, '..config'), 'cfg')
    expect(await get('read_file').execute({ path: '..config' }, ctx)).toBe('cfg')
  })

  it('glob ? matches a single character', async () => {
    const out = await get('glob').execute({ pattern: 'hell?.txt' }, ctx)
    expect(out).toContain('hello.txt')
  })
})
