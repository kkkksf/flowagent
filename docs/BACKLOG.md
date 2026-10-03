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

## 3. M5（UI 重设计）明确推迟的项（2026-10-03 需求确认 + spec 定稿）

| # | 事项 | 域 | 决定 | 说明 |
|---|------|----|------|------|
| 17 | 键盘快捷键体系 | UI | 另开需求 | M5 只做与视觉直接相关的交互（空状态、loading 态） |
| 18 | 面板宽度拖拽 | UI 布局 | 最低优先 | 三栏骨架不动；折叠已有，拖宽度后置 |
| 19 | 花哨动效 | UI 视觉 | 明确不做 | 只保留克制的 hover / focus / 面板过渡 |
| 20 | 无边框自绘标题栏 | 窗口 | 后置 | M5 用系统标题栏 + titleBarOverlay 跟随主题（Q13-a） |
| 21 | 主题跟随系统 | 主题 | 后置 | M5 只做手动切换（Q1-b）；跟随系统以后捎带 |
| 22 | 视觉回归自动化（截图 diff） | 测试 | 明确不做 | 单人项目成本大于收益（Q6-a） |
| 23 | header 拖拽区取舍：title tooltip 失效 + 下拉开着时点 header 空白不收起 | UI | 后置小项 | M5 终审 minor；两 span 补 no-drag 可修但产生拖拽孔，真机验收后定 |
| 24 | icon-only 按钮批量补 aria-label | a11y | 后置 | 现仅有 title；与图标尺寸体系统一（svg.lucide 14px 与 h-3 w-3 耦合，文件树 ml-[18px] 对齐依赖 14px）一并做 |
| 25 | 暗色 accent 实心钮对比度 | 视觉 | 可选 | 白字 on #7da2f7 ≈2.4:1；可加深暗色 accent 或改深色文字 |

> 亮色主题原为待定项，Q1-b 已定：双主题属 M5 范围内，已实施，不入本表。

## 4. 愿景类：总 spec v1 非目标（不排期）

多用户、云端部署、本地模型（Ollama/vLLM）、插件市场、远程工作区。
