import { describe, expect, it } from 'vitest'
import type { AgentMessage } from '../types.js'
import { TokenBudgetTrim } from './trim.js'

const sys: AgentMessage = { role: 'system', content: 'sys' }
const user: AgentMessage = { role: 'user', content: 'q' }
const asst = (n: string): AgentMessage => ({ role: 'assistant', content: n, toolCalls: [{ id: n, name: 'read_file', arguments: '{}' }] })
const tool = (n: string): AgentMessage => ({ role: 'tool', toolCallId: n, content: 'x'.repeat(4000) })

describe('TokenBudgetTrim', () => {
  it('keeps system and recent messages untouched when under budget', () => {
    const t = new TokenBudgetTrim({ tokenBudget: 1_000_000 })
    const hist = [sys, user]
    expect(t.trim(hist, 10_000)).toEqual(hist)
  })
  it('truncates old tool results to summaries under pressure', () => {
    const t = new TokenBudgetTrim({ tokenBudget: 1_000 })
    const hist = [sys, user, asst('c1'), tool('c1'), user, asst('c2'), tool('c2')]
    const out = t.trim(hist, 1_000)
    const oldTool = out.find((m) => m.role === 'tool' && (m as { toolCallId: string }).toolCallId === 'c1')
    expect((oldTool as { content: string }).content.length).toBeLessThanOrEqual(520)
    expect((oldTool as { content: string }).content).toContain('...[trimmed]')
  })
  it('never drops the system message or the last 6 messages', () => {
    const t = new TokenBudgetTrim({ tokenBudget: 100 })
    const hist: AgentMessage[] = [sys]
    for (let i = 0; i < 20; i++) hist.push(i % 2 ? tool(`c${i}`) : asst(`c${i}`))
    const out = t.trim(hist, 100)
    expect(out[0]).toEqual(sys)
    expect(out.length).toBeGreaterThanOrEqual(6)
    expect(out.slice(-6)).toEqual(hist.slice(-6))
  })
  it('keeps assistant toolCalls paired with their tool results when dropping', () => {
    // 超过 6 条非 system 消息，确保丢弃循环真正执行；
    // asst c1 带两个 toolCalls（c1、c1b）：丢弃它必须同时丢弃两个 tool 结果，不能留下孤儿。
    const asst2 = (n: string, extra?: string): AgentMessage => ({
      role: 'assistant', content: n,
      toolCalls: [{ id: n, name: 'read_file', arguments: '{}' }, ...(extra ? [{ id: extra, name: 'read_file', arguments: '{}' }] : [])],
    })
    const hist: AgentMessage[] = [
      sys,
      asst2('c1', 'c1b'), tool('c1'), tool('c1b'),
      user, asst('c2'), tool('c2'),
      user, asst('c3'), tool('c3'),
    ]
    const out = new TokenBudgetTrim({ tokenBudget: 100 }).trim(hist, 100)
    expect(out.filter((m) => m.role !== 'system').length).toBeLessThan(hist.length - 1) // 确实发生了丢弃
    // 每个存留 tool 消息都有对应的 assistant
    const callIds = new Set(out.filter((m) => m.role === 'assistant').flatMap((m) => (m as { toolCalls: { id: string }[] }).toolCalls.map((c) => c.id)))
    for (const m of out.filter((m) => m.role === 'tool')) {
      expect(callIds.has((m as { toolCallId: string }).toolCallId)).toBe(true) // 无孤儿 tool 结果
    }
    // 每个存留 assistant 的所有 toolCalls 都有对应 tool 消息
    const resultIds = new Set(out.filter((m) => m.role === 'tool').map((m) => (m as { toolCallId: string }).toolCallId))
    for (const id of callIds) {
      expect(resultIds.has(id)).toBe(true) // 无孤儿 toolCall
    }
  })
})
