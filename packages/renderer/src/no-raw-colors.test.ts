import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// 所有 .tsx 已迁移到语义 token：allowlist 为空，守卫扫描全部组件
const LEGACY_FILES = new Set<string>([])

const HEX = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\b(?:red|blue|green|white|black|gray|grey|yellow|orange|purple|pink|cyan|magenta|slate|zinc|rose|emerald|indigo|teal|amber|violet|stone|neutral|lime|sky|fuchsia)\b/i

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (n === 'node_modules' || n === 'dist') return []
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

  it('allowlist 已清空（迁移完成）', () => {
    expect(LEGACY_FILES.size).toBe(0)
  })
})
