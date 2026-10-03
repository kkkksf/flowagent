import { lazy, Suspense } from 'react'
import type React from 'react'
import { X } from 'lucide-react'
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
      <div className="flex h-8 border-b border-border-subtle overflow-x-auto shrink-0">
        {tabs.map((t) => (
          <div key={t.id} onClick={() => useEditorStore.getState().activate(t.id)}
               onAuxClick={(e) => { if (e.button === 1) close(t.id) }}
               className={`flex items-center gap-1.5 h-8 px-2.5 cursor-pointer whitespace-nowrap text-[13px] border-b-2 ${activeId === t.id ? 'border-accent text-ink' : 'border-transparent text-ink-secondary hover:text-ink'}${t.kind === 'file' && t.conflict ? ' text-warning' : ''}`}>
            {t.kind === 'file' ? (<>{t.path.split('/').at(-1)}{t.dirty && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-accent inline-block" />}</>) : `diff: ${t.path.split('/').at(-1)}`}
            <button type="button" onClick={(e) => { e.stopPropagation(); close(t.id) }} className="flex items-center justify-center h-4 w-4 rounded text-ink-faint hover:bg-surface-3 hover:text-ink"><X size={11} className="h-3 w-3" /></button>
          </div>
        ))}
      </div>
      {notice && (
        <div className="flex items-center gap-2 px-2.5 h-7 bg-surface-2 border-l-2 border-warning text-[13px]">
          <span className="flex-1">{notice}</span>
          <button type="button" className="flex items-center justify-center h-4 w-4 rounded text-ink-faint hover:bg-surface-3 hover:text-ink" onClick={() => useEditorStore.getState().setNotice(null)}><X size={11} className="h-3 w-3" /></button>
        </div>
      )}
      {active?.kind === 'file' && active.conflict && (
        <div className="flex items-center gap-2 px-2.5 h-7 bg-surface-2 border-l-2 border-warning text-[13px]">
          <span className="flex-1">文件已在磁盘上更改（{active.path}）</span>
          <button type="button" className="h-6 px-2 rounded-md border border-border text-xs hover:bg-surface-3" onClick={() => {
            const s = useEditorStore.getState()
            void fa.fs.read(active.path).then((r) => {
              // 丢弃我的修改：reloadContent 换回盘上内容/mtime，markSaved 清 dirty/conflict——
              // 只有清了 dirty，MonacoPane 的 model 同步守卫才会把盘上内容 setValue 进编辑器
              s.reloadContent(active.id, r.content, r.mtimeMs)
              s.markSaved(active.id, r.mtimeMs)
              s.setNotice(null)
            }).catch((e: unknown) => s.setNotice(String(e)))
          }}>加载磁盘版本（丢弃我的修改）</button>
          <button type="button" className="h-6 px-2 rounded-md border border-border text-xs hover:bg-surface-3" onClick={() => useEditorStore.getState().setConflict(active.id, false)}>保留我的版本（继续编辑）</button>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        {active?.kind === 'diff' ? (
          <DiffPane tab={active} />
        ) : active?.kind === 'file' ? (
          <Suspense fallback={<div className="p-6 text-ink-faint">编辑器加载中…</div>}><MonacoPane /></Suspense>
        ) : (
          <div className="p-6 pt-16 flex flex-col items-center gap-3 text-ink-secondary">
            <div className="w-10 h-10 rounded-lg bg-accent/15 flex items-center justify-center"><div className="w-5 h-5 rounded bg-accent" /></div>
            <div>欢迎。给 FlowAgent 发个任务，或从左侧文件树打开文件。</div>
            {recents.length > 0 && (
              <div className="text-xs font-mono">最近打开：
                {recents.map((p) => (
                  <div key={p} className="cursor-pointer text-accent hover:underline py-0.5" onClick={() => void openFileFromDisk(p)}>{p}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
