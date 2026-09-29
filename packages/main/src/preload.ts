import { contextBridge, ipcRenderer } from 'electron'
import type { FaEvent } from './protocol.js'

contextBridge.exposeInMainWorld('fa', {
  getState: () => ipcRenderer.invoke('fa:getState'),
  ready: () => ipcRenderer.invoke('fa:ready'),
  sendUserMessage: (text: string) => ipcRenderer.invoke('fa:send', text),
  stop: () => ipcRenderer.invoke('fa:stop'),
  respondApproval: (id: string, allow: boolean) => ipcRenderer.invoke('fa:approval', id, allow),
  setAutoApprove: (v: boolean) => ipcRenderer.invoke('fa:setAutoApprove', v),
  fs: {
    read: (path: string) => ipcRenderer.invoke('fa:fs:read', path),
    list: (path: string) => ipcRenderer.invoke('fa:fs:list', path),
    create: (path: string, kind: 'file' | 'dir') => ipcRenderer.invoke('fa:fs:create', path, kind),
    rename: (from: string, to: string) => ipcRenderer.invoke('fa:fs:rename', from, to),
    delete: (path: string) => ipcRenderer.invoke('fa:fs:delete', path),
    write: (path: string, content: string, expectedMtimeMs?: number) =>
      ipcRenderer.invoke('fa:fs:write', path, content, expectedMtimeMs),
    watch: (path: string) => ipcRenderer.invoke('fa:fs:watch', path),
    unwatch: (path: string) => ipcRenderer.invoke('fa:fs:unwatch', path),
  },
  onEvent: (cb: (ev: FaEvent) => void) => {
    const listener = (_e: unknown, ev: FaEvent) => cb(ev)
    ipcRenderer.on('fa:event', listener)
    return () => { ipcRenderer.removeListener('fa:event', listener) }
  },
})
