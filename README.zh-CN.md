# OKF for Claude Code

**你的 agent 把你昨天告诉它的一切都忘光了。这个插件解决这个问题 —— 而且它建立起来的记忆，
是一个归你所有的 markdown 目录，不是一个把你锁死的数据库。**

![MIT license](https://img.shields.io/badge/license-MIT-blue) ![OKF v0.1](https://img.shields.io/badge/OKF-v0.1%20Draft-4ecdc4) ![Node only](https://img.shields.io/badge/runtime-Node%20only-5c6bc0) ![no npm install](https://img.shields.io/badge/dependencies-vendored-66bb6a)

**[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · 简体中文 · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português](README.pt-BR.md)**

![OKF 知识图谱 —— 概念与它们所描述的代码相互链接](docs/okf-graph.png)

<sub>`/okf:okf-visualize` —— 你的知识（带描边的节点）和你的代码库在同一张图里。
黄色虚线才是重点：每个概念都连到它实际在谈论的源文件。</sub>

每次会话都从零开始。你一遍遍重新解释同一个架构决策、同一条部署策略、同一句"那个我们试过，
结果崩了" —— 而会话一结束，这些又全没了。与此同时，本来*能*回答这些问题的知识散落在
wiki、代码注释里，以及正如 Google 的 OKF 公告所说的，"少数几位资深工程师的脑子里"。

这个插件自动闭合这个循环：它捕获你实际讨论过的内容，把其中可复用的部分提炼成一个结构化的
知识包，并在每次会话开始时把这些知识重新摆到模型面前。

## 这个格式

知识以 **[OKF（Open Knowledge Format）](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)** 存储 ——
这是 Google Cloud [于 2026 年 6 月发布](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/?hl=en&utm_source=pytorchkr&ref=pytorchkr)
的一份开放规范（v0.1 Draft，Apache-2.0）。它刻意做得毫不起眼，而这恰恰是重点：

> "The format is intentionally minimal: a directory of markdown files with YAML
> frontmatter. There is no schema registry, no central authority, and no required
> tooling. **If you can `cat` a file, you can read OKF; if you can `git clone` a
> repo, you can ship it.**"

（大意：该格式刻意保持极简 —— 就是一个装着带 YAML frontmatter 的 markdown 文件的目录。
没有 schema 注册中心，没有中央权威，也不需要任何特定工具。**能 `cat` 一个文件，就能读 OKF；
能 `git clone` 一个仓库，就能分发它。**）

OKF 把 [Andrej Karpathy 在十周前勾勒出的](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
"LLM wiki"模式正式规范化了 —— Google 的公告里明确这么说。发布以来，围绕它已经形成了一个由
生成器、linter、查看器和 MCP server 构成的[小生态](https://github.com/search?q=%22open+knowledge+format%22&type=repositories)，
而且这个格式在 Google 之外也开始出现（AWS 有一个把 Glue 数据库以 OKF 包形式提供的[示例](https://github.com/aws-samples/sample-okf-llm-wiki)）。
现在还很早期 —— 那个生态里大部分东西都只有几周大 —— 但这个格式确实在兑现它的主张：
离开作者的工具也照样读得懂。

**为什么是一个格式，而不是一个记忆产品。** mem0、Letta、Zep、Cognee 这类工具是记忆*运行时* ——
你接入一个库或者自己托管一个服务，然后你的记忆就住在它的向量库或图数据库里。它们属于另一个
层次，不是竞争对手；其中一些甚至可以用来存 OKF。实际的区别在于**退出成本**：嵌在图数据库里
的知识只有那个系统读得懂，而一个 OKF 包可以在你的编辑器里打开、在 GitHub 上渲染、在 pull
request 里做 diff，任何别的 agent 不需要经过转换就能读。这个插件从不要求你把唯一的一份副本
托付给它。

## 它做什么

1. **捕获**每次会话结束时的完整对话，无损保存。
2. 在后台**压缩**已捕获的会话（一个见机执行的批处理任务，不是 cron/定时任务），用
   `claude -p` 提取可复用的知识 —— decisions、project facts、preferences、patterns、
   references、troubleshooting。
3. 把这个知识包的索引作为一道强制关卡**注入**到每次新会话的上下文中，让 Claude 在动手做
   相关工作之前真的去读过去的相关知识，而不是每次都从零开始。
4. 把知识包和你的代码库**可视化**成同一张图，把每个概念连到它实际在谈论的文件上
   （`/okf:okf-visualize`）。

所有东西都放在 `~/.claude/okf`（或 `$CLAUDE_CONFIG_DIR/okf`）下的一个本地 git 仓库里。
什么都不会被推送到任何地方。唯一的网络请求，就是你本来就在发的那些 Anthropic API 调用 ——
批处理这一步不过是又一次在本地执行的 `claude -p`。

## 环境要求

- 支持插件的 Claude Code
- Node.js（`claude` 本身要求什么就是什么 —— 不需要额外的运行时）
- git

不需要 `npm install`。不依赖外部服务。开始使用不需要任何配置。

## 安装

```
claude plugin marketplace add dja1369/okf-system
claude plugin install okf@okf-marketplace
```

（如果改从本地 clone 安装：`claude plugin marketplace add /path/to/your/clone`。）

就这样 —— 重启会话，gate 和 capture 的 hook 就生效了。下次会话启动时，知识包会自动完成
初始化（在 `~/.claude/okf` 下创建一个带基础结构的本地 git 仓库）。

卸载：`claude plugin uninstall okf`。你在 `~/.claude/okf` 里的数据原封不动 —— 那就是个
普通的 git 仓库，你可以查看、备份，或者用 `rm -rf ~/.claude/okf` 手动删掉。

## 用法

日常使用不需要你做任何事。捕获和批量压缩都是自动的。另有五个命令可供手动查看/控制 ——
**注意 `okf:` 前缀**，它是必需的，因为这些是插件作用域的命令：

| 命令 | 作用 |
|---|---|
| `/okf:okf-status` | 报告上次批处理运行、待处理的会话、锁的状态 |
| `/okf:okf-batch` | 立即强制执行一次批处理（忽略间隔关卡，但仍然遵守锁） |
| `/okf:okf-config` | 显示当前配置，并允许你编辑 |
| `/okf:okf-index` | 打印知识包的可读概览 —— 所有分类和概念标题，外加最近的 `log.md` 变更 |
| `/okf:okf-visualize` | 把知识包 + 你的代码库渲染成一张交互式图（自包含的 HTML） |

全新安装并不是空的：知识包预置了一批概念，分别描述 OKF 本身、这个插件的架构，以及知识包的
写作规则 —— 这样从第一次会话起，关卡就有真东西可以指向，而知识包本身也成了自己的文档。

## 可视化

`/okf:okf-visualize` 把你的知识和你的代码渲染成一张图。有意思的不是其中任何一半 —— 而是两者之间
的虚线连接，它把每个概念连到它真正在谈论的源文件上。

如果 [Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) 已经分析过这个
仓库（`.understand-anything/` 或 `.ua/knowledge-graph.json`），就会采用它那份由 LLM 总结、
信息更丰富的图。否则就由这个插件自带的分析器构建一份 —— 纯 Node，不用原生模块，从 JS/TS、
Python、Go、Rust、Java/Kotlin、Ruby、PHP、C/C++、C# 和 Swift 中提取文件、函数、类以及
import 关系图。

输出是一个自包含的 HTML 文件：没有 CDN，没有网络请求，没有后端。它离线就能打开，因为打开
你自己的知识库不该往任何地方打电话。

## 工作原理

![架构：会话被捕获进 raw，后台批处理把它提炼成一个 OKF 知识包，知识包的索引再被注入到下一次会话](docs/architecture.svg)

- **捕获**就是纯粹的文件复制 —— 不解析，不过滤，不限制大小。每次 `SessionEnd` 都把完整的
  对话记录写进 `raw/`。这是刻意的设计：基于残缺记忆建起来的知识库，比没有还糟。
- **压缩**只在批处理时发生，而且是在一份临时副本上做 —— 捕获下来的原件从不会被碰。它运行时
  的工具权限被限制在 `Read/Glob/Grep/Write/Edit`（没有 `Bash`），并且在那一次调用里把*你*的
  所有其他 hook、插件和 MCP server 全部禁用（`--safe-mode`），这样它就不会反过来把自己也
  捕获进去。
- **关卡**注入的是一份紧凑的分类索引（不是概念全文）外加最近的变更，并要求 Claude 在动相关
  工作之前真的去 `Read` 对应的文件 —— 光有索引，还不足以让它凭着过时的假设就动手。
- 一个结构 linter 保证知识包始终符合规范：如果某次批处理会留下任何格式不合法的东西，它会在
  commit 之前自动回滚。

格式的背景和设计理由，见 Google Cloud 的 [Open Knowledge Format 公告](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/?hl=en&utm_source=pytorchkr&ref=pytorchkr) —— 它不过是带 YAML frontmatter 的
markdown 文件，任何工具都能读，并不是这个插件专有的东西。

## 配置

直接编辑 `~/.claude/okf/.okf/config.md`（frontmatter），或者用 `/okf:okf-config`。

| 键 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关（捕获、gate 和批处理都跟着它走） |
| `batch_interval_hours` | `1` | 两次批处理之间的最小间隔 |
| `batch_max_digest_kb` | `600` | 单次运行的 digest 总字节预算 —— 真正的成本上限。超出预算的会话顺延到下一次运行 |
| `batch_max_sessions` | `50` | 仅作安全上限；真正起调节作用的是 `batch_max_digest_kb` |
| `seed_language` | `en` | 首次初始化时预置概念的语言（`en`、`ko`；未知值回退到 `en`） |
| `batch_model` | `claude-sonnet-5` | 批量摄取所用的模型；留空 = CLI 默认值 |
| `batch_effort` | `medium` | 批量摄取的推理强度（`low`/`medium`/`high`/`xhigh`/`max`）；留空 = CLI 默认值 |
| `capture_exclude_cwd` | `[]` | 跳过捕获的目录 glob 模式（只能选择退出 —— 捕获本身永远不会是部分的） |
| `batch_digest_cap_kb` | `150` | 面向 LLM 的摘要的单会话大小上限（捕获下来的原件永远不设上限） |
| `remove_candidate_ttl_days` | `30` | 已处理的原始对话记录在删除前保留多久 |
| `inject_max_lines` / `inject_max_bytes` | `120` / `16384` | 关卡注入的大小上限 |
| `claude_bin` / `node_bin` | *（留空）* | 当你的环境中 `PATH` 解析失败时，用于覆盖的绝对路径 |

## 数据与隐私

- 一切都留在本地：`~/.claude/okf` 是它自己独立的普通 git 仓库，与你恰好正在工作的任何仓库
  完全分离。**这个插件里没有任何一条代码路径会对它执行 `git push`、`git remote add`
  或任何与网络有关的操作** —— 整个代码里用到的 git 操作只有 `init`、`commit`、`checkout`
  和 `clean`（可自行验证：`grep -n "push\|remote" lib/*.mjs bin/*.mjs` —— 唯一的匹配项是
  不相关的 `Array.push()` 调用）。除非你自己刻意去 `git push`，否则你的知识包永远不会离开
  你的机器。
- 批处理这一步会把会话内容发送到 Anthropic API 来做总结/提取 —— 就是你平时用 Claude Code
  本来就在通信的那个 API，只是多走一次 `claude -p` 调用。不涉及任何第三方服务。
- `raw/`（捕获到的完整对话记录）以及已处理但待删除的记录都被 git 忽略，不会提交 —— 提交的
  只有提取出来的知识包。

## 可移植性

没有任何路径是硬编码的 —— 一切都通过 `os.homedir()` / `process.env.CLAUDE_CONFIG_DIR` /
`process.env.HOME` 解析，所以在另一台机器或另一个用户账号上全新安装，会得到属于它自己的、
独立的知识包。这一点由测试套件（`test/smoke.mjs`）在隔离的
`HOME`/`CLAUDE_CONFIG_DIR` 沙箱中验证，其中包括一个**完全没有配置 git 身份**的场景 ——
这个插件从不依赖你的 `user.name`/`user.email`；它自己的自动提交始终使用一个固定的合成身份
（`OKF Batch <okf-batch@localhost>`）。macOS 和 Linux 是按这种方式直接跑过的；Windows
特有的部分（`claude.cmd` 用 `shell:true`、路径分隔符）是按设计文档的要求实现的，但还没有在
真正的 Windows 机器上跑过 —— 在有人确认之前，请把这个组合视为未经验证。

## 许可证

MIT
