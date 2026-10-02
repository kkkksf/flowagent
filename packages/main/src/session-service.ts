import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SessionMeta } from './protocol.js'

// 多会话数据层：.flowagent/sessions/*.jsonl 的列出/新建/删除/旧版迁移。
// 纯 node:fs 同步实现（文件量个位数，无并发诉求）；供 Task 5 编排层消费。
// SessionMeta 规范定义在 protocol.ts（renderer 契约，见彼处注释），此处再导出保持既有消费路径
export type { SessionMeta }

const EMPTY_TITLE = '(空会话)'

// 标题 = 首条 user 消息 content 前 40 字符；坏行跳过（同 JsonlSessionStore.load 语义）
function titleOf(path: string): string {
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let rec: unknown
    try { rec = JSON.parse(line) } catch { continue }
    const r = rec as { kind?: unknown; message?: { role?: unknown; content?: unknown } }
    if (r.kind !== 'message' || r.message?.role !== 'user') continue
    return typeof r.message.content === 'string' ? r.message.content.slice(0, 40) : EMPTY_TITLE
  }
  return EMPTY_TITLE // 空文件/无 user 消息/content 非 string
}

export function listSessions(dir: string): SessionMeta[] {
  if (!existsSync(dir)) return [] // 首次启动 sessions 目录尚不存在
  return readdirSync(dir)
    .filter((file) => file.endsWith('.jsonl'))
    .map((file) => {
      const full = join(dir, file)
      return { file, title: titleOf(full), mtimeMs: statSync(full).mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.file.localeCompare(a.file)) // mtime 降序，同名次按文件名降序保证稳定
}

export function createSession(dir: string): SessionMeta {
  // toISOString 给 YYYY-MM-DDTHH:mm:ss：冒号在 Windows 文件名非法，剔除成 YYYY-MM-DDTHHmmss
  const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '')
  for (let attempt = 0; attempt < 5; attempt++) {
    const file = `${ts}-${randomUUID().slice(0, 4)}.jsonl` // 4 位 hex 防同秒冲突
    const full = join(dir, file)
    // existsSync 重试（Task 4 review 移交）：同秒碰撞若直接 writeFileSync 会截断既有会话，换后缀重试
    if (existsSync(full)) continue
    writeFileSync(full, '', 'utf8')
    return { file, title: EMPTY_TITLE, mtimeMs: statSync(full).mtimeMs }
  }
  throw new Error(`createSession: name collision persisted after 5 attempts in ${dir}`)
}

export function deleteSession(dir: string, file: string): void {
  // basename jail：拒绝路径分隔符与上跳，只允许删 dir 内直接子文件
  if (file.includes('/') || file.includes('\\') || file.includes('..')) throw new Error(`bad session file name: ${file}`)
  rmSync(join(dir, file))
}

export function migrateLegacy(dir: string): string | null {
  const legacy = join(dirname(dir), 'session.jsonl') // 旧版单会话文件在 .flowagent/ 下
  if (!existsSync(legacy)) return null
  let name = 'session.jsonl'
  if (existsSync(join(dir, name))) name = 'session-1.jsonl' // 同名冲突：-1 后缀重试一次
  renameSync(legacy, join(dir, name))
  return name
}
