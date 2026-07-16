# OKF for Claude Code

**把过去 Claude Code 会话中的决定变成下一次会话真正能使用的、本地且可审查的知识库。**

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · **简体中文** · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português](README.pt-BR.md)

OKF 在会话结束时无损捕获对话，把可复用的决定和故障处理提炼为 Markdown，并在下次会话注入紧凑索引。知识库是你可以查看、diff、备份或删除的本地 git 仓库。

## 一分钟快速开始

需要支持插件的 Claude Code、Node.js 和 git；无需 `npm install`。

```sh
claude plugin marketplace add dja1369/okf-system
claude plugin install okf@okf-marketplace
```

重启 Claude Code，正常结束一次会话，然后运行：

```text
/okf:okf-status
/okf:okf-index
```

首次 `SessionStart` 会创建 `~/.claude/okf`（或 `$CLAUDE_CONFIG_DIR/okf`）。此后的收集和机会式 batch ingest 都自动进行；对话会在最后一次活动约 1 小时后被收集，因此无需显式结束会话。

## 连续性流程

```text
会话 1                  ~1 小时空闲               后台 batch                  会话 2
做出决定          ->    sweep 收集 raw   ->      提炼出可复用的 OKF Markdown ->  注入紧凑索引
（无需显式结束             （无损复制；                  |                            |
 会话）                    有增长会重新收集）           +-- 本地 git 历史            +-- Read 相关 concept
```

为什么基于空闲判定？会话很少会显式结束——后台 agent 更是从不会——而过去在 `resume` 时抓取快照的做法会把会话中途冻结为“已处理”，之后说的内容就此丢失。因此 sweep 会在会话安静了 `sweep_min_idle_minutes`（默认 60 分钟）之后才收集它；batch 进程会持续轮询直到待处理会话进入空闲（约每 5 分钟一次，最长 8 小时）；已收集的会话只有在之后又增长时才会被**再次**收集；未变化的会话永远不会被重新收集。会话钩子只是唤醒 batch。

例如，会话 1 确定“按 10% → 50% → 100% 发布，错误率超过 0.5% 时回滚”。capture 和 ingest 后，新会话无需用户再次粘贴即可通过索引找到准确政策。索引只是路由层；Claude 在执行前仍需 `Read` concept 正文。

## 命令

| 命令 | 用途 |
|---|---|
| `/okf:okf-status` | 最近一次 batch、待处理会话和锁状态 |
| `/okf:okf-batch` | 在尊重锁的前提下立即 ingest |
| `/okf:okf-config` | 查看或编辑经过验证的配置 |
| `/okf:okf-index` | 查看分类、concept 标题和最近变更 |
| `/okf:okf-visualize` | 仅显示 OKF concept 与 concept 之间的关系 |
| `/okf:okf-analysis [路径]` | 分析代码库，并只显示相关 OKF concept |

`visualize` 不扫描代码库。`analysis` 会拒绝不存在或非目录的路径，显示 truncated、被隐藏的无关 concept，以及各语言的文件/声明/internal edge 统计。两者生成的 HTML 均自包含，不使用外部 CDN，也不在运行时联网。

## 可选状态栏

`bin/statusline.mjs` 不联网、不分析完整图，只输出如 `OKF 12 · +3 · 2h ago` 的一行状态。Claude Code 只允许一个 `statusLine`，因此 OKF 不自动安装或覆盖它。可在现有脚本中追加 `node /path/to/okf/bin/statusline.mjs` 的输出。

## OKF 基准测试

<!-- okf-benchmark: 2026-07-16 -->

> **撤回声明（2026-07-16）。** 本节最初公布的三条主张，在对本次运行自身的原始数据做过审计后已被撤回：`rfcs_policy` 的陷阱解释（属于编造——陷阱一次都没触发）、累积趋势的头条结论（其样本并不支持），以及本节原来的标题「OKF 是唯一管用的东西的地方」（被它自己的表格证伪）。每一条撤回都标在原主张所在的位置。撤回了什么、每一条又是如何被查出来的，记录在 [v3 预注册](docs/benchmarks/pre-registration-2026-07-16-v3.md)。本节其余的发现保持不变。

**OKF 不会让你免于探索。它存储的是探索永远找不到的东西。**

这句话的两半都在下面用真实的开源仓库测量过，而且不利于 OKF 的那一半先公布。

### 测量方法

两个固定版本的公开仓库——不用合成 fixture，这样探索的成本就是探索的真实成本，无记忆基线也就真有可能赢：

| 角色 | 仓库 | commit |
|---|---|---|
| 代码库 | [slimphp/Slim](https://github.com/slimphp/Slim) | `80900fb3`（125 个 PHP 文件） |
| 文档堆 | [rust-lang/rfcs](https://github.com/rust-lang/rfcs) | `f635361c`（651 个 Markdown 文件） |

每个 bundle 里的每一个 concept 都由真实流水线产出——真实的 `claude -p` 会话探索固定版本的仓库、真实的 Claude Code transcript、真实的 batch ingest、真实的 gate。**没有任何 concept 是手写的**，包括那些堆出体量的 filler。

五个条件。全部拿到完全相同的工具（`Read`、`Glob`、`Grep`、`Bash(git log/show/diff/blame/grep)`）和完全相同、对条件中立的指令——没有任何条件被告知要去查 gate。

- **zero-base** — 什么都没有。OKF 声称要替换掉的就是它。
- **answer key（答案纸）** — 答案直接贴进去。要产出那段字符串，你必须已经知道答案，所以没有用户能处在这个条件里。它是一条底线，不是竞争者。
- **OKF** — 真实的 gate 文本。
- **wrong knowledge（错误知识）** — 尺寸匹配的 gate，装的是关于*另一个*仓库的真实 concept。用来区分「是知识帮了忙」和「是 gate 帮了忙」。
- **CLAUDE.md** — 同样的累积知识，粘贴进一个扁平文件。真正的现任者。

`total_cost_usd` 是头条指标；token activity 列在它旁边，而绝不取代它，因为 `cache_read` 主导了那个总和，且计费便宜约 50 倍——这两列在方向上互相矛盾。效率只在回答正确的运行之间比较。每次运行的 nonce 使 prompt 缓存失效。评分由对条件不知情的裁判依照从源码验证过的 ground truth 完成。**没有任何数字在场景之间取平均**：一次 grep 和一条五文件调用链是不同的现象，把它们混在一起等于让场景选择来决定头条。

设计、预测和证伪标准都已[预注册](docs/benchmarks/pre-registration-2026-07-16.md)，并在**第一次付费调用之前**提交。

### OKF 输在哪：任何代码能回答的问题

五个场景，答案都在源码或 git 历史里，从固定版本的 checkout 验证过，并且每一个都经受住了一次独立的证伪尝试。

| 场景 | zero-base | OKF | 结论 |
|---|---:|---:|---|
| `rfcs_cheap` — 一次 grep | **$0.0256** · 4/5 | $0.0505 · 3/5 | OKF 贵 2.0× |
| `slim_cheap` — 一次 grep | **$0.0198** · 4/5 | $0.0386 · 5/5 | OKF 贵 1.9× |
| `slim_stale` — bundle 里的知识被后续 commit 弄过时了 | **$0.0345** · 5/5 | $0.0632 · 4/5 | OKF 贵 1.8× |
| `rfcs_buried` — 在 651 篇文档里找出理由 | **$0.0326** · 4/5 | $0.0910 · 3/5 | OKF 贵 2.8× |
| `slim_buried` — 跟踪一条五文件调用链 | $0.1669 · 2/5 · **10 次工具调用** | **$0.0701** · 2/5 · **3 次工具调用** | **OKF 便宜 2.4×** |

**OKF 五场输四场。** 它只在探索确实昂贵的地方赢，而在那里它把工具调用从 10 次砍到 3 次。如果一次 grep 就能回答你的问题，gate 就是纯粹的开销——这不是缺陷，这是算术。

`slim_stale` 值得点名：bundle 携带了一条过时的断言（HTML 错误渲染器不做转义——在 commit `f897118b` 之前为真，在固定的 commit 上为假），而模型**还是去查了代码并把它纠正了过来**，4/5。过时的知识没有让它自信地答错。预注册里「它会」的那条预测是错的。

### 探索帮不上忙的地方：代码里不包含的知识

团队政策和领域词汇——在对话里定下来，从未写进仓库。每个场景都被一位独立对手攻击过，他搜索了工作树、约 300 个 git 历史修订、commit message、文档、配置、stash 和 dangling object（零命中），并且**在查看之前先记下了一个基于惯例的猜测**。那些猜测得分为 0/3、0/3 和 1/5。

每个仓库还各藏着一个陷阱：grep "emitter" 会找到 `ResponseEmitter`；找 chunk size 会找到 `4096`；在 RFC 堆里搜 MSRV 政策，文档提议的是 `N-2`。

| 场景 | zero-base | OKF | 错误知识 | CLAUDE.md |
|---|---:|---:|---:|---:|
| `slim_policy` — 哪个 env 启用错误详情，以及那条例外 | **0/5**（花掉 $0.0509） | **5/5** · $0.0840 | 0/5 | 5/5 · $0.1314 |
| `slim_domain` — 团队说的「에미터」指什么 | **0/5** · **自信答错 5/5** | **4/5** · $0.0624 | 0/5 | 5/5 · $0.1198 |
| `rfcs_policy` — 团队「解冻规则」的等待期 | **0/5** | 2/5 · $0.0749 | 0/5 | 0/5 |

**zero-base 15 战 0 胜。** 它花了钱，什么也没得到，因为答案根本不在那儿。在 `slim_domain` 上它**5 次运行里 5 次自信地答错**：它探索、找到 `ResponseEmitter`，然后高置信度地作答——而团队的「에미터」是 `OutputBufferingMiddleware`，因为他们跑的是 FrankenPHP worker 模式，`ResponseEmitter` 在那里是死代码。探索在这里不只是失败；它从陷阱里制造出一个自信的错误答案。

**错误知识同样 15 战 0 胜。** 装满真实但不相关 concept 的 gate 什么也救不回来。收益来自知识，而不是来自「有个 gate」。

OKF 答对 15 题中的 11 题，成本比携带同样事实的 CLAUDE.md 低 1.6–1.9×。在 `slim_domain` 上它**一个 concept 文件都没读**（0/5）——只靠 index 行就够了，2 次工具调用，对比 zero-base 的 7 次。

**在这里 CLAUDE.md 同样管用**，表格就是这么说的：`slim_policy` 上 5/5，`slim_domain` 上 5/5，后者还胜过 OKF 的 4/5。这张表支持的结论是：以低 1.6–1.9× 的成本、以及有上限的注入量，达到与现任者持平的准确率——而不是「只有 OKF 行」。本节最初以「OKF 是唯一管用的东西的地方」为标题公布，而它自己的表格证伪了这个标题；**该标题予以撤回。**

`rfcs_policy` 是诚实的失败：OKF 只拿到 2/5。**此处原先给出的解释——躺在文档堆里的 `N-2` 提案是个足够强的陷阱，能把模型从正确的 index 行上拽走——是错的，现予撤回。** OKF 的 5 次运行全都只读了 bundle 文件；没有任何一次打开过 RFC 文档；没有任何一次回答 `N-2`。五次全都回答「4 个 release」。陷阱一次都没触发。2/5 的成因在公布之前并未调查，这里也不提供替代解释；重新测量正在进行中。CLAUDE.md 在这个场景上是 0/5，所以 OKF 在这里依然胜过现任者。

### 累积：趋势主张予以撤回

本节最初公布了一条按 bundle 规模（1 → 35 个 concept）绘制的成本曲线，以及这样一条头条结论：**「从 1 个到 35 个 concept，OKF 变得更便宜（$0.1291 → $0.0908），而 CLAUDE.md 贵了 2.2×（$0.1279 → $0.2828）。两条曲线在分叉。」** **该趋势主张因样本不足以支持而予以撤回。**

这些数字并非编造——它们是只取回答正确的运行所得的中位数，这正是预注册的规则。但它们分别是 **3、2、5、3、2 和 4** 次运行的中位数，而 $0.0701 这个最低点是*两次运行的中位数*。把所有运行都算进来，各 level 的分布完全重叠（1 个 concept 的 level 跨 $0.0774–$0.2214；35 个 concept 的 level 跨 $0.0836–$0.1606），全部运行的中位数根本不是单调的：$0.1237、$0.1884、$0.1425、$0.0852、$0.1142、$0.1135。本节自己在两段之后就写着「在 n=5 下，这里没有任何东西能分得开」——那句话是对的，它上面的头条结论是错的。曲线不再在此重新刊出，因为两次运行的中位数不是曲线上的一个点。

gate 走平的那一段，解释同样是错的。当时把它归因于 batch 把 14 个 concept 折叠成一行 index，并把这说成是 OKF 组织知识的方式所涌现出的性质。**它其实是 `lib/config.mjs` 里的 `inject_max_lines: 120` 上限**——一个配置常量。`bench-bundles.mjs` 会记录 `gateTruncated`，而它恰好在走平开始的那个 level 上为真：index 条目是**因预算被丢弃**，而不是被优雅地嵌套起来。

旧主张有一半站得住，但只能单独陈述：CLAUDE.md 在每次 prompt 里都携带每个 concept 的正文，所以它的 prompt 随 concept 数线性增长。这是那种格式在机械意义上必然如此，并非测量所得。这里不从中引出任何与 OKF 的对比。

准确率不随体量提升，而且一直很吵（2/5–5/5）。**level 轴在 v3 中予以废除**：它测的是一个配置常量，重跑一遍也只是把一个能从配置文件里直接读到的数字量得更精确而已。

### 本地开销（不是效果基准结果）

2026-07-16 测量，macOS arm64，Node `v26.4.0`，中位数附最小/最大值。

| 本地操作 | 中位数 | 范围 |
|---|---:|---:|
| SessionStart gate 进程 | 57.3 ms | 56.1–60.0 ms |
| SessionEnd batch 触发进程 | 40.1 ms | 39.3–40.8 ms |
| statusline 进程 | 35.8 ms | 34.6–36.3 ms |

用 `node test/bench.mjs [仓库]` 复现。只测本地进程成本；它不证明关于 token 或模型延迟的任何事。

### 成本，以及这次运行无法告诉你的事

构建这些知识在真实会话里花了 **$3.59**，在 batch ingest 里花了 **$4.92**。250 次测量运行花了 **$28.16**，外加 **$9.44** 的评分费用。

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-knowledge.mjs --target slim --dir <repo>   # real sessions → transcripts
OKF_RUN_LIVE_BENCH=1 node test/bench-bundles.mjs --target slim --levels 1,5,20  # real batch → level bundles
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                                    # measure
```

付费、需认证，并且刻意排除在冒烟测试和 CI 之外。
[完整报告](docs/benchmarks/okf-benchmark-2026-07-16.md) ·
[raw JSON](docs/benchmarks/raw/) ·
[预注册](docs/benchmarks/pre-registration-2026-07-16.md) ·
[使用指南](docs/USAGE.md)。

限制，直说：

- **每格 n=5。** 很小。这里只有分布之间完全分离才被称作赢。
- **模型组合没有固定。** 请求的是 `claude-sonnet-5`；CLI 在它旁边为内部工作解析出了 `claude-haiku-4-5`。跨条件的成本比较带着这个瑕疵。
- **两个仓库，各一种语言。** 不主张跨规模或跨生态的普适性。
- **不公布 wall-clock。** 测量以并发 5 运行；成本、token 和工具调用不受其影响，响应延迟则会受影响。速度主张需要一次串行重跑。
- gate 文本是前置到 prompt 里的，而不是走生产环境的 `SessionStart` `additionalContext` 路径。文本相同，投递方式不同。
- 政策类场景依赖于由人来撰写政策。政策本来就是这么回事。辩护理由是：答案可证明地不存在于仓库中，而且一位对手也猜不出来。

## 语言支持

fallback analyzer 是确定性的、零依赖并采取保守连接；“发现文件”和“分析结构”会分别报告。

| 语言 | 关系与声明 | 主要限制 |
|---|---|---|
| JavaScript / TypeScript | 相对 import/export/require，function/class | bare package 保持外部 |
| Python | dotted module，function/class | 不解析动态 import |
| Go | 基于 `go.mod` 的内部 package node，function/struct | 不伪造 file edge |
| Rust | `mod`/`use`，function/struct/enum/trait | 省略 macro 生成结构 |
| Java / Kotlin | package/class path，type/Kotlin function | 省略 reflection |
| Ruby | `require_relative`，class/method | gem 保持外部 |
| PHP | namespace/use/alias/grouped use、require/include、主要 type/function | 省略动态 autoload |
| C / C++ | quoted include、带明确路径的唯一 local angle include、主要 type/namespace/function definition | regex 可能漏掉 macro 和复杂多行语法 |
| C# | 仓库声明的 namespace node、主要 type | 外部 namespace 不连接 |
| Swift | 明确 inheritance/conformance/extension、主要 type/function | 为防名称冲突省略 nested cross-file target |

达到 2,000 个文件时标记 `truncated`；超过 512 KiB 的文件保留节点但标记为未分析。

## 真实开源验证

使用固定 commit clone，并把代表性 edge 与源代码逐项核对。时间仅用于运行安全性，不是模型速度基准。

| 仓库 | Commit | 语言文件 | 声明 | Internal edges | Truncated |
|---|---|---:|---:|---:|---:|
| [Slim](https://github.com/slimphp/Slim) | `80900fb` | 125 | 127 | 305 | 否 |
| [Redis](https://github.com/redis/redis) | `f76dff7` | 784 | 5,796 | 990 | 否 |
| [fmt](https://github.com/fmtlib/fmt) | `a79df45` | 46 | 283 | 121 | 否 |
| [Alamofire](https://github.com/Alamofire/Alamofire) | `903c53c` | 98 | 2,052 | 215 | 否 |

验证时发现并修复了 Swift 标准 `Error` 错连到同名 nested type，以及 C 标准 header 错连到 vendored compatibility header。详见[验证报告](docs/benchmarks/oss-analysis-2026-07-15.md)。

## 数据和隐私

- 空闲 sweep 会把完整 transcript 复制到 `raw/`，收集过程中不做解析或截断。会话钩子只是唤醒 batch。
- batch 生成有上限的 digest，并通过额外的 `claude -p` 发送给 Anthropic；这是 OKF 新增的唯一模型/API 传输。
- batch 使用 `--safe-mode`、受限工具、stdin prompt、lint/rollback，且没有 Bash。
- 分析器只在临时工作区里操作知识文件的一份副本，物理上无法访问 `raw/`、`.okf/` 或 `.git`；driver 只会把常规 `.md` 文件写回（脚本和 symlink 永远不会进入 bundle）。
- raw transcript 被 git-ignore；只在本地 commit 提取出的 Markdown。插件不会 push 或添加 remote。
- POSIX 目录权限为 `0700`，raw/state/log 为 `0600`。持久日志不含 transcript、Claude stdout/stderr、credential 或完整 raw 路径。
- live fixture 是无个人信息和 credential 的合成数据。

## 配置和删除

使用 `~/.claude/okf/.okf/config.md` 或 `/okf:okf-config`。主要默认值：`enabled: true`（收集、gate 和 batch 的总开关）、`batch_interval_hours: 1`、`batch_max_digest_kb: 600`、`batch_digest_cap_kb: 150`、`sweep_min_idle_minutes: 60`（最后一次活动后需空闲这么久才会被收集，`0` 表示立即收集）、`remove_candidate_ttl_days: 30`、`inject_max_lines` / `inject_max_bytes` 为 `120` / `9000`。未知或无效值回退到安全默认值。

```sh
claude plugin uninstall okf
```

数据仍保留在 `~/.claude/okf`，可检查、备份后手动删除。

## 开发验证

```sh
node test/smoke.mjs
node test/bench.mjs
for file in $(rg --files -g '*.mjs'); do node --check "$file"; done
claude plugin validate .claude-plugin/plugin.json
claude plugin validate .claude-plugin/marketplace.json
git diff --check
```

live：`OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs`。

## 参考与许可证

README 结构参考了 [uv](https://github.com/astral-sh/uv)、[Ruff](https://github.com/astral-sh/ruff)、[Playwright](https://github.com/microsoft/playwright)、[fmt](https://github.com/fmtlib/fmt)、[Slim](https://github.com/slimphp/Slim) 的简洁安装和可复现表达，但没有复制文字或 benchmark 声明。[OKF specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)。许可证：[MIT](LICENSE)。
