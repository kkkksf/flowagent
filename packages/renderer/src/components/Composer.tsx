import type React from 'react'
import { useState } from 'react'
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
    return <footer style={{ padding: 12, borderTop: '1px solid #ddd' }}><button style={{ width: '100%' }} onClick={() => void fa.stop()}>■ 停止</button></footer>
  }
  return (
    <footer style={{ padding: 12, borderTop: '1px solid #ddd' }}>
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
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
    </footer>
  )
}
