import { describe, expect, it } from 'vitest'
import { createChatStore } from './chat-store.js'

describe('chat store', () => {
  it('accumulates deltas into one assistant bubble', () => {
    const s = createChatStore().getState()
    s.applyEvent({ type: 'message-delta', text: 'he' })
    s.applyEvent({ type: 'message-delta', text: 'llo' })
    s.applyEvent({ type: 'assistant-done' })
    expect(s.items).toEqual([{ kind: 'assistant', text: 'hello', tools: [] }])
  })

  it('pairs tool result to card by id', () => {
    const s = createChatStore().getState()
    s.applyEvent({ type: 'tool-call', call: { id: 't1', name: 'run_command', arguments: '{"command":"ls"}' } })
    s.applyEvent({ type: 'tool-result', id: 't1', result: 'file-a' })
    s.applyEvent({ type: 'agent-idle' })
    const asst = s.items.at(-1) as { kind: 'assistant'; tools: { id: string; status: string; result: string }[] }
    expect(asst.tools[0]).toMatchObject({ id: 't1', status: 'done', result: 'file-a' })
    expect(s.running).toBe(false)
  })

  it('marks tool card error when result starts with error:', () => {
    const s = createChatStore().getState()
    s.applyEvent({ type: 'tool-call', call: { id: 't9', name: 'write_file', arguments: '{"path":"x"}' } })
    s.applyEvent({ type: 'tool-result', id: 't9', result: 'error: tool "write_file" threw: denied' })
    const asst = s.items.at(-1) as { tools: { status: string }[] }
    expect(asst.tools[0].status).toBe('error')
  })

  it('history maps tool results onto cards by toolCallId', () => {
    const s = createChatStore().getState()
    s.applyEvent({
      type: 'history',
      messages: [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'a1', name: 'write_file', arguments: '{"path":"a.txt"}' }] },
        { role: 'tool', toolCallId: 'a1', content: 'wrote 3 bytes' },
        { role: 'assistant', content: 'done', toolCalls: [] },
      ],
    })
    expect(s.items).toEqual([
      { kind: 'user', text: 'go' },
      { kind: 'assistant', text: '', tools: [{ id: 'a1', name: 'write_file', argsSummary: 'a.txt', path: 'a.txt', status: 'done', result: 'wrote 3 bytes' }] },
      { kind: 'assistant', text: 'done', tools: [] },
    ])
  })

  it('approval-required carries payload', () => {
    const s = createChatStore().getState()
    s.applyEvent({ type: 'approval-required', id: 'ap9', action: 'write_file', detail: 'p.txt', payload: { path: 'p.txt', kind: 'write', content: 'X' } })
    expect(s.items.at(-1)).toMatchObject({ kind: 'approval', id: 'ap9', payload: { path: 'p.txt', kind: 'write' } })
  })

  it('tool-call parses path from arguments', () => {
    const s = createChatStore().getState()
    s.applyEvent({ type: 'tool-call', call: { id: 't2', name: 'edit_file', arguments: '{"path":"a.txt","old_string":"x"}' } })
    s.applyEvent({ type: 'tool-call', call: { id: 't3', name: 'run_command', arguments: '{"command":"ls"}' } })
    const asst = s.items.at(-1) as { tools: { id: string; path?: string }[] }
    expect(asst.tools[0].path).toBe('a.txt')
    expect(asst.tools[1].path).toBeUndefined()
  })

  it('tool-call normalizes backslash paths', () => {
    const s = createChatStore().getState()
    s.applyEvent({ type: 'tool-call', call: { id: 't4', name: 'write_file', arguments: '{"path":"src\\\\a.txt"}' } })
    const asst = s.items.at(-1) as { tools: { path?: string }[] }
    expect(asst.tools[0].path).toBe('src/a.txt') // 点击跳转/审批载荷与编辑器标签同身份
  })

  it('approval card then error then idle', () => {
    const s = createChatStore().getState()
    s.applyEvent({ type: 'approval-required', id: 'ap1', action: 'run_command', detail: 'python hello.py' })
    s.applyEvent({ type: 'error', message: 'LLM API: balance insufficient' })
    s.applyEvent({ type: 'agent-idle' })
    expect(s.items.map((i) => i.kind)).toEqual(['approval', 'error'])
    expect(s.running).toBe(false)
  })

  it('approval-resolved marks the card as allowed', () => {
    const s = createChatStore().getState()
    s.applyEvent({ type: 'approval-required', id: 'ap2', action: 'write_file', detail: 'hello.py' })
    s.applyEvent({ type: 'approval-resolved', id: 'ap2', allowed: true })
    expect(s.items).toEqual([{ kind: 'approval', id: 'ap2', action: 'write_file', detail: 'hello.py', resolved: 'allowed' }])
  })

  it('usage takes latest not sum; history resets', () => {
    const s = createChatStore().getState()
    s.applyEvent({ type: 'usage', promptTokens: 10, completionTokens: 5 })
    s.applyEvent({ type: 'usage', promptTokens: 25, completionTokens: 8 }) // 第二次请求已含全部历史
    expect(s.usage).toEqual({ prompt: 25, completion: 8 })
    s.applyEvent({ type: 'history', messages: [] })                          // 切会话
    expect(s.usage).toBeNull()
  })

  it('lastUserMessage finds latest user text', () => {
    const s = createChatStore().getState()
    s.applyEvent({ type: 'message-delta', text: 'x' })
    expect(s.lastUserMessage()).toBe(null)
    s.applyEvent({ type: 'history', messages: [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'ok', toolCalls: [] }] })
    expect(s.lastUserMessage()).toBe('earlier')
  })
})
