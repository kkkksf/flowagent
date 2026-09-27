import type { AgentMessage, LlmProvider, ProviderEvent, ToolCall, ToolDefinition } from '../types.js'
import { parseSse } from './sse.js'

interface OpenAiDelta {
  content?: string
  tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[]
}
type ParsedCall = { id: string; name: string; arguments: string }

export class OpenAICompatProvider implements LlmProvider {
  private maxRetries: number
  private fetchImpl: typeof fetch
  constructor(private cfg: { baseURL: string; apiKey: string; model: string; maxRetries?: number; fetchImpl?: typeof fetch }) {
    this.maxRetries = cfg.maxRetries ?? 3
    this.fetchImpl = cfg.fetchImpl ?? fetch
  }

  async *stream(messages: AgentMessage[], tools: ToolDefinition[]): AsyncGenerator<ProviderEvent> {
    const body = {
      model: this.cfg.model,
      stream: true,
      messages: messages.map(toOpenAiMessage),
      tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
    }
    let res: Response | null = null
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      res = await this.fetchImpl(`${this.cfg.baseURL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify(body),
      })
      if (res.ok) break
      const retriable = res.status === 429 || res.status >= 500
      if (!retriable || attempt === this.maxRetries) throw new Error(`LLM API error ${res.status}: ${await res.text().catch(() => '')}`)
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
    }
    if (!res || !res.ok || !res.body) throw new Error('LLM API: no response body')

    let content = ''
    const calls: ParsedCall[] = []
    for await (const data of parseSse(res.body)) {
      if (data === '[DONE]') break
      let delta: OpenAiDelta
      try { delta = (JSON.parse(data) as { choices: { delta: OpenAiDelta }[] }).choices[0]?.delta ?? {} } catch { continue }
      if (delta.content) { content += delta.content; yield { type: 'text-delta', text: delta.content } }
      for (const tc of delta.tool_calls ?? []) {
        const slot = (calls[tc.index] ??= { id: '', name: '', arguments: '' })
        if (tc.id) slot.id = tc.id
        if (tc.function?.name) slot.name += tc.function.name
        if (tc.function?.arguments) slot.arguments += tc.function.arguments
      }
    }
    const toolCalls: ToolCall[] = calls.filter((c) => c.id).map((c) => ({ id: c.id, name: c.name, arguments: c.arguments }))
    yield { type: 'result', content, toolCalls }
  }
}

function toOpenAiMessage(m: AgentMessage): Record<string, unknown> {
  if (m.role === 'assistant') {
    return {
      role: 'assistant',
      content: m.content || null,
      ...(m.toolCalls.length ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) } : {}),
    }
  }
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
  return { role: m.role, content: m.content }
}
