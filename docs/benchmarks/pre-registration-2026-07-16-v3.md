# OKF benchmark v3 — pre-registration

Written and committed **before the first paid measurement call**, like v2's.

v2's pre-registration existed to stop a disappointing result from being re-narrated as a success.
It failed at that. This document's first job is therefore not to design v3 — it is to record, in
detail, the six false or unsupported statements v2 published, and how each was caught. A
pre-registration that cannot admit its predecessor lied is decoration.

## What v2 published that was not true

Every item below was verified against v2's own committed raw JSON
(`docs/benchmarks/raw/okf-live-2026-07-16T05-28-21-631Z.json` and `…T06-13-30-750Z.json`) — the
data was sitting in the repository the whole time. Nothing here required new measurement.

### 1. The `rfcs_policy` trap explanation was fabricated

**Published, in the English README and all 7 translations:**

> `rfcs_policy` is the honest failure: OKF managed only 2/5. The `N-2` proposal sitting in the
> document pile is a strong enough trap to pull the model off a correct index line.

**The check:** filter the raw records to `scenario=rfcs_policy, condition=okf` and read
`readPaths` and the answers.

**The result:** all 5 runs read only bundle files (`rust-msrv-thaw-policy.md`, and in 3 runs also
`cargo-msrv-adoption-candidates.md`). **Zero runs opened any RFC document. Zero runs answered
`N-2`.** All five answered "4 releases". The trap never fired even once.

The sentence was invented to give a disappointing number a plausible story. It reads like an honest
admission of a weakness, which is what makes it worse than a plain error: it purchased credibility
with a fiction.

### 2. The accumulation headline is not supported by its own sample

**Published:**

> **From 1 to 35 concepts OKF got cheaper ($0.1291 → $0.0908) while CLAUDE.md got 2.2× dearer
> ($0.1279 → $0.2828).** The curves diverge.

**The check:** recompute the per-level medians, and also look at the distributions the medians came
from.

**The result:** the numbers reproduce exactly — they are correct-runs-only medians, which is the
pre-registered rule, so they were not fabricated. But they are medians of **3, 2, 5, 3, 2 and 4**
correct runs. The claimed low point ($0.0701) is *the median of two runs*. Across all runs the
level distributions overlap completely (L1 spans $0.0774–$0.2214; L40 spans $0.0836–$0.1606), and
the all-runs medians are not monotonic at all: $0.1237, $0.1884, $0.1425, $0.0852, $0.1142, $0.1135.

The same README concedes, two paragraphs later, "At n=5 nothing here separates." So the document
asserts a divergence and denies it can detect one, on the same page. The reader is expected not to
notice.

### 3. "Where OKF is the only thing that works" is refuted by the table beneath it

**Published:** a section titled *"Where OKF is the only thing that works: knowledge the code does
not contain"*, whose own table reports `claude_md` at **5/5 on `slim_policy`** and **5/5 on
`slim_domain`** — the latter beating OKF's 4/5.

CLAUDE.md works. It is not "the only thing". The defensible claim was available and unglamorous:
parity with the incumbent at 1.6–1.9× less cost, with bounded injection. The title overreached past
the evidence in the paragraph it introduced.

### 4. The pre-registration promised reproducibility the repository forbids

**v2's pre-registration says:**

> Transcripts are frozen and committed so the run reproduces.

**`.gitignore`, lines 4–7, in the same tree:**

```
# 벤치마크 중간 산출물: transcript(수십 MB)와 레벨별 번들 스냅샷은 커밋하지 않는다.
# 재현은 test/bench-knowledge.mjs 로 다시 만든다(유료). 측정 결과와 시나리오는 커밋한다.
test/fixtures/bench/transcripts/
.bench-bundles/
```

Neither the transcripts nor the bundles were ever committed. `git log --all -- test/fixtures/bench/transcripts`
is empty. Both directories are now gone from disk. **v2 is not reproducible and never was.**
Regenerating knowledge with `bench-knowledge.mjs` produces *different* knowledge — the sessions are
LLM runs, not fixtures — so the escape hatch in that comment does not deliver reproduction either.

This is the most damaging of the six, because every other v2 number rests on artifacts that no
longer exist and that no reader could ever have audited.

### 5. The harness claims a guard it does not implement

`test/bench-okf.mjs:14` states, as a design property inherited from v1's flaws:

> 모델 ID 를 고정하고 조건별로 갈리면 중단한다 (pin the model ID and abort if conditions diverge)

No abort exists in the file. The published `meta.modelMixDetected` is `true` in both runs, and both
runs completed. The code records the confound and proceeds, while the comment tells the reader it
is prevented.

### 6. `breakEven` was computed and silently not published

`bench-okf.mjs` computes a `breakEven` block. The published raw JSONs contain only
`meta`, `metricDefinitions`, `summary`, `records`. The README links "[raw JSON](docs/benchmarks/raw/)"
as the audit trail. Break-even against the CLAUDE.md incumbent is the number that decides whether
OKF is worth its ingest cost, and it is the one number that did not survive into the artifact.

### The pattern

These are not six unrelated slips. Every one has the same shape: **a claim that sounds rigorous,
whose supporting work was not done.** A causal story with no check of the reads. A trend with no
look at the dispersion. A section title that outran its table. A reproducibility promise
contradicted by `.gitignore`. A guard that lives in a comment. An audit trail with the decisive
field missing.

v2's own pre-registration warned about exactly this failure mode, in these words:
"misrepresenting prior work in order to justify new work is precisely the failure mode this document
exists to prevent." It caught the case where the victim was *someone else's* work, and missed the
case where the victim was its own results.

## What v3 changes, and why

v3's headline change is **not** the sample size. It is **auditability**: v3 commits the knowledge
and the bundles, so a reader can refute v3 the way v2 was just refuted — from the repository, at
zero cost, without trusting the author.

| # | Change | Fixes | Cost |
|---|---|---|---|
| C1 | Commit generated transcripts and every level bundle (concepts + gate text + `levels.json`). Delete the `.gitignore` entries that made v2 unauditable. | v2 #4 | $0 |
| C2 | Retract v2 #1, #2, #3 from the README and all 7 translations. Do not replace a false story with a better story — state that the cause was not investigated. | v2 #1–3 | $0 |
| C3 | Record the full `modelUsage` object (per-model `costUSD`), and publish **sonnet-only cost beside total cost**. The field was always in the result event; v2 stored `Object.keys()` and dropped the values. | v2 #5, and v2 limitation "model mix is not pinned" | $0 |
| C4 | Implement a real abort: fail loud if the *set* of resolved models differs **between conditions**. Haiku resolving alongside Sonnet in every condition is not a confound; Haiku in one condition only is. v2's comment promised the wrong check; v3 implements the right one and says so. | v2 #5 | $0 |
| C5 | Publish `breakEven` in the raw JSON and in the report. | v2 #6 | $0 |
| C6 | Deliver the gate through the **real** `SessionStart` hook (`--setting-sources '' --settings <file>`), not by prepending text. Verified live during design. Assert delivered bytes per cell and fail loud on a 0-byte gate. | v2 limitation "gate is prepended" | $0 |
| C7 | Per-atom grading: decompose each `ground_truth` into pre-registered atoms and grade each independently in one structured call. Publish **both** per-atom and v2's binary score. | information destroyed by binary collapse | ~$14 |
| C8 | Raise n to **15** on the three claim-carrying conditions (`zero_base`, `okf`, `claude_md`); keep n=5 on the two controls (`answer_sheet`, `wrong_knowledge`), which establish bounds and need no power. | v2 limitation "n=5" | ~$52 |
| C9 | Retire the level-axis cost curve entirely. | v2 #2 | −$ |
| C10 | Fix batch ingest fidelity (see below), and add a regression fixture asserting the causal link survives. | the real `rfcs_policy` cause | ~$2 |
| C11 | Past-the-cap exhibit: merge the slim and rfcs bundles into one ~70-concept cross-repo bundle and measure `slim_buried`. | the regime real users occupy | ~$6 |
| C12 | Measure wall-clock on a sequential subset at concurrency 1. | v2 limitation "wall-clock not published" | $0 |

### Why the level axis is retired rather than re-run at higher n

v2 reported the gate growing by "one byte" from 15→35 concepts and attributed it to the batch
"collapsing 14 concepts into a single index line" — presented as an emergent property of how OKF
organises knowledge. The plateau is `inject_max_lines: 120` in `lib/config.mjs`. It is a
configuration constant. `bench-bundles.mjs` even records `gateTruncated`, which is true at exactly
the levels where the plateau begins: entries were **dropped for budget**, not elegantly nested.

Re-running that axis at n=15 would buy a more precise measurement of a number that can be read off a
config file. v3 states the cap as a cap and spends the money on claims that are actually uncertain.

### The real cause of `rfcs_policy` 2/5

Not the trap (see #1). The evidence points at batch ingest fidelity:

- The source prompt that generated the knowledge states the causal link explicitly: *"그냥 우리 사내
  빌드 이미지의 rustc를 분기에 한 번만 올리기 때문에 생긴 숫자야"* — the number 4 exists **because**
  the in-house build image bumps rustc quarterly.
- `readTargetConcept` is `true` in 5/5 runs — every run opened the concept file.
- 3 of the 5 then answered, in substance, *"왜 4릴리즈인가에 대한 명시적 근거는 번들에 기록되어 있지
  않음"* — the bundle does not record why.
- The judge marked exactly those 3 wrong, and the 2 that did recover the link right. **The judge
  graded correctly.** An earlier draft of this document accused it of being a coin flip, on the
  strength of a keyword regex that matched the *mention* of "빌드 이미지" inside a sentence denying
  the reason was known. That accusation was wrong and is recorded here rather than deleted.

So the concept preserved the consequence and dropped the origin. v3 fixes the concept-writer rule
(when a source attributes a number to a cause, the concept must carry that link on the line
asserting the number), regenerates the bundle, and asserts the link with a committed fixture.

This is a **pipeline defect, not an OKF limitation**, and v2 published it as the latter.

## Claim under test

Unchanged from v2:

> When knowledge accumulates incrementally, an agent can consult past work instead of re-exploring
> the codebase every session, and this is more efficient.

v2's answer, which v3 inherits and does not discard: **on questions the code can answer, this is
false** — OKF lost 4 of 5 and cost ~2× on cheap greps. That finding is not re-litigated. v3
re-measures it at higher n and with the corrections above; if it survives, it stands.

## Conditions, targets, scenarios

Unchanged from v2 (two pinned repos: `slimphp/Slim` @ `80900fb3`, `rust-lang/rfcs` @ `f635361c`;
five conditions; the same 8 frozen scenarios).

**No scenario may be dropped.** The three that a "narrow the grid to fund higher n" pass would
naturally cut — `rfcs_buried`, `rfcs_cheap`, `slim_stale` — are exactly the three where OKF loses to
`zero_base`. Cutting them would raise OKF's win rate by selection. If the budget binds, **cut n,
never scenarios.** This is registered here so that a later budget cut cannot quietly become a
result.

A third repository (`scrapy`, Python) was designed, verified and **rejected** before spending: it
would add ~$60 and still not license a generality claim at this n. Recorded so that its absence is
a decision, not an oversight.

## Predictions (recorded before spending)

| # | Prediction |
|---|---|
| P1 | v2's central finding survives n=15: `zero_base` beats `okf` on cost for every code-derivable scenario except `slim_buried`. |
| P2 | `zero_base` stays at or near 0/15 on all three policy/domain scenarios. |
| P3 | `wrong_knowledge` stays at or near 0/15. The gain is the knowledge, not the gate. |
| P4 | `okf` and `claude_md` do **not** separate on accuracy at n=15 on `slim_policy`/`slim_domain`. OKF's advantage is cost and bounded injection, not capability. |
| P5 | After the ingest fix, `rfcs_policy` `okf` rises above 2/5. If it does not, the ingest hypothesis is wrong and the report says so. |
| P6 | Per-atom grading raises OKF's `rfcs_policy` score relative to the binary. **This is a metric change in a direction that flatters the product**, which is why both scores are published and the atoms are frozen below before measurement. |
| P7 | Delivering the gate through the real hook changes cost by <5% versus prepending. Same text, same tokens. |

## Refutation criteria

The claim is **refuted** if any of these holds. Evaluated mechanically in `bench-report.mjs`, not
by prose.

- **R1** `okf` median cost ≥ `zero_base` median cost on buried-fact scenarios (correct runs only).
- **R2** `okf` median cost ≥ `claude_md` median cost.
- **R3** `okf` accuracy is below `zero_base` accuracy on the policy/domain scenarios.
- **R4** `wrong_knowledge` scores materially above 0 on policy/domain scenarios — i.e. any gate helps,
  and the knowledge is not what is working.
- **R5** Break-even against `claude_md` exceeds 200 sessions once ingest cost is included.

**Scope narrowing is not a win.** If OKF's only surviving advantage is cost-at-parity, the report
says "OKF is a cheaper CLAUDE.md, not a more capable one", in those words.

## Aggregation rules

Inherited from v2 and unchanged: correct-runs-only for efficiency; **no cross-scenario averaging**;
capability-only scenarios excluded from efficiency numbers.

**New, in response to v2 #2:** any claim of a trend or a difference must publish the dispersion it
rests on (min/max and the n of the subgroup the statistic is computed over), in the same table as
the statistic. A median of two runs may not be rendered as a point on a curve. If distributions
overlap, the report says "not separated" — and the headline may not say otherwise.

## Frozen atom decomposition

Registered before measurement so that per-atom scoring cannot be tuned after seeing results. Atoms
are stored in `test/fixtures/bench/scenarios.json` under `ground_truth_atoms`, frozen at the commit
that carries this document. Each atom is graded independently: present-and-correct, absent, or
contradicted. The binary v2-style score is `all atoms correct`.

## Known limitations (stated before the result is known)

- **Two repositories, two ecosystems.** No generality claim. The third target was rejected on
  cost-per-credibility, and adding it would not have established generality either.
- **n=15 on contrasts, n=5 on controls.** Resolves roughly 30-point accuracy differences; smaller
  ones stay unresolved. This is a budget compromise, not a sufficiency claim.
- **Single-question sessions.** OKF's gate cost is paid once per question rather than amortized
  across a real multi-question session, so v3 **understates** OKF. A multi-question design was
  considered and rejected: its direction favours OKF and the session composition is a free
  parameter that could be tuned to flatter it. The amortization is instead published as a
  projection computed from measured data, explicitly labelled a projection, not a measurement.
- **Quiz-shaped, not task-shaped.** Knowledge is graded as recall, never as a changed artifact.
- **Cold sessions only.** Deliberate and conservative; warming the cache would discount OKF's large
  fixed prefix more than it discounts exploration.
- **The judge is a single LLM family**, with no human-graded gold set. Per-atom decomposition
  reduces collapse but not grader variance.
- **The model mix is quantified, not eliminated.** Haiku still resolves alongside Sonnet. v3 prices
  it instead of disclosing it.
- **Break-even assumes a static corpus.** Real bundles grow and re-ingest continuously.
- **A 1-in-7 hook-delivery flake was observed during design and is unexplained.** v3 detects it per
  cell and retries; the retry count is published. The root cause is unknown.

## Amendments after registration

Recorded here rather than edited in silently.

*(none yet)*
