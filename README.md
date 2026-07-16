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

<!-- okf-benchmark: 2026-07-16 -->

> **Retraction (2026-07-16).** Three claims first published in this section have been withdrawn after
> an audit of this run's own raw data: the `rfcs_policy` trap explanation (fabricated — the trap never
> fired), the accumulation trend headline (not supported by its sample), and this section's original
> title, "Where OKF is the only thing that works" (refuted by its own table). Each retraction is
> marked below where the claim stood. What was withdrawn, and how each was caught, is recorded in the
> [v3 pre-registration](docs/benchmarks/pre-registration-2026-07-16-v3.md). Every other finding in
> this section is unchanged.

**OKF does not save you from exploring. It stores what exploring can never find.**

Both halves of that sentence are measured below, on real open-source repositories, and the half that
is unflattering is published first.

### How it was measured

Two pinned public repositories — no synthetic fixture, so exploration costs what exploration
actually costs and the no-memory baseline can genuinely win:

| Role | Repository | Commit |
|---|---|---|
| Codebase | [slimphp/Slim](https://github.com/slimphp/Slim) | `80900fb3` (125 PHP files) |
| Document pile | [rust-lang/rfcs](https://github.com/rust-lang/rfcs) | `f635361c` (651 Markdown files) |

Every concept in every bundle was produced by the real pipeline — a real `claude -p` session
exploring the pinned repo, its real Claude Code transcript, real batch ingest, real gate. **No
concept was written by hand**, including the filler that creates volume.

Five conditions. All receive identical tools (`Read`, `Glob`, `Grep`, `Bash(git log/show/diff/blame/grep)`)
and an identical, condition-neutral instruction — no condition is told to consult the gate.

- **zero-base** — nothing. The thing OKF claims to replace.
- **answer key** — the answer pasted in. Producing that string requires already knowing the answer, so
  no user can occupy this condition. It is a floor, not a competitor.
- **OKF** — the real gate text.
- **wrong knowledge** — a size-matched gate of real concepts about the *other* repository. Separates
  "the knowledge helped" from "a gate helped".
- **CLAUDE.md** — the same accumulated knowledge pasted into a flat file. The real incumbent.

`total_cost_usd` is the headline; token activity is shown beside it, never instead of it, because
`cache_read` dominates that sum and bills ~50× cheaper — the two columns disagree in direction.
Efficiency is compared on correct runs only. Per-run nonce defeats prompt caching. Grading is by a
condition-blind judge against ground truth verified from source. **No number is averaged across
scenarios**: one grep and a five-file call chain are different phenomena, and mixing them would let
scenario selection pick the headline.

Design, predictions, and refutation criteria were [pre-registered](docs/benchmarks/pre-registration-2026-07-16.md)
and committed **before the first paid call**.

### Where OKF loses: anything the code can answer

Five scenarios whose answers are in the source or in git history, verified from the pinned checkout
and each survived an independent attempt to refute it.

| Scenario | zero-base | OKF | verdict |
|---|---:|---:|---|
| `rfcs_cheap` — one grep | **$0.0256** · 4/5 | $0.0505 · 3/5 | OKF 2.0× dearer |
| `slim_cheap` — one grep | **$0.0198** · 4/5 | $0.0386 · 5/5 | OKF 1.9× dearer |
| `slim_stale` — bundle knowledge outdated by a later commit | **$0.0345** · 5/5 | $0.0632 · 4/5 | OKF 1.8× dearer |
| `rfcs_buried` — find the rationale among 651 docs | **$0.0326** · 4/5 | $0.0910 · 3/5 | OKF 2.8× dearer |
| `slim_buried` — follow a five-file call chain | $0.1669 · 2/5 · **10 tools** | **$0.0701** · 2/5 · **3 tools** | **OKF 2.4× cheaper** |

**OKF loses four of five.** It only wins where exploration is genuinely expensive, and there it cuts
tool calls from 10 to 3. If a grep answers your question, the gate is pure overhead — that is not a
defect, it is arithmetic.

`slim_stale` is worth naming: the bundle carried a stale claim (the HTML error renderer does not
escape — true before commit `f897118b`, false at the pinned commit) and the model **checked the code
and corrected it anyway**, 4/5. Stale knowledge did not make it confidently wrong. The
pre-registered prediction that it would was wrong.

### Where exploration cannot help: knowledge the code does not contain

Team policy and domain vocabulary — decided in conversation, never written to the repo. Each
scenario was attacked by an independent adversary who searched the working tree, ~300 revisions of
git history, commit messages, docs, config, stashes and dangling objects (zero hits), and who
**recorded a guess from convention before looking**. Those guesses scored 0/3, 0/3 and 1/5.

Each repo also contains a trap: grep for "emitter" and you find `ResponseEmitter`; look for a chunk
size and you find `4096`; search the RFC pile for an MSRV policy and the documents propose `N-2`.

| Scenario | zero-base | OKF | wrong knowledge | CLAUDE.md |
|---|---:|---:|---:|---:|
| `slim_policy` — which env enables error details, and the carve-out | **0/5** ($0.0509 spent) | **5/5** · $0.0840 | 0/5 | 5/5 · $0.1314 |
| `slim_domain` — what the team means by "에미터" | **0/5** · **confidently wrong 5/5** | **4/5** · $0.0624 | 0/5 | 5/5 · $0.1198 |
| `rfcs_policy` — the team's "thaw rule" wait period | **0/5** | 2/5 · $0.0749 | 0/5 | 0/5 |

**Zero-base went 0 for 15.** It spent the money and got nothing, because the answer is not there. On
`slim_domain` it was **confidently wrong in 5 runs out of 5**: it explored, found `ResponseEmitter`,
and answered with high confidence — while the team's "에미터" is `OutputBufferingMiddleware`, because
they run FrankenPHP worker mode where `ResponseEmitter` is dead code. Exploration does not merely
fail here; it manufactures a confident wrong answer out of the trap.

**Wrong knowledge went 0 for 15 too.** A gate full of real-but-irrelevant concepts recovers nothing.
The gain comes from the knowledge, not from having a gate.

OKF answered 11 of 15, at 1.6–1.9× less than CLAUDE.md carrying the same facts. On `slim_domain` it
read **no concept file at all** (0/5) — the index line alone was enough, at 2 tool calls against
zero-base's 7.

**CLAUDE.md works here too**, and the table says so: 5/5 on `slim_policy`, and 5/5 on `slim_domain`,
beating OKF's 4/5. What this table supports is parity with the incumbent at 1.6–1.9× less cost, with
bounded injection — not uniqueness. This section was first published as "Where OKF is the only thing
that works", which its own table refutes; **that title is withdrawn.**

`rfcs_policy` is the honest failure: OKF managed only 2/5. **The explanation published here — that
the `N-2` proposal in the document pile is a strong enough trap to pull the model off a correct index
line — was wrong, and is withdrawn.** All 5 OKF runs read only bundle files; none opened an RFC
document; none answered `N-2`. All five answered "4 releases". The trap never fired. The cause of the
2/5 was not investigated before publishing, and no replacement explanation is offered here; a
re-measurement is underway. CLAUDE.md scored 0/5 on this scenario, so OKF still beats the incumbent
here.

### Accumulation: the trend claim is withdrawn

This section first published a cost curve over bundle size (1 → 35 concepts) and the headline
**"From 1 to 35 concepts OKF got cheaper ($0.1291 → $0.0908) while CLAUDE.md got 2.2× dearer
($0.1279 → $0.2828). The curves diverge."** **That trend claim is withdrawn as unsupported by its
sample.**

The numbers were not fabricated — they are correct-runs-only medians, which is the pre-registered
rule. But they are medians of **3, 2, 5, 3, 2 and 4** runs, and the $0.0701 low point is *the median
of two runs*. Across all runs the level distributions overlap completely (the 1-concept level spans
$0.0774–$0.2214; the 35-concept level spans $0.0836–$0.1606), and the all-runs medians are not
monotonic at all: $0.1237, $0.1884, $0.1425, $0.0852, $0.1142, $0.1135. This same section already
said, two paragraphs later, "At n=5 nothing here separates" — that sentence was correct and the
headline above it was not. The curve is not republished here, because a median of two runs is not a
point on a curve.

The gate plateau was explained wrongly too. It was attributed to the batch collapsing 14 concepts
into a single index line, presented as an emergent property of how OKF organises knowledge. **It is
the `inject_max_lines: 120` cap in `lib/config.mjs`** — a configuration constant. `bench-bundles.mjs`
records `gateTruncated`, which is true at exactly the level where the plateau begins: index entries
were **dropped for budget**, not elegantly nested.

One half of the old claim survives, and only stated on its own: CLAUDE.md carries every concept body
in every prompt, so its prompt grows linearly with the number of concepts. That is mechanically true
of the format. No OKF-side comparison is drawn from it here.

Accuracy did not improve with volume and stayed noisy (2/5–5/5). **The level axis is retired in v3**:
it measures a configuration constant, so re-running it would only buy a more precise reading of a
number that can be read off a config file.

### Local overhead (not the effectiveness result)

Measured 2026-07-16, macOS arm64, Node `v26.4.0`, median with min/max.

| Local operation | Median | Range |
|---|---:|---:|
| SessionStart gate process | 57.3 ms | 56.1–60.0 ms |
| SessionEnd batch-trigger process | 40.1 ms | 39.3–40.8 ms |
| Statusline process | 35.8 ms | 34.6–36.3 ms |

Reproduce with `node test/bench.mjs [repository]`. Local process cost only; it proves nothing about
tokens or model latency.

### Cost, and what this run cannot tell you

Building the knowledge cost **$3.59** in real sessions and **$4.92** in batch ingest. The 250
measured runs cost **$28.16** plus **$9.44** in grading.

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-knowledge.mjs --target slim --dir <repo>   # real sessions → transcripts
OKF_RUN_LIVE_BENCH=1 node test/bench-bundles.mjs --target slim --levels 1,5,20  # real batch → level bundles
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                                    # measure
```

Paid, authenticated, and excluded from smoke tests and CI on purpose.
[Full report](docs/benchmarks/okf-benchmark-2026-07-16.md) ·
[raw JSON](docs/benchmarks/raw/) ·
[pre-registration](docs/benchmarks/pre-registration-2026-07-16.md) ·
[usage guide](docs/USAGE.md).

Limits, stated plainly:

- **n=5 per cell.** Small. Only complete separation between distributions is described as a win here.
- **The model mix is not pinned.** `claude-sonnet-5` was requested; the CLI resolved
  `claude-haiku-4-5` alongside it for internal work. Cross-condition cost comparisons carry that
  artifact.
- **Two repositories, one language each.** No claim of generality across sizes or ecosystems.
- **Wall-clock is not published.** Measurement ran at concurrency 5; cost, tokens and tool calls are
  unaffected by that, response latency is not. Speed claims would need a sequential re-run.
- The gate text is prepended to the prompt rather than delivered through the production
  `SessionStart` `additionalContext` path. Same text, different delivery.
- Policy scenarios rest on a human authoring the policy. That is what policy is. The defence is that
  the answer is provably absent from the repo and that an adversary could not guess it.

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
