import type React from 'react'
import { useState } from 'react'
import { Square } from 'lucide-react'
import { fa } from '../api/fa.js'
import { useStore } from '../store.js'

export function Composer(): React.JSX.Element {
  const [text, setText] = useState('')
  const running = useStore((s) => s.running)
  const model = useStore((s) => s.meta.model)
  const disabled = running || !model
  const submit = () => {
    const t = text.trim()
    if (!t || disabled) return
    setText('')
    // 用户气泡本地立即上屏并进入运行态；后续内容由事件流驱动
    //（core 的 run() 不 emit 用户消息事件，这是设计使然）
    useStore.setState((s) => ({ items: [...s.items, { kind: 'user', text: t }], running: true }))
    void fa.sendUserMessage(t)
  }
  if (running) {
    return (
      <footer className="p-3 border-t border-border-subtle">
        <button className="w-full h-8 rounded-md border border-danger text-danger text-sm hover:bg-surface-3 flex items-center justify-center gap-2" onClick={() => void fa.stop()}>
          <Square size={12} className="h-3 w-3" />停止
        </button>
      </footer>
    )
  }
  return (
    <footer className="p-3 border-t border-border-subtle">
      <div className="rounded-lg border border-border bg-surface-2 focus-within:border-accent transition-colors duration-150">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
          }}
          placeholder={model ? '输入任务，Enter 发送（Shift+Enter 换行）' : '请先配置环境变量'}
          disabled={disabled}
          rows={3}
          className="w-full bg-transparent resize-none outline-none px-3 py-2.5 text-[13px] placeholder:text-ink-faint"
        />
        <div className="px-3 pb-1.5 text-xs text-ink-faint">Enter 发送 · Shift+Enter 换行</div>
      </div>
    </footer>
  )
}
