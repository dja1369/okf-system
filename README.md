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

## OKF benchmark

<!-- okf-benchmark: 2026-07-16-v3 -->

**OKF does not save you from exploring. It stores what exploring can never find.**

Both halves of that sentence are measured below, on real open-source repositories, at n=15 per
comparison cell. The half that is unflattering to OKF is published first.

### How it was measured

Two pinned public repositories — no synthetic fixture, so exploration costs what exploration
actually costs and the no-memory baseline can genuinely win:

| Role | Repository | Commit |
|---|---|---|
| Codebase | [slimphp/Slim](https://github.com/slimphp/Slim) | `80900fb3` (125 PHP files) |
| Document pile | [rust-lang/rfcs](https://github.com/rust-lang/rfcs) | `f635361c` (651 Markdown files) |

Every concept in every bundle was produced by the real pipeline — a real `claude -p` session
exploring the pinned repo, its real Claude Code transcript, real batch ingest, real gate. **No
concept was written by hand.** The bundles are committed to this repository
([docs/benchmarks/bundles/](docs/benchmarks/bundles/)), so you can read the exact gate text and
concept bodies every number below rests on, and refute this run the way v2 was refuted — from the
repo, without trusting the author.

Five conditions. All receive identical tools (`Read`, `Glob`, `Grep`, `Bash(git log/show/diff/blame/grep)`)
and an identical, condition-neutral instruction — no condition is told to consult the gate. The gate
is delivered through the **real `SessionStart` hook** (`additionalContext`), not prepended to the
prompt; delivered bytes are verified per run.

- **zero-base** — nothing. The thing OKF claims to replace.
- **answer key** — the answer pasted in. Producing that string requires already knowing the answer, so
  no user can occupy this condition. It is a floor, not a competitor.
- **OKF** — the real gate text.
- **wrong knowledge** — a size-matched gate of real concepts about the *other* repository. Separates
  "the knowledge helped" from "a gate helped".
- **CLAUDE.md** — the same accumulated knowledge pasted into a flat file. The real incumbent.

`total_cost_usd` is the headline; sonnet-only cost is published beside total cost, so the `claude-haiku`
the CLI resolves for internal work (2.3% of spend) can be netted out and can't hide a conclusion.
Efficiency is compared on correct runs only. Each answer is graded per **atom** — the ground truth is
split into independently-checkable facts, frozen before measurement — and the v2-style binary score
(all atoms correct) is published beside it. Per-run nonce defeats prompt caching. **No number is
averaged across scenarios.**

Design, predictions, and the refutation criteria R1–R5 were
[pre-registered](docs/benchmarks/pre-registration-2026-07-16-v3.md) and committed **before the first
paid call**. That document also records, in detail, the six false or unsupported statements the
previous (v2) publication of this benchmark made, and how each was caught from its own raw data.

### Where OKF loses: anything the code can answer

Five scenarios whose answers are in the source, in git history, or in the bundle, each verified from
the pinned checkout. Cost is the median of correct runs, with its spread.

| Scenario | zero-base | OKF | verdict |
|---|---:|---:|---|
| `rfcs_cheap` — one grep | **$0.062** · 13/15 | $0.077 · 14/15 | OKF 1.2× dearer |
| `slim_cheap` — one grep | **$0.067** · 14/15 | $0.114 · 15/15 | OKF 1.7× dearer |
| `rfcs_buried` — find the rationale among 651 docs | **$0.097** · 12/15 | $0.112 · 13/15 | OKF 1.2× dearer |
| `slim_buried` — follow a five-file call chain | $0.277 · 13/15 · **10 tools** | **$0.232** · 9/15 · **8 tools** | OKF cheaper, fewer tools |
| `slim_stale` — bundle knowledge outdated by a later commit | critical **15/15** | critical **15/15** | tie — see below |

**On cheap greps OKF is pure overhead** — 1.2–1.7× dearer for the same answer, because the gate is a
fixed cost a `grep` doesn't need. It only pays off where exploration is genuinely expensive:
`slim_buried` follows a five-file call chain, and there OKF is cheaper with fewer tool calls. That is
not a defect, it is arithmetic — if a grep answers your question, don't pay for a gate.

`slim_stale` is where per-atom grading earned its keep. The bundle carried a claim made stale by a
later commit, and the binary score reads **0/15 for every condition** — which looks like a total
wipeout. It is not. The *critical* atoms (what the question actually asks — that the HTML renderer
escapes, with which function and flags) are **15/15**: the model read the code and answered the core
fact correctly. The only atoms it missed are provenance the question never asked for (the commit SHA
that introduced the escaping). Stale knowledge did **not** make it confidently wrong — the
pre-registered prediction that it would was wrong, and the binary score alone would have hidden that.

### Where exploration cannot help: knowledge the code does not contain

Team policy decided in conversation, never written to the repo. The RFC pile even contains a trap:
search it for an MSRV policy and the documents propose `N-2` — the team's actual rule is different.

| Scenario | zero-base | OKF | wrong knowledge | CLAUDE.md |
|---|---:|---:|---:|---:|
| `rfcs_policy` — the team's "thaw rule": wait period, MSRV cadence, two carve-outs | **0/15** | **11/15** · $0.075 | — | 15/15 · $0.144 |

**Zero-base went 0 for 15.** It spent the money and got nothing, because the answer is not in the
repository — verified by an adversary who searched the working tree, git history, commit messages,
docs and config, and found zero hits. The trap did not catch it either; it simply could not answer.

OKF answered **11 of 15**, at roughly half the cost of CLAUDE.md carrying the same facts. This is the
one thing exploration cannot do and a stored decision can. **CLAUDE.md answers it too** (15/15) — OKF
is not unique here, it is a cheaper, bounded-injection form of the same incumbent. The
`wrong knowledge` control for this scenario is excluded: a measurement-contamination bug (below) let
it read the answer, so it cannot serve as the "a gate alone doesn't help" control this run.

This is a single clean policy scenario, not three. Two others (`slim_policy`, `slim_domain`) were
measured and then **excluded** — see below.

### What this run cannot tell you

- **Two policy scenarios were excluded for contamination.** Claude Code auto-injects per-directory
  project memory (`~/.claude/projects/<cwd>/memory/`) into every session. While building knowledge,
  a `claude -p` session exploring the target repo saved the team decisions into that memory, and
  because measurement ran in the same working directory, the memory reached even the **zero-base**
  condition — which should have no knowledge at all. On `slim_domain`, zero-base then "answered" a
  team decision that exists nowhere in the code, 15/15. Any scenario whose zero-base runs read
  project memory is dropped from publication (`slim_domain`, `slim_policy`); the harness now clears
  that memory before measuring, and the report detects and excludes such scenarios mechanically. The
  clean scenarios above had zero memory reads.
- **n=15 on contrast conditions, n=5 on controls.** Small. Only complete separation between
  distributions is described as a win.
- **Two repositories, two ecosystems (PHP + Markdown).** No claim of generality across sizes or
  languages. A third repository was designed, then rejected on cost-per-credibility before spending.
- **Single-question sessions.** OKF's fixed gate cost is paid once per question rather than amortized
  across a real multi-question session, so this run *understates* OKF.
- **The judge is a single LLM family**, graded per atom against source-verified ground truth.

Refutation criteria **R1–R5 were all evaluated mechanically and none fired** (after excluding the
contaminated cells) — this run does not refute the claim. That is not the same as a strong
confirmation at n=15; it is the absence of a refutation.

### Local overhead (not the effectiveness result)

Measured 2026-07-16, macOS arm64, Node `v26.4.0`, median with min/max.

| Local operation | Median | Range |
|---|---:|---:|
| SessionStart gate process | 57.3 ms | 56.1–60.0 ms |
| SessionEnd batch-trigger process | 40.1 ms | 39.3–40.8 ms |
| Statusline process | 35.8 ms | 34.6–36.3 ms |

Reproduce with `node test/bench.mjs [repository]`. Local process cost only; it proves nothing about
tokens or model latency.

### Cost, reproduction, and links

The 440 measured runs cost **$66.26** plus **$14.74** in grading; knowledge and bundle construction
added ~$3.2. Total for this run ≈ **$84**. Paid, authenticated, and excluded from smoke tests and CI
on purpose.

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-knowledge.mjs --target slim --dir <repo>   # real sessions → transcripts
OKF_RUN_LIVE_BENCH=1 node test/bench-bundles.mjs --target slim --levels 20      # real batch → bundle
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                                    # measure
```

[Full report](docs/benchmarks/okf-benchmark-2026-07-16-v3.md) ·
[raw JSON](docs/benchmarks/raw/) ·
[committed bundles](docs/benchmarks/bundles/) ·
[pre-registration](docs/benchmarks/pre-registration-2026-07-16-v3.md) ·
[usage guide](docs/USAGE.md).

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
