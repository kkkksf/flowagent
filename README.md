# FlowAgent

桌面端 AI 编程应用：对话、读写文件、执行命令、自主多步任务，内置文本编辑器（M3）。

## 开发

    pnpm install
    pnpm -r test        # 全部单测
    pnpm --filter main dev   # 启动 Electron 应用（HMR）

模型配置（环境变量，与 CLI 一致）：

    FLOWAGENT_BASE_URL=https://api.deepseek.com/v1
    FLOWAGENT_API_KEY=sk-...
    FLOWAGENT_MODEL=deepseek-chat

注：仓库 `.npmrc` 将 Electron 二进制下载固定为 npmmirror 镜像（本机网络对 github release 直连不通）；如在其他网络环境构建可自行调整。

首次启动选择工作区文件夹；会话自动持久化于 `<工作区>/.flowagent/session.jsonl`。

## 架构

    packages/agent-core   纯 TS 引擎（循环/工具/provider/会话），零 UI 依赖
    packages/main         Electron 主进程：窗口、AgentHost、IPC、preload
    packages/renderer     React 聊天界面：流式气泡、工具卡片、审批门

详细设计见 docs/superpowers/specs/。
