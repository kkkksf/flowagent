import * as monaco from 'monaco-editor'
// 0.5x 的 exports 映射 ./* → ./esm/vs/*，深路径 esm/vs/... 会被解析成重复段而失败；
// 按 exports 走的短 specifier 与文档深路径指向同一文件 esm/vs/editor/editor.worker.js
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import type React from 'react'
import { useEffect, useRef } from 'react'
import { fa } from '../api/fa.js'
import { useEditorStore } from '../editor-store-instance.js'

// 本地 worker：语法高亮基础能力零外链（spec §2：禁 CDN）
self.MonacoEnvironment = { getWorker: () => new EditorWorker() }

export function MonacoPane(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const activeFile = useEditorStore((s) => s.tabs.find((t) => t.id === s.activeTabId))

  useEffect(() => {
    const editor = monaco.editor.create(ref.current!, { automaticLayout: true, theme: 'vs' })
    editorRef.current = editor
    editor.onDidChangeModelContent(() => {
      const s = useEditorStore.getState()
      const id = s.activeTabId
      const t = id ? s.tabs.find((x) => x.id === id) : undefined
      // 值与 store 一致的变化来自外部 reload 的 setValue（watch/agent 联动），不算用户编辑、不标脏
      if (id && t?.kind === 'file' && t.content !== editor.getValue()) s.updateContent(id, editor.getValue())
    })
    return () => editor.dispose()
  }, [])

  useEffect(() => { // 激活/内容变化 → 绑定对应 model（仅 file 标签；每 path 一个 model，切标签复用）
    if (!editorRef.current || !activeFile || activeFile.kind !== 'file') return
    const uri = monaco.Uri.parse('inmemory:///' + encodeURI(activeFile.path))
    let model = monaco.editor.getModel(uri)
    if (!model) model = monaco.editor.createModel(activeFile.content, undefined, uri)
    else if (model.getValue() !== activeFile.content && !activeFile.dirty) model.setValue(activeFile.content)
    editorRef.current.setModel(model)
  }, [activeTabId, activeFile?.kind === 'file' ? activeFile.content : null])

  // Ctrl+S：CAS 保存当前文件标签（非文件标签不响应）。保存不是文本输入路径，不加 isComposing 守卫。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        const s = useEditorStore.getState()
        const t = s.tabs.find((x) => x.id === s.activeTabId)
        if (!t || t.kind !== 'file') return
        const written = t.content // 写入磁盘的内容快照；返回时标签内容若已变，不能误清脏标记
        void fa.fs.write(t.path, written, t.knownMtime).then((r) => {
          if (r.ok) {
            void fa.fs.watch(t.path)
            const cur = useEditorStore.getState().tabs.find((x) => x.id === t.id)
            if (cur && cur.kind === 'file' && cur.content === written) s.markSaved(t.id, r.mtimeMs)
            // 写回期间用户又改了内容：磁盘上是 written，标签保持脏，交给下一次保存
          }
          else { s.setConflict(t.id, true); s.setNotice('保存冲突：文件已在磁盘上更改') }
        }).catch((err: unknown) => s.setNotice(String(err)))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}
