# OKF for Claude Code

**Your agent forgets everything you told it yesterday. This fixes that — and the
memory it builds is a folder of markdown you own, not a database you're locked into.**

![MIT license](https://img.shields.io/badge/license-MIT-blue) ![OKF v0.1](https://img.shields.io/badge/OKF-v0.1%20Draft-4ecdc4) ![Node only](https://img.shields.io/badge/runtime-Node%20only-5c6bc0) ![no npm install](https://img.shields.io/badge/dependencies-vendored-66bb6a)

**English** · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português](README.pt-BR.md)

![OKF knowledge graph — concepts linked to the code they describe](docs/okf-graph.png)

<sub>`/okf:okf-visualize` — your knowledge (outlined nodes) and your codebase in one graph.
The dashed yellow edges are the point: each concept linked to the source files it's
actually about.</sub>

Every session starts from zero. You re-explain the same architecture decision, the
same deploy policy, the same "we tried that and it broke" — and the moment the
session ends, it's gone again. Meanwhile the knowledge that *would* have answered
the question is scattered across wikis, code comments, and, as Google's OKF
announcement puts it, "the heads of a few senior engineers."

This plugin closes that loop automatically: it captures what you actually discussed,
distills the reusable parts into a structured knowledge bundle, and puts that
knowledge back in front of the model at the start of every session.

## The format

Knowledge is stored in **[OKF (Open Knowledge Format)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)** —
an open specification Google Cloud [published in June 2026](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/?hl=en&utm_source=pytorchkr&ref=pytorchkr)
(v0.1 Draft, Apache-2.0). It's deliberately unremarkable, and that's the point:

> "The format is intentionally minimal: a directory of markdown files with YAML
> frontmatter. There is no schema registry, no central authority, and no required
> tooling. **If you can `cat` a file, you can read OKF; if you can `git clone` a
> repo, you can ship it.**"

OKF formalizes the "LLM wiki" pattern that [Andrej Karpathy sketched](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
ten weeks earlier — Google's announcement says so explicitly. Since publication a
[small ecosystem](https://github.com/search?q=%22open+knowledge+format%22&type=repositories)
of generators, linters, viewers, and MCP servers has formed around it, and the format
turns up outside Google too (AWS has a [sample](https://github.com/aws-samples/sample-okf-llm-wiki)
serving Glue databases as OKF bundles). It's early — most of that ecosystem is weeks
old — but the format is doing what it claims: being readable without its author's tools.

**Why a format and not a memory product.** Tools like mem0, Letta, Zep, and Cognee
are memory *runtimes* — you attach a library or host a service, and your memory lives
in its vector or graph store. They're a different layer, not a competitor; some of
them could store OKF. The practical difference is **exit cost**: knowledge embedded in
a graph DB is legible only to that system, while an OKF bundle opens in your editor,
renders on GitHub, diffs in a pull request, and is read by any other agent without a
translation step. This plugin never asks you to trust it with the only copy.

## What it does

1. **Captures** every session's full conversation, losslessly, when it ends.
2. **Compresses** captured sessions in the background (an opportunistic batch job,
   not a cron/scheduled task) using `claude -p` to extract reusable knowledge —
   decisions, project facts, preferences, patterns, references, troubleshooting.
3. **Injects** an index of that bundle into every new session's context as a
   mandatory gate, so Claude actually reads relevant past knowledge before working
   on something related, instead of starting from zero every time.
4. **Visualizes** the bundle and your codebase as one graph, linking each concept to
   the files it's actually about (`/okf:okf-visualize`).

Everything lives in a local git repository under `~/.claude/okf` (or
`$CLAUDE_CONFIG_DIR/okf`). Nothing is pushed anywhere. The only network calls are
the ones you already make to Anthropic's API — the batch step is just another
`claude -p` call, run locally.

## Requirements

- Claude Code with plugin support
- Node.js (whatever `claude` itself already requires — no extra runtime)
- git

No `npm install` step. No external services. No configuration required to get
started.

## Install

```
claude plugin marketplace add dja1369/okf-system
claude plugin install okf@okf-marketplace
```

(Installing from a local clone instead: `claude plugin marketplace add /path/to/your/clone`.)

That's it — restart your session and the gate/capture hooks are active. On the
next session start, the bundle is bootstrapped automatically (a local git repo is
created under `~/.claude/okf` with the base structure).

To uninstall: `claude plugin uninstall okf`. Your data in `~/.claude/okf` is left
untouched — it's a plain git repo you can inspect, back up, or delete manually
with `rm -rf ~/.claude/okf`.

## Usage

Normal usage requires nothing from you. Capture and batch compression happen
automatically. Five commands are available for manual inspection/control —
**note the `okf:` prefix**, required because these are plugin-scoped commands:

| Command | What it does |
|---|---|
| `/okf:okf-status` | Reports last batch run, pending sessions, lock state |
| `/okf:okf-batch` | Forces an immediate batch run (ignores the interval gate, still respects the lock) |
| `/okf:okf-config` | Shows and lets you edit the current configuration |
| `/okf:okf-index` | Prints a readable overview of the bundle — every category and concept title, plus recent `log.md` changes |
| `/okf:okf-visualize` | Renders the bundle + your codebase as one interactive graph (self-contained HTML) |

A fresh install isn't empty: the bundle ships seeded with concepts describing OKF
itself, this plugin's architecture, and the bundle's writing rules — so the gate has
something real to point at from the first session, and the bundle documents itself.

## Visualization

`/okf:okf-visualize` renders your knowledge and your code as a single graph. The interesting
part isn't either half — it's the dashed links between them, connecting each concept
to the source files it actually talks about.

If [Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) has already
analyzed the repo (`.understand-anything/` or `.ua/knowledge-graph.json`), that richer
LLM-summarized graph is used. Otherwise this plugin's own analyzer builds one — pure
Node, no native modules — extracting files, functions, and classes across JS/TS,
Python, Go, Rust, Java/Kotlin, Ruby, PHP, C/C++, C#, and Swift.

Import *edges* are drawn wherever a specifier names a file: JS/TS, Python (including
dotted module paths), C/C++ quoted includes, `require_relative`, and Rust `mod`. Where
a language imports a *package* rather than a file — Go's `myapp/pkg/db`, Java's
`com.foo.Bar` — the reference is recorded as an external dependency instead of being
guessed at, since a package is a directory and picking a file inside it would just
invent a fact. It's regex-based, not a real parser: that buys zero dependencies and
costs some accuracy on unusual formatting.

The output is a self-contained HTML file: no CDN, no network requests, no backend. It
opens offline, because opening your own knowledge base should not phone anywhere.

## How it works

![Architecture: sessions capture into raw, a background batch distills to an OKF bundle, the bundle index is injected back into the next session](docs/architecture.svg)

- **Capture** is a pure file copy — no parsing, no filtering, no size cap. The full
  transcript goes to `raw/` on every `SessionEnd`. This is by design: a knowledge
  base built from a partial memory of what happened is worse than none.
- **Compression** only happens at batch time, on a scratch copy — the captured
  original is never touched. It runs with tool access restricted to
  `Read/Glob/Grep/Write/Edit` (no `Bash`) and with all of *your* other hooks,
  plugins, and MCP servers disabled for that one call (`--safe-mode`), so it can't
  loop back into capturing itself.
- **The gate** injects a compact category index (not full concept text) plus
  recent changes, and instructs Claude to actually `Read` the relevant file before
  touching related work — the index alone isn't enough for it to act on stale
  assumptions.
- A structural linter keeps the bundle always spec-conformant: if a batch run
  would leave anything malformed, it's automatically rolled back before commit.

See Google Cloud's [Open Knowledge Format announcement](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/?hl=en&utm_source=pytorchkr&ref=pytorchkr) for the format's background and design rationale — it's just markdown
files with YAML frontmatter, readable by any tool, not specific to this plugin.

## Configuration

Edit `~/.claude/okf/.okf/config.md` directly (frontmatter), or use
`/okf:okf-config`.

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master on/off switch (capture, gate, and batch all follow it) |
| `batch_interval_hours` | `1` | Minimum time between batch runs |
| `batch_max_digest_kb` | `600` | Per-run budget on total digest bytes — the real cost cap. Sessions over budget roll to the next run |
| `batch_max_sessions` | `50` | Safety ceiling only; `batch_max_digest_kb` is the actual dial |
| `seed_language` | `en` | Language of the concepts seeded at first bootstrap (`en`, `ko`; unknown values fall back to `en`) |
| `batch_model` | `claude-sonnet-5` | Model used for batch ingestion; empty = CLI default |
| `batch_effort` | `medium` | Reasoning effort for batch ingestion (`low`/`medium`/`high`/`xhigh`/`max`); empty = CLI default |
| `capture_exclude_cwd` | `[]` | Glob patterns for directories to skip capturing (opt-out only — capture itself is never partial) |
| `batch_digest_cap_kb` | `150` | Per-session size cap for the LLM-facing summary (the captured original is never capped) |
| `remove_candidate_ttl_days` | `30` | How long processed raw transcripts are kept before deletion |
| `inject_max_lines` / `inject_max_bytes` | `120` / `16384` | Gate injection size caps |
| `claude_bin` / `node_bin` | *(empty)* | Absolute path overrides if `PATH` resolution fails in your environment |

## Data & privacy

- Everything stays local: `~/.claude/okf` is its own plain git repository, entirely
  separate from any repository you happen to be working in. **No code path in this
  plugin ever runs `git push`, `git remote add`, or anything network-related on
  it** — the only git operations used anywhere are `init`, `commit`, `checkout`,
  and `clean` (verifiable: `grep -n "push\|remote" lib/*.mjs bin/*.mjs` — the only
  matches are unrelated `Array.push()` calls). Your bundle never leaves your
  machine unless you deliberately `git push` it yourself.
- The batch step sends session content to the Anthropic API to do the
  summarization/extraction — the same API your normal Claude Code usage already
  talks to, just via one more `claude -p` call. No third-party service is
  involved.
- `raw/` (full captured transcripts) and processed-but-pending-deletion transcripts
  are git-ignored, not committed — only the extracted knowledge bundle is.

## Portability

No path is ever hardcoded — everything resolves through `os.homedir()` /
`process.env.CLAUDE_CONFIG_DIR` / `process.env.HOME`, so a fresh install on a
different machine or user account produces its own independent bundle. This is
exercised by the test suite (`test/smoke.mjs`) under isolated
`HOME`/`CLAUDE_CONFIG_DIR` sandboxes, including one with **no git identity
configured at all** — the plugin never depends on your `user.name`/`user.email`;
its own automated commits always use a fixed synthetic identity
(`OKF Batch <okf-batch@localhost>`). macOS and Linux are exercised this way
directly; Windows-specific paths (`shell:true` for `claude.cmd`, path separators)
are implemented per the design doc's requirements but not yet run on an actual
Windows machine — treat that combination as unverified until someone confirms it.

## License

MIT
