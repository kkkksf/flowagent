import { contextBridge, ipcRenderer } from 'electron'
import type { FaEvent } from './protocol.js'

contextBridge.exposeInMainWorld('fa', {
  getState: () => ipcRenderer.invoke('fa:getState'),
  ready: () => ipcRenderer.invoke('fa:ready'),
  sendUserMessage: (text: string) => ipcRenderer.invoke('fa:send', text),
  stop: () => ipcRenderer.invoke('fa:stop'),
  respondApproval: (id: string, allow: boolean) => ipcRenderer.invoke('fa:approval', id, allow),
  setAutoApprove: (v: boolean) => ipcRenderer.invoke('fa:setAutoApprove', v),
  onEvent: (cb: (ev: FaEvent) => void) => {
    const listener = (_e: unknown, ev: FaEvent) => cb(ev)
    ipcRenderer.on('fa:event', listener)
    return () => { ipcRenderer.removeListener('fa:event', listener) }
  },
})
