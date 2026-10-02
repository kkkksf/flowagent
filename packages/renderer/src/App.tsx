import type React from 'react'
import { useEffect, useState } from 'react'
import { fa } from './api/fa.js'
import { useStore } from './store.js'
import { useEditorStore } from './editor-store-instance.js'
import { applyEditorEvent, openFileFromDisk } from './editor-events.js'
import { ChatPanel, fmtTokens } from './components/ChatPanel.js'
import { Composer } from './components/Composer.js'
import { FileTree } from './components/FileTree.js'
import { EditorArea } from './components/EditorArea.js'
import { TerminalPanel } from './components/TerminalPanel.js'

export function App(): React.JSX.Element {
  const meta = useStore((s) => s.meta)
  const usage = useStore((s) => s.usage)
  // 折叠状态提升到 App：左栏容器宽度随之 240px ↔ 32px，消除折叠后 208px 死区（Task 6 遗留）
  const [treeCollapsed, setTreeCollapsed] = useState(false)
  // 终端面板折叠只卸载 XtermPane 前端实例，pty 归 main 管理继续后台跑
  const [termCollapsed, setTermCollapsed] = useState(false)
  useEffect(() => {
    // 先订阅再 ready：保证能收到主进程 ready 后补发的恢复历史；chat/editor 两个 store 并行喂
    const off = fa.onEvent((ev) => { useStore.getState().applyEvent(ev); void applyEditorEvent(ev) })
    void fa.getState().then((st) => useStore.getState().setMeta({ workspaceRoot: st.workspaceRoot, model: st.model }))
    void fa.ready()
    return off
  }, [])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{ display: 'flex', gap: 12, padding: '8px 16px', borderBottom: '1px solid #ddd', alignItems: 'baseline' }}>
        <strong>FlowAgent</strong>
        <span style={{ color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {meta.workspaceRoot ?? '未选择工作区'}
        </span>
        <span style={{ color: '#999' }}>{meta.model ?? '模型未配置'}</span>
        {/* 单次请求 usage 覆盖式（chat-store），切会话重置为 — */}
        <span style={{ color: '#999' }} title="prompt / completion tokens">
          {usage ? `${fmtTokens(usage.prompt)} / ${fmtTokens(usage.completion)} tokens` : '—'}
        </span>
      </header>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ width: treeCollapsed ? 32 : 240, borderRight: '1px solid #ddd', overflowY: 'auto', flexShrink: 0, transition: 'width 0.15s' }}>
          <FileTree collapsed={treeCollapsed} onToggleCollapse={() => setTreeCollapsed((v) => !v)} onOpenFile={(p) => void openFileFromDisk(p)} />
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, minHeight: 0 }}>
            <EditorArea />
          </div>
          <TerminalPanel collapsed={termCollapsed} onToggleCollapse={() => setTermCollapsed((v) => !v)} />
        </div>
        <div style={{ width: 420, borderLeft: '1px solid #ddd', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <ChatPanel />
          <Composer />
        </div>
      </div>
    </div>
  )
}
