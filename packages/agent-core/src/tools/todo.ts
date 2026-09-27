import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import type { ToolDefinition } from '../types.js'

const todoPath = (root: string) => join(root, '.flowagent', 'todo.md')

export const todoTool: ToolDefinition = {
  name: 'todo',
  description: 'Read or write your task list so you can track multi-step progress.',
  parameters: {
    type: 'object',
    properties: { action: { type: 'string', enum: ['read', 'write'] }, content: { type: 'string' } },
    required: ['action'],
  },
  async execute(args, ctx) {
    const path = todoPath(ctx.workspaceRoot)
    if (args.action === 'read') {
      try {
        return await readFile(path, 'utf8')
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return '(no todo list yet)'
        return `error: failed to read todo list: ${(e as Error).message}`
      }
    }
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, String(args.content ?? ''), 'utf8')
    return 'ok: todo list saved'
  },
}
