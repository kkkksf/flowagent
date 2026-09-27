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
    const t = new TokenBudgetTrim({ tokenBudget: 100 })
    const hist = [sys, asst('c1'), tool('c1'), user, asst('c2'), tool('c2')]
    const out = t.trim(hist, 100)
    const ids = new Set(out.filter((m) => m.role === 'assistant').flatMap((m) => (m as { toolCalls: { id: string }[] }).toolCalls.map((c) => c.id)))
    for (const m of out.filter((m) => m.role === 'tool')) ids.delete((m as { toolCallId: string }).toolCallId)
    expect(ids.size).toBe(0) // 没有孤儿 toolCall
  })
})
