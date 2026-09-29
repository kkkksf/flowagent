import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs'
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
    await new Promise((r) => setTimeout(r, 100)) // 给 watcher 一点启动时间
    writeFileSync(join(root, 'w.txt'), 'b', 'utf8')
    await waitFor(() => changed.includes('w.txt'))
  })
  it('watch reports errors via onWatchError and unwatches', async () => {
    // Windows 实测：删除被 watch 文件本身只触发 rename；递归删除其父目录会触发 EPERM error
    mkdirSync(join(root, 'd'))
    writeFileSync(join(root, 'd/f.txt'), 'a', 'utf8')
    const errors: Array<{ p: string; err: unknown }> = []
    const svc2 = new FileService(root, {
      onFileChanged: (p) => changed.push(p),
      onWatchError: (p, err) => errors.push({ p, err }),
    })
    svc2.watch('d/f.txt')
    await new Promise((r) => setTimeout(r, 100)) // 给 watcher 一点启动时间
    rmSync(join(root, 'd'), { recursive: true, force: true })
    await waitFor(() => errors.length > 0)
    expect(errors[0].p).toBe('d/f.txt')
    expect(errors[0].err).toBeTruthy()
    svc2.unwatchAll() // error handler 已清理过；再清一次验证幂等
  })
  it('unwatchAll closes everything', () => {
    writeFileSync(join(root, 'u.txt'), '', 'utf8')
    svc.watch('u.txt'); svc.watch('u.txt') // 幂等
    svc.unwatchAll()
    // 无崩溃即通过；重复 close 的健壮性由实现保证
  })
})
