import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Moon, PanelRight, Plus, Sun, Trash2 } from 'lucide-react'
import { fa } from './api/fa.js'
import { useStore } from './store.js'
import { useEditorStore } from './editor-store-instance.js'
import { useThemeStore } from './theme-store.js'
import { applyEditorEvent, openFileFromDisk } from './editor-events.js'
import { ChatPanel, fmtTokens } from './components/ChatPanel.js'
import { Composer } from './components/Composer.js'
import { FileTree } from './components/FileTree.js'
import { EditorArea } from './components/EditorArea.js'
import { TerminalPanel } from './components/TerminalPanel.js'
import type { SessionMeta } from '../../main/src/protocol.js'

export function fmtAgo(mtimeMs: number): string {
  const s = Math.floor((Date.now() - mtimeMs) / 1000)
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  if (s < 172800) return '昨天'
  return `${Math.floor(s / 86400)} 天前`
}

// fa.session 调用的 rejection 统一 setNotice 兜底（同 FileTree fsErr 手法）
const sessErr = (e: unknown): void => { useEditorStore.getState().setNotice(e instanceof Error ? e.message : String(e)) }

// 契约 4：列表项标题截 28 字符
const clip = (t: string): string => (t.length > 28 ? `${t.slice(0, 28)}…` : t)

// 会话下拉（自 ChatPanel 迁入 header；M4 §4.3 契约 1-8 原样保留）
function SessionPicker(): React.JSX.Element {
  const running = useStore((s) => s.running)
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const ddRef = useRef<HTMLDivElement>(null)

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
    <div
      ref={ddRef}
      className="relative"
      onClick={() => { if (!running) setOpen((v) => !v) }}
      title={running ? '运行中不可切换' : undefined}
    >
      {/* 契约 3：会话头行（浮层锚点），running 灰显禁点 */}
      <div className={`flex items-center gap-1.5 h-6 px-2 rounded-md text-ink-secondary hover:bg-surface-3 hover:text-ink cursor-pointer select-none text-xs max-w-48${running ? ' opacity-50 pointer-events-none' : ''}`}>
        <span className="truncate">{title}</span>
        <ChevronDown size={12} />
      </div>
      {/* 契约 4/6：浮层——absolute 挂 header 下方，surface-2 底边框阴影 */}
      {open && (
        <div className="absolute top-full left-0 mt-1 w-72 z-50 bg-surface-2 border border-border rounded-md shadow-lg py-1">
          {sessions.map((s) => {
            const cur = s.file === current
            return (
              <div
                key={s.file}
                className={`fa-sess-row flex items-center gap-2 px-2.5 h-7 cursor-pointer text-xs${cur ? ' bg-surface-3' : ''}`}
                onClick={(e) => { e.stopPropagation(); if (!running) { void fa.session.switch(s.file).catch(sessErr); setOpen(false) } }}
              >
                <span className="flex-1 min-w-0 truncate">{clip(s.title)}</span>
                <span className="text-ink-faint shrink-0">{fmtAgo(s.mtimeMs)}</span>
                {/* 契约 4/5：当前项删除置灰不可点；其余悬停显现，点击前 window.confirm */}
                <button
                  type="button"
                  className={`fa-sess-del shrink-0 text-ink-faint hover:text-danger${cur ? ' opacity-30 pointer-events-none' : ''}`}
                  title={cur ? '当前会话不可删除' : '删除会话'}
                  onClick={(e) => { e.stopPropagation(); if (!cur) doDelete(s) }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )
          })}
          {/* 契约 6：+ 新会话（main 自动切换并 emit session-changed + history） */}
          <div
            className="fa-sess-row flex items-center gap-1.5 px-2.5 h-7 text-accent cursor-pointer text-xs"
            onClick={(e) => { e.stopPropagation(); if (!running) { void fa.session.new().catch(sessErr); setOpen(false) } }}
          >
            <Plus size={12} />新会话
          </div>
        </div>
      )}
    </div>
  )
}

export function App(): React.JSX.Element {
  const meta = useStore((s) => s.meta)
  const usage = useStore((s) => s.usage)
  // 折叠状态提升到 App：左栏容器宽度随之 240px ↔ 32px，消除折叠后 208px 死区（Task 6 遗留）
  const [treeCollapsed, setTreeCollapsed] = useState(false)
  // 终端面板折叠只卸载 XtermPane 前端实例，pty 归 main 管理继续后台跑
  const [termCollapsed, setTermCollapsed] = useState(false)
  // 聊天栏折叠：折叠态 36px 竖条（panel-right 图标按钮），状态与文件树同款放 App useState（spec §4.1）
  const [chatCollapsed, setChatCollapsed] = useState(false)
  const theme = useThemeStore((s) => s.theme)
  useEffect(() => {
    // 先订阅再 ready：保证能收到主进程 ready 后补发的恢复历史；chat/editor 两个 stores 并行喂
    const off = fa.onEvent((ev) => { useStore.getState().applyEvent(ev); void applyEditorEvent(ev) })
    void fa.getState().then((st) => useStore.getState().setMeta({ workspaceRoot: st.workspaceRoot, model: st.model }))
    void fa.ready()
    return off
  }, [])
  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center gap-3 h-10 px-3 border-b border-border-subtle shrink-0">
        <div className="w-4 h-4 rounded bg-accent shrink-0" />
        <strong className="text-[13px]">FlowAgent</strong>
        <SessionPicker />
        {/* 右组（ml-auto）：workspace 路径 truncate + title 悬浮看全量 · model 徽章 · token 计数 · 主题切换 */}
        <span className="ml-auto font-mono text-xs text-ink-secondary truncate max-w-64" title={meta.workspaceRoot ?? undefined}>
          {meta.workspaceRoot ?? '未选择工作区'}
        </span>
        <span className="bg-surface-2 border border-border-subtle rounded-md px-1.5 py-0.5 text-xs">{meta.model ?? '模型未配置'}</span>
        {/* 单次请求 usage 覆盖式（chat-store），切会话重置为 — */}
        <span className="font-mono text-xs text-ink-faint" title="prompt / completion tokens">
          {usage ? `${fmtTokens(usage.prompt)} / ${fmtTokens(usage.completion)} tokens` : '—'}
        </span>
        <button
          type="button"
          title="切换主题"
          onClick={() => useThemeStore.getState().setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="h-6 w-6 flex items-center justify-center rounded-md text-ink-secondary hover:bg-surface-3 hover:text-ink transition-colors duration-150"
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        {/* overlay 原生窗口控制按钮占位：titleBarStyle hidden 后 Windows 右上角 min/max/close 由 overlay 绘制，web 内容需让位（Task 2 裁定：保留同等 140px 右缘占位） */}
        <div className="w-[140px] shrink-0" />
      </header>
      <div className="flex flex-1 min-h-0">
        <div className={`${treeCollapsed ? 'w-8' : 'w-60'} border-r border-border-subtle overflow-y-auto shrink-0 transition-all duration-150`}>
          <FileTree collapsed={treeCollapsed} onToggleCollapse={() => setTreeCollapsed((v) => !v)} onOpenFile={(p) => void openFileFromDisk(p)} />
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0">
            <EditorArea />
          </div>
          <TerminalPanel collapsed={termCollapsed} onToggleCollapse={() => setTermCollapsed((v) => !v)} />
        </div>
        {/* 聊天栏持久挂载（Task 4 裁定 carry 项）：折叠只收外层宽度并裁掉内容层，ChatPanel/Composer
            不卸载 → Composer 草稿与消息流在折叠/展开间原样保留；折叠竖条仍只显示展开按钮 */}
        <div className={(chatCollapsed ? 'w-9' : 'w-[420px]') + ' border-l border-border-subtle shrink-0 transition-all duration-150 overflow-hidden flex flex-col min-h-0'}>
          {chatCollapsed && (
            /* 折叠竖条：36px 宽，恰在裁剪框内不被裁掉，仅展开按钮 */
            <div className="w-9 flex justify-center pt-2 shrink-0">
              <button type="button" title="展开聊天" onClick={() => setChatCollapsed(false)} className="h-6 w-6 flex items-center justify-center rounded-md text-ink-secondary hover:bg-surface-3">
                <PanelRight size={14} />
              </button>
            </div>
          )}
          {/* 内容层定宽 420px 常驻（折叠时被 overflow-hidden 裁掉；invisible 仅停止绘制，不卸载） */}
          <div className={'w-[420px] flex-1 flex flex-col min-h-0' + (chatCollapsed ? ' invisible' : '')}>
            {/* 折叠柄：聊天栏顶部一行，按钮反向（收起） */}
            <div className="h-7 flex items-center justify-end px-1.5 shrink-0">
              <button type="button" title="收起聊天" onClick={() => setChatCollapsed(true)} className="h-6 w-6 flex items-center justify-center rounded-md text-ink-secondary hover:bg-surface-3">
                <PanelRight size={14} />
              </button>
            </div>
            <ChatPanel />
            <Composer />
          </div>
        </div>
      </div>
    </div>
  )
}
