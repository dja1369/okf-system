---
type: reference
title: How this OKF plugin actually works
description: The three stages — lossless capture, batch compression via claude -p, gate injection — and why each is designed that way
resource: https://github.com/dja1369/okf-system
okf_seed: true
tags: [okf, architecture, reference]
timestamp: {{INSTALL_DATE}}
---
# Three stages

```
[session]                        [batch (opportunistic, no scheduler)]
SessionStart → gate injection     Runs when: interval elapsed + no other batch
      │                           Triggered by: SessionEnd (primary) / SessionStart (catch-up)
SessionEnd → lossless capture           │
   to raw/                        Per session: digest → extract knowledge via claude -p
      │                           → structural lint → git commit (one commit per session)
      └─▶ gate check ──▶ batch
```

## 1. Capture — lossless by principle

On `SessionEnd` the transcript is **just copied** into `raw/`. No parsing, no filtering, no size
cap. That's deliberate: a knowledge base built from a partial memory of what happened is worse
than none. Loss at capture time is irreversible, and the only thing that needs shrinking is the
LLM's input — so the batch makes that separately, as a temporary digest.

A side effect: capture never parses JSONL, so schema drift can't break it.

## 2. Batch — the LLM only judges

Everything is Node; the only thing delegated to `claude -p` is the judgment call of what is worth
keeping. Anything that can be done deterministically — index generation, linting, git, chunking —
is not given to an LLM.

- **digest**: deterministically extracts the actual conversation from raw. Harness boilerplate
  (tool results, slash-command echoes, isMeta turns) isn't conversation, so it's filtered out —
  without this filter the LLM read command definitions as "dialogue" and every batch returned
  NO-OP, which is a bug that actually happened here
- **cost cap**: a per-run budget on total digest bytes (`batch_max_digest_kb`). Sized in bytes
  rather than session count because sessions differ by orders of magnitude, so a count says
  nothing about cost
- **isolation**: the batch's `claude -p` runs with `--safe-mode`, so none of your other hooks,
  plugins, or MCP servers load. The batch structurally cannot capture itself into a loop
- **tool restriction**: `--tools` allows only `Read/Glob/Grep/Write/Edit` and blocks `Bash`.
  Digest content comes from past conversations, which may contain text from external sources —
  that's an injection surface
- **transactions**: each chunk lints and commits immediately. If a later chunk dies, earlier
  chunks are already in git

## 3. Gate — inject the index, but make it read the body

`SessionStart` injects the root `index.md` (a category summary) and recent `log.md` changes, and
instructs the model to **Read** the relevant concept before related work. Bodies aren't injected
wholesale because of context budget; paths alone aren't given because then the model skips
reading.

# Where it lives

`~/.claude/okf` (or `$CLAUDE_CONFIG_DIR/okf`). Its own git repository, entirely separate from
whatever repo you're working in, and **no code path ever pushes it** — the only git commands used
are init/commit/checkout/clean.

`raw/` and processed transcripts (`_remove_candidate/`) are gitignored and never committed. Only
distilled knowledge is.

# Rules

What to write and how lives in [/preferences/okf-bundle-rules.md](/preferences/okf-bundle-rules.md)
and in `SCHEMA.md` at the bundle root.
