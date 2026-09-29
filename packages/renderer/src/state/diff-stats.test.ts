import { describe, expect, it } from 'vitest'
import { diffStats } from './diff-stats.js'

describe('diffStats', () => {
  it('covers write-new, write-overwrite, edit and missing payload', () => {
    expect(diffStats({ path: 'n.txt', kind: 'write', content: 'a\nb\nc' }, '')).toBe('新文件 · 3 行')
    expect(diffStats({ path: 'o.txt', kind: 'write', content: 'x\ny' }, 'old\nline\nhere')).toBe('覆盖 · +2/−3 行')
    expect(diffStats({ path: 'e.txt', kind: 'edit', oldString: 'foo\nbar', newString: 'baz' }, 'irrelevant')).toBe('替换 1 处 · +1/−2 行')
    expect(diffStats(undefined, 'whatever')).toBe('')
  })
})
