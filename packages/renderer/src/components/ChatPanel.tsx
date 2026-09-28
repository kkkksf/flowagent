import type React from 'react'
import { useEffect, useRef } from 'react'
import { useStore } from '../store.js'
import { MessageItem } from './MessageItem.js'

export function ChatPanel(): React.JSX.Element {
  const items = useStore((s) => s.items)
  const model = useStore((s) => s.meta.model)
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [items])
  return (
    <div ref={ref} onScroll={() => {
      const el = ref.current
      if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    }} style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
      {items.length === 0 && (
        <div style={{ color: '#888', textAlign: 'center', marginTop: 80 }}>
          {model ? '给 FlowAgent 发个任务试试，例如：写一个 hello.py 并运行。' : '模型未配置，请设置 FLOWAGENT_BASE_URL / FLOWAGENT_API_KEY / FLOWAGENT_MODEL 环境变量后重启。'}
        </div>
      )}
      {items.map((it, i) => <MessageItem key={i} item={it} />)}
    </div>
  )
}
