import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { fa } from '../api/fa.js'
import { useStore } from '../store.js'
import { useEditorStore } from '../editor-store-instance.js'
import { MessageItem } from './MessageItem.js'
import type { SessionMeta } from '../../../main/src/protocol.js'

// token 数与人读时间差工具（App 顶栏复用 fmtTokens）
export function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}
export function fmtAgo(mtimeMs: number): string {
  const s = Math.floor((Date.now() - mtimeMs) / 1000)
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  if (s < 172800) return '昨天'
  return `${Math.floor(s / 86400)} 天前`
}

// fa.session 调用的 rejection 统一 setNotice 兜底（同 FileTree fsErr 手法）
const sessErr = (e: unknown): void => { useEditorStore.getState().setNotice(String(e)) }

// 契约 4：列表项标题截 28 字符
const clip = (t: string): string => (t.length > 28 ? `${t.slice(0, 28)}…` : t)

export function ChatPanel(): React.JSX.Element {
  const items = useStore((s) => s.items)
  const model = useStore((s) => s.meta.model)
  const running = useStore((s) => s.running)
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const ddRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [items])

  const refresh = (): void => {
    fa.session.list().then(setSessions).catch(sessErr)
  }

  // 契约 1：挂载载入会话列表，并从 getState 初始化当前会话（冷启动 main 不 emit session-changed）；
  // 契约 2：自订一层 onEvent 只看 session-changed（多订阅无害）
  useEffect(() => {
    refresh()
    void fa.getState().then((st) => { if (st.currentSession) setCurrent(st.currentSession) }).catch(sessErr)
    const off = fa.onEvent((ev) => {
      if (ev.type === 'session-changed') { setCurrent(ev.file); refresh() }
    })
    return off
  }, [])

  // 契约 7（简式）：进入 running 直接收起浮层，header 同步灰显禁点（下方 onClick 守卫）
  useEffect(() => { if (running) setOpen(false) }, [running])

  // 契约 8：document mousedown + contains 判浮层外关闭（FileTree 右键菜单同款手法）；
  // ddRef 盖住 header+浮层整体，点 header 走 onClick toggle，不会被外点逻辑误关再弹开
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const el = ddRef.current
      if (el && e.target instanceof Node && !el.contains(e.target)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  // 契约 3：当前会话标题（挂载 getState 初始化 current；仅 getState 未返回的瞬间走兜底文案）
  const title = sessions.find((s) => s.file === current)?.title ?? '(当前会话)'

  // 契约 5：删除必须经 window.confirm；返回的新列表直接覆盖（main 侧当前会话不可删）
  const doDelete = (s: SessionMeta): void => {
    if (window.confirm(`删除会话 "${s.title}"？不可恢复。`)) {
      fa.session.delete(s.file).then(setSessions).catch(sessErr)
    }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* hover 行为需 CSS：行背景 + 🗑 悬停显现；当前项 🗑 的内联 opacity 0.3 优先级高于此处规则 */}
      <style>{'.fa-sess-row:hover{background:#f0f0f0}.fa-sess-del{opacity:0}.fa-sess-row:hover .fa-sess-del{opacity:1}'}</style>
      {/* 契约 3：会话头行（浮层锚点），running 灰显禁点 */}
      <div
        ref={ddRef}
        onClick={() => { if (!running) setOpen((v) => !v) }}
        title={running ? '运行中不可切换' : undefined}
        style={{
          position: 'relative', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', borderBottom: '1px solid #eee', fontSize: 13, userSelect: 'none',
          color: running ? '#aaa' : '#555', cursor: running ? 'default' : 'pointer',
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        <span style={{ flexShrink: 0 }}>▾</span>
        {/* 契约 4/6：浮层——absolute 挂 header 下方，白底边框阴影 */}
        {open && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: '#fff', border: '1px solid #ccc', borderRadius: 4, boxShadow: '0 2px 8px rgba(0,0,0,.15)' }}>
            {sessions.map((s) => {
              const cur = s.file === current
              return (
                <div
                  key={s.file}
                  className="fa-sess-row"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', cursor: 'pointer', background: cur ? '#e8f0fe' : undefined }}
                  onClick={() => { if (!running) { void fa.session.switch(s.file).catch(sessErr); setOpen(false) } }}
                >
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clip(s.title)}</span>
                  <span style={{ color: '#999', fontSize: 12, flexShrink: 0 }}>{fmtAgo(s.mtimeMs)}</span>
                  {/* 契约 4/5：当前项 🗑 置灰不可点；其余悬停显现，点击前 window.confirm */}
                  <button
                    type="button"
                    className="fa-sess-del"
                    title={cur ? '当前会话不可删除' : '删除会话'}
                    onClick={(e) => { e.stopPropagation(); if (!cur) doDelete(s) }}
                    style={{ border: 'none', background: 'none', padding: 0, fontSize: 12, lineHeight: '16px', flexShrink: 0, cursor: 'pointer', ...(cur ? { opacity: 0.3, pointerEvents: 'none' } : {}) }}
                  >🗑</button>
                </div>
              )
            })}
            {/* 契约 6：+ 新会话（main 自动切换并 emit session-changed + history） */}
            <div
              className="fa-sess-row"
              style={{ borderTop: '1px solid #eee', padding: '4px 8px', cursor: 'pointer', color: '#1a73e8' }}
              onClick={() => { if (!running) { void fa.session.new().catch(sessErr); setOpen(false) } }}
            >+ 新会话</div>
          </div>
        )}
      </div>
      <div ref={ref} onScroll={() => {
        const el = ref.current
        if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      }} style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {items.length === 0 && (
          <div style={{ color: '#888', textAlign: 'center', marginTop: 80 }}>
            {model ? '给 FlowAgent 发个任务试试，例如：写一个 hello.py 并运行。' : '模型未配置，请设置 FLOWAGENT_BASE_URL / FLOWAGENT_API_KEY / FLOWAGENT_MODEL 环境变量后重启。'}
          </div>
        )}
        {items.map((it, i) => <MessageItem key={i} item={it} />)}
      </div>
    </div>
  )
}
