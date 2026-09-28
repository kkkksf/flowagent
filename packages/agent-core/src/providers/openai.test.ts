import { describe, expect, it, vi } from 'vitest'
import type { ToolDefinition } from '../types.js'
import { parseSse } from './sse.js'

const tools: ToolDefinition[] = [{
  name: 'echo', description: 'x',
  parameters: { type: 'object', properties: {} },
  async execute() { return '' },
}]

function sseResponse(chunks: string[], status = 200): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close() },
  })
  return new Response(stream, { status, headers: { 'content-type': 'text/event-stream' } })
}

describe('parseSse', () => {
  it('yields data lines across chunk boundaries', async () => {
    const events: string[] = []
    const enc = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(enc.encode('data: {"a":1}\n\nda')); c.enqueue(enc.encode('ta: [DONE]\n\n')); c.close() },
    })
    for await (const e of parseSse(stream)) events.push(e)
    expect(events).toEqual(['{"a":1}', '[DONE]'])
  })

  it('flushes a trailing data line without newline', async () => {
    const events: string[] = []
    const enc = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(enc.encode('data: {"a":1}\n\ndata: [DONE]')); c.close() },
    })
    for await (const e of parseSse(stream)) events.push(e)
    expect(events).toEqual(['{"a":1}', '[DONE]'])
  })

  it('accepts data: without a space', async () => {
    const events: string[] = []
    const enc = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(enc.encode('data:[DONE]\n')); c.close() },
    })
    for await (const e of parseSse(stream)) events.push(e)
    expect(events).toEqual(['[DONE]'])
  })
})

describe('OpenAICompatProvider.stream', () => {
  it('emits text deltas and a result', async () => {
    const { OpenAICompatProvider } = await import('./openai.js')
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]))
    const p = new OpenAICompatProvider({ baseURL: 'http://x', apiKey: 'k', model: 'm', fetchImpl: fetchMock as unknown as typeof fetch })
    const events = []
    for await (const e of p.stream([{ role: 'user', content: 'hi' }], tools)) events.push(e)
    expect(events).toContainEqual({ type: 'text-delta', text: 'Hel' })
    const result = events.find((e) => e.type === 'result')
    expect(result).toMatchObject({ type: 'result', content: 'Hello' })
  })

  it('retries on 500 then succeeds', async () => {
    const { OpenAICompatProvider } = await import('./openai.js')
    const ok = sseResponse(['data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n', 'data: [DONE]\n\n'])
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('err', { status: 500 }))
      .mockResolvedValueOnce(ok)
    const p = new OpenAICompatProvider({ baseURL: 'http://x', apiKey: 'k', model: 'm', maxRetries: 3, fetchImpl: fetchMock as unknown as typeof fetch })
    const events = []
    for await (const e of p.stream([{ role: 'user', content: 'hi' }], [])) events.push(e)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(events.some((e) => e.type === 'result')).toBe(true)
  })

  it('retries on network error then succeeds', async () => {
    const { OpenAICompatProvider } = await import('./openai.js')
    const ok = sseResponse(['data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n', 'data: [DONE]\n\n'])
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(ok)
    const p = new OpenAICompatProvider({ baseURL: 'http://x', apiKey: 'k', model: 'm', maxRetries: 3, backoffMs: 1, fetchImpl: fetchMock as unknown as typeof fetch })
    const events = []
    for await (const e of p.stream([{ role: 'user', content: 'hi' }], [])) events.push(e)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(events.some((e) => e.type === 'result')).toBe(true)
  })

  it('throws network error after exhausting retries', async () => {
    const { OpenAICompatProvider } = await import('./openai.js')
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    const p = new OpenAICompatProvider({ baseURL: 'http://x', apiKey: 'k', model: 'm', maxRetries: 2, backoffMs: 1, fetchImpl: fetchMock as unknown as typeof fetch })
    await expect(async () => {
      for await (const _e of p.stream([{ role: 'user', content: 'hi' }], [])) { /* drain */ }
    }).rejects.toThrow(/network error/)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('assembles tool_calls from deltas', async () => {
    const { OpenAICompatProvider } = await import('./openai.js')
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"echo","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ]))
    const p = new OpenAICompatProvider({ baseURL: 'http://x', apiKey: 'k', model: 'm', fetchImpl: fetchMock as unknown as typeof fetch })
    const events = []
    for await (const e of p.stream([{ role: 'user', content: 'hi' }], tools)) events.push(e)
    expect(events.find((e) => e.type === 'result')).toMatchObject({
      type: 'result', content: '',
      toolCalls: [{ id: 'c1', name: 'echo', arguments: '{}' }],
    })
  })
})

describe('non-SSE response guards', () => {
  const body = (text: string, contentType: string) =>
    new Response(text, { status: 200, headers: { 'content-type': contentType } })

  it('throws on 200 with html body', async () => {
    const { OpenAICompatProvider } = await import('./openai.js')
    const p = new OpenAICompatProvider({
      baseURL: 'http://x', apiKey: 'k', model: 'm', maxRetries: 0, backoffMs: 1,
      fetchImpl: (async () => body('<!DOCTYPE html><html>blocked</html>', 'text/html')) as typeof fetch,
    })
    await expect(async () => {
      for await (const _ of p.stream([{ role: 'user', content: 'hi' }], [])) void _
    }).rejects.toThrow(/LLM API:.*blocked/)
  })

  it('throws on empty sse stream', async () => {
    const { OpenAICompatProvider } = await import('./openai.js')
    const p = new OpenAICompatProvider({
      baseURL: 'http://x', apiKey: 'k', model: 'm', maxRetries: 0, backoffMs: 1,
      fetchImpl: (async () => body('', 'text/event-stream')) as typeof fetch,
    })
    await expect(async () => {
      for await (const _ of p.stream([{ role: 'user', content: 'hi' }], [])) void _
    }).rejects.toThrow(/LLM API: empty SSE stream/)
  })
})
