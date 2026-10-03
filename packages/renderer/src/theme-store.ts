import { create } from 'zustand'
import { chromeColors, type ThemeVariant } from './themes.js'

export const THEME_STORAGE_KEY = 'fa-theme'

export function resolveStoredTheme(raw: string | null): ThemeVariant {
  return raw === 'light' ? 'light' : 'dark'
}

function applyTheme(t: ThemeVariant): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = t
  try { localStorage.setItem(THEME_STORAGE_KEY, t) } catch { /* 隐私模式等 */ }
  // 标题栏跟随；fa 在 renderer 测试环境不存在，静默跳过
  const fa = (globalThis as { fa?: { chrome?: { setTheme(c: { color: string; symbolColor: string }): Promise<void> } } }).fa
  if (fa?.chrome) fa.chrome.setTheme(chromeColors(t)).catch(() => {})
}

interface ThemeState {
  theme: ThemeVariant
  init(): void
  setTheme(t: ThemeVariant): void
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: 'dark',
  init: () => {
    // 与 applyTheme 内 setItem 同款 try/catch：隐私模式抛错或无 localStorage（测试环境）时兜底 null → dark
    let raw: string | null = null
    try { raw = localStorage.getItem(THEME_STORAGE_KEY) } catch { /* 隐私模式等 */ }
    const t = resolveStoredTheme(raw)
    set({ theme: t }); applyTheme(t)
  },
  setTheme: (t) => { set({ theme: t }); applyTheme(t) },
}))
