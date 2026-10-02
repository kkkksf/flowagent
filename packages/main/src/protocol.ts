import type { AgentMessage, ToolCall, ApprovalPayload } from 'agent-core'

export type { AgentMessage, ToolCall, ApprovalPayload } // renderer 统一从此处 type-only 导入，不直接依赖 agent-core

// SessionMeta 定义在此（而非自 session-service 再导出）：renderer tsc 顺着 protocol 的 import
// 链检查源文件，session-service.ts 的 node:fs 依赖会拖垮无 node 类型的 renderer 程序
export interface SessionMeta { file: string; title: string; mtimeMs: number }

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
  | { type: 'term-data'; data: string }
  | { type: 'term-exit' }
  | { type: 'usage'; promptTokens: number; completionTokens: number }
  | { type: 'session-changed'; file: string }

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
  term: { write(d: string): Promise<void>; resize(c: number, r: number): Promise<void>; attach(c: number, r: number): Promise<string>; restart(): Promise<void> }
  // 'new' 必须加引号：类型字面量里裸 new() 是构造签名而非方法名，fa.session.new 会类型不可达
  session: { list(): Promise<SessionMeta[]>; 'new'(): Promise<SessionMeta>; switch(file: string): Promise<void>; delete(file: string): Promise<SessionMeta[]> }
  onEvent(cb: (ev: FaEvent) => void): () => void
}
