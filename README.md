# OKF for Claude Code

**Turn decisions from past Claude Code sessions into a local, reviewable knowledge bundle that future sessions can actually use.**

![MIT license](https://img.shields.io/badge/license-MIT-blue) ![OKF v0.1](https://img.shields.io/badge/OKF-v0.1%20Draft-4ecdc4) ![Node only](https://img.shields.io/badge/runtime-Node%20only-5c6bc0) ![no npm install](https://img.shields.io/badge/dependencies-vendored-66bb6a)

**English** · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português](README.pt-BR.md)

OKF captures a completed session, distills reusable decisions and troubleshooting into plain Markdown, then injects a compact index into the next session. The bundle is a local git repository you can inspect, diff, back up, or delete.

## One-minute quick start

Requirements: Claude Code with plugin support, Node.js, and git. There is no `npm install` step.

```sh
claude plugin marketplace add dja1369/okf-system
claude plugin install okf@okf-marketplace
```

Restart Claude Code, finish a normal session, then inspect the system:

```text
/okf:okf-status
/okf:okf-index
```

The first `SessionStart` creates `~/.claude/okf` (or `$CLAUDE_CONFIG_DIR/okf`). Normal capture and opportunistic batch ingest are automatic.

## The continuity loop

```text
Session 1             SessionEnd              Background batch           Session 2
make a decision  ->   lossless raw copy  ->   reusable OKF Markdown  ->  compact index injected
                                                 |                            |
                                                 +-- local git history        +-- Read relevant concept
```

Example: one session records “deploy 10% → 50% → 100%, roll back above 0.5% errors.” After capture and ingest, a later session can discover that exact policy through the injected index without the user pasting it again. The index is a routing layer, not the whole memory: Claude must `Read` the relevant concept before acting.

## Commands

Plugin commands always require the `okf:` namespace.

| Command | Purpose |
|---|---|
| `/okf:okf-status` | Last capture/batch result, pending sessions, and lock state |
| `/okf:okf-batch` | Run ingest now; still respects the batch lock |
| `/okf:okf-config` | Show or edit validated configuration |
| `/okf:okf-index` | List categories, concept titles, and recent changes |
| `/okf:okf-visualize` | Render OKF concepts and concept-to-concept links only |
| `/okf:okf-analysis [path]` | Analyze a repository and show code plus only related OKF concepts |

`visualize` answers “what does my bundle know?” and never scans a repository. `analysis` answers “what is this codebase, given what my bundle knows?” It rejects missing/non-directory paths, reports truncated analysis and hidden unrelated concepts, and exposes language-level file/declaration/internal-edge counts.

Both commands produce self-contained HTML with no CDN or runtime network requests.

## Optional statusline

`bin/statusline.mjs` prints a cheap local summary without network calls or graph analysis:

```text
OKF 12 · +3 · 2h ago
OKF 12 · batch running
OKF 12 · last: partial: 1/3 chunks
```

Claude Code permits one `statusLine`. OKF does not install or overwrite it. Point your existing statusline script at `node /path/to/okf/bin/statusline.mjs` and append its single-line output, or configure it directly if you do not already have one.

## OKF effectiveness benchmark

<!-- okf-live-benchmark: valid-2026-07-15T15-03-01Z -->

Live run on 2026-07-15: Claude Code `2.1.210`, requested `sonnet`/medium (resolved Sonnet 5 + Haiku 4.5), macOS arm64, Node `v26.4.0`, commit `c00d3fc`, five crossed-order runs per condition. Before follow-up calls, C had all 8/8 target facts in concepts and all 8/8 were gate-routed; D had 0/8.

The opt-in harness compares at least five repeated runs of:

| Condition | Continuity | Token activity p50 / p95 | Wall p50 / p95 | Cost p50 |
|---|---:|---:|---:|---:|
| A — no memory | 0/5 | 27,320 / 27,574 | 16.40 / 18.17 s | $0.024037 |
| B — manual restatement | 5/5 | 9,070 / 9,093 | 6.07 / 7.42 s | $0.008410 |
| C — OKF enabled | 5/5 | 22,857 / 22,883 | 11.33 / 12.80 s | $0.033189 |
| D — irrelevant OKF | 0/5 | 21,507 / 22,261 | 16.92 / 18.88 s | $0.030332 |

C recovered every target fact, but it did **not** reduce tokens, response time, tools, or cost versus equally correct B. Median C used 13,787 more token activity and 5.26 s more wall time. Batch ingest added 111,381 token activity and $0.164360; because B−C saving was negative, token and cost break-even are not measurable.

It measures success, decision compliance, wrong assumptions, extra questions, tool calls, first valid response, API/wall time, `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, and CLI-reported cost. Token categories remain separate in raw JSON. Batch ingest and repair usage are included in break-even calculations. Values the Claude CLI does not expose separately—such as user-only or gate-only tokens—remain `null`; they are not estimated.

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs
```

This is paid, authenticated, and intentionally excluded from smoke tests and CI. Token categories remain separate; user-only/gate-only/transcript tokens unavailable from the CLI remain `null`. See the [valid report](docs/benchmarks/okf-live-2026-07-15T15-03-01-343Z.md), [raw JSON](docs/benchmarks/raw/okf-live-2026-07-15T15-03-01-343Z.json), and [usage guide](docs/USAGE.md).

### Local overhead (not the OKF effectiveness result)

Fresh local measurement on 2026-07-15: macOS arm64, Node `v26.4.0`, median with min/max range.

| Local operation | Median | Range |
|---|---:|---:|
| SessionStart gate process | 57.4 ms | 56.7–58.2 ms |
| SessionEnd lossless capture process | 43.4 ms | 41.8–43.9 ms |
| Statusline process | 36.7 ms | 34.8–36.8 ms |

Reproduce with `node test/bench.mjs [repository]`. These numbers measure local hook/process cost only; they do not prove token savings or faster model responses.

### Batch cost and break-even

The live harness records batch ingest and repair usage through an explicit privacy-safe telemetry file. It calculates both token-activity and CLI-reported cost break-even only when the measured median saving is positive:

```text
initial OKF cost = batch ingest + repair + measured irrelevant-gate overhead
per-session net saving = manual-restatement median - OKF median
break-even sessions = ceil(initial OKF cost / positive per-session net saving)
```

Measured B-C savings were negative, so token and cost break-even do not exist in this run.

## Language support

The fallback analyzer is deterministic, dependency-free, and intentionally conservative. “File discovered” is distinct from “structure analyzed”; `/okf:okf-analysis` reports both.

| Language | Internal relationships | Declarations | Important limits |
|---|---|---|---|
| JavaScript / TypeScript | relative import/export/require, NodeNext `.js` → TS | function, class | bare packages remain external |
| Python | absolute/relative dotted modules | function, class | dynamic imports are not resolved |
| Go | module-internal package nodes from `go.mod` | function, struct | not fabricated as file-to-file imports |
| Rust | `mod`, `use crate/self/super` | function, struct/enum/trait | macro-generated structure omitted |
| Java / Kotlin | repository-declared package/class paths | class/interface/enum, Kotlin function | reflection omitted |
| Ruby | `require_relative` | class, method | gems remain external |
| PHP | namespace/use/alias/grouped use, require/include | class/interface/trait/enum/function | dynamic autoload/call targets omitted |
| C / C++ | quoted include; explicit-path unique local angle include | class/struct/enum/union/typedef/namespace/function definition | regex parser; macros and complex multiline syntax may be missed |
| C# | repository-declared namespace nodes | class/interface/struct/record/enum | external namespaces remain external |
| Swift | explicit inheritance, conformance, extension targets | class/struct/enum/protocol/actor/extension/typealias/function | nested cross-file targets omitted to avoid name collisions |

At 2,000 files the graph is marked `truncated`. Files above 512 KiB remain visible but are marked unanalyzed. Vendor/generated directories are excluded conservatively; unusual layouts can still require interpretation.

## Real open-source validation

Pinned repositories were cloned and representative edges were checked against source. Times are operational-safety single runs, not model-speed benchmarks.

| Repository | Commit | Language files | Declarations | Internal edges | Truncated |
|---|---|---:|---:|---:|---:|
| [Slim](https://github.com/slimphp/Slim) | `80900fb` | 125 | 127 | 305 | no |
| [Redis](https://github.com/redis/redis) | `f76dff7` | 784 | 5,796 | 990 | no |
| [fmt](https://github.com/fmtlib/fmt) | `a79df45` | 46 | 283 | 121 | no |
| [Alamofire](https://github.com/Alamofire/Alamofire) | `903c53c` | 98 | 2,052 | 215 | no |

The validation found and fixed two false edges: Swift standard `Error` linking to an unrelated nested `Error`, and C standard headers linking to vendored compatibility headers. Source-line checks and remaining gaps are in [the validation report](docs/benchmarks/oss-analysis-2026-07-15.md).

## Data flow and privacy

- `SessionEnd` copies the full transcript into `raw/`; it is not parsed or truncated during capture.
- Batch creates a capped digest and sends that digest to Anthropic through a separate `claude -p` call. This is the only extra model/API transfer introduced by OKF.
- Batch runs with `--safe-mode`, a restricted tool set, prompt over stdin, lint/rollback, and no Bash tool.
- Raw and processed transcripts are git-ignored. Only extracted Markdown knowledge is committed locally.
- The plugin never pushes or adds a remote. POSIX directories are `0700`; raw/state/log files are `0600`. Windows uses account ACLs.
- Persistent diagnostic logs exclude transcript text, Claude stdout/stderr, credentials, and full raw paths.
- The live benchmark fixture is synthetic and contains no personal data or credentials.

## Configuration

Edit `~/.claude/okf/.okf/config.md` or use `/okf:okf-config`. Unknown or invalid values are ignored with safe defaults.

| Key | Default | Meaning |
|---|---:|---|
| `enabled` | `true` | Master switch for capture, gate, and batch |
| `batch_interval_hours` | `1` | Minimum interval between opportunistic batches |
| `batch_max_digest_kb` | `600` | Total per-batch digest budget |
| `batch_max_sessions` | `50` | Runaway ceiling; byte budget is the cost control |
| `batch_model` / `batch_effort` | `claude-sonnet-5` / `medium` | Batch model controls; empty uses CLI defaults |
| `capture_exclude_cwd` | `[]` | Explicit capture opt-out globs |
| `batch_digest_cap_kb` | `150` | Per-session LLM-facing digest cap; raw stays complete |
| `remove_candidate_ttl_days` | `30` | Retention before processed raw deletion |
| `inject_max_lines` / `inject_max_bytes` | `120` / `9000` | Inline gate limits below Claude Code’s 10,000-character threshold |

## Removal

```sh
claude plugin uninstall okf
```

The data bundle remains at `~/.claude/okf`. Review or back it up, then delete it manually if desired.

## Development verification

```sh
node test/smoke.mjs
node test/bench.mjs
for file in $(rg --files -g '*.mjs'); do node --check "$file"; done
claude plugin validate .claude-plugin/plugin.json
claude plugin validate .claude-plugin/marketplace.json
git diff --check
```

The live benchmark is separate and opt-in: `OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs`.

## References and license

README structure was informed by the concise installation/reproduction patterns used by [uv](https://github.com/astral-sh/uv), [Ruff](https://github.com/astral-sh/ruff), [Playwright](https://github.com/microsoft/playwright), [fmt](https://github.com/fmtlib/fmt), and [Slim](https://github.com/slimphp/Slim); no wording or benchmark claim is copied.

OKF background: [Open Knowledge Format specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md). This plugin is licensed under [MIT](LICENSE).
