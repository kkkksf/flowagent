import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// 尚未迁移到语义 token 的文件；每完成一个组件任务就删一行，Task 10 必须清空
const LEGACY_FILES = new Set([
  'App.tsx', 'ChatPanel.tsx', 'Composer.tsx', 'MessageItem.tsx', 'ToolCard.tsx',
  'ApprovalCard.tsx', 'DiffPane.tsx', 'EditorArea.tsx', 'FileTree.tsx',
  'MonacoPane.tsx', 'MonacoDiff.tsx', 'TerminalPanel.tsx', 'XtermPane.tsx',
])

const HEX = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\b(?:red|blue|green|white|black|gray|grey|yellow|orange|purple|pink|cyan|magenta)\b/i

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

describe('renderer 源码禁止裸色值（.tsx；色板只许在 themes.ts/index.css）', () => {
  it('非 allowlist 的 .tsx 无 hex/rgb/具名色', () => {
    const offenders: string[] = []
    for (const f of walk(join(__dirname, '..'))) {
      if (!f.endsWith('.tsx')) continue
      const rel = f.split(/[\\/]/).pop()!
      if (LEGACY_FILES.has(rel)) continue
      if (HEX.test(readFileSync(f, 'utf8'))) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })
})
