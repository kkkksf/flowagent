import type React from 'react'
import ReactMarkdown from 'react-markdown'
import type { ChatItem } from '../state/chat-store.js'
import { fa } from '../api/fa.js'
import { useStore } from '../store.js'
import { openFileFromDisk } from '../editor-events.js'
import { ToolCard } from './ToolCard.js'
import { ApprovalCard } from './ApprovalCard.js'

export function MessageItem({ item }: { item: ChatItem }): React.JSX.Element {
  const model = useStore((s) => s.meta.model)
  if (item.kind === 'user') return (
    <div className="flex justify-end my-2">
      <span className="max-w-[85%] bg-surface-2 border border-border-subtle rounded-lg px-3 py-1.5 whitespace-pre-wrap">{item.text}</span>
    </div>
  )
  if (item.kind === 'assistant') return (
    <div className="my-2">
      <div className="fa-md max-w-[90%]"><ReactMarkdown>{item.text}</ReactMarkdown></div>
      {item.tools.map((t) => <ToolCard key={t.id} card={t} path={t.path} onOpenPath={(p) => void openFileFromDisk(p)} />)}
      {/* 模型名尾行（有文本时）：Codex 风格的来源标注 */}
      {item.text && <div className="mt-1 text-xs text-ink-faint">{model}</div>}
    </div>
  )
  if (item.kind === 'approval') return <ApprovalCard item={item} />
  return (
    <div className="my-2 flex items-center gap-2 bg-surface-1 border-l-2 border-danger rounded-lg px-3 py-2">
      <span className="flex-1">错误：{item.message}</span>
      <button className="h-6 px-2 rounded-md border border-border text-xs hover:bg-surface-3" onClick={() => { const t = useStore.getState().lastUserMessage(); if (t) void fa.sendUserMessage(t) }}>重试上一条</button>
    </div>
  )
}
