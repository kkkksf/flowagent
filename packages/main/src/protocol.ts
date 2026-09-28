import type { AgentMessage, ToolCall } from 'agent-core'

export type { AgentMessage, ToolCall } // renderer 统一从此处 type-only 导入，不直接依赖 agent-core

export type FaEvent =
  | { type: 'history'; messages: AgentMessage[] }
  | { type: 'message-delta'; text: string }
  | { type: 'assistant-done' }
  | { type: 'tool-call'; call: ToolCall }
  | { type: 'tool-result'; id: string; result: string }
  | { type: 'approval-required'; id: string; action: string; detail: string }
  | { type: 'approval-resolved'; id: string; allowed: boolean }
  | { type: 'agent-idle' }
  | { type: 'error'; message: string }

export interface FaState { workspaceRoot: string | null; model: string | null; hasSession: boolean }

export interface FaApi {
  getState(): Promise<FaState>
  sendUserMessage(text: string): Promise<void>
  stop(): Promise<void>
  respondApproval(id: string, allow: boolean): Promise<void>
  setAutoApprove(v: boolean): Promise<void>
  onEvent(cb: (ev: FaEvent) => void): () => void
}
