# OKF for Claude Code

一个 Claude Code 插件,自动为每个会话提供跨项目持久化的知识库。无需手动记
笔记,也无需运行额外的工具。

**[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md)**

## 功能概述

1. 每次会话结束时,**无损捕获**完整的对话内容。
2. 在后台(不是 cron 之类的定时任务,而是一种机会主义式的批处理)使用
   `claude -p` **压缩**已捕获的会话,提取可复用的知识 —— 决策、项目信息、
   偏好、模式、参考资料、故障排查经验 —— 整理成结构化的
   [OKF(Open Knowledge Format)](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/?hl=en&utm_source=pytorchkr&ref=pytorchkr) 知识包。
3. 每次新会话启动时,将该知识包的索引作为**强制性网关**注入上下文,使
   Claude 在处理相关工作前真正去 Read 过去的相关知识,而不是每次都从零
   开始。

所有数据都保存在 `~/.claude/okf`(或 `$CLAUDE_CONFIG_DIR/okf`)下的本地 git
仓库中,不会被推送到任何地方。唯一的网络请求就是你本来就在使用的
Anthropic API 调用 —— 批处理步骤只是本地又执行了一次 `claude -p` 调用。

## 环境要求

- 支持插件的 Claude Code
- Node.js(与 `claude` 本身所需的版本相同 —— 无需额外运行时)
- git

无需 `npm install`。不依赖外部服务。开箱即用,无需额外配置。

## 安装

```
claude plugin marketplace add dja1369/okf-system
claude plugin install okf@okf-marketplace
```

(从本地克隆安装:`claude plugin marketplace add /path/to/your/clone`。)

就这么简单 —— 重启会话后,网关/捕获钩子即已启用。下次会话启动时,知识包会
自动初始化(会在 `~/.claude/okf` 下创建一个具备基本结构的本地 git 仓库)。

卸载:`claude plugin uninstall okf`。`~/.claude/okf` 中的数据不会被删除 ——
它只是一个普通的 git 仓库,你可以自行查看、备份,或用
`rm -rf ~/.claude/okf` 手动删除。

## 使用方法

日常使用无需任何操作,捕获和批量压缩都会自动进行。以下四个命令用于手动
查看/控制状态 —— **注意必须带 `okf:` 前缀**(因为这些是插件作用域内的命令):

| 命令 | 作用 |
|---|---|
| `/okf:okf-status` | 报告上次批处理运行情况、待处理会话数、锁状态 |
| `/okf:okf-batch` | 立即强制运行一次批处理(忽略时间间隔限制,但仍遵守锁) |
| `/okf:okf-config` | 显示当前配置并支持编辑 |
| `/okf:okf-index` | 输出知识包概览 —— 各分类下的 concept 标题列表,以及 log.md 的最近变更 |

## 工作原理

```
[会话使用]                        [后台批处理(机会主义式,非定时调度)]
SessionStart → 网关注入            触发条件:时间间隔已到 + 没有其他批处理在运行
      │                            触发方式:SessionEnd(主要)或 SessionStart(补漏)
SessionEnd → 无损捕获到                  │
   raw/                            对每个待处理会话:通过 `claude -p` 提取可复用
      │                            知识 → 校验结构 → git commit。某个会话处理
      └─▶ 网关检查 ──▶ 按需启动     失败也不影响已提交的其他会话(每个会话都是
          批处理                   独立的 commit)。
```

- **捕获**是纯粹的文件复制 —— 不解析、不过滤、不限制大小。每次
  `SessionEnd` 时,完整的 transcript 都会写入 `raw/`。这是有意为之的设计 ——
  只记住部分内容的知识库,比完全没有知识库更糟糕。
- **压缩**只在批处理时、在临时副本上进行 —— 永远不会触碰已捕获的原始文件。
  批处理调用的工具权限被限制为 `Read/Glob/Grep/Write/Edit`(没有 `Bash`),
  并且在那一次调用期间,*你的*其他钩子、插件、MCP 服务器全部被禁用
  (`--safe-mode`)—— 这样批处理就不会形成自我捕获的循环。
- **网关**注入的是精简的分类索引(而非完整的 concept 正文)加上最近的变更
  记录,并指示 Claude 在处理相关工作前必须实际 `Read` 相应文件 —— 仅凭索引
  本身不足以避免基于过时假设行动。
- 结构化 linter 始终保证知识包符合规范:如果某次批处理的结果存在任何格式
  问题,会在提交前自动回滚。

关于该格式的背景与设计理念,请参考 Google Cloud 的 [Open Knowledge Format 发布文章](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/?hl=en&utm_source=pytorchkr&ref=pytorchkr)—— 它只是带有 YAML frontmatter
的 markdown 文件,即使不用这个插件,任何工具都能读取。

## 配置

直接编辑 `~/.claude/okf/.okf/config.md`(frontmatter 部分),或使用
`/okf:okf-config`。

| 键 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关(捕获、网关、批处理均受此值控制) |
| `batch_interval_hours` | `1` | 两次批处理之间的最小间隔 |
| `batch_max_sessions` | `10` | 每次批处理最多处理的会话数(成本上限) |
| `batch_model` | `claude-sonnet-5` | 批处理 ingest 使用的模型,留空则用 CLI 默认模型 |
| `batch_effort` | `medium` | 批处理 ingest 的推理强度(`low`/`medium`/`high`/`xhigh`/`max`),留空则用 CLI 默认值 |
| `capture_exclude_cwd` | `[]` | 跳过捕获的目录 glob 模式(仅用于主动排除 —— 捕获本身永远不会是部分捕获) |
| `batch_digest_cap_kb` | `150` | 提供给 LLM 的单会话摘要大小上限(不影响已捕获的原始文件) |
| `remove_candidate_ttl_days` | `30` | 已处理的 raw transcript 在删除前的保留天数 |
| `inject_max_lines` / `inject_max_bytes` | `120` / `16384` | 网关注入内容的大小上限 |
| `claude_bin` / `node_bin` | *(空)* | 当环境中 `PATH` 解析失败时使用的绝对路径 override |

## 数据与隐私

- 所有数据仅保存在本地:`~/.claude/okf` 是一个与你正在使用的任何仓库完全
  隔离、自成一体的普通 git 仓库。**本插件的任何代码路径都不会执行
  `git push`、`git remote add` 或任何与网络相关的操作** —— 实际用到的 git
  命令只有 `init`、`commit`、`checkout` 和 `clean`(可自行验证:
  `grep -n "push\|remote" lib/*.mjs bin/*.mjs` —— 命中的全部是无关的
  `Array.push()` 调用)。除非你自己主动 push,否则知识包永远不会离开本机。
- 批处理步骤会将会话内容发送给 Anthropic API 用于摘要/提取 —— 这与你平时
  使用 Claude Code 所调用的 API 完全相同,只是多了一次 `claude -p` 调用。
  不涉及任何第三方服务。
- `raw/`(捕获的完整 transcript)以及已处理、等待删除的 transcript 都不会
  被提交到 git(已加入 gitignore)—— 只有提取出来的知识包会被提交。

## 可移植性(其他用户 / 其他设备)

代码中没有任何硬编码路径 —— 全部通过 `os.homedir()` /
`process.env.CLAUDE_CONFIG_DIR` / `process.env.HOME` 解析,因此在另一台设备
或另一个用户账户上全新安装时,会各自生成独立的知识包。测试套件
(`test/smoke.mjs`,78 个场景)在隔离的 `HOME`/`CLAUDE_CONFIG_DIR` 沙箱中
验证了这一点,其中包括**完全没有配置 git 身份**的环境 —— 本插件不依赖你的
`user.name`/`user.email`,其自动提交始终使用固定的内置身份
(`OKF Batch <okf-batch@localhost>`)。macOS 和 Linux 已通过上述方式直接验证;
Windows 特有的部分(用于 `claude.cmd` 的 `shell:true`、路径分隔符)已按设计
要求实现,但尚未在真实的 Windows 机器上运行过 —— 在有人确认之前,请将该组合
视为未经验证。

## 许可证

MIT
