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
  const running = useStore((s) => s.running)
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
          <div className="mt-20 flex flex-col items-center gap-3 text-center">
            <div className="w-10 h-10 rounded-lg bg-accent/15 flex items-center justify-center"><div className="w-5 h-5 rounded bg-accent" /></div>
            <div className="text-ink-secondary">
              {model ? '给 FlowAgent 发个任务试试，例如：写一个 hello.py 并运行。' : '模型未配置，请设置 FLOWAGENT_BASE_URL / FLOWAGENT_API_KEY / FLOWAGENT_MODEL 环境变量后重启。'}
            </div>
          </div>
        )}
        {items.map((it, i) => <MessageItem key={i} item={it} />)}
        {/* 运行呼吸点：仅在已有消息时追加在流底部（空状态由上方占位） */}
        {running && items.length > 0 && (
          <div className="flex items-center gap-2 py-1.5 text-xs text-ink-secondary">
            <span className="flex gap-1"><span className="fa-dot" /><span className="fa-dot" /><span className="fa-dot" /></span>
            正在处理…
          </div>
        )}
      </div>
    </div>
  )
}
