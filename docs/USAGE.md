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
/okf:okf-status              capture/batch status, pending sessions, lock state
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
| `capture_exclude_cwd` | `[]` | Explicit directories whose sessions are not captured |
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

Fresh measurement on 2026-07-15, macOS arm64, Node `v26.4.0`:

| Operation | Median | Min–max |
|---|---:|---:|
| SessionStart gate process | 57.4 ms | 56.7–58.2 ms |
| SessionEnd lossless capture process | 43.4 ms | 41.8–43.9 ms |
| Statusline process | 36.7 ms | 34.8–36.8 ms |
| Analyze this repository | 13.0 ms | 11.8–22.5 ms |
| Build graph | 11.5 ms | 11.3–12.4 ms |
| Render self-contained HTML | 0.3 ms | 0.2–0.6 ms |

The repository sample contained 68 files, 260 nodes, and 255 edges; the HTML was 126 KiB.
These are local process measurements, not evidence that OKF saves model tokens or improves answers.

## Live OKF effectiveness benchmark

<!-- okf-live-benchmark: valid-2026-07-15T15-03-01Z -->

A valid isolated run was completed on 2026-07-15. The harness remains paid, authenticated,
opt-in, and excluded from smoke tests and CI:

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs
```

Optional controls are `OKF_BENCH_RUNS` (minimum 5), `OKF_BENCH_MODEL`,
`OKF_BENCH_EFFORT`, `OKF_BENCH_MAX_TURNS`, and `OKF_BENCH_MAX_BUDGET_USD`.
Defaults are five repeats, model `sonnet`, effort `medium`, eight turns, and a USD 0.50 ceiling
per follow-up call. All four conditions use the same model, effort, tool allowlist, turn cap,
JSON schema, and six-task prompt.

| Condition | Follow-up context | Purpose |
|---|---|---|
| A — no memory | No previous facts or restatement | Baseline continuity failure |
| B — manual restatement | User repeats all prior facts | Cost of recovering correctness manually |
| C — OKF enabled | Real capture → batch → gate | End-to-end OKF effect |
| D — irrelevant OKF | Only unrelated concepts | Fixed gate/cache overhead and distraction check |

Environment: Claude Code `2.1.210`, requested `sonnet`/medium and resolved Sonnet 5 plus Haiku
4.5, macOS arm64, Node `v26.4.0`, commit `c00d3fc`, five crossed-order runs per condition. The
preflight proved that C contained and gate-routed all 8/8 target facts before follow-up calls;
D contained 0/8.

| Condition | Continuity | Compliance p50 | Token activity p50 / p95 | Wall p50 / p95 | Tools p50 | Cost p50 |
|---|---:|---:|---:|---:|---:|---:|
| A — no memory | 0/5 | 0% | 27,320 / 27,574 | 16.40 / 18.17 s | 4 | $0.024037 |
| B — manual restatement | 5/5 | 100% | 9,070 / 9,093 | 6.07 / 7.42 s | 1 | $0.008410 |
| C — OKF enabled | 5/5 | 100% | 22,857 / 22,883 | 11.33 / 12.80 s | 6 | $0.033189 |
| D — irrelevant OKF | 0/5 | 0% | 21,507 / 22,261 | 16.92 / 18.88 s | 3 | $0.030332 |

C recovered every target fact in 5/5 runs, matching B's correctness without the user repeating
facts in the follow-up prompt. However, C did not improve efficiency: versus B its median token
activity was 13,787 higher, wall time 5.26 seconds longer, and CLI cost $0.024779 higher. The
small sample and server/network variation also prohibit claims from small differences.

Batch ingest used 111,381 token activity and $0.164360 in one call. B−C savings were negative,
so neither token nor cost break-even exists in this run. See the
[valid report](benchmarks/okf-live-2026-07-15T15-03-01-343Z.md) and
[raw JSON](benchmarks/raw/okf-live-2026-07-15T15-03-01-343Z.json).

Runs use a deterministic synthetic transcript with architecture, coding rule, failure fix,
response preference, file/policy, and an unrelated arithmetic check. A crossed schedule rotates
condition order. Each condition has one cold-cache run followed by warm runs where the CLI/service
permits caching; raw cache creation and cache read counters are always retained separately.
Before the paid follow-up loop, a mandatory audit checks that every target fact exists in a C
concept and its path appears in the gate, while D contains none. The benchmark-only batch flag
skips orphan sweep so the user's real Claude history cannot enter the synthetic experiment.

An earlier run at `14:44:09Z` violated that isolation and used an over-strict answer grader. Its
raw artifact is retained for audit, but its Markdown report is prominently marked `INVALID` and
none of its measurements are used here.

### Recorded fields

The raw JSON contains order, cold/warm label, structured answer, per-field grade, wrong assumptions,
additional questions, tool counts, first valid response, API/model duration, wall time, turn count,
CLI-reported cost, and the complete stream-json event sequence with temporary paths sanitized.
Usage categories are never collapsed in raw data:

```text
token activity = input_tokens
               + output_tokens
               + cache_creation_input_tokens
               + cache_read_input_tokens
```

This sum is an explicit activity measure, not a billing formula. `userInputTokens` and
`injectedContextTokens` stay `null` because the Claude CLI does not expose those boundaries.
Transport/model retry count also stays `null` when the CLI does not expose it. Missing values are
reported as missing rather than inferred.

Outputs are written to timestamped files under `docs/benchmarks/raw/` plus a Markdown summary in
`docs/benchmarks/`. Raw events make medians, p95, cache behavior, grading, and cost auditable.

### Batch cost and break-even

Condition C records the one-time batch model usage in a privacy-safe telemetry file. The summary
includes batch and repair tokens, cache counters, duration, and CLI-reported USD cost. Break-even
is shown only when the measured median saving is positive:

```text
initial OKF cost = batch ingest + repair + measured irrelevant-gate overhead
per-session net saving = manual-restatement median - OKF median
break-even sessions = ceil(initial OKF cost / per-session net saving)
```

Token-activity and CLI-cost break-even are computed separately. No hand-converted price estimate
is substituted for CLI-reported cost. Official list prices checked on 2026-07-15 were Sonnet 5
$2/MTok input and $10/MTok output through 2026-08-31, and Haiku 4.5 $1/$5; the calculation still
uses the CLI-reported total.

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

Set `enabled: false` through `/okf:okf-config` to stop capture, gate, and batch, or uninstall:

```sh
claude plugin uninstall okf
```

The local bundle remains until the user reviews and deletes it explicitly.
