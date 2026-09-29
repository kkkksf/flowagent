import { describe, expect, it } from 'vitest'
import { createEditorStore, buildDiffModified, normalizePath } from './editor-store.js'
import { makeApprovalGuard } from './approval-guard.js'

describe('editor store', () => {
  it('openFile dedupes and activates', () => {
    const s = createEditorStore().getState()
    const a = s.openFile('a.txt', 'x', 1)
    const b = s.openFile('b.txt', 'y', 2)
    const a2 = s.openFile('a.txt', 'x', 1)
    expect(a2).toBe(a)
    expect(s.tabs.map((t) => (t.kind === 'file' ? t.path : t.kind))).toEqual(['a.txt', 'b.txt'])
    expect(s.activeTabId).toBe(a)
    expect(s.recentPaths).toEqual(['a.txt', 'b.txt'])
  })
  it('dirty flow: updateContent marks dirty, markSaved clears', () => {
    const s = createEditorStore().getState()
    const id = s.openFile('a.txt', 'x', 1)
    s.updateContent(id, 'x2')
    expect(s.hasDirtyTab('a.txt')).toBe(true)
    s.markSaved(id, 5)
    expect(s.hasDirtyTab('a.txt')).toBe(false)
  })
  it('reloadContent updates content; conflict flag settable', () => {
    const s = createEditorStore().getState()
    const id = s.openFile('a.txt', 'x', 1)
    s.reloadContent(id, 'y', 2)
    expect((s.tabs[0] as { content: string }).content).toBe('y')
    s.setConflict(id, true)
    expect((s.tabs[0] as { conflict: boolean }).conflict).toBe(true)
  })
  it('diff tab lifecycle', () => {
    const s = createEditorStore().getState()
    const id = s.openDiff('ap1', 'a.txt', 'old', 'new')
    expect(s.tabs[0]).toMatchObject({ kind: 'diff', approvalId: 'ap1', resolved: null })
    s.resolveDiff('ap1', true)
    expect((s.tabs[0] as { resolved: string }).resolved).toBe('allowed')
    expect(s.activeTabId).toBe(id)
  })
  it('agentTouched dot lifecycle', () => {
    const s = createEditorStore().getState()
    s.markAgentTouched('n.txt')
    expect(s.agentTouched).toEqual(['n.txt'])
    s.clearAgentTouched('n.txt')
    expect(s.agentTouched).toEqual([])
  })
  it('buildDiffModified applies edit payload', () => {
    expect(buildDiffModified({ path: 'a', kind: 'write', content: 'W' }, 'O')).toBe('W')
    expect(buildDiffModified({ path: 'a', kind: 'edit', oldString: 'b', newString: 'c' }, 'aba')).toBe('aca')
  })
  it('normalizePath trims and converts backslashes to slashes', () => {
    expect(normalizePath('  src\\a.txt ')).toBe('src/a.txt')
    expect(normalizePath('src/a.txt')).toBe('src/a.txt')
  })
  it('backslash and slash forms address the same tab (dedupe + dirty guard)', () => {
    const s = createEditorStore().getState()
    const id = s.openFile('src\\a.txt', 'x', 1)
    expect(s.openFile('src/a.txt', 'x', 1)).toBe(id) // spec §3：一文件一标签，反斜杠变体不去重出新标签
    s.updateContent(id, 'x2')
    expect(s.hasDirtyTab('src/a.txt')).toBe(true) // spec §7：脏守卫两种书写都命中
    expect(s.hasDirtyTab('src\\a.txt')).toBe(true)
  })
  it('agentTouched dot identity survives separator variants', () => {
    const s = createEditorStore().getState()
    s.markAgentTouched('src\\n.txt')
    expect(s.agentTouched).toEqual(['src/n.txt']) // 树节点用 '/'，圆点才能点亮
  })
  it('only clearAgentTouched removes the dot; tab lifecycle keeps it', () => {
    // spec §3：圆点保留到用户打开文件——标签生命周期动作（含 tool-result 的 reloadContent 路径）都不清圆点
    const s = createEditorStore().getState()
    s.markAgentTouched('n.txt')
    const id = s.openFile('n.txt', 'x', 1)
    s.updateContent(id, 'x2')
    s.markSaved(id, 5)
    s.reloadContent(id, 'x3', 6)
    s.openDiff('ap1', 'n.txt', 'a', 'b')
    expect(s.agentTouched).toEqual(['n.txt'])
    s.clearAgentTouched('n.txt')
    expect(s.agentTouched).toEqual([])
  })
})

describe('approval guard', () => {
  it('blocks allow on dirty tab and notifies', () => {
    const responded: [string, boolean][] = []
    const notices: string[] = []
    const guard = makeApprovalGuard({
      hasDirtyTab: (p) => p === 'a.txt',
      respond: (id, allow) => { responded.push([id, allow]) },
      notify: (m) => { notices.push(m) },
    })
    expect(guard('ap1', true, 'a.txt')).toBe(false)
    expect(responded).toEqual([])
    expect(notices[0]).toContain('a.txt')
    expect(guard('ap1', true, 'b.txt')).toBe(true)   // 非脏照常放行
    expect(guard('ap1', false, 'a.txt')).toBe(true)  // 拒绝永不需要守卫
    expect(responded).toEqual([['ap1', true], ['ap1', false]])
  })
  it('setAutoApprove engages only after the approval actually went through (DiffPane ordering)', () => {
    // DiffPane 第三按钮的组合：if (requestApproval(...)) setAutoApprove(true)
    const responded: [string, boolean][] = []
    const autoApprove: boolean[] = []
    const guard = makeApprovalGuard({
      hasDirtyTab: (p) => p === 'a.txt',
      respond: (id, allow) => { responded.push([id, allow]) },
      notify: () => {},
    })
    const clickAllowAndSkip = (id: string, path: string): void => {
      if (guard(id, true, path)) autoApprove.push(true) // 假 setAutoApprove：只在放行后调用
    }
    clickAllowAndSkip('ap1', 'a.txt') // 脏标签被拦：审批未发出，不得进入自动批准
    expect(autoApprove).toEqual([])
    expect(responded).toEqual([])
    clickAllowAndSkip('ap2', 'b.txt') // 放行：审批已发出，随后才 setAutoApprove
    expect(autoApprove).toEqual([true])
    expect(responded).toEqual([['ap2', true]])
  })
})
