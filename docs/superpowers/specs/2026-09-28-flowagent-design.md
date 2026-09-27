# FlowAgent 设计规格（Spec）

日期：2026-09-28
状态：头脑风暴中已逐节确认，待用户审阅

## 1. 目的与目标

FlowAgent 是一个桌面端 AI 编程应用，类似 ZCode/Trae：一个能对话、读写文件、
执行命令、自主完成多步任务的 agent，并且**内置文本编辑器**（ZCode 所缺少的
能力）。

两个同等重要的目标：

1. **学习 agent 内部原理** —— 工具调用循环、上下文管理必须是可读、可改的
   独立库。
2. **日常个人使用** —— 稳定、实用，能支撑真实工作。

非目标（v1 不做）：多用户、云端部署、本地模型（Ollama/vLLM）、插件市场、
远程工作区。

## 2. 选定方案

**Electron + React + Monaco + Node，全 TypeScript。**

被否掉的备选：

- *Code-OSS fork*（Trae 的做法）：第一天就有完整 IDE，但 agent 核心被埋进
  扩展体系——学原理效果最差——且长期跟随上游是负担。
- *Tauri + Node sidecar*：体积更小，但多一门 Rust，外加进程管理/打包的坑，
  对学习毫无收益。

## 3. 整体架构

pnpm monorepo，三个包，单向依赖（renderer → main → core，反向禁止）：

```
flowagent/
├── packages/
│   ├── agent-core/        # 纯 TS 库，零 UI/Electron 依赖
│   │   ├── loop.ts        # agent 主循环：LLM ↔ 工具的推理-行动循环
│   │   ├── tools/         # 工具注册表 + 各工具实现
│   │   ├── context/       # 上下文管理：裁剪、压缩
│   │   ├── providers/     # OpenAI 兼容 API 客户端
│   │   └── session/       # 会话持久化（追加写 JSONL）
│   ├── main/              # Electron 主进程：窗口、IPC、node-pty 终端
│   └── renderer/          # React UI：聊天面板 + Monaco + 文件树 + 终端
├── pnpm-workspace.yaml
└── package.json
```

关键决策：

- **agent-core 是第一公民。** 不 import 任何 Electron/React 的东西，输入
  输出全是纯数据（消息、工具调用、事件流）。不启动 Electron 也能用普通
  Node 脚本驱动和测试它。
- **事件流驱动。** core 对外只暴露异步迭代器/事件总线，发出
  `message-delta`、`tool-call`、`tool-result`、`done`。渲染进程通过 IPC
  订阅；流式输出和工具进度都是事件。

## 4. Agent 核心

### 4.1 主循环

```
用户消息 -> 追加历史 -> 调 LLM（流式）
  |- 文本输出 -> 流式推给 UI
  |- tool_calls -> 逐个执行（经过确认门）
                    -> 结果追加历史 -> 再次调 LLM
循环直到模型不再请求工具，或达到步数上限
```

- 默认步数上限 30（可配），防止失控。
- 每轮都是可序列化的状态转移 `(history, model_output) -> history'`，
  任意时刻可存盘、可恢复。

### 4.2 工具集（v1 范围）

| 工具 | 说明 |
|---|---|
| `read_file` / `write_file` / `edit_file` | 精确字符串替换编辑 |
| `list_dir` / `glob` / `grep` | 文件发现与搜索 |
| `run_command` | shell 执行，超时可配，输出截断 |
| `todo` | 任务清单读写，agent 自己跟踪多步进度 |

### 4.3 安全与确认门

- `write_file`、`edit_file`、`run_command` 默认需用户确认；UI 提供
  「本次会话自动允许」。只读工具直接放行。
- 工作区根目录之外的路径一律拒绝。
- `run_command` 有硬超时 + 输出大小上限。

### 4.4 上下文管理

- v1：按 token 预算裁剪——先压缩旧的工具结果（截断为摘要），再丢弃最老
  的轮次；系统提示词和最近 N 轮永远保留。
- 接口是可替换的 `ContextStrategy`，以后加 LLM 自动 compaction 不用改
  循环。

### 4.5 Provider

- 单一 `OpenAICompatProvider`：`baseURL` + `apiKey` + `model`。支持多
  个命名 profile（deepseek / glm / qwen），UI 里可切换。

## 5. UI 布局与交互

```
+--------+---------------------------+---------------+
| 文件树  |  编辑器（Monaco，多标签）    |  Agent 面板   |
|        |                           |  -----------  |
|        |                           |  对话流：      |
|        |                           |   文本（流式） |
|        +---------------------------+   工具卡片     |
|        |  终端（xterm.js，可折叠）    |   diff 预览   |
+--------+---------------------------+---------------+
```

- Agent 面板是对话主场：流式 markdown 文本；每次工具调用渲染为可折叠
  卡片（工具名 + 参数 + 结果摘要）；`edit_file`/`write_file` 卡片内嵌
  Monaco DiffEditor——用户点「允许」后才真正落盘（这就是确认门）。
- 编辑器联动：agent 改过的文件自动刷新对应标签页；点工具卡片里的文件
  路径可跳转打开。
- 终端：agent 的 `run_command` 在下方真实终端执行；用户共用同一个 pty
  会话池。
- 顶栏：model profile 切换、会话列表（从 JSONL 恢复）、token 用量。
- 首次打开：选择一个文件夹作为工作区；会话绑定工作区路径。

## 6. 数据流（一次工具调用，端到端）

```
LLM 流式返回 tool_call
  -> core 发 tool-call 事件 -> main 经 IPC 转发 -> renderer
  -> 若需确认：UI 弹 diff/命令卡片，用户点「允许」
     -> IPC 回 main -> core 收到放行
  -> core 执行工具 -> tool-result 事件回流
  -> 结果追加历史 -> 循环继续
每一步都同步追加写进 session JSONL，崩溃后重开可接着跑。
```

## 7. 错误处理

- **LLM API 失败**：指数退避重试 3 次（429/5xx）。仍失败则向 UI 报错并
  把这一轮标记失败——历史保持干净；用户可点「重试」。
- **工具执行失败**：错误文本作为工具结果回给模型（是循环的一部分，
  不是异常）；模型自己决定重试还是换路。
- **工具参数不合法**：JSON schema 校验失败直接回错误信息，不执行。
- **用户停止**：中断循环（当前工具跑完但不发下一轮 LLM 请求）；会话
  保留。

## 8. 测试策略

- `agent-core` 单测是主力：用**假 provider**（脚本化返回预设 tool_call
  序列）驱动循环，断言历史演化和事件顺序——零 API 费用覆盖全部循环
  逻辑。
- 工具单测直接对临时目录跑。
- main/renderer 只做冒烟测试：应用起、窗口开、IPC 通。

## 9. 里程碑

- **M1 —— agent-core 命令行可用**：终端里就能对话 + 干活，无 UI。
- **M2 —— Electron 壳 + 聊天面板**：桌面应用里流式对话和工具卡片。
- **M3 —— Monaco 编辑器 + diff 确认**：文件树、标签页、基于 diff 的
  写入确认。
- **M4 —— 终端 + 会话恢复**：xterm 面板、会话列表/恢复。

每个里程碑结束都是能真用的东西。
