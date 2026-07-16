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

The first `SessionStart` creates `~/.claude/okf` (or `$CLAUDE_CONFIG_DIR/okf`). Collection and opportunistic batch ingest are automatic — a conversation is collected about an hour after its last activity, so nobody has to end a session explicitly.

## The continuity loop

```text
Session 1              ~1h idle                Background batch           Session 2
make a decision   ->   sweep collects raw ->   reusable OKF Markdown  ->  compact index injected
(no explicit end       (lossless copy;            |                            |
 required)              growth re-collects)       +-- local git history        +-- Read relevant concept
```

Example: one session records “deploy 10% → 50% → 100%, roll back above 0.5% errors.” After collection and ingest, a later session can discover that exact policy through the injected index without the user pasting it again. The index is a routing layer, not the whole memory: Claude must `Read` the relevant concept before acting.

Why idle-based? Sessions rarely end explicitly — background agents never do — and an end-of-session snapshot taken on `resume` used to freeze a conversation mid-flight as “processed”, losing everything said afterwards. So the sweep collects a transcript once it has been quiet for `sweep_min_idle_minutes` (default 60), the batch process lingers until pending conversations reach idleness (polling every ~5 minutes, up to 8 hours), a collected session is collected **again** only if it grew afterwards, and an unchanged session is never re-collected. Session hooks merely wake the batch.

## Commands

Plugin commands always require the `okf:` namespace.

| Command | Purpose |
|---|---|
| `/okf:okf-status` | Last batch result, pending sessions, and lock state |
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

Five conditions, five crossed-order runs each. C's bundle is built by a **real** collection into `raw/` → isolated batch ingest → SessionStart gate — no hand-seeded concepts. A preflight refuses to spend money unless C actually contains and gate-routes every target fact and D contains none.

- **A — no memory.** The honest status quo: a fresh session, nothing restated.
- **B_oracle — the answer key.** Pastes exactly the 8 expected values. Producing that string requires already knowing every fact OKF exists to recover, so **no user can occupy this condition**; it is an upper bound, not a baseline. Its human labour is priced at zero.
- **B_realistic — what people actually do.** Restates everything that might be relevant, because you cannot know in advance which fact the next session needs. This is the CLAUDE.md habit.
- **C — OKF enabled.**
- **D — irrelevant OKF.** A gate with no relevant content, to separate "the gate helped" from "a gate costs something".

### Results

Live run 2026-07-15: Claude Code `2.1.210`, `sonnet`/medium (resolved Sonnet 5 + Haiku 4.5), macOS arm64, Node `v26.4.0`, 5 runs per condition. C preflight: 8/8 facts present, 8/8 gate-routed. D: 0/8.

| Condition | Continuity | Compliance p50 | Token activity p50/p95 | Wall p50/p95 | Cost p50 |
|---|---:|---:|---:|---:|---:|
| A — no memory | **0/5** | 12% | 27,246/27,518 | 13.82/18.17 s | $0.022218 |
| B_oracle (answer key) | 5/5 | 100% | 9,069/9,069 | 4.86/6.46 s | $0.008410 |
| B_realistic | 5/5 | 100% | 9,069/9,069 | 5.96/6.27 s | $0.008410 |
| **C — OKF enabled** | **5/5** | 100% | **10,395**/10,459 | 6.46/7.15 s | $0.011329 |
| D — irrelevant OKF | 0/5 | 0% | 20,602/21,662 | 14.50/21.15 s | $0.025879 |

Tool calls behind those rows, because they explain the numbers: A reads 2 files over 4 turns and still fails; B answers in 1 turn with 0 reads because the answers are already in its prompt; **C answers in 1 turn with 0 reads** — the gate index alone was sufficient; D reads 1 file over 2 turns hunting for something its gate never contained.

Read `p95` with care: at n=5, `ceil(0.95×5)−1` is the last index, so p95 **is** the max — a single cold-cache run, not a tail statistic. It is reported because the comparison format asks for it, not because it is one.

**Read the A row first.** Without memory the session burns 27,246 tokens, reads two files hunting for an answer, takes four turns — and still gets **0/8**. That is the condition OKF actually replaces, and C beats it: 2.6× fewer tokens, 0/8→8/8, in a single turn with no file reads.

**C does not beat B, and it never will.** B pastes the answers straight into the prompt; nothing retrieves faster than already having it. At this bundle size B_realistic equals B_oracle (there is no unrelated knowledge yet to restate), so both sit at 9,069. C costs 1,326 more tokens and $0.0029 more per session. Building the bundle cost one batch ingest of **133,364** token activity and **$0.176758**. **There is no token or cost break-even** — `perSessionTokenSaving` is negative, so the harness reports `null` rather than inventing one.

What changed since the previous run is the gate itself. C used to cost **22,857** tokens over 7 turns with 5 file reads; it now costs **10,395** in 1 turn with 0 reads, at identical 5/5 recall. The old gate ordered an unconditional `Read`, and 91% of its overhead was that round-trip re-fetching facts the index had already delivered. See [the fix](https://github.com/dja1369/okf-system/pull/7).

### The accumulation limit — measured, not projected

**"OKF gets cheaper as knowledge accumulates" is false.** It gets more expensive, and faster than the alternative. Same benchmark, same bundle, with 20 unrelated concepts added — everything still fits the index (21 lines, 5,548 of 9,000 bytes, nothing truncated):

| Condition | Continuity | Compliance p50 | Token activity p50/p95 | Wall p50/p95 | Cost p50 |
|---|---:|---:|---:|---:|---:|
| A — no memory | 0/5 | 0% | 27,316/27,717 | 13.79/18.05 s | $0.022838 |
| B_oracle (answer key) | 5/5 | 100% | 9,070/9,085 | 5.33/6.78 s | $0.008410 |
| B_realistic | 5/5 | 100% | 10,406/10,406 | 5.72/9.62 s | $0.010134 |
| **C — OKF enabled** | **5/5** | 100% | **25,384**/25,773 | 11.75/13.15 s | $0.030721 |
| D — irrelevant OKF | 0/5 | 0% | 22,265/22,334 | 14.91/19.59 s | $0.037354 |

Against the 0-filler run: B_realistic grew **+1,337** (9,069 → 10,406) while C grew **+14,989** (10,395 → 25,384). **C degrades ~11× faster** — 749 tokens per added concept versus 67. Both still answer 5/5, so this is a pure cost regression, not an accuracy one.

The cause is not truncation. It is trust:

```
0 filler:   C reads=0  turns=1    answers straight from the index line
20 filler:  C reads=3  turns=4    goes back to opening files
```

Twenty irrelevant concepts were enough to make the model stop believing the index line and verify against the file — reviving the exact round-trip the gate fix removed. The index tells you a line exists; it does not tell you the line is the *complete* answer, so as the surrounding noise grows the rational move is to check. **This is the real ceiling, and it arrives at ~21 concepts — long before any cap binds.**

Truncation is the second wall, further out. The gate's index is hard-capped under Claude Code's 10,000-character hook ceiling, and real Korean concept lines run ~214 bytes:

| Concepts in bundle | Shown in gate index |
|---:|---:|
| 20 | 20 |
| 40 | 40 |
| **55** | **43** (truncated) |
| 100 | 43 (truncated) |

Past ~43 concepts the index truncates and the survivors are chosen by filename — not relevance, not recency. A run with 50 filler concepts **fails preflight** for exactly this reason (`presentFacts: 8, routedFacts: 6, ready: false`): `decisions/tech-stack.md` sorted behind the filler and was cut, taking two facts with it. Categories are dealt round-robin so no category starves, and each truncated category points at its own `index.md` so the rest stays reachable — but descending is a tool round-trip, the same cost again.

Neither wall is a tuning knob. Fixing the first one needs the index to signal *which lines are complete answers* so the model can trust them without opening the file; that work is not done, and until it is, OKF's economics worsen with every concept added.

Accumulation run: [report](docs/benchmarks/okf-live-2026-07-15T16-30-11-404Z.md), [raw JSON](docs/benchmarks/raw/okf-live-2026-07-15T16-30-11-404Z.json). The 50-filler preflight failure is preserved at [preflight audit](docs/benchmarks/raw/okf-live-preflight-failed-2026-07-15T16-11-37-402Z.json) — a negative result kept on purpose.

The harness also records decision compliance, wrong assumptions, extra questions, tool calls, first valid response, API/wall time, `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, and CLI-reported cost. Token categories remain separate in the raw JSON. Note that `tokenActivity` sums cache reads 1:1 with output tokens even though cache reads bill ~50× cheaper — **cost is the defensible column**. The `p95` columns above are published in the requested format, but at n=5 they are arithmetically the max (the cold run) rather than a tail statistic — read them as such. Values the CLI does not expose separately — user-only or gate-only tokens — remain `null` and are never estimated.

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                      # as published above
OKF_RUN_LIVE_BENCH=1 OKF_BENCH_FILLER=50 node test/bench-okf.mjs  # accumulation axis
```

This is paid, authenticated, and intentionally excluded from smoke tests and CI. Token categories remain separate; user-only/gate-only/transcript tokens unavailable from the CLI remain `null`. See the [report](docs/benchmarks/okf-live-2026-07-15T16-06-28-592Z.md), [raw JSON](docs/benchmarks/raw/okf-live-2026-07-15T16-06-28-592Z.json), and [usage guide](docs/USAGE.md). The earlier pre-fix run is kept as an audit trail.

### Local overhead (not the OKF effectiveness result)

Fresh local measurement on 2026-07-16: macOS arm64, Node `v26.4.0`, median with min/max range.

| Local operation | Median | Range |
|---|---:|---:|
| SessionStart gate process | 57.2 ms | 56.9–58.1 ms |
| SessionEnd trigger process | 41.4 ms | 39.0–42.1 ms |
| Statusline process | 35.0 ms | 35.0–35.2 ms |

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

- The idle sweep copies the full transcript into `raw/`; it is not parsed or truncated during collection. Session hooks only wake the batch.
- Batch creates a capped digest and sends that digest to Anthropic through a separate `claude -p` call. This is the only extra model/API transfer introduced by OKF.
- Batch runs with `--safe-mode`, a restricted tool set, prompt over stdin, lint/rollback, and no Bash tool.
- The analyzer works in a throwaway copy of the knowledge files in a temp workspace and physically cannot touch `raw/`, `.okf/`, or `.git`; the driver copies back regular `.md` files only (scripts and symlinks never reach the bundle).
- Raw and processed transcripts are git-ignored. Only extracted Markdown knowledge is committed locally.
- The plugin never pushes or adds a remote. POSIX directories are `0700`; raw/state/log files are `0600`. Windows uses account ACLs.
- Persistent diagnostic logs exclude transcript text, Claude stdout/stderr, credentials, and full raw paths.
- The live benchmark fixture is synthetic and contains no personal data or credentials.

## Configuration

Edit `~/.claude/okf/.okf/config.md` or use `/okf:okf-config`. Unknown or invalid values are ignored with safe defaults.

| Key | Default | Meaning |
|---|---:|---|
| `enabled` | `true` | Master switch for collection, gate, and batch |
| `batch_interval_hours` | `1` | Minimum interval between opportunistic batches |
| `batch_max_digest_kb` | `600` | Total per-batch digest budget |
| `batch_max_sessions` | `50` | Runaway ceiling; byte budget is the cost control |
| `batch_model` / `batch_effort` | `claude-sonnet-5` / `medium` | Batch model controls; empty uses CLI defaults |
| `capture_exclude_cwd` | `[]` | Collection opt-out globs, matched against each session's cwd |
| `sweep_min_idle_minutes` | `60` | Idle time after the last activity before a session counts as finished and is collected; `0` collects immediately |
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
