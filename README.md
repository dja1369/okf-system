# OKF for Claude Code

**Turn decisions from past Claude Code sessions into a local, reviewable knowledge bundle that future sessions can actually use.**

![MIT license](https://img.shields.io/badge/license-MIT-blue) ![OKF v0.2](https://img.shields.io/badge/OKF-v0.2-4ecdc4) ![Node only](https://img.shields.io/badge/runtime-Node%20only-5c6bc0) ![no npm install](https://img.shields.io/badge/dependencies-vendored-66bb6a)

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
| `/okf:okf-deprecate <target>` | Retire a concept — the file and its links stay, the gate stops injecting it |

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

<!-- okf-benchmark: 2026-07-26-e3 -->

### Gate recall@cap — three pre-registered rounds, E1 → E3 (2026-07-26)

All three rounds cost **$0.00**, and that is proven by the run rather than declared: the harness puts
a stub `claude` at the front of `PATH` before launching the hook, records that the stub exists, and
the stub was never executed (`paidCallTrapInstalled: true`, `paidCallTrapTripped: false`).

They measure one number: `recall(N)` — with N concepts in the bundle, the fraction of 20 frozen
questions whose answer concept survives into the index the gate actually injects.

> **recall is not an accuracy rate.** This measurement only answers "did the gate load the relevant
> line". Whether the model actually *used* that line cannot be verified without paid calls. Synthetic
> distractors give only an **upper bound** on router performance, so real-world recall is lower.

**E2/E3 conditions** — 3 perturbations × 5 levels × 20 seeds = 300 samples, 28 s. Only four
characters were prepended to the answer concept's frontmatter **`title`**; not one byte of any body,
filename, or path changed.

| N | `none` | `front` (`!!! `) | `back` (`힣힣 `) | spread |
|---|---|---|---|---|
| 24 | 0.400 ± 0.000 (n=20, 0.40–0.40) | **1.000 ± 0.000** (n=20, 1.00–1.00) | 0.400 ± 0.000 (n=20, 0.40–0.40) | **0.600** |
| 50 | 0.277 ± 0.038 (n=20, 0.20–0.35) | 0.560 ± 0.064 (n=20, 0.50–0.70) | 0.182 ± 0.044 (n=20, 0.15–0.30) | **0.378** |
| 100 | 0.247 ± 0.034 (n=20, 0.20–0.30) | 0.523 ± 0.030 (n=20, 0.45–0.55) | 0.170 ± 0.025 (n=20, 0.15–0.20) | **0.353** |
| 200 | 0.250 ± 0.040 (n=20, 0.15–0.30) | 0.528 ± 0.030 (n=20, 0.45–0.55) | 0.175 ± 0.026 (n=20, 0.15–0.20) | **0.353** |
| 400 | 0.262 ± 0.039 (n=20, 0.15–0.30) | 0.533 ± 0.024 (n=20, 0.50–0.55) | 0.185 ± 0.024 (n=20, 0.15–0.20) | **0.348** |

`n=` and the min–max ride in the same row as the mean, a convention smoke enforces so that a
two-sample median can never again be drawn as a point on a curve. E1 ran the `none` condition alone
at a budget 11 B smaller (6,956 vs 6,967 B) and produced 0.400 / 0.277 / 0.245 / 0.248; those numbers
are a **different condition** and must not be read as better or worse than the table above.

**Sorting decides survival, and E2 measured how much.** Four characters on `title` take N=400 from
0.262 to 0.533 and N=24 from 0.400 to 1.000. R6 was written to *refute* that diagnosis — "if changing
`title` does not move recall, sort dominance is wrong", threshold 0.05 — and the observed spread is
7–12× the threshold, so the refutation attempt failed. The 6 `cwdIndependent` concepts that were
wiped out (0.000) at N≥200 come back at **0.967** under a single prefix: that earlier result was not
"repository-independent knowledge is disadvantaged", it was a function of naming. **In a system with
zero relevance signals this is the expected outcome, not the discovery of a bug** — what is new is
its size.

**E3 corrected two things E2 published.** First, E2 reported that recall "rises monotonically" from
N=100 to 400 and handed the cause to E3. Under a paired directional test that rise does not exist:
across 12 adjacent level pairs, `rising` verdicts number **0**. E2 had read means as a trend. E3's own
main hypothesis was therefore never testable, and its refutation criterion R9 stayed *not computable*
— there was no rise to attribute. Second, E2 said its `|Δ| ≤ 0.05` rule "cannot tell flat from slowly
rising". That was also wrong. Replacing the rule with an exact paired sign test plus a
distribution-free median confidence interval changes the verdict on exactly two pairs — and in both
the old rule hid a statistically established **decline** (`none` and `front`, N=50→100, p = 0.0129
and 0.0352). The old rule's flaw was not seeing direction wrongly but not looking at direction at all.

**The old R3 kept firing on noise.** R3's wording was "monotonic decrease violated → *harness defect*
→ discard everything", but its implementation compared means with no uncertainty treatment, so ±0.005
of seed noise tripped it in E1 and E2 alike — both rounds shipped in the self-contradictory state of
"fired, but nothing discarded". E3 did not loosen the threshold; it pointed the criterion back at
what the wording says and measured integrity directly (unplanted survivors, missing answer ranks,
level-composition mismatch, candidate-count regression). On the same 300 samples the old R3 fires and
the new R3a does not. The earlier firings were never evidence of a defect.

**Survival is exactly `rank < taken`.** A concept survives iff its title-sort rank inside its category
is below the number of lines that category actually got. That identity held on **all 6,000**
question-checks (300 samples × 20 questions), so recall is a *complete* function of the rank and
`taken` vectors and decomposes with no approximation (residual ≤ 1.1e-16). At N=24→50 the rank
component dominates (−0.15 to −0.41); at N≥100 it dies to **exactly 0** — a floor effect, since the
mean answer rank (26.9) is far past `taken` (10.5) and more filler cannot change concepts that are
already out. The residual movement is entirely `taken`, which drifts up because the loaded lines get
shorter under a fixed budget (702 B → 598 B, `taken` 9.00 → 10.50). The same table explains
`front` at N=24 reaching 1.000: `taken` = 24 = every candidate, all six categories exhausted, so every
omission marker is refunded and the whole bundle fits.

**In the live bundle the bias is real but not yet established.** Measured read-only, emitting counts
only — no titles, descriptions, filenames, or links leave the measurement, and `raw/` is never opened.
Sorting compares `title.toLowerCase()` with `<`, i.e. **UTF-16 code-unit order, not locale collation**,
so an ASCII-leading title always precedes a Hangul-leading one. ASCII-leading concepts are 65.4% of
the bundle and take 70.6% of the gate's slots — a lift of 1.08×, but with 26 concepts the exact
hypergeometric test gives **p = 0.667**. That is not a result. And a small lift must not be read as
"sorting is harmless in practice": the gate currently loads **65.4%** of all candidates, and where
everything loads, sorting decides nothing. Per category the load rate already splits — `decisions`
and `projects` at 1.000, `patterns` at 0.500, `references` at **0.429**. Load rate is what connects
E2's finding to this one; the closer it falls below 1, the more of E2's effect is realised.

**What takes a slot is decided by ordering and line length, not relevance.** Five factors are
confirmed in code: case-sensitive sorting of type section names, so `# Subdirectories` always
precedes `# reference` (`lib/index-gen.mjs:242`) — which pulls nested concepts to the front of their
category; within a section, alphabetical order of the frontmatter **`title`**, not the filename,
which is only a fallback when frontmatter parsing fails (`:315`); `status: deprecated` demoted inside
its section (`:245`); category walk order by directory name (`:227`); and **line byte length**, since
a next line that exceeds the remaining budget stops that category there (`lib/gate.mjs:122`), so
description length changes survival. The gate contains zero references to cwd, recency, or the query.

**The shape is the finding, not the level.** Of the 20 questions, 9 survive at 0 across every level
and 3 survive at 1.0 across every level; the remaining 8 land in between. Per cell that is 48 zeros,
19 ones and 13 intermediate values — recall is not binary. The gate fills round-robin, cycling over
categories until the budget runs dry rather than taking one line per category and stopping; a
category ends up with 1–3 lines only because a single line is large — concept lines run 200–1,030 B
against a ~6,960 B index budget, so the whole take is exhausted at 8–11 lines. `references` gets
exactly one line at every level (1 of 57 at N=200), so of the 8 answers concentrated there at most
one can survive.

**Nesting depth (axis A-2).** 25 concepts held fixed, contents identical, only the paths made deeper:

| Condition | concept lines injected | sub-domain links |
|---|---:|---:|
| flat | 28 | 0 |
| 2 levels | 27 | 0 |
| 3 levels | 26 | 0 |
| 4 levels | 25 | 0 |

Each condition was measured **once** (n=1, no seed repetition), and in that single measurement one
line was lost per level of depth. Four points cannot distinguish whether that decline is linear, and
depths beyond 4 levels were not measured. Counted against the planted concepts, 3 levels is 25 → 23,
**−8.0%**. The cause is byte pressure, not a failed chain walk: each extra path segment lengthens
every line until one is pushed out of the budget. (28 rather than 25 because `ensureBootstrap` plants
the same seed concepts in every condition; it does not affect the comparison between conditions.)

**R2 fires in every round** (`recall(24)` = 0.400 < 0.60). Under the pre-registered handling rule the
**absolute recall values are not used as grounds for any policy decision** — the tables are published
and decide nothing.

**Measurement discipline, and where it improved.** In E1 the question, distractor, and shape fixtures
first entered git in the **report** commit — the thresholds were fixed in advance but the materials
that actually determined the numbers were not. From E2 on, fixtures ship inside the pre-registration
commit and smoke enforces a **strict** inequality via `git log --diff-filter=A`; aimed at E1's file
set that assertion produces 3 violations, so it catches the real accident rather than approving it.
Every round also publishes, in its pre-registration, the values already known at writing time and any
arithmetic changed after measurement. E3 changed one thing after seeing data — quantizing recall
deltas onto the 1/20 measurement grid, because in double precision `0.25 − 0.20 = 0.04999…` while
`0.20 − 0.15 = 0.05000…2`, so the same one-question move landed on opposite sides of the equivalence
bound. That fix removed the one `indeterminate` verdict in the round, i.e. it cut **against** the
report's own argument, and it is disclosed as such.

```sh
node test/gate-recall.mjs --e3 --perturb all   # 3 conditions × 5 levels × 20 seeds, ~28 s
node test/gate-title-distribution.mjs          # live-bundle title distribution (read-only)
node test/gate-recall.mjs --e2 --perturb all   # E2
node test/gate-recall.mjs                      # E1
node test/bench-nesting.mjs                    # nesting-depth axis
node test/smoke.mjs                            # regression guards
```

[E3 report](docs/benchmarks/gate-recall-2026-07-26-e3.md) ·
[E3 pre-registration](docs/benchmarks/pre-registration-2026-07-26-e3.md) ·
[E2 report](docs/benchmarks/gate-recall-2026-07-26-e2.md) ·
[E2 pre-registration](docs/benchmarks/pre-registration-2026-07-26-e2.md) ·
[E1 report](docs/benchmarks/gate-recall-2026-07-26-e1.md) ·
[E1 pre-registration](docs/benchmarks/pre-registration-2026-07-26-e1.md)

### End-to-end paid run (v3, 2026-07-16)

<!-- okf-benchmark: 2026-07-16-v3 -->

**OKF is overhead on almost everything code can answer, and where code has no answer at all, a
plain CLAUDE.md beats it too — OKF's only edge is doing that more cheaply. A direct test of its
core promise (accumulated knowledge pays off over time) was run and refuted.**

Every claim in that paragraph is measured below, on real open-source repositories, at n=15 per
comparison cell. The parts unflattering to OKF are published first.

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

### A chain follow-up: does real accumulation help? (v4, refuted)

<!-- okf-benchmark-chain: 2026-07-16-v4 -->

A separate, pre-registered run tested OKF's mechanism directly: a chain of 4 related-but-different
questions about `kubernetes/kubernetes`'s `pkg/scheduler` (v1.30.0, 178 Go files), where each
session's conclusion is fed through a **real batch** before the next session starts, compared
against the same 4 questions asked with no accumulation, ever. This is the exact shape v3's
pre-registration flagged as "favours OKF and is tunable to flatter it" and declined to run. v4 ran
it anyway, with guards this time: the 4 questions were frozen and source-verified before spending,
the contamination guard clears Claude Code's project memory before **every** session (not once),
and refutation criteria were fixed before measurement — see the
[pre-registration](docs/benchmarks/pre-registration-2026-07-16-v4.md).

Real accumulation happened: gate bytes grew monotonically across steps (1835 → 2613 → 3675 → 4950,
n=15 chains), backed by real, measured batch spend ($25.81 total). **The core prediction — that cost
falls across the chain — was refuted.** OKF's cost went $0.231 → $0.216 → $0.258 → **$0.447** across
the four questions; the no-memory control moved the same way ($0.255 → $0.256 → $0.272 → $0.411).
The most likely explanation is that the fourth question was simply harder for both arms — it asks
about two mechanisms at once — not that accumulation helped or hurt. OKF's atom-level accuracy did
not exceed the baseline's at any step, and was below it at both the first and last question. Binary
(all-atoms-correct) scoring was 0/106 for both arms — this question set is hard enough that only the
atom-level score is usable at all. [Full report](docs/benchmarks/okf-benchmark-chain-2026-07-16-v4.md).

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

The v4 chain run (120 sessions, real batches between steps) cost **$31.95** measurement + **$9.20**
grading + **$25.81** real ingest ≈ **$67**:

```sh
OKF_RUN_LIVE_BENCH=1 OKF_BENCH_CHAINS=15 node test/bench-chain.mjs   # chained sessions, real batch, measure
```

[Full report](docs/benchmarks/okf-benchmark-2026-07-16-v3.md) ·
[chain follow-up report](docs/benchmarks/okf-benchmark-chain-2026-07-16-v4.md) ·
[raw JSON](docs/benchmarks/raw/) ·
[committed bundles](docs/benchmarks/bundles/) ·
[pre-registration](docs/benchmarks/pre-registration-2026-07-16-v3.md) ·
[chain pre-registration](docs/benchmarks/pre-registration-2026-07-16-v4.md) ·
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
| `sweep_backfill_days` | `0` | Days *before* the install marker that sweep may reach back; `0` (default) = conversations recorded after you installed OKF only. The hard 7-day window still caps it. |
| `batch_max_usd_per_day` | `0` | Daily LLM spend cap in USD; `0` = unlimited (default). Spend is recorded and shown either way. Best-effort only — the tally lives in `.okf/last-batch.json`. |

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
