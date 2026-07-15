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

<!-- okf-live-benchmark: valid-2026-07-15T15-03-01Z -->

2026-07-15 live 实验：Claude Code `2.1.210`，`sonnet`/medium（Sonnet 5 + Haiku 4.5），macOS arm64，Node `v26.4.0`，commit `c00d3fc`，每条件5次。调用前 C 的目标事实 8/8 已写入 concept 并由 gate 路由，D 为 0/8。

| 条件 | 连续性成功 | token activity p50 / p95 | wall p50 / p95 | cost p50 |
|---|---:|---:|---:|---:|
| A — no memory | 0/5 | 27,320 / 27,574 | 16.40 / 18.17 s | $0.024037 |
| B — manual restatement | 5/5 | 9,070 / 9,093 | 6.07 / 7.42 s | $0.008410 |
| C — OKF enabled | 5/5 | 22,857 / 22,883 | 11.33 / 12.80 s | $0.033189 |
| D — irrelevant OKF | 0/5 | 21,507 / 22,261 | 16.92 / 18.88 s | $0.030332 |

C 成功回收全部事实，但与同样正确的 B 相比，token activity 中位数多 13,787，wall time 多 5.26 s，未证明效率改善。batch 一次为 111,381 token activity/$0.164360；B−C 为负，因此无盈亏平衡点。

每个条件至少重复 5 次，记录成功率、决定遵循率、错误假设、额外问题、tool call、首次有效响应、API/wall time、`input_tokens`、`output_tokens`、`cache_creation_input_tokens`、`cache_read_input_tokens` 和 CLI 报告成本。raw JSON 保留独立 token 类别，batch/repair 成本计入盈亏平衡。CLI 无法单独提供的 user-only 或 gate-only token 保持 `null`，不会估算。

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs
```

该命令付费且需认证，不进入 CI。参见[有效报告](docs/benchmarks/okf-live-2026-07-15T15-03-01-343Z.md)、[raw JSON](docs/benchmarks/raw/okf-live-2026-07-15T15-03-01-343Z.json)和[解释指南](docs/USAGE.md)。

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
每会话净节省 = manual-restatement 中位数 - OKF 中位数
盈亏平衡会话数 = ceil(初始 OKF 成本 / 正的每会话净节省)
```

实测 B−C 节省为负，因此本次没有 token 或 cost 盈亏平衡点。

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
