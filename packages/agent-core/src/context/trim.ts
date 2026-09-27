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
    // 2) 丢弃最老的消息，保持 assistant/tool 配对（传递闭包）：
    //    - 丢弃 assistant 时，其所有 toolCalls 对应的 tool 消息一并丢弃（否则孤儿 tool 结果会被
    //      OpenAI 兼容 API 以 400 拒绝）；反之丢弃 tool 时也拉入其 assistant。
    //    - 新加入集合的 assistant/tool 再按同样规则扩张，直至闭包稳定。
    while (total() > this.cfg.tokenBudget && work.length > KEEP_TAIL) {
      const drop = new Set<AgentMessage>([work[0].msg])
      let grew = true
      while (grew) {
        grew = false
        const droppedToolIds = new Set<string>()
        const droppedCallIds = new Set<string>()
        for (const d of drop) {
          if (d.role === 'tool') droppedToolIds.add(d.toolCallId)
          if (d.role === 'assistant') for (const c of d.toolCalls) droppedCallIds.add(c.id)
        }
        for (const w of work) {
          if (drop.has(w.msg)) continue
          if (w.msg.role === 'assistant' && w.msg.toolCalls?.some((c) => droppedToolIds.has(c.id))) {
            drop.add(w.msg); grew = true
          } else if (w.msg.role === 'tool' && droppedCallIds.has(w.msg.toolCallId)) {
            drop.add(w.msg); grew = true
          }
        }
      }
      work = work.filter((w) => !drop.has(w.msg))
    }
    return [...system, ...work.map((w) => w.msg)]
  }
}
