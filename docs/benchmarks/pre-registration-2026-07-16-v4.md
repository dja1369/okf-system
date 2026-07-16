# OKF benchmark v4 — pre-registration (progressive chain)

Written and committed **before the first paid call of this design**, same discipline as v3
(`docs/benchmarks/pre-registration-2026-07-16-v3.md`). v3 measured single, independent questions
against a static pre-built bundle across two small repos (Slim, rust-lang/rfcs) and found: OKF loses
on cost for code-derivable questions except one deep-trace scenario (`slim_buried`), and wins only on
knowledge the code does not contain at all (policy/domain), where it is a cheaper CLAUDE.md rather
than a uniquely capable one. That finding is not re-litigated here.

## Why this design exists, and why v3 explicitly rejected its shape

v3's own "Known limitations" section says, verbatim:

> **Single-question sessions.** OKF's gate cost is paid once per question rather than amortized
> across a real multi-question session, so v3 **understates** OKF. A multi-question design was
> considered and rejected: its direction favours OKF and the session composition is a free
> parameter that could be tuned to flatter it.

v4 builds exactly that multi-question shape: a chain where session *k* investigates a question,
its conclusion is ingested by a real batch, and session *k+1* receives that accumulated bundle to
answer a related-but-different question. This is deliberately the regime v3 flagged as tunable in
OKF's favor. Doing it anyway requires stating, before any measurement, what stops "tuned to flatter"
from happening here:

1. **The four questions (Q1–Q4) are fixed and frozen in this commit**
   (`test/fixtures/bench/chain-steps.json`), before any paid session runs. They are not chosen or
   adjusted after seeing results.
2. **Every ground-truth atom was verified by direct source citation-checking**, not trusted from an
   agent's draft. Each `file:line` cited in `chain-steps.json` was independently read with
   `sed`/`grep` against the pinned commit and confirmed to say what the atom claims, before this
   document was written. (One cosmetic ordinal claim in Q4's prose — "19th of 21" — was corrected
   during this check; no atom content changed.)
3. **This is a separate, labeled axis, not a replacement for v3's headline.** v4 does not retract or
   re-run v3's finding. It adds a distinct claim about a distinct regime (multi-hop chains on a
   large real codebase) and reports it as such, win or lose.
4. **Refutation criteria (below) are mechanical**, evaluated by reading the raw JSON, not by prose
   chosen after the fact.
5. **The contamination guard is strengthened, not reused as-is.** v3 cleared Claude Code's cwd-keyed
   project memory once before measurement began. v4 clears it before **every single session**,
   because the chain design deliberately runs several sessions at the same cwd in sequence — without
   a per-step clear, Claude Code's own memory feature could silently accumulate the same facts OKF
   is supposed to be accumulating, and the comparison would no longer isolate OKF's mechanism. This
   applies to **both** arms: `zero_base_chain` reuses the same cwd across its 4 steps too, so without
   the guard its "no accumulation" control would be a fiction.
6. **A real-accumulation check, not an assumption.** `bench-chain.mjs` measures gate bytes
   (`gateBytesBefore`) immediately before every `okf_chain` step and requires the reader to look at
   whether it grows across steps (`meta.gateGrowthTrend`, `meta.gateGrewMonotonically`). If it does
   not grow, the report says so and the "chain learned something" premise is treated as unsupported
   for that run, not narrated around.
7. **Retraction-collision ban.** Results are described only against **M** (a fixed, frozen set of 4
   questions) and **session count** (chain length / reuse), exactly as the generalized break-even
   formula below states. They are never plotted against bundle size or concept count. v2's retracted
   "accumulation makes OKF cheaper" claim was exactly that axis confusion — plotting a real
   phenomenon (config injection cap) against the wrong variable (concept count) and calling it
   knowledge growth. This document names that failure so it cannot recur wearing a new costume.

## Design

**Target:** `kubernetes/kubernetes` @ tag `v1.30.0`, commit `7c48c2bd72b9bf5c44d21d7338cc7bea77d0ad2a`,
scoped to `pkg/scheduler` (178 Go files via sparse-checkout). Chosen over the two smaller v3 repos
because it is the closest available real-world instance of the regime the user asked about directly:
"a huge codebase, must open 10+ files, grep alone won't find it." v3's deepest scenario
(`slim_buried`) needed a median 5 files across 11 turns; each of Q1–Q4 below requires 8–14 files
across a real plugin-registry → factory → extension-point dispatch chain that cannot be grep'd to a
single hit (registration and implementation live in different files; config defaulting and override
precedence live in yet others).

**Chain questions (frozen in `chain-steps.json`, verified against source):**

| Step | Asks about | Shares with Q1 | New fact |
|---|---|---|---|
| Q1 | `PodTopologySpread`: which struct implements Score, how it's named/registered | — | registry/interface/instantiation mechanism |
| Q2 | `NodeResourcesFit`: same mechanism, different plugin, why its Score is strategy-dispatched | registry/instantiation mechanism | strategy-map indirection, different default weight |
| Q3 | User overrides `NodeAffinity`'s weight in config — where does the override win, not the default | registry/config-defaulting code paths | `mergePluginSet` / `getScoreWeights` precedence |
| Q4 | User disables `ImageLocality` + re-lists `NodeResourcesBalancedAllocation` — where does disablement gate instantiation, what decides Score-plugin execution order | registry/instantiation + override precedence | `pluginsNeeded` gating, 3-part reorder logic |

Each step targets a different concrete fact; none is a paraphrase of another. The shared substrate
(plugin registry → framework instantiation → extension-point dispatch) is exactly what a chain is
supposed to test transfer of.

**Arms:**

- `okf_chain`: session *k* runs with the real `SessionStart` gate wired to a chain-private
  `OKF_HOME`. Its transcript is claimed and fed through a real batch (`bin/batch.mjs`, sweep
  skipped, raw planted directly) immediately after the session ends, before session *k+1* starts.
- `zero_base_chain`: session *k* runs with no gate, no `OKF_HOME`, ever. Same 4 questions, same cwd
  reuse pattern, same per-step memory clear — the only difference is the absence of the OKF
  mechanism.

**Isolation:** each `(chain, arm)` pair gets its own git worktree of the pinned k8s clone (sparse
`pkg/scheduler`) as its `cwd`, and `okf_chain` additionally gets its own `OKF_HOME`. Chains cannot
contaminate each other. Worktrees are created sequentially before measurement (concurrent
`git worktree add` against one repository can race on `.git` metadata) and removed after.

**n:** `OKF_BENCH_CHAINS=15` per arm (30 chains × 4 steps = 120 sessions), matching v3's contrast-arm
convention. A smoke run at `OKF_BENCH_CHAINS=1` is required and must pass before the full run.

**Model/limits:** `claude-sonnet-5`, `effort=medium`, `maxTurns=40` (v3 default 25), per-call budget
`$1.25` (v3 default `$0.60`). Raised because slim_buried's real numbers (median 11 turns, 10 tool
calls, 5 files, $0.277) extrapolate to roughly 28–38 turns and $0.65–$1.05 for a 10-file trace; v3's
caps would plausibly censor a large share of these runs.

## Predictions (recorded before spending)

| # | Prediction |
|---|---|
| P1 | `okf_chain`'s per-step cost (correct runs only) decreases from Q1 to Q4, or at minimum does not increase, while `zero_base_chain`'s stays flat across steps. |
| P2 | `okf_chain`'s tool-call count decreases across steps as shared registry/dispatch knowledge is no longer re-derived. |
| P3 | `okf_chain`'s gate bytes (`gateBytesBefore`) grow monotonically (or stay flat, never shrink) across steps — the mechanical proof that real accumulation occurred. |
| P4 | `okf_chain` and `zero_base_chain` do not differ materially on Q1 (nothing has accumulated yet — this is the internal validity check; a difference here would indicate a leak, not an effect). |
| P5 | Atom-level accuracy is comparable or better for `okf_chain` from Q2 onward, not worse — the shared registry knowledge should not cause the model to *miss* the new, question-specific fact. |
| P6 | `zero_base_chain`'s per-step tool-call count and accuracy stay roughly constant across steps (no accumulation channel exists for it by design). If it instead trends the same direction as `okf_chain`, the per-step memory clear has failed and the run is contaminated — reported as such, not hidden. |

## Refutation criteria

Evaluated mechanically from the raw JSON's `summary` and `meta` blocks, not by prose.

- **R1** `meta.gateGrewMonotonically` is `false` — the premise that real accumulation happened is
  unsupported for this run.
- **R2** `okf_chain`'s median cost (correct runs) at Q4 is **not** lower than at Q1.
- **R3** `zero_base_chain`'s median cost or tool-calls trends the same direction as `okf_chain`'s —
  indicates the per-step contamination guard failed, not that OKF has an effect.
- **R4** `okf_chain`'s atom accuracy drops below `zero_base_chain`'s at any step — accumulated
  context is actively hurting, not helping.
- **R5** `meta.modelMixConfound` is non-null — cost comparison between arms includes a model-pricing
  artifact.

**Scope narrowing is not a win.** If the only effect is "Q1 is identical, and from Q2 the chain gets
marginally cheaper" without gate growth being monotonic, the report says growth was not established
and the cost effect is unexplained — not "OKF still wins."

## Break-even (generalized for M varying questions, one bundle)

```
R*(sessions) = M · C_ingest / Σ(i=1..M) s_i
```

`C_ingest` = sum of real batch costs across the chain's 4 steps (measured, not estimated).
`s_i` = paired per-step saving (`zero_base_chain` step-i median cost − `okf_chain` step-i median
cost), which **may be negative**; it is summed as measured, never floored at zero. This collapses to
v3's single-question formula at M=1. The distribution of `s_i` is published alongside the sum — a
positive total can hide a negative middle step, and that must be visible, not smoothed.

## Known limitations (stated before the result is known)

- **One repository, one subsystem.** No generality claim beyond `pkg/scheduler`. This is the same
  posture v3 took toward its two repos.
- **Pretraining familiarity is monitored, not directly probed.** Kubernetes scheduler internals are
  publicly documented; if `zero_base_chain` answers with unusually few tool calls, that is a flag to
  read, not evidence dismissed. A dedicated zero-turn memorization probe was considered and deferred
  — it would add a third arm and was judged unnecessary for a first pass at this design; if flagged
  in the data, it is named as an open question, not resolved by assumption.
- **Prompt-cache prefix effects are not isolated from knowledge-navigation effects.** `okf_chain`'s
  system-prompt prefix is identical every step; provider-side caching could lower cost independent of
  whether accumulated knowledge helped navigation. This run reports both `totalCostUsd` and
  `toolCalls`/`turns` so a reader can judge whether cost dropped with or without a tool-call drop —
  a cost drop with unchanged tool calls would point at caching, not navigation — but the two are not
  separated by a dedicated control this round.
- **M=4 is the floor of the range considered (4–6), chosen for cost/complexity control given this is
  the first run of a new harness shape.** A longer chain was not run this round.
- **Judge is a single LLM family**, no human-graded gold set — same limitation as v3.
- **n=15 chains resolves the same order of effect size as v3's contrast arms**, not smaller ones.

## Amendments after registration

Recorded here rather than edited in silently.

- **2026-07-16, after measurement:** the core prediction (P1) was refuted at n=15 — see
  [the report](okf-benchmark-chain-2026-07-16-v4.md). R2, R3, and R4 fired. R3's mechanical wording
  ("zero_base_chain trends the same direction as okf_chain ⇒ contamination guard failed") could not
  be cleanly distinguished from an alternative this document did not anticipate: Q1–Q4's difficulty
  was not held constant, and Q4 (a two-part question) plausibly drove a cost/tool-call spike in
  **both** arms independent of any guard failure. This is named as a real design limitation of this
  registration, not resolved by assumption — both explanations are reported in the results document.
  A harness-level flake (14/120 runs, 11.7%, `exitCode=0` but no `result` event) was also observed
  and is reported separately from wrong answers, in the same spirit as v3's unexplained hook-delivery
  flake.
