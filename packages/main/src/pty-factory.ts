// 统一 pty 入口：spike 结论决定 require 哪个包，切换只改此文件
import nodePty from 'node-pty' // 或 '@homebridge/node-pty-prebuilt-multiarch'

export interface PtyLike {
  write(d: string): void
  resize(c: number, r: number): void
  kill(): void
  onData(cb: (d: string) => void): void
  onExit(cb: () => void): void
}

export function spawnPty(opts: { cwd: string; cols: number; rows: number; shell?: string }): PtyLike {
  const spawn = (sh: string): PtyLike =>
    nodePty.spawn(sh, [], { name: 'xterm-256color', cols: opts.cols, rows: opts.rows, cwd: opts.cwd }) as unknown as PtyLike
  if (opts.shell) return spawn(opts.shell) // 显式覆盖优先
  if (process.platform === 'win32') {
    // spec §2：首选 pwsh；node-pty 在 Windows 缺二进制时同步抛错，catch 后回退 powershell.exe
    try { return spawn('pwsh.exe') } catch { return spawn('powershell.exe') }
  }
  return spawn(process.env.SHELL ?? 'bash')
}
