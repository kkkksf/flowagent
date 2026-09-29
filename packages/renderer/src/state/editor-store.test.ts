import { describe, expect, it } from 'vitest'
import { createEditorStore, buildDiffModified } from './editor-store.js'
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
})
