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

## OKF ベンチマーク

<!-- okf-benchmark: 2026-07-16-v3 -->

**OKF は、code が答えられることのほぼすべてにおいて overhead であり、code がまったく答えを持たない領域ですら、素の CLAUDE.md のほうが勝ります — OKF の唯一の強みは、それをより安価に行える点だけです。その中核的な約束（蓄積した知識は時間とともに報われる）を直接検証したところ、反証されました。**

この段落の各主張を、以下、実在の open-source repository 上で、比較 cell あたり n=15 で測定します。そして OKF に不利な部分を先に公開します。

### 測定方法

固定した公開 repository 2 つ — 合成 fixture ではないので、探索には探索が実際に要するコストがかかり、memory なしの baseline が本当に勝ちうる状態です。

| 役割 | Repository | Commit |
|---|---|---|
| Codebase | [slimphp/Slim](https://github.com/slimphp/Slim) | `80900fb3`（PHP file 125 個） |
| Document pile | [rust-lang/rfcs](https://github.com/rust-lang/rfcs) | `f635361c`（Markdown file 651 個） |

どの bundle のどの concept も、実際の pipeline が生成したものです — 固定 repo を探索する実際の `claude -p` session、その実際の Claude Code transcript、実際の batch ingest、実際の gate。**手で書いた concept は一つもありません。** bundle はこの repository に commit してあり（[docs/benchmarks/bundles/](docs/benchmarks/bundles/)）、以下のどの数値も依拠する正確な gate text と concept 本文を読めます。そして v2 が反証されたのと同じやり方で — 著者を信用せず、repo から — この run を反証できます。

5 条件。すべてが同一の tools（`Read`、`Glob`、`Grep`、`Bash(git log/show/diff/blame/grep)`）と、条件に対して中立な同一の指示を受け取ります — gate を参照せよと告げられる条件はありません。gate は prompt の先頭に付加するのではなく、**実際の `SessionStart` hook**（`additionalContext`）を通じて配送します。配送された byte 数は run ごとに検証します。

- **zero-base** — 何もなし。OKF が置き換えると主張している当のもの。
- **answer key** — 答えを貼り付けたもの。その文字列を作るには既に答えを知っている必要があるため、この条件を占有できる user は存在しません。競合相手ではなく床です。
- **OKF** — 実際の gate text。
- **wrong knowledge** — *もう一方の* repository に関する実在の concept で size を合わせた gate。「知識が助けた」と「gate が助けた」を分離します。
- **CLAUDE.md** — 同じ蓄積知識を flat file に貼り付けたもの。実際の現職者。

見出しの数値は `total_cost_usd` です。sonnet のみのコストを total cost の横に併記するので、CLI が内部処理用に解決する `claude-haiku`（支出の 2.3%）を差し引くことができ、結論を隠すことはできません。効率は correct run のみで比較します。各回答は **atom** ごとに採点します — ground truth を独立に検証可能な事実に分割し、測定前に凍結します — そして v2 式の binary score（全 atom が正しい）をその横に併記します。run ごとの nonce が prompt cache を無効化します。**どの数値も scenario をまたいで平均しません。**

設計・予測・反証基準 R1–R5 は[事前登録](docs/benchmarks/pre-registration-2026-07-16-v3.md)し、**最初の課金 call より前に** commit しました。その文書はまた、このベンチマークの前回（v2）公開が行った 6 件の誤ったまたは裏付けのない主張と、それぞれをその生データからどう検出したかを詳細に記録しています。

### OKF が負ける場所: code が答えられること全部

答えが source、git history、または bundle にある scenario 5 つ。それぞれ固定 checkout から検証しました。コストは correct run の中央値で、そのばらつきを併記します。

| Scenario | zero-base | OKF | 判定 |
|---|---:|---:|---|
| `rfcs_cheap` — grep 一回 | **$0.062** · 13/15 | $0.077 · 14/15 | OKF が 1.2 倍高い |
| `slim_cheap` — grep 一回 | **$0.067** · 14/15 | $0.114 · 15/15 | OKF が 1.7 倍高い |
| `rfcs_buried` — 651 個の doc から根拠を見つける | **$0.097** · 12/15 | $0.112 · 13/15 | OKF が 1.2 倍高い |
| `slim_buried` — 5 file の call chain を追う | $0.277 · 13/15 · **tool 10 個** | **$0.232** · 9/15 · **tool 8 個** | OKF が安く、tool も少ない |
| `slim_stale` — bundle の知識が後の commit で古くなっている | critical **15/15** | critical **15/15** | 引き分け — 下記参照 |

**安価な grep では OKF は純然たる overhead です** — 同じ答えに 1.2〜1.7 倍高くつきます。gate は `grep` が必要としない固定費だからです。探索が本当に高くつく場合にのみ元が取れます。`slim_buried` は 5 file の call chain を追い、そこでは OKF の方が安く、tool call も少なくて済みます。それは欠陥ではなく算術です — grep で質問に答えが出るなら、gate に金を払ってはいけません。

`slim_stale` は atom ごとの採点が働いた場所です。bundle は後の commit で古くなった主張を抱えており、binary score は **どの条件でも 0/15** と出ます — 完全な全滅に見えます。そうではありません。*critical* な atom（質問が実際に問うていること — HTML renderer が escape すること、どの関数とどの flag で行うか）は **15/15** です。model は code を読み、核心の事実を正しく答えました。唯一取り逃した atom は、質問が一度も求めていない来歴（escape を導入した commit SHA）です。古い知識は model を自信満々の誤りには **しません** でした — そうなるという事前登録の予測は外れ、binary score だけならそれを隠していたはずです。

### 探索では届かない場所: code に含まれない知識

会話で決まり、repo には一度も書かれなかったチームの方針。RFC の山には罠まで仕込まれています。MSRV 方針を検索すると文書は `N-2` を提案しますが — チームの実際の規則は違います。

| Scenario | zero-base | OKF | wrong knowledge | CLAUDE.md |
|---|---:|---:|---:|---:|
| `rfcs_policy` — チームの "thaw rule": 待機期間、MSRV の頻度、二つの例外 | **0/15** | **11/15** · $0.075 | — | 15/15 · $0.144 |

**zero-base は 15 戦 0 勝でした。** 金を使って何も得られていません。答えが repository に無いからです — working tree、git history、commit message、docs、config を検索し hit ゼロを確認した adversary が検証しました。罠にも掛かりませんでした。ただ答えられなかっただけです。

OKF は **15 問中 11 問** に答え、同じ事実を運ぶ CLAUDE.md のおよそ半分のコストで済ませました。これは探索にはできず、保存された決定にはできる唯一のことです。**CLAUDE.md もこれに答えます**（15/15） — ここで OKF は唯一の存在ではなく、同じ現職者を、より安く、注入量を制限した形にしたものです。この scenario の `wrong knowledge` control は除外します。測定汚染の bug（下記）が答えを読ませてしまったため、この run では「gate 単体では助けにならない」control として機能できないからです。

これは clean な policy scenario 一つであって、三つではありません。他の二つ（`slim_policy`、`slim_domain`）は測定した上で **除外** しました — 下記参照。

### この run では分からないこと

- **policy scenario 二つを汚染のため除外しました。** Claude Code は directory ごとの project memory（`~/.claude/projects/<cwd>/memory/`）をすべての session に自動注入します。知識の構築中、対象 repo を探索する `claude -p` session がチームの決定をその memory に保存し、測定が同じ working directory で走ったため、memory は **zero-base** 条件にまで届きました — 本来なら知識を一切持たないはずの条件です。`slim_domain` では、zero-base はその結果、code のどこにも存在しないチームの決定に「答えて」しまい、15/15 でした。zero-base の run が project memory を読んだ scenario はすべて公開から外します（`slim_domain`、`slim_policy`）。harness は測定前にその memory を消去するようになり、report はそうした scenario を機械的に検出・除外します。上記の clean scenario では memory の読み取りはゼロでした。
- **contrast 条件で n=15、control で n=5。** 小さいです。分布が完全に分離している場合のみ勝ちと表現します。
- **repository 2 つ、エコシステム 2 つ（PHP + Markdown）。** サイズや言語をまたぐ一般性は主張しません。第 3 の repository を設計しましたが、支出前に信頼性あたりのコストで却下しました。
- **単一質問の session。** OKF の固定 gate 費用は、実際の複数質問 session にわたって償却されるのではなく、質問ごとに一度支払われます。したがってこの run は OKF を *過小評価* しています。
- **judge は単一の LLM family** で、source から検証した ground truth に対し atom ごとに採点します。

反証基準 **R1–R5 はすべて機械的に評価され、どれも作動しませんでした**（汚染した cell を除外した後） — この run は主張を反証しません。それは n=15 での強い確証と同じではなく、反証の不在です。

### chain の追試: 実際の蓄積は効くのか？（v4、反証）

<!-- okf-benchmark-chain: 2026-07-16-v4 -->

別に事前登録した run が、OKF の機構を直接検証しました。`kubernetes/kubernetes` の `pkg/scheduler`（v1.30.0、Go file 178 個）に関する、関連しつつも異なる 4 つの質問を chain にし、各 session の結論を次の session が始まる前に**実際の batch**へ通します。これを、蓄積を一切行わずに同じ 4 つの質問を投げた場合と比較します。これはまさに、v3 の事前登録が「OKF に有利で、OKF を良く見せるよう調整できてしまう」と指摘し、実施を見送った形そのものです。v4 は今回はガードを付けたうえで、それでも実施しました。4 つの質問は支出前に凍結し source から検証、汚染ガードは Claude Code の project memory を**毎** session（一度きりではなく）消去し、反証基準は測定前に固定しました — [事前登録](docs/benchmarks/pre-registration-2026-07-16-v4.md)を参照してください。

実際の蓄積は起きました。gate の byte 数は step をまたいで単調に増加し（1835 → 2613 → 3675 → 4950、n=15 chain）、それは実際に測定した batch 支出（合計 $25.81）に裏打ちされています。**核心の予測 — chain をまたいでコストが下がる — は反証されました。** OKF のコストは 4 つの質問で $0.231 → $0.216 → $0.258 → **$0.447** と推移し、memory なしの control も同じように動きました（$0.255 → $0.256 → $0.272 → $0.411）。最も可能性の高い説明は、4 つ目の質問が単に両群にとってより難しかったこと — 二つの機構を同時に問うています — であって、蓄積が助けた・害したということではありません。OKF の atom 単位の精度はどの step でも baseline を上回らず、最初と最後の質問ではいずれも下回りました。binary（全 atom が正しい）採点は両群とも 0/106 でした — この質問群は、atom 単位の score だけがかろうじて使える程度に難しいのです。[完全な report](docs/benchmarks/okf-benchmark-chain-2026-07-16-v4.md)。

### ローカル overhead（効果の測定結果ではありません）

2026-07-16 測定、macOS arm64、Node `v26.4.0`、median と min/max。

| ローカル処理 | Median | Range |
|---|---:|---:|
| SessionStart gate process | 57.3 ms | 56.1–60.0 ms |
| SessionEnd batch-trigger process | 40.1 ms | 39.3–40.8 ms |
| Statusline process | 35.8 ms | 34.6–36.3 ms |

`node test/bench.mjs [repository]` で再現できます。local process cost のみであり、token や model latency について何も証明しません。

### コスト、再現、リンク

測定した 440 run のコストは **$66.26**、採点に **$14.74** で、知識と bundle の構築が約 $3.2 追加されました。この run の合計はおよそ **$84** です。有料・認証必須で、smoke test と CI からは意図的に除外しています。

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-knowledge.mjs --target slim --dir <repo>   # real sessions → transcripts
OKF_RUN_LIVE_BENCH=1 node test/bench-bundles.mjs --target slim --levels 20      # real batch → bundle
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                                    # measure
```

v4 の chain run（120 session、step 間に実際の batch）は、測定に **$31.95**、採点に **$9.20**、実際の ingest に **$25.81** で、合計およそ **$67** でした。

```sh
OKF_RUN_LIVE_BENCH=1 OKF_BENCH_CHAINS=15 node test/bench-chain.mjs   # chained sessions, real batch, measure
```

[完全な report](docs/benchmarks/okf-benchmark-2026-07-16-v3.md) ·
[chain 追試 report](docs/benchmarks/okf-benchmark-chain-2026-07-16-v4.md) ·
[raw JSON](docs/benchmarks/raw/) ·
[committed bundles](docs/benchmarks/bundles/) ·
[事前登録](docs/benchmarks/pre-registration-2026-07-16-v3.md) ·
[chain 事前登録](docs/benchmarks/pre-registration-2026-07-16-v4.md) ·
[利用ガイド](docs/USAGE.md)。

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
