import { spawn } from 'node:child_process'
import type { ToolDefinition } from '../types.js'

const MAX_OUTPUT = 30_000

export const execTool: ToolDefinition = {
  name: 'run_command',
  description: 'Run a shell command in the workspace root. Streaming-free: waits for completion. timeout_ms default 60000.',
  parameters: {
    type: 'object',
    properties: { command: { type: 'string' }, timeout_ms: { type: 'number' } },
    required: ['command'],
  },
  async execute(args, ctx) {
    if (!(await ctx.approve('run_command', String(args.command)))) return 'error: user denied run_command'
    return new Promise<string>((resolveOut) => {
      const child = spawn(String(args.command), { shell: true, cwd: ctx.workspaceRoot })
      let out = ''
      const push = (chunk: Buffer | string) => {
        if (out.length < MAX_OUTPUT) out += chunk.toString()
      }
      child.stdout.on('data', push)
      child.stderr.on('data', push)
      const timeout = setTimeout(() => {
        child.kill('SIGKILL')
        resolveOut(`error: command timed out after ${Number(args.timeout_ms ?? 60_000)} ms\n${out}`)
      }, Number(args.timeout_ms ?? 60_000))
      child.on('close', (code) => {
        clearTimeout(timeout)
        resolveOut(`${out}\n[exit code: ${code ?? 'null'}]`)
      })
    })
  },
}
