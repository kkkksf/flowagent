import type { AgentMessage } from '../types.js'

// 会话恢复修复：assistant 带 toolCalls 但缺对应 tool 结果消息（中断/崩溃残留）时，
// 合成 error 工具结果，避免下次 run 悬空 toolCalls 导致 provider 400（spec §8-2）
export function repairDanglingToolCalls(messages: AgentMessage[]): AgentMessage[] {
  const answered = new Set<string>()
  for (const m of messages) if (m.role === 'tool') answered.add(m.toolCallId)
  let dangling = 0
  const out: AgentMessage[] = []
  for (const m of messages) {
    out.push(m)
    if (m.role === 'assistant') {
      for (const c of m.toolCalls) {
        if (!answered.has(c.id)) { dangling++; out.push({ role: 'tool', toolCallId: c.id, content: 'error: interrupted before completion' }) }
      }
    }
  }
  return dangling === 0 ? messages : out
}
