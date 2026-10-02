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
  const shell = opts.shell ?? (process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL ?? 'bash')
  return nodePty.spawn(shell, [], { name: 'xterm-256color', cols: opts.cols, rows: opts.rows, cwd: opts.cwd }) as unknown as PtyLike
}
