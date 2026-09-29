// 统一审批出口：diff 按钮条与聊天卡快路径共用。spec §7：用户未保存修改永远优先，
// 脏标签存在时允许按钮不发 allow（main/AgentHost 不感知编辑器状态）
export function makeApprovalGuard(deps: {
  hasDirtyTab(path: string): boolean
  respond(id: string, allow: boolean): void
  notify(msg: string): void
}): (id: string, allow: boolean, path?: string) => boolean {
  return (id, allow, path) => {
    if (allow && path && deps.hasDirtyTab(path)) {
      deps.notify(`该文件有未保存的修改，请先处理：${path}`)
      return false
    }
    deps.respond(id, allow)
    return true
  }
}
