import { randomUUID } from 'node:crypto'
import type { AgentEvent, AgentMessage } from 'agent-core'
import type { FaEvent } from './protocol.js'

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
    if (this.agent) this.agent.loadHistory(messages)
    else this.pendingHistory = messages
    this.deps.emit({ type: 'history', messages })
  }

  async send(text: string): Promise<void> {
    if (this.running) throw new Error('agent is busy')
    this.running = true
    try {
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
      try {
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
