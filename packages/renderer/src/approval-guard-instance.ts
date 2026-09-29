import { fa } from './api/fa.js'
import { useEditorStore } from './editor-store-instance.js'
import { makeApprovalGuard } from './state/approval-guard.js'

export const requestApproval = makeApprovalGuard({
  hasDirtyTab: (p) => useEditorStore.getState().hasDirtyTab(p),
  respond: (id, allow) => { void fa.respondApproval(id, allow) },
  notify: (msg) => { useEditorStore.getState().setNotice(msg) },
})
