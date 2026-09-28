import { describe, expect, it } from 'vitest'
import type { AgentEvent, AgentMessage } from 'agent-core'
import { AgentHost, type AgentLike } from './agent-host.js'
import type { FaEvent } from './protocol.js'

function fakeAgent(run: (input: string) => AsyncGenerator<AgentEvent>): { agent: AgentLike; stopped: () => boolean } {
  let stopped = false
  return {
    agent: {
      run,
      stop: () => { stopped = true },
      loadHistory: (_m: AgentMessage[]) => {},
    },
    stopped: () => stopped,
  }
}

const eventsOf = () => {
  const out: FaEvent[] = []
  return { sink: { emit: (e: FaEvent) => out.push(e) }, out }
}

describe('AgentHost', () => {
  it('forwards stream events and ends with agent-idle', async () => {
    async function* gen(): AsyncGenerator<AgentEvent> {
      yield { type: 'message-delta', text: 'hi' }
      yield { type: 'assistant-message', message: { role: 'assistant', content: 'hi', toolCalls: [] } }
      yield { type: 'done', reason: 'completed' }
    }
    const { sink, out } = eventsOf()
    const host = new AgentHost({ emit: sink.emit, makeAgent: () => fakeAgent(gen).agent })
    await host.send('q')
    expect(out.map((e) => e.type)).toEqual(['message-delta', 'assistant-done', 'agent-idle'])
  })

  it('emits agent-idle even when run throws', async () => {
    const { sink, out } = eventsOf()
    const host = new AgentHost({
      emit: sink.emit,
      makeAgent: () => ({
        run: async function* (): AsyncGenerator<AgentEvent> { throw new Error('boom') },
        stop: () => {},
        loadHistory: () => {},
      }),
    })
    await host.send('q')
    expect(out).toContainEqual({ type: 'error', message: 'boom' })
    expect(out.at(-1)).toEqual({ type: 'agent-idle' })
  })

  it('rejects send while busy', async () => {
    async function* gen(): AsyncGenerator<AgentEvent> {
      yield new Promise<AgentEvent>((r) => setTimeout(() => r({ type: 'step', step: 1 }), 30)) as never
      yield { type: 'done', reason: 'completed' }
    }
    const { sink } = eventsOf()
    const host = new AgentHost({ emit: sink.emit, makeAgent: () => fakeAgent(gen).agent })
    const p = host.send('first')
    await expect(host.send('second')).rejects.toThrow('busy')
    await p
  })

  it('approval roundtrip: emit card, resolve allow', async () => {
    const { sink, out } = eventsOf()
    let approveDecision = false
    const host = new AgentHost({
      emit: sink.emit,
      makeAgent: (approve) => ({
        run: async function* (): AsyncGenerator<AgentEvent> {
          approveDecision = await approve('write_file', 'a.txt')
          yield { type: 'done', reason: 'completed' }
        },
        stop: () => {},
        loadHistory: () => {},
      }),
    })
    const p = host.send('q')
    await new Promise((r) => setTimeout(r, 10)) // 等 approval-required 发出
    const card = out.find((e) => e.type === 'approval-required')
    expect(card).toBeDefined()
    host.respondApproval((card as { id: string }).id, true)
    await p
    expect(approveDecision).toBe(true)
    expect(out).toContainEqual({ type: 'approval-resolved', id: (card as { id: string }).id, allowed: true })
  })

  it('stop resolves pending approval as deny and stops agent', async () => {
    const { sink } = eventsOf()
    const { agent, stopped } = fakeAgent(async function* (): AsyncGenerator<AgentEvent> {
      yield { type: 'done', reason: 'stopped' }
    })
    let decision: boolean | undefined
    const host = new AgentHost({
      emit: sink.emit,
      makeAgent: (approve) => ({
        run: async function* (): AsyncGenerator<AgentEvent> {
          decision = await approve('run_command', 'rm -rf /')
          yield { type: 'done', reason: 'stopped' }
        },
        stop: agent.stop,
        loadHistory: () => {},
      }),
    })
    const p = host.send('q')
    await new Promise((r) => setTimeout(r, 10))
    host.stop()
    await p
    expect(decision).toBe(false)
    expect(stopped()).toBe(true)
  })

  it('auto-approve skips approval event', async () => {
    const { sink, out } = eventsOf()
    let decision: boolean | undefined
    const host = new AgentHost({
      emit: sink.emit,
      makeAgent: (approve) => ({
        run: async function* (): AsyncGenerator<AgentEvent> {
          decision = await approve('write_file', 'a.txt')
          yield { type: 'done', reason: 'completed' }
        },
        stop: () => {},
        loadHistory: () => {},
      }),
    })
    host.setAutoApprove(true)
    await host.send('q')
    expect(decision).toBe(true)
    expect(out.some((e) => e.type === 'approval-required')).toBe(false)
  })
})
