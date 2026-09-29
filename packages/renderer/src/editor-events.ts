import type { FaEvent } from '../../main/src/protocol.js'
import { fa } from './api/fa.js'
import { useEditorStore } from './editor-store-instance.js'
import { normalizePath } from './state/editor-store.js'

export async function openFileFromDisk(rawPath: string): Promise<void> {
  const path = normalizePath(rawPath) // 外部路径入口（树/工具卡/最近打开）：read/watch/标签同一书写
  try {
    const r = await fa.fs.read(path)
    const s = useEditorStore.getState()
    s.openFile(path, r.content, r.mtimeMs)
    await fa.fs.watch(path)
    s.clearAgentTouched(path) // 小圆点保留到用户打开该文件，打开即消化（spec §3）
  } catch (e) {
    useEditorStore.getState().setNotice(`无法打开 ${path}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export async function applyEditorEvent(ev: FaEvent): Promise<void> {
  const s = useEditorStore.getState()
  switch (ev.type) {
    case 'file-changed': {
      const tab = s.tabs.find((t) => t.kind === 'file' && t.path === ev.path)
      if (!tab || tab.kind !== 'file') return
      if (tab.dirty) { s.setConflict(tab.id, true); return } // 脏：只标记不覆盖（spec §7）
      const r = await fa.fs.read(ev.path).catch(() => null)
      if (r) s.reloadContent(tab.id, r.content, r.mtimeMs)
      return
    }
    case 'file-watch-error': {
      // spec §7 边界：watch 报错（目录被删/改名）→ 关标签 + toast
      const tab = s.tabs.find((t) => t.kind === 'file' && t.path === ev.path)
      if (tab) {
        s.closeTab(tab.id)
        await fa.fs.unwatch(ev.path).catch(() => {})
      }
      s.setNotice(`文件监视中断，已关闭标签：${ev.path}`)
      return
    }
    case 'tool-call': {
      // agent 新建/修改的文件路径：从 tool-call 参数解析（spec §3 联动）；模型常给反斜杠，先归一
      try {
        const args = JSON.parse(ev.call.arguments) as Record<string, unknown>
        if (typeof args.path === 'string' && (ev.call.name === 'write_file' || ev.call.name === 'edit_file')) {
          s.markAgentTouched(normalizePath(args.path))
        }
      } catch { /* 非 JSON 参数忽略 */ }
      return
    }
    case 'tool-result': {
      // 打开且干净的标签就地重载 agent 写入的新内容；小圆点不清——保留到用户打开该文件（spec §3）
      for (const p of [...useEditorStore.getState().agentTouched]) {
        const cur = useEditorStore.getState().tabs.find((t) => t.kind === 'file' && t.path === p)
        if (cur && cur.kind === 'file' && !cur.dirty) {
          const r = await fa.fs.read(p).catch(() => null)
          if (r) useEditorStore.getState().reloadContent(cur.id, r.content, r.mtimeMs)
        }
      }
      return
    }
    case 'approval-resolved': {
      s.resolveDiff(ev.id, ev.allowed)
      return
    }
    default: return
  }
}
