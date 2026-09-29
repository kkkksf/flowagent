import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import { useEffect, useRef } from 'react'

self.MonacoEnvironment = { getWorker: () => new EditorWorker() }

export function MonacoDiff({ original, modified }: { original: string; modified: string }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const editor = monaco.editor.createDiffEditor(ref.current!, { readOnly: true, automaticLayout: true, renderSideBySide: true })
    editor.setModel({ original: monaco.editor.createModel(original), modified: monaco.editor.createModel(modified) })
    return () => { editor.getModel()?.original?.dispose(); editor.getModel()?.modified?.dispose(); editor.dispose() }
  }, [original, modified])
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}
