# OKF usage and measurement guide

This guide separates three things that are easy to confuse: the user workflow, local hook
overhead, and live model effectiveness. Only the last one can support claims about answer
quality, tokens, latency, or break-even.

## End-to-end workflow

1. `SessionStart` bootstraps the local bundle and injects a compact concept index.
2. During the session, Claude reads only concepts relevant to the current task.
3. `SessionEnd` copies the transcript byte-for-byte into `raw/`.
4. Once the configured interval passes, a detached `claude -p` batch distills reusable facts,
   validates the bundle, commits valid Markdown locally, and archives processed raw input.
5. A later session receives the refreshed index and can retrieve the new concept.

The bundle defaults to `~/.claude/okf` or `$CLAUDE_CONFIG_DIR/okf`. It is an ordinary local git
repository: inspect, diff, back up, or remove it with normal tools.

## Commands

```text
/okf:okf-status              batch status, pending sessions, lock state
/okf:okf-batch               force ingest now, while respecting the lock
/okf:okf-config              inspect or edit validated settings
/okf:okf-index               list categories, concepts, and recent changes
/okf:okf-visualize           render bundle concepts only
/okf:okf-analysis [path]     analyze code and show only related bundle concepts
```

`okf-visualize` never scans a repository. `okf-analysis` defaults to the current directory,
rejects missing or non-directory paths, and reports language file/declaration/internal-edge
coverage, truncation, oversized files, and hidden unrelated concepts. Its HTML output is
self-contained and makes no CDN or runtime network requests.

## Optional statusline

`bin/statusline.mjs` prints one local line such as `OKF 12 · +3 · 2h ago`. Claude Code permits
only one statusline, so OKF never installs or overwrites it. Invoke the script from an existing
statusline, or configure it directly if no statusline is already present. It performs no model
call or repository analysis and exits successfully even when status data is unavailable.

## Configuration and operational limits

The main controls in `.okf/config.md` are:

| Setting | Default | Purpose |
|---|---:|---|
| `batch_interval_hours` | `1` | Minimum opportunistic batch interval |
| `batch_max_digest_kb` | `600` | Total LLM-facing digest budget per batch |
| `batch_max_sessions` | `50` | Runaway ceiling; not the primary cost control |
| `batch_digest_cap_kb` | `150` | Per-session digest cap; raw remains lossless |
| `capture_exclude_cwd` | `[]` | Directories whose sessions are never collected (matched against each session's cwd) |
| `sweep_min_idle_minutes` | `60` | Idle time after the last activity before a conversation is collected; `0` collects immediately |
| `inject_max_lines` / `inject_max_bytes` | `120` / `9000` | Inline gate limits |

Files above 512 KiB remain visible in analysis but are marked unanalyzed. Repository analysis
stops at 2,000 files and reports `truncated: true`. The fallback parser is conservative and
does not claim compiler-level resolution for macros, generated declarations, dynamic imports,
reflection, or runtime autoloading.

## Data flow, privacy, and recovery sweep

- Capture copies the complete transcript locally; it does not parse or truncate it.
- Batch sends only the capped digest through a separate authenticated `claude -p` call. This is
  the only additional model/API transfer introduced by OKF.
- Raw and processed transcripts are git-ignored. Extracted concepts alone are committed locally.
- OKF never creates a remote or pushes. On POSIX, bundle directories are `0700` and sensitive
  files are `0600`; on Windows, account ACLs are used.
- Persistent logs and benchmark telemetry exclude transcript content, Claude output, credentials,
  and full raw paths.
- The recovery sweep uses `CLAUDE_CONFIG_DIR`, skips batch-owned session IDs, and excludes
  transcripts whose recorded working directory is the OKF bundle. This prevents the batch's own
  safe-mode session from being re-ingested while still recovering genuinely missed hooks.
- Test and smoke processes isolate `HOME`, `USERPROFILE`, and `CLAUDE_CONFIG_DIR`; they do not scan
  the user's real Claude session history or trigger paid opportunistic batches.

## Local overhead benchmark

Run:

```sh
node test/bench.mjs [repository]
```

Fresh measurement on 2026-07-16, macOS arm64, Node `v26.4.0`:

| Operation | Median | Min–max |
|---|---:|---:|
| SessionStart gate process | 57.2 ms | 56.9–58.1 ms |
| SessionEnd trigger process | 41.4 ms | 39.0–42.1 ms |
| Statusline process | 35.0 ms | 35.0–35.2 ms |
| Analyze this repository | 13.0 ms | 11.8–22.5 ms |
| Build graph | 11.5 ms | 11.3–12.4 ms |
| Render self-contained HTML | 0.3 ms | 0.2–0.6 ms |

The repository sample contained 68 files, 260 nodes, and 255 edges; the HTML was 126 KiB.
These are local process measurements, not evidence that OKF saves model tokens or improves answers.

## Live OKF effectiveness benchmark

<!-- okf-live-benchmark: v3-2026-07-16 -->

The current benchmark (v3, 2026-07-16) measures OKF against a no-memory baseline, a CLAUDE.md
incumbent, and two controls, on two pinned public repositories (Slim `80900fb3`, rust-lang/rfcs
`f635361c`). It replaces an earlier synthetic-fixture run whose baseline searched a directory in
which the target facts existed nowhere — so that baseline scored 0/5 by construction, not by any
property of OKF. That design and its results are retired; do not cite them.

The harness is paid, authenticated, opt-in, and excluded from smoke tests and CI:

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-knowledge.mjs --target slim --dir <repo>   # real sessions → transcripts
OKF_RUN_LIVE_BENCH=1 node test/bench-bundles.mjs --target slim --levels 20      # real batch → bundle
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                                    # measure
```

Optional controls: `OKF_BENCH_RUNS` (contrast n, default 15), `OKF_BENCH_CONTROL_RUNS` (control n,
default 5), `OKF_BENCH_MODEL`, `OKF_BENCH_EFFORT`, `OKF_BENCH_MAX_TURNS`, `OKF_BENCH_MAX_BUDGET_USD`,
`OKF_BENCH_CONCURRENCY`, and `OKF_BENCH_ONLY_KEY` (run a single scenario end-to-end before spending
on the full grid).

Five conditions — zero-base, answer-key, OKF, wrong-knowledge, CLAUDE.md — all with identical tools
and a condition-neutral instruction. The gate is delivered through the real `SessionStart` hook
(`additionalContext`), and delivered bytes are verified per run. Grading is per **atom** against
source-verified ground truth, with the v2-style binary score published beside it. `total_cost_usd`
is the headline, with sonnet-only cost beside it so the CLI's internal `claude-haiku` use can be
netted out.

**Two guards this harness enforces, both learned from real failures:**

- **Model-mix confound.** If any condition's non-primary-model cost share exceeds a threshold
  (default 15%), the run writes its results and then exits non-zero — a real per-condition model
  split would make cost comparisons an artifact. It does *not* abort merely because Haiku resolves
  alongside Sonnet in every condition (that is uniform and is quantified, not a confound).
- **Project-memory contamination.** Claude Code auto-injects per-directory project memory
  (`~/.claude/projects/<cwd>/memory/`) into every session. A knowledge-building session exploring
  the target repo can save team decisions there, and measurement in the same directory would then
  leak them into the zero-base condition. The harness clears that memory before measuring, and the
  report excludes any scenario whose zero-base runs read project memory.

Design, predictions, and the refutation criteria R1–R5 are
[pre-registered](benchmarks/pre-registration-2026-07-16-v3.md), committed before the first paid
call. That document also records the six false or unsupported statements the previous (v2)
publication made and how each was caught from its own raw data. Results, the committed bundles every
number rests on, and the full report:

- [Full report](benchmarks/okf-benchmark-2026-07-16-v3.md)
- [Raw JSON](benchmarks/raw/)
- [Committed bundles](benchmarks/bundles/) — the exact gate text and concept bodies
- [Pre-registration](benchmarks/pre-registration-2026-07-16-v3.md)

### Chain follow-up (v4) — does real accumulation help across a chain of related questions?

<!-- okf-live-benchmark-chain: v4-2026-07-16 -->

A separate, pre-registered run (`test/bench-chain.mjs`) tests OKF's mechanism directly: a chain of 4
related-but-different questions, where each session's conclusion is fed through a **real batch**
before the next session starts, against a no-accumulation control that asks the same 4 questions
independently. v3's pre-registration flagged this exact shape as "favours OKF, tunable to flatter
it" and declined to run it; v4 ran it with guards (frozen/source-verified questions, per-session
project-memory clearing, mechanical refutation criteria) on `kubernetes/kubernetes`'s
`pkg/scheduler`. Real accumulation was confirmed (gate bytes grew monotonically, backed by real
batch spend), but the core prediction — cost falling across the chain — was **refuted**: both arms
got more expensive at the hardest (fourth) question, and OKF's accuracy did not exceed the
baseline's at any step.

```sh
OKF_RUN_LIVE_BENCH=1 OKF_BENCH_CHAINS=15 node test/bench-chain.mjs
```

- [Chain follow-up report](benchmarks/okf-benchmark-chain-2026-07-16-v4.md)
- [Chain pre-registration](benchmarks/pre-registration-2026-07-16-v4.md)

### Recorded fields

The raw JSON contains, per run: condition, scenario, atom-level grade with per-atom status, binary
grade, structured answer, tool counts by name, read paths, whether a concept file was actually read,
gate bytes actually delivered through the hook, per-model cost breakdown, sonnet-only cost, first
valid response, API/model duration, wall time, turn count, CLI-reported cost, and the resolved model
set. Usage categories are never collapsed in raw data:

```text
token activity = input_tokens
               + output_tokens
               + cache_creation_input_tokens
               + cache_read_input_tokens
```

This sum is an explicit activity measure, not a billing formula; `cache_read` dominates it and bills
far cheaper, so cost and token activity can disagree in direction — cost is the headline. Missing
values are reported as missing rather than inferred. Temporary paths are sanitized out of the
published JSON.

### Break-even

Break-even includes the real batch cost of building the bundle — omit it and per-session savings
look free. It is computed only where the median saving is positive, and null with a stated reason
otherwise (negative saving, or a policy scenario where the baseline can never answer so there is no
saving to define). Break-even against the CLAUDE.md incumbent (pre-registered R5) is evaluated
separately from break-even against zero-base. No hand-converted price estimate is substituted for
the CLI-reported total.

## Real open-source analyzer validation

Pinned official repositories were cloned and representative source edges were checked manually.
The full report is [oss-analysis-2026-07-15.md](benchmarks/oss-analysis-2026-07-15.md).

| Repository | Commit | Language files | Declarations | Internal edges | Truncated |
|---|---|---:|---:|---:|---:|
| Slim | `80900fb` | 125 PHP | 127 | 305 | no |
| Redis | `f76dff7` | 784 C | 5,796 | 990 | no |
| fmt | `a79df45` | 46 C++ | 283 | 121 | no |
| Alamofire | `903c53c` | 98 Swift | 2,052 | 215 | no |

The validation exposed two false-link cases that became regression tests: Swift's standard
`Error` matching an unrelated nested declaration, and C standard headers matching vendored
compatibility headers.

## Disable or remove

Set `enabled: false` through `/okf:okf-config` to stop collection, gate, and batch, or uninstall:

```sh
claude plugin uninstall okf
```

The local bundle remains until the user reviews and deletes it explicitly.
