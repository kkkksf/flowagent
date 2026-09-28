import type React from 'react'
import { useState } from 'react'
import type { ToolCardState } from '../state/chat-store.js'

export function ToolCard({ card }: { card: ToolCardState }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const icon = card.status === 'running' ? '⏳' : card.status === 'error' ? '✗' : '✓'
  const color = card.status === 'error' ? '#b00' : card.status === 'running' ? '#888' : '#080'
  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: '6px 10px', margin: '4px 0', fontFamily: 'monospace', fontSize: 13 }}>
      <div style={{ cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <span style={{ color }}>{icon}</span> {card.name} <span style={{ color: '#666' }}>{card.argsSummary}</span>
        {card.result ? <span style={{ color: '#999' }}> · {card.result.slice(0, 60)}</span> : null}
      </div>
      {open && (
        <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', color: '#444' }}>
          {card.result || '(运行中…)'}
        </div>
      )}
    </div>
  )
}
