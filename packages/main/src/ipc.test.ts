import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ipcMain } from 'electron'
import { registerIpc } from './ipc.js'
import type { BrowserWindow } from 'electron'
import type { AgentHost } from './agent-host.js'
import type { FaState } from './protocol.js'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

type IpcHandler = (...args: unknown[]) => unknown

const handlers = new Map<string, IpcHandler>()
const wcListeners = new Map<string, () => void>()
const state: FaState = { workspaceRoot: 'E:/w', model: 'm', hasSession: true }

function fakeWin(): BrowserWindow {
  return {
    isDestroyed: () => false,
    webContents: {
      on: (ev: string, fn: () => void) => { wcListeners.set(ev, fn) },
      send: vi.fn(),
    },
  } as unknown as BrowserWindow
}

function fakeHost(): AgentHost {
  return {
    send: vi.fn(), stop: vi.fn(), respondApproval: vi.fn(), setAutoApprove: vi.fn(),
  } as unknown as AgentHost
}

beforeEach(() => {
  handlers.clear()
  wcListeners.clear()
  const mockHandle = ipcMain.handle as unknown as Mock<(...args: unknown[]) => unknown>
  mockHandle.mockReset()
  mockHandle.mockImplementation((...args: unknown[]) => {
    handlers.set(String(args[0]), args[1] as IpcHandler)
  })
})

describe('registerIpc', () => {
  it('ready handshake is idempotent within one page load', async () => {
    const onReady = vi.fn()
    registerIpc({ host: fakeHost(), win: fakeWin(), getState: () => state, onReady })
    const ready = handlers.get('fa:ready')!
    await ready()
    await ready() // StrictMode 双 effect 等：同一次加载内不重复触发
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('re-arms the ready handshake after page reload so history is re-sent', async () => {
    const onReady = vi.fn()
    registerIpc({ host: fakeHost(), win: fakeWin(), getState: () => state, onReady })
    const ready = handlers.get('fa:ready')!
    await ready()
    expect(onReady).toHaveBeenCalledTimes(1)

    // F5 / View→Reload：did-start-loading 重置 readied，
    // 全新 renderer 上下文的 fa:ready 必须重新触发 onReady（spec §7 刷新后全量对齐）
    wcListeners.get('did-start-loading')!()
    await ready()
    expect(onReady).toHaveBeenCalledTimes(2)
  })
})
