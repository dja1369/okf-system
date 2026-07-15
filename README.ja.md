# OKF for Claude Code

**過去の Claude Code セッションで決めたことを、次のセッションが実際に使えるローカルの知識バンドルにします。**

[English](README.md) · [한국어](README.ko.md) · **日本語** · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português](README.pt-BR.md)

セッション終了時に会話を保存し、再利用できる決定や障害対応を Markdown に抽出して、次のセッションへ小さな索引を注入します。データは閲覧・diff・バックアップ・削除できるローカル git リポジトリです。

## 1 分クイックスタート

Claude Code のプラグイン対応、Node.js、git が必要です。`npm install` は不要です。

```sh
claude plugin marketplace add dja1369/okf-system
claude plugin install okf@okf-marketplace
```

Claude Code を再起動し、通常のセッションを終了してから確認します。

```text
/okf:okf-status
/okf:okf-index
```

最初の `SessionStart` で `~/.claude/okf`（または `$CLAUDE_CONFIG_DIR/okf`）が作成され、その後の capture と opportunistic batch は自動です。

## 継続性の流れ

```text
Session 1 の決定 -> SessionEnd の無損失コピー -> batch で OKF Markdown 化 -> Session 2 に索引注入 -> 関連 concept を Read
```

たとえば「10% → 50% → 100% で deploy、error rate が 0.5% を超えたら rollback」という決定を、次のセッションで再入力せず発見できます。索引は本文ではなくルーティング層なので、Claude は作業前に関連 concept を `Read` します。

## コマンド

| コマンド | 用途 |
|---|---|
| `/okf:okf-status` | 最後の capture/batch、待機セッション、lock 状態 |
| `/okf:okf-batch` | lock を尊重して即時 ingest |
| `/okf:okf-config` | 検証済み設定の表示・編集 |
| `/okf:okf-index` | category、concept title、最近の変更 |
| `/okf:okf-visualize` | OKF concept と concept 間リンクのみ可視化 |
| `/okf:okf-analysis [path]` | repository と関連する OKF concept を一緒に分析 |

`visualize` は repository を走査しません。`analysis` は存在しない path や file path を拒否し、truncated 状態、除外した無関係 concept、言語別 file/declaration/internal edge 数を報告します。どちらも外部 CDN や実行時 network request のない自己完結 HTML です。

## 任意の statusline

`bin/statusline.mjs` は network や graph 分析なしで `OKF 12 · +3 · 2h ago` のような一行を出力します。Claude Code の `statusLine` は一つだけなので、OKF は自動設定も上書きもしません。既存 script から `node /path/to/okf/bin/statusline.mjs` を呼び、その出力を結合してください。

## OKF 効果ベンチマーク

<!-- okf-live-benchmark: valid-2026-07-15T15-03-01Z -->

2026-07-15、Claude Code `2.1.210`、`sonnet`/medium（Sonnet 5 + Haiku 4.5）、macOS arm64、Node `v26.4.0`、commit `c00d3fc`、各条件5回。C は follow-up 前に対象事実 8/8 が concept に存在し gate に 8/8 routing、D は 0/8 でした。

| 条件 | 継続成功 | token activity p50 / p95 | wall p50 / p95 | cost p50 |
|---|---:|---:|---:|---:|
| A — no memory | 0/5 | 27,320 / 27,574 | 16.40 / 18.17 s | $0.024037 |
| B — manual restatement | 5/5 | 9,070 / 9,093 | 6.07 / 7.42 s | $0.008410 |
| C — OKF enabled | 5/5 | 22,857 / 22,883 | 11.33 / 12.80 s | $0.033189 |
| D — irrelevant OKF | 0/5 | 21,507 / 22,261 | 16.92 / 18.88 s | $0.030332 |

C は全対象事実を回収しましたが、同じ正答率の B より token activity が中央値で 13,787 多く、wall time も 5.26 s 長く、改善は確認できません。batch 1回は 111,381 token activity/$0.164360。B−C が負のため break-even はありません。

各条件を最低 5 回繰り返し、成功率、決定準拠、誤った仮定、追加質問、tool call、最初の有効応答、API/wall time、`input_tokens`、`output_tokens`、`cache_creation_input_tokens`、`cache_read_input_tokens`、CLI cost を保存します。token category は raw JSON で分離し、batch/repair cost も break-even に含めます。CLI が分離して提供しない user-only/gate-only token は推測せず `null` にします。

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs
```

有料・認証必須で CI から除外します。詳細は [valid report](docs/benchmarks/okf-live-2026-07-15T15-03-01-343Z.md)、[raw JSON](docs/benchmarks/raw/okf-live-2026-07-15T15-03-01-343Z.json)、[docs/USAGE.md](docs/USAGE.md) を参照してください。

### ローカル overhead（効果ベンチマークではありません）

2026-07-15、macOS arm64、Node `v26.4.0` の新しい測定です。

| 処理 | median | range |
|---|---:|---:|
| SessionStart gate process | 57.4 ms | 56.7–58.2 ms |
| SessionEnd lossless capture process | 43.4 ms | 41.8–43.9 ms |
| statusline process | 36.7 ms | 34.8–36.8 ms |

`node test/bench.mjs [repository]` で再現できます。これは local process cost であり、token や model response の改善を証明しません。

### Batch cost と break-even

```text
initial OKF cost = batch ingest + repair + measured irrelevant-gate overhead
per-session saving = manual-restatement median - OKF median
break-even sessions = ceil(initial OKF cost / positive per-session saving)
```

B−C の実測差が負のため、この run に token・cost break-even はありません。

## 対応言語

fallback analyzer は deterministic・依存なし・保守的です。「file を発見」と「構造を解析」を区別します。

| 言語 | 関係・宣言 | 主な制限 |
|---|---|---|
| JavaScript / TypeScript | relative import/export/require、function/class | bare package は外部 |
| Python | dotted module、function/class | dynamic import は未解決 |
| Go | `go.mod` 内 package node、function/struct | 偽の file edge を作らない |
| Rust | `mod`/`use`、function/struct/enum/trait | macro 生成構造を省略 |
| Java / Kotlin | package/class path、type/Kotlin function | reflection を省略 |
| Ruby | `require_relative`、class/method | gem は外部 |
| PHP | namespace/use/alias/grouped use、require/include、主要 type/function | dynamic autoload を省略 |
| C / C++ | quoted include、明示 path の unique local angle include、主要 type/namespace/function definition | regex のため macro・複雑な複数行構文を逃す場合あり |
| C# | repository 内 namespace node、主要 type | 外部 namespace は外部 |
| Swift | 明示的 inheritance/conformance/extension、主要 type/function | name collision 防止のため nested cross-file target を省略 |

2,000 files で `truncated`、512 KiB 超の file は visible ですが unanalyzed と表示します。

## 実オープンソース検証

固定 commit を clone し、代表 edge を source と照合しました。時間は運用安全性用で model-speed benchmark ではありません。

| Repository | Commit | 言語 files | Declarations | Internal edges | Truncated |
|---|---|---:|---:|---:|---:|
| [Slim](https://github.com/slimphp/Slim) | `80900fb` | 125 | 127 | 305 | no |
| [Redis](https://github.com/redis/redis) | `f76dff7` | 784 | 5,796 | 990 | no |
| [fmt](https://github.com/fmtlib/fmt) | `a79df45` | 46 | 283 | 121 | no |
| [Alamofire](https://github.com/Alamofire/Alamofire) | `903c53c` | 98 | 2,052 | 215 | no |

Swift 標準 `Error` と同名 nested type の誤接続、C standard header と vendored compatibility header の誤接続を検証中に修正しました。詳細は [検証 report](docs/benchmarks/oss-analysis-2026-07-15.md) にあります。

## Data と privacy

- `SessionEnd` は full transcript を `raw/` に無損失コピーします。
- batch は capped digest を別の `claude -p` で Anthropic に送ります。これが追加される唯一の model/API 転送です。
- `--safe-mode`、制限 tools、stdin prompt、lint/rollback、Bash なしで実行します。
- raw transcript は git-ignore、抽出 Markdown のみ local commit します。push/remote 追加はしません。
- POSIX directory は `0700`、raw/state/log は `0600`。persistent log には transcript、Claude stdout/stderr、credential、full raw path を保存しません。
- live fixture は synthetic で個人情報や credential を含みません。

## 設定・削除

`~/.claude/okf/.okf/config.md` または `/okf:okf-config` を使います。主要 default は `enabled: true`、`batch_interval_hours: 1`、`batch_max_digest_kb: 600`、`batch_digest_cap_kb: 150`、`remove_candidate_ttl_days: 30`、`inject_max_lines` / `inject_max_bytes`: `120` / `9000` です。無効・未知の値は安全な default に戻ります。

```sh
claude plugin uninstall okf
```

bundle は `~/.claude/okf` に残るため、確認・backup 後に必要なら手動削除します。

## 開発時の検証

```sh
node test/smoke.mjs
node test/bench.mjs
for file in $(rg --files -g '*.mjs'); do node --check "$file"; done
claude plugin validate .claude-plugin/plugin.json
claude plugin validate .claude-plugin/marketplace.json
git diff --check
```

live: `OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs`。

## 参考・license

README の構成は [uv](https://github.com/astral-sh/uv)、[Ruff](https://github.com/astral-sh/ruff)、[Playwright](https://github.com/microsoft/playwright)、[fmt](https://github.com/fmtlib/fmt)、[Slim](https://github.com/slimphp/Slim) の簡潔な install/reproduction 表現を参考にし、文言や benchmark claim はコピーしていません。[OKF specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)。License: [MIT](LICENSE)。
