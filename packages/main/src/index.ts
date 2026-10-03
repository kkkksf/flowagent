import { app, BrowserWindow, dialog, shell } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Agent, OpenAICompatProvider, fsTools, execTool, todoTool, JsonlSessionStore, TokenBudgetTrim, repairDanglingToolCalls } from 'agent-core'
import { AgentHost } from './agent-host.js'
import { registerIpc } from './ipc.js'
import { FileService } from './file-service.js'
import { TerminalService } from './terminal-service.js'
import { listSessions, createSession, deleteSession, migrateLegacy } from './session-service.js'
import { spawnPty } from './pty-factory.js'
import { loadSettings, saveSettings } from './settings.js'
import type { FaEvent } from './protocol.js'

// sessionFile 为惰性求值：agent 在 host.send 内惰性创建，届时才绑定当前会话文件——
// 切会话只需 host.reset() 丢弃旧 agent，无需重建 host（M4 多会话）
function buildRealAgent(approve: (action: string, detail: string) => Promise<boolean>, workspaceRoot: string, sessionFile: () => string): Agent {
  return new Agent({
    provider: new OpenAICompatProvider({
      baseURL: process.env.FLOWAGENT_BASE_URL ?? '',
      apiKey: process.env.FLOWAGENT_API_KEY ?? '',
      model: process.env.FLOWAGENT_MODEL ?? '',
    }),
    tools: [...fsTools, execTool, todoTool],
    systemPrompt: 'You are FlowAgent, a helpful coding agent working inside the user\'s workspace. Use the provided tools to complete tasks step by step. The host OS is Windows with a cmd.exe shell for run_command: prefer cross-platform commands (e.g. use node or python for date/time instead of POSIX date), avoid interactive commands that wait for keyboard input.',
    maxSteps: 30,
    contextStrategy: new TokenBudgetTrim({ tokenBudget: 60_000 }),
    session: new JsonlSessionStore(sessionFile()),
    workspaceRoot,
    approve,
  })
}

app.whenReady().then(() => {
  const settingsFile = join(app.getPath('userData'), 'settings.json')
  let workspaceRoot = loadSettings(settingsFile).workspaceRoot
  if (!workspaceRoot || !existsSync(workspaceRoot)) {
    const picked = dialog.showOpenDialogSync({ properties: ['openDirectory'] })
    if (!picked?.length) { app.quit(); return }
    workspaceRoot = picked[0]
    saveSettings(settingsFile, { workspaceRoot })
  }
  const model = process.env.FLOWAGENT_MODEL ?? null

  const win = new BrowserWindow({
    width: 1200, height: 800,
    // Windows 上 titleBarOverlay 必须搭配 titleBarStyle: 'hidden' 才实际生效（overlay 才会绘制并支持 setTitleBarOverlay 动态更新）
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0e0f11', symbolColor: '#ececf1', height: 40 },
    webPreferences: { preload: join(__dirname, '../preload/preload.js'), contextIsolation: true, nodeIntegration: false },
  })
  const url = process.env['ELECTRON_RENDERER_URL']
  if (url) void win.loadURL(url); else void win.loadFile(join(__dirname, '../renderer/index.html'))

  // 导航守卫：markdown 链接/新窗口一律外部浏览器打开，防止应用内导航离开聊天界面。
  // 例外：应用自身刷新（F5/Ctrl+R，目标 url === 当前页 getURL()）放行——reload 是预导航事件，
  // getURL() 仍是当前页；若 preventDefault 会把应用 URL 丢给外部浏览器，渲染出无 preload 的死副本
  // （会话恢复流程依赖 reload，M3 Task 4）。openExternal 一律 .catch 兜底：about:blank#blocked
  // 类非法 URL 的 rejection 不能变成 unhandled。
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url).catch(() => {}); return { action: 'deny' } })
  win.webContents.on('will-navigate', (e, url) => {
    if (url === win.webContents.getURL()) return // 应用自身 reload：放行
    e.preventDefault()
    void shell.openExternal(url).catch(() => {})
  })

  // 会话恢复动作延迟到渲染端 fa:ready——webContents.send 不缓存无监听者的消息，过早 emit 会丢
  const emit = (ev: FaEvent): void => { if (!win.isDestroyed()) win.webContents.send('fa:event', ev) }
  const fileService = new FileService(workspaceRoot!, {
    onFileChanged: (p) => emit({ type: 'file-changed', path: p }),
    onWatchError: (p) => emit({ type: 'file-watch-error', path: p }),
  })

  // —— 多会话编排（M4）——
  const sessionsDir = join(workspaceRoot!, '.flowagent', 'sessions')
  mkdirSync(sessionsDir, { recursive: true })            // Task 4 移交：编排层建目录
  migrateLegacy(sessionsDir)
  let currentFile = listSessions(sessionsDir)[0]?.file ?? createSession(sessionsDir).file // mtime 最新；无则新建

  const term = new TerminalService({
    spawnPty,
    onChunk: (d) => emit({ type: 'term-data', data: d }),
    onExit: () => emit({ type: 'term-exit' }),
  })
  try {
    term.start(workspaceRoot!)
  } catch (e) {
    // pty 启动失败绝不能拖垮 whenReady 后半段（IPC 注册/会话恢复）——终端降级为"已退出"，其余功能照常
    console.error('terminal failed to start:', e)
    emit({ type: 'error', message: `终端启动失败：${e instanceof Error ? e.message : String(e)}` })
  }

  const historyOf = (file: string) => repairDanglingToolCalls(
    new JsonlSessionStore(join(sessionsDir, file)).load().flatMap((r) => (r.kind === 'message' ? [r.message] : [])))

  const switchSession = (file: string): void => {
    // basename jail（同 deleteSession）：拒绝路径分隔符与上跳，防越出 sessions 目录
    if (!file || file === '.' || file.includes('/') || file.includes('\\') || file.includes('..')) throw new Error('bad session file name')
    if (host.busy) throw new Error('agent is busy') // 第二道 busy 守卫（第一道在 renderer）
    host.reset()
    currentFile = file
    host.loadSession(historyOf(file))   // emit history（renderer 全量替换）+ 下次 send 绑定新文件
    emit({ type: 'session-changed', file })
  }

  const host = new AgentHost({
    emit,
    makeAgent: (approve) => buildRealAgent(approve, workspaceRoot!, () => join(sessionsDir, currentFile)),
  })
  registerIpc({
    host, win,
    getState: () => ({ workspaceRoot, model, hasSession: existsSync(join(sessionsDir, currentFile)), currentSession: currentFile }),
    fs: fileService,
    term,
    session: {
      list: () => listSessions(sessionsDir),
      // busy 守卫必须放在 create 侧：ipc 的 fa:session:new 先 create 再 onSwitch（其守卫太晚），
      // 无守卫时 busy 窗口会留下孤儿空文件，冷启动按 mtime 最新误选它。同步 handler，守卫+建文件原子。
      create: () => { if (host.busy) throw new Error('agent is busy'); return createSession(sessionsDir) },
      // 纵深防御：renderer 置灰之外主进程同样拒绝删当前会话；busy 窗口同样拒绝删除
      remove: (f) => { if (f === currentFile) throw new Error('cannot delete the active session'); if (host.busy) throw new Error('agent is busy'); deleteSession(sessionsDir, f) },
      onSwitch: switchSession,
    },
    onReady: () => { const h = historyOf(currentFile); if (h.length > 0) host.loadSession(h) }, // renderer 未 ready 时静默不恢复
  })
  // 关窗：挂起审批按拒绝收场（host.stop 内含），watcher 全部释放，pty 关停，进程干净退出
  win.on('closed', () => { host.stop(); fileService.unwatchAll(); term.kill() })
})
app.on('window-all-closed', () => { app.quit() })
