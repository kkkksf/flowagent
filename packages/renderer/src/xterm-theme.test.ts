import { describe, expect, it } from 'vitest'
import { PALETTES, xtermTheme } from './themes.js'

describe('xtermTheme', () => {
  it('背景/前景/光标取自色板，双主题切换值不同', () => {
    const d = xtermTheme('dark'); const l = xtermTheme('light')
    expect(d.background).toBe(PALETTES.dark.surface0)
    expect(d.foreground).toBe(PALETTES.dark.ink)
    expect(d.cursor).toBe(PALETTES.dark.accent)
    expect(l.background).toBe(PALETTES.light.surface0)
    expect(d.background).not.toBe(l.background)
  })
  it('16 色 + 亮色系齐全（xterm ITheme 必需键）', () => {
    const keys = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
      'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite']
    for (const k of keys) { expect(typeof xtermTheme('dark')[k]).toBe('string') }
  })
})
