import { describe, expect, it } from 'vitest'
import type { AgentEvent, AgentMessage, ToolCall } from './types.js'

describe('types', () => {
  it('constructs a valid assistant message with tool calls', () => {
    const call: ToolCall = { id: 'c1', name: 'read_file', arguments: '{"path":"a.txt"}' }
    const msg: AgentMessage = { role: 'assistant', content: 'thinking', toolCalls: [call] }
    const ev: AgentEvent = { type: 'assistant-message', message: msg }
    expect(ev.type).toBe('assistant-message')
  })
})
