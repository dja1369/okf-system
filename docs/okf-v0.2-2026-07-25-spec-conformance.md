# OKF 스펙 v0.2 대응 조사

조사일 2026-07-25 · 대상 커밋 origin/main cce54e8 · 배포 버전 0.1.6
읽기 전용 조사. 저장소·라이브 번들 모두 무수정.

계기: Google Cloud가 2026-07-25 [OKF v0.2를 발표](https://cloud.google.com/blog/products/data-analytics/okf-v0-2-adds-trust-signals?hl=en)했다
("OKF v0.2 adds trust signals"). 스펙 원문은 이미 v0.2로 갱신돼 있다.

## 0. 조사 방법과 검증 수준

다단 서브에이전트 워크플로우로 수행했다: 스펙 원문 정밀독해 / Google 레퍼런스 구현(번들 4개·
concept 53개 전수) 관찰 / 생태계 3방향 조사 → 코드 영역 5개(린트·번들생성·배치ingest·게이트·
시각화문서) 영향 분석 → **영역마다 별도의 적대적 검증 에이전트**가 제시된 `파일:라인` 근거를 직접
열어 반박 시도 → 마이그레이션 설계와 그에 대한 반박 → 통합.

각 항목의 `검증` 열은 그 적대적 검증 결과다. **REFUTED 판정을 받은 주장은 본문에서 제거하고
§9에 폐기 이유와 함께 남겼다** — 초기 가설 중 상당수가 이 단계에서 죽었고, 그 목록 자체가
이 문서의 신뢰성 근거다.

아래 4건은 위 워크플로우와 **독립적으로 메인 세션에서 재확인**했다:

- **§13.1의 `timestamp` 폴백이 MUST가 아니라 MAY** — 스펙 원문 직접 확인:
  "Consumers MAY fall back to a legacy `timestamp` when `generated` is absent."
  이 한 단어가 §5의 마이그레이션 판단을 통째로 결정한다.
- **B7의 YAML 날짜 파싱** — 실행 확인. 보고된 것보다 나쁘다: 따옴표 없는 `stale_after: 2026-12-31`은
  `Date` 객체가 되고, `"2026-07-25" >= <Date>`뿐 아니라 **경과일인 `"2027-01-05" >= <Date>`도 false**다.
  즉 stale 판정이 어떤 날짜에도 발동하지 않는다. `generated.at`도 동일하게 Date가 된다.
  같은 실행에서 `verified: { by: ..., at: ... }`가 배열이 아님을 확인 — §5.2의 "bare mapping을
  1원소 리스트로 취급하라(MUST)"를 만족하려면 정규화 헬퍼(P13)가 반드시 선행해야 한다.
- **B5의 게이트 예산 포화** — 이 조사를 수행한 세션 자신에게 주입된 게이트가 증거다:
  `patterns 2/5개`, `preferences 2/3개`, `projects 2/3개`, `references 1/6개`, `troubleshooting 1/2개`
  → **21개 중 10개만 주입**됐다(배치 직전 상태. 워크플로우 실측 12/22와 같은 현상).
- **`okf_version` 승격에 분기가 필요하다는 것**(P4) — `lib/index-gen.mjs:39-50`을 직접 읽어 확인.
  `readExistingOkfVersion()`이 기존 값을 보존하므로 `:49`의 폴백만 바꾸면 **이미 설치된 번들은
  영원히 `"0.1"`로 남는다**. 신규 설치에만 적용되는 무의미한 변경이 된다.

---

## 1. 결론

OKF v0.2는 우리 번들을 **깨지 않는다**. 적합성 3조건은 v0.1과 동일하고, 신규 필드는 전부 optional이며, 소비자는 선택 필드 누락으로 번들을 거부할 수 없다(SPEC.md §11). 즉 아무것도 안 해도 우리 번들은 적합한 v0.2 번들이다. 그러므로 이 대응의 가치는 "적합성 확보"가 아니라 **하나뿐**이다 — 지금 우리 번들에는 "누가·언제 이 지식을 만들었는가"가 기록되지 않는데(concept 22개 전부 `timestamp`만 보유, `generated` 0개), v0.2는 그것을 표준 어휘로 열어줬고 **그 값은 코드가 전부 알고 있다**. 반대로 `verified`·`stale_after`·`sources`는 우리가 채울 근거가 없다 — 배치가 자기 산출물에 `verified`를 찍는 것은 신뢰 신호 위조이고, `stale_after`는 도메인 근거가 없으며, `sources`는 digest가 URL을 통째로 버려서(`lib/digest.mjs:43`) 강제하면 환각만 나온다. 그리고 결정적 제약 하나: `okf_version`을 "0.2"로 올리면서 `generated`를 쓰지 않으면 번들은 **후퇴한다** — §13.1의 `timestamp` 폴백은 소비자 **MAY**라서, v0.2 선언 하에서 우리 22개 concept는 폴백을 구현하지 않은 소비자에게 시간 신호가 아예 없는 문서가 된다. **선언과 생산은 같은 릴리스에 있어야 하고, 둘 다 못 하면 둘 다 하지 마라.**

---

## 2. OKF v0.2가 바꾼 것

원문: `https://raw.githubusercontent.com/GoogleCloudPlatform/knowledge-catalog/main/okf/SPEC.md` (main, 1003줄). v0.1 원문(commit `ee67a5c`, 451줄)과 diff 대조 완료.

| 항목 | 구분 | 필수 여부 | 우리에게 해당? | 근거 |
|---|---|---|---|---|
| `sources: [{resource, id, title, author, usage_count, last_modified}]` | 신규 | optional (항목 내 `resource`만 REQUIRED) | **조건부** — digest가 URL을 보존해야 성립 | §5.1 |
| `usage_window: {from, to}` | 신규 | optional, **`sources`의 형제 최상위 키**(항목 필드 아님) | 아니오 — 계측 소스 없음 | §5.1 |
| `generated: {by, at}` | 신규 (`timestamp` 대체) | optional, 항목 내 `by`만 REQUIRED | **예 — 핵심** | §5.2, §13.1 |
| `verified: [{by, at}]` | 신규 | optional. 소비자는 dash 없는 bare mapping을 1원소 리스트로 취급 **MUST** | 생산: 아니오 / 소비: 헬퍼만 | §5.2, §11 |
| `status: draft\|stable\|deprecated` | 신규 | optional, 부재 시 `stable` | **예 — `deprecated`만** | §5.4 |
| `stale_after: YYYY-MM-DD` (절대 날짜) | 신규 | optional. `today >= stale_after`면 stale | 아니오 — 근거 없음 | §5.5 |
| Actor 규약 `<producer>/<version>` · `human:<id>` · `process:<id>` | 신규 | 사람 저작/확인 콘텐츠에는 `human:` 사용 **MUST**(생산자) | 예 | §7 |
| 신뢰 등급(unverified / machine-confirmed / human-reviewed) | 신규 | 소비자가 `verified`에서만 파생 (SHOULD) | 소비 시에만 | §5.3, §11 |
| type `Attested Computation` (+`runtime`/`parameters`/`executor`/`attester`) | 신규 | `runtime`만 REQUIRED (그 타입 안에서) | **아니오** | §10 |
| `timestamp` → `generated.at` | **대체** | 소비자 폴백은 **MAY**(의무 아님) | 예 — 함정 | §13.1 |
| 본문 `# Citations` → `sources` + `[^<sources[].id>]` 마크다운 각주 | **대체** | 소비자 폴백은 MAY | 해당 없음(우리는 `# Citations` 미사용) | §4.2, §5.1 |
| `okf_version: "0.2"` (번들 루트 index.md 프론트매터, 그곳에만 허용) | 신규 | **MAY** (선언 자체가 선택) | 예 | §8, §12 |
| 예약 파일명 `index.md`/`log.md`, 어느 레벨에서나 선택 | 불변 | concept 문서로 사용 금지 MUST NOT | 예 | §3.1, §9 |
| 적합성 3조건(파싱 가능 프론트매터 / 비어있지 않은 `type` / 예약 파일 구조) | **불변** | — | 예 — 이미 충족 | §11 |
| 소비자 거부 금지 5종(선택 필드 누락·미지 type·미지 키·깨진 링크·index.md 부재) | 불변(§4.1 미지 키는 SHOULD NOT→**MUST NOT** 격상) | MUST NOT | 예 — 이미 준수 | §4.1, §11 |
| 미지 키 round-trip 보존 | 불변 | SHOULD | **예 — 우리가 위반 중** | §4.1 |

레퍼런스 구현 실측(번들 4개, concept 53개 전수): `generated` 53/53, `sources` 49/53, `status` 10/53, `verified` 8/53, `stale_after` 7/53, `usage_count` 1/53, `timestamp` 0/53. 그리고 `verified`/`stale_after`/`usage_*`는 **전부 손으로 큐레이션한 acme_retail 데모에만** 있다 — 자동 파이프라인(reference_agent)이 만든 51개는 전부 unverified다. `generated`는 모델이 아니라 코드가 `write_concept_doc`에서 강제 주입하고, 프롬프트는 "leave unset and the tool will record it for you"라고 지시한다. index.md 24개 중 프론트매터를 가진 것은 **0개**(레퍼런스는 `okf_version`을 어디에도 쓰지 않는다). 별도의 conformance 검사기는 존재하지 않으며(`document.py`의 REQUIRED는 `type` 하나), **우리 `lib/lint.mjs`가 Google이 가진 어떤 것보다 엄격하다**.

---

## 3. 지금 우리 코드가 깨지는 지점

### 3-A. 적합성 위반 (스펙 문언을 어김)

| # | 문제 | 근거 | 검증 |
|---|---|---|---|
| A1 | **루트 index.md의 미지 프론트매터 키를 매 재생성마다 파괴한다.** `readExistingOkfVersion`이 `okf_version` 값 하나만 뽑고, `buildRootIndex`가 프론트매터를 통째로 새로 만든다. §4.1 "Consumers SHOULD preserve unknown keys when round-tripping" 위반. 게다가 `regenerateIndex`가 `runLint`보다 먼저 돌므로(`bin/batch.mjs:833-834`) 배치 경로에서는 W4 경고조차 발화하지 않는다 — 거부가 아니라 **소리 없는 삭제**다. | `lib/index-gen.mjs:39-50`, `:58`; `bin/batch.mjs:833` | CONFIRMED (실측: `x_tool_state` 키 투입 → 재생성 후 소실) |
| A2 | **하위 index.md에 §8이 요구하는 섹션 헤딩이 없다.** `regenerateDir`이 헤딩 없이 bullet만 쓴다. 적합성 조건 3(예약 파일은 §8 구조 준수) 위반. v0.2 신규 이슈가 아니라 v0.1부터 있던 갭. | `lib/index-gen.mjs:107-121`; `/Users/ducksu/.claude/okf/decisions/index.md:1`; SPEC §8 | CONFIRMED |
| A3 | **중첩 `log.md`가 §9 ISO 날짜 검사에서 완전히 빠진다.** `const isLog = relPath === 'log.md'`(루트 한정)인데 reserved 판정은 `basename === 'log.md'`라, 중첩 log.md는 concept 검사도 §9 검사도 안 받는 사각지대다. | `lib/lint.mjs:161-162`; SPEC §9 | CONFIRMED (실측: `references/log.md`에 `## July 5 2026` + 오름차순 → lint 출력 0줄, EXIT=0) |
| A4 | **게이트 헤더가 `(OKF v0.1)`을 하드코딩한다.** 승격 후에도 매 세션 모델에게 v0.1이라고 말한다. `prompts/ingest.md:3`도 "OKF **v0.1** 번들의 지식 사서다"로 시작한다 — 후자는 읽는 곳이 아니라 **쓰는 곳**이다. | `bin/session-start.mjs:80`; `prompts/ingest.md:3` | CONFIRMED |

**거부(reject) 관련 MUST/MUST NOT은 전부 이미 준수한다.** 실측: index.md 없음 + `type: BigQuery Table` + 미지 키 2개 + 깨진 링크를 동시에 만족하는 최악 번들 → `W1`/`W2`/`W3` 경고만, **EXIT=0**. `lint.mjs:200`이 `errors.length > 0`일 때만 exit 1이고 E1/E2/E3a/E3b는 적합성 3조건과 정확히 겹친다. 방어 코드 추가 불필요.

### 3-B. 적합하지만 기회 상실 / 자해

| # | 문제 | 근거 | 검증 |
|---|---|---|---|
| B1 | **`sources`/`generated`/`verified`/`status`/`stale_after`를 쓰는 곳도 읽는 곳도 전혀 없다.** 라이브 번들 22개 concept 전수 검사 결과 이 다섯 중 하나라도 가진 파일 **0개**. 지식이 전부 `claude -p` 배치 산출물인데 그 사실이 어디에도 안 적혀 있다. | grep(lib/, bin/, prompts/, templates/); `/Users/ducksu/.claude/okf/decisions/ds-labs-architecture.md:1-7` | CONFIRMED |
| B2 | **lint W2가 `timestamp`를 하드코딩 요구.** `['title','description','timestamp']`. v0.2 네이티브 concept(=`generated`만 보유)이 전부 부당 경고를 받는다. 스펙 위반은 아니지만(경고는 허용) **역인센티브**다. | `lib/lint.mjs:130` | CONFIRMED (실측: v0.2 concept 3개 전부 W2, EXIT=0) |
| B3 | **그 경고가 repair 프롬프트로 새어 나간다.** `buildRepairPrompt`가 `formatReport(report)`를 통째로 `{{LINT_REPORT}}`에 심고, `formatReport`는 errors와 warnings를 **둘 다** 잇는다. `prompts/repair.md`는 "각 오류를 해소하라"고 지시한다 → 무관한 에러로 repair가 한 번 발동하면 모델이 v0.2 문서에 `timestamp`를 되살린다. **ingest가 v0.2로 쓴 것을 repair가 v0.1로 되돌리는 진동.** | `bin/batch.mjs:695-699`, `:838`; `lib/lint.mjs:188-194` | CONFIRMED |
| B4 | **`index-gen`의 `extractEntry`가 `title`/`description`만 읽는다.** 폐기된 concept가 아무 표식 없이 매 세션 주입된다. 실물 사례: 게이트가 지금 주입하는 references 2개는 번들 자신이 "사용자의 실제 프로젝트와 무관한 OKF 벤치마크 하니스 잡음"이라고 선언한 `# 리다이렉트` 묘비 문서다. 파일명 사전순('k' < 'o','s') 때문에 `okf-format.md`·`okf-system-architecture.md`가 대신 잘린다. | `lib/index-gen.mjs:25-37`, `:98`; `/Users/ducksu/.claude/okf/references/kube-scheduler-score-weight-override-precedence.md:3,8` | CONFIRMED (실측: 그 2건 제외 시 12/22 → 13/20, references 슬롯이 실제 문서로 교체) |
| B5 | **주입 예산은 이미 포화다.** head 686B/10줄 + tail 1,358B/18줄 + heading 220B를 빼면 concept 예산 6,736B인데 22줄이 11,819B다 → **12/22만 주입, 10개(45%) 탈락**. 줄 캡(120)은 한 번도 안 걸리고 `inject_max_bytes`는 validator가 최대 9000으로 못박아 늘릴 수 없다. **바이트를 더 쓰는 개선은 전부 축출을 유발한다** — 9B 배지를 전 줄에 붙이면 concept 1개가 날아간다(실측 12→11). | `bin/session-start.mjs:29,37,45,95`; `lib/config.mjs:63`; 실측 | CONFIRMED |
| B6 | **프라이버시: 이미 실현된 유출이 있다.** 라이브 번들에 LLM이 쓴 절대 경로 `resource: /Users/ducksu/.claude/jobs/a1c84f7e/tmp/targets/slim`이 커밋돼 있다. 그리고 배치 프롬프트는 지금도 `2026-07-12---Users-ducksu-side-project-manna--claude-worktrees-manna-mvp--<uuid>.jsonl` 형태(홈 경로+프로젝트명+워크트리명+세션 UUID)를 LLM에게 직접 건넨다. `sources` 도입은 이 표면을 배열로 늘린다. | `/Users/ducksu/.claude/okf/references/slim-psr15-route-handler-vs-closure.md:5`; `bin/batch.mjs:686-693`, `:742-747` | CONFIRMED |
| B7 | **YAML 날짜 스칼라가 `Date` 객체로 파싱된다.** 따옴표 없는 `stale_after: 2026-12-31`은 `[object Date]`가 되고, `'2026-07-25' >= <Date>`는 NaN 비교라 **항상 false**(과거 날짜로도 false 확인). 따옴표를 씌우면 문자열로 남는다 → **같은 필드가 번들마다 타입이 다르다**. 지금은 안 터진다(W2가 존재 여부만 봄). stale/trust 로직을 **추가하는 순간** 터지는 지뢰. | 실측(vendored js-yaml + `lib/frontmatter.mjs`); `lib/lint.mjs:130`; SPEC §5.5 | CONFIRMED |
| B8 | **`sources[].resource`의 자유 문장이 새 롤백 경로를 만든다.** 스펙이 스코프 서술자를 허용하는데, 무따옴표 문장에 `": "`가 들어가면 프론트매터 전체가 파싱 실패 → E1 → repair 1회 → 실패 시 **청크 롤백**. v0.2가 자유 문장을 처음으로 표준 필드로 초대해서 생긴 위험. | 실측: `resource: Claude Code session: 2026-07-25` → `bad indentation of a mapping entry (3:34)`; `bin/batch.mjs:853`, `:889` | CONFIRMED |
| B9 | **viz가 하위 디렉토리를 재귀하지 않고, 예약 파일 `log.md`를 concept 노드로 그린다.** `index-gen`은 재귀하는데 `viz`는 안 한다 → 중첩 concept가 index에도 게이트에도 있는데 그래프에만 없고, `okfFiltered` 카운터에도 안 잡혀 사용자가 알 방법이 없다. v0.2와 무관한 선재 버그. | `lib/viz.mjs:34-44`; `lib/index-gen.mjs:79-86`, `:87-122` | CONFIRMED (라이브 번들이 평면이라 아직 잠복) |
| B10 | **`TYPE_TO_DIR[typeStr]`가 프로토타입 체인을 탄다.** `type: constructor` → `W3: ... expects /function Object() { [native code] }/`. `type`은 신뢰할 수 없는 데이터이고 v0.2가 type을 자유 문자열로 못박아 도달 가능성이 오른다. `viz.mjs`는 같은 클래스를 이미 방어하고 전용 테스트까지 있는데 lint만 안 돼 있다. | 실측; `lib/lint.mjs:8`, `:136`; `test/smoke.mjs:1642` | CONFIRMED |
| B11 | **`ensureBootstrap`이 배치 락을 확인하지 않는다.** 배치 청크 중간(산출물 반영됨, 커밋 전)에 새 세션이 시작되면 bootstrap의 쓰기(`:95` SCHEMA 교체, `:111` 인덱스 재생성)가 트리를 dirty로 만들어 `bin/batch.mjs:828-831`의 **"무변경 + NO-OP 미선언 = 유실 의심" 백스톱을 건너뛰게 한다** → 유실된 청크가 정상 커밋되고 raw는 `_remove_candidate`로 이동, 30일 뒤 삭제. 기존 결함이지만 **`schema_version` 범프가 전 사용자에게 이 창을 정확히 1회 연다**(실측 배치 지속 3분 07초). | `lib/bootstrap.mjs`(lock 참조 0), `:95`,`:111`,`:115`; `bin/batch.mjs:828-831`, `:892-896`, `:420` | CONFIRMED |
| B12 | **`test/smoke.mjs:497`이 승격과 함께 깨진다.** `ok('root index.md preserves okf_version', rootIndex.includes('okf_version: "0.1"'))`. 리터럴만 `"0.2"`로 바꾸면 통과하는데, 그 순간 이 테스트는 *보존*이 아니라 *기본값*을 단언하게 되어 다운그레이드 금지 분기를 지키던 유일한 회귀 커버리지가 사라진다. | `test/smoke.mjs:490-497` | CONFIRMED |
| B13 | **라이브 시드 4개에 `okf_seed: true` 마커가 없다.** 현재 템플릿에는 있다 → 이 사용자의 시드는 마커 도입 이전 버전. 그래서 `bin/batch.mjs:783`의 보호가 한 번도 걸린 적이 없고, 배치가 `references/okf-system-architecture.md`에 **26 insertions**의 진짜 지식을 축적했다. 시드는 살아 있는 문서로 동작해 왔다. | 실측 `grep -c '^okf_seed:'` → 4개 전부 0; `templates/seed/ko/references/okf-format.md:5`; `bin/batch.mjs:783` | CONFIRMED |

---

## 4. 대응 스코프

### (a) 적합성/정직성을 위해 필수 — 하나라도 빠지면 릴리스하지 마라

이 8개는 **원자적이다.** 특히 P1이 빠진 채 P4만 하면 번들은 v0.2를 선언하면서 v0.1 필드만 생산하고, 외부 소비자에게는 §13.1 폴백이 MAY이므로 **시간 신호가 사라진 것처럼 보인다** — 순수 후퇴다.

| P | 작업 | 근거 | 크기 | 하위호환 | 완료 기준 |
|---|---|---|---|---|---|
| **P1** | **`generated` 코드 스탬핑.** `applyAnalyzerWorkspace`(`bin/batch.mjs:756-797`)의 `prev`/`next` 바이트 비교(:779)가 이미 변경된 비예약 .md를 정확히 식별한다. 여기서 `generated: { by: 'okf-system/<model>', at: <ISO8601 초단위 UTC> }`를 stamp. 이미 `by`가 있으면 존중. 프론트매터 없거나 파싱 실패면 그대로 통과(E1이 잡을 일). **함정**: 이 함수는 ingest 후(:821)와 repair 후(:847) **두 번** 호출되므로, 스탬핑한 바이트를 번들과 워크스페이스 **양쪽에** 써야 2차에서 전 파일이 재기록되지 않는다. | §5.2, §7 / 레퍼런스 `bundle_tools.py`가 동일 방식 / 전역 Rule 5 | M | 예(추가만) | v0.2 필드를 쓰는 신규/수정 concept에 `generated`가 붙고, 같은 청크를 repair가 돌아도 무관한 파일의 `at`이 안 바뀐다 |
| **P2** | **lint W2를 OR 검사로.** `title`/`description`은 그대로 요구, 시각 신호는 `generated.at` **또는** 레거시 `timestamp` 중 하나면 통과. **`data.generated?.at`을 그냥 쓰지 마라** — `generated`가 문자열/배열이면 `.at`이 프로토타입 메서드로 잡혀 잘못 통과한다(실측). plain-object 가드 필수. | §13.1 / B2·B3 | S | 예 | v0.2 네이티브 concept에 W2 없음, 둘 다 없는 파일엔 W2 있음 (smoke 케이스 2개 추가) |
| **P3** | **`templates/SCHEMA.md` v2 + `prompts/ingest.md`.** `schema_version: 1 → 2`(이걸 안 올리면 기존 번들에 **영원히 안 닿는다** — `lib/bootstrap.mjs:94`), 자기 프론트매터의 `timestamp` 제거, 템플릿에서 `timestamp` 제거, "`generated`·`verified`는 쓰지 마라"(전자는 드라이버가 찍고 후자는 사람만 붙인다), "`stale_after`·`sources`는 쓰지 마라"(범위 밖), "값에 `: `가 들어가면 반드시 따옴표"(B8), `ingest.md:3`의 v0.1 → v0.2. 순서 주석의 "스펙 권장 순서"는 SPEC 어디에도 없는 문구이므로 "권장 키 순서"로 격하. | §5.2/§5.3 / B3·B8 / `bootstrap.mjs:94` | M | 예 | 기존 설치에서 SessionStart 1회 후 `~/.claude/okf/SCHEMA.md`가 v2로 교체 |
| **P4** | **`okf_version` 승격.** `lib/index-gen.mjs`에 `export const OKF_VERSION = '0.2'`, `:49` 폴백을 그것으로. 그리고 `:43-45`의 보존 분기에 `v === '0.1' ? OKF_VERSION : v` — **`"0.1"`만 승격, 그 외 값(외부 도구가 쓴 `"0.3"` 등)은 절대 건드리지 않는다.** 별도 마이그레이션 코드는 0줄: P3의 `schema_version` 범프 → `bootstrap.mjs:94` 참 → `:97 seeded=true` → `:111 regenerateIndex` → 승격 → `:115 okf: bootstrap` 커밋. | §12 / `bootstrap.mjs:91-115` | S | 예(§13: minor bump, v0.1 문서는 v0.2 번들에서 유효) | 기존 설치에서 SessionStart 1회 → `~/.claude/okf/index.md`의 `okf_version`이 `"0.2"`, `okf: bootstrap (OKF v0.1 → v0.2)` 커밋 |
| **P5** | **bootstrap 락 가드 — 위치가 중요하다.** `lib/lock.mjs`의 `readLock`/`isLockStale`로 `if (!isLockStale(readLock(paths.lock))) return;`를 **SCHEMA 동기화 블록(`:91`) 앞**에 넣어라. 설계 초안은 `:113`(커밋) 앞을 지목했는데 **틀렸다** — 진짜 위험은 커밋이 아니라 `:95`/`:111`의 **쓰기**가 트리를 더럽혀 배치의 유실 백스톱을 무력화하는 것이다(B11). 마이그레이션은 멱등이라 다음 세션이 한다. | B11 / `bin/batch.mjs:828-831` | S | 예 | 락이 살아 있는 동안 SessionStart가 SCHEMA·index를 건드리지 않는다 |
| **P6** | **테스트 두 개로 분리.** `test/smoke.mjs:497`의 리터럴만 바꾸지 마라. ① `regenerateIndex` 전에 루트 index에 `okf_version: "0.3"`을 심고 **보존**을 단언(비-0.1이어야 의미가 있다), ② `"0.1"` → `"0.2"` **승격**을 단언. 그리고 `:1174`의 `'0.1.6'` → `'0.1.7'`. | B12 / 전역 Rule 9 | S | — | 두 테스트가 각각 다른 이유로 실패할 수 있다 |
| **P7** | **미지 키 round-trip 보존.** `readExistingOkfVersion`을 프론트매터 객체 전체를 반환하는 형태로 바꾸고, `buildRootIndex`가 `okf_version`만 갱신한 뒤 나머지를 원래 순서대로 재직렬화(직렬화가 부담이면 원본 프론트매터 라인 블록을 보존하고 `okf_version:` 줄만 치환). **P4와 같은 함수라 추가 비용이 거의 없다.** lint W4는 **유지하라** — §8/§12가 뒷받침하는 정당한 경고다(우리가 그 키를 만들지 않고, 남이 넣은 키를 지우지도 않는다). | §4.1 MUST NOT/SHOULD / A1 | S | 예 | 루트 index.md에 `x_tool_state`를 심고 배치 1회 → 살아 있다 |
| **P8** | **버전 문자열 정리 + 잔챙이 2건.** `bin/session-start.mjs:80`에서 **버전 표기를 제거하라**(플러그인 상수를 보간하면 `"0.3"` 보존 번들·마이그레이션 지연 사용자에서 번들 선언과 어긋난다. `session-start`는 루트 index.md를 읽지 않으므로 정직하게 만들려면 읽기가 늘고, 배너 규칙 중 이 값을 소비하는 것이 하나도 없다). 함께: `lint.mjs:161`을 `basename === 'log.md'`로(A3, 한 글자), `TYPE_TO_DIR`를 `Map`으로(B10). | A3·A4·B10 | S | 예 | 게이트 텍스트에 버전 문자열 없음, 중첩 log.md의 비ISO 헤딩이 E3b로 잡힘, `type: constructor`에 `[native code]` 안 샘 |

**주의(P8/A3)**: `isLog`를 basename 판정으로 바꾸면 중첩 log.md의 비ISO 헤딩이 **E3b 에러**가 되어 배치 롤백을 유발할 수 있다. 같은 커밋에서 SCHEMA.md의 log.md 규정이 "어느 디렉토리의 log.md든 `## YYYY-MM-DD`"를 명시하는지 확인하라.

**하지 마라 (반박에서 폐기됨)**: repair 프롬프트를 errors 전용으로 좁히는 안. 명시된 동기("repair가 v0.2를 v0.1로 되돌린다")는 **P2가 이미 없앤다**(경고 문자열 자체가 생기지 않음). 남는 건 손실뿐이다 — `formatReport`가 나르는 W1(broken link)·W3(디렉토리 불일치)는 분석기의 대표적 실수이고 `buildRepairPrompt`가 **유일한 자동 교정 경로**다. 그리고 이 회귀를 잡는 테스트가 없다(`test/smoke.mjs`에 W2 단언도 repair 프롬프트 내용 단언도 0건).

### (b) 스펙이 열어준 실제 제품 개선 — 다음 릴리스(0.1.8)

| P | 작업 | 근거 | 크기 | 하위호환 | 완료 기준 |
|---|---|---|---|---|---|
| **P9** | **게이트 파서 선행 수정.** `bin/session-start.mjs:17`의 `.filter(Boolean)` → `.filter((l) => l.startsWith('- '))`. 이 한 줄이 index.md 포맷 변경(§8 헤딩, deprecated 마커, bullet 마커)과 게이트의 결합을 통째로 끊는다. **먼저 넣어라.** | B5 / A2 결합 위험 | S | 예 | index.md에 헤딩을 넣어도 주입 개수·본문이 안 변한다 |
| **P10** | **`status: deprecated` 생산 + 소비.** SCHEMA 절대규칙 4에 `status: deprecated` 병기(산문 superseded는 유지 — 산문은 사람이 읽고 status는 생성기가 읽는다), ingest에 발동 조건 명시("대체 관계가 **이번 digest에서 확인될 때만**" — 없으면 모델이 "오래돼 보인다"로 임의 폐기한다). 소비: `extractEntry`가 `status`를 함께 읽고 `regenerateDir`이 deprecated를 목록 **맨 뒤로 정렬** + 접두 마커, 게이트는 그 줄을 round-robin에서 건너뛴다. **index.md 파일에서는 지우지 마라**(링크 보존이 deprecated의 존재 이유). | §5.4 / B4·B5 | M | 예 | 묘비 concept가 게이트에 안 실리고 index.md에는 남는다 |
| **P11** | **기존 묘비 2건 수동 태깅** (`references/kube-scheduler-*.md`). 이걸 안 하면 P10의 실측 이득(12/22 → 13/20)이 **발생하지 않는다** — 기존 22개는 배치가 그 파일을 다시 Edit하기 전까지 영구히 `stable`이다. 사용자 번들 편집이므로 승인 필요(§8-Q4). | B4 실측 | S | — | 게이트 references 슬롯이 `okf-format.md`·`okf-llm-wiki-lineage.md`로 교체 |
| **P12** | **프라이버시: inbox 사본 개명.** `buildAnalyzerWorkspace`(`bin/batch.mjs:742-747`)가 원본 basename 대신 `session-01.digest.md` 순번 이름으로 복사. **프롬프트 토큰 0으로 유출 표면이 사라진다.** 안전성 확인 완료 — 아카이브·롤백은 원본 `chunk` 경로만 쓰고(`:894-897`, `:701-713`) `applyAnalyzerWorkspace`는 `.ingest-inbox`를 건너뛴다(`:761`). **순서 제약**: 개명은 LLM이 날짜를 읽던 유일한 출처(파일명 접두)를 없애므로 P1(코드 스탬핑) 이후에만. 방어심층으로 SCHEMA에 "digest·원본 경로와 세션 ID를 번들 어디에도 적지 마라" 한 문장. | B6 | S | 예 | 프롬프트에 사용자 홈 경로가 안 실린다 |
| **P13** | **`lib/trust.mjs` 신설.** `normalizeVerified(fm)`(bare mapping → 1원소 리스트, §5.2 **MUST**), `trustTier(fm)`(`String(by).startsWith('human:')` **단일 검사** — 실전에 스펙 외 `team:<id>`가 존재하므로 접두사 화이트리스트 검증은 §11 MUST NOT reject 위반), `isStale(fm, today)`, `toIsoDate(v)`/`toIsoDateTime(v)`(B7). **`verified`를 읽는 첫 코드를 쓰기 전에** 넣어라. 헬퍼 단독으로는 동작 변화가 없어 언제 넣어도 안전하다. | §5.2·§5.3·§5.5 / B7 | S | 예 | 4케이스 테스트: bare mapping→길이 1, 리스트→그대로, `[]`→빈, null→빈 |
| **P14** | **viz 선재 버그 2건 + v0.2 신호.** 재귀 추가(`index-gen.regenerateDir`과 동형), `log.md` 제외(`:44`). 그 위에 레퍼런스와 같은 **최소** 인코딩: stale이면 점선 빨간 테두리(`:425`의 lineWidth 1.4를 조건부로 — **직후 `setLineDash([])` 리셋 필수**, 안 하면 다음 노드와 선택 하이라이트로 샌다), deprecated면 `globalAlpha`를 **곱하기** 0.55(`:423`의 선택 dim을 덮어쓰지 말 것), 상세 패널 배지 3개. **노드 fill 색(TYPE_COLORS)과 범례는 건드리지 마라** — 범례가 type 색에서 생성되므로 색을 신뢰에 뺏기면 범례가 거짓말이 된다. 그리고 `buildGraph` meta에 `staleCount`/`deprecatedCount` — 이게 비용 대비 효과가 가장 크다(두 명령의 보고문이 meta만 읽으므로 브라우저를 안 열어도 터미널에 뜬다). | B9 / 레퍼런스 `viz.js:49-61,198-219` | M | 예 | 중첩 concept가 그래프에 나타나고, deprecated 노드가 흐려진다 |
| **P15** | **`skills/okf-usage/SKILL.md` 신선도·신뢰 규약.** stale 문서를 만나면 Read를 **필수로 승격**(게이트가 Read를 조건부로 낮춘 이유가 "줄이 이미 답을 담고 있어서"인데, 낡은 문서는 그 줄을 못 믿는다), 확인 결과를 **대화에 남기게** 하라(우리 갱신 경로는 세션 쓰기가 아니라 transcript→배치다). "unverified가 정상이며 그것을 이유로 정보를 버리지 마라"를 명시. 함께 `:15-17`의 "반드시 Read하라"를 게이트 규칙 1과 일치시키고 `:43-44`의 `timestamp`를 `generated`로. **필드가 실제로 생긴 뒤에 넣어라.** | §5.3·§5.5·§11 | S | 예 | 세션 규약·배치 규정·게이트가 같은 말을 한다 |

### (c) 나중에 / 안 해도 됨

| 항목 | 판정 |
|---|---|
| `sources` 생산 | **digest 선행 필요.** `lib/digest.mjs:43`이 `tool_use`를 `[tool: WebFetch]`로 뭉개 `block.input`을 통째로 버린다 → 원재료가 없다. 강제하면 URL 환각만 나온다. 고친다면 **화이트리스트**로: WebFetch면 `input.url`, WebSearch면 `input.query`만 보존. **Read/Glob/Grep/Edit의 경로 인자는 절대 보존하지 마라**(B6를 digest 안으로 되끌어온다). 선택 필드 누락은 §11상 거부 사유가 아니므로 미루는 데 비용이 없다. |
| `stale_after` | **하지 마라.** 레퍼런스 자동 파이프라인 51개 중 0개. 유일한 실물 사례(acme_retail `2026-12-31`)는 "Finance re-issues the policy each January"라는 도메인 사실에서 사람이 정한 값이다. 카테고리 고정 TTL은 데이터로 위장한 추측이고, `generated.at`이 오래됐다고 stale이라 부르면 §11 SHOULD 위반이다. **프롬프트에 언급조차 넣지 마라** — 소개하면 모델이 채우려 든다. |
| `verified` / `/okf-review` 명령 | **다음다음.** 오늘 소비자가 없다(§5.2: 트러스트 프론트매터 없는 concept도 그대로 소비 가능). 만든다면 verify와 deprecate를 **한 명령으로** — 같은 상호작용이라 헬프 텍스트를 두 벌 유지할 이유가 없다. `human:<id>`는 **git user.email에서 읽지 마라**(`lib/git.mjs:3-7`이 고정 identity를 강제하는 원칙과 정면 충돌 + 저장소별 설정이라 값이 cwd에 따라 흔들림 + 이메일을 지식 파일에 새김). `templates/config.md`에 `user_id`를 추가하되 `lib/config.mjs`의 `DEFAULT_CONFIG`와 `VALIDATORS`를 **동시에** 고쳐야 한다 — 안 그러면 `unknown_key` 경고가 매 배치 로그에 영구히 찍힌다. |
| Attested Computation 생산/검증 | **하지 마라.** 우리 concept는 실행 가능한 계산이 아니고, §12가 receipt/verdict 와이어 포맷·attester ABI·샌드박싱을 전부 미래 리비전으로 남겨뒀다. 지금 만들면 정해지지도 않은 프로토콜을 추측으로 채우는 일이다. lint W3도 이 이유로는 손댈 필요 없다 — 우리 배치가 6종 밖 type을 생산할 경로가 없고 W3는 롤백을 만들지 않는다. |
| 시드 교체 (`okf-format.md`를 v0.2로) | **이번 릴리스에서 제외.** §7 참조. |
| 하위 index.md §8 헤딩 (A2) | **P9 이후 별건.** v0.1부터 있던 갭이고, 어떤 소비자도 이걸로 거부하지 않는다. P9가 먼저 들어가면 위험 없이 언제든 할 수 있다. |
| `usage_count` / `usage_window` | 계측 소스가 없다. 소비 시 미지 키로 무시만 하면 된다. |
| 6종 소문자 택소노미를 Title Case로 개명 | 하지 마라. `TYPE_TO_DIR`·디렉토리 매핑·게이트 주입이 전부 딸려 흔들린다. 우리 타입은 §4.1의 "descriptive and self-explanatory" SHOULD를 이미 만족한다. |
| GCS / Knowledge Catalog 연동 | 스코프 밖. 블로그의 round-trip은 카탈로그 무결성 시연이지 온보딩 경로가 아니고, 우리는 로컬 전용·push 없음이다. 목표는 "디렉토리를 복사하면 임의의 v0.2 소비자가 읽는 상태"이고 그 조건은 P1·P4·P7 셋뿐이다. |
| statusline에 stale/deprecated | `bin/statusline.mjs:10-12`가 스스로 "파일 내용은 읽지 않는다"고 규정한다. 매 턴 렌더되는 경로에 프론트매터 파싱을 넣지 마라. |
| 게이트 주입 줄에 신뢰 등급 배지 | 우리 번들은 설계상 전부 unverified라 **상수를 22번 반복 출력**하는 셈이고, 실측으로 9B 배지가 concept 1개를 축출한다(12→11). 진짜 이득은 장식이 아니라 **제거와 정렬**(0바이트)이다. |

---

## 5. 마이그레이션 결정

**한다**: 루트 `index.md`의 `okf_version` **한 값**만. `"0.1"` → `"0.2"`, 그 외 값은 보존(다운그레이드 금지). 트리거는 `schema_version: 2` 범프이며 마이그레이션 코드는 0줄이다. 커밋은 쪼개지 마라 — SCHEMA v2 교체와 선언 승격은 같은 릴리스의 한 사실이다. 다만 메시지는 갈라라(`regenerateIndex`가 `{okfVersion, promoted}`를 반환 → `okf: bootstrap (OKF v0.1 → v0.2)`). 4줄이고, 사용자가 `git log`만 보고 무슨 일이 있었는지 안다.

**안 한다**: concept 프론트매터 변환. 근거는 스펙이 아니라 우리 데이터다.

1. **`generated.by`를 채울 기록이 존재하지 않는다.** git 커밋 19개 전부 고정 identity(`OKF Batch <okf-batch@localhost>`), 배치 로그 5개 파일을 `model|sonnet|opus|haiku|claude-*`로 grep해 **0건**, `last-batch.json`은 3키, `batch-sessions.json`은 2키, 모델 문자열은 `OKF_BENCH_USAGE_FILE`이 설정된 벤치 모드에서만 기록된다(`bin/batch.mjs:637-658`). `.okf/config.md`의 `batch_model`은 **오늘의 설정**이지 이력이 아니며(`.okf/`는 .gitignore), mtime이 7/15 concept들보다 뒤다. `by`는 항목 내 REQUIRED라 "`at`만 넣기"도 불가능하다. 부재가 완전 적합하다(§11).
2. **`timestamp` → `generated.at` 기계 복사는 위조다.** 22개 중 **4개(18%)가 8~10일 틀렸다**: `patterns/multi-lang-static-analyzer-oss-testing.md`는 frontmatter 2026-07-17인데 번들 추가일이 2026-07-25(파일이 존재하기 8일 전 날짜), `references/okf-system-architecture.md`는 10일 낡음. v0.1 `timestamp`는 규정이 느슨해 이래도 위반이 아니었지만 v0.2 `generated.at`은 "content's last meaningful change"라 **명백히 틀린 값**이 된다. 느슨한 근사치를 정밀해 보이는 거짓으로 승격시키지 마라.
3. 레거시 `timestamp`는 **지우지도 갱신하지도 말고 그대로 둔다**(§13.1 폴백 대상).

**결과**: 번들은 영구히 혼합 상태로 남는다. 실측 유입 속도는 활동일 1회 배치당 concept 3~4개(2026-07-25 배치 4개, 07-17 배치 3개)이고, 다시 안 건드려지는 문서는 영원히 `timestamp`만 갖는다(10일간 재수정된 파일은 22개 중 4개). **그게 스펙이 허용하는 정상 상태다.**

**혼합 상태 내성 실측**: 레거시 2 + v0.2 네이티브 2를 섞은 번들로 소비자 5개를 전부 돌렸다. 게이트 — 완전 무관심(concept 프론트매터를 한 번도 안 읽는다). index-gen — 무관심. viz — 24노드, 예외 없음. statusline — 무관심. lint — 견디지만 시끄러움(W2, EXIT=0). **P2 하나가 유일한 필수 대응이다.**

**다운그레이드**: v0.2 필드가 든 번들을 현재 0.1.6 코드로 돌려 확인했다 — lint EXIT=0, index-gen이 `"0.2"`를 그대로 보존, 게이트 정상, viz 무예외. 되돌릴 수 없는 것은 **하나**: `bootstrap.mjs:94`의 비교가 `current < template`이라 `2 < 1`이 거짓 → **SCHEMA.md는 v2로 영구히 남는다**. 파괴적이진 않지만 이 릴리스가 남기는 유일한 편도 흔적이다. 릴리스 노트에 한 줄: "플러그인을 되돌려도 번들은 그대로 읽힌다. 단 `SCHEMA.md`는 자동으로 되돌아가지 않는다 — `git checkout <이전커밋> -- SCHEMA.md`."

**부수 사실(릴리스 노트에 명시할 것)**: `ensureBootstrap`은 kill switch 검사(`bin/session-start.mjs:127`)보다 **먼저** 호출된다(`:111`). 즉 `enabled: false`로 OKF를 끈 사용자의 번들도 이 릴리스가 SCHEMA 교체 + 전 index 재작성 + `okf: bootstrap` 커밋으로 변형한다. 주석(`:124-126`)이 대는 명분("다시 켤 때 편집할 config.md가 있어야 한다")보다 실제 동작이 넓다.

---

## 6. 버전 번호 전략

**플러그인 `0.1.7`.** `0.2.0`을 쓰지 마라.

- 사실관계: 플러그인 버전은 `.claude-plugin/plugin.json:3`의 `0.1.6` 하나이고 `test/smoke.mjs:1174`가 그 리터럴을 단언한다(릴리스마다 두 곳을 같이 고쳐야 한다). `marketplace.json`에는 버전 필드가 없다. README 8종에 **플러그인 버전 배지가 없고** OKF 스펙 배지만 있다 — 두 축이 문서상 이미 분리돼 있다.
- 관행: `git log -- .claude-plugin/plugin.json`은 0.1.0→0.1.6까지 전부 패치 범프이며, 그중에는 "유휴 기반 수집 재설계 + 분석기 워크스페이스"(102af6e), "PHP/C/C++/Swift 분석 + 벤치 하니스 + statusline"(46442db) 같은 대형 릴리스도 있다. 이번 대응은 그것들보다 작다.
- `0.2.0`을 쓰면 스펙이 v0.3을 내는 순간 (a) 플러그인을 억지로 0.3.0으로 올리거나 (b) 대응 관계가 깨져 사용자가 매번 확인해야 한다. 한 번 심으면 못 뽑는 혼동이다.

**표기 6곳** (다섯이 아니라 여섯이다 — 여섯 번째가 유일하게 산출물을 바꾼다):

| # | 위치 | 값 |
|---|---|---|
| ① | `.claude-plugin/plugin.json:3` + `test/smoke.mjs:1174` | `0.1.7` (같은 커밋) |
| ② | `README.md:5`, `README.ko.md:5` 배지 | `https://img.shields.io/badge/OKF-v0.2-4ecdc4`, alt `![OKF v0.2]`. **`Draft`를 옮기지 마라** — v0.2 스펙은 그 라벨을 버렸다(SPEC.md 3행 `**Version 0.2**`, `Draft`는 `status` 값으로만 등장). 나머지 6종 README에는 원래 배지가 없으니 새로 만들지 마라 |
| ③ | 번들 루트 `index.md`의 `okf_version: "0.2"` | 기계 판독 정본 |
| ④ | `bin/session-start.mjs:80` | **버전 표기 제거** (§4 P8 참조) |
| ⑤ | 릴리스 노트 제목 | **"okf-system 0.1.7 — OKF 스펙 v0.2 대응"** |
| ⑥ | **`prompts/ingest.md:3`** | `v0.1` → `v0.2`. 배치 산출물의 세대를 정하는 유일한 문자열 |

**"okf-system v0.2"라는 문자열은 어디에도 쓰지 마라** — 그 한 문장이 이 전략을 통째로 무너뜨린다.

---

## 7. 하지 않기로 한 것과 이유

1. **시드 교체(`seed_version` 게이트로 `okf-format.md`를 v0.2로 갱신)** — 제외. `bin/batch.mjs:783`의 조건은 `prev`(번들에 이미 있는 파일)를 보므로 `okf_seed: true` 마커가 한번 박히면 그 파일은 **분석기가 영원히 못 고친다**. 이건 보호가 아니라 영구 동결이다. 그리고 실측이 반대를 말한다 — 배치가 시드에 26줄의 진짜 지식(게이트 설계 갱신, "SessionEnd는 언제 발화하는가" 신설)을 쌓아왔다. git-pristine 판정으로 그 파일 하나를 살려도 나머지 3개가 동결되고, 하필 `okf-format.md`는 "현재 스펙을 가르치는" 것이 존재 이유라 다음 스펙 개정 때 플러그인 릴리스만이 유일한 경로가 된다. 추가 구멍 둘: untracked 시드(bootstrap의 커밋 실패를 조용히 삼키는 `:116-121` 경로로 실제 발생)에 `git log --diff-filter=A`가 빈 출력을 주므로 "git에서 복구는 된다"는 유일한 안전망이 거짓이 되고, pristine 게이트는 시드 4개 × 2 커맨드 = **8 spawn/세션**을 SessionStart 훅 경로에 상시 추가한다. **대가**: 기존 사용자의 `okf-format.md`가 계속 "v0.1 Draft"를 가르친다 — 릴리스 노트에 명시하라.
2. **repair 프롬프트를 errors 전용으로 축소** — 제외. P2가 동기를 이미 없애고, W1/W3 자동 교정이라는 유일한 경로를 죽인다. 이 회귀를 잡는 테스트가 없어 무증상으로 출시된다.
3. **lint W4(루트 index.md 여분 키) 완화** — 하지 마라. 사전 조사가 "충돌 지점"으로 분류했지만 원문은 정반대로 우리 편이다(§8: "one exception: a bundle-root `index.md` MAY carry an `okf_version`", §12: "the only place frontmatter is permitted in an `index.md`"). §11의 미지 키 거부 금지는 **concept 문서**에 대한 것이지 예약 파일이 아니다. 비루트 index.md 프론트매터를 E3a로 올리는 처리도 스펙 정합적이다.
4. **lint W3(택소노미 밖 type) 예외 집합 추가** — 하지 마라. 우리 배치가 6종 밖 type을 생산할 경로가 없고, W3는 경고일 뿐 롤백을 만들지 않는다(실측 EXIT=0). 외부 v0.2 번들 소비 기능을 실제로 붙이는 시점에 소비 경로 전용으로 검토하라.
5. **`stale_after` 자동 부여** — §4(c) 참조. 근거가 없고 §11 SHOULD 위반으로 직행한다.
6. **README 6종(de/es/fr/ja/pt-BR/zh-CN)에 배지 신규 추가, 새 명령의 8개 언어 번역** — 없던 것을 만드는 일이다. `commands/` 5개는 전부 한국어 단일 언어이니 새 번역 부채를 시작하지 마라.
7. **`docs/benchmarks/**`의 v0.1 문자열 수정** — 절대 하지 마라. `README.md:144-149`가 이것을 "모든 숫자가 근거하는 정확한 게이트 텍스트와 concept 본문"으로 인용하는 동결된 증거물이라, 수정하면 발표된 측정을 위조하는 셈이다.
8. **대외 서사 과장** — "업계 최초 v0.2 지원", "유일하게 신뢰를 추적" 류 금지. 오늘 시점에 반증 가능한 관측은 "아직 아무 도구도 v0.2 배지를 달지 않았다"뿐이고 이건 며칠이면 낡는다. 시간축·출처 추적 자체는 Zep/Graphiti가 먼저다. 방어 가능한 문장은 하나뿐: **"신뢰·신선도 신호가 파일 프론트매터에 있어, 이 플러그인 없이도 임의의 OKF v0.2 소비자가 같은 번들을 읽는다."** 제품 서사의 1문장은 계속 "세션 대화 자동 캡처 → 다음 세션 자동 주입"이어야 한다.
9. **효과 과장 금지** — P1~P8은 배포 즉시 게이트에 보이는 변화가 **0이다**. 신규/수정 concept가 쌓여야 켜지고, 기존 22개는 배치가 그 파일을 다시 Edit할 때만 v0.2화된다. 릴리스 노트에 명시하지 않으면 "고쳤는데 아무것도 안 달라진다"는 오해가 생긴다.

---

## 8. 사용자 결정이 필요한 열린 질문

**Q1. 이번 릴리스에 `generated` 스탬퍼(P1)를 넣을 것인가?**
- (a) 넣는다 → P1~P8 전부 진행, `okf_version` 승격.
- (b) 안 넣는다 → **승격도 빼라.** P2·P5·P7·P8만 하고 번들은 v0.1로 남긴다(§12상 완전 적합).
- **추천: (a).** (b)도 정직한 선택이지만, 승격만 하고 생산을 안 하는 조합은 **후퇴**다(§13.1 폴백이 MAY). 둘 중 하나만 하는 것이 최악이다.

**Q2. `generated.by`의 actor 문자열은?**
- (a) `okf-system/<실제 모델>` — 레퍼런스와 동형(`reference_agent/gemini-2.5-pro`에서 `<version>` 슬롯은 명백히 모델). 단 `config.batch_model`은 비어 있을 수 있으므로(`lib/config.mjs:14`, "비우면 CLI 기본 모델") `runClaude`가 파싱한 `result.modelUsage` 키를 반환값에 실어 내보내야 정확해진다.
- (b) `okf-system/0.1.7` — 플러그인 버전. 재현성이 높지만 "무엇이 이 지식을 만들었나"에 답하지 않는다.
- **추천: (a), 폴백 `okf-system/unknown`.** 두 선행 조사가 여기서 충돌했고(Rule 7), 레퍼런스 관행이 결정적이다.

**Q3. 시드 교체를 할 것인가?**
- (a) 제외(추천) — 기존 사용자의 `okf-format.md`가 "v0.1 Draft"를 계속 가르친다. 릴리스 노트에 명시.
- (b) git-pristine 게이트로 진행 — untracked 처리, 8 spawn/세션 비용, `okf_seed` 마커가 만드는 영구 동결에 먼저 답해야 한다.
- **추천: (a).** §7-1 참조.

**Q4. 기존 묘비 2건(`references/kube-scheduler-*.md`)에 `status: deprecated`를 손으로 붙일 것인가?**
- 사용자 번들 파일 편집이라 승인 필요. 안 붙이면 P10의 실측 이득(게이트 12/22 → 13/20, references 슬롯이 잡음에서 실제 문서로 교체)이 **발생하지 않는다**.
- **추천: 붙인다.** P10과 같은 릴리스에서. 대안으로 ingest에 "본문 첫 헤딩이 `# 리다이렉트`면 `status: deprecated`" 규칙을 넣을 수도 있으나, 2건에 규칙을 만드는 건 과하다.

**Q5. 프라이버시 작업(P12 inbox 개명)을 v0.2 릴리스에 묶을 것인가, 별도로 낼 것인가?**
- 이미 실현된 유출이고(B6) v0.2와 무관하다. 묶으면 릴리스가 커지고, 분리하면 노출이 더 지속된다.
- **추천: 0.1.8에 P9·P10과 함께.** P1이 선행돼야 안전하다(날짜 출처 제거 문제).

**Q6. 라이브 번들에 이미 커밋된 절대 경로(`resource: /Users/ducksu/.claude/jobs/...`)를 어떻게 할 것인가?**
- (a) 그대로 둔다 — 로컬 전용이고 push 경로가 없다.
- (b) 손으로 지운다 — git 이력에는 남는다.
- (c) 번들 히스토리 재작성.
- **추천: (a) + P12로 재발 차단.** README가 백업을 권하므로(`:325`) 사용자가 번들을 옮길 계획이 있다면 (b).

---

## 9. 이 조사의 한계

**확인 불가**
- **제3자 v0.2 반응은 관측 0건** — 발표 당일이다. 검색 4회가 전부 v0.1(2026-06-12) 시기 자료를 반환했고, 업스트림 자신도 어제(2026-07-24T16:45:07Z, PR #227) 마이그레이션했다. 경쟁 플러그인 3종(serradura/okf-gem 96★, scaccogatto/okf-skills 87★, theesfeld/claude-okf 1★)은 전부 v0.1 배지다. **"아무도 아직 대응 안 했다"는 내부 우선순위 근거일 뿐 대외 주장거리가 아니다.**
- **외부 validator 통과 여부 미검증** — scaccogatto의 conformance checker나 witscode 컨포먼스 스위트를 실행하지 않았다. **우리 lint 통과는 우리 규칙 통과일 뿐 스펙 통과의 증거가 아니다.** v0.2 작업 완료 기준에 수동 1회 확인을 넣어라.
- **토큰 추정치는 문자 클래스 근사** — 실제 토크나이저 실측이 아니다(±20%). 프롬프트 추가분 ingest +411 / SCHEMA +120은 이 오차 안에서 읽어라. 다만 결론(청크 입력의 0.5% 미만, 진짜 제약은 토큰이 아니라 지시 희석)은 오차에 영향받지 않는다.
- **`templates/SCHEMA.md`의 `type: schema`가 W3를 유발하는지** — 라이브 번들 lint 실행으로 **발화 확인**(`SCHEMA.md: W3: type "schema" is outside the known taxonomy`, EXIT=0). 선행 조사가 "확인 불가"로 남겼던 항목이며, v0.2와 무관한 기존 잡음이다.
- **유료 벤치마크 미실행**(지시에 따라). 게이트 주입 품질 변화의 정량 검증은 없다.
- **7/15 시점 concept를 어떤 모델이 썼는지는 원리적으로 복원 불가**(§5 근거).

**반박되어 폐기된 주장** (전부 이전 라운드의 내 조사 결과다)
- ~~`usage_window`는 `sources` 항목 필드~~ → 아니다. **`sources`의 형제 최상위 키**다(§5.1: "Written once as a sibling of `sources`"). 항목별 override만 예외.
- ~~`# Citations` 대체는 `sources` 프론트매터 단독~~ → 아니다. `sources[].id`를 라벨로 쓰는 **마크다운 각주** 규약이 함께 온다(§4.2, §5.1). 위치 인덱스를 금하는 이유까지 명시돼 있다.
- ~~lint W4는 v0.2 충돌 지점~~ → 아니다. §8/§12가 명시적으로 뒷받침한다. **유지가 맞다.**
- ~~`Attested Computation`이 W3에 걸려 문제~~ → 그 타입을 우리 번들에 쓸 주체가 없다. 무해.
- ~~`index-gen.mjs:49` 폴백만 바꾸면 된다~~ → 기존 값 보존 로직 때문에 라이브 번들이 영원히 0.1로 남는다. **승격 분기가 필요하다.**
- ~~락 가드를 `bootstrap.mjs:113` 앞에~~ → **`:91` 앞이어야 한다.** 위험은 커밋이 아니라 쓰기다.
- ~~repair 프롬프트를 errors 전용으로 축소~~ → P2가 동기를 없애고 W1/W3 자동 교정을 죽인다. **폐기.**
- ~~시드에 `seed_version` 게이트 도입~~ → `okf_seed` 마커가 영구 동결을 만들고 실측이 시드가 살아 있는 문서임을 보여준다. **폐기.**
- ~~`test/smoke.mjs:497`의 리터럴을 `"0.2"`로 바꾸면 된다~~ → 그 순간 회귀 커버리지가 사라진다. **두 테스트로 분리.**
- ~~README 8종에 v0.1 배지~~ → **2종뿐**(`README.md:5`, `README.ko.md:5`). 나머지 6종은 배지 행 자체가 없고 `docs/USAGE.md`에는 버전 문자열이 0회다.
- ~~README에 "Portability" 절~~ → **없다**. 그 원칙은 `lib/git.mjs:3-7`의 고정 git identity에 코드로만 존재한다(그리고 그것이 `human:<id>`를 git에서 읽으면 안 되는 근거다).
- ~~`lib/status.mjs`가 상태를 집계한다~~ → 5행짜리 파일이고 내용은 `safeErrorCode()` 하나다. 집계는 `commands/okf-status.md`의 프롬프트와 `bin/statusline.mjs:14-31`에 흩어져 있다.
- ~~게이트 헤더에 `OKF_VERSION` 상수를 보간~~ → 번들 실제 선언과 갈라진다. **제거가 맞다.**
- ~~"v0.1 형식은 폴백으로 계속 지원된다"(보장처럼 읽음)~~ → **MAY다.** 이 오독이 마이그레이션 판단 전체를 뒤집었다.

**신뢰도가 낮은 항목**
- P1의 이중 호출 함정(ingest 후 + repair 후)은 코드 읽기로 도출했고 실행 검증하지 않았다. 구현 시 repair가 실제로 도는 케이스로 반드시 확인하라.
- B11의 유실 시나리오는 코드 경로 추적이고 실제 재현은 하지 않았다(배치 실행이 필요). 다만 각 링크(`isDirty` 우회 → lint 통과 → 커밋 → raw 이동 → 30일 TTL 삭제)는 개별적으로 코드에서 확인했다.
- 게이트 예산 실측(12/22)은 오늘 라이브 번들 기준이다. head/tail 크기(특히 log.md 최신 섹션 1,358B)에 민감해서 번들이 바뀌면 숫자도 바뀐다. 배지·헤딩을 추가하는 어떤 변경이든 릴리스 전에 **재측정**하라.