import type React from 'react'
import ReactMarkdown from 'react-markdown'
import type { ChatItem } from '../state/chat-store.js'
import { ToolCard } from './ToolCard.js'
import { ApprovalCard } from './ApprovalCard.js'

export function MessageItem({ item }: { item: ChatItem }): React.JSX.Element {
  if (item.kind === 'user') return <div style={{ textAlign: 'right', margin: '8px 0' }}><span style={{ background: '#e8f0fe', padding: '6px 12px', borderRadius: 10, display: 'inline-block', maxWidth: '80%', whiteSpace: 'pre-wrap' }}>{item.text}</span></div>
  if (item.kind === 'assistant') return (
    <div style={{ margin: '8px 0' }}>
      <div style={{ maxWidth: '90%' }}><ReactMarkdown>{item.text}</ReactMarkdown></div>
      {item.tools.map((t) => <ToolCard key={t.id} card={t} />)}
    </div>
  )
  if (item.kind === 'approval') return <ApprovalCard item={item} />
  return <div style={{ color: '#b00', background: '#fdecea', padding: '6px 12px', borderRadius: 8, margin: '8px 0' }}>错误：{item.message}</div>
}
