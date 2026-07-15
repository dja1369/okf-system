# OKF for Claude Code

すべてのセッションに、プロジェクトを横断する永続的なナレッジベースを自動で
提供する Claude Code プラグインです。手動でのメモも、別途実行するツールも
必要ありません。

**[English](README.md) · [한국어](README.ko.md) · [简体中文](README.zh-CN.md)**

## 何をするか

1. セッションが終了するたびに、会話全体を**無損失でキャプチャ**します。
2. バックグラウンドで(cron のようなスケジューラではなく、日和見的なバッチ処理
   として)キャプチャ済みセッションを `claude -p` で**圧縮**し、再利用可能な
   知識 — 決定事項、プロジェクト情報、好み、パターン、参考資料、
   トラブルシューティング — を構造化された
   [OKF(Open Knowledge Format)](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/?hl=en&utm_source=pytorchkr&ref=pytorchkr) バンドルとして抽出します。
3. 新しいセッションが始まるたびに、そのバンドルのインデックスを
   コンテキストに**必須ゲートとして注入**し、関連する作業のたびに毎回ゼロから
   始めるのではなく、実際に過去の知識を Read してから取り掛かるようにします。

すべてのデータは `~/.claude/okf`(または `$CLAUDE_CONFIG_DIR/okf`)配下の
ローカル git リポジトリにあります。どこにも push されません。唯一の
ネットワーク通信は、すでに利用している Anthropic API 呼び出しだけです —
バッチ処理も、ローカルでもう一度実行される `claude -p` 呼び出しにすぎません。

## 必要条件

- プラグインをサポートする Claude Code
- Node.js(`claude` 自体がすでに要求しているもので十分 — 追加ランタイム不要)
- git

`npm install` は不要。外部サービスも不要。始めるための追加設定も不要です。

## インストール

```
claude plugin marketplace add dja1369/okf-system
claude plugin install okf@okf-marketplace
```

(ローカルクローンからインストールする場合:
`claude plugin marketplace add /path/to/your/clone`。)

これだけです — セッションを再起動すればゲート/キャプチャのフックが有効に
なります。次のセッション開始時にバンドルが自動的にブートストラップされます
(`~/.claude/okf` 配下に基本構造を備えたローカル git リポジトリが作成されます)。

アンインストール: `claude plugin uninstall okf`。`~/.claude/okf` のデータは
そのまま残ります — ただの git リポジトリなので、自由に確認・バックアップ、
または `rm -rf ~/.claude/okf` で削除できます。

## 使い方

普段は何もする必要がありません。キャプチャとバッチ圧縮は自動的に行われます。
手動で状態を確認・制御したい場合に使えるコマンドが4つあります —
**`okf:` プレフィックスが必須です**(プラグインスコープのコマンドのため):

| コマンド | 内容 |
|---|---|
| `/okf:okf-status` | 最後のバッチ実行、保留中のセッション、ロック状態を報告 |
| `/okf:okf-batch` | 即座にバッチを強制実行(間隔ゲートは無視するが、ロックは尊重) |
| `/okf:okf-config` | 現在の設定を表示・編集可能にする |
| `/okf:okf-index` | バンドルの概要を出力 — カテゴリごとの concept タイトル一覧と log.md の最近の変更 |

## 仕組み

```
[セッション使用]                   [バックグラウンドバッチ (日和見的、スケジュールではない)]
SessionStart → ゲート注入            実行条件: 間隔経過 + 他のバッチが実行中でない
      │                              トリガー: SessionEnd(主) または SessionStart(キャッチアップ)
SessionEnd → raw/ へ                      │
   無損失キャプチャ                  保留中の各セッション: `claude -p` で再利用可能な
      │                              知識を抽出 → 構造検証 → git commit。1つの
      └─▶ ゲートチェック ──▶ 必要に  セッション処理が失敗しても、既にコミット済みの
          応じてバッチ起動           ものは安全(セッションごとに個別コミット)。
```

- **キャプチャ**は純粋なファイルコピーです — パース、フィルタリング、
  サイズ制限は一切ありません。`SessionEnd` のたびに transcript 全体が `raw/`
  へ送られます。これは意図的な設計です — 一部しか覚えていないナレッジベースは
  何もないより悪いからです。
- **圧縮**はバッチ実行時に、スクラッチコピー上でのみ行われます —
  キャプチャされたオリジナルには一切触れません。ツールアクセスは
  `Read/Glob/Grep/Write/Edit` に制限され(`Bash` なし)、その1回の呼び出しの
  間、*あなたの*他のフック・プラグイン・MCP サーバーはすべて無効化されます
  (`--safe-mode`)— これによりバッチが自分自身を再キャプチャするループが
  発生しません。
- **ゲート**は concept 本文全体ではなく、コンパクトなカテゴリインデックスと
  最近の変更を注入し、関連作業に取り掛かる前に該当ファイルを実際に `Read`
  するよう指示します — インデックスだけでは古い前提のまま行動してしまう
  リスクがあるためです。
- 構造リンターがバンドルを常に仕様準拠の状態に保ちます — バッチの結果が
  少しでも不正な形式であれば、コミット前に自動的にロールバックされます。

フォーマットの背景と設計意図については Google Cloud の [Open Knowledge Format 発表記事](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/?hl=en&utm_source=pytorchkr&ref=pytorchkr) を参照して
ください — YAML frontmatter 付きの markdown ファイルにすぎないため、この
プラグインなしでもどんなツールでも読み取れます。

## 設定

`~/.claude/okf/.okf/config.md` を直接編集する(frontmatter)か、
`/okf:okf-config` を使ってください。

| キー | デフォルト | 意味 |
|---|---|---|
| `enabled` | `true` | 全体のオン/オフスイッチ(キャプチャ・ゲート・バッチすべてがこの値に従う) |
| `batch_interval_hours` | `1` | バッチ実行間の最小間隔 |
| `batch_max_sessions` | `10` | バッチ1回あたりの処理セッション数(コスト上限) |
| `batch_model` | `claude-sonnet-5` | バッチ ingest で使うモデル、空なら CLI デフォルト |
| `batch_effort` | `medium` | バッチ ingest の推論強度(`low`/`medium`/`high`/`xhigh`/`max`)、空なら CLI デフォルト |
| `capture_exclude_cwd` | `[]` | キャプチャをスキップするディレクトリの glob パターン(opt-out 専用 — キャプチャ自体は決して部分的にならない) |
| `batch_digest_cap_kb` | `150` | LLM に渡すセッションごとの要約サイズ上限(キャプチャされたオリジナルには適用されない) |
| `remove_candidate_ttl_days` | `30` | 処理済み raw transcript を削除するまでの保持期間 |
| `inject_max_lines` / `inject_max_bytes` | `120` / `16384` | ゲート注入のサイズ上限 |
| `claude_bin` / `node_bin` | *(空)* | 環境で `PATH` 解決が失敗する場合の絶対パス override |

## データとプライバシー

- すべてのデータはローカルのみ: `~/.claude/okf` は作業中のどのリポジトリとも
  完全に分離した、それ自体で独立したただの git リポジトリです。**このプラグインの
  どのコードパスも `git push`・`git remote add` などネットワーク関連の操作を
  一切行いません** — 実際に使う git コマンドは `init`、`commit`、`checkout`、
  `clean` だけです(自分で確認できます:
  `grep -n "push\|remote" lib/*.mjs bin/*.mjs` — ヒットするのはすべて無関係な
  `Array.push()` 呼び出しです)。あなた自身が意図的に push しない限り、
  バンドルがマシンの外に出ることはありません。
- バッチ処理は要約・抽出のためセッション内容を Anthropic API に送信します —
  通常の Claude Code 利用時にすでに通信しているのと同じ API で、`claude -p`
  呼び出しがもう1つ増えるだけです。サードパーティサービスは関与しません。
- `raw/`(キャプチャされた完全な transcript)と、処理済みで削除待ちの
  transcript は git にコミットされません(gitignore 対象)— 抽出された
  ナレッジバンドルのみがコミットされます。

## 移植性(他のユーザー・他のマシン)

パスをハードコードしている箇所は一つもありません — すべて `os.homedir()` /
`process.env.CLAUDE_CONFIG_DIR` / `process.env.HOME` 経由で解決するため、別の
マシンや別のユーザーアカウントに新規インストールすれば、それぞれ独立した
バンドルが作られます。テストスイート(`test/smoke.mjs`、78シナリオ)が隔離された
`HOME`/`CLAUDE_CONFIG_DIR` サンドボックスでこれを検証しており、その中には
**git のユーザー設定が全くない環境**も含まれます — このプラグインはあなたの
`user.name`/`user.email` に依存せず、自動コミットには常に固定の独自 identity
(`OKF Batch <okf-batch@localhost>`)を使います。macOS/Linux はこの方法で直接
検証済みですが、Windows 固有の部分(`claude.cmd` 用の `shell:true`、パス区切り
文字)は設計要件どおり実装してあるものの、実際の Windows マシンではまだ実行して
いません — その組み合わせは誰かが確認するまで未検証としてお考えください。

## ライセンス

MIT
