# OKF for Claude Code

A Claude Code plugin that gives every session a persistent, cross-project knowledge
base — automatically. No manual note-taking, no separate tool to run.

**[한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)**

## What it does

1. **Captures** every session's full conversation, losslessly, when it ends.
2. **Compresses** captured sessions in the background (an opportunistic batch job,
   not a cron/scheduled task) using `claude -p` to extract reusable knowledge —
   decisions, project facts, preferences, patterns, references, troubleshooting —
   into a structured [OKF (Open Knowledge Format)](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/?hl=en&utm_source=pytorchkr&ref=pytorchkr) bundle.
3. **Injects** an index of that bundle into every new session's context as a
   mandatory gate, so Claude actually reads relevant past knowledge before working
   on something related, instead of starting from zero every time.

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
automatically. Three commands are available for manual inspection/control —
**note the `okf:` prefix**, required because these are plugin-scoped commands:

| Command | What it does |
|---|---|
| `/okf:okf-status` | Reports last batch run, pending sessions, lock state |
| `/okf:okf-batch` | Forces an immediate batch run (ignores the interval gate, still respects the lock) |
| `/okf:okf-config` | Shows and lets you edit the current configuration |
| `/okf:okf-index` | Prints a readable overview of the bundle — every category and concept title, plus recent `log.md` changes |

## How it works

```
[your session]                    [background batch (opportunistic, not scheduled)]
SessionStart → gate injection      Runs when: interval elapsed + no other batch running
      │                            Triggered by: SessionEnd (primary) or SessionStart (catch-up)
SessionEnd → lossless capture           │
   to raw/                         For each pending session: extract reusable
      │                            knowledge via `claude -p`, validate structure,
      └─▶ gate check ──▶ spawn     commit to git. One failed session never loses
          batch if due             already-committed ones (each is its own commit).
```

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
| `batch_max_sessions` | `10` | Sessions processed per batch run (cost cap) |
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
exercised by the test suite (`test/smoke.mjs`, 78 scenarios) under isolated
`HOME`/`CLAUDE_CONFIG_DIR` sandboxes, including one with **no git identity
configured at all** — the plugin never depends on your `user.name`/`user.email`;
its own automated commits always use a fixed synthetic identity
(`OKF Batch <okf-batch@localhost>`). macOS and Linux are exercised this way
directly; Windows-specific paths (`shell:true` for `claude.cmd`, path separators)
are implemented per the design doc's requirements but not yet run on an actual
Windows machine — treat that combination as unverified until someone confirms it.

## License

MIT
