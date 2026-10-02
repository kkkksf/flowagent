import { describe, expect, it } from 'vitest'
import { TerminalService, } from './terminal-service.js'
import type { PtyLike } from './pty-factory.js'

function fakePty(): { pty: PtyLike; emitData: (d: string) => void; emitExit: () => void; writes: string[]; resized: Array<[number, number]>; killed: number } {
  const writes: string[] = []
  const resized: Array<[number, number]> = []
  let killed = 0
  let dataCb: ((d: string) => void) | undefined
  let exitCb: (() => void) | undefined
  const pty: PtyLike = {
    write: (d) => { writes.push(d) },
    resize: (c, r) => { resized.push([c, r]) },
    kill: () => { killed++ },
    onData: (cb) => { dataCb = cb },
    onExit: (cb) => { exitCb = cb },
  }
  return { pty, emitData: (d) => { dataCb?.(d) }, emitExit: () => { exitCb?.() }, writes, resized, get killed() { return killed } }
}

describe('TerminalService', () => {
  it('attach returns buffered output then streams', () => {
    const chunks: string[] = []
    const f = fakePty()
    const svc = new TerminalService({ spawnPty: () => f.pty, onChunk: (d) => chunks.push(d), onExit: () => {} })
    svc.start('E:/w')
    f.emitData('banner\r\n')          // attach 前的输出 → 进缓冲
    expect(chunks).toEqual([])        // 未 attach：不推送
    const buffered = svc.attach(100, 30)
    expect(buffered).toBe('banner\r\n')
    f.emitData('live')
    expect(chunks).toEqual(['live'])  // attach 后：直推
    expect(svc.attach(100, 30)).toBe('') // 二次 attach：空串
  })
  it('write and resize pass through (attach applies initial resize)', () => {
    const f = fakePty()
    const svc = new TerminalService({ spawnPty: () => f.pty, onChunk: () => {}, onExit: () => {} })
    svc.start('E:/w'); svc.attach(80, 24)
    svc.write('dir\r')
    expect(f.writes).toEqual(['dir\r'])
    svc.resize(120, 40)
    expect(f.resized).toEqual([[80, 24], [120, 40]])
  })
  it('exit fires onExit once and restart keeps streaming', () => {
    const chunks: string[] = []
    let exited = 0
    const f = fakePty()
    const svc = new TerminalService({ spawnPty: () => f.pty, onChunk: (d) => chunks.push(d), onExit: () => { exited++ } })
    svc.start('E:/w'); svc.attach(80, 24)
    f.emitExit()
    expect(exited).toBe(1)
    svc.restart()
    f.emitData('new banner')
    expect(chunks).toEqual(['new banner']) // 已 attach：restart 后仍直推（不回缓冲模式）
  })
  it('buffer caps at 64KB keeping the tail', () => {
    const f = fakePty()
    const svc = new TerminalService({ spawnPty: () => f.pty, onChunk: () => {}, onExit: () => {} })
    svc.start('E:/w')
    f.emitData('x'.repeat(80_000))
    const buffered = svc.attach(80, 24)
    expect(buffered.length).toBeLessThanOrEqual(65_536)
    expect(buffered.endsWith('x')).toBe(true) // 保留的是尾部
  })
  it('start is idempotent (kills old instance first)', () => {
    const f = fakePty()
    const svc = new TerminalService({ spawnPty: () => f.pty, onChunk: () => {}, onExit: () => {} })
    svc.start('E:/w')
    svc.start('E:/w2')
    expect(f.killed).toBe(1)
  })
})
