import { lazy, Suspense } from 'react'
import type React from 'react'
import { fa } from '../api/fa.js'
import { requestApproval } from '../approval-guard-instance.js'
import type { DiffTab } from '../state/editor-store.js'
const MonacoDiff = lazy(() => import('./MonacoDiff.js').then((m) => ({ default: m.MonacoDiff })))

export function DiffPane({ tab }: { tab: DiffTab }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="flex items-center gap-2 px-2.5 h-9 border-b border-border-subtle">
        <strong className="font-mono text-xs font-semibold">{tab.path}</strong>
        {tab.resolved === null ? (<>
          <button className="h-6 px-2.5 rounded-md bg-accent text-on-accent text-xs hover:bg-accent-hover" onClick={() => requestApproval(tab.approvalId, true, tab.path)}>✓ 允许</button>
          <button className="h-6 px-2.5 rounded-md border border-danger text-danger text-xs hover:bg-surface-3" onClick={() => requestApproval(tab.approvalId, false)}>✗ 拒绝</button>
          <button className="h-6 px-2.5 rounded-md border border-border text-xs hover:bg-surface-3" onClick={() => { if (requestApproval(tab.approvalId, true, tab.path)) void fa.setAutoApprove(true) }}>✓ 允许且本会话不再询问</button>
        </>) : <span className="text-xs text-ink-secondary">已{tab.resolved === 'allowed' ? '允许' : '拒绝'}</span>}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Suspense fallback={<div className="p-6 text-ink-faint">diff 加载中…</div>}><MonacoDiff original={tab.original} modified={tab.modified} /></Suspense>
      </div>
    </div>
  )
}
