# FlowAgent M3 设计规格（Monaco 编辑器 + diff 确认）

日期：2026-09-29
状态：brainstorming 已逐节确认，待用户审阅
上游 spec：`docs/superpowers/specs/2026-09-28-flowagent-design.md`（总设计）
前置：M2（Electron 壳 + 聊天面板）已合并 master 并推送，80/80 测试绿，真实模型对话验收通过（GLM coding plan）

## 1. 目标与范围

M3 交付编辑器子系统：三栏布局（文件树 / Monaco 多标签编辑器 / 聊天面板），
用户可在应用内直接编辑并保存文件；`write_file`/`edit_file` 的确认门升级为
中间编辑区的 diff 标签页；agent/外部文件变更自动联动已打开的标签。

**范围内**：三栏布局、文件树（懒加载 + 新建/重命名/删除）、多标签 Monaco
编辑（完整编辑能力，Ctrl+S 直接写盘）、diff 确认门、三方冲突处理、
打开文件监视（fs.watch）、M2 遗留前置小修 5 项。

**范围外（显式推迟）**：

| 推迟项 | 去向 | 说明 |
|---|---|---|
| 全工作区 watch（文件树实时刷新） | 后置 | 树有手动刷新按钮；Windows 递归 watch 开销大 |
| 三方合并工具（agent 写入 × 用户脏修改的 merge） | 后置 | M3 策略：拒绝写入 + 模型重试 |
| 稳定 item id | M4 | M3 无插入型 UI（diff 是追加型标签） |
| chat-store 纯 reducer 重构（删 commit 镜像） | 后置 | 无用户可见影响 |
| 重试语义统一 | 后置 | 体验小项 |
| 终端面板（xterm）、会话列表 | M4 | 总 spec 既定 |

**对 M2 spec 的修订**：diff 确认门从"审批卡片内嵌 Monaco DiffEditor"改为
"审批卡（紧凑统计行）+ 中间编辑区 diff 标签页"——聊天面板宽度有限，
diff 在主区域才可读（对齐 Cursor/Trae 的布局习惯）。其余 M2 行为不变。

## 2. 技术选型

- **Monaco**：`monaco-editor` 官方 npm 包本地集成，ESM import，worker 用
  Vite 原生 `?worker` 配置。零外链（离线可用，不受网络波动影响）；
  编辑区 React.lazy 按需加载（首次 ~1-2s，聊天面板不受影响）。
  否决：`@monaco-editor/react`（默认 CDN loader，国内网络不可靠）、
  CodeMirror 6（diff 能力与 VSCode 体验不及，spec 明确 Monaco）。
- **文件操作架构**：main 进程新增 `file-service.ts`，全部文件操作走 IPC
  `fa:fs:*`，路径安全复用 agent-core 的 workspace jail（导出
  `resolveInWorkspace`）——UI 与 agent 共用同一条安全边界。
  否决：renderer 开 nodeIntegration（违反安全基线）、复用 agent fsTools
  伪装 tool call（搅乱 approve 门与事件流语义）。

## 3. 布局与编辑器子系统

```
+--------+---------------------------+---------------+
| 文件树  |  编辑区（Monaco 多标签）     |  聊天面板      |
| 240px  |  ┌─[a.py][b.ts][diff]+┐   |  （M2 现状）   |
| 可折叠  |  │  Editor / DiffEditor │   |               |
+--------+---------------------------+---------------+
```

- **renderer 新增 `editor-store.ts`**（zustand，与 chat-store 并列）：
  `tabs: EditorTab[]`、`activeTabId`、`dirty: Set<tabId>`；
  `EditorTab = { id; kind: 'file'; path; knownMtime } | { id; kind: 'diff'; approvalId; path; original; modified; resolved }`。
  同一文件只允许一个标签（重复打开激活已有）。
- **`FileTree.tsx`**：懒加载目录（点击展开才读）；右键菜单（新建文件/
  文件夹、重命名、删除）；删除需确认弹窗（目录递归删）；手动刷新按钮；
  agent 新建/修改的文件名旁小圆点提示（数据来自 tool-result 事件）。
- **`EditorArea.tsx`**：React.lazy 加载 Monaco；文件标签用多 model 复用
  （切标签不重建实例）；diff 标签 = 只读 DiffEditor + 顶部
  「✓ 允许 / ✗ 拒绝 / ✓ 允许且本会话不再询问」按钮条，处理后定格。
- **联动**：点工具卡片中的文件路径 → 打开对应标签；tool-result 后该文件
  已打开则刷新（脏修改走第 7 节冲突流程）。agent 新建/修改的文件，其路径
  从 `tool-call` 事件的 `call.arguments` JSON 解析（write/edit 必有 path
  字段），供文件树小圆点与联动刷新使用。
- **收尾**：标签 ×/中键关闭（脏时确认）；Ctrl+S 保存当前标签；无标签时
  显示欢迎页（最近打开列表）。

## 4. agent-core 接口变更（M3 唯一）

```typescript
export interface ApprovalPayload {
  path: string
  kind: 'write' | 'edit' | 'run'
  content?: string     // write_file 全文
  oldString?: string   // edit_file 原
  newString?: string   // edit_file 新
}
// ToolContext.approve 增加可选第三参（两参调用方全部兼容）
approve(action: string, detail: string, payload?: ApprovalPayload): Promise<boolean>
```

fs 工具调用时携带结构化载荷（`run_command` 无 payload）。纯数据可序列化，
不破坏 core 零 UI 依赖。

`tools/fs.ts` 的路径校验逻辑导出为
`resolveInWorkspace(root, userPath): string`（越界抛错），file-service 与
agent 工具共用。

## 5. FileService 与 IPC 协议

main 侧 `file-service.ts`（纯逻辑可单测，全部先过 jail）：

```typescript
read(path): Promise<{ content: string; mtimeMs: number }>
list(path): Promise<FileEntry[]>            // {name, isDir}，类型+名称排序
createFile(path) / createDir(path)
renamePath(from, to)
deletePath(path)                            // 目录递归删（UI 已确认）
write(path, content, expectedMtimeMs?)      // CAS：mtime 不符拒绝并返回冲突标记
watchFile(path) / unwatchFile(path)         // fs.watch → file-changed 事件
```

`FaApi` 新增：`fa.fs.read/list/create/rename/delete/write/watch/unwatch`。
`FaEvent` 新增：`{ type: 'file-changed'; path: string }`；
`approval-required` 事件透传 `payload?: ApprovalPayload`。

## 6. diff 确认门交互流

```
core 的 approve(action, detail, payload) 触发
  → AgentHost 挂起，发 approval-required（带 payload）
  → 聊天面板紧凑审批卡：路径 + 统计行
      edit_file：替换 N 处 · +A/−B 行；write_file：新文件 N 行 / 覆盖 +A/−B 行
      卡片保留 [允许] [拒绝] 快路径小按钮
  → 点「查看 diff」→ editor-store 开 diff 标签：
      original = read(path).content（新文件为空串）
      modified = payload.content（write）或 old→new 应用后的预览（edit）
  → 按钮条三选一 → fa.respondApproval → approval-resolved → diff 标签与
    聊天卡片同步定格
  → 允许 → core 落盘 → tool-result → 已打开标签刷新
```

- 审批卡内嵌文本预览退役（M2 的 2000 字符方案），预览职责全归 diff 标签。
- 同时至多一个待审批（core 串行保证），无需排队 UI。
- 停止/关窗：沿用 M2 语义（挂起审批按拒绝收场，diff 标签定格「已拒绝」）。
- 允许落盘前的并发保护见第 7 节第 2 行。

## 7. 三方冲突处理

原则：**用户的未保存修改永远优先，绝不静默覆盖**。

| 场景 | 触发 | 行为 |
|---|---|---|
| 脏修改 × 外部改动 | file-changed | 标签头黄色冲突态 + 编辑器横幅：「文件已在磁盘上更改 — [保留我的版本] [加载磁盘版本]」；不自动重载 |
| 脏修改 × agent 写入 | 允许按钮点击时 | **renderer 侧统一拦截**：diff 按钮条与聊天卡快路径共用同一个 respondApproval 包装——若 editor-store 中该路径存在脏标签 → toast「该文件有未保存的修改，请先处理」且不发送 allow。main/AgentHost 不感知编辑器状态；agent 侧无兜底（用户是唯一防线，符合"未保存优先"原则） |
| 无脏修改 × agent/外部改动 | file-changed / tool-result | 自动重载模型内容 |
| 保存时已被外部改过 | fa.fs.write CAS | mtime 不符拒绝写、返回冲突标记，renderer 弹同款横幅 |
| agent 运行中手动保存 | 正常保存 | last-write-wins；agent 下轮 read_file 看到新内容 |

版本追踪：`knownMtime`（标签打开时的 mtimeMs），所有判断基于此。
边界：watch 报错（目录被删/改名）→ 关标签 + toast；不做恢复。

## 8. 前置小修（M3 计划 Task 1）

1. `edit_file` 审批预览统一（随 approve 载荷扩展自然解决）。
2. 悬空 toolCalls 会话修复：load 后发现 assistant 带 toolCalls 但缺对应
   tool 消息 → 补合成 `error: interrupted` 工具结果（防下次 provider 400）。
3. 导航守卫：`setWindowOpenHandler` + `will-navigate` → `shell.openExternal`。
4. 运行中 F5：`AgentHost.loadSession` 在 running 期间暂存 pendingHistory。
5. `AgentLike` 注释「approve 串行」契约。

## 9. 测试策略

agent-core 假 provider 单测为主力，Electron 层纯逻辑可测（沿用 M2 原则）：

| 层 | 测什么 |
|---|---|
| agent-core | approve 三参载荷（fs 工具传 payload）、悬空 toolCalls 修复、resolveInWorkspace 导出与越界拒绝 |
| main/file-service | 读写/建删改名、路径逃逸拒绝、watch 事件转发、CAS 写冲突 |
| main/agent-host | payload 透传、运行中 loadSession 暂存、mtime 冲突拒绝路径 |
| renderer/editor-store | 标签生命周期（开/关/去重/激活）、diff 标签状态机、冲突态判定、file-changed 处理 |
| Monaco 组件 | 不测渲染（薄壳） |

测试命令：`pnpm -r test`（vitest run）。

## 10. 验收清单（M3 完成的定义）

- [ ] 三栏布局：文件树（懒加载+右键全操作）/ 多标签编辑器 / 聊天面板
- [ ] 编辑器可编辑可保存（Ctrl+S），脏标记正确
- [ ] 文件树新建/重命名/删除真实生效，删除有确认
- [ ] write_file/edit_file 审批 → diff 标签红绿对照 → 允许落盘 → 打开标签自动刷新
- [ ] 审批卡快路径（不进 diff 直接允许/拒绝）仍可用
- [ ] 外部改文件：无脏自动重载；有脏出冲突横幅二选一
- [ ] 路径逃逸（UI 侧 `..\`）被拒绝
- [ ] 点工具卡片文件路径跳转打开标签
- [ ] 前置小修 5 项落地
- [ ] `pnpm -r test` 全绿
