import type React from 'react'
import { useState } from 'react'
import { Check, LoaderCircle, X } from 'lucide-react'
import type { ToolCardState } from '../state/chat-store.js'

export function ToolCard({ card, path, onOpenPath }: { card: ToolCardState; path?: string; onOpenPath?: (path: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const Icon = card.status === 'running' ? LoaderCircle : card.status === 'error' ? X : Check
  const iconCls = card.status === 'error' ? 'text-danger' : card.status === 'running'
    ? 'text-ink-faint animate-spin' : 'text-success'
  const clickable = path !== undefined && onOpenPath !== undefined
  return (
    <div className="bg-surface-1 border border-border rounded-lg my-1 font-mono text-xs">
      {/* 折叠柄：整行点击展开 */}
      <div className="flex items-center gap-2 cursor-pointer px-2.5 h-7" onClick={() => setOpen(!open)}>
        <Icon size={12} className={'shrink-0 h-3 w-3 ' + iconCls} />
        <span className="shrink-0">{card.name}</span>
        {clickable ? (
          // 路径可点击跳转（Task 8）：阻止冒泡以免触发卡片展开
          <span
            role="link"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onOpenPath(path) }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onOpenPath(path) } }}
            className="min-w-0 truncate text-accent hover:underline cursor-pointer"
          >{path}</span>
        ) : (
          <span className="min-w-0 truncate text-ink-secondary">{card.argsSummary}</span>
        )}
        {card.result ? <span className="min-w-0 truncate text-ink-faint"> · {card.result.slice(0, 60)}</span> : null}
      </div>
      {open && (
        <div className="mx-2.5 mb-2 p-2 bg-surface-0 border border-border-subtle rounded-md whitespace-pre-wrap text-xs">
          {card.result || '(运行中…)'}
        </div>
      )}
    </div>
  )
}
