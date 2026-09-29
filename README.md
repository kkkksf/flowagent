# FlowAgent

桌面端 AI 编程应用：对话、读写文件、执行命令、自主多步任务，内置 Monaco 编辑器与基于 diff 的写入确认（M3）。

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

## 编辑器与 diff 确认（M3）

- 左侧文件树：点击展开/打开；右键新建文件/文件夹、重命名、删除（删除有确认）。
- 中间编辑器：多标签，Ctrl+S 保存（编辑器内直接落盘）；外部修改自动重载，
  有未保存修改时出现冲突横幅（加载磁盘版本 / 保留我的版本二选一）。
- diff 确认门：agent 的 write_file/edit_file 会在聊天面板出现审批卡（含统计行），
  点「查看 diff」在编辑区打开红绿对照的 diff 标签页；「允许 / 拒绝 / 允许且本会话不再询问」。
  若目标文件在编辑器中有未保存修改，「允许」会被拦截并提示先处理。
- 点聊天中工具卡片里的文件路径可直接打开对应标签。

## 架构

    packages/agent-core   纯 TS 引擎（循环/工具/provider/会话），零 UI 依赖
    packages/main         Electron 主进程：窗口、AgentHost、IPC、preload
    packages/renderer     React 界面：聊天面板、Monaco 多标签编辑器（FileTree/EditorArea/DiffPane）、事件驱动的 editor-store

详细设计见 docs/superpowers/specs/。
