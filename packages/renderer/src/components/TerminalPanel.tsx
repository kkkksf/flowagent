import { lazy, Suspense, useEffect, useState } from 'react'
import type React from 'react'
import { ChevronDown, RotateCw } from 'lucide-react'
import { fa } from '../api/fa.js'
const XtermPane = lazy(() => import('./XtermPane.js').then((m) => ({ default: m.XtermPane })))

export function TerminalPanel({ collapsed, onToggleCollapse }: { collapsed: boolean; onToggleCollapse(): void }): React.JSX.Element {
  const [exited, setExited] = useState(false)
  useEffect(() => {
    // term-exit → 「已退出」态；restart 后复位（新 term-data 到达说明已重启成功）
    const off = fa.onEvent((ev) => {
      if (ev.type === 'term-exit') setExited(true)
      if (ev.type === 'term-data') setExited(false)
    })
    return off
  }, [])
  return (
    <div className={'flex flex-col shrink-0 transition-all duration-150 border-t border-border-subtle ' + (collapsed ? 'h-7' : 'h-[220px]')}>
      <div className="flex items-center gap-2 h-7 px-2 text-[13px] text-ink-secondary shrink-0">
        <button type="button" className="flex items-center justify-center h-6 w-6 rounded-md text-ink-faint hover:bg-surface-3 hover:text-ink" onClick={onToggleCollapse}>
          <ChevronDown size={13} className={'transition-transform duration-150 ' + (collapsed ? 'rotate-180' : '')} />
        </button>
        <span className="text-xs">终端</span>
        {exited && <button type="button" className="flex items-center gap-1 h-5 px-1.5 rounded-md border border-border text-xs hover:bg-surface-3" onClick={() => { void fa.term.restart() }}><RotateCw size={11} className="h-3 w-3" />重启</button>}
        {exited && <span className="text-xs text-danger">已退出</span>}
      </div>
      {/* spec §3.2：折叠不卸载 XtermPane——卸载会让 main 侧 attach 返回 ''（二次 attach），展开后白屏。
          改为高度 0 + overflow hidden 隐藏：term-data 始终有订阅者，展开状态原样恢复。 */}
      <div style={{ height: collapsed ? 0 : '100%', overflow: 'hidden' }}>
        <Suspense fallback={<div className="p-2 text-xs text-ink-faint">终端加载中…</div>}><XtermPane /></Suspense>
      </div>
    </div>
  )
}
