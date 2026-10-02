import { useEffect, useRef } from 'react'
import type React from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { fa } from '../api/fa.js'

export function XtermPane(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current!
    let disposed = false // 卸载竞态：attach 回放到达时组件可能已清理
    const term = new Terminal({ fontSize: 13, cursorBlink: true })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    fit.fit()
    const off = fa.onEvent((ev) => {
      if (ev.type === 'term-data') term.write(ev.data)
    })
    void fa.term.attach(term.cols, term.rows).then((buffered) => {
      if (disposed) return
      if (buffered) term.write(buffered)   // attach 前的缓冲回放（含历史输出，xterm scrollback 兜住）
      term.focus()
    })
    term.onData((d) => { void fa.term.write(d) })
    const ro = new ResizeObserver(() => {
      // 折叠期间容器零尺寸：跳过 fit/resize，防 pty 被缩为 0（展开时 RO 会再触发恢复）
      if (el.clientHeight === 0 || el.clientWidth === 0) return
      fit.fit(); void fa.term.resize(term.cols, term.rows)
    })
    ro.observe(el)
    return () => { disposed = true; ro.disconnect(); off(); term.dispose() } // 仅销毁前端实例；pty 归 App/main 管理
  }, [])
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />
}
