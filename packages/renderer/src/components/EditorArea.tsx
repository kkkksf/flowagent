import { lazy, Suspense } from 'react'
import type React from 'react'
import { fa } from '../api/fa.js'
import { useEditorStore } from '../editor-store-instance.js'
import { openFileFromDisk } from '../editor-events.js'
import { DiffPane } from './DiffPane.js'

const MonacoPane = lazy(() => import('./MonacoPane.js').then((m) => ({ default: m.MonacoPane })))

export function EditorArea(): React.JSX.Element {
  const tabs = useEditorStore((s) => s.tabs)
  const activeId = useEditorStore((s) => s.activeTabId)
  const notice = useEditorStore((s) => s.notice)
  const recents = useEditorStore((s) => s.recentPaths)
  const active = tabs.find((t) => t.id === activeId)
  const close = (id: string): void => {
    const t = tabs.find((x) => x.id === id)
    if (t?.kind === 'file' && t.dirty && !window.confirm('有未保存的修改，确定关闭？')) return
    if (t?.kind === 'file') void fa.fs.unwatch(t.path).catch(() => {})
    useEditorStore.getState().closeTab(id)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid #ddd', overflowX: 'auto' }}>
        {tabs.map((t) => (
          <div key={t.id} onClick={() => useEditorStore.getState().activate(t.id)}
               onAuxClick={(e) => { if (e.button === 1) close(t.id) }}
               style={{ padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap',
                        borderBottom: activeId === t.id ? '2px solid #1a73e8' : 'none',
                        color: t.kind === 'file' && t.conflict ? '#b8860b' : undefined }}>
            {t.kind === 'file' ? `${t.path.split('/').at(-1)}${t.dirty ? ' •' : ''}` : `diff: ${t.path.split('/').at(-1)}`}
            <span onClick={(e) => { e.stopPropagation(); close(t.id) }} style={{ marginLeft: 6 }}>×</span>
          </div>
        ))}
      </div>
      {notice && (
        <div style={{ background: '#fff3cd', padding: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ flex: 1 }}>{notice}</span>
          <button type="button" onClick={() => useEditorStore.getState().setNotice(null)}>×</button>
        </div>
      )}
      {active?.kind === 'file' && active.conflict && (
        <div style={{ background: '#ffe9a8', padding: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ flex: 1 }}>文件已在磁盘上更改（{active.path}）</span>
          <button type="button" onClick={() => {
            const s = useEditorStore.getState()
            void fa.fs.read(active.path).then((r) => {
              // 丢弃我的修改：reloadContent 换回盘上内容/mtime，markSaved 清 dirty/conflict——
              // 只有清了 dirty，MonacoPane 的 model 同步守卫才会把盘上内容 setValue 进编辑器
              s.reloadContent(active.id, r.content, r.mtimeMs)
              s.markSaved(active.id, r.mtimeMs)
              s.setNotice(null)
            }).catch((e: unknown) => s.setNotice(String(e)))
          }}>加载磁盘版本（丢弃我的修改）</button>
          <button type="button" onClick={() => useEditorStore.getState().setConflict(active.id, false)}>保留我的版本（继续编辑）</button>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        {active?.kind === 'diff' ? (
          <DiffPane tab={active} />
        ) : active?.kind === 'file' ? (
          <Suspense fallback={<div style={{ padding: 24, color: '#888' }}>编辑器加载中…</div>}><MonacoPane /></Suspense>
        ) : (
          <div style={{ padding: 24, color: '#888' }}>
            欢迎。给 FlowAgent 发个任务，或从左侧文件树打开文件。
            {recents.length > 0 && (
              <div style={{ marginTop: 12 }}>最近打开：
                {recents.map((p) => (
                  <div key={p} style={{ cursor: 'pointer', color: '#1a73e8' }} onClick={() => void openFileFromDisk(p)}>{p}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
