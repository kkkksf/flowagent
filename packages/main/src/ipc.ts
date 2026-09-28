import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import type { AgentHost } from './agent-host.js'
import type { FaEvent, FaState } from './protocol.js'

export function registerIpc(deps: {
  host: AgentHost
  win: BrowserWindow
  getState(): FaState
}): { send: (ev: FaEvent) => void } {
  const send = (ev: FaEvent) => {
    if (!deps.win.isDestroyed()) deps.win.webContents.send('fa:event', ev)
  }
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
  return { send }
}
