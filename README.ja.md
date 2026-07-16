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

最初の `SessionStart` で `~/.claude/okf`（または `$CLAUDE_CONFIG_DIR/okf`）が作成されます。収集と opportunistic な batch は自動で行われ、会話は最後の活動からおよそ 1 時間後に収集されるため、セッションを明示的に終了する必要はありません。

## 継続性の流れ

```text
Session 1              ~1時間の idle           Background batch           Session 2
決定を下す        ->   sweep が raw を収集 ->   再利用可能な OKF Markdown -> 索引が注入される
（明示的な終了       （無損失コピー；               |                            |
 は不要）             成長時は再収集）              +-- local git history        +-- 関連 concept を Read
```

たとえば「10% → 50% → 100% で deploy、error rate が 0.5% を超えたら rollback」という決定を、次のセッションで再入力せず発見できます。索引は本文ではなくルーティング層なので、Claude は作業前に関連 concept を `Read` します。

なぜ idle ベースなのか？ session が明示的に終了することは稀で——background agent はそもそも終了しません——`resume` 時に取得する end-of-session snapshot は会話を途中で「処理済み」として固定してしまい、その後の内容を失っていました。そこで sweep は `sweep_min_idle_minutes`（default 60）だけ静かな状態が続いた transcript を収集し、batch process は保留中の会話が idle になるまで居座り（約 5 分間隔で polling、最大 8 時間）、収集済み session はその後さらに成長した場合のみ再収集し、変化のない session は二度と再収集しません。Session hook は batch を起こすだけです。

## コマンド

| コマンド | 用途 |
|---|---|
| `/okf:okf-status` | 最後の batch、待機セッション、lock 状態 |
| `/okf:okf-batch` | lock を尊重して即時 ingest |
| `/okf:okf-config` | 検証済み設定の表示・編集 |
| `/okf:okf-index` | category、concept title、最近の変更 |
| `/okf:okf-visualize` | OKF concept と concept 間リンクのみ可視化 |
| `/okf:okf-analysis [path]` | repository と関連する OKF concept を一緒に分析 |

`visualize` は repository を走査しません。`analysis` は存在しない path や file path を拒否し、truncated 状態、除外した無関係 concept、言語別 file/declaration/internal edge 数を報告します。どちらも外部 CDN や実行時 network request のない自己完結 HTML です。

## 任意の statusline

`bin/statusline.mjs` は network や graph 分析なしで `OKF 12 · +3 · 2h ago` のような一行を出力します。Claude Code の `statusLine` は一つだけなので、OKF は自動設定も上書きもしません。既存 script から `node /path/to/okf/bin/statusline.mjs` を呼び、その出力を結合してください。

## OKF 効果ベンチマーク

<!-- okf-live-benchmark: valid-2026-07-15T16-06-28Z -->

**OKF は token を節約しません。新しい session が既に失ったものを回収するだけです。** 以下の数値はそれを率直に示すために公開します。

### 測定内容

前の session が確立した 8 つの事実と、memory では助けにならない control 質問 1 つを follow-up session に尋ねます。

| 種類 | 期待値 |
|---|---|
| architecture | SQLite / repository pattern |
| coding rule | named export only |
| 過去の障害対応 | `busy_timeout=5000`（SQLITE_BUSY） |
| 応答の好み | Korean / concise |
| file・deploy 方針 | `src/config.mjs` / `npm run deploy:canary` |
| 無関係な計算（control） | 7 × 8 = 56 |

5 条件・各 5 回（順序交差）。C の bundle は実際に `raw/` へ収集 → 隔離 batch ingest → SessionStart gate で構築し、concept の手作業投入はありません。preflight は C が対象事実を全て含んで gate routing し、D が一つも含まないことを確認するまで課金を許しません。

- **A — no memory.** 率直な現状。新しい session、restatement なし。
- **B_oracle — 答案。** 期待値 8 個をそのまま貼ります。その文字列を作るには OKF が回収すべき事実を既に全て知っている必要があり、**どの user もこの条件を占有できません**。baseline ではなく上限で、人手のコストは 0 と値付けされています。
- **B_realistic — 実際にやること。** 次の session が何を要るか事前に分からないので、関連しそうなもの全てを restate します。CLAUDE.md の習慣です。
- **C — OKF enabled.**
- **D — irrelevant OKF.** 関連 content のない gate。「gate が助けた」と「gate にはコストがある」を分離します。

### 結果

2026-07-15、Claude Code `2.1.210`、`sonnet`/medium（Sonnet 5 + Haiku 4.5）、macOS arm64、Node `v26.4.0`、各条件 5 回。C preflight: 事実 8/8 存在・8/8 gate routing。D: 0/8。

| 条件 | 継続成功 | 準拠率 p50 | token activity p50/p95 | wall p50/p95 | cost p50 |
|---|---:|---:|---:|---:|---:|
| A — no memory | **0/5** | 12% | 27,246/27,518 | 13.82/18.17 s | $0.022218 |
| B_oracle（答案） | 5/5 | 100% | 9,069/9,069 | 4.86/6.46 s | $0.008410 |
| B_realistic | 5/5 | 100% | 9,069/9,069 | 5.96/6.27 s | $0.008410 |
| **C — OKF enabled** | **5/5** | 100% | **10,395**/10,459 | 6.46/7.15 s | $0.011329 |
| D — irrelevant OKF | 0/5 | 0% | 20,602/21,662 | 14.50/21.15 s | $0.025879 |

行の裏にある tool call が数値を説明します。A は file 2 つ・4 turn を使ってなお失敗。B は答えが既に prompt にあるので read 0・1 turn。**C も read 0・1 turn** — gate 索引だけで足りました。D は gate が一度も持たなかったものを探して file 1 つ・2 turn。

`p95` は注意して読んでください。n=5 では `ceil(0.95×5)−1` が最後の index なので、p95 は **max そのもの** — cold cache の 1 run であり、tail 統計ではありません。要求された形式が求めるから載せているだけで、tail 統計だからではありません。

**まず A 行を読んでください。** memory がないと session は 27,246 token を燃やし、答えを探して file を 2 つ読み、4 turn かけて、それでも **0/8** です。OKF が実際に置き換えるのはこの条件で、C はこれを上回ります — token は 2.6 分の 1、8/8、file read なしの 1 turn。

**C は B に勝てませんし、今後も勝てません。** B は答えを prompt に直接貼るので、既に持っているものより速い retrieval はありません。この bundle size では restate すべき無関係な知識がまだなく B_realistic は B_oracle と同値で、どちらも 9,069 です。C は 1 session あたり 1,326 token・$0.0029 多くかかります。bundle 構築の batch ingest 1 回は **133,364** token activity・**$0.176758**。**token・cost の break-even は存在せず**、`perSessionTokenSaving` が負のため harness は捏造せず `null` を報告します。

前回の run から変わったのは gate 自体です。C は以前 **22,857** token・7 turn・file read 5 回でしたが、同じ 5/5 の再現率のまま **10,395** token・1 turn・read 0 になりました。旧 gate は無条件の `Read` を命じており、その overhead の 91% は index が既に届けていた事実を取り直す round-trip でした。[修正](https://github.com/dja1369/okf-system/pull/7)。

### 蓄積の限界 — 推定ではなく実測

**「知識が貯まるほど OKF は安くなる」は偽です。** 逆に高くつき、しかも代替手段より速く悪化します。同じ benchmark・同じ bundle に無関係な concept を 20 個足した実測 — index には全て収まっています（21 行・9,000 byte 中 5,548 byte、truncate なし）：

| 条件 | 継続成功 | 準拠率 p50 | token activity p50/p95 | wall p50/p95 | cost p50 |
|---|---:|---:|---:|---:|---:|
| A — no memory | 0/5 | 0% | 27,316/27,717 | 13.79/18.05 s | $0.022838 |
| B_oracle（答案） | 5/5 | 100% | 9,070/9,085 | 5.33/6.78 s | $0.008410 |
| B_realistic | 5/5 | 100% | 10,406/10,406 | 5.72/9.62 s | $0.010134 |
| **C — OKF enabled** | **5/5** | 100% | **25,384**/25,773 | 11.75/13.15 s | $0.030721 |
| D — irrelevant OKF | 0/5 | 0% | 22,265/22,334 | 14.91/19.59 s | $0.037354 |

filler 0 の run と比べると、B_realistic は **+1,337**（9,069 → 10,406）、C は **+14,989**（10,395 → 25,384） — **C の劣化は約 11 倍速い**、concept 1 個あたり 749 token 対 67 token。どちらも 5/5 で答えるので、これは accuracy ではなく純粋な cost の後退です。

原因は truncate ではありません。信頼です：

```
filler 0:   C read=0  turn=1    index 行からそのまま答える
filler 20:  C read=3  turn=4    file を開き直す
```

無関係な concept 20 個で、model は index 行を信じるのをやめ file で裏を取り始めました — gate 修正が取り除いたはずの round-trip の復活です。index は「その行がある」ことは伝えますが「その行が**完全な**答えだ」とは伝えないので、周囲の noise が増えれば確認する方が合理的になります。**これが本当の天井で、concept 約 21 個で来ます — どの cap が効くよりずっと手前です。**

truncate はその先にある 2 枚目の壁です。gate の index は Claude Code の 10,000 文字 hook 上限に収めるため hard cap があり、実際の韓国語 concept 行は約 214 byte です：

| bundle の concept 数 | gate index 表示数 |
|---:|---:|
| 20 | 20 |
| 40 | 40 |
| **55** | **43**（truncate） |
| 100 | 43（truncate） |

concept が約 43 を超えると index は truncate され、生き残るものは file 名で決まります — 関連性でも新しさでもありません。filler 50 個の run が **preflight で落ちる**のはこれが理由です（`presentFacts: 8, routedFacts: 6, ready: false`）：`decisions/tech-stack.md` が filler の後ろに並んで切られ、事実を 2 つ道連れにしました。category は round-robin で配られどの category も枯れず、truncate された category は自分の `index.md` を指しますが、降りて行くのは tool round-trip — 同じコストがまた乗ります。

どちらの壁も調整 knob ではありません。1 枚目を直すには、index が**どの行が完全な答えか**を示し、model が file を開かずに信頼できる必要があります。その作業は済んでおらず、済むまでは concept を足すたびに OKF の経済性は悪化します。

蓄積 run: [raw JSON](docs/benchmarks/raw/okf-live-2026-07-15T16-30-11-404Z.json)。filler 50 個の preflight 失敗は [preflight audit](docs/benchmarks/raw/okf-live-preflight-failed-2026-07-15T16-11-37-402Z.json) に保存しています — 意図的に残した negative result です。

harness は決定準拠、誤った仮定、追加質問、tool call、最初の有効応答、API/wall time、`input_tokens`、`output_tokens`、`cache_creation_input_tokens`、`cache_read_input_tokens`、CLI cost も保存します。token category は raw JSON で分離します。`tokenActivity` は cache read を output token と 1:1 で合算しますが cache read の課金は約 50 倍安いため、**擁護できる列は cost です**。また n=5 では harness の `p95` は算術的に常に max（cold run）です — 上の表の p95 はその前提で読んでください。CLI が分離して提供しない user-only/gate-only token は推測せず `null` にします。

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                      # 上記の公開値
OKF_RUN_LIVE_BENCH=1 OKF_BENCH_FILLER=50 node test/bench-okf.mjs  # 蓄積軸
```

有料・認証必須で smoke test と CI から意図的に除外します。詳細は [report](docs/benchmarks/okf-live-2026-07-15T16-06-28-592Z.md)、[raw JSON](docs/benchmarks/raw/okf-live-2026-07-15T16-06-28-592Z.json)、[docs/USAGE.md](docs/USAGE.md) を参照してください。修正前の run は audit trail として残します。

### ローカル overhead（効果ベンチマークではありません）

2026-07-16、macOS arm64、Node `v26.4.0` の新しい測定です。

| 処理 | median | range |
|---|---:|---:|
| SessionStart gate process | 57.2 ms | 56.9–58.1 ms |
| SessionEnd trigger process | 41.4 ms | 39.0–42.1 ms |
| statusline process | 35.0 ms | 35.0–35.2 ms |

`node test/bench.mjs [repository]` で再現できます。これは local process cost であり、token や model response の改善を証明しません。

### Batch cost と break-even

live harness は batch ingest と repair の使用量を privacy-safe な telemetry file で記録し、実測中央値の節約が正のときだけ token・cost の break-even を計算します：

```text
initial OKF cost = batch ingest + repair + measured irrelevant-gate overhead
per-session net saving = B_realistic median - OKF median
break-even sessions = ceil(initial OKF cost / positive per-session net saving)
```

比較対象は B_oracle ではなく **B_realistic** です。B_oracle の restatement 文字列は答えそのものを含み、OKF がやるべき仕事をちょうど 0 と値付けするので、それとの break-even は無意味になります。実測 run ではどちらにせよ節約が負（−1,326 token、−$0.0029）なので、両方の break-even field は `null` を報告します。これは harness の欠落ではなく結果です。

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

- idle sweep が full transcript を `raw/` に無損失コピーします。収集中に parse や truncate はしません。Session hook は batch を起こすだけです。
- batch は capped digest を別の `claude -p` で Anthropic に送ります。これが追加される唯一の model/API 転送です。
- `--safe-mode`、制限 tools、stdin prompt、lint/rollback、Bash なしで実行します。
- analyzer は temp workspace 内の知識ファイルの使い捨てコピーで作業し、`raw/`・`.okf/`・`.git` に物理的にアクセスできません。driver は通常の `.md` ファイルのみを反映します（script や symlink は bundle に届きません）。
- raw transcript は git-ignore、抽出 Markdown のみ local commit します。push/remote 追加はしません。
- POSIX directory は `0700`、raw/state/log は `0600`。persistent log には transcript、Claude stdout/stderr、credential、full raw path を保存しません。
- live fixture は synthetic で個人情報や credential を含みません。

## 設定・削除

`~/.claude/okf/.okf/config.md` または `/okf:okf-config` を使います。主要 default は `enabled: true`、`batch_interval_hours: 1`、`batch_max_digest_kb: 600`、`sweep_min_idle_minutes: 60`（最後の活動からこの時間が経つと収集対象になります。`0` なら即時収集）、`batch_digest_cap_kb: 150`、`remove_candidate_ttl_days: 30`、`inject_max_lines` / `inject_max_bytes`: `120` / `9000` です。無効・未知の値は安全な default に戻ります。

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
