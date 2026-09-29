import { randomUUID } from 'node:crypto'
import type { AgentEvent, AgentMessage } from 'agent-core'
import type { FaEvent } from './protocol.js'

// 契约：approve 在一次 run 内是串行的——agent-core 循环逐个 await 工具，
// 因此 AgentHost 的单槽 pending 挂起结构是安全的。引入并行工具执行前必须先改此处。
export interface AgentLike {
  run(input: string): AsyncGenerator<AgentEvent>
  stop(): void
  loadHistory(messages: AgentMessage[]): void
}

export interface AgentHostDeps {
  emit(ev: FaEvent): void
  makeAgent(approve: (action: string, detail: string) => Promise<boolean>): AgentLike
}

export class AgentHost {
  private agent: AgentLike | null = null
  private running = false
  private autoApprove = false
  private pending: { id: string; resolve: (allow: boolean) => void } | null = null
  private pendingHistory: AgentMessage[] | null = null

  constructor(private deps: AgentHostDeps) {}

  get busy(): boolean { return this.running }

  setAutoApprove(v: boolean): void { this.autoApprove = v }

  loadSession(messages: AgentMessage[]): void {
    // 不在此处创建 agent：惰性创建必须走 send() 里的审批门回调，否则恢复过会话的进程审批门被旁路
    // running 期间不重赋在飞历史（F5 场景）：暂存 pendingHistory，下次 send 前灌入
    if (this.agent && !this.running) this.agent.loadHistory(messages)
    else this.pendingHistory = messages
    this.deps.emit({ type: 'history', messages })
  }

  async send(text: string): Promise<void> {
    if (this.running) throw new Error('agent is busy')
    this.running = true
    try {
      try {
        // agent 创建与 pendingHistory 灌入也在内层 try：一旦抛错同样要走到 agent-idle，
        // 否则 renderer 的 running 态永远不清、输入框锁死
        this.agent ??= this.deps.makeAgent(async (action, detail) => {
          if (this.autoApprove) return true
          const id = randomUUID()
          this.deps.emit({ type: 'approval-required', id, action, detail })
          return await new Promise<boolean>((resolve) => { this.pending = { id, resolve } })
        })
        if (this.pendingHistory) {
          this.agent.loadHistory(this.pendingHistory) // 恢复会话：把暂存历史灌给惰性创建的 agent
          this.pendingHistory = null
        }
        for await (const ev of this.agent.run(text)) this.forward(ev)
      } catch (e) {
        this.deps.emit({ type: 'error', message: e instanceof Error ? e.message : String(e) })
      } finally {
        this.deps.emit({ type: 'agent-idle' }) // 必发：renderer 靠它解锁输入框
      }
    } finally {
      this.running = false
      this.pending = null
    }
  }

  respondApproval(id: string, allow: boolean): void {
    if (this.pending?.id === id) {
      const p = this.pending
      this.pending = null
      this.deps.emit({ type: 'approval-resolved', id, allowed: allow }) // 卡片定格为已处理态
      p.resolve(allow)
    }
  }

  stop(): void {
    if (this.pending) this.respondApproval(this.pending.id, false) // 挂起审批一律按拒绝收场
    this.agent?.stop()
  }

  private forward(ev: AgentEvent): void {
    switch (ev.type) {
      case 'message-delta': this.deps.emit({ type: 'message-delta', text: ev.text }); break
      case 'assistant-message': this.deps.emit({ type: 'assistant-done' }); break
      case 'tool-call': this.deps.emit({ type: 'tool-call', call: ev.call }); break
      case 'tool-result': this.deps.emit({ type: 'tool-result', id: ev.call.id, result: ev.result }); break
      case 'error': this.deps.emit({ type: 'error', message: ev.message }); break
      default: break // step / done 不透传给 UI
    }
  }
}
