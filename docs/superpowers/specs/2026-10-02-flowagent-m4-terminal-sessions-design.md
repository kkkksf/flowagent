# FlowAgent M4 设计规格（终端 + 多会话）

日期：2026-10-02
状态：brainstorming 已逐节确认，待用户审阅
上游 spec：`docs/superpowers/specs/2026-09-28-flowagent-design.md`（总设计）
前置：M3（编辑器 + diff 门）已合并 master（8c09f96），115/115 测试绿

## 1. 目标与范围

M4 交付两块：**内置终端**（node-pty + xterm，分离式——用户自己的 shell，agent
输出留在工具卡片）与**多会话管理**（sessions 目录、下拉列表、新建/切换/删除、
旧单会话自动迁移），外加 token 精确计量与一项 M3 遗留小修。

**范围内**：TerminalService（pty 生命周期 + attach 缓冲协议）、xterm 面板
（可折叠、退出重启）、session-service（list/create/delete/migrate）、
AgentHost.reset 切换机制、provider usage 计量与事件透传、顶栏会话下拉与
token 显示、Monaco URI 按段转义（前置小修）。

**范围外（显式推迟）**：

| 推迟项 | 去向 | 说明 |
|---|---|---|
| 终端多标签/多实例 | 后置 | M4 单终端面板 |
| 终端高度拖拽调节 | 后置 | 固定 220px + 折叠 |
| agent 命令在 pty 执行（总 spec "共用 pty 会话池"的完整形态） | 后置 | M4 采用分离式（B 方案）：agent 输出留在工具卡片 |
| 会话重命名/搜索 | 后置 | 标题=首句摘要前 40 字符 |
| Monaco model dispose、语言 worker 分发、去 commit 镜像、关窗脏检查、大小写折叠、symlink 逃逸 | 继续留档 | 与 M4 无交集 |

**对总 spec 的修订**：§5"agent 的 run_command 在下方真实终端执行；用户共用
同一个 pty 会话池"修订为分离式——终端是用户的，agent 命令维持 exec 工具 +
工具卡片展示（M1 行为）。理由：结构化卡片对 agent 输出更可读，pty 化 agent
执行的协议改动收益边际递减。

## 2. 技术选型

- **终端**：main 进程 node-pty（Windows 首选 pwsh、回退 powershell）+
  renderer xterm.js + @xterm/addon-fit。原生模块 ABI 风险以 Task 1 spike
  首先验证；失败切 `@homebridge/node-pty-prebuilt-multiarch`（API 兼容）；
  两者皆败则按方案 2（管道模拟）记档降级并视为 M4 阻断。
  否决：child_process 管道（无 ANSI/TUI 语义）、外部终端按钮（非内置）。
- **会话**：`.flowagent/sessions/<时间戳-4位随机>.jsonl` 一文件一会话；
  元数据（标题/时间）从文件内容推导，无索引文件。
  否决：sessions.json 索引（多一个一致性维护点）、SQLite（重量级）。

## 3. 终端子系统

### 3.1 main 侧 TerminalService（新文件，pty 工厂注入，纯逻辑可测）

```typescript
export interface PtyLike { write(d: string): void; resize(c: number, r: number): void; kill(): void;
  onData(cb: (d: string) => void): void; onExit(cb: () => void): void }
export class TerminalService {
  constructor(deps: { spawnPty(o: { cwd: string; cols: number; rows: number }): PtyLike
    onChunk(d: string): void; onExit(): void })
  start(cwd: string): void
  write(data: string): void
  resize(cols: number, rows: number): void
  attach(cols: number, rows: number): string  // renderer 就绪握手：返回缓冲（64KB 滚动窗口），此后转推送
  kill(): void
  restart(): void                             // 供 UI「重启」按钮：kill + start；已 attach 则继续推送，缓冲窗口同步重置（供未来重连回放）
}
```

- **启动竞态预防**：pty 在窗口创建后即启动，输出先缓冲；renderer 面板挂载
  后 `fa.term.attach(cols, rows)` 取回缓冲并转实时推送（沿用 M3 ready-ping
  经验，开头不丢）。
- IPC：`fa.term.write/resize/attach/restart`（invoke）；事件
  `{type:'term-data'; data: string}` 与 `{type:'term-exit'}`。

### 3.2 renderer 侧 TerminalPanel

- xterm.js + addon-fit；`onData → fa.term.write`；ResizeObserver →
  `fa.term.resize`；`term-data` 订阅经 App 事件总路由分发。
- 面板头部「终端」+ 折叠按钮（收起 28px）；折叠**不杀 pty**（后台继续，
  展开状态还在）。
- `term-exit` → 面板定格「终端已退出 · [重启]」→ `fa.term.restart`。

## 4. 多会话

### 4.1 文件布局与迁移（main/src/session-service.ts，纯逻辑可测）

```
<工作区>/.flowagent/sessions/*.jsonl    ← 首次启动：旧 session.jsonl 迁入后删除
```

```typescript
export interface SessionMeta { file: string; title: string; mtimeMs: number }
listSessions(dir): SessionMeta[]    // title = 首条 user 消息前 40 字符，无则 '(空会话)'
createSession(dir): SessionMeta
deleteSession(dir, file): void      // 当前活动会话由调用方/UI 保证不可删
migrateLegacy(dir): string | null   // 同名冲突加后缀重试一次
```

### 4.2 切换机制

- `AgentHost.reset(): void`——清空 agent 实例与 pendingHistory；running 时
  抛错（UI 下拉禁用为第一道防线）。
- 编排（index.ts）：`host.reset()` → 更新当前 `sessionFile`（可变变量，
  `buildRealAgent` 闭包读取）→ `host.loadSession(新文件历史)` → 下次 send
  惰性重建即绑定新 store 文件。
- IPC：`fa.session.list/new/switch/delete`；切换后 emit `history` +
  `{type:'session-changed'; file}`。

### 4.3 UI（聊天面板顶栏）

会话下拉（当前 title + ▾）：列表项（title + 相对时间 + 悬停 🗑，当前项置灰
不可删）、底部「+ 新会话」；删除经 `confirm`；agent 运行中整体禁用；启动
恢复 mtime 最新会话。

## 5. token 精确计量

- provider 请求体加 `stream_options: { include_usage: true }`；解析末 chunk
  的 usage（choices 空数组）产出新 `ProviderEvent {type:'usage';
  promptTokens; completionTokens}`；端点不支持则不产出（UI 显示"—"）。
- **单次请求的 usage 已含全部历史**：累计取最后一条 usage 覆盖式记录，
  不逐条相加。
- 透传链：`ProviderEvent → AgentEvent → FaEvent 'usage' → chat-store
  usage 字段覆盖`；顶栏灰字 `12.3k / 4.5k tokens`（prompt/completion）；
  切会话随 history 重置。

## 6. 布局整合与前置小修

- 中间列拆上下：EditorArea（flex:1）+ TerminalPanel（220px，可折叠 28px）；
  终端折叠状态在 App useState（与文件树同款）。
- 事件总路由扩展：term-data/term-exit → 终端订阅；usage → chat-store；
  session-changed → 顶栏。
- 前置小修：MonacoPane URI 按段 `encodeURIComponent`
  （`path.split('/').map(encodeURIComponent).join('/')`）。
- `win.on('closed')` 追加 `terminalService.kill()`。

## 7. 错误处理

| 场景 | 行为 |
|---|---|
| node-pty 加载失败 | Task 1 spike 暴露；切预编译变体；再败按方案 2 记档（M4 阻断项） |
| shell 退出/崩溃 | term-exit → 面板定格 + 重启按钮（kill 残句柄 + 重起 + 回放横幅） |
| renderer 未就绪的 pty 输出 | attach 缓冲回放（64KB 滚动窗口） |
| 运行中切/删会话 | UI 禁用 + host.reset() 抛错双保险 |
| 删除当前会话 | UI 不提供入口（🗑 置灰） |
| 迁移同名冲突 | 加后缀重试一次 |
| 会话文件损坏 | repairDanglingToolCalls + JSONL 坏行跳过（既有） |
| usage 缺失 | 顶栏"—"，无报错 |
| 切会话对编辑器/终端 | 无影响（编辑器标签跨会话共享；终端全局单实例） |

## 8. 测试策略

| 层 | 测什么 | 手法 |
|---|---|---|
| agent-core | usage 解析（带/不带 usage 的 SSE）、请求体含 stream_options | vitest 假 fetch |
| main/TerminalService | attach 缓冲回放、write/resize 透传、exit、restart | vitest + 假 pty 工厂 |
| main/session-service | list/create/delete/migrate、title 提取 | vitest + 临时目录 |
| main/AgentHost | reset 清态、running 抛错、切换后 send 绑定新会话 | vitest（既有手法） |
| renderer/chat-store | usage 覆盖累计、会话切换 history 替换 | vitest 喂事件 |
| xterm/组件 | 不测渲染 | — |
| pty 真实加载 | dev 起 pty 收到横幅 | Task 1 spike + 手动冒烟 |

测试命令：`pnpm -r test`（当前基线 115/115）。

## 9. 验收清单（M4 完成的定义）

- [ ] 下方终端：可输入、颜色/TUI 正常、可折叠（后台继续）、退出可重启
- [ ] 终端随工作区启动，cwd 正确，关窗干净退出
- [ ] 会话：新建/切换/删除（带确认）、下拉列表、启动恢复最近会话
- [ ] 旧 session.jsonl 自动迁移，历史完整可续聊
- [ ] 切换会话对话流正确替换；agent 运行中不可切/删
- [ ] 顶栏真实 token 用量（不支持时"—"）
- [ ] Monaco `#`/`?` 文件名前置小修落地
- [ ] `pnpm -r test` 全绿
