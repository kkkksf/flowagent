import type React from 'react'
import { useEffect, useState } from 'react'
import { fa } from '../api/fa.js'
import { requestApproval } from '../approval-guard-instance.js'
import { useEditorStore } from '../editor-store-instance.js'
import { buildDiffModified } from '../state/editor-store.js'
import { diffStats } from '../state/diff-stats.js'
import type { ChatItem } from '../state/chat-store.js'

export function ApprovalCard({ item }: { item: Extract<ChatItem, { kind: 'approval' }> }): React.JSX.Element {
  const [original, setOriginal] = useState('')
  const payload = item.payload
  useEffect(() => {
    // 懒加载盘上原文：读取失败 = 文件尚不存在 → 空串（即新文件）
    let alive = true
    if (payload) {
      fa.fs.read(payload.path)
        .then((r) => { if (alive) setOriginal(r.content) })
        .catch(() => { if (alive) setOriginal('') })
    }
    return () => { alive = false }
  }, [payload])
  const done = item.resolved !== null
  return (
    <div style={{ border: '2px solid #f0ad4e', borderRadius: 8, padding: 10, margin: '8px 0' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontFamily: 'monospace' }}>
        <strong>{item.action}</strong>
        <span>{payload ? payload.path : item.detail.split('\n')[0]}</span>
        {payload && <span style={{ color: '#999' }}>{diffStats(payload, original)}</span>}
      </div>
      {done ? (
        <span style={{ color: '#666' }}>已{item.resolved === 'allowed' ? '允许' : '拒绝'}</span>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          {payload && (
            <button onClick={() => useEditorStore.getState().openDiff(item.id, payload.path, original, buildDiffModified(payload, original))}>查看 diff</button>
          )}
          <button onClick={() => requestApproval(item.id, true, payload?.path)}>✓ 允许</button>
          <button onClick={() => requestApproval(item.id, false)}>✗ 拒绝</button>
        </div>
      )}
    </div>
  )
}
