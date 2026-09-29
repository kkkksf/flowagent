import { app, BrowserWindow, dialog, shell } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Agent, OpenAICompatProvider, fsTools, execTool, todoTool, JsonlSessionStore, TokenBudgetTrim } from 'agent-core'
import { AgentHost } from './agent-host.js'
import { registerIpc } from './ipc.js'
import { loadSettings, saveSettings } from './settings.js'

function buildRealAgent(approve: (action: string, detail: string) => Promise<boolean>, workspaceRoot: string, sessionFile: string): Agent {
  return new Agent({
    provider: new OpenAICompatProvider({
      baseURL: process.env.FLOWAGENT_BASE_URL ?? '',
      apiKey: process.env.FLOWAGENT_API_KEY ?? '',
      model: process.env.FLOWAGENT_MODEL ?? '',
    }),
    tools: [...fsTools, execTool, todoTool],
    systemPrompt: 'You are FlowAgent, a helpful coding agent working inside the user\'s workspace. Use the provided tools to complete tasks step by step.',
    maxSteps: 30,
    contextStrategy: new TokenBudgetTrim({ tokenBudget: 60_000 }),
    session: new JsonlSessionStore(sessionFile),
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
  const sessionFile = join(workspaceRoot, '.flowagent', 'session.jsonl')
  // appendFileSync 不会创建父目录：首次落盘前必须先建 .flowagent/（M1 CLI 同款处理）
  mkdirSync(dirname(sessionFile), { recursive: true })
  const model = process.env.FLOWAGENT_MODEL ?? null

  const win = new BrowserWindow({
    width: 1200, height: 800,
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

  // 会话记录启动时读出；恢复动作延迟到渲染端 fa:ready——webContents.send 不缓存无监听者的消息，过早 emit 会丢
  const history = new JsonlSessionStore(sessionFile).load()
    .flatMap((r) => (r.kind === 'message' ? [r.message] : []))
  const host = new AgentHost({
    emit: (ev) => { if (!win.isDestroyed()) win.webContents.send('fa:event', ev) },
    makeAgent: (approve) => buildRealAgent(approve, workspaceRoot!, sessionFile),
  })
  registerIpc({
    host, win,
    getState: () => ({ workspaceRoot, model, hasSession: existsSync(sessionFile) }),
    onReady: () => { if (history.length > 0) host.loadSession(history) }, // renderer 未 ready 时静默不恢复
  })
  // 关窗：挂起审批按拒绝收场（host.stop 内含），进程干净退出
  win.on('closed', () => { host.stop() })
})
app.on('window-all-closed', () => { app.quit() })
