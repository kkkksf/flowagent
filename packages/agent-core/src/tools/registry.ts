import type { JsonSchema, ToolContext, ToolDefinition } from '../types.js'

export function validateArgs(schema: JsonSchema, args: unknown): string | null {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return `error: arguments must be a JSON object, got ${typeof args}`
  }
  const obj = args as Record<string, unknown>
  const props = (schema.properties ?? {}) as Record<string, { type?: string }>
  for (const [key, def] of Object.entries(props)) {
    const v = obj[key]
    if (v === undefined) continue
    const t = def.type
    if (t === 'string' && typeof v !== 'string') return `error: argument "${key}" must be string, got ${typeof v}`
    if (t === 'number' && typeof v !== 'number') return `error: argument "${key}" must be number, got ${typeof v}`
    if (t === 'boolean' && typeof v !== 'boolean') return `error: argument "${key}" must be boolean, got ${typeof v}`
    if (t === 'array' && !Array.isArray(v)) return `error: argument "${key}" must be array`
  }
  for (const key of (schema.required as string[]) ?? []) {
    if (!(key in obj)) return `error: missing required argument "${key}"`
  }
  return null
}

export class ToolRegistry {
  private map = new Map<string, ToolDefinition>()
  constructor(tools: ToolDefinition[]) { for (const t of tools) this.map.set(t.name, t) }
  get(name: string) { return this.map.get(name) }
  list() { return [...this.map.values()] }
  async run(name: string, args: string, ctx: ToolContext): Promise<string> {
    const tool = this.map.get(name)
    if (!tool) return `error: unknown tool "${name}"`
    let parsed: unknown
    try { parsed = JSON.parse(args) } catch { return `error: arguments are not valid JSON: ${args.slice(0, 100)}` }
    const err = validateArgs(tool.parameters, parsed)
    if (err) return err
    return tool.execute(parsed as Record<string, unknown>, ctx)
  }
}
