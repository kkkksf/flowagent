import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface AppSettings { workspaceRoot: string | null }

export function loadSettings(file: string): AppSettings {
  if (!existsSync(file)) return { workspaceRoot: null }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as AppSettings
    return typeof parsed.workspaceRoot === 'string' ? parsed : { workspaceRoot: null }
  } catch {
    return { workspaceRoot: null }
  }
}

export function saveSettings(file: string, s: AppSettings): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(s, null, 2), 'utf8')
}
