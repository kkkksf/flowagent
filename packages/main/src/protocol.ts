import type { AgentMessage, ToolCall, ApprovalPayload } from 'agent-core'

export type { AgentMessage, ToolCall, ApprovalPayload } // renderer 统一从此处 type-only 导入，不直接依赖 agent-core

export type FaEvent =
  | { type: 'history'; messages: AgentMessage[] }
  | { type: 'message-delta'; text: string }
  | { type: 'assistant-done' }
  | { type: 'tool-call'; call: ToolCall }
  | { type: 'tool-result'; id: string; result: string }
  | { type: 'approval-required'; id: string; action: string; detail: string; payload?: ApprovalPayload }
  | { type: 'approval-resolved'; id: string; allowed: boolean }
  | { type: 'file-changed'; path: string }
  | { type: 'file-watch-error'; path: string }
  | { type: 'agent-idle' }
  | { type: 'error'; message: string }

export interface FaState { workspaceRoot: string | null; model: string | null; hasSession: boolean }

export interface FsApi {
  read(path: string): Promise<{ content: string; mtimeMs: number }>
  list(path: string): Promise<{ name: string; isDir: boolean }[]>
  create(path: string, kind: 'file' | 'dir'): Promise<void>
  rename(from: string, to: string): Promise<void>
  delete(path: string): Promise<void>
  write(path: string, content: string, expectedMtimeMs?: number): Promise<{ ok: true; mtimeMs: number } | { ok: false; conflict: true; mtimeMs: number }>
  watch(path: string): Promise<void>
  unwatch(path: string): Promise<void>
}

export interface FaApi {
  getState(): Promise<FaState>
  ready(): Promise<void> // 渲染端事件监听就绪后调用：触发主进程补发恢复历史（消除启动 history 事件竞态）
  sendUserMessage(text: string): Promise<void>
  stop(): Promise<void>
  respondApproval(id: string, allow: boolean): Promise<void>
  setAutoApprove(v: boolean): Promise<void>
  fs: FsApi
  onEvent(cb: (ev: FaEvent) => void): () => void
}
