import type { AgentMessage, ContextStrategy } from '../types.js'

const estTokens = (m: AgentMessage): number => {
  const base = m.role === 'assistant' ? m.content.length + JSON.stringify(m.toolCalls ?? []).length : m.content.length
  return Math.ceil(base / 4)
}

export class TokenBudgetTrim implements ContextStrategy {
  constructor(private cfg: { tokenBudget: number }) {}

  trim(history: AgentMessage[], _tokenBudget: number): AgentMessage[] {
    const system = history.filter((m) => m.role === 'system')
    const rest = history.filter((m) => m.role !== 'system')
    const KEEP_TAIL = 6
    let work = rest.map((m) => ({ msg: m, tokens: estTokens(m) }))
    const total = () => system.reduce((s, m) => s + estTokens(m), 0) + work.reduce((s, w) => s + w.tokens, 0)

    // 1) 截断老的 tool 结果：保护尾部 KEEP_TAIL 条；此外，最近一条 user 消息之前
    //    （更早的对话轮次）的 tool 结果也视为“老”的可截断对象，即使它落在尾部 6 条之内。
    let lastUserIdx = -1
    rest.forEach((m, i) => { if (m.role === 'user') lastUserIdx = i })
    const truncReach = lastUserIdx === -1 ? work.length - KEEP_TAIL : Math.max(work.length - KEEP_TAIL, lastUserIdx)
    for (let i = 0; i < truncReach && total() > this.cfg.tokenBudget; i++) {
      const w = work[i]
      if (w.msg.role === 'tool' && w.msg.content.length > 500) {
        w.msg = { ...w.msg, content: w.msg.content.slice(0, 500) + '\n...[trimmed]' }
        w.tokens = estTokens(w.msg)
      }
    }
    // 2) 丢弃最老的消息，保持 assistant/tool 配对
    while (total() > this.cfg.tokenBudget && work.length > KEEP_TAIL) {
      const drop = new Set([work[0].msg])
      if (work[0].msg.role === 'assistant' && work[0].msg.toolCalls?.length) {
        const ids = new Set(work[0].msg.toolCalls.map((c) => c.id))
        for (const w of work) if (w.msg.role === 'tool' && ids.has(w.msg.toolCallId)) drop.add(w.msg)
      }
      if (work[0].msg.role === 'tool') {
        const id = work[0].msg.toolCallId
        for (const w of work) if (w.msg.role === 'assistant' && w.msg.toolCalls?.some((c) => c.id === id)) drop.add(w.msg)
      }
      work = work.filter((w) => !drop.has(w.msg))
    }
    return [...system, ...work.map((w) => w.msg)]
  }
}
