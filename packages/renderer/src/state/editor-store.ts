import { create } from 'zustand'
import type { ApprovalPayload } from '../../../main/src/protocol.js'

export interface FileTab { id: string; kind: 'file'; path: string; content: string; knownMtime: number; dirty: boolean; conflict: boolean }
export interface DiffTab { id: string; kind: 'diff'; approvalId: string; path: string; original: string; modified: string; resolved: 'allowed' | 'denied' | null }
export type EditorTab = FileTab | DiffTab

// 路径身份统一（spec §3/§7）：模型输出常给 `src\a.txt`（Windows 反斜杠），树/标签用 `src/a.txt`；
// 入 store 的路径一律 trim + 反斜杠转正斜杠，两种写法才能命中同一标签、圆点与脏守卫。
// 入口（openFileFromDisk / tool-call / parsePath / ApprovalCard）各自归一，store 内 path 键动作再兜底一次。
export function normalizePath(p: string): string {
  return p.trim().replace(/\\/g, '/')
}

export function buildDiffModified(payload: ApprovalPayload, original: string): string {
  if (payload.kind === 'write') return payload.content ?? ''
  return original.split(payload.oldString ?? '').join(payload.newString ?? '')
}

interface EditorStore {
  tabs: EditorTab[]
  activeTabId: string | null
  agentTouched: string[]
  recentPaths: string[]
  notice: string | null
  setNotice(msg: string | null): void
  openFile(path: string, content: string, mtimeMs: number): string
  closeTab(id: string): void
  activate(id: string): void
  updateContent(id: string, content: string): void
  markSaved(id: string, mtimeMs: number): void
  setConflict(id: string, conflict: boolean): void
  reloadContent(id: string, content: string, mtimeMs: number): void
  openDiff(approvalId: string, path: string, original: string, modified: string): string
  resolveDiff(approvalId: string, allowed: boolean): void
  markAgentTouched(path: string): void
  clearAgentTouched(path: string): void
  hasDirtyTab(path: string): boolean
}

// 同 chat-store 的 commit 镜像：zustand v5 的 set 每次都会生成新的 state 对象，
// 早期经 getState() 拿到的快照不会自动跟进；commit 在 set 之外把同一份 partial
// 同步写回初始快照，让持有旧快照的调用方（含测试）也能读到最新值。
// 已知休眠限制同 chat-store：镜像写法腐蚀 getInitialState() 的语义。
export const createEditorStore = () => {
  let initial: EditorStore | undefined
  const useEditorStore = create<EditorStore>((set, get) => {
    const commit = (partial: Partial<EditorStore>): void => {
      if (initial) Object.assign(initial, partial)
      set(partial)
    }
    initial = {
      tabs: [], activeTabId: null, agentTouched: [], recentPaths: [], notice: null,
      setNotice: (msg) => commit({ notice: msg }),
      openFile: (path, content, mtimeMs) => {
        path = normalizePath(path)
        const front = (paths: string[]) => [path, ...paths.filter((p) => p !== path)].slice(0, 10)
        const existing = get().tabs.find((t) => t.kind === 'file' && t.path === path)
        if (existing) {
          commit({ activeTabId: existing.id, recentPaths: front(get().recentPaths) })
          return existing.id
        }
        const id = `f:${path}`
        commit({
          tabs: [...get().tabs, { id, kind: 'file', path, content, knownMtime: mtimeMs, dirty: false, conflict: false }],
          activeTabId: id,
          recentPaths: front(get().recentPaths),
        })
        return id
      },
      closeTab: (id) => {
        const tabs = get().tabs.filter((t) => t.id !== id)
        commit({ tabs, activeTabId: get().activeTabId === id ? (tabs.at(-1)?.id ?? null) : get().activeTabId })
      },
      activate: (id) => commit({ activeTabId: id }),
      updateContent: (id, content) => commit({ tabs: get().tabs.map((t) => t.id === id && t.kind === 'file' ? { ...t, content, dirty: true } : t) }),
      markSaved: (id, mtimeMs) => commit({ tabs: get().tabs.map((t) => t.id === id && t.kind === 'file' ? { ...t, dirty: false, conflict: false, knownMtime: mtimeMs } : t) }),
      setConflict: (id, conflict) => commit({ tabs: get().tabs.map((t) => t.id === id && t.kind === 'file' ? { ...t, conflict } : t) }),
      reloadContent: (id, content, mtimeMs) => commit({ tabs: get().tabs.map((t) => t.id === id && t.kind === 'file' ? { ...t, content, knownMtime: mtimeMs } : t) }),
      openDiff: (approvalId, path, original, modified) => {
        path = normalizePath(path)
        const id = `d:${approvalId}`
        commit({
          tabs: [...get().tabs.filter((t) => !(t.kind === 'diff' && t.approvalId === approvalId)), { id, kind: 'diff', approvalId, path, original, modified, resolved: null }],
          activeTabId: id,
        })
        return id
      },
      resolveDiff: (approvalId, allowed) => commit({ tabs: get().tabs.map((t) => t.kind === 'diff' && t.approvalId === approvalId ? { ...t, resolved: (allowed ? 'allowed' : 'denied') as 'allowed' | 'denied' } : t) }),
      markAgentTouched: (path) => {
        path = normalizePath(path)
        const cur = get().agentTouched
        commit({ agentTouched: cur.includes(path) ? cur : [...cur, path] })
      },
      clearAgentTouched: (path) => commit({ agentTouched: get().agentTouched.filter((p) => p !== normalizePath(path)) }),
      hasDirtyTab: (path) => get().tabs.some((t) => t.kind === 'file' && t.path === normalizePath(path) && t.dirty),
    }
    return initial
  })
  return useEditorStore
}
