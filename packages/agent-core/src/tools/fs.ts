import { readFile, readdir, writeFile, mkdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { ToolDefinition } from '../types.js'

export function resolveInWorkspace(root: string, relativePath: string): string {
  const abs = isAbsolute(relativePath) ? resolve(relativePath) : resolve(root, relativePath)
  const rel = relative(resolve(root), abs)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`error: path "${relativePath}" is outside the workspace`)
  return abs
}

async function safeIo<T>(fn: () => Promise<T>): Promise<T | string> {
  try { return await fn() } catch (e) { return `error: ${(e as Error).message}` }
}

export const fsTools: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file inside the workspace. Returns the full content.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    async execute(args, ctx) {
      return safeIo(async () => {
        const content = await readFile(resolveInWorkspace(ctx.workspaceRoot, String(args.path)), 'utf8')
        return content.length > 100_000 ? content.slice(0, 100_000) + '\n...[truncated]' : content
      })
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file inside the workspace.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
    async execute(args, ctx) {
      if (!(await ctx.approve('write_file', String(args.path)))) return 'error: user denied write_file'
      return safeIo(async () => {
        const abs = resolveInWorkspace(ctx.workspaceRoot, String(args.path))
        await mkdir(join(abs, '..'), { recursive: true })
        await writeFile(abs, String(args.content), 'utf8')
        return `ok: wrote ${String(args.path)} (${String(args.content).length} bytes)`
      })
    },
  },
  {
    name: 'edit_file',
    description: 'Edit a file by replacing an exact literal string. old_string must match exactly once unless replace_all is true.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' }, old_string: { type: 'string' },
        new_string: { type: 'string' }, replace_all: { type: 'boolean' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    async execute(args, ctx) {
      if (!(await ctx.approve('edit_file', String(args.path)))) return 'error: user denied edit_file'
      return safeIo(async () => {
        const abs = resolveInWorkspace(ctx.workspaceRoot, String(args.path))
        const content = await readFile(abs, 'utf8')
        const oldStr = String(args.old_string)
        const count = content.split(oldStr).length - 1
        if (count === 0) return `error: old_string not found in ${String(args.path)}`
        if (count > 1 && args.replace_all !== true) {
          return `error: old_string occurrence count is ${count} in ${String(args.path)} (found ${count} times); make it unique or pass replace_all=true`
        }
        const updated = args.replace_all === true
          ? content.split(oldStr).join(String(args.new_string))
          : content.replace(oldStr, String(args.new_string))
        await writeFile(abs, updated, 'utf8')
        return `ok: edited ${String(args.path)} (${count} replacement${count > 1 ? 's' : ''})`
      })
    },
  },
  {
    name: 'list_dir',
    description: 'List entries of a directory inside the workspace.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    async execute(args, ctx) {
      return safeIo(async () => {
        const entries = await readdir(resolveInWorkspace(ctx.workspaceRoot, String(args.path)), { withFileTypes: true })
        return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join('\n') || '(empty)'
      })
    },
  },
  {
    name: 'glob',
    description: 'Find files matching a glob pattern (e.g. "**/*.ts") under the workspace root.',
    parameters: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] },
    async execute(args, ctx) {
      // 极简递归匹配：把 glob 转 RegExp（** -> 任意路径段序列，* -> 段内任意）
      const pattern = String(args.pattern)
      const re = new RegExp('^' + pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*\//g, '(?:.*/)?')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/\\\\]*') + '$')
      const found: string[] = []
      const walk = async (dir: string, prefix: string): Promise<void> => {
        const entries = await readdir(dir, { withFileTypes: true })
        for (const e of entries) {
          if (e.name === 'node_modules' || e.name === '.git') continue
          const rel = prefix ? `${prefix}/${e.name}` : e.name
          if (e.isDirectory()) await walk(join(dir, e.name), rel)
          else if (re.test(rel) || re.test(rel.replace(/\//g, '\\'))) found.push(rel)
        }
      }
      return safeIo(async () => { await walk(ctx.workspaceRoot, ''); return found.join('\n') || '(no matches)' })
    },
  },
  {
    name: 'grep',
    description: 'Search file contents with a regular expression. Returns matching lines with file:line prefixes.',
    parameters: {
      type: 'object',
      properties: { pattern: { type: 'string' }, include: { type: 'string' } },
      required: ['pattern'],
    },
    async execute(args, ctx) {
      const re = new RegExp(String(args.pattern))
      const include = args.include ? String(args.include) : '*'
      const incRe = new RegExp('^' + include.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
      const out: string[] = []
      const walk = async (dir: string, prefix: string): Promise<void> => {
        for (const e of await readdir(dir, { withFileTypes: true })) {
          if (e.name === 'node_modules' || e.name === '.git') continue
          const rel = prefix ? `${prefix}/${e.name}` : e.name
          if (e.isDirectory()) { await walk(join(dir, e.name), rel); continue }
          if (!incRe.test(e.name)) continue
          const s = await stat(join(dir, e.name))
          if (!s.isFile() || s.size > 1_000_000) continue
          const text = await readFile(join(dir, e.name), 'utf8')
          text.split('\n').forEach((line, i) => { if (re.test(line)) out.push(`${rel}:${i + 1}: ${line.trim().slice(0, 200)}`) })
        }
      }
      return safeIo(async () => { await walk(ctx.workspaceRoot, ''); return out.slice(0, 200).join('\n') || '(no matches)' })
    },
  },
]
