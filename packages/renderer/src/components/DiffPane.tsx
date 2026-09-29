import { lazy, Suspense } from 'react'
import type React from 'react'
import { fa } from '../api/fa.js'
import { requestApproval } from '../approval-guard-instance.js'
import type { DiffTab } from '../state/editor-store.js'
const MonacoDiff = lazy(() => import('./MonacoDiff.js').then((m) => ({ default: m.MonacoDiff })))

export function DiffPane({ tab }: { tab: DiffTab }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 8, padding: 8, borderBottom: '1px solid #ddd', alignItems: 'center' }}>
        <strong>{tab.path}</strong>
        {tab.resolved === null ? (<>
          <button onClick={() => requestApproval(tab.approvalId, true, tab.path)}>✓ 允许</button>
          <button onClick={() => requestApproval(tab.approvalId, false)}>✗ 拒绝</button>
          <button onClick={() => { void fa.setAutoApprove(true); requestApproval(tab.approvalId, true, tab.path) }}>✓ 允许且本会话不再询问</button>
        </>) : <span style={{ color: '#666' }}>已{tab.resolved === 'allowed' ? '允许' : '拒绝'}</span>}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Suspense fallback={<div style={{ padding: 24, color: '#888' }}>diff 加载中…</div>}><MonacoDiff original={tab.original} modified={tab.modified} /></Suspense>
      </div>
    </div>
  )
}
