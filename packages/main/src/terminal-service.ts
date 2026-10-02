import type { PtyLike } from './pty-factory.js'

// attach 缓冲上限：64KB 滚动窗口，超出保留尾部
const MAX_BUFFER = 64 * 1024

export class TerminalService {
  private pty: PtyLike | null = null
  private buffer = ''
  private attached = false
  private exitedNotified = false
  private lastCwd = ''

  constructor(private deps: { spawnPty(o: { cwd: string; cols: number; rows: number }): PtyLike; onChunk(d: string): void; onExit(): void }) {}

  start(cwd: string): void {
    if (this.pty) this.killInternal()
    this.lastCwd = cwd
    this.exitedNotified = false
    const pty = this.deps.spawnPty({ cwd, cols: 80, rows: 24 })
    this.pty = pty
    pty.onData((d) => {
      if (this.pty !== pty) return // 旧实例的迟到事件：忽略
      if (this.attached) this.deps.onChunk(d)
      else {
        this.buffer += d
        if (this.buffer.length > MAX_BUFFER) this.buffer = this.buffer.slice(this.buffer.length - MAX_BUFFER)
      }
    })
    pty.onExit(() => {
      if (this.pty !== pty || this.exitedNotified) return
      this.exitedNotified = true
      this.pty = null
      this.deps.onExit()
    })
  }

  write(data: string): void { this.pty?.write(data) }

  resize(cols: number, rows: number): void { this.pty?.resize(cols, rows) }

  attach(cols: number, rows: number): string {
    if (this.attached) return ''
    this.attached = true
    this.resize(cols, rows)
    const out = this.buffer
    this.buffer = ''
    return out
  }

  kill(): void { this.killInternal() }

  restart(): void {
    // kill + start；已 attached 保持直推模式，缓冲窗口重置（供未来重连回放）
    if (this.pty) this.killInternal()
    this.buffer = ''
    this.start(this.lastCwd)
  }

  private killInternal(): void { this.pty?.kill(); this.pty = null }
}
