import type React from 'react'
import { useState } from 'react'
import { fa } from '../api/fa.js'
import type { ChatItem } from '../state/chat-store.js'

export function ApprovalCard({ item }: { item: Extract<ChatItem, { kind: 'approval' }> }): React.JSX.Element {
  const [remember, setRemember] = useState(false)
  const done = item.resolved !== null
  const respond = (allow: boolean) => {
    if (remember && allow) void fa.setAutoApprove(true)
    void fa.respondApproval(item.id, allow)
  }
  return (
    <div style={{ border: '2px solid #f0ad4e', borderRadius: 8, padding: 10, margin: '8px 0' }}>
      <div style={{ fontFamily: 'monospace' }}><strong>{item.action}</strong> 即将执行：</div>
      <pre style={{ background: '#fafafa', padding: 8, borderRadius: 6, whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{item.detail}</pre>
      {done ? (
        <span style={{ color: '#666' }}>已{item.resolved === 'allowed' ? '允许' : '拒绝'}</span>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => respond(true)}>允许</button>
          <button onClick={() => respond(false)}>拒绝</button>
          <label style={{ fontSize: 13, color: '#666' }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> 本次会话不再询问
          </label>
        </div>
      )}
    </div>
  )
}
