import type React from 'react'
import { useEffect, useState } from 'react'
import { fa } from '../api/fa.js'
import { requestApproval } from '../approval-guard-instance.js'
import { useEditorStore } from '../editor-store-instance.js'
import { buildDiffModified, normalizePath } from '../state/editor-store.js'
import { diffStats } from '../state/diff-stats.js'
import type { ChatItem } from '../state/chat-store.js'

export function ApprovalCard({ item }: { item: Extract<ChatItem, { kind: 'approval' }> }): React.JSX.Element {
  const [original, setOriginal] = useState('')
  const payload = item.payload
  // 载荷路径（agent 给出，可能是反斜杠书写）统一归一后进 read/openDiff/脏守卫，与编辑器标签同身份
  const payloadPath = payload ? normalizePath(payload.path) : undefined
  useEffect(() => {
    // 懒加载盘上原文：读取失败 = 文件尚不存在 → 空串（即新文件）
    let alive = true
    if (payloadPath) {
      fa.fs.read(payloadPath)
        .then((r) => { if (alive) setOriginal(r.content) })
        .catch(() => { if (alive) setOriginal('') })
    }
    return () => { alive = false }
  }, [payloadPath])
  const done = item.resolved !== null
  return (
    <div style={{ border: '2px solid #f0ad4e', borderRadius: 8, padding: 10, margin: '8px 0' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontFamily: 'monospace' }}>
        <strong>{item.action}</strong>
        <span>{payload ? payloadPath : item.detail.split('\n')[0]}</span>
        {payload && <span style={{ color: '#999' }}>{diffStats(payload, original)}</span>}
      </div>
      {done ? (
        <span style={{ color: '#666' }}>已{item.resolved === 'allowed' ? '允许' : '拒绝'}</span>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          {payload && payloadPath && (
            <button onClick={() => useEditorStore.getState().openDiff(item.id, payloadPath, original, buildDiffModified(payload, original))}>查看 diff</button>
          )}
          <button onClick={() => requestApproval(item.id, true, payloadPath)}>✓ 允许</button>
          <button onClick={() => requestApproval(item.id, false)}>✗ 拒绝</button>
        </div>
      )}
    </div>
  )
}
