import { describe, expect, it } from 'vitest'
import { PALETTES, chromeColors } from './themes.js'
import { resolveStoredTheme, THEME_STORAGE_KEY } from './theme-store.js'

describe('resolveStoredTheme', () => {
  it('合法值透传', () => {
    expect(resolveStoredTheme('dark')).toBe('dark')
    expect(resolveStoredTheme('light')).toBe('light')
  })
  it('null / 非法值兜底 dark', () => {
    expect(resolveStoredTheme(null)).toBe('dark')
    expect(resolveStoredTheme('darkk')).toBe('dark')
    expect(resolveStoredTheme('')).toBe('dark')
  })
})

describe('palette 一致性', () => {
  it('双主题 17 项全定义且 chromeColors 取 surface0/ink', () => {
    for (const v of ['dark', 'light'] as const) {
      const p = PALETTES[v]
      expect(Object.keys(p).length).toBe(17)
      for (const val of Object.values(p)) expect(val).toMatch(/^#[0-9a-f]{6}$/)
      expect(chromeColors(v)).toEqual({ color: p.surface0, symbolColor: p.ink })
    }
  })
  it('storage key 稳定', () => expect(THEME_STORAGE_KEY).toBe('fa-theme'))
})
