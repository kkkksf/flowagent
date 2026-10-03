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
    <div className="my-2 bg-surface-1 border-l-2 border-warning rounded-lg p-2.5">
      <div className="flex gap-2 items-baseline font-mono text-xs">
        <strong className="font-semibold shrink-0">{item.action}</strong>
        <span className="min-w-0 truncate">{payload ? payloadPath : item.detail.split('\n')[0]}</span>
        {/* diffStats 返回整串（含「替换/覆盖/新文件」前缀），整体次级色显示，不拆色 */}
        {payload && <span className="text-ink-secondary shrink-0">{diffStats(payload, original)}</span>}
      </div>
      {done ? (
        <span className="text-xs text-ink-secondary">已{item.resolved === 'allowed' ? '允许' : '拒绝'}</span>
      ) : (
        <div className="mt-1.5 flex gap-2">
          {payload && payloadPath && (
            <button className="h-6 px-2.5 rounded-md border border-border text-xs hover:bg-surface-3" onClick={() => useEditorStore.getState().openDiff(item.id, payloadPath, original, buildDiffModified(payload, original))}>查看 diff</button>
          )}
          <button className="h-6 px-2.5 rounded-md bg-accent text-on-accent text-xs hover:bg-accent-hover" onClick={() => requestApproval(item.id, true, payloadPath)}>✓ 允许</button>
          <button className="h-6 px-2.5 rounded-md border border-danger text-danger text-xs hover:bg-surface-3" onClick={() => requestApproval(item.id, false)}>✗ 拒绝</button>
        </div>
      )}
    </div>
  )
}
