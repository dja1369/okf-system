# OKF benchmark v2 — pre-registration

Written and committed **before the first paid measurement call**. Its purpose is to make the result
un-spinnable: the predictions, the levels, the grid, and the refutation criteria are fixed here, so a
disappointing outcome cannot be re-narrated afterwards as a success.

The benchmark already published on `main` concludes that OKF does **not** save tokens, and that its
economics get **worse** as knowledge accumulates. This redesign was requested by the project owner,
who asked for proof of the opposite. That is exactly the situation in which pre-registration
matters — so the predictions below are recorded before any measurement, and the prior findings are
inherited rather than discarded.

## Claim under test

> When knowledge accumulates incrementally, an agent can consult past work instead of re-exploring
> the codebase every session, and this is more efficient.

## Correction: what the previous benchmark already got right

An earlier draft of this document attacked five flaws in "the previous benchmark". That draft was
written against a stale checkout, six commits behind `main`. The benchmark actually published on
`main` (`okf-live-2026-07-15T16-06-28Z`, plus its accumulation run at `16-30-11`) had already fixed
most of them, and the corrections are recorded here rather than deleted, because misrepresenting
prior work in order to justify new work is precisely the failure mode this document exists to
prevent.

What the published benchmark already does, and this one keeps:

- **It splits the comparator.** `B_oracle` is named as an upper bound "no user can occupy", and
  break-even is computed against `B_realistic` — the CLAUDE.md habit — instead.
- **It says cost is the defensible column**, noting `tokenActivity` sums cache reads 1:1 with output
  tokens although they bill ~50× cheaper.
- **It already found the gate-index-suffices effect**: "C answers in 1 turn with 0 reads — the gate
  index alone was sufficient."
- **It already measured accumulation and reported the unfavourable answer**: with 20 unrelated
  concepts, `C` grew +14,989 token activity while `B_realistic` grew +1,337 — degrading ~11× faster,
  because the model stops trusting the index line and reopens files (reads 0→3, turns 1→4). It states
  flatly: *"'OKF gets cheaper as knowledge accumulates' is false."*
- **It preserves a negative result on purpose** (the 50-filler preflight failure).
- **It discloses the model mix** (Sonnet 5 + Haiku 4.5 resolved in one run).

## The one thing that has never been measured

Every run so far used a synthetic fixture whose project directory contains the sentence
`No prior decisions are stored here`. In that fixture the target facts exist **nowhere** — not in the
code, not in git history. So `A — no memory` scores 0/5 by construction: it is not exploring, it is
searching an empty room. Its 27,246 tokens buy nothing.

That makes the central claim untestable there. "Consulting accumulated knowledge beats re-exploring"
requires a baseline that **can** re-explore and succeed. On a real repository the same baseline reads
real files, follows a real call chain, and gets the right answer — for real money ($0.090, 9 turns,
measured on Slim before this benchmark was designed). *That* is the cost OKF claims to remove, and it
has never appeared in any published OKF number.

This run replaces the fixture with two pinned public repositories and knowledge produced by the real
pipeline, so the comparison is finally between exploring history and reading a bundle. Everything
else above is inherited, including the unfavourable accumulation finding, which this design is built
to reproduce or overturn on real material rather than to bury.

## Targets (real, pinned, public)

| Role | Repository | Commit | Size |
|---|---|---|---|
| Codebase | [slimphp/Slim](https://github.com/slimphp/Slim) | `80900fb3` | 125 PHP files |
| Document pile | [rust-lang/rfcs](https://github.com/rust-lang/rfcs) | `f635361c` | 651 Markdown files |

No synthetic fixture project. Both targets are real open source, so "exploration" costs what
exploration actually costs, and the baseline can genuinely win.

## Knowledge provenance — no hand-seeding

Every concept in every measured bundle is produced by the real pipeline:

```
real `claude -p` exploration session on the pinned target
   → real Claude Code transcript (JSONL)
   → OKF raw/ → real batch ingest (`claude -p`, lint, commit)
   → concepts → real SessionStart gate text
```

No concept is written by hand. The filler/volume knowledge is real knowledge about the same public
repositories, not an authored array of fake decisions. Transcripts are frozen and committed so the
run reproduces. Because the sessions only ever read public OSS, no personal data enters the fixture.

**Pre-registered audit:** the report publishes, per level, how many concepts the batch produced, the
bundle bytes, the gate bytes, and whether each target fact was (a) captured by ingest and (b) routed
by the gate. A fact the pipeline dropped is reported as a pipeline failure, not silently retried.

## Conditions

| Key | What the agent gets | Why it exists |
|---|---|---|
| `zero_base` | nothing | 제로베이스 탐색. The thing OKF claims to replace. |
| `answer_sheet` | the answer, pasted | 정답지. Unattainable floor. Kept from v1 so the comparison that made OKF look bad is not deleted. |
| `okf` | real gate text at level L | 지식 축적 탐색. |
| `wrong_knowledge` | gate at level L, size-matched, none of it relevant | 잘못된 지식 축적. Real concepts about the *other* target. |
| `claude_md` | all accumulated knowledge as a `CLAUDE.md` in the repo, at level L | The real incumbent. This is what people actually do today. |

All conditions receive identical tools (`Read`, `Glob`, `Grep`, `Bash(git log/show/diff/blame/grep)`)
and an identical, condition-neutral instruction. No condition is told to consult the gate.

## Levels (accumulated knowledge volume, in concepts)

`1, 5, 10, 15, 20, 40, 80, 150`

1–20 are the volumes the project owner asked for. 40/80/150 are added because the gate's
`inject_max_bytes` cap is 9,000 bytes: at 20 concepts the index is roughly 2.4 KB, so the cap is
never reached and `claude_md` is still cheap. If a crossover exists it lives past the cap, and a
level axis that stops at 20 cannot find it. If no crossover exists by 150, the report says so.

## Metrics

**Primary: `total_cost_usd` reported by the CLI.** Token activity is recorded and shown beside cost,
never instead of it, with cache-read broken out. Also recorded per run: turns, tool calls by name,
wall/API ms, whether a concept file was actually Read, censoring (turn-cap hits), and the resolved
model ID.

Per-run nonce prevents prompt-cache reuse across repeated runs. Exactly one model ID is pinned; the
run aborts if any two conditions resolve to different models.

## Predictions (recorded before spending)

| # | Prediction |
|---|---|
| P1 | `zero_base` costs the most on buried facts and succeeds anyway (unlike v1, where it could not). |
| P2 | `okf` beats `zero_base` on cost for buried facts, and does **not** beat it on cheap-grep facts. |
| P3 | `okf` **loses** to `claude_md` at low volume (1–20) and only wins, if ever, past the gate cap. |
| P4 | `wrong_knowledge` costs more than `zero_base` — the agent reads a concept, finds it useless, then explores anyway. |
| P5 | Stale knowledge makes `okf` confidently wrong where `zero_base` is right. |

## Refutation criteria

The claim is **refuted** if any of these holds:

- **R1** `okf` median cost ≥ `zero_base` median cost on buried-fact scenarios (correct runs only) at
  every level.
- **R2** `okf` median cost ≥ `claude_md` median cost at every measured level. If OKF cannot beat a
  flat file a user maintains by hand, the claim is dead.
- **R3** The accumulation curve is flat or rising from L1→L150 and never crosses `claude_md`.
- **R4** `okf`'s confidently-wrong rate on stale knowledge exceeds `zero_base`'s by ≥20 points.
  Cheap-and-wrong loses to expensive-and-right.
- **R5** Break-even against `zero_base` is negative, infinite, or beyond 200 sessions once batch
  ingest cost is included.

**Scope narrowing, not a win:** if `okf` beats `claude_md` only at L≥80, the conclusion is
"OKF is for knowledge too large to paste into CLAUDE.md" — and the report says exactly that, in
those words.

## Aggregation rules

- Efficiency is compared on **correct runs only**; correctness is reported separately.
- **No cross-scenario aggregate** cost or accuracy number is published. Cheap-grep and buried-fact
  scenarios are not averaged together; doing so would let scenario selection set the headline.
- Capability-only scenarios (answers that exist nowhere but the bundle) are excluded from every
  efficiency number.
- `n = 5` per cell. This is small. Only differences that survive as complete separation between
  conditions are described as wins; overlapping distributions are reported as "not separated".

## Amendments after registration

Recorded here rather than edited in silently. An amendment log is the only thing that keeps a
pre-registration honest once it is no longer a prediction.

**A1 (before the first measurement call, after the first bundle was built) — added the
"does the gate answer it alone?" audit.** Inspecting the L1 bundle showed that the batch had written
a concept whose one-line `description` — the line the gate injects — *is the conclusion itself*:

> "…자동 교체된 RequestHandler 전략의 appendRouteArgumentsToRequestAttributes 플래그가 기본 false라서
> `$request->getAttribute('id')`가 null이 된다"

So the agent may answer correctly without ever opening the concept file. That is genuine OKF
behaviour, not rigging: the question was written from source before any bundle existed, and no
concept was authored by hand. But it changes what a cheap `okf` number *means* — the saving would
come from the index being injected, not from selectively reading. The keyword check registered in
this document cannot detect it (the wording differs; only 3–4 of 16 keywords match), so a
condition-blind judge is now asked, per scenario and level, whether the injected text alone suffices.
Every affected cell is labelled in the report.

## Known limitations (stated before the result is known)

- Two repositories, one language each. No claim of generality across repo sizes.
- The gate text is prepended to the prompt rather than delivered through the production
  `SessionStart` `additionalContext` path. The text is identical; the delivery path is not measured.
- `n = 5` cannot resolve small differences; wall time includes network variance.
- Grading of prose answers uses a condition-blind LLM judge with a frozen rubric, plus regex as a
  secondary check. Judge agreement is published.
