import type React from 'react'
import { useEffect } from 'react'
import { fa } from './api/fa.js'
import { useStore } from './store.js'
import { useEditorStore } from './editor-store-instance.js'
import { applyEditorEvent, openFileFromDisk } from './editor-events.js'
import { ChatPanel } from './components/ChatPanel.js'
import { Composer } from './components/Composer.js'
import { FileTree } from './components/FileTree.js'

export function App(): React.JSX.Element {
  const meta = useStore((s) => s.meta)
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
      </header>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ width: 240, borderRight: '1px solid #ddd', overflowY: 'auto' }}>
          <FileTree onOpenFile={(p) => void openFileFromDisk(p)} />
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
          编辑区（Task 7 接入 Monaco）
        </div>
        <div style={{ width: 420, borderLeft: '1px solid #ddd', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <ChatPanel />
          <Composer />
        </div>
      </div>
    </div>
  )
}
