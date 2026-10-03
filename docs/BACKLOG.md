# FlowAgent 待办与后置清单（BACKLOG）

> 收录各里程碑 spec 的"范围外 / 显式推迟"项与最终 review triage 结论。
> 完成项在对应里程碑 closeout 时移除（commit message 留痕）；优先级不排死，
> 由下一个里程碑 brainstorming 时挑选。愿景类"非目标"单独列在末尾，不排期。

## 1. M4 closeout 遗留候选（2026-10-03 汇总，M5 起逐个挑）

| # | 事项 | 域 | 来源 | 说明 |
|---|------|----|------|------|
| 1 | busy/jail/NaN 守卫补单测 | 编排层测试 | M4 closeout | 成本低，可优先捎带 |
| 2 | Monaco model dispose | 编辑器 | M3 review triage | 关标签不释放；URI 缓存复用为收益 |
| 3 | 语言 worker 按 label 分发 | 编辑器 | M3 review triage | 当前单一 editor worker，TS 智能提示降级、着色正常 |
| 4 | 双 store 去 commit 镜像重构 | 状态层 | M3 review triage | chat-store/editor-store 改为纯 reducer，测试每次 getState |
| 5 | 关窗脏标签检查 | 编辑器 | M3 review triage | 需新增 IPC；当前直接关窗丢未保存修改 |
| 6 | 终端多标签 / 多实例 | 终端 | M4 spec 范围外 | M4 为单终端面板 |
| 7 | 终端高度拖拽调节 | 终端 | M4 spec 范围外 | 现为固定 220px + 折叠 |
| 8 | 会话重命名 / 搜索 | 会话 | M4 spec 范围外 | 现标题 = 首句摘要前 40 字符 |
| 9 | agent 命令 pty 化 | agent 执行 | M4 spec 范围外 | 总 spec 已修订为分离式；"共用 pty 会话池"完整形态后置 |
| 10 | stream_options 兼容开关 | provider | M4 closeout | 不支持 usage 的端点显示 —，可加开关探测 |
| 11 | symlink 逃逸（realpath） | 安全 | M3/M4 triage | resolveInWorkspace 不做 realpath 解析 |
| 12 | 稳定 item id | 会话/渲染 | M3 spec | 流内插入型 UI 需要时再做 |

## 2. 更早里程碑的范围外项（仍未做）

| # | 事项 | 域 | 来源 | 说明 |
|---|------|----|------|------|
| 13 | CLI stdin 关闭崩溃修复 | agent-core CLI | M2 spec backlog | 管道输入 `ERR_USE_AFTER_CLOSE`，不影响交互使用 |
| 14 | 全工作区 watch（文件树实时刷新） | 文件树 | M3 spec 范围外 | 树有手动刷新按钮；Windows 递归 watch 开销大 |
| 15 | 三方合并工具 | 编辑器/diff | M3 spec 范围外 | 现策略：拒绝写入 + 模型重试 |
| 16 | 重试语义统一 | agent-core | M3 spec 范围外 | 体验小项 |

## 3. M5（UI 重设计）需求确认中明确推迟的项（2026-10-03）

| # | 事项 | 域 | 决定 | 说明 |
|---|------|----|------|------|
| 17 | 键盘快捷键体系 | UI | 另开需求 | 本次只做与视觉直接相关的交互（空状态、loading 态） |
| 18 | 面板宽度拖拽 | UI 布局 | 最低优先 | 三栏骨架不动；折叠已有，拖宽度后置 |
| 19 | 花哨动效 | UI 视觉 | 明确不做 | 只保留克制的 hover / focus / 面板过渡 |

> M5 spec 定稿时，把最终"明确不做 / 推迟"清单同步补录到本节
> （例如亮色主题是否后置，取决于主题模式的拷问结论）。

## 4. 愿景类：总 spec v1 非目标（不排期）

多用户、云端部署、本地模型（Ollama/vLLM）、插件市场、远程工作区。
