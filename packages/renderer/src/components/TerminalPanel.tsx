import { lazy, Suspense, useEffect, useState } from 'react'
import type React from 'react'
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
    <div style={{ height: collapsed ? 28 : 220, borderTop: '1px solid #ddd', display: 'flex', flexDirection: 'column', flexShrink: 0, transition: 'height 0.15s' }}>
      <div style={{ height: 28, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', fontSize: 13, color: '#666', flexShrink: 0 }}>
        <span style={{ cursor: 'pointer', userSelect: 'none' }} onClick={onToggleCollapse}>{collapsed ? '»' : '«'}</span>
        <span>终端</span>
        {exited && <button onClick={() => { void fa.term.restart() }}>重启</button>}
        {exited && <span style={{ color: '#b00' }}>已退出</span>}
      </div>
      {/* spec §3.2：折叠不卸载 XtermPane——卸载会让 main 侧 attach 返回 ''（二次 attach），展开后白屏。
          改为高度 0 + overflow hidden 隐藏：term-data 始终有订阅者，展开状态原样恢复。 */}
      <div style={{ height: collapsed ? 0 : '100%', overflow: 'hidden' }}>
        <Suspense fallback={<div style={{ padding: 8, color: '#888', fontSize: 12 }}>终端加载中…</div>}><XtermPane /></Suspense>
      </div>
    </div>
  )
}
