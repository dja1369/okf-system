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

<!-- okf-live-benchmark: valid-2026-07-15T16-06-28Z -->

**OKF does not save tokens. It recovers what a fresh session has already lost.** The numbers below are published because they say that plainly.

### What is measured

A follow-up session is asked for eight facts a previous session established, plus one control question that memory cannot help with:

| Type | Expected |
|---|---|
| Architecture | SQLite / repository pattern |
| Coding rule | named export only |
| Past incident fix | `busy_timeout=5000` (SQLITE_BUSY) |
| Response preference | Korean / concise |
| File & deploy policy | `src/config.mjs` / `npm run deploy:canary` |
| Unrelated arithmetic (control) | 7 × 8 = 56 |

Five conditions, five crossed-order runs each. C's bundle is built by a **real** SessionEnd capture → isolated batch ingest → SessionStart gate — no hand-seeded concepts. A preflight refuses to spend money unless C actually contains and gate-routes every target fact and D contains none.

- **A — no memory.** The honest status quo: a fresh session, nothing restated.
- **B_oracle — the answer key.** Pastes exactly the 8 expected values. Producing that string requires already knowing every fact OKF exists to recover, so **no user can occupy this condition**; it is an upper bound, not a baseline. Its human labour is priced at zero.
- **B_realistic — what people actually do.** Restates everything that might be relevant, because you cannot know in advance which fact the next session needs. This is the CLAUDE.md habit.
- **C — OKF enabled.**
- **D — irrelevant OKF.** A gate with no relevant content, to separate "the gate helped" from "a gate costs something".

### Results

Live run 2026-07-15: Claude Code `2.1.210`, `sonnet`/medium (resolved Sonnet 5 + Haiku 4.5), macOS arm64, Node `v26.4.0`, 5 runs per condition. C preflight: 8/8 facts present, 8/8 gate-routed. D: 0/8.

| Condition | Continuity | Token activity p50 | Wall p50 | Cost p50 | Reads | Turns |
|---|---:|---:|---:|---:|---:|---:|
| A — no memory | **0/5** | 27,246 | 13.82 s | $0.022218 | 2 | 4 |
| B_oracle (answer key) | 5/5 | 9,069 | 4.86 s | $0.008410 | 0 | 1 |
| B_realistic | 5/5 | 9,069 | 5.96 s | $0.008410 | 0 | 1 |
| **C — OKF enabled** | **5/5** | **10,395** | 6.46 s | $0.011329 | **0** | **1** |
| D — irrelevant OKF | 0/5 | 20,602 | 14.50 s | $0.025879 | 1 | 2 |

**Read the A row first.** Without memory the session burns 27,246 tokens, reads two files hunting for an answer, takes four turns — and still gets **0/8**. That is the condition OKF actually replaces, and C beats it: 2.6× fewer tokens, 0/8→8/8, in a single turn with no file reads.

**C does not beat B, and it never will.** B pastes the answers straight into the prompt; nothing retrieves faster than already having it. At this bundle size B_realistic equals B_oracle (there is no unrelated knowledge yet to restate), so both sit at 9,069. C costs 1,326 more tokens and $0.0029 more per session. Building the bundle cost one batch ingest of **133,364** token activity and **$0.176758**. **There is no token or cost break-even** — `perSessionTokenSaving` is negative, so the harness reports `null` rather than inventing one.

What changed since the previous run is the gate itself. C used to cost **22,857** tokens over 7 turns with 5 file reads; it now costs **10,395** in 1 turn with 0 reads, at identical 5/5 recall. The old gate ordered an unconditional `Read`, and 91% of its overhead was that round-trip re-fetching facts the index had already delivered. See [the fix](https://github.com/dja1369/okf-system/pull/7).

### The accumulation limit — measured, not projected

The claim "OKF gets cheaper as knowledge accumulates" does not survive measurement. Running the same benchmark with 50 unrelated concepts added to the bundle **fails preflight**:

```
checkedFacts: 8   presentFacts: 8   routedFacts: 6   ready: false
```

Two facts (`architecture_pattern`, `export_style`) live in `decisions/tech-stack.md`, and that file was **cut from the injected index** — the filler concepts sorted ahead of it alphabetically. The gate's index is hard-capped to stay under Claude Code's 10,000-character hook ceiling, and real Korean concept lines run ~214 bytes:

| Concepts in bundle | Shown in gate index |
|---:|---:|
| 20 | 20 |
| 40 | 40 |
| **55** | **43** (truncated) |
| 100 | 43 (truncated) |

**Past ~43 concepts the index truncates**, and what survives is decided by filename — not relevance, not recency. Categories are dealt round-robin so no category starves, and each truncated category points at its own `index.md` so the rest stays reachable by descending. But descending is a tool round-trip, which is the exact ~12,500-token cost the gate fix just removed. So beyond that point OKF's economics get *worse*, not better. This is the honest state of the design, not a tuning knob.

The harness also records decision compliance, wrong assumptions, extra questions, tool calls, first valid response, API/wall time, `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, and CLI-reported cost. Token categories remain separate in the raw JSON. Note that `tokenActivity` sums cache reads 1:1 with output tokens even though cache reads bill ~50× cheaper — **cost is the defensible column**, and at n=5 the harness's `p95` is arithmetically always the max (the cold run), so it is omitted here. Values the CLI does not expose separately — user-only or gate-only tokens — remain `null` and are never estimated.

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                      # as published above
OKF_RUN_LIVE_BENCH=1 OKF_BENCH_FILLER=50 node test/bench-okf.mjs  # accumulation axis
```

This is paid, authenticated, and intentionally excluded from smoke tests and CI. Token categories remain separate; user-only/gate-only/transcript tokens unavailable from the CLI remain `null`. See the [report](docs/benchmarks/okf-live-2026-07-15T16-06-28-592Z.md), [raw JSON](docs/benchmarks/raw/okf-live-2026-07-15T16-06-28-592Z.json), and [usage guide](docs/USAGE.md). The earlier pre-fix run is kept as an audit trail.

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
per-session net saving = B_realistic median - OKF median
break-even sessions = ceil(initial OKF cost / positive per-session net saving)
```

The comparison is against **B_realistic**, not B_oracle. B_oracle's restatement string contains the answers themselves, so it prices at zero exactly the work OKF exists to do — a break-even against it would be meaningless. On the measured run the saving is negative either way (−1,326 tokens, −$0.0029), so both break-even fields report `null`. That is the result, not a gap in the harness.

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
