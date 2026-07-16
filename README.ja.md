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

<!-- okf-benchmark: 2026-07-16 -->

> **撤回のお知らせ（2026-07-16）。** この節で最初に公開した主張のうち 3 件を、この run 自身の生データを監査した結果、撤回しました。`rfcs_policy` の罠による説明（捏造 — 罠は一度も作動していませんでした）、蓄積のトレンド見出し（その標本では裏付けられません）、そしてこの節の元の題「OKF だけが機能する場所」（自らの表に反証されています）です。各撤回は、その主張があった場所に明記しています。何を撤回し、それぞれをどう検出したかは [v3 事前登録](docs/benchmarks/pre-registration-2026-07-16-v3.md) に記録しています。この節のそれ以外の知見は変わっていません。

**OKF は探索を肩代わりしてくれるものではありません。探索では決して見つけられないものを保存するものです。**

この一文の両側を、以下、実在の open-source repository 上で測定します。そして不利な側を先に公開します。

### 測定方法

固定した公開 repository 2 つ。合成 fixture ではないので、探索には探索が実際に要するコストがかかり、memory なしの baseline が本当に勝ちうる状態です。

| 役割 | Repository | Commit |
|---|---|---|
| Codebase | [slimphp/Slim](https://github.com/slimphp/Slim) | `80900fb3`（PHP file 125 個） |
| Document pile | [rust-lang/rfcs](https://github.com/rust-lang/rfcs) | `f635361c`（Markdown file 651 個） |

どの bundle のどの concept も、実際の pipeline が生成したものです — 固定 repo を探索する実際の `claude -p` session、その実際の Claude Code transcript、実際の batch ingest、実際の gate。**手で書いた concept は一つもありません**。volume を作り出す filler も含めてです。

5 条件。すべてが同一の tools（`Read`、`Glob`、`Grep`、`Bash(git log/show/diff/blame/grep)`）と、条件に対して中立な同一の指示を受け取ります。gate を参照せよと告げられる条件はありません。

- **zero-base** — 何もなし。OKF が置き換えると主張している当のもの。
- **answer key** — 答えを貼り付けたもの。その文字列を作るには既に答えを知っている必要があるため、この条件を占有できる user は存在しません。競合相手ではなく床です。
- **OKF** — 実際の gate text。
- **wrong knowledge** — *もう一方の* repository に関する実在の concept で size を合わせた gate。「知識が助けた」と「gate が助けた」を分離します。
- **CLAUDE.md** — 同じ蓄積知識を flat file に貼り付けたもの。実際の現職者。

見出しの数値は `total_cost_usd` です。token activity はその代わりにではなく、常にその横に併記します。`cache_read` がその合計を支配し、課金は約 50 倍安いため、二つの列は方向が食い違うからです。効率は correct run のみで比較します。run ごとの nonce が prompt cache を無効化します。採点は、source から検証した ground truth に対し、条件を伏せた judge が行います。**どの数値も scenario をまたいで平均しません**。grep 一回と 5 file の call chain は別の現象であり、混ぜれば scenario の選び方で見出しを作れてしまいます。

設計・予測・反証基準は[事前登録](docs/benchmarks/pre-registration-2026-07-16.md)し、**最初の課金 call より前に** commit しました。

### OKF が負ける場所: code が答えられること全部

答えが source か git history にある scenario 5 つ。固定 checkout から検証し、それぞれ独立した反証の試みを生き延びました。

| Scenario | zero-base | OKF | 判定 |
|---|---:|---:|---|
| `rfcs_cheap` — grep 一回 | **$0.0256** · 4/5 | $0.0505 · 3/5 | OKF が 2.0 倍高い |
| `slim_cheap` — grep 一回 | **$0.0198** · 4/5 | $0.0386 · 5/5 | OKF が 1.9 倍高い |
| `slim_stale` — bundle の知識が後の commit で古くなっている | **$0.0345** · 5/5 | $0.0632 · 4/5 | OKF が 1.8 倍高い |
| `rfcs_buried` — 651 個の doc から根拠を見つける | **$0.0326** · 4/5 | $0.0910 · 3/5 | OKF が 2.8 倍高い |
| `slim_buried` — 5 file の call chain を追う | $0.1669 · 2/5 · **tool 10 個** | **$0.0701** · 2/5 · **tool 3 個** | **OKF が 2.4 倍安い** |

**OKF は 5 つ中 4 つで負けます。** 探索が本当に高くつく場合にのみ勝ち、そこでは tool call を 10 から 3 へ削ります。grep で答えが出る質問なら、gate は純然たる overhead です。それは欠陥ではなく算術です。

`slim_stale` は名指しする価値があります。bundle は古くなった主張（HTML error renderer が escape しない — commit `f897118b` より前は真、固定 commit では偽）を抱えていましたが、model は **それでも code を確認して訂正しました**、4/5 です。古い知識は model を自信満々の誤りにはしませんでした。そうなるという事前登録の予測は外れました。

### 探索では届かない場所: code に含まれない知識

チームの方針とドメイン語彙 — 会話で決まり、repo には一度も書かれなかったものです。各 scenario は独立した adversary の攻撃を受けました。adversary は working tree、git history の約 300 revision、commit message、docs、config、stash、dangling object を検索し（hit ゼロ）、しかも **見る前に慣習からの推測を記録しました**。その推測は 0/3、0/3、1/5 でした。

どちらの repo にも罠が仕込まれています。"emitter" を grep すれば `ResponseEmitter` が見つかり、chunk size を探せば `4096` が見つかり、RFC の山から MSRV 方針を検索すれば文書は `N-2` を提案しています。

| Scenario | zero-base | OKF | wrong knowledge | CLAUDE.md |
|---|---:|---:|---:|---:|
| `slim_policy` — どの env が error 詳細を有効にするか、およびその例外 | **0/5**（$0.0509 を消費） | **5/5** · $0.0840 | 0/5 | 5/5 · $0.1314 |
| `slim_domain` — チームが言う「에미터」とは何か | **0/5** · **自信満々の誤り 5/5** | **4/5** · $0.0624 | 0/5 | 5/5 · $0.1198 |
| `rfcs_policy` — チームの "thaw rule" の待機期間 | **0/5** | 2/5 · $0.0749 | 0/5 | 0/5 |

**zero-base は 15 戦 0 勝でした。** 金を使って何も得られていません。答えがそこに無いからです。`slim_domain` では **5 run 中 5 run で自信満々に間違えました**。探索し、`ResponseEmitter` を見つけ、高い確信とともに答えたのです — ところがチームの言う「에미터」は `OutputBufferingMiddleware` です。彼らは FrankenPHP の worker mode で動かしており、`ResponseEmitter` は dead code だからです。ここでは探索は単に失敗するのではありません。罠から自信満々の誤答を製造します。

**wrong knowledge も 15 戦 0 勝でした。** 実在するが無関係な concept で満たされた gate は、何も回収しません。利得は知識から来るのであって、gate を持つことから来るのではありません。

OKF は 15 問中 11 問に答え、同じ事実を運ぶ CLAUDE.md の 1.6〜1.9 分の 1 のコストで済ませました。`slim_domain` では **concept file を一つも読みませんでした**（0/5） — index の行だけで足り、tool call は zero-base の 7 に対して 2 でした。

**ここでは CLAUDE.md も機能します。** 表がそう告げています。`slim_policy` で 5/5、`slim_domain` で 5/5 と、後者は OKF の 4/5 を上回ります。この表が裏付けるのは、現職者と同等の正確さを 1.6〜1.9 分の 1 のコストと制限された注入量で達成するということであって、OKF だけが唯一だということではありません。この節は当初「OKF だけが機能する場所」という題で公開しましたが、自らの表がその題に反証しています。**その題は撤回します。**

`rfcs_policy` は正直な失敗です。OKF は 2/5 しか取れませんでした。**ここに載せていた説明 — document pile に居座る `N-2` 提案が model を正しい index 行から引き剥がすに足る強い罠だ、という説明 — は誤りであり、撤回します。** OKF の 5 run はすべて bundle file しか読んでいません。RFC document を開いた run は一つもなく、`N-2` と答えた run も一つもありません。5 つとも「4 release」と答えました。罠は一度も作動していません。2/5 の原因は公開前に調査しておらず、ここで代わりの説明を提示することもしません。再測定が進行中です。この scenario で CLAUDE.md は 0/5 でしたから、OKF は依然として現職者に勝っています。

### 蓄積 — トレンドの主張は撤回します

この節では当初、bundle size（concept 1 個 → 35 個）に対するコスト曲線と、次の見出しを公開していました。**「concept 1 個から 35 個へ増える間に OKF は安くなり（$0.1291 → $0.0908）、CLAUDE.md は 2.2 倍高くなりました（$0.1279 → $0.2828）。曲線は分岐します。」** **このトレンドの主張は、標本が裏付けないため撤回します。**

数値そのものは捏造ではありません。事前登録した規則どおり、correct run のみから取った中央値です。しかしそれらは **3、2、5、3、2、4** run の中央値であり、最低点の $0.0701 は *2 run の中央値* です。全 run で見ると level ごとの分布は完全に重なり（concept 1 個の level は $0.0774〜$0.2214、35 個の level は $0.0836〜$0.1606）、全 run の中央値は単調ですらありません。$0.1237、$0.1884、$0.1425、$0.0852、$0.1142、$0.1135 です。この同じ節が 2 段落あとで「n=5 では、ここで分離するものは何もありません」と書いていました。その文が正しく、その上の見出しが誤りでした。曲線はここに再掲しません。2 run の中央値は曲線上の点ではないからです。

gate が頭打ちになる区間の説明も誤っていました。batch が 14 個の concept を index の 1 行に畳んだからだとして、OKF が知識を組織する仕方から創発した性質であるかのように提示していました。**その正体は `lib/config.mjs` の `inject_max_lines: 120` という cap** — 設定定数です。`bench-bundles.mjs` は `gateTruncated` を記録しており、この値は頭打ちが始まるまさにその level で真になります。index の項目は優雅に入れ子にされたのではなく、**予算のために捨てられた** のです。

旧主張の半分は生き残ります。ただし、それ単体としてのみ述べます。CLAUDE.md はすべての concept 本文を毎回の prompt に載せるので、prompt は concept 数に対して線形に増えます。これはその形式から機械的に従う事実です。ここから OKF 側との比較は引き出しません。

正確さは volume で改善せず、ばらつきも残りました（2/5〜5/5）。**level 軸は v3 で廃止します。** それは設定定数を測っており、再実行しても、設定 file から読み取れる数値をより精密に測り直すことにしかならないからです。

### ローカル overhead（効果の測定結果ではありません）

2026-07-16 測定、macOS arm64、Node `v26.4.0`、median と min/max。

| ローカル処理 | Median | Range |
|---|---:|---:|
| SessionStart gate process | 57.3 ms | 56.1–60.0 ms |
| SessionEnd batch-trigger process | 40.1 ms | 39.3–40.8 ms |
| Statusline process | 35.8 ms | 34.6–36.3 ms |

`node test/bench.mjs [repository]` で再現できます。local process cost のみであり、token や model latency について何も証明しません。

### コスト、そしてこの run では分からないこと

知識の構築には実 session で **$3.59**、batch ingest で **$4.92** かかりました。測定した 250 run のコストは **$28.16**、採点に **$9.44** です。

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-knowledge.mjs --target slim --dir <repo>   # real sessions → transcripts
OKF_RUN_LIVE_BENCH=1 node test/bench-bundles.mjs --target slim --levels 1,5,20  # real batch → level bundles
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                                    # measure
```

有料・認証必須で、smoke test と CI からは意図的に除外しています。
[完全な report](docs/benchmarks/okf-benchmark-2026-07-16.md) ·
[raw JSON](docs/benchmarks/raw/) ·
[事前登録](docs/benchmarks/pre-registration-2026-07-16.md) ·
[利用ガイド](docs/USAGE.md)。

限界を率直に述べます。

- **1 cell あたり n=5。** 小さいです。ここで勝ちと表現するのは、分布が完全に分離している場合のみです。
- **model mix は固定していません。** `claude-sonnet-5` を要求しましたが、CLI は内部処理用に `claude-haiku-4-5` を併せて解決しました。条件間の cost 比較にはその artifact が乗っています。
- **repository は 2 つ、言語は各 1 つ。** サイズやエコシステムをまたぐ一般性は主張しません。
- **wall-clock は公開しません。** 測定は concurrency 5 で走りました。cost・token・tool call はそれに影響されませんが、response latency は影響されます。速度の主張には逐次での再 run が必要です。
- gate text は production の `SessionStart` `additionalContext` 経路ではなく、prompt の先頭に付加しています。同じ text、異なる配送です。
- policy scenario は人間が方針を著述することに立脚しています。方針とはそういうものです。弁明としては、答えが repo に存在しないことを証明でき、adversary もそれを推測できなかった、ということです。

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
