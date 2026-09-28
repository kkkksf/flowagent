# GitHub PR（Pull Request）创建与合并教程

> 以本仓库 flowagent 为例：把 `feat/m1-agent-core` 分支的改动通过 PR 合并进 `master`。
> 本次实际合并是在本地用 `git merge` 完成的（效果等同）；下面是标准的网页 PR 流程，留作下次使用。
> 截图待补：当前环境浏览器被占用，之后网络/浏览器可用时补充每步截图。

## 前置概念（一分钟看懂）

- **分支（branch）**：一条独立的开发线。你在 `master` 之外开一个 `feat/xxx` 分支写代码，不影响主线。
- **PR（Pull Request）**：向仓库主人（这里是你自己）发起的"请把我的分支合并进主分支"的请求。它提供一个对比页面：改了哪些文件、每行 diff、他人可以留言评审。
- **单人仓库为什么也用 PR**：可以在合并前最后一眼检查全部改动（Files changed 标签页），并在仓库里留下一条清晰的合并记录。

## 完整流程（网页操作）

### 第 1 步：把分支推上 GitHub

```bash
git push -u origin feat/m1-agent-core
```

### 第 2 步：打开 PR 创建页

推送后终端会打印一个链接（形如 `https://github.com/用户名/仓库/pull/new/分支名`），点击它。
也可以自己打开：仓库页面 → **Pull requests** 标签 → 绿色按钮 **New pull request** → base 选 `master`，compare 选你的分支。

*截图位 1：Pull requests 标签与 New pull request 按钮*

### 第 3 步：填写标题和描述，点 Create pull request

- **标题**：一句话说清这个 PR 做什么，例如 `M1: agent-core with tools, loop, provider and CLI`。
- **描述**：可以列要点（做了什么、怎么测试的）。单人项目简单写即可。
- 点绿色按钮 **Create pull request**。

*截图位 2：PR 创建表单（标题/描述/绿色按钮）*

### 第 4 步：检查 PR

PR 页面顶部有三个标签：
- **Conversation**：讨论和时间线。
- **Commits**：这个 PR 包含的所有提交。
- **Files changed**：逐行 diff，最值得合并前扫一遍。

确认没有冲突提示（"This branch has no conflicts with the base branch"）。

*截图位 3：PR 概览页与 Files changed 标签*

### 第 5 步：合并

页面下方 **Merge pull request** 绿色按钮 → 点 **Confirm merge** 确认。

按钮旁的小箭头可以选合并方式（个人项目建议保持默认 **Create a merge commit** 即可；三种方式区别见文末附录）。

*截图位 4：Merge pull request → Confirm merge*

### 第 6 步：删除分支（可选但推荐）

合并成功后按钮变成紫色 **Delete branch**，点它清理远端分支。本地对应操作：

```bash
git checkout master
git pull                # 拉取合并后的 master
git branch -d feat/m1-agent-core   # 删本地分支
```

## 附录：三种合并方式的区别

| 方式 | 效果 | 适用 |
|---|---|---|
| **Create a merge commit**（默认） | 保留分支上的所有提交，外加一个合并提交 | 一般情况 |
| **Squash and merge** | 把分支所有提交压成 1 个提交进 master | 分支里提交很乱、想保持主线干净 |
| **Rebase and merge** | 把提交逐个"搬"到 master 顶端，无合并提交 | 想要完全线性历史 |

## 与本地合并的等价关系

本次实际执行的是：

```bash
git checkout master
git merge feat/m1-agent-core     # 相当于网页的 Merge pull request
pnpm --filter agent-core test    # 合并后跑一遍测试确认绿
git push origin master
git branch -d feat/m1-agent-core
git push origin --delete feat/m1-agent-core
```

结果与网页 PR 合并完全一样（这次是 fast-forward，连合并提交都没有），仓库地址：https://github.com/kkkksf/flowagent
