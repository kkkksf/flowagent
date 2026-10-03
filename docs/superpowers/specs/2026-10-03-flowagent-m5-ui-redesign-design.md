# FlowAgent M5 设计规格（UI 重设计 · Codex 风格）

日期：2026-10-03
状态：需求确认文档已批准（13 组拷问 + P2 检查通过），待用户审阅
上游 spec：`docs/superpowers/specs/2026-09-28-flowagent-design.md`（总设计）
前置：M4 已合并 master（b2df736 + 965c1b4），132/132 测试绿

## 1. 目标与范围

M5 是**纯视觉里程碑**：renderer 全面重设计为 Codex 桌面端风格（暗/亮双主题），
M2–M4 全部功能行为零回归。

**范围内**：

- Tailwind v4 + 语义 token 设计系统（色板/字体/密度），`@theme` 定义，
  `[data-theme]` 覆盖实现双主题
- 全部 14 个 renderer 组件去 inline style 迁移到 utilities（App、ChatPanel、
  Composer、MessageItem、ToolCard、ApprovalCard、DiffPane、EditorArea、
  FileTree、MonacoPane、MonacoDiff、TerminalPanel、XtermPane 及 index.html）
- 布局微调：header 重排（会话下拉从 ChatPanel 迁入 header）、聊天栏可折叠、
  4px 密度基准、滚动条/选中态/hover/focus 全局细化
- 交互增强（仅视觉直接相关）：工具卡默认折叠单行、聊天空状态引导、运行中
  呼吸点指示、克制动效（150ms fade/height 过渡）
- Monaco 自定义主题 ×2（fa-dark / fa-light）+ xterm 主题（含 ANSI 16 色）随
  全局主题联动
- lucide-react 图标替换现有 emoji/文本符号（📂»⟳✓✗▾ 等）
- 系统标题栏 `titleBarOverlay` 颜色跟随主题（唯一 main 侧功能改动）

**范围外（显式推迟）**：键盘快捷键体系、面板宽度拖拽、花哨动效、无边框
自绘标题栏、主题跟随系统——均已录入 `docs/BACKLOG.md` §3。

## 2. 设计基准（Codex 桌面端参照）

- **参照物**：Codex 桌面 App（macOS/Windows）。官方文档描述其结构为
  project sidebar / active thread / review pane，明暗双主题。FlowAgent 保持
  自有三栏（文件树 / 编辑器+终端 / 聊天），参照其**气质**而非照搬布局。
- **主题模型**：Codex 的 `codex-theme-v1` 主题格式包含 surface / ink /
  accent / contrast / opaqueWindows / semanticColors（diffAdded、diffRemoved、
  skill）。本 spec 的 token 分类对齐该模型（surface 分层、ink 分级、单一
  accent、diff 语义色），语义命名沿用。
- **色板推导方式（如实声明）**：官方截图 CDN 对本机网络返回 403，无法逐像素
  取色。色板为"Codex 气质定稿"：中性近黑分层 surface、近白微冷 ink、单一
  低饱和蓝 accent、克制的语义色。验收时若与你机器上的 Codex 真机有肉眼
  可见偏差，微调 token 表即可（单点修改，全应用生效）。

## 3. 设计 token

### 3.1 主题机制

- Tailwind v4（devDeps：`tailwindcss` + `@tailwindcss/vite`，Vite 插件接入，
  零运行时依赖）。
- `src/index.css`：`@import "tailwindcss"` + `@theme { --color-*, --font-* }`
  定义暗色（默认）token；`:root[data-theme="light"] { --color-*: … }` 覆盖
  为亮色。Tailwind v4 的 token 即 CSS variables，utilities（`bg-surface-1`
  等）自动引用，双主题切换只换属性值。
- **硬约束：组件代码禁止裸色值**（`bg-[#123]`、`color: '#fff'` 一律不许）。
  新增 vitest 卫兵测试扫描 `src/**/*.tsx` 中的 hex 色值（token 定义文件
  `themes.ts` 白名单豁免）。
- 切换：`useTheme` hook——localStorage `fa-theme`（`dark`|`light`，默认
  dark），写 `<html data-theme>`；`main.tsx` 渲染前同步读取设置，防首帧
  闪烁；header 右侧 sun/moon 图标按钮切换。

### 3.2 色板（token 表定稿值）

| token | dark | light | 用途 |
|---|---|---|---|
| `surface-0` | `#0e0f11` | `#ffffff` | 窗口底、侧栏底、代码块底 |
| `surface-1` | `#16181b` | `#f7f7f8` | 面板底、卡片底（工具卡/审批卡） |
| `surface-2` | `#1d2023` | `#f0f1f2` | 浮层（下拉/右键菜单）、输入框、用户消息卡 |
| `surface-3` | `#25292d` | `#e8e9eb` | hover 态背景 |
| `border-subtle` | `#26292d` | `#e8e9eb` | 面板分隔线 |
| `border` | `#33373c` | `#d5d7da` | 卡片/输入框边框 |
| `ink` | `#ececf1` | `#1a1c1f` | 主文字 |
| `ink-secondary` | `#a5a9b3` | `#565b64` | 次要文字（摘要、meta） |
| `ink-faint` | `#6b7078` | `#8a9099` | 弱化文字（placeholder、禁用；不承载关键信息） |
| `accent` | `#7da2f7` | `#3358d4` | 交互强调：链接、active 标签线、agentTouched 圆点 |
| `accent-hover` | `#9db9f9` | `#2747b8` | accent hover |
| `text-on-accent` | `#ffffff` | `#ffffff` | accent 实心按钮上的文字（双主题固定白） |
| `success` | `#4cc38a` | `#1c7c4d` | 工具卡成功态 |
| `danger` | `#ef6b7d` | `#c03550` | 错误条、工具卡失败态、停止按钮、终端退出 |
| `warning` | `#e0a458` | `#8f6a2f` | 审批卡强调、冲突提示 |
| `diff-added` | `#3fb27f` | `#1a7f4b` | diff 统计行 +（语义色，对齐 codex-theme-v1） |
| `diff-removed` | `#e5617c` | `#b3364e` | diff 统计行 − |
| `selection` | accent @ 25% | accent @ 25% | 文本选区 |
| `focus-ring` | accent @ 50% | accent @ 50% | 键盘焦点环（`:focus-visible`） |

### 3.3 字体与密度

- `--font-ui`: `Segoe UI, PingFang SC, Microsoft YaHei, system-ui, sans-serif`
- `--font-mono`: `Cascadia Code, Consolas, PingFang SC, Microsoft YaHei, monospace`
  （等宽场景：代码、路径、工具名、token 计数）
- 密度：UI 基准字号 13px（header/树/聊天正文）；辅助 12px；间距全部走
  Tailwind 内置 4px 刻度（`p-1/2/3/4`、`gap-1/2/3`），不自造 spacing token。
- 圆角：卡片/输入框 `rounded-lg`(8px)，按钮/菜单项 `rounded-md`(6px)。
- 动效：统一 150ms ease（面板折叠 width/height、hover 过渡、呼吸点动画）。

## 4. 布局与组件规格

### 4.1 App 骨架（App.tsx）

三栏骨架不变：header 40px（`border-b border-border-subtle`）｜左 FileTree
240px↔32px ｜中 EditorArea + TerminalPanel ｜右 ChatPanel 420px↔36px。聊天栏
新增折叠：折叠态为 36px 竖条（panel-right 图标按钮），状态与文件树同款放
App useState。各栏分隔线一律 `border-border-subtle`。

### 4.2 App header（重排）

- 左：FlowAgent 标识（8px 圆角小方块 accent 单色 + 名称 13px semibold）+
  **会话下拉**（从 ChatPanel 迁入：当前 title + chevron-down，浮层列表项 =
  title + 相对时间 + 悬停显示 trash 图标，当前项置灰；底部「+ 新会话」；
  running 禁用，交互契约全部保留）。
- 右：workspace 路径（`font-mono text-xs ink-secondary`，truncate + title
  提示）· model 名（badge 样式 `surface-2 rounded-md`）· token 计数
  （`font-mono text-xs ink-secondary`，M4 行为不变）· 主题切换 icon button。
- ChatPanel 顶部的会话行移除，聊天区直接是消息流。

### 4.3 FileTree

- 行：高 26px、13px、`hover:bg-surface-3`；目录折叠箭头用 lucide
  `chevron-right`/`chevron-down`（90° 旋转过渡），目录/文件图标 `folder`/
  `file`（16px，ink-secondary）；agentTouched 圆点 accent。
- 顶栏：「工作区」小字标签 + 刷新（`rotate-cw`）/折叠（`panel-left`）图标
  按钮；`sticky top-0 bg-surface-0`。
- 右键菜单/行内输入：`surface-2` 底 + `border` + `rounded-md` + 阴影
  （`shadow-lg shadow-black/30`，亮色 `shadow-black/10`）；现有 `<style>`
  注入的 hover 规则迁入 index.css。
- 折叠窄条 32px 不变，图标换 `panel-left-close/open`。

### 4.4 编辑器区（EditorArea / DiffPane）

- 标签栏：高 32px；active 标签 `text-ink` + 底部 2px accent 指示线，
  inactive `text-ink-secondary hover:text-ink`；dirty 圆点 `•` accent，
  conflict 标签名 warning 色；关闭按钮常驻小 `×`（hover 才显背景）；中键
  关闭保留。
- notice 条：`surface-2` 底 + warning 左竖条 2px + 文字 + 关闭按钮。
- conflict 条：同 notice，操作按钮描边样式（见 4.6 按钮规范）。
- 空状态（欢迎页）：居中 logo 方块 + 「给 FlowAgent 发个任务，或从左侧文件
  树打开文件」+ 最近打开列表（mono 小字，hover accent）。
- DiffPane 头部：路径 mono + 允许/拒绝/允许且不再询问按钮组（允许 = accent
  实心、拒绝 = danger 描边、第三项 = 常规描边）；已解决态灰字。

### 4.5 终端面板（TerminalPanel / XtermPane）

- 头部 28px：chevron 折叠图标 + 「终端」小字 + 退出态（danger「已退出」+
  描边「重启」按钮）。
- xterm：`theme` 选项由共享 `themes.ts` 的 `xtermTheme(variant)` 生成——
  background=surface-0、foreground=ink、cursor=accent、selection 背景，
  ANSI 16 色按色板同源微调（0-7 用 ink 灰阶渐变，8-15 提亮）；切主题时
  XtermPane 订阅 `useTheme` 更新 `term.options.theme`。

### 4.6 聊天面板（ChatPanel / MessageItem / ToolCard / ApprovalCard / Composer）

**按钮规范**（全局统一）：实心 = `bg-accent text-on-accent`；描边 = `border
border-border text-ink hover:bg-surface-3`；danger 描边 = danger 色边框和
文字。高度 26px、`rounded-md`、focus-ring。

- **用户消息**：右对齐、`bg-surface-2 border border-border-subtle
  rounded-lg px-3 py-1.5 max-w-[85%] whitespace-pre-wrap`。
- **assistant 消息**：全宽无气泡，`text-ink`；markdown 样式进 index.css——
  代码块 `surface-0 border rounded-md font-mono text-xs`、行内 code 同源、
  链接 accent 下划线、列表/表格标准间距；每条**含文本**的 assistant 消息
  尾部一行 `text-xs ink-faint` 模型名（纯工具轮不显示；token 计数保持在
  顶栏，不在此重复——对需求确认文档的小修订：避免同屏两处 token 数）。
- **工具卡**（默认折叠）：单行 = 状态图标（running=`loader-circle` 旋转 /
  ok=`check` success / error=`x` danger）+ 工具名 `font-mono text-xs` +
  argsSummary 或路径链接（accent 下划线）+ 结果首行截断 60 字
  ink-secondary；整行可点展开；展开区 = `surface-0 border rounded-md
  font-mono text-xs pre-wrap`。卡片 `surface-1 border rounded-lg`。
- **审批卡**：`surface-1 rounded-lg` + 左侧 2px warning 竖条；标题行 = 操作
  名 mono semibold + 路径 + diffStats（`+n −m` 用 diff-added/diff-removed
  色）；按钮组 = 查看 diff（描边）/ ✓ 允许（accent 实心）/ ✗ 拒绝（danger
  描边）；已解决态降为 ink-secondary 单行。
- **错误条**（MessageItem error）：danger 左竖条 + `surface-1` 底 + 重试
  按钮（描边）。
- **Composer**：外框 `surface-2 border rounded-lg`，focus-within 边框转
  accent；textarea 无边框透明底、`rows=3`、placeholder=ink-faint；下方一行
  小字「Enter 发送 · Shift+Enter 换行」（ink-faint，disabled 时文案不变）。
  running 态整块替换为全宽 danger 描边「■ 停止」按钮（lucide `square`）。
- **空状态**：items 为空时居中引导（保留现有两段文案，配 48px logo 方块 +
  ink-secondary）。
- **运行指示**：running 时消息流底部三个 4px 圆点波浪呼吸（CSS keyframes，
  500ms 错峰）+ 「正在处理…」ink-secondary 小字；停止滚动交互（stick
  逻辑）不变。

## 5. Monaco 主题联动

- `themes.ts` 导出 `monacoTheme(variant): MonacoStandaloneThemeData`——
  `base: 'vs-dark' | 'vs'`，`inherit: true`，rules/comments 按色板（注释
  ink-faint、字符串 diff-added、关键字 accent、数字 success 等克制映射），
  colors：`editor.background=surface-0`、`editorLineNumber.color=ink-faint`、
  diff 装饰色对齐 diff-added/diff-removed。
- MonacoPane / MonacoDiff 挂载时 `defineTheme('fa-dark'/'fa-light')` 并
  `setTheme`；订阅 `useTheme` 变化重新 setTheme（Monaco 支持运行时切换，
  DiffEditor 同步）。

## 6. main 侧改动（最小）

- `BrowserWindow` 增加 `titleBarOverlay: { color: '#0e0f11', symbolColor:
  '#ececf1', height: 40 }`（dark 初值，与默认主题一致）。
- IPC 新增 `fa.chrome.setTheme(variant)`：main 调
  `win.setTitleBarOverlay({ color, symbolColor })`（color=surface-0 值由
  renderer 传 hex，避免 main 引前端 token；不支持的平台上 catch 忽略）。
- preload 暴露一个 invoke。除此外 main / preload / agent-core 零改动。

## 7. 错误处理与边界

| 场景 | 行为 |
|---|---|
| localStorage 主题值非法 | 兜底 dark |
| 首帧闪烁 | main.tsx 渲染前同步设置 data-theme |
| setTitleBarOverlay 抛错（平台不支持/未启用） | catch 静默，标题栏维持默认 |
| 切主题时 Monaco/xterm | 先 setTheme/options 赋值再渲染下一帧，无白闪 |
| 原生 confirm/alert | 保留系统对话框（不重绘） |
| 亮色主题漏色 | 卫兵测试 + 验收清单逐组件检查双主题 |

## 8. 测试策略

| 层 | 测什么 | 手法 |
|---|---|---|
| renderer（新增） | 源码无裸 hex 色值（themes.ts 豁免） | vitest 读文件正则扫描 |
| renderer（既有 24 个） | store 行为不回归 | 不改断言；组件改造不动 store |
| agent-core / main 逻辑测试 | 零改动零回归 | `pnpm -r test` 基线 132/132 |
| 视觉 | 双主题逐组件截图自查 | dev 起 app + 截图工具人工核对 |
| 真机验收 | M2–M4 全工作流 + 双主题 | 用户过验收清单 |

## 9. 验收清单（M5 完成的定义）

- [ ] 暗/亮切换：全部组件（含 Monaco、xterm、标题栏）同步无漏色、无白闪
- [ ] header：会话下拉（新建/切换/删除/运行中禁用）、路径/model/token/主题
- [ ] 工具卡默认折叠、展开/收起、路径跳转；审批卡三按钮 + diff 联动
- [ ] 用户消息卡片 / assistant 全宽 / markdown 样式 / 模型名尾部小字
- [ ] Composer focus 边框、停止按钮、运行呼吸点、空状态引导
- [ ] FileTree 图标/悬停/右键菜单/行内重命名；agentTouched 圆点
- [ ] 编辑器标签 active 线/dirty 点/conflict 色；欢迎页
- [ ] 三栏均可折叠（树/终端/聊天），折叠后无死区
- [ ] `pnpm -r test` 全绿（132 + 新增卫兵）
- [ ] 真机过 M2–M4 工作流：对话/工具审批/diff/编辑保存/终端/多会话
