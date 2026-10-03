export type ThemeVariant = 'dark' | 'light'

export interface Palette {
  surface0: string; surface1: string; surface2: string; surface3: string
  borderSubtle: string; border: string
  ink: string; inkSecondary: string; inkFaint: string
  accent: string; accentHover: string; textOnAccent: string
  success: string; danger: string; warning: string; diffAdded: string; diffRemoved: string
}

// 与 index.css @theme / :root[data-theme='light'] 逐值一致（单一事实源的本体）
export const PALETTES: Record<ThemeVariant, Palette> = {
  dark: {
    surface0: '#0e0f11', surface1: '#16181b', surface2: '#1d2023', surface3: '#25292d',
    borderSubtle: '#26292d', border: '#33373c',
    ink: '#ececf1', inkSecondary: '#a5a9b3', inkFaint: '#6b7078',
    accent: '#7da2f7', accentHover: '#9db9f9', textOnAccent: '#ffffff',
    success: '#4cc38a', danger: '#ef6b7d', warning: '#e0a458',
    diffAdded: '#3fb27f', diffRemoved: '#e5617c',
  },
  light: {
    surface0: '#ffffff', surface1: '#f7f7f8', surface2: '#f0f1f2', surface3: '#e8e9eb',
    borderSubtle: '#e8e9eb', border: '#d5d7da',
    ink: '#1a1c1f', inkSecondary: '#565b64', inkFaint: '#8a9099',
    accent: '#3358d4', accentHover: '#2747b8', textOnAccent: '#ffffff',
    success: '#1c7c4d', danger: '#c03550', warning: '#8f6a2f',
    diffAdded: '#1a7f4b', diffRemoved: '#b3364e',
  },
}

export function chromeColors(v: ThemeVariant): { color: string; symbolColor: string } {
  const p = PALETTES[v]
  return { color: p.surface0, symbolColor: p.ink }
}

export function xtermTheme(v: ThemeVariant): Record<string, string> {
  const p = PALETTES[v]
  const dark = v === 'dark'
  return {
    background: p.surface0, foreground: p.ink, cursor: p.accent,
    cursorAccent: p.surface0,
    selectionBackground: dark ? '#7da2f740' : '#3358d433',
    black: dark ? '#1d2023' : '#3a3d42', red: p.danger, green: p.success,
    yellow: p.warning, blue: p.accent, magenta: dark ? '#b58cf0' : '#7a4fd1',
    cyan: dark ? '#6cc4d4' : '#2a7d8f', white: dark ? '#a5a9b3' : '#565b64',
    brightBlack: dark ? '#6b7078' : '#8a9099', brightRed: p.danger,
    brightGreen: p.success, brightYellow: p.warning, brightBlue: p.accentHover,
    brightMagenta: dark ? '#c9aaf5' : '#6641c4', brightCyan: dark ? '#93d8e5' : '#1f6675',
    brightWhite: p.ink,
  }
}

export function monacoThemeData(v: ThemeVariant): { base: 'vs-dark' | 'vs'; inherit: true; rules: { token: string; foreground: string; fontStyle?: string }[]; colors: Record<string, string> } {
  const p = PALETTES[v]
  const hex = (s: string): string => s.replace('#', '')
  return {
    base: v === 'dark' ? 'vs-dark' : 'vs', inherit: true,
    rules: [
      { token: 'comment', foreground: hex(p.inkFaint), fontStyle: 'italic' },
      { token: 'string', foreground: hex(p.diffAdded) },
      { token: 'keyword', foreground: hex(p.accent) },
      { token: 'number', foreground: hex(p.success) },
      { token: 'type', foreground: hex(p.accentHover) },
      { token: 'function', foreground: hex(p.ink) },
    ],
    colors: {
      'editor.background': p.surface0,
      'editor.foreground': p.ink,
      'editorLineNumber.color': p.inkFaint,
      'editorLineNumber.activeForeground': p.inkSecondary,
      'editor.selectionBackground': v === 'dark' ? '#7da2f740' : '#3358d433',
      'editor.lineHighlightBackground': p.surface1,
      'editorIndentGuide.background1': p.surface3,
      'diffEditor.insertedTextBackground': v === 'dark' ? '#3fb27f26' : '#1a7f4b20',
      'diffEditor.removedTextBackground': v === 'dark' ? '#e5617c26' : '#b3364e20',
      'editorGutter.background': p.surface0,
    },
  }
}
