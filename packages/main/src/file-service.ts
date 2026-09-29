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
