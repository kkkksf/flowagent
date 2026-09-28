import { ToolRegistry } from './tools/registry.js'
import type { AgentConfig, AgentEvent, AgentMessage, ToolCall } from './types.js'

export class Agent {
  private registry: ToolRegistry
  private _history: AgentMessage[] = []
  private stopped = false

  constructor(private cfg: AgentConfig) {
    this.registry = new ToolRegistry(cfg.tools)
    this._history.push({ role: 'system', content: cfg.systemPrompt })
  }

  get history(): AgentMessage[] { return this._history }

  get tools(): string[] { return this.registry.list().map((t) => t.name) }

  loadHistory(messages: AgentMessage[]): void {
    // 保证历史以 system 消息开头：外部提供的历史若缺少，则补构造时的 systemPrompt
    this._history = messages[0]?.role === 'system'
      ? [...messages]
      : [{ role: 'system', content: this.cfg.systemPrompt }, ...messages]
  }

  stop(): void { this.stopped = true }

  async *run(userInput: string): AsyncGenerator<AgentEvent> {
    this.stopped = false // 每次 run 重置：REPL 中同一实例多次 run，stop 不应跨调用粘滞
    const userMsg: AgentMessage = { role: 'user', content: userInput }
    this._history.push(userMsg)
    this.cfg.session.append({ kind: 'message', message: userMsg })

    for (let step = 1; step <= this.cfg.maxSteps; step++) {
      if (this.stopped) { yield { type: 'done', reason: 'stopped' }; return }
      yield { type: 'step', step }

      const trimmed = this.cfg.contextStrategy.trim(this._history, 100_000)
      let content = ''
      let toolCalls: ToolCall[] = []
      let gotResult = false
      // provider 流内联消费：text-delta 实时冒泡为 message-delta；
      // 流中途抛错时 assistant 消息尚未 push 进 history，不污染历史。
      try {
        for await (const ev of this.cfg.provider.stream(trimmed, this.registry.list())) {
          if (ev.type === 'text-delta') {
            yield { type: 'message-delta', text: ev.text }
          } else {
            content = ev.content
            toolCalls = ev.toolCalls
            gotResult = true
          }
        }
      } catch (e) {
        yield { type: 'error', message: e instanceof Error ? e.message : String(e) }
        return
      }
      if (!gotResult) break // 流结束但没有 result：异常终止，按 step-cap 收场

      const assistantMsg: AgentMessage = { role: 'assistant', content, toolCalls }
      this._history.push(assistantMsg)
      this.cfg.session.append({ kind: 'message', message: assistantMsg })
      yield { type: 'assistant-message', message: assistantMsg }

      if (toolCalls.length === 0) {
        yield { type: 'done', reason: 'completed' }
        return
      }
      for (const call of toolCalls) {
        yield { type: 'tool-call', call }
        let toolResult: string
        try {
          toolResult = await this.registry.run(call.name, call.arguments, {
            workspaceRoot: this.cfg.workspaceRoot ?? process.cwd(),
            approve: async (action, detail) => {
              // 停止后同一 assistant 消息里的剩余审批一律自动拒绝：
              // 工具结果仍会落历史（避免悬空 toolCalls 导致下次请求 400），循环在既有检查处自然终止
              if (this.stopped) return false
              if (this.cfg.autoApprove) return true
              return this.cfg.approve?.(action, detail) ?? false
            },
          })
        } catch (e) {
          // registry.run 会传播 tool.execute 抛出的异常：转成错误文本结果，让模型可响应
          toolResult = `error: tool "${call.name}" threw: ${e instanceof Error ? e.message : String(e)}`
        }
        const toolMsg: AgentMessage = { role: 'tool', toolCallId: call.id, content: toolResult }
        this._history.push(toolMsg)
        this.cfg.session.append({ kind: 'message', message: toolMsg })
        yield { type: 'tool-result', call, result: toolResult }
      }
      if (this.stopped) { yield { type: 'done', reason: 'stopped' }; return }
    }
    yield { type: 'done', reason: 'step-cap' }
  }
}
