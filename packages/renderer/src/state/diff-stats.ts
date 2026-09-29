import type { ApprovalPayload } from '../../../main/src/protocol.js'

export function diffStats(payload: ApprovalPayload | undefined, original: string): string {
  if (!payload) return ''
  const lines = (s: string): number => s.split('\n').length
  if (payload.kind === 'write') {
    return original === '' ? `新文件 · ${lines(payload.content ?? '')} 行` : `覆盖 · +${lines(payload.content ?? '')}/−${lines(original)} 行`
  }
  return `替换 1 处 · +${lines(payload.newString ?? '')}/−${lines(payload.oldString ?? '')} 行`
}
