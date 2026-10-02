import { useEffect, useRef } from 'react'
import type React from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { fa } from '../api/fa.js'

export function XtermPane(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const term = new Terminal({ fontSize: 13, cursorBlink: true })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(ref.current!)
    fit.fit()
    const off = fa.onEvent((ev) => {
      if (ev.type === 'term-data') term.write(ev.data)
    })
    void fa.term.attach(term.cols, term.rows).then((buffered) => {
      if (buffered) term.write(buffered)   // attach 前的缓冲回放（含历史输出，xterm scrollback 兜住）
      term.focus()
    })
    term.onData((d) => { void fa.term.write(d) })
    const ro = new ResizeObserver(() => { fit.fit(); void fa.term.resize(term.cols, term.rows) })
    ro.observe(ref.current!)
    return () => { ro.disconnect(); off(); term.dispose() } // 仅销毁前端实例；pty 归 App/main 管理
  }, [])
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}
