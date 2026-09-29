import { create } from 'zustand'
import type { FaEvent, AgentMessage, ToolCall, ApprovalPayload } from '../../../main/src/protocol.js'
import { normalizePath } from './editor-store.js'

export interface ToolCardState { id: string; name: string; argsSummary: string; path?: string; status: 'running' | 'done' | 'error'; result: string }
export type ChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; tools: ToolCardState[] }
  | { kind: 'approval'; id: string; action: string; detail: string; payload?: ApprovalPayload; resolved: 'allowed' | 'denied' | null }
  | { kind: 'error'; message: string }

export interface ChatMeta { workspaceRoot: string | null; model: string | null }

interface ChatStore {
  items: ChatItem[]
  running: boolean
  meta: ChatMeta
  applyEvent(ev: FaEvent): void
  setMeta(m: ChatMeta): void
  lastUserMessage(): string | null
}

function argsSummary(args: string): string {
  try {
    const o = JSON.parse(args) as Record<string, unknown>
    const first = Object.values(o)[0]
    return typeof first === 'string' ? first.slice(0, 120) : args.slice(0, 120)
  } catch { return args.slice(0, 120) }
}

// 带 path 参数的工具（write/edit/list_dir…）解析出路径，供工具卡点击跳转（Task 8）；
// 模型常给 Windows 反斜杠，归一成 '/' 书写，点击跳转/审批载荷才能与编辑器标签对上
function parsePath(args: string): string | undefined {
  try {
    const o = JSON.parse(args) as Record<string, unknown>
    return typeof o.path === 'string' ? normalizePath(o.path) : undefined
  } catch { return undefined }
}

function ensureAssistant(items: ChatItem[]): ChatItem[] {
  if (items.at(-1)?.kind === 'assistant') return items
  return [...items, { kind: 'assistant', text: '', tools: [] } as ChatItem]
}

function fromHistory(messages: AgentMessage[]): ChatItem[] {
  const out: ChatItem[] = []
  for (const m of messages) {
    if (m.role === 'user') out.push({ kind: 'user', text: m.content })
    else if (m.role === 'assistant') {
      out.push({
        kind: 'assistant',
        text: m.content,
        tools: m.toolCalls.map((c: ToolCall) => ({ id: c.id, name: c.name, argsSummary: argsSummary(c.arguments), path: parsePath(c.arguments), status: 'running' as const, result: '' })),
      })
    } else if (m.role === 'tool') {
      for (let i = out.length - 1; i >= 0; i--) {
        const it = out[i]
        if (it.kind !== 'assistant') continue
        const card = it.tools.find((t) => t.id === m.toolCallId)
        if (card) {
          card.status = m.content.startsWith('error:') ? 'error' : 'done'
          card.result = m.content
          break
        }
      }
    }
  }
  return out
}

// zustand v5 的 set 每次都会生成新的 state 对象，早期经 getState() 拿到的快照不会自动跟进；
// commit 在 set 之外把同一份 partial 同步写回初始快照，让持有旧快照的调用方（含测试）也能读到最新值。
// 已知休眠限制：镜像写法腐蚀 getInitialState() 的语义（返回的是同一被覆写对象，读到当前值而非初始值）；
// 当前仓库没有 replace 型 set(s, true) 调用方，如未来引入需先处理此处。
export const createChatStore = () => {
  let initial: ChatStore | undefined
  const useChatStore = create<ChatStore>((set, get) => {
    const commit = (partial: Partial<ChatStore>): void => {
      if (initial) Object.assign(initial, partial)
      set(partial)
    }
    const reduce = (s: ChatStore, ev: FaEvent): Partial<ChatStore> => {
      switch (ev.type) {
        case 'history': return { items: fromHistory(ev.messages) }
        case 'message-delta': {
          const items = ensureAssistant(s.items)
          const last = items.at(-1) as { kind: 'assistant'; text: string; tools: ToolCardState[] }
          return { items: items.map((it) => it === last ? { ...last, text: last.text + ev.text } : it), running: true }
        }
        case 'tool-call': {
          const items = ensureAssistant(s.items)
          const last = items.at(-1) as { kind: 'assistant'; text: string; tools: ToolCardState[] }
          return { items: items.map((it) => it === last ? { ...last, tools: [...last.tools, { id: ev.call.id, name: ev.call.name, argsSummary: argsSummary(ev.call.arguments), path: parsePath(ev.call.arguments), status: 'running', result: '' }] } : it) }
        }
        case 'tool-result': {
          const items = s.items.map((it) => {
            if (it.kind !== 'assistant') return it
            const tools = it.tools.map((t) => t.id === ev.id
              ? { ...t, status: (ev.result.startsWith('error:') ? 'error' : 'done') as 'error' | 'done', result: ev.result }
              : t)
            return { ...it, tools }
          })
          return { items }
        }
        case 'approval-required': return { items: [...s.items, { kind: 'approval', id: ev.id, action: ev.action, detail: ev.detail, payload: ev.payload, resolved: null }] }
        case 'approval-resolved': {
          const items = s.items.map((it) => it.kind === 'approval' && it.id === ev.id
            ? { ...it, resolved: (ev.allowed ? 'allowed' : 'denied') as 'allowed' | 'denied' }
            : it)
          return { items }
        }
        case 'agent-idle': return { running: false }
        case 'error': return { items: [...s.items, { kind: 'error', message: ev.message }] }
        default: return {}
      }
    }
    initial = {
      items: [],
      running: false,
      meta: { workspaceRoot: null, model: null },
      setMeta: (m) => commit({ meta: m }),
      applyEvent: (ev) => commit(reduce(get(), ev)),
      lastUserMessage: () => {
        for (let i = get().items.length - 1; i >= 0; i--) {
          const it = get().items[i]
          if (it.kind === 'user') return it.text
        }
        return null
      },
    }
    return initial
  })
  return useChatStore
}
