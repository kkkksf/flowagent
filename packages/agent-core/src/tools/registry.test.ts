import { describe, expect, it } from 'vitest'
import type { ToolContext, ToolDefinition } from '../types.js'
import { ToolRegistry, validateArgs } from './registry.js'

const ctx: ToolContext = {
  workspaceRoot: process.cwd(),
  approve: async () => true,
}
const echo: ToolDefinition = {
  name: 'echo',
  description: 'echoes',
  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  async execute(args) { return String(args.text) },
}

describe('ToolRegistry', () => {
  it('executes a valid call', async () => {
    const r = new ToolRegistry([echo])
    expect(await r.run('echo', '{"text":"hi"}', ctx)).toBe('hi')
  })

  it('invalid args returned as error result, not thrown', async () => {
    const r = new ToolRegistry([echo])
    const out = await r.run('echo', '{"text": 42}', ctx)
    expect(out).toMatch(/text/)
    expect(out).toMatch(/error/i)
  })

  it('unknown tool returns error text', async () => {
    const r = new ToolRegistry([echo])
    expect(await r.run('nope', '{}', ctx)).toMatch(/unknown tool/i)
  })

  it('malformed JSON args return error text', async () => {
    const r = new ToolRegistry([echo])
    expect(await r.run('echo', '{oops', ctx)).toMatch(/JSON/i)
  })
})

describe('validateArgs', () => {
  it('returns null for valid args', () => {
    expect(validateArgs(echo.parameters, { text: 'x' })).toBeNull()
  })
})
