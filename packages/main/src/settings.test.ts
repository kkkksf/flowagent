import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSettings, saveSettings } from './settings.js'

describe('settings', () => {
  it('returns null workspace when file missing', () => {
    expect(loadSettings(join(mkdtempSync(join(tmpdir(), 'fa-')), 'settings.json'))).toEqual({ workspaceRoot: null })
  })
  it('roundtrips workspace root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fa-'))
    const file = join(dir, 'settings.json')
    saveSettings(file, { workspaceRoot: 'E:/play' })
    expect(loadSettings(file)).toEqual({ workspaceRoot: 'E:/play' })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ workspaceRoot: 'E:/play' })
  })
  it('falls back to null on corrupt json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fa-'))
    const file = join(dir, 'settings.json')
    saveSettings(file, { workspaceRoot: 'E:/play' })
    writeFileSync(file, '{broken', 'utf8')
    expect(loadSettings(file)).toEqual({ workspaceRoot: null })
  })
})
