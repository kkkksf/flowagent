import { describe, expect, it } from 'vitest'
import type { AgentConfig, AgentEvent, AgentMessage, LlmProvider, ProviderEvent, ToolDefinition } from './types.js'
import { TokenBudgetTrim } from './context/trim.js'
import { Agent } from './loop.js'
import { NullSessionStore } from './session/jsonl.js'

// 脚本化假 provider：每次调用弹出一个"轮次脚本"
function fakeProvider(turns: ProviderEvent[][], errorAfter?: { turn: number; duringDelta: boolean }): LlmProvider {
  let call = 0
  return {
    async *stream(): AsyncGenerator<ProviderEvent> {
      const i = call++
      if (errorAfter && i === errorAfter.turn && errorAfter.duringDelta) {
        yield { type: 'text-delta', text: 'par' }
        throw new Error('connection reset')
      }
      if (i >= turns.length) return
      yield* turns[i]
    },
  }
}

const echoTool: ToolDefinition = {
  name: 'echo', description: 'echo',
  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  async execute(args) { return `echo:${String(args.text)}` },
}

function makeAgent(provider: LlmProvider, tools: ToolDefinition[] = [echoTool], maxSteps = 30): Agent {
  const cfg: AgentConfig = {
    provider, tools, systemPrompt: 'sys', maxSteps,
    contextStrategy: new TokenBudgetTrim({ tokenBudget: 100_000 }),
    session: new NullSessionStore(),
  }
  return new Agent(cfg)
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}

describe('Agent loop', () => {
  it('runs a tool then finishes with text', async () => {
    const p = fakeProvider([
      [{ type: 'result', content: '', toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"text":"hi"}' }] }],
      [{ type: 'result', content: 'all done', toolCalls: [] }],
    ])
    const events = await collect(makeAgent(p).run('do it'))
    expect(events).toContainEqual({ type: 'tool-result', call: { id: 'c1', name: 'echo', arguments: '{"text":"hi"}' }, result: 'echo:hi' })
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'completed' })
  })

  it('appends tool result to history so the next LLM call sees it', async () => {
    let seen: AgentMessage[] = []
    let call = 0
    const p: LlmProvider = {
      async *stream(messages) {
        if (call++ === 1) seen = messages
        yield { type: 'result', content: call === 1 ? '' : 'ok', toolCalls: call === 1 ? [{ id: 'c1', name: 'echo', arguments: '{"text":"x"}' }] : [] }
      },
    }
    await collect(makeAgent(p).run('go'))
    const toolMsg = seen.find((m) => m.role === 'tool')
    expect(toolMsg).toMatchObject({ role: 'tool', toolCallId: 'c1', content: 'echo:x' })
  })

  it('partial stream does not pollute history', async () => {
    const p = fakeProvider([], { turn: 0, duringDelta: true })
    const agent = makeAgent(p)
    const events = await collect(agent.run('hi'))
    expect(events.at(-1)).toMatchObject({ type: 'error' })
    expect(agent.history.filter((m) => m.role === 'assistant')).toHaveLength(0)
    expect(agent.history.at(-1)).toMatchObject({ role: 'user', content: 'hi' })
  })

  it('stops at step cap', async () => {
    const p = fakeProvider([[{ type: 'result', content: '', toolCalls: [{ id: 'c', name: 'echo', arguments: '{}' }] }]])
    const events = await collect(makeAgent(p, [echoTool], 3).run('loop'))
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'step-cap' })
  })

  it('stop() interrupts before next LLM call', async () => {
    const p = fakeProvider([
      [{ type: 'result', content: '', toolCalls: [{ id: 'c1', name: 'echo', arguments: '{}' }] }],
      [{ type: 'result', content: 'should not run', toolCalls: [] }],
    ])
    const agent = makeAgent(p)
    const events: AgentEvent[] = []
    for await (const e of agent.run('go')) {
      events.push(e)
      if (e.type === 'tool-result') agent.stop()
    }
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'stopped' })
    expect(events.some((e) => e.type === 'message-delta')).toBe(false)
  })

  it('run() resets the stop flag so a later run on the same agent works', async () => {
    const p = fakeProvider([
      [{ type: 'result', content: '', toolCalls: [{ id: 'c1', name: 'echo', arguments: '{}' }] }],
      [{ type: 'result', content: 'second run done', toolCalls: [] }],
    ])
    const agent = makeAgent(p)
    const first: AgentEvent[] = []
    for await (const e of agent.run('go')) {
      first.push(e)
      if (e.type === 'tool-result') agent.stop()
    }
    expect(first.at(-1)).toMatchObject({ type: 'done', reason: 'stopped' })
    const second = await collect(agent.run('again'))
    expect(second.some((e) => e.type === 'assistant-message' || e.type === 'message-delta')).toBe(true)
    expect(second.at(-1)).toMatchObject({ type: 'done', reason: 'completed' })
  })

  it('loadHistory keeps a provided leading system message', () => {
    const agent = makeAgent(fakeProvider([]))
    agent.loadHistory([{ role: 'system', content: 'custom' }, { role: 'user', content: 'u' }])
    expect(agent.history[0]).toMatchObject({ role: 'system', content: 'custom' })
    expect(agent.history).toHaveLength(2)
  })

  it('loadHistory prepends the constructor system message when missing', () => {
    const agent = makeAgent(fakeProvider([]))
    agent.loadHistory([{ role: 'user', content: 'u' }, { role: 'assistant', content: 'a', toolCalls: [] }])
    expect(agent.history[0]).toMatchObject({ role: 'system', content: 'sys' })
    expect(agent.history).toHaveLength(3)
  })

  it('streams message deltas', async () => {
    const p = fakeProvider([[{ type: 'text-delta', text: 'He' }, { type: 'text-delta', text: 'y' }, { type: 'result', content: 'Hey', toolCalls: [] }]])
    const events = await collect(makeAgent(p).run('hi'))
    expect(events).toContainEqual({ type: 'message-delta', text: 'He' })
    expect(events).toContainEqual({ type: 'message-delta', text: 'y' })
  })
})
