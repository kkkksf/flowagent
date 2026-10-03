import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import { useEffect, useRef } from 'react'
import { useThemeStore } from '../theme-store.js'
import { monacoThemeData } from '../themes.js'

self.MonacoEnvironment = { getWorker: () => new EditorWorker() }

export function MonacoDiff({ original, modified }: { original: string; modified: string }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // 独立懒加载 chunk：主题在本文件内同样 define（幂等），不依赖 MonacoPane 先加载
    monaco.editor.defineTheme('fa-dark', monacoThemeData('dark'))
    monaco.editor.defineTheme('fa-light', monacoThemeData('light'))
    const editor = monaco.editor.createDiffEditor(ref.current!, { readOnly: true, automaticLayout: true, renderSideBySide: true, theme: useThemeStore.getState().theme === 'dark' ? 'fa-dark' : 'fa-light' })
    editor.setModel({ original: monaco.editor.createModel(original), modified: monaco.editor.createModel(modified) })
    const unsubTheme = useThemeStore.subscribe((s) => {
      monaco.editor.setTheme(s.theme === 'dark' ? 'fa-dark' : 'fa-light')
    })
    return () => { unsubTheme(); editor.getModel()?.original?.dispose(); editor.getModel()?.modified?.dispose(); editor.dispose() }
  }, [original, modified])
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}
