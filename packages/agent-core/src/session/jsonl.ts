import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import type { SessionRecord, SessionStore } from '../types.js'

export class JsonlSessionStore implements SessionStore {
  constructor(private filePath: string) {}

  append(event: SessionRecord): void {
    appendFileSync(this.filePath, JSON.stringify(event) + '\n', 'utf8')
  }

  load(): SessionRecord[] {
    if (!existsSync(this.filePath)) return []
    const lines = readFileSync(this.filePath, 'utf8').split('\n')
    const out: SessionRecord[] = []
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        out.push(JSON.parse(line) as SessionRecord)
      } catch {
        // 崩溃残留的半行，跳过（留 warn 痕迹便于排查会话文件损坏）
        console.warn(`skipped corrupt session line: ${line.slice(0, 80)}`)
      }
    }
    return out
  }
}

export class NullSessionStore implements SessionStore {
  append(_event: SessionRecord): void {}
  load(): SessionRecord[] {
    return []
  }
}
