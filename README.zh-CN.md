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

首次 `SessionStart` 会创建 `~/.claude/okf`（或 `$CLAUDE_CONFIG_DIR/okf`）。此后的捕获和机会式 batch ingest 自动进行。

## 连续性流程

```text
会话 1 的决定 -> SessionEnd 无损 raw 副本 -> 后台 batch 生成 OKF Markdown -> 会话 2 注入索引 -> Read 相关 concept
```

例如，会话 1 确定“按 10% → 50% → 100% 发布，错误率超过 0.5% 时回滚”。capture 和 ingest 后，新会话无需用户再次粘贴即可通过索引找到准确政策。索引只是路由层；Claude 在执行前仍需 `Read` concept 正文。

## 命令

| 命令 | 用途 |
|---|---|
| `/okf:okf-status` | 最近 capture/batch、待处理会话和锁状态 |
| `/okf:okf-batch` | 在尊重锁的前提下立即 ingest |
| `/okf:okf-config` | 查看或编辑经过验证的配置 |
| `/okf:okf-index` | 查看分类、concept 标题和最近变更 |
| `/okf:okf-visualize` | 仅显示 OKF concept 与 concept 之间的关系 |
| `/okf:okf-analysis [路径]` | 分析代码库，并只显示相关 OKF concept |

`visualize` 不扫描代码库。`analysis` 会拒绝不存在或非目录的路径，显示 truncated、被隐藏的无关 concept，以及各语言的文件/声明/internal edge 统计。两者生成的 HTML 均自包含，不使用外部 CDN，也不在运行时联网。

## 可选状态栏

`bin/statusline.mjs` 不联网、不分析完整图，只输出如 `OKF 12 · +3 · 2h ago` 的一行状态。Claude Code 只允许一个 `statusLine`，因此 OKF 不自动安装或覆盖它。可在现有脚本中追加 `node /path/to/okf/bin/statusline.mjs` 的输出。

## OKF 效果基准

<!-- okf-live-benchmark: valid-2026-07-15T16-06-28Z -->

**OKF 不省 token，它只是找回新会话已经丢掉的东西。** 公开下面这些数字，就是因为它们把这一点说得很直白。

### 测的是什么

让后续会话回答前一个会话确立的 8 项事实，外加一道记忆帮不上忙的对照题：架构（SQLite / repository pattern）、编码规则（named export only）、过往事故修复（`busy_timeout=5000`）、响应偏好（韩语 / 简洁）、文件与部署策略（`src/config.mjs` / `npm run deploy:canary`），以及无关算术对照（7 × 8 = 56）。

5 个条件，各跑 5 次交叉顺序。C 的 bundle 由真实的 SessionEnd capture → 隔离 batch ingest → SessionStart gate 生成，没有手工种入 concept；preflight 先确认 C 确实包含并由 gate 路由每一项目标事实、D 一项都没有，否则拒绝花钱。

- **A — no memory**：诚实的现状。新会话，什么都不复述。
- **B_oracle（答案纸）**：原样粘贴 8 个期望值。要写出这段话，你必须已经知道 OKF 想帮你找回的每一项事实——**没有用户能处在这个条件里**，它是上界而不是基线，而且它的人力成本被计为零。
- **B_realistic**：人们实际会做的事——把可能相关的都复述一遍，因为你无法预知下个会话需要哪一条。这就是 CLAUDE.md 的习惯。
- **C — OKF enabled**。
- **D — irrelevant OKF**：gate 里没有相关内容，用来区分「gate 帮了忙」和「gate 本身有成本」。

### 结果

2026-07-15 live 实验：Claude Code `2.1.210`，`sonnet`/medium（Sonnet 5 + Haiku 4.5），macOS arm64，Node `v26.4.0`，每条件 5 次。C preflight：事实 8/8 存在、8/8 由 gate 路由；D 为 0/8。

| 条件 | 连续性成功 | token activity p50 | wall p50 | cost p50 | 读文件 | 轮次 |
|---|---:|---:|---:|---:|---:|---:|
| A — no memory | **0/5** | 27,246 | 13.82 s | $0.022218 | 2 | 4 |
| B_oracle（答案纸） | 5/5 | 9,069 | 4.86 s | $0.008410 | 0 | 1 |
| B_realistic | 5/5 | 9,069 | 5.96 s | $0.008410 | 0 | 1 |
| **C — OKF enabled** | **5/5** | **10,395** | 6.46 s | $0.011329 | **0** | **1** |
| D — irrelevant OKF | 0/5 | 20,602 | 14.50 s | $0.025879 | 1 | 2 |

**先看 A 这一行。** 没有记忆的会话烧掉 27,246 token，翻了两个文件找答案，用掉四轮——结果仍是 **0/8**。这才是 OKF 真正替换掉的条件，而 C 赢过它：token 少 2.6 倍，0/8→8/8，一轮之内、零次读文件。

**C 赢不了 B，也永远赢不了。** B 把答案直接贴进 prompt，没有任何检索能快过「本来就有」。当前 bundle 规模下 B_realistic 等于 B_oracle（还没有无关知识需要复述），所以两者都是 9,069。C 每会话多花 1,326 token、多花 $0.0029。建 bundle 的那一次 batch ingest 花掉 **133,364** token activity 和 **$0.176758**。**不存在 token 或成本的盈亏平衡点**——`perSessionTokenSaving` 为负，harness 直接报 `null`，不会编一个出来。

与上次相比，变的是 gate 本身。C 过去要 **22,857** token、7 轮、5 次读文件，现在是 **10,395** token、1 轮、0 次读文件，recall 同样是 5/5。旧 gate 强制一次无条件 `Read`，而它 91% 的开销就是这趟往返——去取 index 早就给出的事实。参见[修复](https://github.com/dja1369/okf-system/pull/7)。

### 累积极限——实测，不是推演

「知识越积越省」这个说法经不起测量。给 bundle 加 50 个无关 concept 再跑同一基准，**preflight 直接失败**：

```
checkedFacts: 8   presentFacts: 8   routedFacts: 6   ready: false
```

两项事实（`architecture_pattern`、`export_style`）在 `decisions/tech-stack.md` 里，而这个文件**被挤出了注入的 index**——filler concept 按字母序排在它前面。gate 的 index 被硬性截断以守住 Claude Code 的 10,000 字符 hook 上限，而真实韩语 concept 行约 214 字节：

| bundle 内 concept 数 | gate index 显示 |
|---:|---:|
| 20 | 20 |
| 40 | 40 |
| **55** | **43**（截断） |
| 100 | 43（截断） |

**超过约 43 个 concept，index 就开始截断**，留下谁由文件名决定——不看相关性，也不看新旧。各类别轮流分配，不会有类别被饿死；被截断的类别会指向自己的 `index.md`，其余内容仍可下钻拿到。但下钻就是一次 tool 往返，正是 gate 修复刚刚干掉的那笔成本。所以过了这个点，OKF 的经济性只会变*差*，不会变好。这是设计的诚实现状，不是一个可调参数。

harness 还记录决定遵循率、错误假设、额外问题、tool call、首次有效响应、API/wall time、`input_tokens`、`output_tokens`、`cache_creation_input_tokens`、`cache_read_input_tokens` 和 CLI 报告成本；raw JSON 保留独立 token 类别。注意 `tokenActivity` 把 cache read 与 output token 按 1:1 相加，而 cache read 计费便宜约 50 倍——**成本才是站得住的那一列**；且 n=5 时 harness 的 `p95` 在算术上必然等于最大值（也就是冷启动那一次），故此处不列。CLI 无法单独提供的 user-only 或 gate-only token 保持 `null`，不会估算。

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                      # 如上文发布
OKF_RUN_LIVE_BENCH=1 OKF_BENCH_FILLER=50 node test/bench-okf.mjs  # 累积轴
```

该命令付费且需认证，不进入 CI。参见[报告](docs/benchmarks/okf-live-2026-07-15T16-06-28-592Z.md)、[raw JSON](docs/benchmarks/raw/okf-live-2026-07-15T16-06-28-592Z.json)和[解释指南](docs/USAGE.md)。修复前的旧实验作为审计记录保留。

### 本地开销（不是效果基准）

2026-07-15，macOS arm64，Node `v26.4.0` 的新测量：

| 操作 | 中位数 | 范围 |
|---|---:|---:|
| SessionStart gate 进程 | 57.4 ms | 56.7–58.2 ms |
| SessionEnd 无损 capture 进程 | 43.4 ms | 41.8–43.9 ms |
| statusline 进程 | 36.7 ms | 34.8–36.8 ms |

用 `node test/bench.mjs [仓库]` 复现。这只测本地 hook/process，不证明 token 或模型响应改善。

### Batch 成本和盈亏平衡

```text
初始 OKF 成本 = batch ingest + repair + 实测无关 gate 开销
每会话净节省 = B_realistic 中位数 - OKF 中位数
盈亏平衡会话数 = ceil(初始 OKF 成本 / 正的每会话净节省)
```

对比基准是 **B_realistic**，不是 B_oracle。B_oracle 的复述文本里本就含有答案，等于把 OKF 存在的意义定价为零，对它算盈亏平衡毫无意义。本次实测无论跟哪个比，节省都是负的（−1,326 token、−$0.0029），因此两个盈亏平衡字段都报 `null`。这是结果本身，不是 harness 的缺口。

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

- `SessionEnd` 把完整 transcript 无损复制到 `raw/`。
- batch 生成有上限的 digest，并通过额外的 `claude -p` 发送给 Anthropic；这是 OKF 新增的唯一模型/API 传输。
- batch 使用 `--safe-mode`、受限工具、stdin prompt、lint/rollback，且没有 Bash。
- raw transcript 被 git-ignore；只在本地 commit 提取出的 Markdown。插件不会 push 或添加 remote。
- POSIX 目录权限为 `0700`，raw/state/log 为 `0600`。持久日志不含 transcript、Claude stdout/stderr、credential 或完整 raw 路径。
- live fixture 是无个人信息和 credential 的合成数据。

## 配置和删除

使用 `~/.claude/okf/.okf/config.md` 或 `/okf:okf-config`。主要默认值：`enabled: true`、`batch_interval_hours: 1`、`batch_max_digest_kb: 600`、`batch_digest_cap_kb: 150`、`remove_candidate_ttl_days: 30`、`inject_max_lines` / `inject_max_bytes` 为 `120` / `9000`。未知或无效值回退到安全默认值。

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
