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

<!-- okf-benchmark: 2026-07-16-v3 -->

**OKF 不会让你免于探索。它存储的是探索永远找不到的东西。**

这句话的两半都在下面用真实的开源仓库测量过，每个对比格 n=15。其中不利于 OKF 的那一半先公布。

### 测量方法

两个固定版本的公开仓库——不用合成 fixture，这样探索的成本就是探索的真实成本，无记忆基线也就真有可能赢：

| 角色 | 仓库 | commit |
|---|---|---|
| 代码库 | [slimphp/Slim](https://github.com/slimphp/Slim) | `80900fb3`（125 个 PHP 文件） |
| 文档堆 | [rust-lang/rfcs](https://github.com/rust-lang/rfcs) | `f635361c`（651 个 Markdown 文件） |

每个 bundle 里的每一个 concept 都由真实流水线产出——真实的 `claude -p` 会话探索固定版本的仓库、真实的 Claude Code transcript、真实的 batch ingest、真实的 gate。**没有任何 concept 是手写的。** 这些 bundle 已提交到本仓库（[docs/benchmarks/bundles/](docs/benchmarks/bundles/)），因此你可以读到下面每个数字所依据的确切 gate 文本和 concept 正文，并像 v2 被证伪的方式那样证伪本次运行——从仓库出发，无需信任作者。

五个条件。全部拿到完全相同的工具（`Read`、`Glob`、`Grep`、`Bash(git log/show/diff/blame/grep)`）和完全相同、对条件中立的指令——没有任何条件被告知要去查 gate。gate 通过**真实的 `SessionStart` 钩子**（`additionalContext`）投递，而不是前置到 prompt 里；每次运行都会核验投递的字节数。

- **zero-base** — 什么都没有。OKF 声称要替换掉的就是它。
- **answer key（答案纸）** — 答案直接贴进去。要产出那段字符串，你必须已经知道答案，所以没有用户能处在这个条件里。它是一条底线，不是竞争者。
- **OKF** — 真实的 gate 文本。
- **wrong knowledge（错误知识）** — 尺寸匹配的 gate，装的是关于*另一个*仓库的真实 concept。用来区分「是知识帮了忙」和「是 gate 帮了忙」。
- **CLAUDE.md** — 同样的累积知识，粘贴进一个扁平文件。真正的现任者。

`total_cost_usd` 是头条指标；仅 sonnet 的成本列在总成本旁边，这样 CLI 为内部工作解析出的 `claude-haiku`（占开销的 2.3%）就能被扣除，也无法藏起某个结论。效率只在回答正确的运行之间比较。每个回答按 **atom** 评分——ground truth 被拆成可独立核验的事实，并在测量前冻结——而 v2 风格的二元评分（所有 atom 全对）列在它旁边。每次运行的 nonce 使 prompt 缓存失效。**没有任何数字在场景之间取平均。**

设计、预测和证伪标准 R1–R5 都已[预注册](docs/benchmarks/pre-registration-2026-07-16-v3.md)，并在**第一次付费调用之前**提交。那份文档还详细记录了本基准测试上一版（v2）公布时所做的六条虚假或缺乏支撑的陈述，以及每一条是如何从它自己的原始数据中被查出来的。

### OKF 输在哪：任何代码能回答的问题

五个场景，答案都在源码、git 历史或 bundle 里，每一个都从固定版本的 checkout 验证过。成本取回答正确的运行的中位数，并附上其分布范围。

| 场景 | zero-base | OKF | 结论 |
|---|---:|---:|---|
| `rfcs_cheap` — 一次 grep | **$0.062** · 13/15 | $0.077 · 14/15 | OKF 贵 1.2× |
| `slim_cheap` — 一次 grep | **$0.067** · 14/15 | $0.114 · 15/15 | OKF 贵 1.7× |
| `rfcs_buried` — 在 651 篇文档里找出理由 | **$0.097** · 12/15 | $0.112 · 13/15 | OKF 贵 1.2× |
| `slim_buried` — 跟踪一条五文件调用链 | $0.277 · 13/15 · **10 次工具调用** | **$0.232** · 9/15 · **8 次工具调用** | OKF 更便宜、工具调用更少 |
| `slim_stale` — bundle 里的知识被后续 commit 弄过时了 | 关键 **15/15** | 关键 **15/15** | 打平——见下文 |

**在便宜的 grep 上 OKF 是纯粹的开销**——同样的答案要贵 1.2–1.7×，因为 gate 是一项 `grep` 并不需要的固定成本。它只在探索确实昂贵的地方才划算：`slim_buried` 要跟踪一条五文件调用链，在那里 OKF 更便宜、工具调用更少。这不是缺陷，这是算术——如果一次 grep 就能回答你的问题，别为 gate 付费。

`slim_stale` 正是按 atom 评分体现价值的地方。bundle 携带了一条被后续 commit 弄过时的断言，而二元评分在**每个条件下都读作 0/15**——看起来像是全盘覆没。其实不是。*关键* atom（问题真正问的东西——HTML 渲染器会转义、用的是哪个函数和哪些 flag）是 **15/15**：模型读了代码，把核心事实答对了。它唯一漏掉的 atom 是问题从未问及的出处（引入转义的那个 commit SHA）。过时的知识**并没有**让它自信地答错——预注册里「它会」的那条预测是错的，而单看二元评分会把这一点藏起来。

### 探索帮不上忙的地方：代码里不包含的知识

团队政策在对话里定下来，从未写进仓库。RFC 堆里甚至藏着一个陷阱：在里面搜 MSRV 政策，文档提议的是 `N-2`——而团队的实际规则并非如此。

| 场景 | zero-base | OKF | 错误知识 | CLAUDE.md |
|---|---:|---:|---:|---:|
| `rfcs_policy` — 团队的「解冻规则」：等待期、MSRV 节奏、两条例外 | **0/15** | **11/15** · $0.075 | — | 15/15 · $0.144 |

**zero-base 15 战 0 胜。** 它花了钱，什么也没得到，因为答案不在仓库里——这一点由一位对手验证过，他搜索了工作树、git 历史、commit message、文档和配置，零命中。陷阱也没有抓住它；它只是根本无法作答。

OKF 答对了 **15 题中的 11 题**，成本约为携带同样事实的 CLAUDE.md 的一半。这正是探索做不到、而一条存下来的决定能做到的事。**CLAUDE.md 也答得出来**（15/15）——OKF 在这里并不独一无二，它只是同一个现任者的一种更便宜、注入量有上限的形式。本场景的 `wrong knowledge` 对照被排除：一个测量污染 bug（见下）让它读到了答案，因此本次运行它无法充当「光有 gate 帮不上忙」的那个对照。

这是一个干净的政策场景，不是三个。另外两个（`slim_policy`、`slim_domain`）测量过，随后被**排除**——见下文。

### 这次运行无法告诉你的事

- **两个政策场景因污染被排除。** Claude Code 会把按目录划分的项目记忆（`~/.claude/projects/<cwd>/memory/`）自动注入每次会话。在构建知识时，一个探索目标仓库的 `claude -p` 会话把团队决定存进了那份记忆，而由于测量在同一个工作目录里进行，那份记忆甚至到达了**本不应有任何知识的 zero-base** 条件。在 `slim_domain` 上，zero-base 于是「答出了」一个代码里根本不存在的团队决定，15/15。任何 zero-base 运行读到了项目记忆的场景都被排除在发布之外（`slim_domain`、`slim_policy`）；测试框架现在会在测量前清除那份记忆，报告也会机械地检测并排除这类场景。上面那些干净的场景没有任何一次读取记忆。
- **对比条件 n=15，对照条件 n=5。** 很小。只有分布之间完全分离才被称作赢。
- **两个仓库，两种生态（PHP + Markdown）。** 不主张跨规模或跨语言的普适性。第三个仓库设计过，随后在花钱之前因每份可信度的成本不划算而被否决。
- **单问题会话。** OKF 的固定 gate 成本是每个问题付一次，而不是分摊到真实的多问题会话里，所以本次运行*低估*了 OKF。
- **裁判是单一的 LLM 家族**，按 atom 对照从源码验证过的 ground truth 评分。

证伪标准 **R1–R5 全部经机械评估，无一触发**（在排除被污染的格之后）——本次运行没有证伪该主张。这与 n=15 下的有力确认不是一回事；它只是没有出现证伪。

### 本地开销（不是效果基准结果）

2026-07-16 测量，macOS arm64，Node `v26.4.0`，中位数附最小/最大值。

| 本地操作 | 中位数 | 范围 |
|---|---:|---:|
| SessionStart gate 进程 | 57.3 ms | 56.1–60.0 ms |
| SessionEnd batch 触发进程 | 40.1 ms | 39.3–40.8 ms |
| statusline 进程 | 35.8 ms | 34.6–36.3 ms |

用 `node test/bench.mjs [仓库]` 复现。只测本地进程成本；它不证明关于 token 或模型延迟的任何事。

### 成本、复现与链接

这 440 次测量运行花了 **$66.26**，外加 **$14.74** 的评分费用；知识和 bundle 构建又加了约 $3.2。本次运行总计 ≈ **$84**。付费、需认证，并且刻意排除在冒烟测试和 CI 之外。

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-knowledge.mjs --target slim --dir <repo>   # real sessions → transcripts
OKF_RUN_LIVE_BENCH=1 node test/bench-bundles.mjs --target slim --levels 20      # real batch → bundle
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                                    # measure
```

[完整报告](docs/benchmarks/okf-benchmark-2026-07-16-v3.md) ·
[raw JSON](docs/benchmarks/raw/) ·
[已提交的 bundle](docs/benchmarks/bundles/) ·
[预注册](docs/benchmarks/pre-registration-2026-07-16-v3.md) ·
[使用指南](docs/USAGE.md)。

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
