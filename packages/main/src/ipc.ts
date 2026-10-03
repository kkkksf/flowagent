import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import type { AgentHost } from './agent-host.js'
import type { FileService } from './file-service.js'
import type { TerminalService } from './terminal-service.js'
import type { SessionMeta } from './session-service.js'
import type { FaEvent, FaState } from './protocol.js'

export function registerIpc(deps: {
  host: AgentHost
  win: BrowserWindow
  getState(): FaState
  fs: FileService
  term: TerminalService
  session: { list(): SessionMeta[]; create(): SessionMeta; remove(file: string): void; onSwitch(file: string): void }
  onReady?: () => void
}): { send: (ev: FaEvent) => void } {
  const send = (ev: FaEvent) => {
    if (!deps.win.isDestroyed()) deps.win.webContents.send('fa:event', ev)
  }
  // 幂等防御：renderer 可能多次 fa:ready（如 StrictMode 双 effect），onReady 只触发一次
  let readied = false
  // 刷新/重载（View→Reload、F5、Ctrl+R）后 renderer 是全新上下文：重置 readied，
  // 让新一次页面加载重新走 ready 握手，补发 getState + history 全量对齐（spec §7）
  deps.win.webContents.on('did-start-loading', () => { readied = false })
  ipcMain.handle('fa:ready', () => {
    if (readied) return
    readied = true
    deps.onReady?.()
  })
  ipcMain.handle('fa:getState', () => deps.getState())
  ipcMain.handle('fa:send', (_e, text: unknown) => {
    if (typeof text !== 'string' || !text.trim()) throw new Error('empty message')
    void deps.host.send(text).then(undefined, (err: unknown) =>
      send({ type: 'error', message: err instanceof Error ? err.message : String(err) }))
  })
  ipcMain.handle('fa:stop', () => { deps.host.stop() })
  ipcMain.handle('fa:approval', (_e, id: unknown, allow: unknown) => {
    deps.host.respondApproval(String(id), Boolean(allow))
  })
  ipcMain.handle('fa:setAutoApprove', (_e, v: unknown) => { deps.host.setAutoApprove(Boolean(v)) })
  ipcMain.handle('fa:chrome:set-theme', (_e, c: unknown) => {
    const v = c as { color?: unknown; symbolColor?: unknown }
    // 校验式 no-op：非法 payload 直接丢弃，不设兜底 hex（色板 hex 白名单只允许 themes.ts/index.css/BrowserWindow 初值）。
    // 渲染端正常路径永远发送 chromeColors() 产物，此防御分支仅拦异常调用。
    if (typeof v?.color !== 'string' || !v.color || typeof v?.symbolColor !== 'string' || !v.symbolColor) return
    try {
      deps.win.setTitleBarOverlay({ color: v.color, symbolColor: v.symbolColor })
    } catch { /* 平台不支持/窗口销毁：静默（spec §7） */ }
  })
  ipcMain.handle('fa:fs:read', (_e, p: unknown) => deps.fs.read(String(p)))
  ipcMain.handle('fa:fs:list', (_e, p: unknown) => deps.fs.list(String(p)))
  ipcMain.handle('fa:fs:create', (_e, p: unknown, kind: unknown) => deps.fs.create(String(p), kind === 'dir' ? 'dir' : 'file'))
  ipcMain.handle('fa:fs:rename', (_e, a: unknown, b: unknown) => deps.fs.rename(String(a), String(b)))
  ipcMain.handle('fa:fs:delete', (_e, p: unknown) => deps.fs.delete(String(p)))
  ipcMain.handle('fa:fs:write', (_e, p: unknown, c: unknown, m: unknown) =>
    deps.fs.write(String(p), String(c), typeof m === 'number' ? m : undefined))
  ipcMain.handle('fa:fs:watch', (_e, p: unknown) => { deps.fs.watch(String(p)) })
  ipcMain.handle('fa:fs:unwatch', (_e, p: unknown) => { deps.fs.unwatch(String(p)) })
  // term/session 通道只透传：编排逻辑（busy 守卫、host.reset、目录管理）全部留在 index.ts
  ipcMain.handle('fa:term:write', (_e, d: unknown) => { deps.term.write(String(d)) })
  ipcMain.handle('fa:term:resize', (_e, c: unknown, r: unknown) => {
    const cols = Number(c); const rows = Number(r)
    if (Number.isFinite(cols) && Number.isFinite(rows)) deps.term.resize(cols, rows) // NaN/undefined 守卫
  })
  ipcMain.handle('fa:term:attach', (_e, c: unknown, r: unknown) => deps.term.attach(Number(c), Number(r)))
  ipcMain.handle('fa:term:restart', () => { deps.term.restart() })
  ipcMain.handle('fa:session:list', () => deps.session.list())
  ipcMain.handle('fa:session:new', () => {
    const meta = deps.session.create()
    deps.session.onSwitch(meta.file)
    return meta
  })
  ipcMain.handle('fa:session:switch', (_e, f: unknown) => { deps.session.onSwitch(String(f)) })
  ipcMain.handle('fa:session:delete', (_e, f: unknown) => {
    deps.session.remove(String(f))
    return deps.session.list()
  })
  return { send }
}
