import { describe, expect, it } from 'vitest'
import { repairDanglingToolCalls } from './repair.js'
import type { AgentMessage } from '../types.js'

describe('repairDanglingToolCalls', () => {
  it('synthesizes missing tool results', () => {
    const msgs: AgentMessage[] = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', toolCalls: [
        { id: 'a1', name: 'write_file', arguments: '{}' },
        { id: 'a2', name: 'run_command', arguments: '{}' },
      ] },
      { role: 'tool', toolCallId: 'a1', content: 'ok' },
      // a2 缺失：中断残留
      { role: 'assistant', content: 'done', toolCalls: [] },
    ]
    expect(repairDanglingToolCalls(msgs)).toEqual([
      msgs[0], msgs[1],
      { role: 'tool', toolCallId: 'a2', content: 'error: interrupted before completion' },
      msgs[2], msgs[3],
    ])
  })
  it('is a no-op when nothing dangles', () => {
    const msgs: AgentMessage[] = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'a1', name: 'x', arguments: '{}' }] },
      { role: 'tool', toolCallId: 'a1', content: 'ok' },
    ]
    expect(repairDanglingToolCalls(msgs)).toBe(msgs)
  })
})
