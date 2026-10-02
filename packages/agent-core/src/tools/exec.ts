import { spawn } from 'node:child_process'
import type { ToolDefinition } from '../types.js'

const MAX_OUTPUT = 30_000

// 子进程输出解码：Windows 中文系统 cmd 输出为 GBK——先按 UTF-8 严格解码，
// 失败则回退 GBK，避免"ϵͳ�Ҳ��..."类乱码进入对话历史
export function decodeChunk(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    try {
      return new TextDecoder('gbk').decode(buf)
    } catch {
      return buf.toString('utf8') // 双双失败：退化为有损 UTF-8
    }
  }
}

export const execTool: ToolDefinition = {
  name: 'run_command',
  description: 'Run a shell command in the workspace root. Streaming-free: waits for completion. timeout_ms default 60000. Note: the host may be Windows (cmd.exe) - prefer cross-platform commands.',
  parameters: {
    type: 'object',
    properties: { command: { type: 'string' }, timeout_ms: { type: 'number' } },
    required: ['command'],
  },
  async execute(args, ctx) {
    if (!(await ctx.approve('run_command', String(args.command)))) return 'error: user denied run_command'
    return new Promise<string>((resolveOut) => {
      // stdin 设为 ignore：交互式命令（如 Windows 不带 /t 的 date 会等待键盘输入）
      // 在 EOF 下立即退出，而不是挂满 60s 超时
      const child = spawn(String(args.command), {
        shell: true,
        cwd: ctx.workspaceRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let out = ''
      const push = (chunk: Buffer | string) => {
        if (out.length >= MAX_OUTPUT) return
        out += typeof chunk === 'string' ? chunk : decodeChunk(chunk)
        if (out.length > MAX_OUTPUT) {
          out = out.slice(0, MAX_OUTPUT) + '\n...[truncated]'
        }
      }
      child.stdout.on('data', push)
      child.stderr.on('data', push)
      const killTree = (): void => {
        if (process.platform === 'win32' && child.pid) {
          // Windows 下 shell:true 只杀 cmd 本体，孙进程可能存活；taskkill /T 杀整棵树
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
        } else {
          child.kill('SIGKILL')
        }
      }
      const timeout = setTimeout(() => {
        killTree()
        resolveOut(`error: command timed out after ${Number(args.timeout_ms ?? 60_000)} ms\n${out}`)
      }, Number(args.timeout_ms ?? 60_000))
      child.on('error', (e) => {
        clearTimeout(timeout)
        resolveOut(`error: ${e.message}`)
      })
      child.on('close', (code) => {
        clearTimeout(timeout)
        resolveOut(`${out}\n[exit code: ${code ?? 'null'}]`)
      })
    })
  },
}
