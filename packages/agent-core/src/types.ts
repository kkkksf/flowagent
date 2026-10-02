// 消息与工具调用
export interface ToolCall { id: string; name: string; arguments: string } // arguments 是 JSON 字符串
export type AgentMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string } // content 为结果或错误文本

// Provider 接口
export type ProviderEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'usage'; promptTokens: number; completionTokens: number } // 流末 usage 块；端点不支持时缺席
  | { type: 'result'; content: string; toolCalls: ToolCall[] }
export interface LlmProvider {
  stream(messages: AgentMessage[], tools: ToolDefinition[]): AsyncIterable<ProviderEvent>
}

// 工具接口
export interface ApprovalPayload {
  path: string
  kind: 'write' | 'edit' | 'run'
  content?: string     // write_file 全文
  oldString?: string   // edit_file 原
  newString?: string   // edit_file 新
}
export interface ToolContext {
  workspaceRoot: string
  approve(action: string, detail: string, payload?: ApprovalPayload): Promise<boolean>
}
export interface ToolDefinition {
  name: string
  description: string
  parameters: JsonSchema // JSON Schema 对象
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>
}
export type JsonSchema = Record<string, unknown>

// 对外事件
export type AgentEvent =
  | { type: 'message-delta'; text: string }
  | { type: 'assistant-message'; message: AgentMessage }
  | { type: 'tool-call'; call: ToolCall }
  | { type: 'tool-result'; call: ToolCall; result: string }
  | { type: 'step'; step: number }
  | { type: 'usage'; promptTokens: number; completionTokens: number } // 每步 LLM 用量，纯数据可 JSON 序列化
  | { type: 'done'; reason: 'completed' | 'step-cap' | 'stopped' }
  | { type: 'error'; message: string } // message 为纯字符串：事件需可 JSON 序列化（跨 IPC/日志），不携带 Error 实例

export interface AgentConfig {
  provider: LlmProvider
  tools: ToolDefinition[]
  systemPrompt: string
  maxSteps: number // 默认 30
  contextStrategy: ContextStrategy
  session: SessionStore // 可为 NullSessionStore
  workspaceRoot?: string
  autoApprove?: boolean
  approve?: (action: string, detail: string, payload?: ApprovalPayload) => Promise<boolean>
}

// 占位：ContextStrategy、SessionStore 在 Task 6/7 填充方法
export interface ContextStrategy {
  // 输入完整历史，返回裁剪后用于发给 LLM 的历史
  trim(history: AgentMessage[], tokenBudget: number): AgentMessage[]
}

export interface SessionStore {
  append(event: SessionRecord): void
  load(): SessionRecord[]
}
export type SessionRecord =
  | { kind: 'message'; message: AgentMessage }
  | { kind: 'meta'; key: string; value: string }
