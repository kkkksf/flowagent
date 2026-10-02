import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ipcMain } from 'electron'
import { registerIpc } from './ipc.js'
import type { BrowserWindow } from 'electron'
import type { AgentHost } from './agent-host.js'
import type { FileService } from './file-service.js'
import type { TerminalService } from './terminal-service.js'
import type { SessionMeta } from './session-service.js'
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

function fakeFs(): FileService {
  return {
    read: vi.fn(), list: vi.fn(), create: vi.fn(), rename: vi.fn(),
    delete: vi.fn(), write: vi.fn(), watch: vi.fn(), unwatch: vi.fn(),
  } as unknown as FileService
}

// term/session 两个新 dep 的默认 mock：只验证透传，用例自行断言
function fakeExtras(): { term: TerminalService; session: { list(): SessionMeta[]; create(): SessionMeta; remove(file: string): void; onSwitch(file: string): void } } {
  return {
    term: { write: vi.fn(), resize: vi.fn(), attach: vi.fn(() => ''), restart: vi.fn() } as unknown as TerminalService,
    session: { list: vi.fn(() => []), create: vi.fn(() => ({ file: 'x.jsonl', title: '(空会话)', mtimeMs: 0 })), remove: vi.fn(), onSwitch: vi.fn() },
  }
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
    registerIpc({ host: fakeHost(), win: fakeWin(), getState: () => state, fs: fakeFs(), ...fakeExtras(), onReady })
    const ready = handlers.get('fa:ready')!
    await ready()
    await ready() // StrictMode 双 effect 等：同一次加载内不重复触发
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('re-arms the ready handshake after page reload so history is re-sent', async () => {
    const onReady = vi.fn()
    registerIpc({ host: fakeHost(), win: fakeWin(), getState: () => state, fs: fakeFs(), ...fakeExtras(), onReady })
    const ready = handlers.get('fa:ready')!
    await ready()
    expect(onReady).toHaveBeenCalledTimes(1)

    // F5 / View→Reload：did-start-loading 重置 readied，
    // 全新 renderer 上下文的 fa:ready 必须重新触发 onReady（spec §7 刷新后全量对齐）
    wcListeners.get('did-start-loading')!()
    await ready()
    expect(onReady).toHaveBeenCalledTimes(2)
  })

  it('maps fs channels to the service', async () => {
    const fs = { read: vi.fn(async () => ({ content: 'x', mtimeMs: 1 })), watch: vi.fn(), unwatch: vi.fn() }
    registerIpc({ host: fakeHost(), win: fakeWin(), getState: () => state, fs: fs as unknown as FileService, ...fakeExtras() })
    // 直调存的 handler 须带 IpcMainInvokeEvent 占位首参（真实 electron 调用形状）
    const r = await handlers.get('fa:fs:read')!({}, 'a.txt')
    expect(r).toEqual({ content: 'x', mtimeMs: 1 })
    expect(fs.read).toHaveBeenCalledWith('a.txt')
    handlers.get('fa:fs:watch')!({}, 'a.txt')
    expect(fs.watch).toHaveBeenCalledWith('a.txt')
  })

  it('maps term and session channels', async () => {
    const term = { write: vi.fn(), resize: vi.fn(), attach: vi.fn(async () => 'buf'), restart: vi.fn() }
    const onSwitch = vi.fn()
    const created: SessionMeta = { file: '2026-10-02T230000-abcd.jsonl', title: '(空会话)', mtimeMs: 1 }
    const session = { list: vi.fn(() => [created]), create: vi.fn(() => created), remove: vi.fn(), onSwitch }
    registerIpc({ host: fakeHost(), win: fakeWin(), getState: () => state, fs: fakeFs(), term: term as unknown as TerminalService, session: session as never })
    // 占位首参 = IpcMainInvokeEvent（真实 electron 调用形状，同上）
    expect(await handlers.get('fa:term:attach')!({}, 100, 30)).toBe('buf')
    expect(term.attach).toHaveBeenCalledWith(100, 30)
    handlers.get('fa:session:new')!()
    expect(session.create).toHaveBeenCalled()
    expect(onSwitch).toHaveBeenCalledWith(created.file)
  })
})
