import type React from 'react'
import { useEffect, useRef } from 'react'
import { useStore } from '../store.js'
import { MessageItem } from './MessageItem.js'

// token 数与人读时间差工具（App 顶栏复用 fmtTokens）
export function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

// 会话下拉已迁至 App header（SessionPicker）；本组件只余消息流/空状态/滚动 stick 逻辑
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
    <div className="flex-1 min-h-0 flex flex-col">
      <div
        ref={ref}
        onScroll={() => {
          const el = ref.current
          if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
        className="flex-1 overflow-y-auto p-4"
      >
        {items.length === 0 && (
          <div className="text-ink-faint text-center mt-20">
            {model ? '给 FlowAgent 发个任务试试，例如：写一个 hello.py 并运行。' : '模型未配置，请设置 FLOWAGENT_BASE_URL / FLOWAGENT_API_KEY / FLOWAGENT_MODEL 环境变量后重启。'}
          </div>
        )}
        {items.map((it, i) => <MessageItem key={i} item={it} />)}
      </div>
    </div>
  )
}
