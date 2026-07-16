# OKF benchmark v2 — pre-registration

Written and committed **before the first paid measurement call**. Its purpose is to make the result
un-spinnable: the predictions, the levels, the grid, and the refutation criteria are fixed here, so a
disappointing outcome cannot be re-narrated afterwards as a success.

The previous benchmark (2026-07-15) concluded that OKF did **not** save tokens versus a user who
restates the facts by hand. This redesign was requested by the project owner, who asked for proof of
the opposite. That is exactly the situation in which pre-registration matters.

## Claim under test

> When knowledge accumulates incrementally, an agent can consult past work instead of re-exploring
> the codebase every session, and this is more efficient.

## What the previous benchmark got wrong

1. **Wrong comparator.** `B_manual_restatement` pastes the eight target facts into the prompt. To
   type that string the user must already know the answer, so it is an unattainable floor, not a
   competitor. It was reported as if OKF had lost to a realistic alternative.
2. **The baseline could not win.** The fixture project literally contained
   `No prior decisions are stored here`. `A_no_memory` was not "exploration"; it was a search of an
   empty room. The realistic contest — explore the history vs. read the bundle — was never run.
3. **Possible gate leak.** The gate index line contained `SQLite, repository pattern` and the
   question asked for "database와 pattern". The answer was inside the injected index, so `C` may have
   scored without ever reading a concept. That is condition `B` wearing `C`'s name.
4. **Token activity is not cost.** v1's own numbers: A = 27,320 tokens / \$0.0349, C = 22,881 tokens /
   \$0.0530. C looked 16% cheaper and was 52% more expensive. `cache_read_input_tokens` dominates the
   sum and is billed at a fraction of the rate.
5. **Mixed models in one run.** Haiku 4.5 and Sonnet 5 both resolved inside a single run, so
   cross-condition cost differences were partly a model-mix artifact.

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

## Known limitations (stated before the result is known)

- Two repositories, one language each. No claim of generality across repo sizes.
- The gate text is prepended to the prompt rather than delivered through the production
  `SessionStart` `additionalContext` path. The text is identical; the delivery path is not measured.
- `n = 5` cannot resolve small differences; wall time includes network variance.
- Grading of prose answers uses a condition-blind LLM judge with a frozen rubric, plus regex as a
  secondary check. Judge agreement is published.
