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

  loadHistory(messages: AgentMessage[]): void { this._history = [...messages] }

  stop(): void { this.stopped = true }

  async *run(userInput: string): AsyncGenerator<AgentEvent> {
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
        yield { type: 'error', error: e as Error }
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
