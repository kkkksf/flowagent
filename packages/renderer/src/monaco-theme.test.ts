import { describe, expect, it } from 'vitest'
import { PALETTES, monacoThemeData } from './themes.js'

describe('monacoThemeData', () => {
  it('base 与主题匹配，背景取 surface0', () => {
    const d = monacoThemeData('dark'); const l = monacoThemeData('light')
    expect(d.base).toBe('vs-dark'); expect(l.base).toBe('vs')
    expect(d.colors['editor.background']).toBe(PALETTES.dark.surface0)
    expect(l.colors['editor.background']).toBe(PALETTES.light.surface0)
    expect(d.inherit).toBe(true)
  })
  it('rules 前缀无 #（Monaco 要求 6 位 hex 无 #）', () => {
    for (const r of monacoThemeData('dark').rules) expect(r.foreground).not.toContain('#')
  })
})
