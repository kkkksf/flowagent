# FlowAgent M2 设计规格（Electron 壳 + 聊天面板）

日期：2026-09-28
状态：brainstorming 已逐节确认，待用户审阅
上游 spec：`docs/superpowers/specs/2026-09-28-flowagent-design.md`（总设计）
前置：M1（agent-core 命令行可用）已完成，55/55 测试通过

## 1. 目标与范围

M2 交付一个 Electron 桌面应用：图形界面里与 agent 流式对话，工具调用渲染为
可折叠卡片，写文件/执行命令经过简易审批卡片确认，会话关闭重开自动恢复。

**范围内**：Electron 主进程 + React 聊天界面 + IPC 事件桥 + 简易审批门 +
单会话自动恢复 + 首次启动工作区选择。

**范围外（显式推迟）**：

| 推迟项 | 去向 | 说明 |
|---|---|---|
| Monaco diff 预览、文件树、标签页 | M3 | 审批卡片 M2 只显示纯文本参数 |
| 多会话列表、重命名、搜索 | M4 | M2 每工作区单会话文件 |
| 顶栏 token 用量显示 | M4 | M2 顶栏只显示工作区名 + 模型名 |
| model profile 切换 | 后置 | M2 单模型，环境变量配置 |
| 设置面板 | 后置 | M2 读环境变量，与 CLI 一致 |
| xterm 终端面板 | M4 | `run_command` 结果显示在工具卡片内 |
| CLI stdin 关闭崩溃修复 | backlog | 管道输入 `ERR_USE_AFTER_CLOSE`，不影响交互使用 |

## 2. 技术选型

**Electron + electron-vite + React + zustand + react-markdown，全 TypeScript。**

- `electron-vite`：main / preload / renderer 三构建目标开箱即用，renderer 有
  HMR（M2 是界面密集开发，热更新收益最大；运行时重量与构建工具无关，
  已与用户澄清）。
- 曾评估并否掉：纯 tsc/esbuild 手工搭（省一个 devDependency 但无 HMR、
  配置易踩坑）；Electron Forge（M2 不需要打包分发能力）；浏览器版
  （dsh 模式，用户明确选择桌面应用方向）。

**Electron 安全基线（强制）**：

- `contextIsolation: true`，`nodeIntegration: false`。
- preload 仅通过 `contextBridge` 暴露 `fa` 命名空间，不漏 `require`/`ipcRenderer`。
- renderer 永不直接 import `agent-core`；`agent-core` 永不 import Electron/React。

## 3. 包结构与分层

```
packages/
├── agent-core/          # M1 产物，本里程碑仅做前置修复（见 §8），架构不动
├── main/                # 新增：Electron 主进程
│   └── src/
│       ├── index.ts         # app 生命周期、创建窗口、工作区选择
│       ├── agent-host.ts    # AgentHost：持有 Agent，订阅事件流，转发 IPC，审批门
│       ├── settings.ts      # 工作区记忆（userData/settings.json）
│       └── preload.ts       # contextBridge 暴露 window.fa
└── renderer/            # 新增：React 界面
    └── src/
        ├── App.tsx
        ├── api/fa.ts        # window.fa 的 typed 封装
        ├── state/           # zustand store：事件归并
        └── components/      # ChatPanel / MessageItem / ToolCard / ApprovalCard / Composer
```

单向依赖：renderer → main → agent-core，反向禁止。

**AgentHost 是 M2 核心新类**：把 `agent-core` 异步事件流翻译成 IPC 推送；
确认门通过 Promise 挂起等 renderer 回应；实现 `agent.stop()` 转发；
持有「本次会话不再询问」状态。

## 4. 关键决策记录

1. **审批门形态**：简易卡片——工具名 + 关键参数纯文本（`write_file` 显示
   路径 + 内容文本框预览，`run_command` 显示命令行），「允许/拒绝」按钮 +
   「本次会话不再询问」勾选（总 spec 4.3 要求）。Monaco diff 属于 M3。
2. **工作区**：首次启动 `dialog.showOpenDialog` 选文件夹，选择后写入
   `app.getPath('userData')/settings.json`；下次启动直接使用。
3. **模型配置**：环境变量 `FLOWAGENT_BASE_URL` / `FLOWAGENT_API_KEY` /
   `FLOWAGENT_MODEL`（与 CLI 完全一致），设置面板后置。
4. **会话**：单会话自动恢复。文件沿用 M1 约定
   `<工作区>/.flowagent/session.jsonl`，所有记录追加写单文件（用户已知悉
   并接受；多会话 = 多文件列表属于 M4）。
5. **停止语义**：`agent-core` 的 `stop()` 已存在且有测试（当前工具跑完、
   不发下一轮 LLM 请求），M2 直接复用，核心不改。

## 5. IPC 协议与事件流

```ts
// renderer → main（invoke，请求-响应）
fa.getState()                       // -> { workspaceRoot, model: string|null, autoApproved: boolean }
fa.sendUserMessage(text: string)    // -> void（异步开始一轮 agent.run）
fa.stop()                           // 中断当前循环
fa.respondApproval(id: string, allow: boolean)

// main → renderer（send，统一 onEvent 订阅）
type FaEvent =
  | { type: 'history'; messages: ChatMessage[] }     // 启动/恢复全量
  | { type: 'message-delta'; text: string }          // 流式片段
  | { type: 'assistant-done' }                       // 一条助手消息结束
  | { type: 'tool-call'; call: ToolCall }            // 卡片出现（运行中态）
  | { type: 'tool-result'; id: string; result: string } // 卡片完成态
  | { type: 'approval-required'; id: string; action: string; detail: string }
  | { type: 'agent-idle' }                           // 本轮结束，解锁输入
  | { type: 'error'; message: string }
```

**审批往返时序**：

```
core 的 approve 回调触发
  → main 生成 approvalId，Promise 挂起，发 approval-required
  → renderer 弹 ApprovalCard
  → 用户点击 → fa.respondApproval(id, allow)
  → main resolve 挂起 Promise → core 继续执行 / 收到拒绝文本
```

约束：同一时间最多一个待审批（core 循环串行）；`agent.run` 进行中输入框
禁用并显示停止按钮，`agent-idle` 解锁；`message-delta` 追加到当前气泡，
卡片按 tool call id 归并。

## 6. UI 组件与交互

单列布局（三栏布局属 M3）：极简顶栏（应用名 + 截断的工作区名 + 灰色模型
名）→ 对话流滚动区 → 输入区（多行，Enter 发送 / Shift+Enter 换行，运行中
禁用并显示停止按钮）。

| 组件 | 职责 |
|---|---|
| `ChatPanel` | 滚动区；靠近底部自动跟随滚动，用户上翻停止跟随 |
| `MessageItem` | 用户气泡（纯文本）/ 助手气泡（react-markdown，代码块带语言标签） |
| `ToolCard` | 运行中（转圈）/ 完成（✓ + 摘要 200 字符）/ 失败（✗ + 错误）；点击折叠展开全文 |
| `ApprovalCard` | action + detail 纯文本预览 + 允许/拒绝 + 「本次会话不再询问」；操作后定格为已处理态 |
| `Composer` | 输入与发送/停止切换 |

其他交互：工具卡片按事件顺序内嵌在助手消息流中；`error` 渲染为红色系统条
（非气泡）附「重试上一条」按钮——行为：取历史中最后一条用户消息原文重新
`fa.sendUserMessage`（该条失败轮不进历史，直接重跑）；空状态显示引导文案 +
环境变量检测状态（如 `模型未配置，请设置 FLOWAGENT_* 环境变量后重启`）。

## 7. 错误处理与边界

| 层 | 错误 | 行为 |
|---|---|---|
| provider | 429/4xx/5xx、网络断、流中断 | 抛 `ProviderError`（状态码 + API 原文），禁止静默空响应（前置修复，见 §8） |
| 循环 | provider 抛错 | 指数退避重试 3 次；仍失败 → `error` 事件，历史保持干净 |
| 循环 | 工具参数/执行失败 | 错误文本作为工具结果回给模型，卡片显示 ✗，循环继续 |
| AgentHost | 兜底 | 捕获异常 → `error` 事件；**`agent-idle` 必发**（renderer 靠它解锁） |
| renderer | 刷新/重挂载 | 重新 `getState()` + `history` 全量对齐 |

边界情况：

1. 审批挂起 × 停止 → 自动按「拒绝」resolve + `agent.stop()`。
2. 审批挂起 × 关窗 → 同按「拒绝」resolve 后干净退出。
3. 「不再询问」为 AgentHost 内存态，会话级（跨 run 不重置），重启恢复询问。
4. 会话 JSONL 坏行/截断行 → 跳过 + `console.warn`（截断行 M1 已覆盖）。
5. 环境变量缺失 → `model: null` + 引导文案 + 输入禁用，不白屏。
6. 工作区目录消失 → 重新弹文件夹选择框。
7. 超长工具结果 → 摘要 200 字符，展开看全文。

## 8. 前置修复（agent-core，M2 第一个任务）

M1 演示中实证的缺陷：API 网关/错误端点返回 **HTTP 200 + 非 SSE 响应体**
（如 HTML 拦截页）时，`OpenAICompatProvider.stream` 静默返回空 `result`
而非抛错，循环无声结束（429/5xx 路径已有抛错与重试）。修复：校验响应
`content-type` 含 `text/event-stream`，否则抛含响应体摘录的错误；SSE 流
零数据事件同样抛错。补 vitest 用例（200+HTML、空 SSE 流）。此修复让 M2
的 `error` 事件有真实来源。

## 9. 测试策略

agent-core 假 provider 单测为主力，Electron 层薄验证：

| 层 | 测什么 | 手法 |
|---|---|---|
| agent-core | ProviderError 抛出、流中断不污染历史 | vitest + 假 fetch（§8） |
| main/agent-host | 事件转发顺序、审批 resolve（允许/拒绝/停止按拒绝）、「不再询问」、idle 必发 | vitest + 假 Agent + 假 webContents，**不起 Electron** |
| renderer store | delta 追加、卡片 id 配对、idle 解锁 | vitest 喂事件序列断言 store，不渲染 DOM |
| 组件 | 不测（薄壳，逻辑在 store） | — |
| 冒烟 | 起应用、开窗、IPC 通、真对话一轮 | `pnpm dev` 人工验收清单 |

测试命令：`pnpm -r test`（各包 vitest run）。

## 10. 验收清单（M2 完成的定义）

- [ ] 首次启动弹文件夹选择，重启记住
- [ ] 发消息 → 流式回复 → 工具卡片 → 审批允许后工具真实执行
- [ ] 「不再询问」勾选后本会话直接放行
- [ ] 停止按钮中断循环；审批挂起时停止 = 拒绝
- [ ] 关窗重开会话完整恢复，能接着聊
- [ ] 无 key 显示引导不白屏
- [ ] 余额不足显示红色错误条含 API 原文（不再静默）
