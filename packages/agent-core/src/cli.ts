import { createInterface } from 'node:readline'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Agent } from './loop.js'
import { OpenAICompatProvider } from './providers/openai.js'
import { fsTools } from './tools/fs.js'
import { execTool } from './tools/exec.js'
import { todoTool } from './tools/todo.js'
import { JsonlSessionStore } from './session/jsonl.js'
import { TokenBudgetTrim } from './context/trim.js'

export function buildAgent(opts: {
  baseURL: string; apiKey: string; model: string
  workspaceRoot: string; sessionFile: string; autoApprove: boolean
  approve?: (action: string, detail: string) => Promise<boolean>
}): Agent {
  // 确保 session 文件所在目录存在（如 <root>/.flowagent/）
  mkdirSync(dirname(opts.sessionFile), { recursive: true })
  return new Agent({
    provider: new OpenAICompatProvider({ baseURL: opts.baseURL, apiKey: opts.apiKey, model: opts.model }),
    tools: [...fsTools, execTool, todoTool],
    systemPrompt: 'You are FlowAgent, a helpful coding agent working inside the user\'s workspace. Use the provided tools to complete tasks step by step.',
    maxSteps: 30,
    contextStrategy: new TokenBudgetTrim({ tokenBudget: 60_000 }),
    session: new JsonlSessionStore(opts.sessionFile),
    workspaceRoot: opts.workspaceRoot,
    autoApprove: opts.autoApprove,
    approve: opts.approve,
  })
}

export async function main(): Promise<void> {
  const baseURL = process.env.FLOWAGENT_BASE_URL
  const apiKey = process.env.FLOWAGENT_API_KEY
  const model = process.env.FLOWAGENT_MODEL
  if (!baseURL || !apiKey || !model) {
    console.error('Set FLOWAGENT_BASE_URL, FLOWAGENT_API_KEY and FLOWAGENT_MODEL')
    process.exit(1)
  }
  const workspaceRoot = process.cwd()
  const sessionFile = join(workspaceRoot, '.flowagent', 'session.jsonl')
  const autoApprove = process.argv.includes('--yes')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q: string) => new Promise<string>((res) => rl.question(q, res))
  const agent = buildAgent({
    baseURL, apiKey, model, workspaceRoot, sessionFile,
    autoApprove,
    // 终端确认门：打印 action + detail，读一行 y/n（--yes 跳过）
    approve: autoApprove
      ? undefined
      : async (action, detail) => (await ask(`allow ${action}: ${detail}? [y/N] `)).toLowerCase() === 'y',
  })

  console.log('flowagent ready. /exit to quit.')
  for (;;) {
    const line = await ask('> ')
    if (line.trim() === '/exit') break
    if (line.trim() === '/resume') {
      const records = new JsonlSessionStore(sessionFile).load()
      agent.loadHistory(records.flatMap((r) => (r.kind === 'message' ? [r.message] : [])))
      console.log(`resumed ${records.length} records`)
      continue
    }
    try {
      for await (const ev of agent.run(line)) {
        if (ev.type === 'message-delta') process.stdout.write(ev.text)
        else if (ev.type === 'tool-call') process.stdout.write(`\n[tool] ${ev.call.name} ${ev.call.arguments.slice(0, 80)}`)
        else if (ev.type === 'tool-result') process.stdout.write(` -> ${ev.result.slice(0, 100)}\n`)
        else if (ev.type === 'error') console.error(`error: ${ev.message}`)
        else if (ev.type === 'assistant-message') process.stdout.write('\n')
      }
    } catch (e) { console.error(`fatal: ${(e as Error).message}`) }
  }
  rl.close()
}

if (process.argv[1]?.endsWith('cli.js')) void main()
