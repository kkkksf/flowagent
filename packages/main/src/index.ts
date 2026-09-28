import { app, BrowserWindow, dialog } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
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
  const model = process.env.FLOWAGENT_MODEL ?? null

  const win = new BrowserWindow({
    width: 1200, height: 800,
    webPreferences: { preload: join(__dirname, '../preload/preload.js'), contextIsolation: true, nodeIntegration: false },
  })
  const url = process.env['ELECTRON_RENDERER_URL']
  if (url) void win.loadURL(url); else void win.loadFile(join(__dirname, '../renderer/index.html'))

  const host = new AgentHost({
    emit: (ev) => { if (!win.isDestroyed()) win.webContents.send('fa:event', ev) },
    makeAgent: (approve) => buildRealAgent(approve, workspaceRoot!, sessionFile),
  })
  registerIpc({
    host, win,
    getState: () => ({ workspaceRoot, model, hasSession: existsSync(sessionFile) }),
  })
  // 会话自动恢复
  const records = new JsonlSessionStore(sessionFile).load()
  if (records.length > 0) {
    host.loadSession(records.flatMap((r) => (r.kind === 'message' ? [r.message] : [])))
  }
  // 关窗：挂起审批按拒绝收场（host.stop 内含），进程干净退出
  win.on('closed', () => { host.stop() })
})
app.on('window-all-closed', () => { app.quit() })
