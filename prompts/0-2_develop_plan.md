# okf-system 개발 계획 — OKF 스펙 v0.2 준수 + 보완·개선

작성일 2026-07-25 · 브랜치 `feature/okf-v0.2-conformance` · 기준 커밋 `e3460b1`(origin/main) · 배포 버전 0.1.6
기준선 실측: `node test/smoke.mjs` → **303 passed, 0 failed** (macOS arm64)

이 문서는 구현자가 이것만 보고 작업할 수 있도록 쓰였다. 모든 구현 방법에 `파일:라인`과 실제 코드
형태가 붙어 있고, 모든 통과 규칙은 수치다.

---

## 이 계획을 만든 근거

같은 날 완료된 조사 3종이 `main`에 머지돼 있다(PR #15). 이 계획의 모든 사실 근거는 그 문서들에 있다.

- [`docs/okf-v0.2-2026-07-25-summary.md`](../docs/okf-v0.2-2026-07-25-summary.md) — 종합, 두 조사의 충돌과 해소
- [`docs/okf-v0.2-2026-07-25-spec-conformance.md`](../docs/okf-v0.2-2026-07-25-spec-conformance.md) — 스펙 델타(§2), 깨지는 지점(§3), 대응 스코프(§4)
- [`docs/okf-v0.2-2026-07-25-reliability.md`](../docs/okf-v0.2-2026-07-25-reliability.md) — 주제별 사실(§4 T1~T11), 권고 스코프(§5)

계기: Google Cloud가 2026-07-24 OKF 스펙을 **v0.2**로 올렸다(knowledge-catalog 커밋 `780fe9d`,
PR #227), [2026-07-25 발표](https://cloud.google.com/blog/products/data-analytics/okf-v0-2-adds-trust-signals?hl=en).
추가된 것은 전부 선택 필드이며 **v0.1 번들은 그대로 유효하다** — 긴급 장애가 아니다.

## 확정된 결정 (재논의 대상 아님)

1. **조사 결과를 모두 반영한다.**
2. **`schema_version`을 올리고 스펙 v0.2에 맞춘다.** `okf_version` 승격도 한다. 기존 사용자의
   `SCHEMA.md` 로컬 편집이 템플릿으로 덮이는 것을 감수한다 — 릴리스 노트에 명시해야 한다.
3. **`batch_max_usd_per_day` 기본값은 0(무제한).** 상한 기능 자체는 만들되 기본 차단은 걸지 않는다.
   **신뢰성이 최우선**이므로 비용 *가시화*는 필수다.

### 지켜야 할 제약 하나

SPEC §13.1의 `timestamp` 폴백은 **MUST가 아니라 MAY**다("Consumers MAY fall back to a legacy
`timestamp` when `generated` is absent"). `okf_version`을 `"0.2"`로 올리면서 `generated`를
생산하지 않으면, 폴백을 구현하지 않은 소비자에게 우리 concept는 시간 신호가 아예 없는 문서가
된다 — 순수 후퇴다. **선언(S2)·생산(S1)·규칙서(S5)는 같은 릴리스다. 셋 중 하나라도 빠지면
릴리스하지 않는다.**

### 하지 않기로 결론난 것 (구현 중 되살리지 마라)

`stale_after` 자동 부여 / 배치가 자기 산출물에 `verified` 찍기 / `sources` 강제 / 기존 concept
프론트매터 일괄 변환 / Attested Computation 생산 / 이미 반증된 벤치마크 축 재탕.
각 항목의 근거는 Part 1 §1.0에 있다.

## 문서 구성

| 파트 | 내용 |
|---|---|
| **Part 0** | 실행 순서·의존성 그래프·릴리스 분할·게이트·전체 통과 규칙 — **먼저 읽어라** |
| **Part 1** | OKF v0.2 스펙 준수 개발 계획. 릴리스 1(`0.2.0` 신뢰성) → 릴리스 2(`0.2.1` 스펙 대응) |
| **Part 2** | 보완·개선 계획. 목표는 토큰 효율성·정확도·탐색 속도. 릴리스 3(`0.3.0`) |

릴리스 순서가 신뢰성 → 스펙인 것은 결정 3(신뢰성 최우선)을 따른 것이다. 스펙 작업 중 셋
(lint의 `timestamp` 강제 제거, bootstrap 락 가드, 루트 index 미지 키 보존)은 스펙 채택이 아니라
결함 수정이라 릴리스 1로 당겨져 있다.

Part 2의 판정 기준은 OKF의 의의다 — **코드와 문서에 내포되어 있지 않은** 의사결정·히스토리·
도메인지식·정책·엣지케이스·실수와 해결방법. 이것은 취향이 아니라 측정된 사실이다: v3
벤치마크에서 OKF는 grep 한 번으로 답이 나오는 질문에서 zero-base 대비 **1.2~1.7배 비싼 순수
오버헤드**였고, "코드에 존재하지 않는 팀 정책"에서만 압도했다(11/15 vs 0/15, Fisher p=5e-5).

## 이 계획이 만들어진 방법

서브에이전트 32개의 다단 워크플로우: 구현 앵커 정찰 6개(배치 파이프라인 / 캡처·설정·락 /
게이트·인덱스·부트스트랩 / 린트·프론트매터·digest / 테스트 하네스 / 프롬프트·템플릿 계약)
→ 작업패키지 17개 설계 → **그룹별 적대적 검토 6개**(실제 코드를 열어 "이 구현 방법이 그 라인에서
작동하는가"를 반박) → 의존성·릴리스 게이트 → 파트별 집필.

검토 결과 **BROKEN 0건, NEEDS_FIX 17건**(모든 작업패키지가 최소 한 건씩 정정을 받았다).
정정은 본문에 녹여져 있다. 검토가 바꾼 대표적인 것:

- **R0 신설** — 락 경합·live-shape 픽스처·lint 코드 레지스트리를 다른 모든 작업의 선행으로 분리.
  lint 규칙 코드가 작업패키지들 사이에서 **5건 충돌**했다(같은 `W5`를 서로 다른 용도로 요구).
- **S3 분할** — `S3a`(릴리스 1, 어휘 수정)와 `S3b`(릴리스 2, 중첩 `log.md` 사각지대). 후자는
  고치는 순간 기존 비ISO 헤딩이 E3b 에러가 되어 청크 롤백을 유발할 수 있어 규칙서 선행이 필요하다.
- **I1 + I4 → I-M 병합** — 둘 다 `prompts/ingest.md`의 같은 절을 고치라고 지시해 충돌했다.
- **I2 기본 OFF** — 관련성 라우팅은 구현하되 기본 활성화는 I6의 recall@cap 측정 통과 조건부.
  이 프로젝트는 근거 없는 튜닝을 발행했다가 **두 번 철회한 이력**이 있다.

## 주의

이 문서는 `prompts/`에 있다. 이 디렉토리는 플러그인 패키지에 실려 **사용자에게 배포된다**
(현재 `ingest.md`/`repair.md`는 배치 LLM이 읽는 프롬프트다). 개발 계획서가 함께 배포되는 것이
의도와 다르면 `docs/`로 옮겨라.

---

## Part 0 — 실행 순서·릴리스 게이트·통과 규칙

기준선 실측(이 워크트리, 2026-07-25): `node test/smoke.mjs` → **303 passed, 0 failed** · `DEFAULT_CONFIG` **15키** · lint 규칙 코드 사용 중 **E1/E2/E3a/E3b/W1/W2/W3/W4** (W5·W6은 미사용) · `plugin.json` **0.1.6** · `lib/trust.mjs` **없음** · `lib/lock.mjs` 28줄(판정만).

---

### 1. 의존성 그래프

#### 1.1 실제 그래프 (선언된 `선행`이 아니라 코드 결합 기준)

```
[R0] 선행 테스트 하네스 ─────────────────┐
  runBatchDetached(동시 락 경합)          │
  live-shape 픽스처(줄 바이트만)          │
  lint 규칙코드 레지스트리                │
       │                                  │
       ├──► [R3] 락 재설계 · NO-OP 마커 · 커밋후 실패 방어
       │        │  (lib/lock.mjs 계약 소유)
       │        │  (updateLastBatch/processChunkBody/processChunks 시그니처 소유)
       │        │  (applyAnalyzerWorkspace 반환 {applied,blocked} 소유)
       │        ├──► [R2] 비용 가시화 · 일일 상한   (extra{} 로 필드 추가)
       │        │        └─ runClaude 반환 {ok,output,costUsd,usage,numTurns} 정의
       │        └──► [S4] /okf:okf-deprecate      (acquireLock/releaseLock 소비)
       │
       └──► [R5] 게이트 예산 회귀 수정 (마커 선차감 + continue)
                │
                └──► 게이트 바이트를 쓰는 모든 후속: S5(head −11B), I5(head +125B), I3, I2

[R1] 캡처 경계        — 독립 (lib/glob.mjs, lib/paths.mjs, sweep cutoff)
[R4] 조용한 손실      — 독립 (lib/digest.mjs, generateDigests, analyze.mjs)  ⚠ lint W5/W6 코드 경합

[S3a] lint v0.2 어휘 + lib/trust.mjs 신설
        │  (trust.mjs 단일 소유. W2 OR 검사 = timestamp 강요 중단)
        ├──► [S1] generated 코드 스탬핑  ─┐
        ├──► [S2] okf_version 승격 · 루트 미지키 보존 · bootstrap 락 가드  ─┤ §13.1 원자
        ├──► [S5] SCHEMA v2 · ingest v0.2 · 버전 문자열 정리 · schema_version 1→2 ─┘
        ├──► [S3b] 중첩 log.md W6   (S5의 SCHEMA 규칙 3 문구가 선행)
        ├──► [S4] status 판정자 소비
        └──► [S6] viz 신뢰 신호

[I6] 측정 설계 (lib/gate.mjs 추출 + recall@cap 하네스)
        ├──► [I-M] I1+I4 병합 (배제 규칙 + 팽창 억제 + lint 백스톱)
        ├──► [I3] 게이트 고정비 (tail 바이트 캡 · 예산) — step4는 I6 승인 대기
        ├──► [I5] 세션 소비 규약 정본 (게이트 head 텍스트 단일 소유)
        └──► [I2] 관련성 라우팅 (기본 off, 기본값 전환은 I6 조건 A/B/C)
```

#### 1.2 순환 8건과 끊는 법

| # | 순환 | 원인 | 끊는 법 (단일 소유자 지정) |
|---|---|---|---|
| C1 | **I2 ↔ I3** | 둘 다 `buildInjectedIndex`를 전면 재작성. I3은 `c.lines`→`c.items` 구조 변경, I2는 `c.lines` 정렬 | **I3이 함수 소유.** I2는 `rankCategories(cats, signals)`가 I3의 `c.items`(`{lead,desc}`)를 정렬하는 훅으로 축소. I2 → I3 단방향 |
| C2 | **I1 ↔ I4** | 같은 규칙(반복 관측 카운터)을 각자 프롬프트에 넣고, lint 코드가 **정확히 뒤바뀜**(I1: W5=바이트/W6=반복, I4: W5=반복/W6=바이트) | **병합.** 단일 WP `I-M`. 규칙 코드는 §1.3 레지스트리로 고정 |
| C3 | **R2 ↔ R3** | `updateLastBatch`·`processChunkBody`·`processChunks` 시그니처가 서로 비호환. R2는 `depends_on: S1`(방향 오류), R3는 `선행 없음` | **R3이 시그니처 소유**(`updateLastBatch(home, result, extra={})`, `processChunkBody → {ok,fatal}`). R2는 `extra`로만 얹는다. R2의 `depends_on: S1`은 **삭제** — R2가 `runClaude` 기본 반환을 정의하고 S1이 `model` 필드만 additive로 더한다 |
| C4 | **S2 ↔ S5** | `templates/SCHEMA.md:3` `schema_version 1→2`를 둘 다 지시. S4도 조건부로 지시 | **S5가 SCHEMA.md 단일 소유.** S2 step 6 삭제. S4의 status 규정·R4의 인용 규칙은 S5의 **같은 커밋**에 문구만 기여. 릴리스당 범프 정확히 1회 |
| C5 | **S3 ↔ S4 ↔ S6** | `status` 판정자 3중(`lib/frontmatter.mjs`의 `isDeprecated` / `lib/trust.mjs`의 `conceptStatus` / lint 지역 상수) | **`lib/trust.mjs` 단일 소유.** S3a가 파일 생성(`isPlainObject`/`toIsoDate`/`toIsoDateTime`/`generatedAt`), S4가 `conceptStatus` 추가, S6이 `normalizeVerified`/`isStale` 추가. `lib/frontmatter.mjs`에는 **쓰기 전용** `setFrontmatterStatus`만 |
| C6 | **I5 ↔ I6** | 게이트 조립 추출 대상 파일명이 다름(`lib/gate-index.mjs` vs `lib/gate.mjs`) | **I6이 `lib/gate.mjs`로 1회 추출**(순수 이동). I3/I5/I2는 그 위에서만 편집 |
| C7 | **I3 ↔ I5** | 둘 다 게이트 head 문자열을 재작성(I3: 686→456B 압축, I5: 686→811B 규칙 4 추가) | **I5가 head 텍스트 소유**(`GATE_RULES` 정본). I3의 head 압축은 I5로 이관 → 최종 head는 압축 + 규칙 4 |
| C8 | **R3 ↔ R0** | reliability §5 항목 6이 "동시 프로세스 경합 테스트가 항목 11(락)보다 **먼저**"를 명시 | **R0으로 분리**해 R3 앞에 둔다. 순환 아님 |

#### 1.3 lint 규칙 코드 레지스트리 (충돌 5건 해소 — R0 산출물)

현재 W5·W6은 비어 있는데 **5개 WP가 각기 다른 의미로 선점**한다. 코드가 겹치면 `summarizeLintForLog`의 집계와 repair 프롬프트 필터가 동시에 거짓이 된다. 릴리스 전에 아래를 `lib/lint.mjs` 상단 주석으로 못 박는다.

| 코드 | 의미 | 소유 WP | 릴리스 |
|---|---|---|---|
| `W5` | frontmatter 값이 무따옴표 ` #`에서 잘림 | R4 | 1 |
| `W6` | description > 500자 | R4 | 1 |
| `W7` | 미지 `status` 값 | S3a | 1 |
| `W8` | 중첩 `log.md` 비ISO/내림차순 위반 | S3b | 2 |
| `W9` | concept 본문 바이트 상한 초과 | I-M | 3 |
| `W10` | 반복 섹션 제목 ≥3 | I-M | 3 |

전부 **W(경고)**다. E로 올리는 순간 `handleDirtyWorkingTree`(`bin/batch.mjs:398-417`)가 기존 사용자 번들의 모든 ingest를 영구 정지시킨다.

부수 필수: `buildRepairPrompt`가 **W6/W9/W10을 필터링**해야 한다(분할·요약 지시인데 `prompts/repair.md`는 새 파일 금지 → 모델이 파일을 임의로 자른다). W1/W3는 그대로 싣는다(유일한 자동 교정 경로).

---

### 2. 릴리스 분할

3개. **플러그인 버전과 스펙 버전은 다른 축이고, `okf-system v0.2`라는 문자열은 어디에도 쓰지 않는다**(grep 테스트로 강제).

#### 릴리스 1 — `0.2.0` "신뢰성"
> 릴리스 제목: **okf-system 0.2.0 — 신뢰성**. minor인 이유: `sweep_backfill_days` 기본 0이 수집 기본 동작을 바꾼다. 스펙과 무관.

| WP | 내용 | 크기 |
|---|---|---|
| **R0** | 동시 프로세스 락 경합 테스트(`runBatchDetached`), live-shape 동결 픽스처(줄 바이트만·텍스트 0), lint 규칙 코드 레지스트리 | S |
| **R5** | 게이트 예산 회귀 수정 (마커 선차감 + `lines=0;break;`→`continue`) | S |
| **R3** | 락 계약 재설계 · NO-OP 마커 프로토콜 · 커밋 이후 실패 방어 · `blocked` 표면화 | L |
| **R2** | 비용 가시화 · `batch_max_usd_per_day`(기본 **0=무제한**) | M |
| **R1** | 캡처 경계 (설치 하한 · glob 제외 루트 · 내장 제외) | L |
| **R4** | 조용한 손실 계량 (YAML 절단 W5 · description W6 · digest 줄단위 스킵 · no-extractor) | L |
| **S3a** | `lib/trust.mjs` 신설 + lint W2 OR 검사 + `TYPE_TO_DIR`→`Map` + status W7 | M |

**S3a가 여기 있는 이유**: 종합 §2가 "`lint.mjs:130`의 `timestamp` 강제 제거는 스펙 채택이 아니라 **결함 수정**이며 신뢰성 릴리스로 넘어가야 한다"고 판정했다. 이 경고가 `formatReport` → `{{LINT_REPORT}}`를 타고 repair로 새어 폐기 필드를 되살린다(B3).

#### 릴리스 2 — `0.2.1` "OKF 스펙 v0.2 대응"
> §13.1 원자성: **선언(S2)·생산(S1)·규칙서(S5)는 한 릴리스**. 셋 중 하나라도 빠지면 릴리스하지 않는다.

| WP | 내용 | 크기 |
|---|---|---|
| **S1** | `generated: {by, at}` 코드 스탬핑 + `runClaude`에 `model` 추가 | M |
| **S2** | `okf_version` "0.1"→"0.2" 승격 · 루트 index 미지 키 보존 · bootstrap 락 가드 (**step 6 schema 범프 삭제**) | M |
| **S5** | SCHEMA.md v2 본문 + `schema_version: 1→2`(릴리스 유일 범프) + `ingest.md:3` v0.2 + 버전 문자열 정리 | M |
| **S3b** | 중첩 `log.md` W8 (S5의 SCHEMA 규칙 3 문구와 **같은 커밋**) | S |
| **S4** | `status: deprecated` 생산·소비 + `/okf:okf-deprecate` + 게이트 파서 P9 | L |

SCHEMA v2 본문 = S5 골격 + S4의 status 규정 + R4의 인용 규칙. **범프는 정확히 1회.**

#### 릴리스 3 — `0.3.0` "Part 2 — 측정 후 개선"
> I6이 먼저 발행되지 않으면 나머지는 착수 금지.

| WP | 내용 | 게이트 |
|---|---|---|
| **I6** | `lib/gate.mjs` 추출 + recall@cap 하네스 + 사전등록서 | 없음 (선행) |
| **I5** | 세션 소비 규약 정본(`GATE_RULES`) + head 압축 흡수 | I6 |
| **I3** | tail 바이트 캡 + 예산 (step 1·2·5만) | I6 |
| **I-M** | I1+I4 병합: 배제 4문항 · 카테고리 조건 · 반복 관측 카운터 · lint W9/W10 · `lib/bloat.mjs` · SCHEMA v3 | I6 + P-A/P-B/P-C |
| **I2** | 관련성 라우팅, `inject_routing: false` | 기본값 전환만 I6 조건 |
| **I3-step4** | 2층 설명 배급 | **I6 조건 미충족 시 미착수** |
| **S6** | viz 신뢰 신호 + 선재 버그 2건 | 없음 (독립) |

#### 표기 전략 (릴리스 전체 공통, grep으로 강제)

| 축 | 값 | 위치 |
|---|---|---|
| 플러그인 버전 | `0.2.0` / `0.2.1` / `0.3.0` | `.claude-plugin/plugin.json:3` + `test/smoke.mjs:1174` (**항상 같은 커밋**) |
| OKF 스펙 버전 (기계 판독 정본) | `okf_version: "0.2"` | 번들 루트 `index.md` — 릴리스 2 |
| 산출물 세대 | `OKF v0.2 번들의 지식 사서다` | `prompts/ingest.md:3` — 릴리스 2 |
| 배지 | `badge/OKF-v0.2-4ecdc4` | `README.md:5`, `README.ko.md:5` **2종만** (나머지 6종에 신설 금지) |
| 게이트 head | **버전 표기 제거** | `bin/session-start.mjs` — 릴리스 2 |
| 금지 문자열 | `okf-system v0.2`, `okf-system 0.2 (스펙 의미로)` | 전 저장소 grep 0 |

버전 승격은 **릴리스 통합 커밋 1개**가 `plugin.json`과 `smoke:1174`를 동시에 올린다. 개별 WP는 두 줄 중 어느 것도 건드리지 않는다(현재 R1·R2·S2·S5·I6이 각자 올리라고 지시 → 전부 삭제).

---

### 3. 각 릴리스의 게이트 (수치)

#### 릴리스 1 → 릴리스 2

| # | 조건 | 값 |
|---|---|---|
| G1-1 | `node test/smoke.mjs` | **0 failed**, exit 0, ubuntu/macos/windows × Node 20 3매트릭스 전부. 통과 수는 머지 직전 기준선 + 각 WP 신규 `ok()` 합계와 **정확히** 일치 (PR 본문에 실행 출력 첨부) |
| G1-2 | 설정 키 동기화 | `Object.keys(DEFAULT_CONFIG).length === Object.keys(VALIDATORS).length === 17`, config-invalid 픽스처에 실패값 17개, `warnings.length >= 17` |
| G1-3 | 게이트 절단 | live-shape 픽스처에서 `inject_max_bytes` **2,684~9,000B 전 구간(1B 간격)** `truncateUtf8Bytes` 절단 **0B**, `capLines` 절단 **0줄**. 주입 concept 수 **≥ 13** (현행 12) |
| G1-4 | 캡처 경계 | 설치 이전 mtime transcript 20개 → `raw` 복사 **0**, fake-claude argv 덤프 파일 **미생성**(유료 호출 0). `sweep_backfill_days=7`에서 **20/20** 수집. 루트 커밋 3일 전 번들에서 4일 전 세션 수집 **1/1**(7일 창 불변) |
| G1-5 | glob 정확도 | `matchGlob('/Users/x/secret', ['/Users/x/secret/**']) === true`, 하위 true, 형제 접두 `secretive` false, 기존 4패턴 회귀 0 |
| G1-6 | 락 경합 | 동시 배치 2개 → archive 세션 정확히 **1**, 유료 호출 **≤2**, 종료 후 `git status --porcelain` **0바이트**, 락 파일 **잔존 0** |
| G1-7 | 비용 기록률 | success / blocked(롤백) / maxturns(INCOMPLETE) **3경로 전부** `costUsd === 0.001`, `llmCalls === 1`. 상한 0.0005 픽스처에서 2회차 claude 실행 **0회**, `raw` 세션 손실 **0** |
| G1-8 | digest 유출 차단 | 3줄 중 1줄 파손 픽스처에서 정상 턴 **2/2** 보존, 자격증명 문자열 **0회**, `skippedLines === 1`. 전 줄 파손 → digest **0바이트**(원문 폴백 0) |
| G1-9 | 기존 사용자 잡음 | 라이브 번들에 대해 변경 전/후 `node lib/lint.mjs` stdout **diff 0바이트**(번들 복사 금지 — `git worktree`로 코드만 두 벌). 실행 전후 `git -C <번들> status --porcelain` **0바이트** |
| G1-10 | 프라이버시 | 신규 로그 줄 전량에 세션 UUID·전체 경로·cwd·remote 문자열 **0건**. 기존 redaction 단언 3종 전부 통과 |

#### 릴리스 2 → 릴리스 3

| # | 조건 | 값 |
|---|---|---|
| G2-1 | §13.1 원자성 | S1·S2·S5가 **같은 릴리스 브랜치**에 있고, `okf_version: "0.2"`인 번들에서 `generated`를 가진 concept가 배치 1회 후 **≥1**. 하나라도 빠지면 릴리스 중단 |
| G2-2 | 스탬핑 정확도 | `FAKE_CLAUDE_MODE=success` 1회 후 `generated:` 보유 파일 **정확히 1**, `log.md`/`SCHEMA.md`/모든 `index.md`/모든 `okf_seed` 시드에서 **0회**. 파일당 블록 출현 **1회**. `typeof data.generated.at === 'string'` **100%**(Date 객체 0건) |
| G2-3 | 위조 차단 | 분석기가 신규 파일에 `by: human:...`을 써도 코드 스탬프가 **덮는다**(`trustExisting`은 `prev !== null` 기준) |
| G2-4 | 승격/보존 | `"0.1"`→`"0.2"` 1/1. `"0.2"`/`"0.3"`/`"1.0"`/무따옴표 `0.3` 4종에 `regenerateIndex` 3회 → 값 변경 **0/4**. 미지 키 3개 잔존 **3/3**, 2·3회차 산출 바이트 차 **0** |
| G2-5 | schema 전파 | `schema_version: 1` 번들에 SessionStart 1회 → `schema_version: 2`, `{{` **0회**, `okf: bootstrap` 커밋 **1건**. 범프는 저장소 전체에서 **1회** |
| G2-6 | 락 가드 | 살아있는 락에서 `ensureBootstrap` 5회 → SCHEMA 바이트 변화 0, index 바이트 변화 0, `git status --porcelain` 0바이트, 커밋 증가 0. **빈 홈 + 살아있는 락**에서도 dirty 0 |
| G2-7 | 버전 문자열 | `grep -rn "v0\.1" bin lib prompts templates commands skills test .claude-plugin` → **정확히 4줄, 전부 `templates/seed/{en,ko}/references/okf-format.md`**. `grep -rn "okf-system v0\.2"` → **0**. `grep -rn "stale_after" prompts templates skills commands` → **0** |
| G2-8 | 게이트 무손실 | 릴리스 1 대비 주입 concept 수 **감소 0**, 절단 **0B** 유지 (head −11B는 이득) |
| G2-9 | 은퇴 | `/okf:okf-deprecate` 후 커밋 증가 **정확히 1**, `git status --porcelain` **0바이트**, `runLint().errors.length === 0`, 2회차 커밋 증가 **0**. 살아있는 락에서 exit **2** + 파일 바이트 변화 **0**. stale-lock 배치 1회 후 `status: deprecated` 유지율 **100%**. 청크당 은퇴 상한 초과 시 반영 **정확히 3건** |
| G2-10 | 다운그레이드 | 승격된 번들을 0.2.0 코드로 → lint EXIT **0**, index-gen 보존, 게이트 정상, viz 무예외 |

#### 릴리스 3 진입 게이트 (I6 단독)

| # | 조건 | 값 |
|---|---|---|
| G3-0a | 캘리브레이션 | live-shape로 합성한 번들에서 `taken 12/22`, 조립 **9,218B**, 절단 **218B**, 잔여 **58B** 5개 값 전부 오차 0. 불일치 시 **R5 발화 → 전 결과 무효** |
| G3-0b | 예산 동형 | 하니스의 `stats.headBytes`/`tailBytes`가 live-shape 값과 일치(`ensureBootstrap`의 `# Log\n`은 tail **54B**를 만든다 — 라이브 1,358B와 24배 차이. 고정하지 않으면 I6은 존재하지 않는 예산에서 recall을 잰다) |
| G3-0c | 결정성 | 홈 경로 길이 고정 후 동일 `(level, seed)` 10회 재조립 → index 구간 sha256 **10/10 동일** |
| G3-0d | 유료 0 | PATH 트랩 스텁 **미발동**, 총 측정 비용 **$0.00**. `meta.paidCalls: 0` 상수 선언 금지 |
| G3-0e | 안정성 | 4개 레벨 전부 시드 20개 간 표준편차 **≤ 0.25** (초과 시 R4 발화 → 정책 결론 금지) |
| G3-0f | 순서 | `git log --diff-filter=A -- docs/benchmarks/pre-registration-2026-07-25-e1.md`가 리포트 최초 커밋보다 **앞선다**(같은 커밋 불가) |

---

### 4. 전체 통과 규칙

이 계획이 "끝났다"고 말할 수 있는 조건. 전부 기계 판정.

1. **3개 릴리스 태그 발행** — `v0.2.0`, `v0.2.1`, `v0.3.0`. GitHub Release 본문에 각 릴리스의 편도 흔적 고지 포함(`SCHEMA.md`는 되돌아가지 않는다 / `enabled:false` 사용자 번들도 1회 마이그레이션된다 / 기존 시드는 계속 v0.1 Draft를 가르친다).
2. **스모크** — 최종 `node test/smoke.mjs` **0 failed**, exit 0, 3-OS × Node 20. 각 릴리스 PR 본문에 실행 출력 원문 첨부(조사가 테스트 수를 확인 못 한 이유가 그것이 어디에도 기록돼 있지 않아서다).
3. **설정 표면** — `Object.keys(DEFAULT_CONFIG).length === Object.keys(VALIDATORS).length === 18`, config-invalid 픽스처 실패값 18개, `grep -l` 확인: README 8종 + `docs/USAGE.md` + `commands/okf-config.md`(키 설명 절·안전 범위 절 **양쪽**) + `templates/config.md` = 신규 키 3개 각각 **11파일**.
4. **lint 규칙 코드** — W5~W10 여섯 개가 §1.3 레지스트리와 1:1이고 의미 중복 **0건**. 전부 W등급, E 승격 **0건**. `buildRepairPrompt`가 W6/W9/W10을 필터해 repair 프롬프트 덤프에 그 코드 **0회**.
5. **§13.1 불변식** — `okf_version: "0.2"`를 선언하는 어떤 상태에서도 배치가 만지는 concept에 `generated`가 붙는다. 릴리스 2 이후 `grep -c 'okf_version: "0.2"'`와 `generated` 스탬핑 코드가 같은 커밋 조상에 있다.
6. **기존 사용자 무회귀** — 라이브 번들에 대해 계획 착수 전/후 `node lib/lint.mjs` 의 **errors 개수 변화 0**. 배치 정지·청크 롤백·추가 유료 repair 호출 **0회**.
7. **게이트** — 라이브 형상에서 주입 concept 수가 계획 착수 전 **12** → 완료 후 **≥13**, `truncateUtf8Bytes` 절단 **0B**, `capLines` 절단 **0줄**, 최종 바이트 **≤ 9,000**.
8. **비용·유료 호출** — 계획 전체가 추가하는 유료 LLM 호출 **0회**. 회차당 유료 호출 상한 **4회** 불변(`grep -c 'runClaude(' bin/batch.mjs` = 3). `OKF_RUN_LIVE_BENCH=1` 실행 **0회**.
9. **프라이버시** — 배치 로그·상태 파일 전량에 세션 UUID·전체 경로·cwd·git remote·전사 원문 **0건**. digest 경로에서 원본 JSONL 바이트가 LLM 입력으로 나가는 경로 **0개**.
10. **표기** — `grep -rn "okf-system v0\.2"` **0**, `grep -rn "v0\.1" bin lib prompts templates commands skills test .claude-plugin` **4줄(시드만)**, `grep -rn "stale_after" prompts templates skills commands` **0**.
11. **측정 발행** — `docs/benchmarks/pre-registration-2026-07-25-e1.md`와 `gate-recall-2026-07-25-e1.md`가 이 순서로 커밋됐고, R1~R5 판정이 코드가 찍은 값이며, **결론이 예측과 달라도 그대로 발행됐다**. R1 발화 시 결론 "I2를 하지 않는다"를 그대로 실은 것이 성공이다.
12. **폐기 목록 준수** — 계획 전체에 `stale_after` 자동 부여 **0**, 배치의 `verified` 자기 서명 **0**, `sources` 강제 **0**, 기존 concept 프론트매터 일괄 변환 **0**, Attested Computation 생산 **0**, 반증된 벤치마크 축 재실행 **0**.

---

### 5. BROKEN 판정 작업패키지의 처리

**BROKEN 판정은 0건이다.** 17개 WP 전부 NEEDS_FIX다. 그러나 NEEDS_FIX 중 **지적된 결함을 고치면 원래 전제가 무너지는 것**이 5건 있고, 그것은 사실상 재설계 대상이다.

| WP | 실질 판정 | 처리 |
|---|---|---|
| **I1 + I4** | **병합** | 동일 규칙(반복 관측 카운터)을 각자 프롬프트에 넣고 lint 코드가 정확히 뒤바뀐다. 두 WP가 같은 `prompts/ingest.md` 앵커(:47-48)를 잡는다. → 단일 WP `I-M`. `lib/bloat.mjs`(I4)를 감사기 겸 lint 상수 소유자로 두고, I1의 `test/exclusion-audit.mjs`는 폐기(중복). 임계값은 `lib/lint.mjs`에서 **export**해 이중 정의 제거 |
| **I3 step 4** (2층 설명 배급) | **분할 후 보류** | 리뷰 실측: cap=0에서 "22/22 주입"이지만 **설명 보유 줄이 13 → 10으로 감소**. v3가 값 매긴 지표(왕복 1회 ≈12,500토큰)와 반대 방향이다. → step 1·2·5(tail 바이트 캡 + 예산)만 릴리스 3에 착지. step 4는 `INDEX_TWO_LAYER = false` 플래그 뒤로 두고 I6 승인 조건 충족 시에만 켠다. 롤백 레버를 `INDEX_DESC_CAP_BYTES = 0`이 아니라 **구조 플래그**로 바꿔야 문서가 사실이 된다 |
| **I2** (라우팅) | **구현하되 기본 off** | 자체 실측: 실제 cwd 3종 중 **2종에서 이득 0**, 이득이 있는 1종도 concept **+1개**. N=22에서 켤 근거가 없다. 그리고 은퇴(S4)가 같은 문제를 더 싸게 푼다(14/20 > 13/22). → 코드는 넣되 `inject_routing: false`. 기본값 전환은 I6 조건 A/B/C 전부 충족 시 **별도 커밋** |
| **S2 step 6** (schema 범프) | **삭제·이관** | 본문이 한 글자도 안 바뀐 상태에서 사용자 SCHEMA.md 로컬 편집을 비가역 파괴한다. 그리고 "유일한 트리거"라는 근거가 거짓 — `bin/batch.mjs:833`/`:848`이 청크마다 `regenerateIndex`를 부르므로 배치 1회 성공만으로 승격된다. → S5로 이관 |
| **I6** | **선행 수정 필수** | 하네스가 라이브와 **다른 예산에서 측정**한다(tail 54B vs 1,358B — `ensureBootstrap`이 `# Log\n`만 쓴다). 그 편향이 하필 R1("recall ≥0.90 → 개선하지 않는다") 쪽으로 기운다. 소스 grep은 `\bclaude\b`가 `.claude`에 걸려 반드시 실패하고, `mkdtempSync` 경로 길이 차이가 head 바이트를 흔들어 결정성 테스트가 원리적으로 통과 불가. → G3-0a~0f 6개 게이트를 전부 통과해야 다른 것을 승인할 자격이 생긴다 |

**제외는 0건이다.** 사용자 결정이 "조사 결과를 모두 반영한다"이므로, 근거가 약한 항목(I2)도 코드는 넣되 기본값과 게이트로 위험을 0으로 만든다.

---

### 6. 순서를 어기면 깨지는 지점

각 항목은 "A를 B보다 먼저 하면 이렇게 깨진다" 형태다.

| # | 잘못된 순서 | 결과 |
|---|---|---|
| **1** | **S5(SCHEMA에서 `timestamp` 제거)를 S3a(W2 OR 검사)보다 먼저** | `SCHEMA.md`가 자기 자신에게 영구 W2를 받고, 그 경고가 `formatReport` → `{{LINT_REPORT}}` → repair로 새어 모델이 매 회차 SCHEMA를 고치려 든다. `bin/batch.mjs:783`이 차단해서 `분석기 산출물 반영 거부` 로그가 상시화 |
| **2** | **S2(okf_version "0.2" 승격)를 S1(generated 스탬핑) 없이** | §13.1 폴백이 MAY이므로 폴백 미구현 소비자에게 concept 22개가 **시간 신호 없는 문서**가 된다. 순수 후퇴. 반대 방향(S1만, S2 없이)은 안전한 비대칭 |
| **3** | **S3b(중첩 log.md W8)를 S5의 SCHEMA 규칙 3 문구보다 먼저** | 규정에 없는 요구로 기존 사용자의 중첩 log.md가 경고를 받는다. E3b로 만들면 **모든 ingest 영구 정지** |
| **4** | **I5(head +125B)를 R5(예산 회계 수정)보다 먼저** | 라이브 잔여 예산 58B < 125B → concept **12→11 축출**, tail 절단 218B→291B |
| **5** | **R5 없이 게이트 마커 문구를 늘림(I2 라우팅 마커 +38B)** | 선차감 없이 조립이 캡을 넘어 `truncateUtf8Bytes`가 뒤에서 자르고, 잘리는 곳은 문서 끝 = **log.md tail 전량** |
| **6** | **R3(락 재설계)를 R0(동시 프로세스 경합 테스트)보다 먼저** | reliability §5 항목 11의 조건 위반. 잘못 만들면 "중복 spawn은 안전하다"가 "**아무 배치도 못 돈다**"가 되고, 그것을 잡을 테스트가 없다 |
| **7** | **R2를 R3보다 먼저** | `updateLastBatch(home, result, spend)`가 R3의 `{blocked:{...}}` 객체를 `spend`로 해석 → `tokens.input_tokens === undefined`, 로그에 `토큰 in/out undefined/undefined`, `blocked` 미기록으로 R3 단언 2건 실패 |
| **8** | **S4를 R3보다 먼저** | `acquireOkfLock`이 `lib/lock.mjs`에 없다. 있더라도 `recoveredFromStaleLock`을 버리면 `/okf:okf-deprecate`가 **크래시 잔여물을 `okf: pre-batch: user edits`로 영구 커밋**한다(배치는 같은 상황에서 rollback한다) |
| **9** | **S1의 스탬핑을 `Buffer.compare` 동일성 검사 앞에** | 모든 파일이 매 회차 재기록 → `bin/batch.mjs:828-831`의 유실 백스톱 **영구 무력화** |
| **10** | **S1의 스탬핑을 SCHEMA/`okf_seed` 차단 게이트 앞에** | 드라이버가 지키던 경계가 뚫려 시드가 스탬프된다 |
| **11** | **S1이 `destAbs`에만 쓰고 `abs`(워크스페이스)에 되쓰지 않음** | `applyAnalyzerWorkspace`가 ingest 후·repair 후 **두 번** 호출되므로, 2차에서 repair가 건드리지도 않은 파일의 `at`이 전부 새 시각으로 갈아엎힌다 |
| **12** | **I2/I3/I5를 I6의 `lib/gate.mjs` 추출보다 먼저** | 세 WP가 `bin/session-start.mjs:29-101`을 각자 다른 자료구조로 재작성 → 두 번째부터 머지 충돌, 세 번째는 런타임 `c.lines.map` undefined |
| **13** | **I2를 I3보다 먼저** | `rankCategories`가 `c.lines`를 정렬하는데 I3이 그것을 `c.items`로 바꾼다 → 런타임 사망 |
| **14** | **R4의 W6(description 길이)을 `buildRepairPrompt` 필터 없이** | repair가 "쪼개라"는 지시를 받는데 새 파일을 만들 수 없다 → 헛돌거나 **파일을 임의로 잘라낸다**. 그리고 `applyAnalyzerWorkspace`에는 신규 파일 차단이 없어 실제로 반영된다 |
| **15** | **설정 키를 추가하면서 `test/smoke.mjs:194-212` 픽스처를 안 고침** | `warnings.length >= Object.keys(DEFAULT_CONFIG).length`가 현재 **15==15 등호 경계**라 즉시 빨개진다 |
| **16** | **여러 WP가 각자 `plugin.json` + `smoke:1174`를 올림** | 버전이 두세 칸 뛰거나 한쪽만 고쳐 스모크 즉시 실패. → 릴리스 통합 커밋 1개만 |
| **17** | **R1의 설치 하한을 클램프 없이** | 설치한 지 3일 된 기존 사용자의 **4~7일 전 transcript가 영구 배제**된다(`SWEEP_LOOKBACK_DAYS`는 하드 7일 창이라 다음 회차에도 안 돌아온다). `marker.source !== 'bootstrap'`이면 `Math.min(rawFloor, windowStart)`로 클램프 필수 |
| **18** | **S4/S6/S3a가 각자 `status` 판정자를 만듦** | `lib/index-gen.mjs`는 `isDeprecated`, `lib/viz.mjs`는 `conceptStatus`를 써서 `status: Deprecated `(끝 공백)·미지 값에서 **index.md와 그래프가 다른 답**을 낸다 |
| **19** | **I-M의 SCHEMA v3 범프를 릴리스 2의 v2 범프와 같은 릴리스에** | 사용자 로컬 편집을 **한 릴리스에 두 번** 덮는다. 릴리스당 정확히 1회 |
| **20** | **I6 하네스를 예산 고정 없이 실행** | tail 54B vs 1,358B 차이로 index에 **+1,304B**를 더 준 상태에서 recall을 재고, 그 편향이 "개선하지 않는다"(R1) 쪽으로 기운다 |

---

### 7. 측정 없이 구현하면 안 되는 것 ↔ I6 승인 조건

I6이 산출하는 지표는 3계열이다. **$0 축**(recall@cap, 게이트 stats), **무료 운영 지표**(P-B/P-C), **유료 축**(v0.3 이후, 실행 금지).

| Part 2 항목 | 승인 조건 (I6 산출 지표) | 미충족 시 |
|---|---|---|
| **I2 기본값 `inject_routing: true`** | (a) R1 미발화, (b) `recall(50) < 0.90`, (c) 라우팅 적용 후 같은 하네스·같은 질문·같은 시드에서 `recall(50)` 절대 **+0.20 이상**, (d) `cwdIndependent` 부분집합 recall **감소 0pp**, (e) `truncatedBytes = 0` 유지. **5개 전부** | `false` 유지, 실험 플래그로만 존속. R1 발화 시 **v0.3에서도 착수하지 않는다** |
| **I3 step 4 (2층 설명 배급)** | (a) I6 정답률이 현행 대비 **하락 0**, (b) **설명 보유 주입 줄 수 ≥ 13**(현행 13, cap=0에서 10으로 감소 실측), (c) `/preferences/rust-msrv-freeze-policy.md` 유형(설명 1,009B, 예외가 문장 뒤쪽)에서 예외 2건 질문 정답률 하락 0 | `INDEX_TWO_LAYER = false`. step 1·2·5만 착지(그것만으로 13/22 전량 설명 + 절단 0B = 순개선) |
| **I-M 배제 규칙 강도** (특히 troubleshooting "원인 미규명이면 쓰지 마라", decision "기각 대안 1개 이상") | **P-A**(유료, v0.3): `over_exclusion_probe: true` 픽스처 3개(02 결정·05 팀정책·06 혼합)에서 NO-OP **0개**. **P-B**(무료): NO-OP 비율이 기준선 20회차 대비 **+15%p 미만**. **P-C**(무료): 회차당 신규 concept 중앙값이 기준선의 **50% 이상**. 표본 20 미만이면 P-A만이 판정 근거 | troubleshooting·decision 조건 먼저 완화(둘이 실사용 대화에서 가장 자주 미충족). 배제 4문항 본체는 v3 벤치가 직접 뒷받침하므로 마지막에 되돌린다 |
| **게이트 선택 정책 일반**(정렬·축출·관련성) | reliability §6이 v0.2에서 명시 제외. E1 발행 전 어떤 정책 변경도 금지 | 릴리스 1·2는 **회귀 수정만**(R5: 마커 선차감·starvation). 정책은 그대로 |
| **I-M lint 임계값**(본문 12,000B / 반복 헤딩 3) | 라이브 형상 동결 픽스처(줄 바이트·익명 헤딩 키만, 텍스트 0)에서 oversize **정확히 1**, repeated **정확히 1**, 나머지 21개 오탐 **0** | 임계 조정 후 재측정. 라이브 번들 실측은 커밋 불가(사용자 지식 발행)이므로 **합성 픽스처가 유일한 CI 근거** |
| **I5 게이트 규칙 4 추가(+125B)** | 측정 불필요(계약 통일). 단 **R5 적용 상태에서 live-shape 주입 concept 수 변화 0, 절단 0B**를 기계로 확인 | R5 미적용 상태 단독 머지 **금지**(12→11 축출 확정) |

**유료 축은 전부 v0.3 이후, 각자 별도 사전등록.** 후보 2건과 추정: P-A 'recall→정답률 전이' 240세션 ≈ **$28**, P-B '줄로 답하기 vs 강제 Read' 160세션 ≈ **$17**. 실행 조건은 (1) $0 축이 먼저 발행됐고 (2) `recall(50) < 0.90`이며 (3) 비교할 구현이 실재할 때. **금지 축(재탕)**: 번들 크기 대비 비용 / 체인 누적 효과 / 같은 저장소 OKF vs CLAUDE.md 재측정 / v3·v4 재실행 — 이미 $151을 썼고 결론은 각각 '반증' 또는 '분리 안 됨'이다.

**측정 한계를 산출물에 명시할 것**: 프롬프트 diff가 모델 산출을 실제로 바꾸는지는 유료 호출 없이 확인 불가하다(fake-claude는 고정 응답을 낼 뿐 개념을 저술하지 않는다). 무료 축이 보장하는 것은 "규칙이 프롬프트에 살아 있고, 코드 백스톱이 알려진 오염 형태를 정확히 N건 잡고, 사전등록에 과다 배제 탐침이 실제로 들어 있다"까지다.

---

## Part 1 — OKF v0.2 스펙 준수 개발 계획

기준선 실측(이 워크트리, 2026-07-25): `node test/smoke.mjs` → **303 passed, 0 failed** · `DEFAULT_CONFIG` **15키** · lint 사용 중 코드 **E1/E2/E3a/E3b/W1/W2/W3/W4**(W5 이상 미사용) · `.claude-plugin/plugin.json` **0.1.6** · `lib/trust.mjs` **없음** · `lib/lock.mjs` 28줄(판정만) · 라이브 번들 concept **22~23개**(배치가 계속 돈다 — 이 수를 통과 규칙에 쓰지 마라).

---

### 1.0 이 파트가 하는 일과 하지 않는 일

#### 1.0.1 스펙 델타와 처리

| 스펙 항목 | OKF v0.2가 요구하는 것 | 현재 okf-system | Part 1의 처리 | 담당 |
|---|---|---|---|---|
| `generated: {by, at}` | §5.2. `by` REQUIRED. 산출 주체와 시각 | 라이브 22개 중 **0개** | 배치가 이번 회차에 실제로 만지는 파일에만 **코드가** 찍는다 | S1 |
| `timestamp` | 폐기. 소비자 폴백은 **MAY**(§13.1) | `lint.mjs:130`이 **강제** → repair가 되살림(B3) | lint를 OR 검사로. SCHEMA·프롬프트에서 제거. **기존 값은 지우지도 갱신하지도 않는다** | S3a, S5 |
| `verified: [{by,at}]` | §5.2 MUST — dash 없는 bare mapping을 1원소 리스트로 | 미구현 | **읽기만** 구현(`normalizeVerified`). 생산 금지 | S6 |
| `status: draft\|stable\|deprecated` | §5.4 부재=stable. §11 미지 값으로 문서 거부 금지 | 저장소 전체 `status:` **0건** | 생산(좁은 조건 + 청크당 3건 상한) + 소비(index 정렬·게이트 스킵) + 미지 값 경고 | S4, S3a |
| `stale_after` | §5.5 | 미구현 | **하지 않는다**(§1.0.2-1) | — |
| `sources` | optional | 미구현 | **하지 않는다**(§1.0.2-3) | — |
| `okf_version`(루트 index) | §8/§12. 선언 자체가 MAY | `"0.1"` 하드코딩, 승격 경로 없음 | `"0.1"`일 때만 `"0.2"`로 승격. 외부 값은 보존 | S2 |
| 미지 키 round-trip 보존 | §4.1 SHOULD | 루트 index 재생성마다 **파괴**(A1 실측: `x_tool_state` 소실) | 원본 라인 블록 보존 | S2 |
| 예약 파일(index.md / log.md) | §3.1/§9 — 레벨 무관 | 중첩 `log.md`가 §9 검사에서 통째 누락(A3) | 비루트 log.md에 경고 등급으로 검사 도입 | S3b |
| 깨진 링크 관용 | §6.1 MUST tolerate | 이미 관용 | 변경 없음 | — |
| Attested Computation | §14 optional | 미구현 | **하지 않는다**(§1.0.2-5) | — |

#### 1.0.2 하지 않기로 **결론난** 것 — 구현 중 되살리지 마라

각 항목은 조사에서 근거와 함께 폐기됐다. 리뷰에서 다시 제안되면 이 절을 링크하고 거절하라.

1. **`stale_after` 자동 부여 금지.** 근거 없는 추측이다. 게다가 무따옴표 `stale_after: 2026-12-31`은 벤더드 js-yaml이 `Date` 객체로 파싱해 `'2027-01-05' >= <Date>`조차 false다(실행 확인, B7). **프롬프트·SCHEMA에 이름조차 쓰지 마라** — 소개하면 모델이 채운다. 값이 이미 있는 문서를 읽는 것(S6의 `isStale`)만 허용한다.
2. **배치가 자기 산출물에 `verified`를 찍는 것 금지.** 자기 확인 도장은 위조이고, §5.3의 신뢰 등급 전체를 무의미하게 만든다. `verified`는 읽기만 한다.
3. **`sources` 강제 금지.** 입력 digest가 URL·경로를 보존하지 않는다(`lib/digest.mjs:43`). 지금 채우면 출처를 지어내는 것이다. 출처는 본문 산문으로 남긴다.
4. **기존 concept 프론트매터 일괄 변환 금지.** `generated.by`를 채울 기록이 존재하지 않는다(번들 커밋 19개 전부 고정 identity `OKF Batch <okf-batch@localhost>`, 배치 로그 grep 0건). `timestamp` → `generated.at` 기계 복사는 22개 중 **4개가 8~10일 틀렸다** = 위조. 스탬프는 앞으로 배치가 실제로 만지는 파일에만 붙는다.
5. **Attested Computation 생산 금지.** 소비자 0, 생산 근거 0.
6. **게이트 주입 줄에 신뢰 배지 금지.** 9바이트 배지가 concept 1개를 축출한다(실측 12→11). 이 축의 진짜 이득은 장식이 아니라 **제거와 정렬**(0바이트)이며 그것이 S4다.
7. **statusline에 stale/deprecated 집계 금지.** `bin/statusline.mjs:10-12`가 스스로 "파일 내용은 읽지 않는다"고 규정한 매 턴 렌더 경로다. 신뢰 신호는 `/okf:okf-status`(요청 시 1회)와 viz meta로만 낸다.
8. **repair 프롬프트를 errors 전용으로 축소하는 것 금지.** S3a의 W2 OR 검사가 그 동기를 없앤다. W1/W3는 유일한 자동 교정 경로다. 대신 **분할·요약을 지시하는 경고(W6)만 필터**한다(§1.1.4).
9. **루트 index W4 완화 / W3 예외 집합 확대 금지.** §8/§12는 루트 index.md의 `okf_version` **하나만** 예외로 허용한다.
10. **시드 `templates/seed/{en,ko}/references/okf-format.md` 갱신 금지(이번 릴리스).** `okf_seed: true`라 `bin/batch.mjs:783`이 배치 수정을 물리 차단하고 `writeIfMissing`이라 재부트스트랩도 못 고친다 — 템플릿만 고치면 신규 설치에만 갈라진 서술이 생긴다. 릴리스 노트로 고지한다.
11. **신규 lint 규칙의 E 등급 승격 금지.** E가 되는 순간 `handleDirtyWorkingTree`(`bin/batch.mjs:398-417`)가 기존 사용자 번들의 **모든 ingest를 영구 정지**시킨다. Part 1이 추가하는 규칙은 전부 W다.

---

### 1.1 선결 제약

#### 1.1.1 §13.1 원자성 — 선언과 생산은 같은 릴리스에

SPEC §13.1의 `timestamp` 폴백은 소비자 **MAY**다. 따라서 `okf_version: "0.2"`를 선언하면서 `generated`를 생산하지 않으면, 폴백 미구현 소비자에게 우리 concept는 **시간 신호가 아예 없는 문서**가 된다 — 순수 후퇴다.

> **불변식**: `S1`(생산) · `S2`(선언) · `S5`(규칙서)는 **같은 릴리스 브랜치**에 있어야 한다. 셋 중 하나라도 빠지면 릴리스 2를 발행하지 않는다.

비대칭에 주의: **S1만 머지하고 S2를 드롭하는 조합은 안전하다**(생산만 하고 선언은 안 함). 반대 방향만 금지다.

#### 1.1.2 `schema_version` 범프는 편도이며 사용자 로컬 편집을 덮는다

`lib/bootstrap.mjs:94`의 비교는 `schemaVersionOf(current) < schemaVersionOf(template)`이다. 따라서:

- 플러그인을 이전 버전으로 되돌려도 **사용자 SCHEMA.md는 v2로 남는다**(`2 < 1`이 거짓).
- 같은 버전에서의 사용자 로컬 편집은 보존되지만, **더 낮은 버전의 로컬 편집은 통째로 덮인다**. 사용자가 감수하기로 결정한 사항이다.
- `ensureBootstrap`은 kill switch(`bin/session-start.mjs:127`)보다 **먼저** 돌므로, `enabled: false`로 꺼둔 사용자의 번들도 이 릴리스에서 한 번 마이그레이션된다.
- 값은 반드시 **따옴표 없는 정수 한 줄**이어야 한다 — `lib/bootstrap.mjs:22`의 `SCHEMA_VERSION_RE = /^schema_version:\s*(\d+)\s*$/m`가 YAML이 아니라 정규식으로 읽는다. `"2"`로 쓰면 0으로 읽혀 매 SessionStart마다 재배포된다.

> **규칙**: 범프는 **릴리스당 정확히 1회**, **SCHEMA 본문이 실제로 바뀌는 커밋에서만**. 본문 무변경 상태의 범프는 사용자 데이터를 파괴할 뿐 아무것도 전파하지 않는다 — 그래서 S2의 원래 step 6(schema 범프)은 **삭제**하고 S5로 이관했다(§1.1.6).

릴리스 노트 필수 3문장:
1. "`SCHEMA.md`를 직접 편집했다면 이 업데이트가 그 편집을 템플릿 v2로 덮어씁니다. 이전 내용은 `git -C ~/.claude/okf log -- SCHEMA.md`에 남습니다."
2. "플러그인을 되돌려도 `SCHEMA.md`는 자동으로 되돌아가지 않습니다 — `git -C ~/.claude/okf checkout <이전커밋> -- SCHEMA.md`."
3. "`enabled: false`로 꺼둔 번들도 이 릴리스에서 한 번 마이그레이션됩니다(부트스트랩이 kill switch보다 먼저 실행되기 때문입니다)."

추가로: "기존 설치의 `references/okf-format.md` 시드는 계속 v0.1이라고 적혀 있습니다 — 갱신하려면 그 파일을 지우고 세션을 다시 시작하세요."

#### 1.1.3 버전 표기 전략 — 플러그인 버전과 스펙 버전은 다른 축

**`okf-system v0.2`라는 문자열은 어디에도 만들지 않는다.** grep으로 강제한다.

| 축 | 값 | 위치 | 릴리스 |
|---|---|---|---|
| 플러그인 버전 | `0.2.0` / `0.2.1` | `.claude-plugin/plugin.json:3` + `test/smoke.mjs:1174` — **항상 같은 커밋** | 통합 커밋 |
| OKF 스펙 버전(기계 판독 정본) | `okf_version: "0.2"` | 번들 루트 `index.md` | 2 (S2) |
| 산출물 세대 | `OKF v0.2 번들의 지식 사서다` | `prompts/ingest.md:3` | 2 (S5) |
| 템플릿 세대 카운터 | `schema_version: 2` | `templates/SCHEMA.md:3` | 2 (S5, 릴리스 유일 범프) |
| 배지 | `badge/OKF-v0.2-4ecdc4` | `README.md:5`, `README.ko.md:5` **2종만** | 2 (S5) |
| 게이트 head | **버전 표기 제거** | `bin/session-start.mjs:80` | 2 (S5) |
| 동결 | v0.1 서술 유지 | `templates/seed/{en,ko}/references/okf-format.md` 4줄, `AGENDA.md`, `docs/benchmarks/**` | — |

> **개별 WP는 `plugin.json`과 `test/smoke.mjs:1174` 두 줄 중 어느 것도 건드리지 않는다.** 릴리스당 정확히 하나의 통합 커밋이 두 줄을 동시에 올린다. 이 규칙 때문에 각 WP를 단독으로 돌려도 `pluginManifest.version === '0.1.6'` 단언은 그대로 통과한다.
>
> 유일한 예외: **S5**는 `templates/SCHEMA.md`의 `generated.by: "okf-system/0.2.1"`을 쓰고, 스모크가 그것을 `pluginManifest.version`과 대조한다(§S5 검증). 따라서 **S5는 릴리스 2 브랜치 밖에서 단독 머지하지 마라** — 통합 커밋과 같은 브랜치에 있어야 한다. 이 단언이 "선언과 생산이 같은 릴리스에 있어야 한다"를 범프마다 기계로 재확인한다.

#### 1.1.4 lint 규칙 코드 레지스트리 — 5개 WP의 선점 충돌 해소

W5 이상은 현재 비어 있는데 여러 WP가 **각기 다른 의미로** 선점했다. 코드가 겹치면 `summarizeLintForLog`(`bin/batch.mjs:52`)의 집계와 repair 필터가 동시에 거짓이 된다. 아래를 `lib/lint.mjs` 상단 주석으로 못 박는다(R0 산출물).

| 코드 | 의미 | 소유 WP | 릴리스 | repair 프롬프트 |
|---|---|---|---|---|
| `W5` | frontmatter 값이 무따옴표 ` #`에서 잘림 | R4 | 1 | **싣는다**(따옴표 씌우기는 repair 범위 안) |
| `W6` | `description` > 500자 | R4 | 1 | **필터**(분할 지시인데 repair는 새 파일 금지) |
| `W7` | 미지 `status` 값 | S3a | 1 | 싣는다(정보성) |
| `W8` | 중첩 `log.md` 비ISO/내림차순 위반 | S3b | 2 | 싣는다 |
| `W9`/`W10` | (Part 2 예약: 본문 바이트 / 반복 헤딩) | I-M | 3 | 필터 |

전부 **W**다. 코드는 `/^[A-Z][0-9]{1,2}$/`(`bin/batch.mjs:55`)를 만족해야 로그에 `W7=1` 형태로 남는다 — `W5a` 같은 접미를 붙이면 `UNKNOWN`으로 뭉개진다.

**부수 필수(R4 소관):** `buildRepairPrompt`(`bin/batch.mjs:695-699`)가 W6을 걸러야 한다. `prompts/repair.md`는 새 파일 생성을 금지하는데 `applyAnalyzerWorkspace`에는 신규 파일 차단이 없어(`prev===null`이면 그대로 `writeFileSync`, `:786-788`) **repair가 concept를 임의로 잘라 반영할 수 있다**. 코드가 답할 수 있는 것을 모델에게 부탁하지 마라(Rule 5).

#### 1.1.5 통과 수 계산 규약

절대값 금지. 각 WP는 **"적용 직전 기준선 N → N + k"** 로 쓰고 `k`(신규 `ok()` 수)를 검증 목록으로 증명한다. 릴리스 PR 본문에 `node test/smoke.mjs` 실행 출력 원문을 첨부하고, 그 수를 다음 WP의 기준선으로 고정한다.

산술 예고(어긋나면 어느 WP가 단언을 빠뜨린 것이다):

```
303 (기준선)
 + R0   4 + R5  13 + R3  20 + R2  18 + R1  15 + R4  22 + S3a 12  = 릴리스 1 종료 407
 + S1  15 + S2   9 + S5  15 + S3b  5 + S4  20                    = 릴리스 2 종료 471
 + S6  19                                                        = (릴리스 3에 편승)  490
```

#### 1.1.6 단일 소유자 표 — 이 표와 다른 지시는 무효다

조사·리뷰 단계에서 여러 WP가 같은 파일·함수를 서로 다르게 고치라고 지시했다. 아래가 정본이며, **바뀐 배정은 이유와 함께 명시**했다(Rule 7).

| 대상 | 단일 소유자 | 원래 어디에도 있었나 | 결정 이유 |
|---|---|---|---|
| `templates/SCHEMA.md` 전체 | **S5** | S2 step6, S4 step8도 지시 | 릴리스당 범프 1회를 보장하려면 편집자가 하나여야 한다. S2 step6 삭제, S4 step8 삭제 |
| `prompts/ingest.md` (릴리스 2) | **S5** | S4 step8도 지시 | 위와 동일. 단 **릴리스 1의 인용·500자 bullet은 R4**가 넣는다(프롬프트는 schema 범프 없이 즉시 전파된다) |
| `lib/trust.mjs` | **S3a가 생성**, S4가 `conceptStatus` 추가, S6이 `normalizeVerified`/`isStale` 추가 | S4는 `lib/frontmatter.mjs`, S6은 `lib/trust.mjs`로 갈렸다 | 판정자가 둘이면 `status: Deprecated `(끝 공백)·미지 값에서 index.md와 그래프가 다른 답을 낸다 |
| 미지 `status` lint 경고 | **S3a의 W7** | S4가 `W5`로 중복 지시 | 레지스트리(§1.1.4). S4는 lint를 건드리지 않는다 |
| `lib/bootstrap.mjs` 배치 락 가드 | **R3**(릴리스 1) | S2 step4 | 락 계약의 소유자는 `lib/lock.mjs`(R3)이고, R3의 청크별 `rollback` 반복이 그 레이스를 넓히므로 같은 패키지에서 닫아야 한다. S2는 그 위에서 테스트만 얹는다 |
| `bin/session-start.mjs:80`의 `(OKF v0.1)` 제거 | **S5** | S2 리뷰 정정이 S2로 끌어오라고 함 | S5가 버전 문자열 표기의 단일 소유자다. 둘 다 릴리스 2라 §13.1 원자성에 영향 없다 |
| `updateLastBatch` / `processChunkBody` / `processChunks` 시그니처 | **R3** | R2도 서로 다른 시그니처 지시 | R3이 먼저 착지하고 R2는 `extra`로만 얹는다 |
| `lib/lock.mjs` 획득/해제 | **R3** | S4도 이관 지시 | S4는 R3의 API를 **소비**만 한다 |
| `buildInjectedIndex`(Part 1 범위) | **R5** | — | 정책 변경은 Part 2. R5는 회귀 수정만 |
| `.claude-plugin/plugin.json` + `test/smoke.mjs:1174` | **릴리스 통합 커밋** | R1·R2·S2·S5·I6이 각자 지시 | 전부 삭제(§1.1.3) |

---

### 릴리스 1 — `0.2.0` "신뢰성"

> minor인 이유: `sweep_backfill_days` 기본 0이 **수집 기본 동작을 바꾼다**. 스펙과 무관하다.
> 순서: **R0 → R5 → R3 → R2 → R1 → R4 → S3a**. R2는 R3 뒤가 아니면 시그니처가 깨진다.

---

#### R0 — 선행 테스트 하네스: 동시 락 경합 · live-shape 픽스처 · lint 코드 레지스트리

**목표**: R3(락 재설계)과 R5(게이트 예산)가 **자기 결함을 증명할 수단 없이** 착지하는 것을 막는다. 산출물 3개: (a) 두 배치를 실제로 겹치게 만드는 `runBatchDetached` 헬퍼와 순서 무관 불변식 테스트, (b) 라이브 번들의 **줄 바이트 벡터만** 담은 동결 픽스처(전사 텍스트 0바이트), (c) lint 규칙 코드 레지스트리 주석. 코드 동작은 **한 줄도 바꾸지 않는다**.

**근거**: reliability §5 항목 6의 순서 제약 — "이 항목의 '실제 동시 프로세스 락 경합' 테스트는 **항목 11(락 재설계)보다 먼저** 작성되어야 한다". 항목 11 말미: "잘못 만들면 '중복 spawn은 안전하다'는 현재 전제 대신 '아무 배치도 못 돈다'가 된다." 그리고 라이브 번들 수치를 통과 규칙으로 쓰면 재현 불가능하다(배치가 계속 돌아 concept 수가 22→23으로 움직였다) — 커밋 가능한 합성 픽스처가 유일한 CI 근거다.

**구현 방안**: 테스트 전용 변경이므로 `bin/`·`lib/`를 건드리지 않는다. `runBatchDetached`는 기존 `runBatch`(`execFileSync`, 동기)로는 두 프로세스를 겹칠 수 없다는 사실 하나 때문에 필요하다. 픽스처는 **숫자만** 담는다 — 사용자 지식을 저장소에 발행하지 않으면서 예산 산술을 재현하기 위한 최소 형태다.

**구현 방법**

1. `test/smoke.mjs` 상단 import를 `import { execFileSync, spawn, spawnSync } from 'node:child_process';`로 확장하고, `runBatch`(:120 부근) 아래에 헬퍼를 추가한다.

```js
// runBatch는 execFileSync라 두 배치를 겹칠 수 없다. 락 계약을 바꾸는 작업패키지(R3)는
// '실제로 겹쳤을 때 무슨 일이 나는가'를 증명할 수단 없이 착지하면 안 된다(reliability §5 항목 6).
function runBatchDetached({ okfHome, env = {} }) {
  const home = env.HOME || isolatedHome();
  return spawn(process.execPath, [path.join(PLUGIN_ROOT, 'bin', 'batch.mjs')], {
    cwd: okfHome,
    env: {
      ...process.env, OKF_HOME: okfHome, HOME: home, USERPROFILE: home,
      CLAUDE_CONFIG_DIR: path.join(home, '.claude'), ...env,
    },
    stdio: 'ignore',
  });
}
function waitUntil(pred, timeoutMs, stepMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (pred()) return true; spawnSync(process.execPath, ['-e', `setTimeout(()=>{}, ${stepMs})`]); }
  return pred();
}
```

2. `test/fixtures/fake-claude.mjs`에 유료 호출 카운터를 추가한다. 위치는 `:14`(`const isRepairCall = ...`) **바로 아래** — repair 호출도 세야 '유료 호출 총 횟수'가 된다.

```js
// 청크마다 새 프로세스로 뜨므로 프로세스 내 변수로는 셀 수 없다. 파일 카운터로
// '이 경로에서 유료 호출이 몇 번 났는가'를 무과금으로 단언한다.
if (process.env.FAKE_CLAUDE_CALL_COUNTER) {
  try { fs.appendFileSync(process.env.FAKE_CLAUDE_CALL_COUNTER, `${isRepairCall ? 'repair' : 'ingest'}\n`); } catch { /* 텔레메트리가 스텁을 막지 않는다 */ }
}
```

3. 동시 경합 테스트 블록을 `=== batch.mjs (subprocess, fake claude) ===` 섹션 끝에 추가한다(코드는 §검증 참조).

4. `test/fixtures/live-shape-2026-07-25.json`을 커밋한다. **텍스트 0바이트, 숫자와 더미 패딩만.**

```json
{
  "measuredAt": "2026-07-25",
  "note": "라이브 번들의 형상만 동결한다. concept 제목·설명 원문은 담지 않는다(사용자 지식 발행 금지).",
  "headBytes": 686, "headLines": 10,
  "tailBytes": 1358, "tailLines": 18,
  "categories": [
    { "dir": "decisions",       "lineBytes": [423, 413] },
    { "dir": "patterns",        "lineBytes": [1546, 489, 660, 549, 379, 466] },
    { "dir": "preferences",     "lineBytes": [510, 206, 1207] },
    { "dir": "projects",        "lineBytes": [503, 321, 283] },
    { "dir": "references",      "lineBytes": [602, 554, 222, 202, 219, 944] },
    { "dir": "troubleshooting", "lineBytes": [973, 126] }
  ],
  "expected": { "injectMaxBytes": 9000, "injectMaxLines": 120, "taken": 12, "assembledBytes": 9218, "truncatedBytes": 218, "leftoverBytes": 58 }
}
```

합성 헬퍼도 같은 커밋에 넣는다 — `test/smoke.mjs`에 `buildShapeBundle(label, shape)`: 각 `lineBytes[i]`에 대해 `'가'.repeat(n)` 패딩으로 index 줄 바이트를 맞춘 concept를 심고, `log.md`를 `tailBytes`/`tailLines`에 맞춘 더미 bullet으로 채운다.

5. `lib/lint.mjs` 상단(`:1` import 아래)에 레지스트리 주석을 넣는다. **코드 변경 0줄.**

```js
// ---------- lint 규칙 코드 레지스트리 ----------
// 코드가 겹치면 summarizeLintForLog(bin/batch.mjs:52)의 집계와 buildRepairPrompt의 필터가
// 동시에 거짓이 된다. 새 규칙을 추가하기 전에 여기에 먼저 등록하라.
//  E1  frontmatter 부재/파손      E2  필수 필드 누락
//  E3a index 구조 위반            E3b 루트 log.md 헤딩 위반
//  W1  깨진 내부 링크             W2  권장 필드 누락(title/description/시간 신호)
//  W3  택소노미 밖 type           W4  루트 index 여분 키 / log.md 중복 날짜
//  W5  무따옴표 ' #' 값 절단      W6  description > 500자   ← repair 프롬프트에서 필터한다
//  W7  미지 status 값             W8  중첩 log.md 헤딩 위반
//  W9/W10 예약(Part 2)
// 전부 W다. E로 올리면 handleDirtyWorkingTree(bin/batch.mjs:398-417)가 기존 사용자 번들의
// 모든 ingest를 영구 정지시킨다.
```

**검증 방법** (신규 `ok()` 4개)

- `lock-race: a session is archived exactly once under two concurrent batches`
  - 픽스처: `setupBatchSandbox('lock-race')` + 카운터 파일. `runBatchDetached` 2개를 연속 spawn하고 `waitUntil(() => a.exitCode !== null && b.exitCode !== null, 20000, 200)`.
  - 단언: `listRemoveCandidate(home).length === 1`
- `lock-race: concurrent batches never exceed two paid calls`
  - 단언: `readIfExists(counter).split('\n').filter(Boolean).length <= 2`
- `lock-race: the tree is clean and no lock file survives the race`
  - 단언: `git(['status','--porcelain'], home).trim() === '' && !fs.existsSync(okfPaths(home).lock)`
- `live-shape fixture carries byte counts only, never transcript text`
  - 픽스처: `JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT,'test','fixtures','live-shape-2026-07-25.json'),'utf8'))`
  - 단언: 모든 `lineBytes` 원소가 `Number.isInteger`이고, 파일 전문에 `](/`(index 링크 형태)가 0회 등장한다 — 누군가 원문을 붙여넣으면 즉시 실패한다.

**통과 규칙**

- `node test/smoke.mjs` → **303 → 307 passed, 0 failed**, exit 0, 3-OS × Node 20.
- 동시 배치 2개에서 archive 세션 **정확히 1**, 유료 호출 **≤ 2**, 종료 후 `git status --porcelain` **0바이트**, 락 파일 **잔존 0**. 이 테스트는 **현행 코드에서 통과해야 한다**(R3 이전 상태의 안전성을 고정하는 것이 목적이다). 실패하면 R3 착수 전에 원인을 규명하라.
- `live-shape-2026-07-25.json`으로 합성한 번들에서 `bin/session-start.mjs`가 내는 `additionalContext`가 `expected` 5개 값(taken 12 / 조립 9,218B / 절단 218B / 잔여 58B / head 686B)과 **오차 0**. 불일치 시 픽스처가 틀린 것이다 — R5를 착수하지 마라.
- `bin/`·`lib/` 아래 변경 줄 수 **0**(레지스트리 주석 제외).

**선행·롤백**: 선행 없음. `git revert` 한 번. 테스트·픽스처·주석만 건드리므로 사용자 번들에 흔적 0.

---

#### R5 — 게이트 예산 회귀 수정: 마커·heading 선차감 + starvation 제거

**목표**: `bin/session-start.mjs:29-61 buildInjectedIndex`의 예산 오계산 3건을 고쳐, 조립 시점에 이미 `inject_max_bytes` 이하가 되게 한다. 그러면 `truncateUtf8Bytes`(`lib/text.mjs:3`)가 **한 바이트도 자르지 않는** 진짜 안전망이 된다. **선택 정책(정렬·축출·관련성)은 건드리지 않는다 — 그건 Part 2다.**

**근거**: reliability T7.1/T7.3/T7.4 + spec-conformance B4/B5. 코드: `:38`(heading만 선차감, 마커 미차감), `:45`(`lines = 0; break;`), `:53`(절단 시 heading이 `taken/N개`로 길어지는데 예약은 `N개`로 짧게 잡혔다), `:101`(안전망). 라이브 형상 실측: 조립 9,218B, 절단 218B, **그 218B 전량이 log.md tail**. 4,000~14,000B를 50B 간격으로 훑은 201샘플 중 **102건(50.7%)** 에서 starvation 발생(누적 손실 concept 160개, 최악 −4개@10,550B).

**구현 방안**: 마커를 최악값으로 그냥 깎으면 손해가 난다(전 카테고리 생략 가정 409B 예약 → 라이브에서 12→11). **환급식**으로 간다: 카테고리마다 마커 비용을 미리 깎아두고, 그 카테고리를 끝까지 다 담아 마커가 출력되지 않게 되는 순간 되돌려준다. heading은 반대로 **최악값**(`N/N개`)으로 예약한다 — 카테고리당 최대 2바이트라 손해가 측정되지 않았고(201샘플 concept 총합 2,262로 동일), 예약 부족은 절단을 만든다.

**구현 방법**

1. **마커 생성을 헬퍼로 추출** — 예약과 렌더가 같은 문자열을 쓰게 강제한다. `bin/session-start.mjs:35`의 `headingFor` 아래:

```js
  const markerFor = (c, omitted) => `\n...(${omitted}개 생략 — 전체 목록은 /${c.dir}/index.md 를 Read)`;
```

`:58`의 인라인 생성을 `const marker = omitted > 0 ? markerFor(c, omitted) : '';`로 바꾼다. **문자열 내용은 한 글자도 바꾸지 마라** — `test/smoke.mjs:321`(`includes('생략')`), `:356`(`includes('/decisions/index.md')`)이 의존한다.

2. **heading 선차감을 최악값으로.** `:38` 교체:

```js
  // heading은 절단된 카테고리에서 `2/6개`로 길어진다(:53). 짧은 `6개`로 예약하면 카테고리당
  // 최대 2바이트가 모자라 조립이 캡을 넘는다 — 4,000~14,000B 201샘플 중 5샘플에서 2~9B 절단 실측.
  // 최악값으로 예약해도 concept 총합은 2,262로 동일(손해 0).
  let bytes = budgetBytes - cats.reduce(
    (sum, c) => sum + Buffer.byteLength(`${headingFor(c, `${c.lines.length}/${c.lines.length}개`)}\n\n`, 'utf8'), 0);
```

`:37`의 `let lines = budgetLines - cats.length * 2;`는 그대로 둔다.

3. **마커 선차감 + 환급.** `:38` 직후, 채우기 루프 앞:

```js
  // 선차감하지 않으면 마커가 붙는 순간 조립이 캡을 넘고 truncateUtf8Bytes(:101)가 뒤에서
  // 자른다 — 잘리는 곳은 문서 끝 = log.md tail이다(라이브 실측 218B 전량). 최악값을 그냥 깎으면
  // 손해가 나므로(12→11 실측) 환급식으로 간다.
  const reservedMarker = new Map();
  for (const c of cats) {
    if (c.lines.length === 0) continue;
    const cost = Buffer.byteLength(markerFor(c, c.lines.length), 'utf8');
    reservedMarker.set(c.dir, cost);
    bytes -= cost; lines -= 1;
  }
```

4. **starvation 제거.** `:40-48` 루프 교체:

```js
  for (let progress = true; progress && lines > 0 && bytes > 0; ) {
    progress = false;
    for (const c of cats) {
      if (c.taken >= c.lines.length) continue;
      const cost = Buffer.byteLength(`${c.lines[c.taken]}\n`, 'utf8');
      // 한 카테고리의 다음 줄이 예산을 넘는다고 나머지를 굶기지 않는다. 옛 `lines = 0; break;`는
      // 바깥 루프까지 끝내 남은 예산에 들어갈 짧은 줄을 전부 버렸다(201샘플 중 102건, 손실 160개).
      // 종료는 progress 플래그가 보장한다 — 어느 카테고리도 한 줄을 못 담으면 false로 남는다.
      if (lines < 1 || bytes < cost) continue;
      c.taken += 1; lines -= 1; bytes -= cost; progress = true;
      if (c.taken === c.lines.length && reservedMarker.has(c.dir)) {
        bytes += reservedMarker.get(c.dir); lines += 1; reservedMarker.delete(c.dir);
      }
    }
  }
```

`lines < 1` 안쪽 검사를 남겨라 — 환급으로 `lines`가 루프 도중 늘어난다.

5. 주석 갱신: `:36`을 "heading과 생략 마커는 카테고리 수만큼 고정 비용이다 — 항목보다 먼저 예약해야 조립 결과가 캡을 넘어 :101에서 뒤로 잘리지 않는다"로, `:92-94`에 "2026-07-25: 이 방지 로직 자신이 마커·heading을 선차감하지 않아 정확히 그 현상을 만들고 있었다(라이브 절단 218B 전량이 tail)"를 덧붙인다.

**검증 방법** (신규 `ok()` 13개)

- `gate injection stays within inject_max_bytes=<cap> without the safety net cutting` ×5 (cap = 5000/6000/7000/8000/9000)
  - 픽스처: `bootstrapped('gate-budget-marker')` + `decisions/d00.md`~`d59.md` **60개**(한국어 title/description, 줄당 약 180~200B) + `log.md`에 `## 2026-07-15\n- 게이트 tail 보존 확인용 마지막 줄\n` + `regenerateIndex(home)`. cap마다 `writeConfig(home, { inject_max_bytes: cap })` 후 `runHook`.
  - 단언: `Buffer.byteLength(ctx,'utf8') <= cap && ctx.trimEnd().endsWith(TAIL_MARK)`. **60개인 이유**: 12개로는 5개 cap 전부에서 절단이 안 나 수정 전에도 통과한다(즉 회귀를 못 짚는다). 60개 실측 — 수정 전 5000/8000/9000에서 정확히 cap 바이트가 되며 tail 마지막 줄이 잘린다(3/5 FAIL), 수정 후 4,876/5,920/6,964/7,834/8,878B로 전부 절단 0.
- `생략 마커가 붙는 예산에서도 마커 자체는 살아남는다`
  - 단언: `/\.\.\.\(\d+개 생략 — 전체 목록은 \/decisions\/index\.md 를 Read\)/.test(ctx)` — 60개면 cap 9000에서도 마커가 남는다(40개는 전량 수용돼 마커가 사라진다 — 40을 쓰지 마라).
- `an unaffordable line in one category no longer starves the later categories`
  - 픽스처: `bootstrapped('gate-budget-starvation')` + `decisions/a-short.md` + `decisions/b-huge.md`(description `'나'.repeat(1200)` ≈ 3,600B) + `troubleshooting/t0.md`~`t4.md` + `writeConfig(home, { inject_max_bytes: 5000 })`.
  - 단언: `ctx.includes('트러블슈팅 3') && ctx.includes('트러블슈팅 4')`. **cap 5000인 이유**: 6000에서는 b-huge가 예산에 들어가버려 수정 후에도 t3/t4가 안 실린다(실측). 5000에서 수정 전 총 4개(t3/t4 부재 → FAIL), 수정 후 총 10개(전부 존재). 4,900~5,200B 구간에서 결과가 동일해 경로 길이 차이(±44B)에 안전하다.
- `the unaffordable line itself is still reported as omitted` — `ctx.includes('decisions (결정) — 1/2개')`
- `starvation fix still respects the byte cap` — `Buffer.byteLength(ctx,'utf8') <= 5000`
- `the safety net cuts zero lines, not just zero bytes` — ctx 줄 수 < `inject_max_lines`이고 `capLines` 기본 마커 `'...(생략)'`가 ctx에 0회(게이트 마커와 문자열이 다르므로 구분 가능하다)
- `fully-consumed category refunds its marker budget to another category` — 작은 카테고리 1개(전량 수용 → 환급)와 큰 카테고리 1개를 두고, 환급이 없으면 못 들어갔을 마지막 한 줄이 실제로 실리는지
- `gate stays valid below the structural floor` — `inject_max_bytes: 1024`(검증기 최소값)에서 훅이 유효 JSON을 내고 예외 없이 `Buffer.byteLength(ctx) <= 1024`
- `many-category bundle does not lose lines to marker reservation` — 루트 하위 디렉토리 10개 번들에서 `lines -= 1` × N이 줄 예산을 잠식하지 않는지(주입 concept ≥ 10)
- `live-shape fixture reproduces the frozen budget after the fix` — R0 픽스처로 합성한 번들에서 절단 0B, taken ≥ 12

**구현자 필수 절차**: 두 블록을 **수정 전 코드로 먼저 돌려라.** `gate-budget-marker` 5개 중 최소 3개와 `gate-budget-starvation` 첫 단언이 FAIL해야 한다. 전부 통과하면 픽스처가 회귀 경로를 못 건드린 것이다.

**통과 규칙**

- 기준선 307 → **320 passed, 0 failed**, exit 0.
- 라이브 형상 픽스처에서: 조립 9,218B → **8,879B 이하**, `truncateUtf8Bytes` 절단 218B → **정확히 0**, `capLines` 절단 **0줄**, 주입 concept **12개 유지**(11 이하면 실패).
- `inject_max_bytes` **2,684~9,000B 전 구간(1B 간격)** 에서 절단 **0B**. 2,683 이하는 head+tail+heading+마커 고정 구조만으로 이미 캡을 넘는 구조적 바닥이며 통과 규칙 대상이 아니다.
- 4,000~9,000B를 50B 간격으로 훑은 **101샘플**: 절단 발생 샘플 **72 → 0**, 주입 concept 총합 **571 → 597**, 감소 샘플 20건이며 감소폭은 전부 **−1**(−2 이상 **0건**). 이 스캔은 스모크가 아니라 별도 재현 스크립트로 1회 측정한다(`buildInjectedIndex`가 export되지 않는다).
- 기존 게이트 단언 7종(`test/smoke.mjs:319, 320, 321, 322, 349, 350, 356`)이 전부 PASS 유지. 실측 확인 완료 — 500 decisions 픽스처(concept 94→93), 200 decisions + sqlite-busy 픽스처(`busy_timeout` 유지, 조립 8,967B, 절단 0).

**선행·롤백**: 선행 R0(live-shape 픽스처). `git revert` 한 번. 상태 파일·설정 키·번들 포맷을 건드리지 않고 게이트는 매 SessionStart마다 새로 계산되므로 되돌리는 즉시 이전 동작이 복원된다. **부분 롤백 금지** — `continue`만 남기고 마커 선차감을 되돌리면 라이브 결과가 현행과 완전히 동일해(12/22, 9,218B, 절단 218B) 위험만 남고 이득이 0이다.

---

#### R3 — 락 계약 재설계 · NO-OP 마커 프로토콜 · 커밋 이후 실패 방어 · 정지 상태 표면화

**목표**: 유료 호출을 **이미 지불한 뒤** 실패하는 다섯 경로를 닫는다. (a) 커밋 직후 archive 이동만 try/catch 밖이라 ENOSPC 한 번에 같은 세션이 재과금되던 구멍, (b) `await runLoop()`의 top-level 예외가 unhandled rejection으로 사라져 상태가 안 남던 경로, (c) NO-OP 판정을 자유 텍스트 완전일치(실측 25회 중 9회 = 36% 실패)에서 워크스페이스 마커 파일로, 그리고 그 실패의 대가를 "배치 전체 중단"에서 "해당 청크만 skip"으로, (d) 락 획득/해제를 `lib/lock.mjs`로 올려 **번들에 쓰는 모든 주체가 잡는 락**으로 계약을 확장하고 TOCTOU 이중 회수·남의 락 unlink·`{pid:0}` 영구 정지를 막고 `lib/bootstrap.mjs`가 그 락을 존중하게 하고, (e) pre-batch lint 실패로 배치가 **영구 정지**한 사실을 구조화된 `blocked` 필드로 표면화한다.

**근거**: reliability §5 항목 3·7(A)·11 + T2.2(`bin/batch.mjs:893-897`이 try 밖, 대조군 `:986-994`는 try/catch 있음), T2.4(`:828` 정확일치 판정, no-op 25회 중 9회 실패, 3회 연속 실패 구간), T3.4(`:402-405`, `lib/git.mjs:25-27` repo-root rollback), T4.2(`:200,:210`, 로그에 `stale lock 회수 (PID 45270)` 동일 밀리초 2줄), T4.3(`lib/lock.mjs:17-28` 페이로드 검증 없음), T11.4(35회 중 최소 10회가 지불 후 롤백). spec-conformance §3 B11(bootstrap이 락을 확인하지 않아 배치 중 SCHEMA/index 쓰기가 `:828-831` 백스톱을 무력화).

**구현 방안**: 락 계약을 `lib/lock.mjs` 한 파일에 문서화하고 획득/해제를 이관한다 — S4의 `/okf:okf-deprecate`가 이 API의 첫 소비자다. NO-OP은 텍스트가 아니라 **도구 호출**(파일 생성)로 선언하게 하되, 마커 단독을 믿지 않고 **`applied === 0 && blocked === 0`과 AND**로 판정한다(마커 방식이 여는 새 유실 경로를 닫는다). 청크는 독립 트랜잭션으로 취급한다. `bin/bootstrap`의 락 가드는 §1.1.6에 따라 **이 패키지가 소유**한다 — 청크별 `rollback` 반복이 그 레이스의 노출 창을 넓히므로 같은 커밋에서 닫아야 한다.

**구현 방법**

1. **`lib/lock.mjs`를 락의 단일 원천으로.** 파일 최상단에 계약 주석을 박는다.

```js
// ---------- OKF 번들 락 계약 ----------
// 누가 잡는가: <OKF_HOME> 아래 .md를 쓰거나 git 커밋을 만드는 모든 프로세스.
//   현재 홀더: 'batch'(bin/batch.mjs), 'deprecate'(/okf:okf-deprecate, S4).
//   잡지 않고 쓰면 (1) 배치의 유실 백스톱(bin/batch.mjs:828-831)이 무력화되고
//   (2) 배치가 stale lock을 회수한 회차라면 그 쓰기가 무조건 원복된다.
// 누가 존중하는가: lib/batch-gate.mjs:29, bin/statusline.mjs:62, lib/bootstrap.mjs(이 패키지에서 추가).
// stale 판정: 페이로드가 객체가 아니거나 pid가 양의 정수가 아니거나 startedEpochMs가 유한수가
//   아니면 stale / PID가 죽었으면 stale(EPERM은 '남의 소유 = 살아있음') / 살아있어도 4시간 초과면 stale.
// 소유권: releaseLock은 token이 자기 것일 때만 unlink한다.
```

구현(요지):

```js
export function isLockStale(lock) {
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) return true;
  // {pid:0}이면 process.kill(0,0)이 프로세스 그룹 조회로 성공해 영원히 alive가 되고,
  // startedEpochMs가 없으면 NaN > ceiling === false라 하드 상한이 결코 발동하지 않는다(영구 정지).
  if (!Number.isInteger(lock.pid) || lock.pid <= 0) return true;
  if (!Number.isFinite(lock.startedEpochMs)) return true;
  let alive = false;
  try { process.kill(lock.pid, 0); alive = true; } catch (err) { alive = err?.code === 'EPERM'; }
  if (!alive) return true;
  return Date.now() - lock.startedEpochMs > HARD_LOCK_CEILING_MS;
}
export function isBundleLocked(okfHome) { return !isLockStale(readLock(okfPaths(okfHome).lock)); }

export function acquireLock(okfHome, holder, { onLog } = {}) { /* wx 생성 후 되읽어 token 확인(TOCTOU 재확인),
  stale이면 unlink 후 재시도, 최대 LOCK_ACQUIRE_MAX_ATTEMPTS. 반환 {acquired, recoveredFromStaleLock, token} */ }
export function releaseLock(okfHome, token) {
  const current = readLock(okfPaths(okfHome).lock);
  if (!current || (token && current.token !== token)) return false; // 남의 락은 지우지 않는다
  try { fs.unlinkSync(okfPaths(okfHome).lock); return true; } catch { return false; }
}
```

`bin/batch.mjs`에서 `:16 LOCK_ACQUIRE_MAX_ATTEMPTS`, `:175-183 tryAcquireOnce`, `:185-208 acquireLock`, `:210-212 releaseLock`을 **삭제**하고 `:917`을 `const lockResult = acquireLock(okfHome, 'batch', { onLog: (m) => log(okfHome, m) });`, `:1032`(finally)를 `releaseLock(okfHome, lockResult.token);`으로. **인자 없이 `releaseLock(okfHome)`을 두면 `(token && ...)` 단락 평가로 무조건 unlink가 되살아난다.**

2. **`lib/bootstrap.mjs`에 락 가드.** import에 `import { isBundleLocked } from './lock.mjs';`를 추가하고, `:72`(`ensurePrivateDir(paths.logs);`)와 `:74`(`let seeded = false;`) **사이**에 넣는다.

```js
  // 배치가 도는 중이면 여기서 멈춘다. 아래로 내려가면 git init(:78)·writeIfMissing(:85-87)이
  // seeded를 세워놓고 커밋(:115)에는 도달하지 못해, 가드가 막으려던 바로 그 dirty 트리를
  // 우리가 만든다. 디렉토리 보장만 하고 되돌아간다(디렉토리는 git이 추적하지 않는다).
  // 마이그레이션은 멱등이라 다음 세션이 한다. 판정은 lib/lock.mjs 하나로 통일한다.
  if (isBundleLocked(okfHome)) {
    log('배치 실행 중 — 번들 마이그레이션을 다음 세션으로 미룬다');
    return;
  }
```

위치가 요점이다. `git init` **뒤**에 두면 커밋 없는 dirty 트리를 남긴다. **`test/smoke.mjs:80-110`의 `runHook`이 훅 실행 전 살아있는 가짜 락을 심으므로, 이 릴리스부터 session-start 훅 안의 `ensureBootstrap`은 항상 조기 리턴한다.** 해당 5개 호출부(`:272, 293, 298, 318, 348`)는 전부 홈을 `bootstrapped(...)`로 미리 만들고 `regenerateIndex`까지 인프로세스로 돌린 뒤 훅을 부르므로 기존 단언은 영향받지 않는다(확인함). 새 훅 테스트를 쓸 때 "훅이 번들을 만들어 줄 것"을 전제하면 틀린다.

3. **archive 이동 방어 + `.archived` 마커.** `rollbackChunk`(`:701`) 아래에 추가하고 `:893-897`을 호출로 교체한다.

```js
const ARCHIVED_MARKER_SUFFIX = '.archived';
function archiveChunk(okfHome, chunk, todayDir) {
  // 커밋 뒤 아카이브 이동은 '이미 지불하고 이미 반영한' 다음에 오는 유일한 무방비 구간이었다(T2.2).
  // 실패해도 지식은 커밋돼 있고, 위험은 source가 staging에 남아 다음 회차가 재과금하는 것뿐이다.
  // 그래서 실패 시 마커를 남겨 '처리 완료됐으나 이동만 실패'로 구분한다.
  let allMoved = true;
  for (const dp of chunk) {
    tryUnlink(dp.digest);
    const dest = path.join(todayDir, path.basename(dp.source));
    try { fs.mkdirSync(todayDir, { recursive: true }); fs.renameSync(dp.source, dest); continue; }
    catch (err) { log(okfHome, `아카이브 이동 실패(커밋은 완료됨): code=${safeErrorCode(err)} — 복사 폴백 시도`); }
    try { fs.mkdirSync(todayDir, { recursive: true }); fs.copyFileSync(dp.source, dest); tryUnlink(dp.source); continue; } catch { /* 마커로 */ }
    try { fs.writeFileSync(`${dp.source}${ARCHIVED_MARKER_SUFFIX}`, '', { mode: 0o600 });
      log(okfHome, '아카이브 재시도 마커 기록 — 다음 회차가 LLM 호출 없이 이동만 재시도한다'); }
    catch (err) { log(okfHome, `아카이브 마커 기록 실패: code=${safeErrorCode(err)}`); }
    allMoved = false;
  }
  return allMoved;
}
```

`recoverStagingLeftovers`(`:335-358`)의 파일 루프를 마커 인지형으로 바꾼다. **마커 skip 분기를 `.jsonl` 분기보다 먼저** 두어야 else의 `tryUnlink(full)`이 마커를 먼저 지우지 않는다. 마커가 있는 `.jsonl`은 raw가 아니라 `_remove_candidate/<date>/`로 회수한다.

4. **NO-OP 판정을 마커 + AND 조건으로.** `applyAnalyzerWorkspace`(`:755`)의 반환을 `{ applied, blocked }`로 넓힌다(두 호출부가 지금 값을 버리고 있어 파급 0). `processChunkBody`(`:805`) 위에:

```js
const NOOP_MARKER = '.okf-noop';
function declaredNoOp(wsRoot, output) {
  try { if (fs.existsSync(path.join(wsRoot, NOOP_MARKER))) return true; } catch { /* 텍스트 폴백 */ }
  return output.trim() === 'NO-OP'; // 하위호환. substring이 아니라 완전일치를 유지한다
}
```

`:826-831`을 교체:

```js
    // NO-OP 선언은 '쓸 게 없었다'일 때만 유효하다. 분석기가 실제로 무언가를 썼는데(applied>0)
    // 또는 게이트가 그 산출물을 거부했는데(blocked>0) 마커가 있으면, 그건 NO-OP이 아니라
    // 실패이거나 오염된 digest의 지시를 따른 것이다 — 마커를 믿으면 지식이 조용히 archive된다.
    const noOpDeclared = applyResult.applied === 0 && applyResult.blocked === 0
      && declaredNoOp(wsRoot, ingestResult.output);
    if (!isDirty(paths.home) && !noOpDeclared) {
      log(okfHome, `청크 ${i + 1}: 무변경인데 NO-OP 마커·선언 모두 없음 — 쓰기 차단/유실 의심, 이 청크만 건너뛴다`);
      return { ok: false, fatal: false };
    }
```

`processChunkBody` 반환 계약을 `{ok, fatal}`로 바꾼다: ingest 실패 → `{ok:false, fatal:true}`(claude를 못 부르면 남은 청크도 15분씩 타임아웃만 태운다), NO-OP 판정 실패·repair 후 lint 실패 → `{ok:false, fatal:false}`, 성공 → `{ok:true}`.

마커 이름은 `.md`로 끝나면 안 된다 — `applyAnalyzerWorkspace`가 `.md`만 반영하므로 `.okf-noop.md`는 번들에 실린다. 그리고 로그 문구에서 `쓰기`·`NO-OP` 두 어절을 빼면 `test/smoke.mjs:608`이 깨진다.

5. **`processChunks`를 청크 독립 트랜잭션으로.** `:872-900` 교체 — 비치명 실패는 `rollbackChunk` 후 `continue`, 치명 실패만 중단. 반환은 `{succeededChunks, skippedChunks, aborted, reason}`. `:1021`의 구조분해와 `:1029`의 결과 문자열을 함께 고쳐라(안 고치면 `undefined/N chunks`가 상태에 들어간다).

6. **`updateLastBatch`에 `extra` 슬롯 + `blocked` 명시적 초기화.** `:903-908` 교체:

```js
function updateLastBatch(okfHome, result, extra = {}) {
  const paths = okfPaths(okfHome);
  const pendingAfter = safeReaddir(paths.raw).filter((f) => f.endsWith('.jsonl')).length;
  // blocked는 매 회차 명시적으로 null로 덮는다 — 해소된 뒤에도 옛 값이 남으면
  // /okf:okf-status가 이미 고쳐진 lint 실패를 영구히 보고한다.
  writePrivateJsonAtomic(paths.lastBatch, { lastRunEpochMs: Date.now(), lastResult: result, pendingAfter, blocked: null, ...extra });
  log(okfHome, `배치 종료: ${result} (잔여 raw: ${pendingAfter})`);
}
```

이것이 **R2와의 유일한 병합 지점**이다(§1.1.6). R2는 `extra`로만 얹는다.

7. **stale-lock 원복 전 백업 + `blocked` 표면화.** `handleDirtyWorkingTree` 위에 `backupDirtyTree(okfHome, runId)`를 추가한다 — `git status --porcelain -z`로 나열하고 `.okf/`를 제외한 추적 파일을 `_remove_candidate/<localDate>/pre-rollback-<runId>/`에 0600으로 복사한다. **날짜 디렉토리 아래**여야 `purgeRemoveCandidate`(`:419-431`)의 `/^\d{4}-\d{2}-\d{2}$/`가 회수한다. `--ignored`를 절대 붙이지 마라(전사 사본이 딸려온다).

`handleDirtyWorkingTree`는 `{ok, report}`를 반환하고, lint 실패 경로에서 `:948-952` 호출부가:

```js
      const prev = readLastBatch(okfHome);
      const since = prev?.blocked?.kind === 'pre-batch-lint' ? prev.blocked.since : Date.now();
      updateLastBatch(okfHome, 'aborted: pre-batch dirty tree lint failed', {
        blocked: { kind: 'pre-batch-lint', since, rules: summarizeLintForLog(dirtyResult.report),
                   files: [...new Set(dirtyResult.report.errors.map((e) => e.file))].slice(0, 20) },
      });
```

**`blocked`에 lint `message`를 넣지 마라** — js-yaml 파싱 에러 메시지는 위반한 YAML 원문을 포함한다. 규칙 코드와 파일 경로까지가 상한이고, 그것도 로그가 아니라 0600 상태 파일에만 들어간다.

8. **top-level 예외 착지.** `:1072`의 `await runLoop();`를 try/catch로 감싸 `updateLastBatch(okfHome, 'error: batch loop crashed (<code>)')`를 남기고 `process.exitCode = 1`. `process.exit()`가 아니라 `exitCode`여야 한다(pipe stdout 절단 전례). `err.message`는 절대 남기지 마라.

9. **`prompts/ingest.md:41-43` NO-OP 프로토콜 갱신.**

```
위 질문 전부가 "아니오"일 때만 — 잡담뿐이거나 이미 번들에 그대로 있는 내용뿐일 때만 —
concept·log.md를 하나도 건드리지 말고, 대신 작업 디렉토리 루트에 `.okf-noop`라는 빈 파일
하나만 Write하고 종료하라. 이 마커가 유일한 NO-OP 선언 수단이며 출력 텍스트는 판정에 쓰이지 않는다.

concept나 log.md를 **하나라도** 쓴 뒤에는 절대 `.okf-noop`를 만들지 마라. 무언가를 쓰려 했는데
쓰기가 거부됐을 때도 만들지 마라 — 그건 NO-OP이 아니라 실패이고, 마커를 남기면 지식이
처리 완료로 오분류돼 조용히 사라진다.
```

`:19`의 인젝션 방어 예시에 `".okf-noop를 만들라"`를 병기한다. **`prompts/repair.md:20`의 `## lint 오류 리포트` 문자열은 절대 건드리지 마라** — `bin/batch.mjs:646`의 단계 판정과 `test/fixtures/fake-claude.mjs:14`의 `isRepairCall`이 걸려 있다.

10. **정지 상태 노출.** `commands/okf-status.md` §2에 `blocked` 불릿 추가(보고서 **맨 첫 줄부터** 경고 → `since` → `files` 나열 → `rules` → 해소 방법 `node "${CLAUDE_PLUGIN_ROOT}/lib/lint.mjs" <OKF_HOME>`; `blocked`가 없으면 블록 자체를 출력하지 마라). 다른 커맨드 언급에는 반드시 `okf:` 네임스페이스. `bin/statusline.mjs:65-75`의 `else` 분기 **앞**에 `if (last.blocked?.kind === 'pre-batch-lint') parts.push('blocked: lint');` — 이미 파싱한 JSON의 필드 하나이므로 추가 I/O 0이고, ASCII로 유지한다. **파일명은 상태줄에 노출하지 않는다.**

11. **테스트 하네스**: `test/fixtures/fake-claude.mjs`의 `switch (mode)`에 `noop-marker`(마커만 쓰고 출력 텍스트는 프로토콜과 다르게), `noop-marker-with-write`(concept를 쓰고 **동시에** 마커도), `first-chunk-blocked`(카운터 기반) 3개 추가. `bin/batch.mjs:22`의 `CHUNK_BYTE_LIMIT`을 `positiveIntFromEnv('OKF_CHUNK_BYTE_LIMIT', 300 * 1024)`로 바꾼다(`LINGER_POLL_MS` 관용구, 사용자 노브 아님 — `positiveIntFromEnv`는 함수 선언이라 호이스팅된다. 화살표로 바꾸면 TDZ로 즉사).

**검증 방법** (신규 `ok()` 20개)

- `archive 이동 실패는 예외로 배치를 죽이지 않는다` / `archive 실패 세션은 다음 회차에 재과금되지 않는다`
  - 픽스처: `_remove_candidate/<localDate>` 경로에 **디렉토리가 아니라 파일**을 만들어 `mkdirSync`가 던지게 한다(chmod 없이 3-OS 공통). 카운터로 2회차 호출 0회 확인.
- `runLoop 예외는 unhandled rejection이 아니라 로그로 착지한다` — `lastBatch` 경로를 디렉토리로 만들어 rename을 EISDIR로 강제. 단언: 로그에 `배치 루프 예외 종료` 포함, `!logs.includes('EISDIR: illegal')`, exit ≠ 0.
- `NO-OP은 마커 파일로 선언한다 — 출력 문구와 무관하다` — `FAKE_CLAUDE_MODE:'noop-marker'`, raw 0 / archive 1 / `lastResult === 'ok'` / 커밋 증가 0.
- `concept를 쓰고 마커도 남긴 회차는 NO-OP이 아니라 실패다` — `noop-marker-with-write`, raw로 되돌아오고 archive 0. **마커 프로토콜이 여는 새 유실 경로의 회귀 고정.**
- `전량 차단된 워크스페이스에 마커가 있어도 실패로 판정된다` — `hostile-workspace` 변형(`blocked>0, applied===0` + 마커).
- `한 청크의 프로토콜 실패가 나머지 청크를 죽이지 않는다` — 2세션 + `OKF_CHUNK_BYTE_LIMIT:'1'` + `first-chunk-blocked`. archive 1 / raw 1 / `partial: 1/2 chunks` / 로그에 `건너뜀`.
- `stale-lock 원복 전에 dirty 파일이 _remove_candidate 아래로 백업된다` / `백업본이 원본 바이트를 보존한다`
  - **`listRemoveCandidate`는 `<날짜디렉토리>/<엔트리명>`을 반환하고 재귀하지 않는다.** 따라서:
    ```js
    const dateDir = path.join(okfPaths(home).removeCandidate, new Date().toLocaleDateString('en-CA'));
    const backupDirs = (fs.existsSync(dateDir) ? fs.readdirSync(dateDir) : []).filter((n) => n.startsWith('pre-rollback-'));
    ok('stale-lock 원복 전에 dirty 파일이 _remove_candidate 아래로 백업된다', backupDirs.length === 1);
    ok('백업본이 원본 바이트를 보존한다', backupDirs.length === 1
      && readIfExists(path.join(dateDir, backupDirs[0], 'decisions', 'crash-remnant.md')).includes('크래시 잔여물'));
    ```
- `pre-rollback 백업은 remove_candidate TTL로 회수된다` — 날짜 디렉토리를 31일 전 이름으로 바꾸고 배치 1회 → 디렉토리 소멸.
- `releaseLock은 남의 락을 지우지 않는다` / `손상된 락 페이로드는 stale로 판정된다(영구 정지 방지)` / `구버전 락 페이로드 3종의 판정이 바뀌지 않는다`
  - 마지막 것: `test/smoke.mjs:87`(runHook 임시 락) / `:735`(dead PID) / `:998`(alive+5h)의 `{pid, startedEpochMs}` 페이로드가 각각 alive/stale/stale로 **기존과 동일**한지 직접 단언.
- `살아있는 다른 홀더의 락이 있으면 배치는 유료 호출 없이 물러난다` — `holder:'deprecate'` 락 심고 카운터 파일 미생성 + raw 보존. **S4가 배치와 공존한다는 계약의 배치 쪽 절반.**
- `pre-batch lint 실패가 상태 파일에 구조화돼 남는다` / `lint를 고치면 blocked 상태가 해소된다`
- `상태 커맨드가 lint로 멈춘 배치를 최상단에 보고하도록 지시한다` — `statusCommand.includes('blocked')` 등. **프롬프트 텍스트 단언은 행동 단언의 프록시임을 주석에 명시**(`test/smoke.mjs:1152-1160` 관용구).
- `statusline은 lint 정지를 ok/실패와 구분해 표시한다` — 출력에 `blocked: lint` 포함, `decisions/x.md` **미포함**.
- `bootstrap이 살아있는 락 아래에서 dirty 트리를 남기지 않는다` / `빈 홈 + 살아있는 락에서도 dirty가 0이다`
  - 두 번째가 가드 이동의 회귀 가드다(빈 홈 = `git init`조차 안 된 상태).

**통과 규칙**

- 기준선 320 → **340 passed, 0 failed**, exit 0, 3-OS.
- archive 실패 픽스처에서 **2회차 배치의 claude 호출 = 0회**, 해당 세션의 `_remove_candidate/` 사본 **정확히 1**, `raw/` 잔여 **0**. 같은 세션의 유료 ingest 총 횟수 **1회 이하**(현행 2회).
- 2청크 픽스처(첫 청크 차단): 처리 완료 **1/2**, archive **1**, raw **1**, 유료 호출 **≤ 2**(현행: 0/2, archive 0, raw 2).
- NO-OP 마커 픽스처: raw 잔여 **0**, `lastResult === 'ok'`, 커밋 증가 **0**. 동시에 `blocked-mentions-noop` 픽스처의 raw 잔여는 **1 유지**(substring 오판 0건), `noop-marker-with-write`의 raw 잔여 **1**(오분류 0건).
- stale lock 회수 회차: dirty 추적 파일 **100%(1/1)** 가 `_remove_candidate/<date>/pre-rollback-<runId>/`에 바이트 동일 사본으로 남고, 원복 후 `git status --porcelain` **0줄**.
- pre-batch lint 실패 회차: claude 호출 **0회**, `blocked.files`가 실제 에러 파일을 **100% 포함**, 해소 후 `blocked === null` + `lastResult === 'ok'`.
- 락: 동시 배치 2개 → archive **정확히 1**, 유료 호출 **≤ 2**, 락 잔존 **0**(R0 테스트가 그대로 통과). 구버전 페이로드 3종 판정 변화 **0건**.
- bootstrap 가드: 살아있는 락에서 `ensureBootstrap` 5회 → SCHEMA 바이트 변화 0, index 바이트 변화 0, `git status --porcelain` 0바이트, 커밋 증가 0. **빈 홈 + 살아있는 락에서도 dirty 0바이트.**
- 프라이버시: 이 패키지가 추가한 모든 로그 줄에 전사 파생 문자열 0건 — 기존 redaction 단언 3종 전부 통과. `blocked`에 lint message 0회.
- `runLoop` 예외 주입 시 stderr에 `UnhandledPromiseRejection` **0회**.

**선행·롤백**: 선행 **R0**(동시 프로세스 경합 테스트 — reliability §5 항목 11이 명시한 조건). 단일 커밋 `git revert`. 잔재 2가지 모두 자기 치유: (a) staging의 `.archived` 마커 — 구버전은 `.jsonl`이 아닌 파일을 unlink하고 짝을 raw로 되돌리므로 최대 1건이 1회 재ingest된다(되돌리기 전 `find <OKF_HOME>/.okf/staging -name '*.archived'` 확인 권장), (b) 락 페이로드의 `holder`/`token` — 구버전 `readLock`은 미지 필드를 무시하고 `releaseLock`은 무조건 unlink라 호환. `blocked` 필드도 소비자 전부가 필드명 접근이라 무시된다. 부분 롤백 단위 3개: 락(단계 1–2), NO-OP(단계 4·9 — 프롬프트만 되돌려도 텍스트 폴백이 살아 있다), 표시 계층(단계 10).

---

#### R2 — 비용 가시화 · `batch_max_usd_per_day`(기본 0 = 무제한)

**목표**: Claude CLI가 `--output-format json`으로 **이미 무료로** 돌려주는 `total_cost_usd`/`usage`/`num_turns`를 `runClaude`가 호출자에게 전달하게 하고(성공뿐 아니라 **지불 후 실패한 경로에서도**), 회차 단위로 합산해 `.okf/last-batch.json`에 기록하고, 로그·statusline·`/okf:okf-status`에 노출한다. 동시에 일일 상한 키를 추가하되 **기본값은 0(무제한)** — 사용자 결정대로 비용은 *보이게* 하되 기본 차단은 걸지 않는다. 상한 게이트는 spawn 시점이 아니라 `runBatch()` 회차 진입부에 둬서 링거 루프까지 덮는다.

**근거**: reliability §5 항목 2 + T11.1(runClaude가 이미 쥔 값을 `{ok,output}`만 반환하며 버린다 — `bin/batch.mjs:600,637,651,665`), T11.2(v4 체인 배치 60회 전부 non-null, 합계 $25.8086, 중앙값 $0.4423/회; 픽스처가 이미 `total_cost_usd: 0.001`을 낸다 — 무과금 회귀 테스트 가능), T11.3(라이브 로그 263줄에 cost/usd/token 0건), T11.4(35회 중 최소 10회가 지불 후 롤백, 금액 미기록), T11.5(`batch_interval_hours`는 `lib/batch-gate.mjs:28` spawn 시점에만 있고 `runBatch()` 내부에 천장 없음 → 8시간 링거 × 5분 폴링), T11.7(usage JSONL 필드명에 `result` 금지 — `test/smoke.mjs:553`), T11.8(statusline은 이미 `last-batch.json`을 파싱 → 추가 I/O 0).

**구현 방안**: R3의 시그니처를 정본으로 삼고 **비용은 `extra`로만 얹는다**. 죽은 코드를 복제하지 않는다 — `normalizeConfig`(`lib/config.mjs:68-83`)가 이미 잘못된 값을 기본값으로 되돌리므로 사용 지점의 재검증 분기는 결코 발화하지 않는다(기존 `batch_max_digest_kb` 관용구가 그 예다). 상한은 **best-effort 가드**이며 그 한계를 문서에 정직하게 적는다.

**구현 방법**

1. **`extractSpend` 헬퍼 + 벤치 블록 정리.** `runClaude`(`:569`) 위에 순수 함수를 두고, `:637-659` 벤치 JSONL 블록의 `numericUsage` 지역 계산을 이 값으로 대체한다. `costUsd`는 **null과 0을 구분**한다(0 = 안 썼다, null = 얼마 썼는지 모른다). `models: Object.keys(result?.modelUsage || {})`는 그대로 둔다(`test/smoke.mjs:552`가 배열 `includes`로 단언).

2. **`runClaude` 4개 반환 경로 전부에 spend를 실어 보낸다.** `:624-626`(JSON 파싱 실패) → `costUsd: null`, `:660-664`(CLAUDE_INCOMPLETE) → `...spend`(파싱됐으므로 금액을 안다), `:665`(성공) → `...spend`, `:666-668`(throw) → `costUsd: null`. **`spend`는 `JSON.parse` 성공 이후 스코프에서만 유효하다** — 1번·4번 경로에서 `...spend`를 쓰면 TDZ다.
   - S1이 같은 확장을 한다. **S1이 먼저 착지하면(릴리스 2) 이 단계는 이미 되어 있다** — 필드명(`{ok, output, costUsd, usage, model, numTurns}`)을 그대로 쓰고 중복 구현하지 마라. 릴리스 1이 먼저이므로 실제로는 R2가 정의하고 S1이 `model` 필드만 additive로 더한다.

3. **회차 지출 누계기.** `rollbackChunk`(`:700`) 위에 `createSpendAccumulator()` / `accrueSpend(acc, claudeResult)` / `roundUsd(v)`. 누적은 **가변 객체를 통과**시킨다 — `processChunks`의 catch가 `processChunkBody`를 삼켜도 누계가 살아남는다. `accrueSpend`는 반드시 `if (!ok) return` **앞**에 둔다. 회차당 최대 4회(청크 2 × 청크당 2)가 누적 상한이다.

4. **`updateLastBatch`에 비용을 `extra`로 얹는다.** R3의 정본 시그니처를 건드리지 않고 헬퍼 하나만 추가한다:

```js
function spendExtra(okfHome, spend) {
  const today = localDateString();
  const carried = readSpendToday(okfHome, today);
  const runCost = Number.isFinite(spend?.costUsd) ? spend.costUsd : 0;
  return { costUsd: roundUsd(runCost), spendTodayUsd: roundUsd(carried + runCost), spendDate: today,
           tokens: { ...(spend?.usage ?? {}) }, llmCalls: spend?.calls ?? 0, unpricedCalls: spend?.unknownCalls ?? 0 };
}
```

5개 호출부는 `updateLastBatch(okfHome, result, spendExtra(okfHome, spend))`, R3의 lint 정지 경로는 `{ ...spendExtra(okfHome, spend), blocked: {...} }`. `readSpendToday`는 파손·부재 시 0을 반환한다(fail-open — 파일 하나 때문에 배치가 영구 정지하면 안 된다).

5. **설정 키.** `lib/config.mjs` `DEFAULT_CONFIG`에 `batch_max_usd_per_day: 0,`(주석: "0 = 무제한(기본). 켤 때의 눈금: v4 체인 실측 중앙값 $0.4423/회이므로 2.0이면 대략 4~5회차"), `VALIDATORS`에 `batch_max_usd_per_day: finiteNumber(0, 1000),`(정수 강제 안 함 — 센트 단위가 의미 있다).

6. **회차 게이트.** `purgeRemoveCandidate(...)`(`:954`)와 `snapshotRaw`(`:956`) **사이**. 위치가 요점이다 — 수집(무료)은 계속 돌아야 7일 창을 넘긴 transcript가 영구 소실되지 않는다.

```js
    // normalizeConfig(lib/config.mjs:68-83)가 이미 잘못된 값을 기본값으로 되돌린 뒤다 —
    // 여기서는 0=무제한 의미만 코드로 못박는다(재검증 분기는 발화하지 않는 죽은 코드다).
    const capUsd = config.batch_max_usd_per_day; // 0 = 무제한
    const spendBeforeUsd = readSpendToday(okfHome);
    if (capUsd > 0 && spendBeforeUsd >= capUsd) {
      log(okfHome, `일일 지출 상한 도달 ($${spendBeforeUsd.toFixed(4)} / $${capUsd}) — LLM 호출 없이 종료`);
      updateLastBatch(okfHome, 'skipped: daily spend cap', spendExtra(okfHome, spend));
      // freshPending 0으로 링거를 끝낸다 — 5분마다 이 경로를 밟으면 상태 파일을 96번 다시 쓴다.
      return { acquiredLock: true, freshPending: 0 };
    }
```

7. **청크 루프 중간 재검사.** R3의 `processChunks`에 `spend`/`capUsd`/`spendBeforeUsd` 인자를 추가하고, 루프 안 `i > 0`일 때만 재검사한다(진입 게이트를 통과한 회차는 최소 1청크는 처리해야 backlog가 줄어든다 — `applyDigestBudget:521`의 '최소 1개는 항상 통과'와 같은 논리). 이월은 **`returnChunkToRaw`(git 미접촉)** 로 — `rollback()`을 부르면 이미 커밋된 앞 청크와 무관한 변경까지 날린다. R3의 `reason`을 확장해 `'spend-cap'`을 쓰고 **새 필드를 만들지 마라**.

8. **statusline.** `bin/statusline.mjs:66-72`의 try 블록 안, `relTime` 다음 줄에 오늘 지출이 0보다 클 때만 `parts.push(\`$${last.spendTodayUsd.toFixed(2)} today\`)`. 날짜는 `toLocaleDateString('en-CA')`(batch의 `localDateString`과 같은 규칙).

9. **fake-claude**: `FAKE_CLAUDE_COST_USD`(주입, `Number.isFinite` 아니면 0.001 폴백 — `Number('')`는 0이라 빈 문자열 금지), `badjson` 모드(stdout이 JSON이 아님 → `CLAUDE_INVALID_JSON` 경로). `usage.*`와 `modelUsage`는 고정값 유지.

10. **문서 6표면**: `templates/config.md`(+ `:3`,`:7`의 "실제 비용 상한" → "LLM 입력 크기 상한" 정정), `commands/okf-config.md` **키 설명 절과 안전 범위 절 양쪽**, `docs/USAGE.md` 표, README 8종. 그리고 상한의 한계를 정직하게: **"이 상한은 `.okf/last-batch.json`의 당일 누계에 근거한다 — 그 파일이 지워지거나 손상되면 누계가 0에서 다시 시작하고, 배치가 SIGKILL로 죽으면 그 회차 지출은 누계에 잡히지 않는다. 하드 과금 차단이 아니라 best-effort 가드다."**

11. `commands/okf-status.md` §2에 비용 필드 보고 규칙 + §3 예시 한 줄(`- 지출: 이번 회차 $0.43 / 오늘 누계 $1.72 (호출 2회, 토큰 in 41,203 / out 3,884)`). 필드가 없으면 "비용 기록 없음(다음 배치부터 기록됨)"으로 밝히라고 명시.

**검증 방법** (신규 explicit 17 + 자동 생성 1 = 18)

`batch records the round cost in last-batch.json` / `... token usage alongside the dollar cost` / `spendTodayUsd is scoped to the local date` / `a run that paid and then rolled back still records the spend`(`FAKE_CLAUDE_MODE:'blocked'`) / `an incomplete claude result still carries its paid cost`(`maxturns`) / `an unparseable claude result counts as an unpriced call`(`badjson` → `costUsd` 0이 아니라 `llmCalls===1 && unpricedCalls===1`) / `daily spend accumulates across rounds in the same local day` / `a new local day resets the daily spend counter`(어제 누계 $99가 오늘 상한 $0.5를 막지 않는다) / `batch_max_usd_per_day defaults to 0 (unlimited)` / `the unlimited default never skips a round no matter the cost`(`FAKE_CLAUDE_COST_USD:'10'` × 3회차 → 스킵 0회, 누계 30) / `daily spend cap skips the next round with zero paid calls`(카운터 파일 라인 0) / `a capped round leaves queued sessions in raw/ and commits nothing` / `mid-run cap defers the remaining chunks back to raw/`(2청크, 유료 호출 1회, archive 1 / raw 1, `git status --porcelain` 빈 문자열) / `batch end log reports the round cost as digits only`(`!logs.includes(home)`) / `a corrupt last-batch.json does not block the next batch` / `deleting last-batch.json resets the daily ledger (known limitation)`(**알려진 한계를 고정하는 테스트** — 지금은 '지불한 것은 전부 남는다'는 잘못된 인상을 준다) / `DEFAULT_CONFIG and VALIDATORS declare the same keys`(`Object.keys(DEFAULT_CONFIG).length === Object.keys(VALIDATORS).length`).

`spendDate`의 로컬성은 `TZ=Asia/Seoul`을 자식 env로 넘겨 `spendDate === new Date().toLocaleDateString('en-CA')`로 확인한다(3번 단언에 포함).

**통과 규칙**

- 기준선 340 → **358 passed, 0 failed**, exit 0, 3-OS.
- fake-claude 기본값 픽스처: `costUsd === 0.001`, `tokens.input_tokens === 100`, `llmCalls === 1`, `unpricedCalls === 0` — 오차 0(`roundUsd` 4자리 고정).
- **success / blocked(롤백) / maxturns(INCOMPLETE) 3경로 전부** `costUsd === 0.001 && llmCalls === 1`. 지불 후 실패 회차의 비용 기록 누락 **0건**.
- `batch_max_usd_per_day: 0.0005`, 누계 $0.001인 상태에서 다음 회차 claude 실행 **정확히 0회**, `raw` 세션 손실 **0**.
- 기본 설정에서 `FAKE_CLAUDE_COST_USD=10` × 3회차 → `skipped:`로 시작하는 회차 **0회**, `spendTodayUsd === 30`.
- 2청크 픽스처 상한 초과: 유료 호출 **정확히 1회**, archive 1 / raw 1, `git status --porcelain` 빈 문자열.
- `Object.keys(DEFAULT_CONFIG).length === Object.keys(VALIDATORS).length === 17`(15 + `sweep_backfill_days` + `batch_max_usd_per_day`; R1과 순서 무관하게 최종 17).
- `grep -c batch_max_usd_per_day`가 README 8종 전부에서 ≥1, `docs/USAGE.md`·`templates/config.md`·`commands/okf-config.md`(**양쪽 절**)에서 각각 ≥1 — 동기화 누락 표면 **0개**.
- 비용 로그에 세션 UUID·전체 경로·시크릿 **0건**, 기존 redaction 단언 3종 통과.
- 대용량 2청크 픽스처 블록이 `fs.rmSync(home, {recursive:true, force:true})`로 자기 뒷정리를 한다(실행 시간 규칙은 머신 의존이라 쓰지 않는다).

**선행·롤백**: 선행 **R3**(시그니처 소유자). `git revert`. 잔재: (a) `last-batch.json`의 비용 필드 — 구버전 `updateLastBatch`가 통째 덮으므로 다음 배치 1회에 자동 소멸, (b) 사용자 config.md의 키 — `unknown_key` 경고 한 줄(동작 무해). **1차 대응은 코드 revert가 아니라 설정 0으로 되돌리기다** — 기본값이 0이라 게이트는 `capUsd > 0`에서 완전히 비활성화되고 가시화만 남는다. `templates/config.md`의 "실제 비용 상한 → 입력 크기 상한" 문구 정정은 사실 정정이므로 되돌리지 말고 유지한다.

---

#### R1 — 캡처 경계 확정: 설치 하한 · glob 제외 루트 · 내장 제외

**목표**: "수집은 사용자가 동의한 범위 안에서만 일어난다"를 코드가 지키게 한다. 세 구멍: (1) `matchGlob`이 `<p>/**`를 `<p>` 자신에 매치하지 않아 유일한 옵트아웃이 가장 흔한 경우를 못 막는다, (2) 설치 버튼 한 번에 지난 7일치 전 프로젝트 대화가 유료 배치로 나간다, (3) OKF 자신의 벤치·워크트리 세션이 수집된다.

**근거**: reliability §5 항목 1 + T1.1(설치 직후 첫 SessionStart가 `lastRunEpochMs=0`으로 인터벌을 통과 — 저자 로그 실증 16/10/37/183개 회수, 8청크 유료 호출, 전부 NO-OP. 유일한 옵트아웃 `capture_exclude_cwd` 기본 `[]`이고 config.md는 **바로 그 SessionStart에서 처음 생성**되므로 설정할 창이 물리적으로 없다), T1.2(`lib/glob.mjs:5-26` — 실행 확인: `matchGlob('/Users/me/secret', ['/Users/me/secret/**']) === false`, 하위 경로는 true. 스모크는 하위만 봐서 못 잡았다), T1.3(라이브 `_remove_candidate/` 443개 중 실사용 21~27개 = 5~6%), T1.4(`isOkfTestSessionDir`가 TEMP_CWD **AND** 픽스처명 교집합이라 `~/side_project/okf-system/.claude/worktrees/bench-v4`가 통과).

**구현 방안**: 세 구멍 중 (2)가 가장 위험하지만 **기존 사용자에게 조용한 유실을 만들면 안 된다.** 마커는 신규 번들에서만 '지금'이고 기존 번들에서는 git 루트 커밋으로 소급하며, **소급된 마커는 7일 창을 절대 좁히지 않도록 클램프한다**. (3)은 목록을 **임시 경로/워크트리/번들 경로로 한정**한다 — 일반적인 `okf-*` 이름을 무조건 막으면 사용자의 진짜 프로젝트가 **끌 방법 없이** 배제된다.

**구현 방법**

1. **`lib/glob.mjs` 트레일링 `/**` 분기.** `globToRegExp`의 for 루프 최상단(`const c = normalized[i];` 다음, `if (c === '*')` 앞):

```js
    // `<p>/**`는 "<p> 자신과 그 하위 전체"다. 기존 변환은 `/`를 리터럴로 남겨 cwd가 정확히
    // 제외 루트인 세션(=가장 흔한 경우)이 통과했다(T1.2). 패턴 **끝**의 `/**`만 바꾼다 —
    // 중간의 `/**/`는 기존 의미를 그대로 둔다.
    if (c === '/' && normalized.startsWith('/**', i) && i + 3 === normalized.length) { re += '(?:/.*)?'; i += 2; continue; }
```

실행 검증표: 루트 true / 하위 true / 형제 접두 `secretive` false / 기존 4패턴(`/a/**/b`, `**`, `**/x`, `/p`) 회귀 0.

2. **`lib/paths.mjs`**: `okfPaths` 반환에 `installedAt: path.join(state, 'installed-at.json'),` 추가(`:8-10` 주석이 규정한 대로 새 상태 파일은 슬롯을 먼저 만든다). 그리고 `isOkfTestSessionDir` 아래:

```js
// isOkfTestSessionDir(:53-59)가 TEMP_CWD **AND** 픽스처명 교집합인 이유(같은 파일 주석)를
// 여기서도 지킨다 — 일반적인 okf-* 이름은 임시 경로 아래일 때만 제외한다. 그러지 않으면
// 사용자의 실제 프로젝트(~/work/okf-benchmark-harness 등)가 끌 수 없이 조용히 배제된다.
// 의도적으로 제외하지 않는 것: okf-system 저장소의 메인 체크아웃(진짜 사용자 작업이다).
export const BUILTIN_EXCLUDE_CWD = [
  '**/okf-system/.claude/worktrees/**',
  '**/.claude/worktrees/okf-*/**',
  '**/.claude/okf/**',
  '/tmp/okf-*/**', '/private/tmp/okf-*/**', '/var/folders/**/okf-*/**',
  '**/AppData/Local/Temp/okf-*/**',
];
```

**`DEFAULT_CONFIG.capture_exclude_cwd`의 기본값으로 넣지 마라** — (a) `normalizeConfig`는 키 단위 대체라 사용자가 자기 목록을 쓰는 순간 내장 제외가 사라지고, (b) `bin/batch.mjs:292`의 fail-closed 분기가 `length > 0`로 켜져 **모든 사용자에게** 'cwd 미확인 = 수집 보류'가 켜진다.

3. **`lib/installed-at.mjs` 신설.** `resolveInstalledAt(okfHome, bundleExisted)` → `{installedAtEpochMs, source}`. `source`는 `'bootstrap' | 'git-root-commit' | 'last-batch'`. git 조회는 `git(['log','--max-parents=0','--format=%ct','HEAD'], okfHome)` — **`rev-list --format`은 `commit <sha>` 줄이 섞이므로 쓰지 마라**(실행 확인). `%ct`는 **초**다 — `* 1000`을 빠뜨리면 하한이 1970년이 되어 기능이 통째로 무효화되고 아무 테스트도 못 잡는다.

```js
export function readInstalledAt(okfHome) {   // 항상 {installedAtEpochMs, source}를 준다
  try { const p = JSON.parse(fs.readFileSync(okfPaths(okfHome).installedAt, 'utf8'));
        if (Number.isFinite(p?.installedAtEpochMs) && p.installedAtEpochMs > 0) return p; } catch { /* 재계산 */ }
  return resolveInstalledAt(okfHome, fs.existsSync(okfPaths(okfHome).git));
}
```

**null을 절대 반환하지 마라** — 재계산 폴백이 곧 fail-closed 보장이다. 마커 쓰기가 실패한 신규 번들에서 재계산은 'git 커밋 없음 → now'가 되어 그 회차는 아무것도 수집하지 않는다(안전한 방향).

4. **`lib/bootstrap.mjs`**: `:74-83`의 git init 블록에서 `const bundleExisted = fs.existsSync(paths.git);`를 뽑고, git init **뒤** / `seedConcepts`(`:105`) **앞**에 `ensureInstalledAt(okfHome, bundleExisted);`. `seeded`를 세우지 마라(`.okf/`는 gitignored라 커밋할 것이 없다).

5. **설정 키** `sweep_backfill_days: 0` + `finiteNumber(0, 30, true)`. 주석: "0 = 설치 이후만(기본). `SWEEP_LOOKBACK_DAYS`(7일) 창은 그대로라 7 초과는 추가 효과가 없다."

6. **sweep cutoff에 하한 + 클램프.** `bin/batch.mjs:257-261` 교체:

```js
  const windowStartMs = Date.now() - SWEEP_LOOKBACK_DAYS * 86400_000;
  const marker = readInstalledAt(okfHome);
  // 이번 릴리스 이전부터 있던 번들(git-root-commit/last-batch로 소급된 마커)에서는 하한이
  // 기존 7일 창을 좁히면 안 된다 — 루트 커밋이 7일 이내인 번들에서 4~7일 전 미처리
  // transcript가 영구 배제되기 때문이다(SWEEP_LOOKBACK_DAYS는 하드 창이라 다시 오지 않는다).
  const rawFloorMs = marker.installedAtEpochMs - config.sweep_backfill_days * 86400_000;
  const installFloorMs = marker.source === 'bootstrap' ? rawFloorMs : Math.min(rawFloorMs, windowStartMs);
```

`readInstalledAt`은 **루프 밖에서 회차당 1회**만 부르고 `scanOrphanSessions(okfHome, config, collect, installFloorMs)`로 넘긴다 — 링거 probe(`:1065`, `LINGER_POLL_MS` 주기)도 같은 값을 재사용해야 마커 쓰기가 실패한 번들에서 8시간 동안 5분마다 git 서브프로세스가 뜨지 않는다.

`:282`를 세 줄로 나누고(7일 창 / 설치 하한 각각 카운트), `:289`(`samePath`) 다음·`:290`(`capture_exclude_cwd`) **앞**에 내장 제외를 넣는다. 내장 제외는 fail-closed 분기를 켜지 않는다(프라이버시 약속은 사용자 목록 쪽의 것이고 내장 목록은 위생 필터다).

로그 2줄 추가 — **개수와 설정값만**, 경로·세션ID 금지. 내장 제외는 진단을 위해 **매칭된 패턴 인덱스**(경로 아님)를 남긴다.

7. **기존 sweep 픽스처 8개 보호.** `test/smoke.mjs`에 헬퍼를 추가하고, `fs.utimesSync`로 mtime을 과거로 미는 8개 블록(`:641, 661, 748, 858, 893, 915, 935, 955`)의 `writeConfig` 직후에 `installedLongAgo(home);`를 넣는다.

```js
// 설치 하한은 "mtime을 과거로 밀어 유휴를 만든다"는 기존 픽스처 관용구와 정면으로 부딪힌다.
// 이 헬퍼는 "이 번들은 오래전에 설치됐다"를 만들어 그 픽스처들이 원래 검사하려던 축만 남긴다.
function installedLongAgo(okfHome, daysAgo = 30) {
  fs.writeFileSync(okfPaths(okfHome).installedAt,
    JSON.stringify({ installedAtEpochMs: Date.now() - daysAgo * 86400_000, source: 'test-fixture' }));
}
```

**'비수집을 기대하는' 4개 블록(exclude-failclosed / sweep-exclude / bench-isolated-sweep / batch-cwd)에 헬퍼를 안 넣으면 테스트는 계속 통과하지만 원래 검사하려던 필터를 더 이상 검증하지 않는다** — 설치 하한이 먼저 막아 공허하게 참이 된다. 이 단계에서 가장 놓치기 쉬운 함정이다.

8. **문서 11파일**: `templates/config.md`, `commands/okf-config.md`(키 설명 + 안전 범위), `docs/USAGE.md`, README 8종. quick start에 "설치 **이후** 대화만 수집됩니다" 한 문장, privacy 절에 bullet 3개(설치 시각 마커 / `<p>/**`가 루트도 제외 / OKF 자신의 개발·벤치·테스트 작업 디렉토리는 설정과 무관하게 제외되며 **저장소 메인 체크아웃은 제외되지 않는다**).

**검증 방법** (신규 explicit 14 + 자동 생성 1 = 15)

`capture_exclude_cwd <p>/** excludes the pattern root itself` / `... still excludes descendants and never a sibling prefix` / `설치 이전 transcript 20개는 기본 설정에서 한 건도 수집되지 않는다`(mtime 2일 전 × 20, `listRaw`·`listRemoveCandidate` 둘 다 0) / `설치 이전만 있는 회차는 유료 호출 없이 noop으로 끝난다`(`lastResult === 'noop'` **그리고 `FAKE_CLAUDE_DUMP_ARGV_TO` 파일 미생성**) / `sweep_backfill_days=7이면 같은 20개가 전부 수집·처리된다` / `fresh bootstrap records the install floor as its own moment`(+ POSIX 0600) / `기존 번들의 설치 시각은 번들 git 루트 커밋에서 소급된다`(`installedAtEpochMs === %ct × 1000` — 초→ms 실수까지 잡는다) / `업그레이드 번들(루트 커밋 30일 전)은 7일 창 안의 세션을 계속 수집한다`.

그리고 **클램프가 없으면 반드시 실패하는 회귀 테스트**:

- `설치 3일 된 기존 번들에서 4일 전 세션이 여전히 수집된다(7일 창 불변)`
  - 픽스처: `bootstrapped('installed-at-recent-upgrade')` → 마커 삭제 → `git commit --amend --no-edit`로 루트 커밋을 **3일 전**으로(`GIT_COMMITTER_DATE`/`GIT_AUTHOR_DATE` 둘 다 필수, `%ct`는 committer date) → `ensureBootstrap` → fakeHome projects/에 **4일 전** mtime transcript 1개 → `runBatch`.
  - 단언: `listRemoveCandidate(home).some((f) => f.includes(sessionId))`. 30일 전 케이스만으로는 `Math.max()`가 하한을 무력화해 **문제가 발생하는 구간을 정확히 비켜간다**.

`sweep이 OKF 자신의 벤치 워크트리 세션을 기본으로 수집하지 않는다` / **`내장 제외가 사용자의 실제 okf-* 프로젝트를 막지 않는다`**(cwd `/Users/t/work/okf-benchmark-harness` — 임시 경로 아님 — 이 수집되는지. 과차단 대조군) / `내장 제외 로그는 개수와 패턴 인덱스만 남긴다`(`!logs.includes('worktrees')`) / `마커 기록이 실패해도 배치가 fail-closed로 끝난다`(`.okf`를 읽기 전용으로) / `sweep_backfill_days가 7을 넘어도 7일 창이 상한으로 남는다`(30으로 설정 후 10일 전 transcript 미수집).

`config-invalid` 픽스처에 `sweep_backfill_days: -1` 추가 → 자동 생성 테스트 1개 + `warnings.length >= Object.keys(DEFAULT_CONFIG).length` 경계 유지.

**통과 규칙**

- 기준선 358 → **373 passed, 0 failed**, exit 0, 3-OS.
- 신규 번들 + 기본 설정: 설치 이전 transcript 20개 중 `raw` 복사 **0**, fake-claude argv 덤프 파일 **미생성**(유료 호출 0). `sweep_backfill_days=7`에서 **20/20** 수집.
- **루트 커밋 3일 전 번들에서 4일 전 세션 수집 1/1**(7일 창 불변). 클램프가 없으면 이 단언이 실패한다.
- glob: `('/Users/x/secret', ['/Users/x/secret/**']) === true`, 하위 true, `secretive` false, 기존 4패턴 회귀 **0건**.
- 내장 제외: 워크트리 모양 cwd 수집 **0**, 메인 체크아웃 cwd 수집 **1**, `~/work/okf-benchmark-harness` 수집 **1** — 과차단 **0건**.
- `Object.keys(DEFAULT_CONFIG).length === Object.keys(VALIDATORS).length === 17`.
- `grep -l 'sweep_backfill_days'`가 정확히 **11파일**(README 8 + USAGE + okf-config + config template).
- 신규 로그 2줄에 세션ID·전체 경로 **0건**.
- `readInstalledAt` git 서브프로세스 호출이 **회차당 최대 1회**.

**선행·롤백**: 선행 없음. 편도 흔적 0 — 잔재는 `.okf/installed-at.json` 하나뿐이고 gitignored이며 코드를 되돌리면 아무도 읽지 않는다. **코드 revert 없이 동작만 원복하려면 `sweep_backfill_days: 7`** 이면 하한이 사실상 무효화되어 수정 전 동작으로 정확히 돌아간다 — 배포 후 "왜 아무것도 수집 안 되냐" 신고의 즉시 처방이다. 내장 제외만 끄려면 `BUILTIN_EXCLUDE_CWD`를 `[]`로(한 줄).

---

#### R4 — 조용한 손실을 시끄럽게: YAML 절단(W5) · description 상한(W6) · digest 계량 · 추출기 없는 언어

**목표**: 네 곳의 말없는 데이터 손실을 **드러나게** 만든다. (1) 따옴표 없는 값 안의 ` #`을 js-yaml이 주석으로 보고 값을 자르고, 잘린 문장이 index.md와 매 세션 게이트로 나간다(라이브 22개 중 2개 파일 3건: 324→120자, 214→40자, 56→20자). (2) digest 캡 절단이 로그 한 줄 없이 가운데를 버린다(실측 242.6KB→150KB, 38%). (3) digest가 JSONL 한 줄만 파싱 실패해도 **필터를 전혀 거치지 않은 원본 앞부분**을 LLM에 보낸다 — tool_result 원문(AWS 키 실측 재현) 유출 경로다. (4) 분석기가 추출기 없는 언어를 "선언 0개"로 보고해, 측정하지 않은 것을 측정 사실처럼 말한다.

**근거**: reliability T2.3/T2.4/T10.7 + spec-conformance B-계열(프론트매터 값 파손) + 정찰 실행 확인(`projects/okf-system.md:4` description이 `…수정(PR`에서, `troubleshooting/python-tooling-gotchas.md:3` title이 `matplotlib mplstyle의`에서 절단; 디스크 원문은 멀쩡하고 파싱값만 짧다). description 500자 상한은 게이트 실측에서 유도했다 — concept 예산 6,736B에 대해 977자 description 1건이 index 줄 1,546B로 예산의 **23%** 를 혼자 점유했고, 22개 중 21개(95.5%)가 이미 500자 이하다(성문화이자 이상치 1건만 잡는다).

**구현 방안**: 규율은 전부 **상류**(프롬프트·lint·로그)에 둔다. **index 생성기는 절대 자르지 않는다** — 하류에서 자르면 (1)이 고치려는 '문장 중간 파편'을 우리 손으로 다시 만든다. W6은 "쪼개라"는 규범을 메시지에 담지 않는다(repair는 새 파일을 만들 수 없다) — 규범은 `prompts/ingest.md`에만 두고, 코드는 `buildRepairPrompt`에서 W6을 **필터**한다.

**구현 방법**

1. `lib/frontmatter.mjs` 끝에 `export function frontmatterRaw(content)` — `FRONTMATTER_RE`(`:3`)를 단일 원천으로 재사용해 원문 블록을 돌려준다(`g` 플래그가 없어 재호출 안전). **lint 밖에서 쓰지 마라** — 원문 줄을 쓰기 시작하면 YAML 해석이 두 벌이 된다.

2. `lib/lint.mjs`에 W5/W6. `:19` 아래 상수:

```js
// 따옴표 없는 YAML 플레인 스칼라에서 ` #`은 주석 시작이다 — js-yaml이 거기서 값을 자르고,
// 잘린 값이 그대로 index.md와 매 세션 게이트로 나간다(라이브 2개 파일 3건 실측).
// 값 앞이 " ' | > & * [ { 이면 인용/블록/플로우라 이 사고가 나지 않으므로 대상에서 뺀다.
const PLAIN_SCALAR_RE = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]+(?!["'|>&*[{])(\S.*?)[ \t]*$/;
const DESCRIPTION_MAX_CHARS = 500;
```

`checkFrontmatterFidelity(content, data, relPath, warnings)`를 `:113`과 `:115` 사이에 넣고 `:166-168`에서 `checkNonReserved` 다음에 호출한다. **`checkNonReserved`와 분리하는 이유**: 그쪽은 E1/E2에서 return하므로 type이 빠진 파일은 검사를 아예 못 받는다.

메시지에 **값 원문을 싣지 않는다**(키 이름 + 길이 숫자만). W6 메시지는 **서술만**:

```js
    message: `description is ${description.length} chars (max ${DESCRIPTION_MAX_CHARS})`,
```

`— split the concept instead of summarizing` 같은 지시를 붙이지 마라. `formatReport`가 이 문자열을 repair 프롬프트로 흘리고, repair는 새 파일을 만들 수 없다.

3. **`buildRepairPrompt`가 W6을 필터한다.** `bin/batch.mjs:695-699`:

```js
function buildRepairPrompt(pluginRootDir, report) {
  const t = fs.readFileSync(path.join(pluginRootDir, 'prompts', 'repair.md'), 'utf8');
  // W6은 '분할' 규범인데 repair는 새 파일을 만들 수 없다(prompts/repair.md). 리포트에 실으면
  // 헛돌거나 파일을 임의로 잘라낸다 — applyAnalyzerWorkspace에는 신규 파일 차단이 없어 반영된다.
  // W5(따옴표 씌우기)와 W1/W3는 repair 범위 안이므로 그대로 싣는다. 레지스트리는 lib/lint.mjs 상단.
  const filtered = { errors: report.errors, warnings: report.warnings.filter((w) => w.rule !== 'W6') };
  return t.replace('{{LINT_REPORT}}', () => formatReport(filtered));
}
```

4. **`lib/digest.mjs`**: `truncateHead`(`:19-23`) 삭제. `digestFile`(`:82-113`)의 `JSON.parse` 실패를 `break` + 원본 폴백 → **`skippedLines++; continue;`**. 반환값을 `{totalLines, parsedLines, skippedLines, keptTurns, beforeBytes, afterBytes, droppedBytes, droppedPct}`로 확장(기존 호출자 전부 반환값을 버리므로 파급 0). 전 줄이 깨진 파일은 이제 **0바이트 digest**가 되며, 그것을 조용히 두지 않기 위해 다음 단계의 로그가 필요하다.

5. **`bin/batch.mjs generateDigests`(`:449-470`)**: `stats`로 3종 로그(캡 절단 비율 / 스킵 줄 수 / 전 줄 실패)를 남기고, catch의 **2차 원본 텍스트 폴백을 제거**한다(같은 유출 성질이고 `.slice()`가 문자 수 기준이라 한국어에서 캡의 최대 3배가 나갔다). 다만 catch를 그냥 스킵으로 두면 **영구 재시도 루프**가 생긴다(staging에 남고 다음 회차 `recoverStagingLeftovers`가 raw로 되돌린다). 그래서:

```js
    } catch (err) {
      // 읽기 실패가 지속되면 매 회차 같은 실패를 반복한다. 빈-digest 경로(:984-994)와 같은
      // 관용구로 격리한다 — 원본은 30일 보관되므로 유실이 아니다.
      log(okfHome, `digest 생성 실패 ${path.basename(input)}: code=${safeErrorCode(err)} — _remove_candidate로 격리(30일 보관)`);
      try { const d = path.join(paths.removeCandidate, localDateString());
            fs.mkdirSync(d, { recursive: true }); fs.renameSync(input, path.join(d, path.basename(input))); }
      catch (e2) { log(okfHome, `격리 실패: code=${safeErrorCode(e2)}`); }
    }
```

로그에는 basename과 정수 퍼센트만 — 전체 경로 금지.

6. **`prompts/ingest.md`** `## 규칙` 절, `description에 답 자체를 써라` bullet **바로 뒤**에 두 bullet(큰따옴표 강제 + 500자 상한, 각각 실측 수치 포함). **`templates/SCHEMA.md`는 건드리지 않는다** — S5가 릴리스 2에서 규칙 8로 흡수한다(프롬프트는 schema 범프 없이 즉시 전파되므로 릴리스 1에서 프롬프트만 넣는 것이 옳다). `{{DIGEST_PATHS}}`/`{{SOURCE_PATHS}}`와 `test/smoke.mjs:1145,1146,1147,1161-1162`가 단언하는 기존 문장 4건은 손대지 마라.

7. **`lib/analyze.mjs`**: 추출기 유무를 `Object.hasOwn(IMPORT_PATTERNS, lang) || Object.hasOwn(DECL_PATTERNS, lang)`로 판정(프로토타입 체인 조회가 함수를 패턴 배열로 오인시킨 전례가 있다). 없으면 `extractFromFile`을 부르지 않고 `skipped: 'no-extractor'`, `loc: -1`로 둔다. `analyzedByLang` 누산기를 도입해 `:758`의 `languageStats`에 `analyzedFiles`를 싣고, **`:762-764`의 summary 정규식 판정을 삭제**한다(요약 문구를 바꿀 때마다 조용히 틀리는 판정이었다). 영향 언어는 정확히 5종(shell/markdown/json/yaml/toml).
   - **`:779` 정렬 변경(`analyzedFiles` 타이브레이커)은 스코프에서 뺀다.** 실측: 현재 코드가 이미 `primaryLanguages: ["javascript","markdown","shell"]`을 반환하므로(1순위가 `declarations`) 그 변경을 검증할 테스트가 자기충족적이 된다. 회귀 위험만 있고 검증 불가다. `.filter(([, stats]) => stats.files > 0)`도 그대로 둔다.

8. **`lib/viz.mjs:275`** 언어 통계 문자열에 `(${s.analyzedFiles ?? s.files} analyzed)` 추가(`?? s.files`는 외부 그래프 폴백). **`commands/okf-analysis.md`** 보고 규칙: "`analyzedFiles`가 `files`보다 작으면 그 차이는 구조를 추출하지 않은 파일이다 — 추출기가 없는 언어를 '선언 0개'라고 보고하지 마라. 그건 측정 결과가 아니라 측정하지 않았다는 뜻이다."

9. **`lib/index-gen.mjs:25` 위 주석**(안티-스텝):

```js
// description 길이 규율은 상류(prompts/ingest.md + lint W6)에만 둔다. 여기서 자르면
// lint W5가 잡으려는 '문장 중간에서 끊긴 값'을 생성기가 스스로 만들어내게 된다.
```

**검증 방법** (신규 23개, 그중 1개는 기존 단언 대체 → 순증 22)

lint 5: `lint W5 flags a frontmatter value silently cut at an unquoted " #"`(title·description 각 1건 = 2건, errors 0) / `lint W5 stays silent when the same value is double-quoted` / **`lint W5 does not fire on flow sequences or block scalars`**(`tags: [a, b]`, `description: |` + 들여쓴 본문, `resource: https://x/y#frag`(공백 없는 `#`), `timestamp: 2026-07-15 # 주석`(파싱값이 Date라 string 아님) 4종에 W5 0건) / `lint W5 never echoes the truncated value into the report` / `lint W6 flags a description longer than 500 chars but not one at exactly 500`.

repair 경계 2: `W6 text never instructs the repair pass to create files`(W6만 든 리포트를 `formatReport`에 넣고 '쪼개'/'split'/'새 파일' 어휘 0건) / `bloat warnings never reach the repair prompt`(`FAKE_CLAUDE_DUMP_PROMPT_TO`로 repair 프롬프트를 덤프해 `!dumped.includes('W6')`).

기존 사용자 무회귀 2: `seeded bundle produces no W5/W6 warnings`(`bootstrapped('w5-seed')` — 실측 현재 0/0) / `a bundle carrying W5/W6 warnings still runs a batch`(` #`로 잘리는 concept를 심고 `runBatch(...'success')` → `lastResult === 'ok'`).

하류 금지 1: `index generation never truncates a long description`(900자 description이 index 줄에 그대로).

digest 8: `digest keeps parseable turns on both sides of a corrupt line` / `corrupt jsonl no longer leaks raw transcript content into the digest`(`AWS_SECRET_ACCESS_KEY=abcd1234`, `toolUseResult` 0회) / `digest reports how many lines it skipped`(1/2/3) / `digest survives a truncated final line (concurrent transcript write)` / `fully unparseable jsonl yields an empty digest instead of a raw dump`(**기존 `malformed jsonl falls back without throwing`를 대체**) / `digestFile reports the cap-truncation loss ratio` / `batch logs the digest cap truncation ratio` / `batch logs how many transcript lines a digest skipped` / `a digest that cannot be read is quarantined instead of retried forever`.

> **절단 픽스처 주의**: `digestFile(SAMPLE_TRANSCRIPT, out, 150)` 결과는 **566바이트**다. capKb=1(1024B)에서도 `truncateHeadTail`이 원문을 그대로 반환해 `droppedBytes === 0`이 된다. 반드시 인라인 대용량 픽스처를 만들어라: `'앞'.repeat(2000)` user 턴 + `'뒤'.repeat(2000)` assistant 턴 ≈ 12KB > 1KB 캡. 배치 로그 테스트도 마찬가지로 `setupBatchSandbox` 직후 raw 세션 파일을 큰 것으로 덮어쓴 뒤 `batch_digest_cap_kb: 1`로 돌려라(`lib/config.mjs:59`의 검증기가 하한 1이라 1KB 미만 값은 설정으로 내려갈 수 없다).

analyze 3: **두 개의 별도 픽스처로 분리한다.** (A) `sandbox('analyze-no-extractor')`에 `run.sh`/`README.md`/`app.js` 3개 → `analyze: a language without extractors is not described as "0 declarations"`(`!/선언 0개/`, `/추출기 없음/`, `!/0줄/`) / `analyze: no-extractor files count as files but never as analyzed files`(`shell.files===1 && shell.analyzedFiles===0 && markdown.files===1 && markdown.analyzedFiles===0`) / `analyze: a language with extractors still counts as analyzed`(`javascript.analyzedFiles===1`). 같은 그래프에 `docs/*.md`를 추가로 심으라는 지시는 `markdown.files === 1`과 모순되므로 **넣지 마라**.

프롬프트 1: `ingest prompt requires quoted title/description with a numeric description cap`(`/큰따옴표/`, `includes('500자')`). 프롬프트 텍스트 단언은 행동 단언의 프록시임을 주석에 명시.

**통과 규칙**

- 기준선 373 → **395 passed, 0 failed**, exit 0, 3-OS.
- **커밋된 합성 픽스처**(라이브 3건과 동일한 절단 패턴 concept 3개 + 977자 description concept 1개)에서 `runLint`가 **W5 3건 · W6 1건 · errors 0건**. 라이브 번들 수치는 통과 규칙이 아니라 근거로만 남긴다("2026-07-25 1회 관측, concept 23개").
- W5 false positive **0**: 큰따옴표 값 / 플로우 시퀀스 / 블록 스칼라 / 공백 없는 `#` / Date 파싱값 5종에서 W5 0건. `bootstrapped()` 시드 8종에서 W5·W6 **각 0건**.
- 3줄 중 1줄 파손 픽스처: 정상 턴 **2/2** 보존, 자격증명 문자열 **0회**, `skippedLines === 1`. 전 줄 파손 → digest **0바이트**(원문 폴백 0). **digest 경로에서 원본 JSONL 바이트가 LLM 입력으로 나가는 경로 0개.**
- 본문이 캡의 2배 이상인 픽스처에서 `digest 캡 절단` 로그 **1줄 이상**, 손실률이 **1~99 정수**로 표기.
- `analyzeProject`가 5종 언어에 `analyzedFiles === 0`을 집계하고 summary에 `선언 0개`·`0줄` **0회**. 추출기 있는 언어의 `analyzedFiles`는 이전 값과 **100% 동일**.
- **repair 프롬프트 덤프에 `W6` 0회**, `W5`는 등장(필터가 정확히 W6만 거른다).
- W5/W6를 든 기존 사용자 번들에서 `runBatch` → `lastResult === 'ok'`. **배치 정지 0건.**
- index 900자 description 절단 바이트 **0**.
- 유료 LLM 호출 **0회 추가**.

**선행·롤백**: 선행 없음(단, lint 규칙 코드는 R0 레지스트리 준수). 부분 롤백: (a) lint 경고만 끄려면 `:166-168`의 `checkFrontmatterFidelity` 호출 한 줄 삭제, (b) **digest 변경은 `lib/digest.mjs`와 `generateDigests`를 반드시 함께 되돌려라** — digest.mjs만 되돌리면 `stats`가 undefined가 되어 `stats.droppedBytes` 접근이 TypeError를 내고 청크가 롤백된다, (c) analyze는 5개 지점 원복. 되돌리면 원문 폴백 유출 경로가 다시 열린다는 점을 릴리스 노트에 남겨라. 사용자 번들 concept는 변경하지 않으므로 데이터 롤백 불필요.

---

#### S3a — lint v0.2 어휘: 시간 신호 OR 검사 · `lib/trust.mjs` 신설 · 날짜 타입 지뢰 · 프로토타입 체인 차단 · status W7

**목표**: `lib/lint.mjs`를 OKF v0.2 어휘로 옮기고, v0.2 필드를 읽는 모든 코드가 공유할 정규화 계층 `lib/trust.mjs`를 만든다. 핵심은 **W2에서 `timestamp` 하드코딩을 없애는 것** — 이 경고가 `formatReport` → `{{LINT_REPORT}}` → repair를 타고 돌아와 모델에게 "v0.1 필드를 되살려라"는 지시가 되는 진동(B3)을 근원에서 끊는다.

**릴리스 1에 있는 이유**: 종합 §2의 판정 — "`lint.mjs:130`의 `timestamp` 강제 제거는 스펙 채택이 아니라 **결함 수정**이며 신뢰성 릴리스로 넘어가야 한다." 그리고 §6의 순서 제약 1: S5(SCHEMA에서 `timestamp` 제거)가 S3a보다 먼저 들어가면 `SCHEMA.md`가 자기 자신에게 영구 W2를 받고 그 경고가 repair로 새어 모델이 매 회차 SCHEMA를 고치려 들다 `bin/batch.mjs:783`에서 차단된다(`분석기 산출물 반영 거부` 로그 상시화).

**근거**: spec-conformance §4 P2·P13·P8의 lint 몫 2건. §3 B2(v0.2 concept 3개 전부 W2), B3(CONFIRMED, `bin/batch.mjs:695-699`+`:838`), B7(무따옴표 `at: 2026-07-25` → `Date`, 따옴표면 `String` — 같은 필드가 파일마다 타입이 갈린다), B10(`TYPE_TO_DIR['constructor']` → `function Object() { [native code] }`, `['__proto__']` → `[object Object]`). §7-3/§7-4(루트 index W4 완화 금지 / W3 예외 집합 확대 금지 — 둘 다 폐기 목록). 실행 재확인: `generated: nonsense` → `typeof data.generated.at === 'function'`(String.prototype.at) — **옵셔널 체이닝만으로는 잘못 통과한다.**

**구현 방안**: `lib/trust.mjs`는 **이 릴리스에 실제 소비자가 있는 4개만** export한다. `normalizeVerified`/`isStale`은 첫 소비자(S6)와 같은 커밋에, `conceptStatus`는 첫 소비자(S4)와 같은 커밋에 추가한다. P13의 순서 제약("읽는 첫 코드를 쓰기 전에")은 **같은 커밋으로도 만족되며**, 지금 넣으면 소비자 0인 코드를 테스트가 살려두는 상태가 된다(전역 Rule 2).

**구현 방법**

1. **`lib/trust.mjs` 신설** — 의존성 0(다른 lib을 import하지 않는다). export 4개: `isPlainObject`, `toIsoDateTime`, `toIsoDate`, `generatedAt`.

```js
// OKF v0.2 §5.2/§5.3/§5.5의 신뢰·신선도 필드를 "읽는" 쪽 정규화 계층. 생산은 하지 않는다.
// 존재 이유는 하나다: 벤더드 js-yaml(DEFAULT_SCHEMA)이 따옴표 없는 YAML 날짜를 Date 객체로
// 만든다. 그래서 같은 필드가 파일마다 string/Date로 갈리고, 문자열 비교가 NaN 비교가 되어
// 어떤 날짜에도 false가 된다 — 실측: '2027-01-05' >= <Date 2026-12-31>도 false.
//
// verified/stale 정규화는 읽는 코드가 생기는 커밋에서 함께 추가한다 — P13의 순서 제약
// ('읽는 첫 코드를 쓰기 전에')은 같은 커밋으로도 만족된다. 지금 넣으면 소비자 0인 코드를
// 테스트가 살려두는 상태가 된다(Rule 2).

export function isPlainObject(v) {
  // lib/config.mjs:93 관용구 + Date 제외. Date를 빼지 않으면 `verified: 2026-07-25`(무따옴표
  // → Date)가 1원소 리스트로 통과한다.
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}
export function toIsoDateTime(v) { /* Date → ISO 초; 문자열 → ISO_DATE는 T00:00:00Z, 무오프셋이면 Z를 붙인다 */ }
export function toIsoDate(v) { const dt = toIsoDateTime(v); return dt ? dt.slice(0, 10) : null; }
export function generatedAt(fm) {
  // fm.generated?.at을 그냥 쓰면 안 된다 — generated가 문자열/배열이면 .at이 프로토타입
  // 메서드로 잡혀 truthy가 된다(실측).
  if (!isPlainObject(fm)) return null;
  const g = fm.generated;
  if (!isPlainObject(g)) return null;
  return toIsoDateTime(g.at);
}
```

`toIsoDateTime`에서 **무오프셋 문자열에 `Z`를 붙이는 줄을 빼지 마라** — YAML 1.1 규약상 오프셋이 없으면 UTC이고, 안 붙이면 `new Date('2026-07-25T10:30:00')`이 로컬로 해석돼 따옴표 유무만으로 값이 KST 기준 9시간 갈라진다.

파일이 `git ls-files '*.mjs'`에 잡혀야 CI의 `node --check`를 받는다 — 커밋 누락 시 CI에서만 조용히 빠진다.

2. **W2를 시간 신호 OR 검사로.** `lib/lint.mjs:4` 아래 `import { isPlainObject, generatedAt } from './trust.mjs';`. `:130`의 한 줄을 교체:

```js
  const missing = ['title', 'description'].filter((f) => !isNonEmptyString(String(data[f] ?? '')));
  // OKF v0.2 §13.1: 시각 신호의 정본은 generated.at이고 레거시 timestamp는 소비자 폴백이 MAY다.
  // 둘 중 하나만 있으면 통과 — 둘 다 없을 때만 경고한다. timestamp를 계속 강제하면 그 경고가
  // formatReport -> {{LINT_REPORT}} -> prompts/repair.md를 타고 'timestamp를 되살려라'는
  // 지시로 되돌아온다(B3).
  const hasLegacyTimestamp = isPlainObject(data) && isNonEmptyString(String(data.timestamp ?? ''));
  if (!isSchemaTemplate && !generatedAt(data) && !hasLegacyTimestamp) {
    missing.push('generated.at (or legacy timestamp)');
  }
```

규칙 코드 `W2`와 메시지 접두 `missing recommended field(s): `는 바꾸지 마라(`bin/batch.mjs:52`가 코드를 집계하고 기존 스모크가 코드로 단언한다).

**`hasLegacyTimestamp`를 `toIsoDate(data.timestamp)`로 엄격화하지 마라** — 라이브 22개의 `timestamp`는 규정이 느슨했던 v0.1 값이라 형식 강화가 곧 새 경고 폭증이고, §13.1은 레거시를 "지우지도 갱신하지도 말고 그대로 둔다"다.

3. **SCHEMA.md를 시간 신호 요구에서 면제.** `checkNonReserved` 시그니처에 `isSchemaTemplate = false`를 추가하고 `:166`의 호출을 `checkNonReserved(relPath, hasFrontmatter, data, parseError, errors, warnings, relPath === 'SCHEMA.md')`로 바꾼다.

판정은 반드시 **경로**여야 한다 — `data.type === 'schema'`로 하면 concept가 `type: schema`를 자칭해 경고를 회피할 수 있고, 경로 판정은 `bin/batch.mjs:783`의 보호 조건과 정확히 같은 술어라 두 곳이 함께 움직인다. 면제 범위를 넓히지 마라: E1/E2와 W3는 그대로 둔다. `SCHEMA.md: W3: type "schema" is outside the known taxonomy`는 v0.2와 무관한 기존 잡음이며(EXIT=0) 여기서 같이 지우면 §7-4에서 "하지 마라"로 결론난 W3 예외 집합 확대로 미끄러진다.

4. **미지 `status` → W7.** `:19` 아래에 `const STATUS_VALUES = new Set(['draft', 'stable', 'deprecated']);`, W2 블록 직후:

```js
  // 미지 값으로 문서를 거부하지 않는다(SPEC §11 MUST NOT) — 경고만 내고 stable로 본다.
  // 반드시 warnings다. errors로 올리면 bin/batch.mjs:836이 참이 되어 유료 repair 1회가 발동하고,
  // 남으면 rollbackChunk(git 원복 + 남은 청크 중단)로 간다 — 미지 값 하나에 청크를 버리는 셈이다.
  if (data.status !== undefined && data.status !== null) {
    const statusStr = typeof data.status === 'string' ? data.status.trim() : String(data.status);
    if (!STATUS_VALUES.has(statusStr.toLowerCase())) {
      warnings.push({ file: relPath, rule: 'W7',
        message: `unknown status "${statusStr}" (expected draft|stable|deprecated); treated as stable` });
    }
  }
```

**코드는 `W7`이다**(§1.1.4 레지스트리). S4가 원래 `W5`로 지시했으나 그 코드는 R4의 것이다. **S4는 lint를 건드리지 않는다.**

5. **`TYPE_TO_DIR`를 `Map`으로.** `lib/lint.mjs:8-15` 교체 + `:136`을 `TYPE_TO_DIR.get(typeStr)`로. 주석에 근거를 남긴다:

```js
// Map인 이유: type은 신뢰할 수 없는 데이터다. 객체 리터럴이면 프로토타입 체인을 타서
// `type: constructor`가 W3 메시지에 `function Object() { [native code] }`를, `__proto__`가
// `[object Object]`를 싣는다(실측). lib/viz.mjs:288이 같은 클래스를 이미 방어한다.
```

`TYPE_TO_DIR`는 `lib/lint.mjs` 안에서만 쓰이고 export되지 않는다(grep 확인: `:8`, `:136` 두 곳) — 외부 파급 0.

6. **기존 사용자 잡음 0 실측.** 라이브 번들을 **복사하지 말고** 코드만 두 벌 확보해 stdout을 비교한다. `raw/`·`_remove_candidate/`에는 사용자 대화 원문이 있고 `cp -R`은 그것을 umask 기반 0755 디렉토리에 노출시킨다(번들은 0700/0600이 불변식이다). `runLint`는 `readFileSync`/`readdirSync`만 하므로 복사가 불필요하다.

```bash
TMP="$(mktemp -d)"                      # 0700
OKF_LIVE="$(node -e "import('./lib/paths.mjs').then(m=>console.log(m.resolveOkfHome()))")"
git worktree add "$TMP/before" <변경 전 커밋>     # 코드만, 번들 아님
node "$TMP/before/lib/lint.mjs" "$OKF_LIVE" > "$TMP/lint-before.txt"
node ./lib/lint.mjs              "$OKF_LIVE" > "$TMP/lint-after.txt"
diff "$TMP/lint-before.txt" "$TMP/lint-after.txt"     # 0바이트여야 한다
git -C "$OKF_LIVE" status --porcelain                 # 0바이트여야 한다(lint이 아무것도 안 썼다)
git worktree remove "$TMP/before"; rm -rf "$TMP"
```

출력 파일에는 파일명과 규칙 코드만 실리며 전사 원문은 실리지 않는다.

**검증 방법** (신규 `ok()` 12개)

trust 3개 — 픽스처 헬퍼는 반드시 `const fm = (y) => parseFrontmatter(`---\n${y}\n---\n본문\n`).data;`를 쓴다. JS 리터럴로 `{at:'2026-07-25'}`를 직접 만들면 js-yaml의 Date 승격을 재현하지 못해 **테스트가 지뢰를 안 밟는다**.

- `trust: toIsoDate collapses an unquoted YAML date and a quoted string to the same value` — 대조군으로 `unq.stale_after instanceof Date && typeof q.stale_after === 'string'`을 함께 단언해 지뢰의 존재 자체를 고정한다.
- `trust: toIsoDateTime treats an offset-less timestamp as UTC` — `toIsoDateTime(fm('at: 2026-07-25T10:30:00').at) === toIsoDateTime('2026-07-25T10:30:00')`.
- `trust: generatedAt is not fooled by a prototype member on a non-object generated` — `generated:` 값이 문자열/배열/null/Date/`at` 없는 매핑 5종에서 전부 `null`. 대조군 `typeof fm('generated: nonsense').generated?.at === 'function'`을 함께 단언.

lint 9개 — 홈 하나(`bootstrapped('lint-v02')`)에 픽스처를 심고 `runLint(home)` 1회, 단언은 **반드시 파일 경로로 좁혀서** 한다(`bootstrapped()`가 심는 시드 4개가 `timestamp`를 갖고 있어 번들 전체로 'W2 0건'을 단언하면 우연히 통과한다). 실패 detail은 관례대로 `formatReport(report)`.

- `W2 accepts generated.at instead of a legacy timestamp` — `decisions/v02-native.md`(timestamp 없음, `generated: {by, at}` 있음) W2 0건, errors 0건.
- `W2 still accepts a legacy timestamp-only concept (mixed-state tolerance)` — 번들은 영구히 혼합 상태로 남는 것이 정상이다.
- `W2 warns when neither generated.at nor timestamp is present` — 정확히 1건이고 message가 `'generated.at'`을 포함, errors에는 없음.
- `W2 is not fooled by a non-object generated value (prototype .at)` — `gen-string`/`gen-array`/`gen-null`/`gen-noat` 4파일 각각 W2 정확히 1건. **`data.generated?.at`을 쓰면 앞 두 개가 0건이 되어 빨개진다 — P2의 핵심 회귀 가드.**
- `SCHEMA.md without a timestamp does not produce W2` — 별도 홈(`lint-v02-schema`)에서 SCHEMA를 v0.2 형태로 덮어쓰고 W2 0건, errors 0건.
- `unknown status is W7 (warn), never an error` / `draft/stable/deprecated produce no W7`
- `W3 never leaks a prototype member for a hostile type value` — `constructor`/`__proto__`/`toString`/`hasOwnProperty`/`valueOf` 5종 메시지를 join해 `'[native code]'`·`'[object Object]'` 0회, 5개 전부 `'outside the known taxonomy'` 포함, errors 0건.
- `a freshly bootstrapped bundle produces no W7 under the v0.2 vocabulary`

**통과 규칙**

- 기준선 395 → **407 passed, 0 failed**, exit 0, 3-OS. `git ls-files '*.mjs'` 전량 `node --check` 통과(신규 `lib/trust.mjs` 포함).
- 시간 신호 OR: `generated.at`만 → W2 **0건**, `timestamp`만 → W2 **0건**, 둘 다 없음 → W2 **정확히 1건**. `generated`가 문자열/배열/null/Date/`at` 없는 매핑 5케이스 전부 W2 **정확히 1건**(프로토타입 `.at` 오통과 **0건**).
- `type`이 `constructor|__proto__|toString|hasOwnProperty|valueOf` 5종에서 W3 메시지에 `[native code]` **0회**, `[object Object]` **0회**, errors **0건**.
- status: 3종 유효값 W7 **0건**, 그 외 값 1개당 W7 **정확히 1건**, 어느 경우에도 errors 증가 **0건**.
- 부트스트랩 직후 빈 번들에서 W7 **0건**, errors **0건**.
- **라이브 번들에 대한 변경 전/후 `node lib/lint.mjs` stdout diff 0바이트**, 두 실행 모두 exit 0, 실행 전후 `git -C "$OKF_LIVE" status --porcelain` **0바이트**. 번들 복사 **0회**.
- `lib/trust.mjs`의 export **정확히 4개**이고 전부 스모크에서 최소 1회 직접 단언된다(미사용 export **0개**).
- 배치 정지·청크 롤백·추가 유료 repair 호출 **0회**.

**선ець·롤백**: 선행 없음. lint 계층은 읽기만 하므로 번들·상태 파일·git 이력에 **어떤 영구 흔적도 남기지 않는다** — 되돌리기는 코드 원복이 전부다. **`lib/trust.mjs` 단독 삭제는 금지**(lint의 import가 실패하면 `runLint` 호출 전체가 죽고 `bin/batch.mjs:834`가 청크 롤백으로 간다) — 반드시 `lib/lint.mjs`와 함께 되돌려라. 반대로 `lint.mjs`만 되돌리고 `trust.mjs`를 남기는 것은 무해하다(순수 미사용 모듈). W2 OR만 되돌리면 B3 진동이 되살아나므로 **그 상태로는 릴리스 2를 발행하지 마라.**

---

### 릴리스 2 — `0.2.1` "OKF 스펙 v0.2 대응"

> **§13.1 원자성: S1(생산) · S2(선언) · S5(규칙서)는 한 릴리스다. 셋 중 하나라도 빠지면 릴리스하지 않는다.**
> 순서: **S5 → S3b → S1 → S2 → S4**. S5가 SCHEMA/ingest의 단일 소유자이고 S3b의 규정 근거를 제공한다. S4는 R3(락 API)과 S5(SCHEMA status 규정)에 의존한다.

---

#### S5 — SCHEMA.md v2 · ingest/repair 프롬프트 v0.2 · 버전 문자열 전면 정리

**목표**: 배치가 매 회차 첫 번째로 Read하는 규칙서(`templates/SCHEMA.md`)와 유일한 유효 지시서(`prompts/ingest.md`)를 v0.2 어휘로 옮긴다. `schema_version: 1 → 2`(**릴리스 유일 범프**)로 기존 사용자 번들에 새 규정을 전파하고, 자기 프론트매터의 폐기 필드 `timestamp`를 `generated`로 교체하며, 트러스트 필드 "쓰지 마라" 규정을 명문화하되 **`stale_after`는 이름조차 등장시키지 않는다**. 그리고 스펙 버전 문자열이 박힌 지점 전량을 승격·제거·동결로 처리한다.

**S5는 `templates/SCHEMA.md`와 `prompts/ingest.md`의 유일한 편집자다**(§1.1.6). S4는 status 규정 문구를, S3b는 규칙 3 문구를 **이 WP에 기여**할 뿐 직접 편집하지 않는다.

**근거**: spec-conformance §4(a) P3·P8·P6, §6 표기 6곳 표, §4(c)(`stale_after` 프롬프트 언급 금지 / `sources` 원재료 부재), §7-1(시드 갱신 제외), §7-7(`docs/benchmarks/**` 동결). §3-A A4(`bin/session-start.mjs:80`, `prompts/ingest.md:3`), B8(무따옴표 `": "`가 E1 → repair → 청크 롤백, 실측 `bad indentation of a mapping entry (3:34)`). reliability T10.2(SCHEMA 템플릿이 `timestamp: 2026-01-01`과 "스펙 권장 순서"를 가르친다 — SPEC 어디에도 없는 문구), T8.7(`prompts/repair.md:20`의 문자열이 `bin/batch.mjs:646`의 단계 판정과 결합). 실측: `templates/SCHEMA.md` 68줄 4,271B, `prompts/ingest.md` 82줄 6,820B, `prompts/repair.md` 22줄 1,422B, `lib/bootstrap.mjs:87,95`의 `{{INSTALL_DATE}}` 치환은 **비전역 replace 1회**.

**구현 방법**

1. **자기 프론트매터 v2.** `templates/SCHEMA.md:1-7` 교체:

```
---
type: schema
schema_version: 2
title: OKF 번들 작성 규정
description: 배치 에이전트가 준수해야 하는 절대 규칙과 택소노미
generated:
  by: "okf-system/0.2.1"
  at: "2026-07-25"
---
```

`by`는 이 파일의 생산자가 배치 모델이 아니라 **플러그인 릴리스**이므로 릴리스 버전, `at`은 본문이 마지막으로 유의미하게 바뀐 날짜다(§5.2). **두 값 모두 큰따옴표 필수**(무따옴표는 `Date` 객체가 된다). **불변식: `schema_version`을 올릴 때마다 `generated.by`/`at`을 그 릴리스 값으로 함께 갱신한다** — 검증의 `SCHEMA 템플릿의 generated.by가 배포 플러그인 버전과 일치한다` 단언이 이것을 범프마다 자동 재확인한다.

`schema_version` 값은 **따옴표 없는 정수 한 줄**(`lib/bootstrap.mjs:22`). 새 텍스트 어디에도 `{{`를 넣지 마라 — 비전역 replace라 두 번째 플레이스홀더는 치환되지 않은 채 사용자 번들에 남는다.

2. **절대 규칙 3·4 갱신 + 규칙 8 신설.** `:11-12`(규칙 3)에 `**어느 디렉토리의 log.md든**`과 `날짜는 ISO 8601만 허용한다`를 넣는다. **문서가 시행보다 앞서는 것은 무해하므로 S5가 먼저 들어가도 안전하다** — 반대로 S3b(W8)가 규정 없이 단독 착지하는 것은 금지다.

`:13`(규칙 4)에 S4가 기여하는 문구를 흡수:

```
4. 파일 이동/개명 금지 — concept ID = 경로. 대체 시 새 파일 + 옛 파일에 "superseded by /..." 산문
   + 옛 파일 frontmatter에 `status: deprecated`. **대체 문서를 이번 입력에서 실제로 확인했을
   때만** 붙인다 — "오래돼 보인다"는 은퇴 사유가 아니다. 파일은 절대 지우지 마라(링크 보존).
```

`:18` 뒤에 규칙 8(R4가 릴리스 1에 프롬프트로 넣은 인용 규칙의 규정본):

```
8. frontmatter 값에 `: `(콜론+공백)나 ` #`(공백+샵)가 들어가면 반드시 큰따옴표로 감싸라.
   안 감싸면 YAML이 문서 전체를 파싱 실패로 처리하거나(→ E1 → 이 회차 롤백), 값을 `#` 앞에서
   조용히 잘라낸다(실측: 라이브 concept 22개 중 2개의 title/description이 문장 중간에서
   잘렸고 lint는 통과시켰다 — 게이트에 실리는 줄이 곧 잘린 문장이 된다).
```

규칙 8을 '절대 규칙' 절에 넣는 것은 정당하다(위반 시 실제로 E1로 커밋이 거부된다). **경고 등급 규칙(W5/W6/W7/W8)을 이 절에 섞지 마라** — 규정과 시행 강도가 어긋나는 문서를 만들면 안 된다.

3. **템플릿 절 교체 + "네가 쓰지 않는 필드" 표.** `:20` 헤딩의 `스펙 권장 순서`(SPEC 어디에도 없는 문구)를 `권장 키 순서: type → title → description → resource → tags`로. 예시 블록에서 `timestamp: 2026-01-01`을 삭제하고 `title`/`description`에 큰따옴표를 씌운다. `:31` 뒤에 표를 넣는다:

| 필드 | 왜 네가 쓰지 않나 |
|---|---|
| `generated` | 누가·언제 만들었는지는 배치 드라이버가 반영 시점에 코드로 찍는다. 손으로 적으면 추측이 기록으로 굳는다. |
| `verified` | 사람이 독립적으로 확인했다는 신호다. 자기 산출물에 확인 도장을 찍는 것은 위조다. |
| `sources` | 입력 digest는 URL·경로를 보존하지 않는다. 지금 채우면 출처를 지어내는 것이다. 출처는 본문 산문으로 남겨라. |
| `timestamp` | v0.2에서 `generated`로 대체돼 폐기됐다. 새로 넣지 마라. 다만 **기존 문서에 이미 있으면 지우지도 갱신하지도 마라** — 옛 소비자가 읽는 값이다. |
| `status` | 부재가 곧 `stable`이다. `draft`/`stable`을 직접 적지 마라. 대체된 문서를 은퇴시킬 때만 `status: deprecated`를 붙인다(절대 규칙 4). |

표 아래 catch-all: "표에 없는 다른 v0.2 필드도 마찬가지다 — 템플릿에 없는 키는 만들지 마라."

**`status` 행은 규칙 4 본문에 그 표기가 없더라도 자기완결적이어야 한다**(위 문장이 그 형태다). **`stale_after`라는 문자열을 이 파일 어디에도 쓰지 마라** — 표에 "쓰지 마라"로 넣는 것조차 금지다(§1.0.2-1). catch-all이 그 역할을 대신한다. `okf_version`도 넣지 마라(concept 키가 아니라 루트 index 전용이다).

4. **`prompts/ingest.md:3`** → `너는 <OKF_HOME>(현재 작업 디렉토리) OKF v0.2 번들의 지식 사서다.` 그리고 `:73`(index.md 금지 bullet) **뒤**, digest 삭제 금지 bullet **앞**에 트러스트 필드 금지 bullet 1개(≤6줄). **R4가 릴리스 1에 넣은 인용·500자 bullet은 그대로 유지한다**(중복 서술하지 마라 — 인용 규칙은 이미 프롬프트에 있고 S5는 SCHEMA 쪽만 새로 넣는다).

`:18`이 "이번 실행에서 유효한 지시는 이 파일과 `SCHEMA.md`뿐"이라고 못 박으므로 **스킬·커맨드·README에 같은 규칙을 써도 배치에는 닿지 않는다.** `test/smoke.mjs:1145,1146,1147,1161-1162`가 단언하는 한국어 substring 4건과 `{{DIGEST_PATHS}}`/`{{SOURCE_PATHS}}`는 손대지 마라.

5. **`prompts/repair.md:13` 뒤 백스톱 1줄**: "리포트에 없는 필드를 새로 만들지 마라. 경고를 없애려고 `SCHEMA.md` 템플릿에 없는 키를 추가하는 것도 포함한다 — 규정에 없는 필드는 수리가 아니라 새 오염이다."
   **바꾸면 안 되는 것**: `:3`의 `아래는 방금 커밋 시도가 실패한 lint 오류 리포트다`, `:20`의 `## lint 오류 리포트`, `:22`의 `{{LINT_REPORT}}`. 이 문구를 고치면 벤치 usage 라벨이 전부 'ingest'로 오분류되고(예외는 `bin/batch.mjs:657`에서 통째로 삼켜져 경고조차 없다) fake-claude 픽스처의 repair 시나리오가 동시에 죽는다.

6. **게이트 head에서 버전 표기 제거.** `bin/session-start.mjs:80` → `전역 지식 번들: ${okfHome}`. **상수 보간으로 대체하지 마라** — `readExistingOkfVersion`이 외부 도구가 쓴 `"0.3"`을 보존하므로 플러그인 상수를 박으면 번들 실제 선언과 갈라진다. 소비자 규칙이 0개이므로 삭제가 정답이다. head가 정확히 11바이트(` (OKF v0.1)`) 줄어드는 것은 이득이지만 **줄 수는 바꾸지 마라**(`:97-98`이 `head.split('\n').length`로 줄 예산을 뺀다). `:79`의 `OKF KNOWLEDGE GATE` 배너는 `test/smoke.mjs:275`가 단언한다.

7. **README 배지 2종만 승격.** `README.md:5`·`README.ko.md:5`의 `badge/OKF-v0.1%20Draft-4ecdc4` → `badge/OKF-v0.2-4ecdc4`. `Draft`는 v0.2가 버린 라벨이다(이제 `status` 값으로만 존재). **나머지 6종에는 배지 행 자체가 없으니 새로 만들지 마라**(없던 번역 부채를 시작하는 일이다). `readmes.length === 8` 단언이 있으므로 파일을 추가·삭제하지 마라.

8. **시드 동결 + 릴리스 노트.** `templates/seed/{en,ko}/references/okf-format.md`의 v0.1 서술 4줄은 **바꾸지 않는다**(§1.0.2-10). 신규 설치분만 고치는 것은 갈라진 서술을 만들 뿐이다. 릴리스 노트에 §1.1.2의 4문장을 그대로 싣는다.

9. **`lib/bootstrap.mjs:20-21` 주석 정정**(동작 무변경): "버전은 YAML 파서가 아니라 정규식으로 읽는다 — 시드 템플릿이 `{{INSTALL_DATE}}`를 쓰고, 사용자 SCHEMA.md는 손편집으로 언제든 파싱 불가가 될 수 있는데 그때 부트스트랩이 죽으면 안 된다." `:87`/`:95`의 replace는 **제거하지 마라**(나중에 날짜 플레이스홀더가 다시 필요해질 때 조용히 미치환 텍스트가 남는다).

10. **표기 검증 grep**(§통과 규칙에 수치로).

**검증 방법** (신규 `ok()` 15개)

- `SCHEMA 템플릿의 schema_version이 따옴표 없는 정수 한 줄로 남아 bootstrap 정규식에 잡힌다` — `lib/bootstrap.mjs:22`와 **같은 정규식을 스모크에 복제**(`schemaVersionOf`는 export가 아니다), `Number(m[1]) >= 2`.
- `SCHEMA 템플릿이 자기 frontmatter에서 폐기된 timestamp를 버렸다` — `!/^timestamp:/m` && `/^generated:$/m` && `/^\s+at: "\d{4}-\d{2}-\d{2}"$/m`(줄 시작 형태로만 검사해 산문 속 언급은 잡지 않는다).
- **`SCHEMA 템플릿의 generated.by가 배포 플러그인 버전과 일치한다`**
  ```js
  ok('SCHEMA 템플릿의 generated.by가 배포 플러그인 버전과 일치한다',
    new RegExp(`^\\s+by: "okf-system/${pluginManifest.version.replace(/\./g, '\\.')}"$`, 'm').test(schemaTemplate),
    schemaTemplate.slice(0, 200));
  ```
  이 한 줄이 "선언과 생산이 같은 릴리스에 있어야 한다"를 범프마다 재확인한다. **따라서 S5는 릴리스 통합 커밋(plugin.json → `0.2.1`)과 같은 브랜치에 있어야 한다**(§1.1.3).
- `SCHEMA 템플릿이 generated·verified·sources 직접 작성을 금지한다` — 5개 필드가 백틱으로 명시. 프롬프트 텍스트 단언은 행동 단언의 프록시임을 주석에 명시.
- `stale_after는 LLM 계약 표면 어디에도 등장하지 않는다` — SCHEMA·ingest·repair 3파일 모두 0회.
- `schema_version 1 번들이 v2 템플릿으로 교체된다` — `bootstrapped('schema-v2')`에 v1 SCHEMA를 쓰고 `ensureBootstrap` → `/^schema_version:\s*2$/m` && `!includes('옛 본문')`.
- `교체된 SCHEMA.md에 미치환 플레이스홀더가 남지 않는다` — `!synced.includes('{{')`.
- `v2 SCHEMA.md가 lint 에러 0건이고 경고는 기존 W3 하나뿐이다` — `SCHEMA.md` findings가 전부 `W3`이고 `length <= 1`. **W2가 새로 생기지 않는 것이 핵심** — S3a가 없으면 이 테스트가 실패하며 그 실패가 곧 릴리스 원자성 경보다. detail에 `formatReport(report)`를 넘겨 원인을 구분 가능하게 한다.
- `ingest 프롬프트가 v0.2 번들의 사서로 자기를 선언하고 트러스트 필드 작성을 금지한다`
- `repair 프롬프트가 단계 판정 문자열을 그대로 유지한다` — `includes('lint 오류 리포트') && includes('{{LINT_REPORT}}')`.
- `런타임 표면에 옛 스펙 버전 문자열이 남지 않았다` — `prompts/*`, `templates/SCHEMA.md`, `templates/config.md`, `bin/session-start.mjs` 5파일에 `/v0\.1/` 0건. `templates/seed/**`를 뺀 이유를 주석에 적는다.
- `gate context does not hardcode an OKF spec version` — 기존 session-start 블록의 `ctx`에 `!/OKF v0\.\d/`. **플러그인 상수를 보간하는 '수정'도 이 단언에 걸려 실패하므로 제거가 유일한 통과 경로다.**
- `OKF 배지는 원래 배지가 있던 2종에만 있고 둘 다 스펙 v0.2를 발행한다` — `readmes.length === 8 && badged.length === 2`이고 둘 다 `badge/OKF-v0.2-` 포함 + `Draft` 0회. `badged.length === 2`가 **없던 6종에 배지를 새로 만드는 것도 실패로 만든다.**
- `SCHEMA·ingest 프롬프트가 회차당 바이트 예산 안에 있다` — `Buffer.byteLength(schemaTemplate) <= 5600 && Buffer.byteLength(ingestPrompt) <= 7600`. **통과 규칙에 수치만 있고 테스트가 없으면 다음 사람이 프롬프트를 늘려도 CI가 침묵한다.**
- `SCHEMA v2 배포 후 배치 1회 로그에 반영 거부가 0건이다` — `setupBatchSandbox` + `FAKE_CLAUDE_MODE:'success'` 후 `.okf/logs/*.log` 전문에 `!logs.includes('반영 거부')`.

**통과 규칙**

- 기준선 407 → **422 passed, 0 failed**, exit 0, 3-OS.
- `grep -rn "v0\.1" bin lib prompts templates commands skills test .claude-plugin hooks` → **정확히 4줄, 전부 `templates/seed/{en,ko}/references/okf-format.md`**(현행 6줄에서 2줄 제거).
- `grep -rn "stale_after" prompts templates skills commands` → **0줄**. `grep -rn "okf-system v0\.2"` → **0줄**.
- SCHEMA v2 배포 번들: `runLint` **errors 0건**, `SCHEMA.md` findings **1건 이하이며 rule이 전부 `W3`**(W2 0건). 배치 로그의 `분석기 산출물 반영 거부` **회차당 0건**.
- 분량: `templates/SCHEMA.md` 4,271B → **5,600B 이하**, `prompts/ingest.md` → **7,600B 이하**, `prompts/repair.md` → **1,700B 이하**. 세 파일 합계 순증 **≤ 2,300B**(청크 입력 300KB 대비 0.8% 미만).
- 게이트: head가 정확히 **11바이트** 줄고 **줄 수 불변**. 라이브 형상 픽스처에서 주입 concept **감소 0**, 절단 **0B 유지**(R5 적용 상태 기준).
- 기존 설치 전파: `schema_version: 1` 번들에 SessionStart 1회 → `schema_version: 2` 교체, `{{` **0회**, `okf: bootstrap` 커밋 **1건**. 저장소 전체에서 범프 **정확히 1회**.

**선행·롤백**: 선행 **S3a**(W2 OR — 하드 의존, 없으면 SCHEMA가 자기 자신에게 영구 W2), **릴리스 통합 커밋과 같은 브랜치**. 저장소 측은 `git revert` 한 번으로 완전히 되돌아간다(순수 텍스트 변경). **사용자 번들 측은 편도다** — `2 < 1`이 거짓이라 템플릿을 v1로 되돌려도 사용자 SCHEMA.md는 v2로 남는다. 내용까지 진짜 롤백하려면 **옛 본문을 담은 `schema_version: 3`을 새로 배포**해야 한다(번호를 내리는 방법은 코드에 없다). 사용자가 자기 번들만 되돌리려면 `git -C ~/.claude/okf checkout <이전커밋> -- SCHEMA.md`인데, **그 즉시 v1 < v2가 되어 다음 SessionStart가 다시 올린다** — 플러그인을 되돌린 뒤에만 유효하다. 이 두 문장을 릴리스 노트에 그대로 실어라. **부분 롤백 금지 조합**: `ingest.md:3`만 v0.1로 되돌리기(규정과 세대 선언이 갈라짐), SCHEMA에 `timestamp`만 되살려 lint 단언을 통과시키기(B3 재발).

---

#### S3b — 중첩 `log.md` 사각지대 폐쇄(W8)

**목표**: `lib/lint.mjs:161`의 `isLog` 판정이 `relPath === 'log.md'`라 **중첩 `log.md`가 §9 검사를 통째로 받지 않는** 사각지대(A3)를 닫는다. 단 기존 사용자 번들을 즉시 배치 정지로 몰지 않도록 **루트는 E3b 유지, 비루트는 W8**로 심각도를 가른다.

**근거**: spec-conformance §4 P8 / §3-A A3(CONFIRMED — 실측 `references/log.md`에 `## July 5 2026` + 오름차순 위반, lint 출력 0줄 EXIT=0). 마이그레이션 위험 평가: 라이브 번들 실측 `find <OKF_HOME> -name log.md` = **루트 1개, 중첩 0개**(이 사용자 위험 0). 일반 사용자에게도 생성 경로가 좁다 — `prompts/ingest.md:76`과 `templates/SCHEMA.md:11`이 루트 상대 `log.md`만 지시하고 분석기 cwd가 워크스페이스 루트다. 그러나 발생 시 폭발 반경이 '모든 ingest 영구 정지'(신호는 opt-in statusline 한 줄뿐)라 기대값 계산이 W를 가리킨다.

**구현 방법**

1. `lib/lint.mjs:161-162`:

```js
    const isLog = basename === 'log.md';
    const isRootLog = relPath === 'log.md';
    const reserved = isIndex || isLog;
```

`:178-180`의 호출을 `if (isLog) checkLogHeadings(content, relPath, isRootLog, errors, warnings);`로.

2. `checkLogHeadings`(`:66`) 시그니처에 `isRootLog`를 추가하고 첫머리에:

```js
  // 심각도 분기: 이 검사는 이번 릴리스에서 중첩 log.md에 **처음** 켜진다. 기존 번들의 중첩
  // log.md가 즉시 E3b가 되면 (1) 트리가 dirty할 때 handleDirtyWorkingTree(bin/batch.mjs:408-417)가
  // 배치 자체를 영구히 시작 못 하게 하고, (2) 청크마다 유료 repair 1회를 태우고, 못 고치면
  // rollbackChunk로 남은 청크를 전부 버린다. 루트 log.md는 지금도 E3b이므로 그대로 두고
  // (회귀 없음), 비루트만 W8로 착지시킨다. W8은 formatReport를 타고 repair 프롬프트에
  // 실리므로 다른 에러로 repair가 돌 때 기회적으로 자동 교정된다 — 조용히 묻히지 않는다.
  const sink = isRootLog ? errors : warnings;
  const rule = isRootLog ? 'E3b' : 'W8';
```

`:73`, `:80-84`의 두 `errors.push({... rule: 'E3b' ...})`를 `sink.push({ file: relPath, rule, message })`로. `:85`의 `break`(내림차순 위반 1건만)와 `:94-96`의 중복 날짜 W4는 **그대로 둔다**.

3. **W8 메시지에 규정 출처를 실어 repair가 근거 없이 움직이지 않게 한다.** 비루트 메시지에 접미 `(SCHEMA.md 규칙 3: 어느 디렉토리의 log.md든 "## YYYY-MM-DD")`를 붙인다.

4. **E3b 승격 조건**(다음 릴리스 이후 검토, 코드 주석에 남긴다): (1) 한 릴리스 주기 동안 W8 실측 발생이 0일 것. (2) 승격 릴리스 노트에 명시적 경고.

**검증 방법** (신규 `ok()` 5개)

- `nested log.md non-ISO heading is W8 (warn), not an error that would stall the batch`
  - 픽스처: `bootstrapped('lint-v02-nested-log')`의 `references/log.md`에 `# Log\n\n## July 5 2026\n- x\n\n## 2026-01-01\n- old\n\n## 2026-06-01\n- ascending violation\n`(비ISO + 오름차순 동시).
  - 단언: `rule === 'W8'` 경고 **≥ 2건** && **`report.errors.length === 0`** && `spawnSync(node, [lib/lint.mjs, home]).status === 0`(CLI EXIT=0 — 배치 게이트가 이 파일 하나로 멈추지 않음의 직접 증거).
- `root log.md non-ISO heading stays E3b` — 루트 심각도 회귀 가드. 기존 `E3b detected for ascending log dates`가 오름차순만 덮으므로 비ISO 축을 명시적으로 고정한다.
- `a bundle with a nested non-ISO log.md still runs a batch to completion`
  - 픽스처: `setupBatchSandbox('w8-warn')` + 위 중첩 log.md를 심고 **커밋하지 않은 채**(dirty 트리) `runBatch(...'success')`.
  - 단언: `lastBatch(home).lastResult === 'ok'`. **`handleDirtyWorkingTree`(`bin/batch.mjs:398-417`) 경로에서 신규 규칙이 배치 시작을 막지 않는다는 직접 단언** — `runLint` 반환값과 CLI 종료코드만으로는 이것을 측정할 수 없다.
- `W8 message cites the SCHEMA rule it enforces` — 메시지에 `SCHEMA.md 규칙 3` 포함.
- `a freshly bootstrapped bundle produces no W8` — 신규 잡음 0.

**통과 규칙**

- 기준선 422 → **427 passed, 0 failed**, exit 0.
- 중첩 log.md에 비ISO + 오름차순 위반을 동시에 심은 번들에서 `runLint().errors.length === 0`, `W8` 경고 **≥ 2건**, `node lib/lint.mjs <home>` 종료코드 **0**.
- **dirty 트리 + 중첩 log.md 위반 상태에서 `runBatch` → `lastResult === 'ok'`.** 배치 정지·청크 롤백·추가 유료 repair 호출 **0회**.
- 기존 사용자 번들에서 새로 발생하는 **E 등급 findings 0건**.
- 부트스트랩 직후 W8 **0건**.

**선행·롤백**: 선행 **S5**(SCHEMA 규칙 3 문구 — 없으면 규정에 없는 것을 경고하는 셈이다. **S5 없이 단독 착지 금지**), **S3a**(같은 파일). 격리 롤백이 쉽다 — `lib/lint.mjs:161`을 `const isLog = relPath === 'log.md';`로 되돌리고 `checkLogHeadings`의 `sink`/`rule` 두 줄을 리터럴로 되돌리면 다른 것에 영향 없이 사각지대만 원상복귀한다(해당 테스트 5개도 함께 제거). 번들·상태 파일에 흔적 0.

---

#### S1 — `generated` 코드 스탬핑 + actor 규약 + `runClaude` 반환 확장

**목표**: 배치가 이번 회차에 **실제로 만들거나 고친** concept에만 §5.2의 `generated: {by, at}`를 **코드가** 찍는다. LLM에게 시키지 않는다(Rule 5 — 코드가 답할 수 있으면 코드가 답한다). `by`는 `okf-system/<실제 모델>`, 모를 때 `okf-system/unknown`.

**근거**: spec-conformance §4 P1("`prev`/`next` 바이트 비교(:779)가 이미 변경된 비예약 .md를 정확히 식별한다 … ingest 후(:821)와 repair 후(:847) 두 번 호출되므로 스탬핑한 바이트를 번들과 워크스페이스 **양쪽에** 써야 한다"), §3 B1(라이브 22개 중 `generated` 보유 **0개**), §8 Q1(§13.1 폴백이 MAY → "선언과 생산은 같은 릴리스에"), Q2(actor = `okf-system/<실제 모델>`, `config.batch_model`은 비어 있을 수 있으므로 `runClaude`가 파싱한 `result.modelUsage` 키를 반환값에 실어야 정확해진다), §5-2("`timestamp` → `generated.at` 기계 복사는 위조다 — 22개 중 4개가 8~10일 틀렸다"), §2 B7(무따옴표 ISO는 `Date` 객체 → 문자열 비교 전멸). 코드: `bin/batch.mjs:651`(`total_cost_usd`를 파싱하고 `:665`에서 버린다), `:779`(바이트 비교), `:781-784`(SCHEMA/`okf_seed` 차단), `:770`(index.md 제외), `lib/lint.mjs:162`(예약 파일).

**구현 방안**: 핵심 계약은 **"코드가 찍는다, LLM에게 시키지 않는다"** 이고, 그 계약이 새는 지점이 하나 있다 — 분석기가 **신규 파일**에 `generated: {by: human:...}`를 흉내내 써넣으면 "남의 generated는 존중한다" 규칙이 "분석기가 사람인 척한 출처를 존중한다"로 새고, 다음 배치가 그 파일을 고쳐도 영원히 안 고쳐진다. 그래서 **존중 여부는 `next`(워크스페이스 산출물)가 아니라 `prev`(번들에 이미 있던 바이트)로 판정한다.**

**구현 방법**

1. **`lib/generated-stamp.mjs` 신설** — 프론트매터 **텍스트 블록만** 인덱스 산술로 건드린다. `yaml.dump` 재직렬화를 절대 쓰지 마라(키 순서·따옴표·미지 키가 통째로 재작성되어 §4.1 round-trip SHOULD를 깬다).

```js
export function stampGenerated(text, { by, at }, { trustExisting = true } = {}) {
  if (!SAFE_BY_RE.test(String(by ?? '')) || !SAFE_AT_RE.test(String(at ?? ''))) return null;
  const parsed = parseFrontmatter(text);
  if (!parsed.hasFrontmatter || parsed.parseError || !isPlainObject(parsed.data)) return null;
  const m = FM_SPLIT_RE.exec(text);
  if (!m) return null;
  const fmStart = m[1].length, yamlText = m[2];
  const eol = m[1].endsWith('\r\n') ? '\r\n' : '\n';
  const block = `generated:${eol}  by: "${by}"${eol}  at: "${at}"`;
  let nextYaml;
  if (Object.hasOwn(parsed.data, 'generated')) {
    if (SELF_BLOCK_RE.test(yamlText)) {
      nextYaml = yamlText.replace(SELF_BLOCK_RE, () => block);   // 우리 블록 갱신
    } else if (trustExisting) {
      return null;                                                // 번들에 이미 있던 남의 generated — 존중한다
    } else {
      // 이번 회차에 분석기가 새로 만든 파일이다. 여기 있는 generated는 사람이 붙인 것일
      // 수 없다 — 코드가 찍는다는 계약(Rule 5)에 따라 통째로 대체한다.
      // 컬럼 0의 키 한 줄 + 뒤따르는 들여쓴 줄 전체를 한 항목으로 잡는다(block/flow/scalar 공통).
      const GENERATED_ENTRY_RE = /^generated:(?:[^\n]*)(?:\n[ \t]+[^\n]*)*$/m;
      if (!GENERATED_ENTRY_RE.test(yamlText)) return null;
      nextYaml = yamlText.replace(GENERATED_ENTRY_RE, () => block);
    }
  } else {
    nextYaml = yamlText === '' ? block : `${yamlText}${eol}${block}`;
  }
  if (nextYaml === yamlText) return null;
  return text.slice(0, fmStart) + nextYaml + text.slice(fmStart + yamlText.length);
}
```

상수: `FM_SPLIT_RE = /^(---\r?\n)([\s\S]*?)(\r?\n---[ \t]*\r?\n?)/`, `SELF_BLOCK_RE`(우리 canonical 3줄만 매치), `SAFE_BY_RE = /^okf-system\/[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/`, `SAFE_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/`.

파일 상단 주석에 설계 결정 3개를 근거와 함께: (1) **값은 반드시 큰따옴표**(무따옴표는 `Date` 객체가 되어 `'2027-01-05' >= <Date>`조차 false — B7 실행 확인), (2) **블록은 프론트매터 맨 끝에** (앞 키가 블록 스칼라여도 컬럼 0의 새 키가 정상 종료시키고 권장 키 순서를 흔들지 않는다), (3) **`replace`는 함수 폼** (문자열 폼이면 `$&`/`$'`가 발동한다 — `bin/batch.mjs:681-685`와 같은 함정).

2. **`bin/batch.mjs` 헬퍼 4개**를 `runClaude`(`:569`) 위에: `pickModelFromUsage(modelUsage)`(출력 토큰 최다, 동점은 이름 오름차순으로 갈라 결정성 보장), `actorFor(model)`(화이트리스트 통과 못 하면 `unknown` — **`config.batch_model`로 대신 채우지 마라. 그건 '오늘의 요청값'이지 '실제로 답한 모델'이 아니다**), `isoSecondsUtc(d)`, `numericOnly(obj)`.

```js
// 이 파일의 날짜 라벨은 예외 없이 localDateString()(로컬)이다(:31-36 주석). generated.at만은
// OKF SPEC §5.2가 ISO8601을 요구하므로 UTC다 — 의도된 예외이니 통일하려 들지 마라.
function isoSecondsUtc(d = new Date()) { return `${d.toISOString().slice(0, 19)}Z`; }
```

3. **`runClaude` 반환에 `model` 추가.** R2가 릴리스 1에서 이미 `{ok, output, costUsd, usage, numTurns}`로 확장했으므로 **`model` 필드만 additive로 더한다**(4개 반환 경로 전부). 실패 경로 중 `:660-664`(INCOMPLETE)만 모델을 알고, `:624-626`/`:666-668`은 `model: ''`이다. `models: Object.keys(result?.modelUsage || {})`(벤치 레코드)는 그대로 둔다.

4. **`applyAnalyzerWorkspace`에 stamp 인자.** `bin/batch.mjs:755`의 시그니처를 `function applyAnalyzerWorkspace(okfHome, wsRoot, stamp = null)`로(기본값 null = 종전 동작). 스탬핑은 **반드시** (a) `:779`의 `Buffer.compare` 동일성 검사 **뒤**, (b) `:781-784`의 SCHEMA/`okf_seed` 차단 게이트 **뒤**에 온다. `:786-788`을 교체:

```js
      let out = next;
      if (stamp && e.name !== 'log.md') {
        // trustExisting은 prev(번들에 이미 있던 바이트) 기준이다. next 기준으로 판정하면
        // 분석기가 방금 써넣은 generated가 '남의 것'으로 둔갑해 코드 스탬핑을 무력화한다.
        const stampedText = stampGenerated(next.toString('utf8'), stamp, { trustExisting: prev !== null });
        if (stampedText !== null) {
          out = Buffer.from(stampedText, 'utf8');
          stamped++;
          // 이 함수는 ingest 후(:821)와 repair 후(:847) 같은 wsRoot를 두 번 본다. 워크스페이스에
          // 같은 바이트를 되쓰지 않으면 2차 호출에서 스탬프된 파일 전부가 Buffer.compare != 0이
          // 되어, repair가 건드리지도 않은 파일의 at까지 새 시각으로 갈아엎힌다.
          try { fs.writeFileSync(abs, out); } catch { /* 번들 반영은 이미 안전하다 */ }
        }
      }
      fs.mkdirSync(path.dirname(destAbs), { recursive: true });
      fs.writeFileSync(destAbs, out);
      applied++;
```

`:793-795`의 blocked 로그 옆에 `if (stamped > 0) log(okfHome, \`generated 스탬프 ${stamped}건\`);`(숫자만 — 파일명·값 금지). 반환값은 **R3이 이미 `{applied, blocked}`로 넓혔으므로** 그 형태를 유지한다.

**순서를 어기면 즉사한다**: 동일성 검사 앞에 두면 모든 파일이 매번 재기록돼 유실 백스톱(`:828-831`)이 영구 무력화된다. 차단 게이트 앞에 두면 SCHEMA와 시드가 스탬프된다. `log.md` 제외를 빠뜨리면 지금은 우연히 안전하지만(프론트매터가 없어 null 반환) 누군가 log.md에 프론트매터를 붙이는 순간 조용히 깨진다.

5. **두 호출부에 stamp 전달.** `:821`과 `:847`. `at`은 **호출당 1개**다(같은 LLM 호출에서 나온 파일들이 같은 시각을 공유해야 정직하고 테스트에서도 결정적이다). repair 쪽은 `by: actorFor(repairResult.model || ingestResult.model)` — 폴백을 빼면 repair가 만든 파일이 같은 모델인데도 `unknown`이 된다.

6. **`test/fixtures/fake-claude.mjs`**: 전역 조기 분기 `if (isRepairCall) {`(**`:97`**) 안, **`:98`의 `if (mode !== 'badoutput-unfixable') repairBadConcept();` 앞**에 `stamp-repair` 분기를 넣는다(워크스페이스 사본에 `generated:`가 있는지 읽어 `decisions/ws-echo.md`에 증언을 남긴다 — 시각 비교에 의존하지 않는 유일한 결정적 관측이다). 그리고 `switch (mode)`에 케이스 2개:

```js
  case 'stamp-repair':
    writeConcept(); writeBadConcept(); break;   // lint E1 -> repair 1회를 유발한다
  case 'stamp-forge':
    // 분석기가 사람 출처를 날조해 코드 스탬핑을 회피하려는 시도.
    fs.mkdirSync('decisions', { recursive: true });
    fs.writeFileSync('decisions/forged.md',
      '---\ntype: decision\ntitle: 위조 시도\ndescription: d\ntimestamp: 2026-07-15\ngenerated:\n  by: human:ducksu\n  at: "2020-01-01T00:00:00Z"\n---\n본문\n');
    break;
```

`isRepairCall` 판정은 `prompts/repair.md:20`의 문자열에 결합돼 있다 — 이 WP에서 프롬프트 문구를 건드리지 마라.

7. **비범위 확정**(PR 설명에 명시): 기존 concept 22개 일괄 변환 금지, `verified`/`stale_after`/`sources` 생산 금지(프롬프트에 언급조차 넣지 마라). 리뷰어가 "기왕이면 기존 22개도 채우자"고 제안하면 §1.0.2-4를 링크하고 거절하라.

**검증 방법** (신규 `ok()` 15개)

유닛 7개(순수 함수, 샌드박스 불필요): `generated stamp: a v0.1 concept gains a generated block` / `... existing keys and body survive byte-for-byte`(`timestamp: 2026-07-15` 잔존 + `---\n본문\n`으로 끝남) / `... at parses as a string, not a YAML Date` / `... a file without frontmatter is left alone`(`null`) / `... unparseable frontmatter is left alone`(`null`) / `... a foreign generated.by is respected, never overwritten`(**`trustExisting` 기본 true** — 기존 파일 시나리오) / `... our own block is refreshed in place, never duplicated`(`/^generated:$/gm` 매치 수 1).

배치 8개:
- `success: batch stamps generated.by with the model that actually answered` — `  by: "okf-system/claude-sonnet-5"`(fake-claude가 `modelUsage`를 낸다 → `runClaude`가 실어 내보내고 `actorFor`가 썼다는 증거).
- `success: generated.at is ISO8601 UTC seconds and appears exactly once` — `/^ {2}at: "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z"$/m`, 블록 1회.
- `success: reserved files (log.md / SCHEMA.md / okf_seed seeds / index.md) are never stamped` — `readIfExists`로 4파일 모두 `generated:` 미포함. **log.md는 success 모드에서 실제로 수정되므로 '변경됐지만 스탬프 안 됨'의 진짜 케이스다.**
- `stamp-repair: the repair stage sees the stamped bytes in its workspace copy` — `ws_generated=yes`. 되쓰기를 빼면 `no`가 되어 실패한다.
- `stamp-repair: a concept the repair stage never touched keeps exactly one generated block`
- **`stamp-forge: an analyzer-authored generated.by cannot survive as human provenance`**
  ```js
  const home = setupBatchSandbox('stamp-forge');
  runBatch({ okfHome: home, env: { FAKE_CLAUDE_MODE: 'stamp-forge' } });
  const forged = readIfExists(path.join(home, 'decisions', 'forged.md'));
  ok('stamp-forge: an analyzer-authored generated.by cannot survive as human provenance',
    forged.includes('  by: "okf-system/claude-sonnet-5"') && !forged.includes('human:ducksu'));
  ```
  기존 `a foreign generated.by is respected`는 **기존 파일** 시나리오만 덮고 신규 파일 구멍을 정확히 놓친다.
- `stamping does not change a single byte of the injected gate context` — 인프로세스로: concept 1개 작성 → `regenerateIndex` → ctx 캡처 → 같은 파일에 `stampGenerated` 적용 → `regenerateIndex` → ctx 재캡처 → `Buffer.byteLength` 동일. (`extractEntry`는 title/description만 읽으므로 `generated`는 index 줄에 실리지 않는다.)
- `a failed workspace write-back cannot spread the new at beyond the repaired file` — 워크스페이스 파일을 읽기 전용으로 만들어 되쓰기를 실패시키고, 2차 apply가 **무관 파일을 재기록하지 않는지** 단언(`at` 오염 범위 고정). `stamp-repair`는 성공 경로만 관측한다.

**통과 규칙**

- 기준선 427 → **442 passed, 0 failed**, exit 0, 3-OS.
- 유료 LLM 호출 **0회 추가**: `grep -c 'runClaude(' bin/batch.mjs` = **3**(정의 1 + 호출 2), 회차당 유료 호출 상한 **4회** 불변.
- `FAKE_CLAUDE_MODE=success` 1회 후 `generated:` 보유 파일 **정확히 1개**, `log.md`/`SCHEMA.md`/모든 `index.md`/모든 `okf_seed` 시드에서 **0회**. 파일당 블록 출현 **1회**.
- **위조 차단**: 분석기가 신규 파일에 `by: human:...`을 써도 코드 스탬프가 덮는다(`trustExisting`은 `prev !== null` 기준). `human:` 문자열 잔존 **0건**.
- `parseFrontmatter(스탬프된 concept).data.generated.at`이 `typeof === 'string'` **100%**(`Date` 객체 **0건**).
- 스탬프 후 `runLint(home).errors.length === 0`, 스탬핑으로 새로 생기는 warning **0건**.
- **게이트 주입 바이트 변화 0B.** concept 1개당 디스크 비용은 `generated` 블록 3줄(≤ 80바이트)이고 컨텍스트 비용은 **0**.
- repair 회차에서 2차 apply가 재기록한 파일 수 ≤ (repair가 실제로 건드린 파일 수 + 신규 파일 수).

**선행·롤백**: 선행 **R2**(`runClaude` 반환 확장 — `model`만 additive로 더한다), **§13.1 원자성으로 S2·S5와 같은 릴리스**. 부분 롤백: `applyAnalyzerWorkspace`의 3번째 인자를 두 호출부에서 빼는 것만으로 스탬핑이 완전히 꺼진다(기본값 `stamp = null`). **이미 스탬프된 사용자 번들은 되돌릴 필요가 없다** — `generated`는 §5.2 optional이고 v0.1 하에서도 어떤 lint 규칙에도 걸리지 않으며 게이트 바이트도 0이다. 잘못됐다는 신호: 로그의 `generated 스탬프 N건`에서 N이 그 회차 변경 파일 수보다 크면(= 전 번들 일괄 스탬핑 = 유실 백스톱 무력화) 즉시 롤백하라.

---

#### S2 — `okf_version` 승격 · 루트 index 미지 키 보존

**목표**: 번들 루트 `index.md`의 선언을 `okf_version: "0.1"` → `"0.2"`로 승격하되 **"0.1"인 경우에만** 올리고 외부 도구가 쓴 값은 절대 건드리지 않는다. 동시에 `buildRootIndex`가 매 재생성마다 파괴하는 루트 프론트매터의 미지 키를 원본 라인 그대로 보존한다(§4.1 SHOULD).

**이 WP에서 삭제된 두 단계**(§1.1.6): (a) `schema_version` 범프 → **S5로 이관**(본문 무변경 범프는 사용자 편집을 파괴할 뿐 아무것도 전파하지 않는다), (b) bootstrap 락 가드 → **R3으로 이관**(릴리스 1에서 이미 착지). 여기서는 그 가드가 schema 범프 아래에서도 유효한지 **테스트만** 얹는다.

**근거**: spec-conformance §3 A1(루트 index 미지 키를 매 재생성마다 파괴 — `lib/index-gen.mjs:39-50,:58`, 실측 `x_tool_state` 소실. 배치 경로에서는 `regenerateIndex`가 `runLint`보다 먼저 돌아(`bin/batch.mjs:833-834`) W4 경고조차 못 뜬다), B12(`test/smoke.mjs:497`이 승격과 함께 깨지고 리터럴만 바꾸면 회귀 커버리지 소멸), §5 마이그레이션 결정. reliability T10.1(`lib/index-gen.mjs:49` 하드코딩 `'0.1'` + 보존 로직 때문에 자동 승격 경로 부재).

**구현 방법**

1. **`parseFrontmatter`에 `raw` 추가**(순수 추가). `lib/frontmatter.mjs:8-20`의 세 반환 지점 모두에 원본 YAML 라인 블록을 싣는다. 소비자 5곳(`lib/lint.mjs:164`, `lib/index-gen.mjs:29,42`, `lib/viz.mjs:51`, `lib/config.mjs:90`)이 전부 구조분해로 특정 키만 꺼내므로 키 추가는 무해하다. 기존 키 이름·의미를 바꾸면 5곳이 동시에 깨진다 — 추가만 하라.

2. **`lib/index-gen.mjs`의 `readExistingOkfVersion`(`:39-50`)을 교체.** 함수명도 바꾼다(반환 형태가 다르므로 옛 이름을 남기면 호출부 착각을 부른다).

```js
export const OKF_VERSION = '0.2';
const OKF_VERSION_LINE_RE = /^okf_version:[^\n]*$/m;

// SPEC §4.1 'Consumers SHOULD preserve unknown keys when round-tripping.'
// 예전엔 값 하나만 뽑고 프론트매터를 통째로 새로 만들어, 외부 도구가 넣은 키가 매 재생성마다
// 소리 없이 사라졌다(실측: x_tool_state 투입 → 재생성 후 소실).
function readRootFrontmatter(rootIndexPath) { /* 파손/비객체면 {block: null, version: null} */ }
// '0.1'만 승격한다. 외부 도구가 쓴 '0.3'을 0.2로 되돌리면 다운그레이드이자 월권이다.
function promoteOkfVersion(existing) { return existing === null ? OKF_VERSION : (existing === '0.1' ? OKF_VERSION : existing); }
function renderRootFrontmatter(block, okfVersion) { /* 있으면 그 줄만 함수 폼 replace, 없으면 맨 앞에 추가 */ }
```

**파손 프론트매터는 보존하지 않는다** — 보존하면 lint E3a(루트 index 파싱 실패)가 영구화되고 `handleDirtyWorkingTree`가 모든 ingest를 정지시킨다. 오늘의 '통째 재작성 = 자기 치유' 성질을 그 경우에만 유지한다.

실행 검증 완료(8케이스): `"0.1"`→`"0.2"` / `"0.3"`+`x_tool_state`→둘 다 그대로 / 키가 중간에 있고 뒤에 `# 주석`→줄 위치·주석 보존 / CRLF→LF 정규화 후 보존 / 리스트·스칼라·파싱실패·프론트매터 부재→전부 단독 블록으로 재작성.

3. **`buildRootIndex`/`regenerateIndex`가 `{okfVersion, promoted}`를 반환.** 출력 바이트는 기존과 동일해야 한다 — 블록이 정확히 `okf_version: "<v>"` 한 줄인 일반 번들에서 예전 포맷과 **바이트 일치**(불필요한 diff·커밋 방지). 기존 호출부 11곳은 전부 반환값을 버리므로 안전하다(grep 재확인).

4. **승격 회차의 커밋 메시지를 갈라 쓴다.** `lib/bootstrap.mjs:111`을 `let indexResult = null; if (seeded || !fs.existsSync(paths.rootIndex)) indexResult = regenerateIndex(okfHome);`로, `:113-121`의 커밋 메시지를 `indexResult?.promoted ? \`okf: bootstrap (OKF v0.1 → v${indexResult.okfVersion})\` : 'okf: bootstrap'`으로. **화살표는 U+2192**(테스트가 완전일치로 단언한다 — ASCII `->`로 바꾸면 깨진다).

5. **승격 전파 경로는 둘이다.** 이것을 코드 주석과 릴리스 노트에 명시한다:
   - (a) `lib/bootstrap.mjs:111` — S5의 schema 범프 등으로 `seeded`가 서면.
   - (b) `bin/batch.mjs:833`/`:848`이 **청크마다** 부르는 `regenerateIndex`.

   **(b)만으로도 배치가 한 번 성공하면 승격된다.** 그 회차 커밋은 `okf: ingest <date> (chunk i/N)`에 버전 줄 변경 1건이 섞인다. 배치를 한 번도 안 돌린 사용자는 S5의 schema 범프나 다음 성공 배치에서 승격된다. **"schema 범프가 유일한 트리거"는 거짓이다** — 그 거짓이 S2 step 6(파괴적 범프)의 유일한 근거였다.

6. **`test/smoke.mjs:496-497` 두 줄 삭제**(`root index.md preserves okf_version`) 후 보존/승격 테스트로 분리한다. **`test/smoke.mjs:475`(`lint-root-extra-key`)는 `okf_version: "0.1"`을 직접 쓰지만 `regenerateIndex`를 부르지 않으므로 손대지 마라** — 그 테스트의 대상은 W4이고, 미지 키 보존을 넣어도 W4는 **유지**가 정답이다(§8/§12가 루트 index의 `okf_version`만 예외로 허용).

   확인 기록: `regenerateIndex` 후 루트 index를 읽는 다른 단언 2곳(`test/smoke.mjs:1021-1022` novel-dir, `:1114-1115` seed)은 `okf_version`을 단언하지 않아 승격에 영향받지 않는다(실측 확인).

**검증 방법** (신규 10개, 기존 1개 삭제 → 순증 9)

- `root index.md preserves a foreign okf_version (다운그레이드 금지)` — `"0.3"` + `x_tool_state: keep-me`를 심고 `regenerateIndex` → 값 유지, `promoted === false`. **값이 비-0.1이라 리터럴 교체로 무력화되지 않는다.**
- `root index.md preserves unknown frontmatter keys across regeneration` — `x_tool_state: keep-me` 잔존.
- `root index.md promotes okf_version "0.1" to the v0.2 declaration` — `promoted === true`.
- `unparseable root frontmatter is rebuilt, not preserved (E3a 자기 치유 유지)` — `runLint().errors.length === 0`, detail로 `formatReport`.
- `a freshly bootstrapped bundle declares okf_version "0.2"`
- `bootstrap commit message records the OKF version promotion` — `git log -1 --pretty=%s`가 `okf: bootstrap (OKF v0.1 → v0.2)`와 완전일치.
- `schema-sync fixture anchor still exists in the SCHEMA template` — `test/smoke.mjs:185`의 로컬 편집 픽스처 앞에 `const edited = synced.replace('# 절대 규칙', ...); ok(..., edited !== synced);`. **S5의 SCHEMA 본문 개편에서 `# 절대 규칙` 헤딩이 사라지면 replace가 no-op이 되어 '로컬 편집 보존' 테스트가 조용히 무의미해진다** — 그 무의미화를 먼저 실패로 만든다.
- **`a single successful batch promotes okf_version without a schema bump`** — `okf_version: "0.1"`인 번들에 `runBatch({ FAKE_CLAUDE_MODE: 'noop' })` 1회 → 루트 index가 `"0.2"`. 이게 없으면 "schema 범프가 유일한 트리거"라는 잘못된 서술을 아무도 반증하지 못한다.
- `the promotion commit happens exactly once` — 위 배치의 커밋 증가가 정확히 1, **2회차 실행에서 커밋 증가 0**.
- `a promoted bundle still lints clean under the previous plugin release` — `git worktree add`로 0.2.0 코드를 확보해 승격된 번들에 `runLint` EXIT 0 + `regenerateIndex` 보존 + 게이트 정상. **롤백 절의 실측 주장을 기계로 고정한다.**

**통과 규칙**

- 기준선 442 → **451 passed, 0 failed**, exit 0, 3-OS.
- 다운그레이드 **0건**: `"0.2"`/`"0.3"`/`"1.0"`/무따옴표 `0.3` 4종에 `regenerateIndex` 3회 → 값 변경 **0/4**, `promoted === false` **4/4**.
- 미지 키 보존 **100%**: 키 3개(`x_tool_state`/`x_owner`/`x_seq`)를 심고 `regenerateIndex` 3회 → 잔존 **3/3**, 라인 순서 문자열 완전일치, **2회차와 3회차 산출 바이트 차 0**.
- 승격 멱등성: `"0.1"` 번들에 배치 1회 → 커밋 증가 **정확히 1**, 2회차 커밋 증가 **0**, `git status --porcelain` **0바이트**.
- lint 무증가: 4종 픽스처 전부 `errors.length === 0`, 미지 키 픽스처의 `{file:'index.md', rule:'W4'}`가 **정확히 1건**(경고는 완화하지 않는다).
- 유료 호출 **0회**(신규 블록 전부 인프로세스 또는 fake-claude).
- 다운그레이드 안전성: 승격된 번들을 0.2.0 코드로 읽었을 때 lint EXIT **0**, index-gen 보존, 게이트 정상, viz 무예외.

**선행·롤백**: 선행 **S1**(§13.1 원자성), **S5**(schema 범프가 전파 경로 (a)를 제공). 부분 롤백: `OKF_VERSION`을 `'0.1'`로 되돌리면(1줄) 승격만 꺼지고 보존은 그대로 산다. **되돌릴 수 없는 것**: 이미 `"0.2"`로 승격된 번들의 선언은 플러그인을 되돌려도 남는다(구 코드의 `readExistingOkfVersion`이 비어있지 않은 값을 무조건 보존한다) — 무해함을 0.2.0 코드로 확인했다.

---

#### S4 — `status: deprecated` 생산·소비 + `/okf:okf-deprecate`

**목표**: 이 시스템에는 "잊기"가 없다. 라이브 번들의 references 게이트 슬롯 2개를 **번들 자신이 "무관한 벤치마크 잡음"이라고 선언한 `# 리다이렉트` 묘비 2건**이 점유하고 있고, `regenerateDir`의 정렬이 파일명 사전순 단독이라 실제 문서가 대신 잘린다. §5.4를 **소비**(`extractEntry`가 읽고, `regenerateDir`이 목록 맨 뒤 + `- [deprecated] ` 접두, 게이트가 그 줄을 round-robin에서 스킵)와 **생산**(좁은 발동 조건 + 청크당 상한 3건을 **코드가 시행** + 자동 삭제 없음) 양쪽에서 구현하고, `/okf:okf-deprecate <path|검색어>`를 추가한다. **index.md에서 은퇴 줄을 지우지 않는다** — 링크 보존이 deprecated의 존재 이유다(§5.4 "kept for links and history", §6.1 "Consumers MUST tolerate broken links").

**근거**: spec-conformance §3 B4(CONFIRMED: `extractEntry`가 title/description만 읽어 폐기 concept가 표식 없이 매 세션 주입 — 실측으로 그 2건 제외 시 **12/22 → 13/20**, references 슬롯이 실제 문서로 교체), B5(예산 포화), §4 P9·P10·P11, §8 Q4(기존 묘비 수동 태깅은 사용자 승인 사항). reliability T10.7(SPEC v0.2에 "delete"라는 단어가 없다 — 위생 목적 은퇴의 스펙 정합 형태는 물리 삭제가 아니라 deprecation), T3.8(커밋하지 않은 forget은 stale-lock rollback에 조용히 되살아난다), T3.9(백틱으로 감싼 경로는 `LINK_RE`에 안 걸려 잔존 참조가 경고조차 안 난다), §5 항목 7(A).

**구현 방안**: 판정자는 **`lib/trust.mjs` 한 곳**(§1.1.6). `lib/frontmatter.mjs`에는 **쓰기 전용** `setFrontmatterStatus`만 둔다(파서/직렬화 관심사이므로 위치가 맞다). SCHEMA·ingest 편집은 **S5가 이미 했다** — 이 WP는 그 문서를 건드리지 않는다. lint 경고는 **S3a가 W7로 이미 냈다** — 이 WP는 lint를 건드리지 않는다.

**구현 방법**

1. **`lib/trust.mjs`에 `conceptStatus` 추가**(S3a가 만든 파일에 없는 함수만 더한다):

```js
const CONCEPT_STATUSES = new Set(['draft', 'stable', 'deprecated']);
// §5.4: status 부재 시 stable. §11: 미지 값을 이유로 거부하지 않는다 -> stable로 흡수한다.
export function conceptStatus(fm) {
  if (!isPlainObject(fm)) return 'stable';
  const raw = fm.status;
  if (typeof raw !== 'string') return 'stable';
  const v = raw.trim().toLowerCase();
  return CONCEPT_STATUSES.has(v) ? v : 'stable';
}
```

**`lib/frontmatter.mjs`에 `CONCEPT_STATUSES`/`isDeprecated`를 만들지 마라.** 검증: `grep -rn "CONCEPT_STATUSES\|conceptStatus" lib/`의 히트가 `lib/trust.mjs`와 그 import 구문에만 있어야 한다.

2. **`lib/frontmatter.mjs`에 쓰기 전용 `setFrontmatterStatus(content, value)`** — `status:` 한 줄만 텍스트로 교체/삽입한다. YAML 재직렬화 금지. `STATUS_LINE_RE`는 `/^status:[^\r\n]*/m`(`.*`는 `\r`을 먹어 CRLF 파일에서 개행이 섞인다). `type:` 줄이 없으면 블록 끝에 붙여 삽입 위치를 결정적으로 만든다. `value === null`이면 제거. 프론트매터 앞에 빈 줄이 있으면 `null`을 반환한다(그건 lint E1 대상이므로 호출자가 거부해야 정상이다).

3. **`lib/index-gen.mjs` 소비.** import에 `import { conceptStatus } from './trust.mjs';`. `DIR_DESCRIPTIONS` 아래:

```js
// index.md는 은퇴 concept를 지우지 않는다 — 링크 보존이 deprecated의 존재 이유다.
// 게이트(bin/session-start.mjs readCategoryLines)가 이 상수를 import해 주입에서 제외하므로,
// 값을 바꾸면 양쪽이 함께 움직인다 — 텍스트 포맷으로만 결합돼 있던 두 모듈을 코드 결합으로
// 승격시킨 지점이다.
export const DEPRECATED_PREFIX = '- [deprecated] ';
```

`extractEntry`(`:25-37`)의 반환에 `status`를 더한다(폴백 3곳 전부 `'stable'`). **`regenerateDir`의 줄 생성부는 `:108-118`이고 반환은 `:121`이다**(`:95-102`는 필터, `:105-106`은 재귀). 줄 생성을 partition으로 바꾼다 — `files`는 `:99`에서 이미 사전순이므로 두 그룹 각각 사전순이 유지된다. 은퇴 줄은 **하위 도메인 링크보다도 뒤**(목록 전체의 꼬리). `:121`의 반환에서 은퇴를 뺀다(카운트의 목적은 "지금 유효한 지식이 몇 개인가"다). 그 위에 "index.md 줄 수와 카운트가 은퇴 수만큼 어긋나는 것은 의도"라고 주석.

`DEPRECATED_PREFIX`가 `- `로 시작하지 않으면 게이트의 bullet 필터가 그 줄을 비-bullet으로 본다. 마커를 링크 안쪽에 넣으면 `LINK_RE`가 잡는 링크 텍스트가 오염된다.

4. **게이트 스킵 한 줄.** `bin/session-start.mjs:15-21 readCategoryLines`의 반환을:

```js
      // `- `로 시작하는 줄만이 concept다. .filter(Boolean)은 빈 줄만 걸러서, index.md에
      // bullet 아닌 줄이 하나라도 생기면 게이트가 그것을 concept로 세고 주입한다(N/M 카운트까지
      // 거짓이 된다). 은퇴 줄은 index.md에 남기되 여기서만 뺀다 — 링크는 보존하고 예산은 돌려받는다.
      .filter((l) => l.startsWith('- ') && !l.startsWith(DEPRECATED_PREFIX));
```

`buildInjectedIndex`는 손대지 않는다 — `c.lines.length`가 이미 필터 후 개수라 heading의 `N/M개`와 마커가 자동으로 현역 기준이 된다. **게이트 head/tail 문구는 한 글자도 늘리지 않는다.**

5. **`bin/deprecate.mjs` 신설.** CLI: `node bin/deprecate.mjs <상대경로> [--restore]`. 종료 코드가 기계 신호다: **0**=성공/무변경, **1**=예기치 못한 오류, **2**=락 점유, **3**=사전 lint 에러, **4**=대상 부적합, **5**=사후 lint 실패(롤백함).

순서(R3의 락 API를 소비한다):

```js
const lock = acquireLock(okfHome, 'deprecate', { onLog: (m) => console.error(m) });
if (!lock.acquired) return fail(2, '배치가 실행 중이라 은퇴를 적용하지 않았다. /okf:okf-status로 확인 후 다시 시도하라.');
try {
  // bin/batch.mjs:397-406과 같은 정책: stale 락을 회수했다면 남은 dirty 트리는 사용자 편집이
  // 아니라 크래시 잔여물이다. 커밋하면 반쯤 반영된 분석기 산출물이 영구화된다(§7-4가 막으려던 사고).
  if (lock.recoveredFromStaleLock && isDirty(paths.home)) {
    console.error('stale lock 회수 후 dirty 트리 발견 — 크래시 잔여물로 판단해 원복한다');
    rollback(paths.home);
  }
  const pre = runLint(okfHome);
  if (pre.errors.length > 0) return fail(3, formatReport(pre));
  if (isDirty(paths.home)) commitAll(paths.home, 'okf: pre-batch: user edits');
  // 대상 검증 → setFrontmatterStatus → appendLogEntry → regenerateIndex → 사후 lint → commitAll → 잔존 참조 보고
} finally { releaseLock(okfHome, lock.token); }
```

대상 검증: 경로 탈출(`abs`가 `okfHome + path.sep`으로 시작), `.md` 확장자, 예약 basename(`index.md`/`log.md`/`SCHEMA.md`), `SCAN_EXCLUDE_DIRS` 세그먼트, `/^okf_seed:\s*true\b/m`(시드 보호 — `bin/batch.mjs:783`과 같은 경계).

**잔존 참조 스캔에서 예약 파일을 뺀다** — 안 그러면 100% 거짓 양성이다:

```js
const RESERVED_BASENAMES = new Set(['index.md', 'log.md']);
for (const other of walkMdFiles(okfHome)) {
  if (other === rel) continue;
  // index.md는 방금 우리가 재생성했고 log.md에는 방금 우리가 항목을 썼다 —
  // 둘 다 '잔존 참조'가 아니라 이 명령의 산출물이다.
  if (RESERVED_BASENAMES.has(path.basename(other))) continue;
  if (fs.readFileSync(path.join(okfHome, other), 'utf8').includes(`/${rel}`)) residual.push(other);
}
```

log.md 항목은 `- **Deprecation**: [/${rel}](/${rel}) — status: ${want}`. 날짜는 반드시 `toLocaleDateString('en-CA')`(UTC를 섞으면 UTC+ 새벽에 헤딩이 하루 어긋나 E3b가 난다). 같은 날짜 섹션이 있으면 bullet만 추가(중복 헤딩 금지). **`process.exit()`를 쓰지 말고 `process.exitCode`만 세워라**(락이 남는다). **`.okf/logs/`에 쓰지 않는다** — 출력은 stdout/stderr 전용이다.

부수: `lib/lint.mjs:27 walkMdFiles`에 `export`를 붙인다(시그니처·동작 변경 없음).

6. **청크당 은퇴 상한 3건을 드라이버가 시행.** `bin/batch.mjs:22`에 `const MAX_DEPRECATIONS_PER_CHUNK = 3;`(주석: "ingest.md 규칙과 같은 값 — 한쪽만 고치면 계약이 갈린다"). `applyAnalyzerWorkspace` 시그니처에 `chunkBudget = { deprecations: 0 }`을 더하고, **`:781-784`의 차단 게이트 바로 뒤 / `:786-788`의 쓰기 앞**에:

```js
      // 은퇴 상한. prev가 없는 신규 파일은 세지 않는다 — 기존 지식을 지우는 행위가 아니다.
      // 차단은 기존 blocked 관용구와 동일하게 '파일 전체를 반영하지 않는다'이다: 바이트 수술로
      // status 줄만 되돌리면 워크스페이스(abs)와 번들(destAbs)의 바이트가 갈려, 2차 호출에서
      // 무관한 파일까지 전부 재기록된다.
      if (prev && conceptStatus(parseFrontmatter(prev.toString('utf8')).data) !== 'deprecated'
              && conceptStatus(parseFrontmatter(next.toString('utf8')).data) === 'deprecated') {
        chunkBudget.deprecations += 1;
        if (chunkBudget.deprecations > MAX_DEPRECATIONS_PER_CHUNK) { blockedDeprecations++; continue; }
      }
```

`processChunkBody`에서 예산 객체를 **한 번만** 만들어 `:821`과 `:847` 두 호출에 넘긴다(안 그러면 ingest 3 + repair 3 = 6건으로 샌다). 이 블록은 반드시 `:779`의 `Buffer.compare` **뒤**여야 한다(변경 없는 파일까지 파싱하면 매 회차 전 번들을 파싱한다).

7. **`commands/okf-deprecate.md`** — 판단(검색어→경로)과 사용자 확인만 LLM이 한다. `## 대상 결정`(후보 0개면 멈춰라, 2개 이상이면 물어라, 1개여도 확인받아라, **한 번에 한 파일만**), `## 실행`(절대 Edit로 직접 고치지 마라 — 락·lint·index 재생성·커밋이 스크립트 안에 묶여 있다), `## 보고`(종료 코드별 표, **잔존 참조가 0건이면 그 줄을 생략하라**). 다른 커맨드 언급에는 반드시 `okf:` 네임스페이스(`test/smoke.mjs:1173`).

8. **`test/fixtures/fake-claude.mjs`** — 이 스텁의 cwd가 곧 워크스페이스 루트이므로 **상대 경로**를 쓴다(`import path`를 추가하지 마라 — `:5`는 `import fs`뿐이라 `path.join`은 ReferenceError다). `writeConcept()`에 인라인된 log 작성 코드를 `appendLogLine(line)`으로 추출하고 `writeConcept()`도 그것을 호출하게 바꾼다(`appendLog()`는 **존재하지 않는다**). 케이스: `deprecate-one`(단일 은퇴 — **대응 테스트를 반드시 추가하라. 이 파일은 케이스 하나가 실측 사고 하나에 1:1 대응하는 것이 관례다**), `deprecate-spree`(4건 → 상한 시행).

9. **문서**: `skills/okf-usage/SKILL.md`·`skills/okf-index/SKILL.md` 본문에 한 줄씩(**frontmatter `description`은 건드리지 마라** — 매 세션 컨텍스트에 상주한다), README 8종에 커맨드 1줄, `docs/USAGE.md`에 `## 은퇴시키기` 절. 그 절에 **statusline 제외를 명시**: "상태줄의 concept 수는 은퇴 문서를 포함한 파일 개수이고 index.md의 개수는 현역만 센다. 두 값이 다르면 그 차이가 은퇴 건수다."(코드 변경 0 — `bin/statusline.mjs`는 건드리지 않는다.)

10. **기존 묘비 2건은 문서화만.** 파일명을 하드코딩한 마이그레이션을 만들지 마라(다른 사용자 번들에 없는 파일을 찾는 코드를 영구히 지고 간다). `docs/USAGE.md`와 릴리스 노트에 사용자가 실행할 두 줄만 적는다.

**검증 방법** (신규 `ok()` 20개)

**픽스처 주의**: `bootstrapped()`는 TAXONOMY_DIRS 6개를 만들고 `references/`에 시드 3개를 심는다. **카운트를 리터럴로 단언하지 마라** — 소비 블록은 시드 없는 샌드박스(`sandbox('deprecate-index')` + 필요한 디렉토리만)를 쓰거나, `bootstrapped`가 필요한 블록에서는 `refLines`에서 현역 수를 **계산해** 비교하라.

소비 5: `deprecated concept stays in its category index.md (링크 보존)` / `deprecated concept is marked and sorted after the live ones` / `deprecated concept is not injected into the session gate` / `gate and root counts exclude deprecated concepts`(계산된 `activeCount`와 비교) / **`a nested deprecated concept is excluded from the parent and root counts`**(`decisions/sales/old.md` — 중첩 경로에서의 카운트 전파. 현행 `test/smoke.mjs:398,400`이 고정하는 불변식의 은퇴 버전).

게이트 축출 1: `the live concept it used to crowd out is injected instead` — **개수가 아니라 존재/부재로 고정한다**(예산 경계에서 결정적이지 않다):
```js
ok('the live concept it used to crowd out is injected instead',
  before.includes('묘비 제목') && !after.includes('묘비 제목') && after.includes('현역 제목'),
  `${Buffer.byteLength(before)} -> ${Buffer.byteLength(after)}`);
```

§11 관용 2: `an unknown status value is treated as active, not rejected` / `status 7형태가 정규화된다`(`deprecated`/`Deprecated`/`  DEPRECATED  ` → deprecated, `retired`/`archived`/부재/숫자 `3` → stable).

`setFrontmatterStatus` 3: `CRLF 파일에서 개행이 섞이지 않는다` / `type: 줄이 없는 frontmatter에서 삽입 위치가 결정적이다` / `같은 값으로 두 번 호출하면 바이트가 동일하다`(멱등).

명령 7: `okf-deprecate sets status in place and leaves the file where it is` / `... commits its own change and leaves the tree clean`(커밋 증가 정확히 1) / `... is idempotent`(2회차 커밋 증가 0) / `... backs off while a live batch lock is held`(exit 2, 바이트 변화 0, **락 파일 잔존** — 남의 락을 지우지 않는다) / `... refuses an okf_seed file`(exit 4) / `--restore returns the concept to the gate` / **`okf-deprecate rolls back a crash remnant instead of committing it`**(죽은 PID 락 + 미커밋 `decisions/half.md` → 실행 후 `half.md` **부재**, 커밋 증가 **정확히 1**(은퇴 커밋만)).

보고/프라이버시 2: **`okf-deprecate reports zero residual references right after a deprecation`**(현재 설계대로면 2건이 찍힌다 — index.md/log.md 제외의 회귀 가드) / `--restore leaves _remove_candidate, raw and .okf/logs untouched`(이 스크립트는 stdout/stderr 전용이라는 프라이버시 계약).

배치 2: `batch caps deprecations at 3 per chunk`(정확히 3건 반영 + 로그에 `은퇴 상한`, `lastResult === 'ok'`) / `a stale-lock batch does not resurrect a committed deprecation`.

**모든 실행에 `env: { ...process.env, OKF_HOME: home, HOME: isolatedHome(), USERPROFILE: <동일>, CLAUDE_CONFIG_DIR: path.join(home, '.claude') }`를 붙여라.** `OKF_HOME`을 안 넘기면 개발 머신의 진짜 번들을 은퇴시킨다 — 이 WP에서 가장 위험한 실수다.

**통과 규칙**

- 기준선 451 → **471 passed, 0 failed**, exit 0, 3-OS. 유료 LLM 호출 **0회**.
- 라이브 references 구성을 축소 복제한 픽스처에서 묘비 2건 태깅 후: 게이트 주입 텍스트의 **묘비 title 0회**, 태깅 전에는 없던 현역 title **1개 이상 등장**, `Buffer.byteLength(ctx) <= 9000`.
- 은퇴 concept의 index.md 줄 소실 **0건** — 태깅 전후로 카테고리 index.md의 `](/...)` 링크 집합이 **100% 동일**(순서와 접두만 변한다). 게이트 head/tail 바이트 증가 **0**.
- `bin/deprecate.mjs` 성공 실행 후 `git status --porcelain` **0바이트**, 커밋 증가 **정확히 1**, `runLint().errors.length === 0`. 2회차 커밋 증가 **0**, 파일 바이트 변화 **0**.
- 살아있는 락에서 종료 코드 **2**, 대상 파일 바이트 변화 **0**, 커밋 증가 **0**, 락 파일 **잔존**.
- **죽은 PID 락 + dirty 트리에서 커밋이 아니라 `rollback`**: 크래시 잔여물 파일 **부재**, 커밋 증가 **정확히 1**.
- 은퇴 1회 실행 직후 stdout에 **`잔존 참조 0건`**.
- 한 청크에서 4건 은퇴 시도 → 반영 **정확히 3건**, 거부 **1건**, 로그 `은퇴 상한` **1줄**. ingest+repair 2회 호출에도 청크 합계 **3건 초과 없음**.
- stale-lock 배치 1회 후 `status: deprecated` 유지율 **100%**.
- `grep -c 'okf-deprecate' README*.md`의 합이 **8**, `commands/okf-deprecate.md`에 맨 `/okf-status` **0건**.
- `grep -rn "CONCEPT_STATUSES\|conceptStatus" lib/` 히트가 `lib/trust.mjs`와 import 구문에만.

**선행·롤백**: 선행 **R3**(`acquireLock`/`releaseLock`, `recoveredFromStaleLock`), **S5**(SCHEMA 규칙 4의 status 규정 + ingest 생산 규칙), **S3a**(`lib/trust.mjs`). `git revert` 즉시 다음 SessionStart의 `regenerateIndex`가 접두를 지우고 모든 concept가 다시 게이트 대상이 된다(파일은 하나도 이동·삭제되지 않았으므로 복구할 데이터가 없다). 사용자 번들에 남는 `status: deprecated`는 구버전에서 **미지 키로 무해**하다. 개별 은퇴는 `--restore` 또는 해당 커밋 1개 revert(파일 1개 + index.md + log.md로 국한돼 단위가 깨끗하다). 게이트 동작만 되돌리려면 `readCategoryLines` 필터에서 `&& !l.startsWith(DEPRECATED_PREFIX)`만 빼면 된다.

---

#### S6 — viz 신뢰 신호 + 선재 버그 2건 (릴리스 3에 편승)

**목표**: `lib/viz.mjs`가 `lib/index-gen.mjs`와 동형으로 하위 디렉토리를 재귀하게 만들어 **중첩 concept가 그래프에서 사라지는 선재 버그**(B9/T9.4)를 없애고, 어느 깊이의 예약 파일도 concept 노드로 그리지 않게 한다. 그 위에 v0.2 신뢰 신호를 두 채널로 노출한다 — (1) **`buildGraph` meta 카운터**(비용 대비 효과가 가장 크다: 세 커맨드가 meta JSON만 읽으므로 브라우저를 열지 않아도 터미널에 뜬다), (2) 캔버스 최소 인코딩. **노드 fill 색(`TYPE_COLORS`)과 범례는 바이트 단위로 불변**이다 — 범례가 `n.type`에서 생성되므로 색을 신뢰 신호에 뺏기면 범례가 거짓말이 된다.

**릴리스 배치**: `lib/viz.mjs`는 잎 모듈이다(배치·게이트·lint·index-gen 어느 경로도 부르지 않는다). 따라서 **선행·게이트 없이 독립**이며 기본 배치는 릴리스 3이다. `conceptStatus`(S4)가 착지한 뒤라면 언제든 실을 수 있다.

**근거**: spec-conformance §4(b) P14 전문 + §3-B B9(`lib/viz.mjs:34-44` vs `lib/index-gen.mjs:79-86`, CONFIRMED, 라이브 번들이 평면이라 잠복). reliability T9.4("실측: `decisions/sales/orders.md`는 하위 index.md엔 실리는데 그래프 노드엔 없다"), T9.3(스모크 미커버 7축에 "viz 중첩 도메인" 포함). B7(YAML 날짜 지뢰 — 본 세션 재확인: 무따옴표 `[object Date]`, 따옴표 `[object String]`, `verified:` bare mapping `[object Object]`). §4(c)의 명시 제외 2건(게이트 배지 / statusline).

**구현 방법**

1. **`lib/trust.mjs`에 `normalizeVerified`/`isStale` 추가**(S6이 첫 소비자다 — 이때가 §1.1.6이 규정한 추가 시점이다).

```js
// SPEC §5.2 MUST: 소비자는 dash 없는 bare mapping을 1원소 리스트로 취급해야 한다.
// 본 저장소의 js-yaml은 그것을 배열이 아니라 plain Object로 준다(실행 확인).
export function normalizeVerified(fm) {
  if (!isPlainObject(fm)) return [];
  const v = fm.verified;
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter(isPlainObject);
  if (isPlainObject(v)) return [v];
  return [];
}
// §5.5: today >= stale_after면 stale. stale_after가 없으면 절대 stale이 아니다
// (generated.at이 오래됐다고 stale이라 부르는 것은 §11 SHOULD 위반).
export function isStale(fm, today = new Date().toLocaleDateString('en-CA')) { /* toIsoDate 경유 */ }
```

`grep -n '^export function' lib/trust.mjs`로 먼저 확인하고 **없는 함수만 추가하라.**

2. **`collectOkfNodes` 재귀화 + 예약 파일 제외.** `lib/viz.mjs:25-73` 교체. `:23` 아래에 `const RESERVED_MD = new Set(['index.md', 'log.md']);`와 `walkConceptFiles(okfHome, relParts, out)`를 넣는다.

```js
// lib/index-gen.mjs:87-121 regenerateDir과 **동형**으로 재귀한다. 여기가 재귀하지 않아서
// decisions/sales/orders.md 같은 중첩 concept가 하위 index.md와 게이트에는 실리는데
// 그래프에만 없었고, okfFiltered 카운터에도 안 잡혀 사용자가 알 방법이 없었다(B9/T9.4).
// Dirent의 isDirectory()/isFile()은 심링크에 둘 다 false다 -> 심링크 루프가 생기지 않는다.
```

`SCAN_EXCLUDE_DIRS` 검사를 **모든 깊이에서** 하고, `type` 폴백은 `relParts[0]`(최상위 카테고리)로 유지한다 — `relParts.at(-2)`(직속 부모)로 바꾸면 `decisions/sales/orders.md`의 type이 `sales`가 되어 **범례에 없던 타입이 새로 생긴다**. 노드에 `status: conceptStatus(fm)`, `stale: isStale(fm, today)`, `verifiedCount: normalizeVerified(fm).length`를 싣는다. `today`는 `toLocaleDateString('en-CA')`(사용자에게 '오늘'은 로컬 날짜다).

3. **`buildGraph` meta 카운터 4종.** `:194`(`okfFiltered`)와 `:195`(`relevantOnly`) 사이에 `deprecatedCount`/`staleCount`/`unverifiedCount`/`okfVersion`. **분모는 `okfNodes`(실제로 그린 concept)이지 `okf.nodes`(필터 전)가 아니다** — `/okf:okf-analysis`(relevantOnly=true)에서 화면에 없는 concept를 세면 사용자가 그래프에서 찾을 수 없다.

`readOkfVersion(okfHome)` 헬퍼를 `escapeHtml`(`:204`) 위에 추가한다. **`lib/viz.mjs:3`의 `okfPaths` import는 이 릴리스 전까지 미사용이었다 — 여기서 처음 쓰인다. 지우지 마라**(주석으로 남길 것).

4. **캔버스: deprecated는 alpha 곱하기, stale은 점선 + 즉시 복원.** 노드 그리기 루프는 **`lib/viz.mjs:417-443`**, `colorOf`는 **`:336`**, 범례 생성은 **`:558-576`**이다.

```js
    // 선택 dim과 deprecated dim은 서로 다른 사실이므로 **곱한다**. 덮어쓰면 (a) 다른 노드를
    // 선택했을 때 deprecated가 정상 노드와 같아 보이거나 (b) deprecated를 선택하면 또렷해진다.
    // 이 두 변수명은 테스트 계약이다 — 바꾸려면 test/smoke.mjs도 함께.
    const dimSel = (selected && selected !== n && !neighborsOfSelected.has(n)) ? 0.3 : 1;
    const dimDep = n.status === 'deprecated' ? 0.55 : 1;
    ctx.globalAlpha = dimSel * dimDep;
    ...
    if (n.stale) {
      ctx.setLineDash([3, 2]); ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = 2; ctx.stroke();
      ctx.setLineDash([]); // 즉시 복원 — 안 하면 선택 하이라이트와 다음 노드까지 점선이 된다
    }
    ...
    ctx.globalAlpha = 1;   // 이터레이션마다 반드시 복원
```

`:422 ctx.fillStyle = colorOf(n);`과 `:336 colorOf`는 손대지 않는다. stale 링 색 `#ff6b6b`은 리터럴로 둬라(`TYPE_COLORS`에서 참조하면 다음 사람이 '통일'하려 든다).

5. **상세 패널 배지 3개 + 사이드바 note.** `.badge`/`.badge.warn` CSS, `select(n)`의 `innerHTML` 조립에 배지 div. 값은 화이트리스트와 숫자뿐이지만 관용구대로 `esc()`를 통과시킨다. **`unverifiedCount`를 사이드바 stat 타일로 승격하지 마라** — 우리 번들은 설계상 전부 unverified라 상수를 크게 띄우는 셈이고 §11이 그것을 결함으로 취급하지 말라고 한다.

6. **커맨드 3종 보고 규칙.** `commands/okf-visualize.md`의 `## 보고`는 **`:30-40`**(파일 총 46줄)이다. 추가 규칙: `deprecatedCount > 0`이면 밝히되 "사라졌다"고 말하지 마라 / `staleCount > 0`이면 근거로 쓰기 전에 Read하라고 안내 / **`unverifiedCount === okfCount`면 아무 말도 하지 마라**(설계상 정상이다) / `okfVersion`이 빈 문자열이어도 정상(§8/§12에서 선언 자체가 MAY). `commands/okf-analysis.md`는 relevantOnly 문맥으로. `commands/okf-status.md`는 `buildGraph`로 meta만 얻는 스니펫(**`generateViz`를 부르면 HTML 파일을 쓴다 — 상태 조회가 부작용을 갖게 된다**).

**검증 방법** (신규 `ok()` 19개)

구조 4: `viz: nested-domain concepts appear in the graph` / **`viz: a nested concept's type falls back to the top-level category, not its parent directory`**(별도 `ok()`로 분리해 회귀 지점을 명확히) / `viz: a reserved log.md or index.md is never drawn as a concept node` / **`viz: walkConceptFiles does not descend into a symlinked directory`**(POSIX 전용, `if (process.platform !== 'win32')` 가드 — `Dirent.isDirectory()`가 심링크에 false라는 전제를 고정).

status 2: `viz: deprecated concepts are counted in the graph meta` / `viz: status is normalized across seven shapes`(`deprecated`/`Deprecated`/`  DEPRECATED  `/`retired`/`archived`/부재/숫자 `3`).

stale 2: `viz: an unquoted YAML stale_after still marks a concept stale`(무따옴표 과거·따옴표 과거 true, 무따옴표 미래·따옴표 미래 false — 4/4) / `viz: a concept without stale_after is never stale`.

**verified 3 — §5.2 MUST 경로를 실제로 밟는다**(현재 계획의 `unverifiedCount === okfCount`는 생산 금지 때문에 **모든 픽스처에서 항상 참**인 자기충족 단언이다):
```js
fs.writeFileSync(path.join(tr,'decisions','v-bare.md'),
  '---\ntype: decision\ntitle: bare\ndescription: d\nverified:\n  by: "human:ducksu"\n  at: "2026-07-20"\n---\n본문\n');
fs.writeFileSync(path.join(tr,'decisions','v-list.md'),  /* 2원소 리스트 */);
fs.writeFileSync(path.join(tr,'decisions','v-empty.md'), /* verified: [] */);
const vById = new Map(buildGraph(tr, null).nodes.map((n) => [n.id, n]));
ok('viz: a bare verified mapping counts as one verification (SPEC §5.2 MUST)',
  vById.get('/decisions/v-bare.md').verifiedCount === 1 && vById.get('/decisions/v-list.md').verifiedCount === 2);
ok('viz: an empty verified list is not a verification', vById.get('/decisions/v-empty.md').verifiedCount === 0);
ok('viz: unverifiedCount excludes the verified fixtures', tg.meta.unverifiedCount === tg.meta.okfCount - 2);
```

meta 3: `viz: meta reports the bundle okf_version declaration`(`"0.3"`을 심고 그대로 — **리터럴 `'0.1'`/`'0.2'`로 단언하지 마라**) / **`viz: trust counters use the drawn concepts as denominator, not the whole bundle`**(relevantOnly=true에서 제외된 concept에만 deprecated → `deprecatedCount === 0`) / **`viz: a missing bundle yields zeroed trust counters instead of throwing`**(존재하지 않는 okfHome / 빈 카테고리 / index.md 없는 번들에서 `0/0/0/''`).

캔버스 3 — **소스 리터럴 대신 행동에 가까운 형태로, 프록시임을 주석에 남긴다**:
```js
// 스모크에는 DOM/canvas가 없다. 여기서 지킬 수 있는 것은 '상태 복원 코드가 존재하는가'까지이고,
// 점선 누수의 실제 증상은 사람이 브라우저에서 확인한다.
const nodeLoop = trHtml.slice(trHtml.indexOf('for (const n of nodes) {'), trHtml.indexOf('// 레이아웃이 안정되면'));
ok('viz: every dashed stroke in the node loop is followed by a dash reset', dashOn > 0 && dashOff >= dashOn);
ok('viz: the node loop restores globalAlpha before the next iteration',
  (nodeLoop.match(/ctx\.globalAlpha =/g) || []).length === 3 && /ctx\.globalAlpha = 1;\s*\}/.test(nodeLoop));
ok('viz: node fill colour and the legend still come from type alone',
  /function colorOf\(n\)\s*\{\s*return colorFor\(n\.type\);\s*\}/.test(trHtml)
  && trHtml.includes('const types = [...new Set(nodes.map(n => n.type))].sort();'));
```

계약 2: `status 판정자는 lib/trust.mjs 한 곳에만 있다`(`grep` 등가 소스 검사) / `statusline never parses concept frontmatter`(`!statuslineSrc.includes('frontmatter') && !/readFileSync\([^)]*\.md/.test(statuslineSrc)` — **이 테스트가 없으면 다음 사람이 'statusline에 deprecated 수를 띄우자'로 조용히 되돌린다**).

**통과 규칙**

- 적용 직전 기준선 N → **정확히 N+19 passed, 0 failed**, exit 0. **기존 viz 블록 12개 단언(`test/smoke.mjs:1560-1646`)이 하나도 수정되지 않은 채 통과**해야 한다.
- 중첩 픽스처: `okf` 노드 수가 변경 전 **+1**(중첩 concept 1개만 늘고 예약 파일 2개는 0), id가 `/log.md`·`/index.md`로 끝나는 노드 **0개**. 중첩 concept의 `type === 'decision'`(부모 디렉토리명 오염 0).
- `stale_after` **4/4**, `status` **7/7**, `verified` 4형태(bare/리스트/빈 리스트/null) **4/4** — 오탐·미탐 0.
- 불변 표면: `git diff lib/viz.mjs`에서 `TYPE_COLORS`(`:15-22`), `DEFAULT_COLOR`(`:23`), `colorFor`, `colorOf`(`:336`), 범례 블록(`:558-576`) 5개 영역의 변경 줄 수 **0줄**. `git diff --stat bin/statusline.mjs` **빈 문자열**.
- 캔버스: 노드 루프의 `ctx.globalAlpha =` 대입이 이터레이션당 **정확히 3회**이고 마지막이 `= 1`, `setLineDash([3, 2])` 수 ≤ `setLineDash([])` 수.
- meta: 신규 필드 4개가 각각 number/number/number/string이고, **존재하지 않는 okfHome / 빈 카테고리 / index.md 없는 번들 3가지에서 예외 0건**이며 `0/0/0/''`. 어떤 픽스처에서도 세 카운터 ≤ `okfCount`.
- `relevantOnly=true`에서 필터로 제외된 concept를 세지 않는다(`deprecatedCount === 0`).
- **성능 규칙은 두지 않는다**(3-OS 매트릭스에서 flaky하다). 대신 `walkConceptFiles`가 `SCAN_EXCLUDE_DIRS`를 **모든 깊이에서** 거르는지 단언한다.

**선행·롤백**: 선행 **S4**(`conceptStatus`) — 그 외 없음. `.claude-plugin/plugin.json`을 건드리지 않으므로 `test/smoke.mjs:1174`와 충돌하지 않는다. 단일 커밋 `git revert`. 되돌림이 안전한 이유 셋: (1) `lib/viz.mjs`는 잎 모듈이라 배치·게이트·lint 어느 경로도 부르지 않고 번들에 쓰지 않는다(`generateViz`만 `.okf/*.html`을 쓰고 그건 gitignore 안이다), (2) meta 필드는 additive이고 커맨드 소비 규칙이 전부 `> 0` 조건부라 viz만 되돌려도 `undefined > 0 === false`로 조용히 침묵한다, (3) 부분 롤백 축이 분리돼 있다 — 렌더가 문제면 4단계만, 재귀가 문제면 2단계만.

---

### 1.x 릴리스 게이트

#### 1.x.1 릴리스 1 → 릴리스 2

| # | 조건 | 값 |
|---|---|---|
| G1-1 | 스모크 | **0 failed**, exit 0, ubuntu/macos/windows × Node 20 **3매트릭스 전부**. 통과 수는 머지 직전 기준선 + 각 WP 신규 `ok()` 합계와 **정확히** 일치(예고: 303 → **407**). PR 본문에 실행 출력 원문 첨부 |
| G1-2 | 설정 키 동기화 | `Object.keys(DEFAULT_CONFIG).length === Object.keys(VALIDATORS).length === 17`, config-invalid 픽스처에 실패값 17개, `warnings.length >= 17` |
| G1-3 | 게이트 절단 | live-shape 픽스처에서 `inject_max_bytes` **2,684~9,000B 전 구간(1B 간격)** `truncateUtf8Bytes` 절단 **0B**, `capLines` 절단 **0줄**. 주입 concept 수 **≥ 12 유지** |
| G1-4 | 캡처 경계 | 설치 이전 mtime transcript 20개 → `raw` 복사 **0**, fake-claude argv 덤프 **미생성**(유료 호출 0). `sweep_backfill_days=7`에서 **20/20**. **루트 커밋 3일 전 번들에서 4일 전 세션 수집 1/1**(7일 창 불변) |
| G1-5 | glob 정확도 | 루트 true / 하위 true / 형제 접두 `secretive` false / 기존 4패턴 회귀 **0** |
| G1-6 | 락 경합 | 동시 배치 2개 → archive **정확히 1**, 유료 호출 **≤ 2**, 종료 후 `git status --porcelain` **0바이트**, 락 **잔존 0** |
| G1-7 | 비용 기록률 | success / blocked(롤백) / maxturns(INCOMPLETE) **3경로 전부** `costUsd === 0.001 && llmCalls === 1`. 상한 0.0005 픽스처에서 2회차 claude 실행 **0회**, `raw` 손실 **0** |
| G1-8 | digest 유출 차단 | 3줄 중 1줄 파손에서 정상 턴 **2/2** 보존, 자격증명 **0회**, `skippedLines === 1`. 전 줄 파손 → digest **0바이트**(원문 폴백 0) |
| G1-9 | 기존 사용자 잡음 | 라이브 번들에 대해 변경 전/후 `node lib/lint.mjs` stdout **diff 0바이트**(**번들 복사 금지** — `git worktree`로 코드만 두 벌, `mktemp -d` 사용). 실행 전후 `git -C <번들> status --porcelain` **0바이트** |
| G1-10 | 프라이버시 | 신규 로그 줄 전량에 세션 UUID·전체 경로·cwd·remote **0건**. 기존 redaction 단언 3종 전부 통과 |
| G1-11 | lint 등급 | 신규 규칙 W5/W6/W7 전부 W. E 승격 **0건**. `buildRepairPrompt` 덤프에 `W6` **0회** |

#### 1.x.2 릴리스 2 → 릴리스 3

| # | 조건 | 값 |
|---|---|---|
| G2-1 | **§13.1 원자성** | S1·S2·S5가 같은 릴리스 브랜치에 있고, `okf_version: "0.2"`인 번들에서 `generated`를 가진 concept가 배치 1회 후 **≥ 1**. **하나라도 빠지면 릴리스 중단** |
| G2-2 | 스탬핑 정확도 | `success` 1회 후 `generated:` 보유 파일 **정확히 1**, `log.md`/`SCHEMA.md`/모든 `index.md`/모든 `okf_seed` 시드에서 **0회**. 파일당 블록 **1회**. `typeof data.generated.at === 'string'` **100%**(Date 0건) |
| G2-3 | 위조 차단 | 분석기가 신규 파일에 `by: human:...`을 써도 코드 스탬프가 **덮는다**(`trustExisting`은 `prev !== null` 기준). `human:` 잔존 **0건** |
| G2-4 | 승격/보존 | `"0.1"`→`"0.2"` **1/1**. `"0.2"`/`"0.3"`/`"1.0"`/무따옴표 `0.3` 4종에 `regenerateIndex` 3회 → 값 변경 **0/4**. 미지 키 **3/3** 잔존, 2·3회차 산출 바이트 차 **0** |
| G2-5 | schema 전파 | `schema_version: 1` 번들에 SessionStart 1회 → `schema_version: 2`, `{{` **0회**, `okf: bootstrap` 커밋 **1건**. 범프는 저장소 전체에서 **1회** |
| G2-6 | 락 가드 | 살아있는 락에서 `ensureBootstrap` 5회 → SCHEMA 바이트 변화 0, index 바이트 변화 0, `git status --porcelain` 0바이트, 커밋 증가 0. **빈 홈 + 살아있는 락에서도 dirty 0** |
| G2-7 | 버전 문자열 | `grep -rn "v0\.1" bin lib prompts templates commands skills test .claude-plugin` → **정확히 4줄, 전부 시드**. `grep -rn "okf-system v0\.2"` → **0**. `grep -rn "stale_after" prompts templates skills commands` → **0** |
| G2-8 | 게이트 무손실 | 릴리스 1 대비 주입 concept 수 **감소 0**, 절단 **0B** 유지(head −11B는 이득) |
| G2-9 | 은퇴 | `/okf:okf-deprecate` 후 커밋 증가 **정확히 1**, `git status --porcelain` **0바이트**, `runLint().errors.length === 0`, 2회차 커밋 증가 **0**. 살아있는 락에서 exit **2** + 바이트 변화 **0**. **죽은 PID 락 + dirty에서 rollback**(잔여물 부재, 커밋 증가 1). stale-lock 배치 1회 후 유지율 **100%**. 청크당 상한 초과 시 반영 **정확히 3건**. 잔존 참조 보고 **0건** |
| G2-10 | 다운그레이드 | 승격된 번들을 0.2.0 코드로 → lint EXIT **0**, index-gen 보존, 게이트 정상, viz 무예외 |
| G2-11 | 릴리스 노트 | §1.1.2의 4문장 + 승격 커밋 메시지 안내가 GitHub Release 본문에 **포함** |

#### 1.x.3 Part 1 전체 통과 규칙

이 파트가 "끝났다"고 말할 수 있는 조건. 전부 기계 판정.

1. **태그 2개 발행** — `v0.2.0`, `v0.2.1`. 각 릴리스 본문에 편도 흔적 고지 포함.
2. **스모크** — 최종 `node test/smoke.mjs` **0 failed**, exit 0, 3-OS × Node 20. 각 릴리스 PR 본문에 실행 출력 원문 첨부(조사가 테스트 수를 확인 못 한 이유가 그것이 어디에도 기록돼 있지 않아서다).
3. **lint 규칙 코드** — W5~W8 네 개가 §1.1.4 레지스트리와 1:1이고 의미 중복 **0건**. 전부 W, E 승격 **0건**. `buildRepairPrompt` 덤프에 `W6` **0회**.
4. **§13.1 불변식** — `okf_version: "0.2"`를 선언하는 어떤 상태에서도 배치가 만지는 concept에 `generated`가 붙는다. 릴리스 2 이후 `grep -c 'okf_version: "0.2"'`와 스탬핑 코드가 같은 커밋 조상에 있다.
5. **기존 사용자 무회귀** — 라이브 번들에 대해 착수 전/후 `node lib/lint.mjs`의 **errors 개수 변화 0**. 배치 정지·청크 롤백·추가 유료 repair 호출 **0회**.
6. **게이트** — 라이브 형상에서 주입 concept 수가 착수 전 **12** → 완료 후 **≥ 13**(S4의 묘비 2건 은퇴 반영 시), `truncateUtf8Bytes` 절단 **0B**, `capLines` 절단 **0줄**, 최종 바이트 **≤ 9,000**.
7. **비용·유료 호출** — Part 1 전체가 추가하는 유료 LLM 호출 **0회**. 회차당 상한 **4회** 불변(`grep -c 'runClaude(' bin/batch.mjs` = 3). `OKF_RUN_LIVE_BENCH=1` 실행 **0회**.
8. **프라이버시** — 배치 로그·상태 파일 전량에 세션 UUID·전체 경로·cwd·git remote·전사 원문 **0건**. digest 경로에서 원본 JSONL 바이트가 LLM 입력으로 나가는 경로 **0개**. 라이브 번들을 `/tmp`로 복사한 절차 **0회**.
9. **표기** — `grep -rn "okf-system v0\.2"` **0**, `grep -rn "v0\.1" bin lib prompts templates commands skills test .claude-plugin` **4줄(시드만)**, `grep -rn "stale_after" prompts templates skills commands` **0**.
10. **폐기 목록 준수** — `stale_after` 자동 부여 **0**, 배치의 `verified` 자기 서명 **0**, `sources` 강제 **0**, 기존 concept 프론트매터 일괄 변환 **0**, Attested Computation 생산 **0**, 게이트 주입 줄 배지 **0**, statusline 프론트매터 파싱 **0**.
11. **단일 소유자 준수** — `templates/SCHEMA.md`·`prompts/ingest.md`(릴리스 2)를 S5 외 WP가 수정한 커밋 **0건**. `status` 판정자가 `lib/trust.mjs` 밖에 존재하는 커밋 **0건**. 개별 WP가 `plugin.json` 또는 `test/smoke.mjs:1174`를 건드린 커밋 **0건**.

#### 1.x.4 순서를 어기면 깨지는 지점 (Part 1 한정)

| # | 잘못된 순서 | 결과 |
|---|---|---|
| 1 | **S5(SCHEMA에서 `timestamp` 제거)를 S3a보다 먼저** | SCHEMA가 자기 자신에게 영구 W2를 받고 그 경고가 repair로 새어 모델이 매 회차 SCHEMA를 고치려 들다 `bin/batch.mjs:783`에서 차단 → `분석기 산출물 반영 거부` 상시화 |
| 2 | **S2(선언)를 S1(생산) 없이** | §13.1 폴백이 MAY라 폴백 미구현 소비자에게 concept 22개가 **시간 신호 없는 문서**가 된다. 순수 후퇴. 반대 방향(S1만)은 안전한 비대칭 |
| 3 | **S3b(W8)를 S5의 규칙 3 문구보다 먼저** | 규정에 없는 요구로 기존 사용자의 중첩 log.md가 경고를 받는다. E로 만들면 **모든 ingest 영구 정지** |
| 4 | **R5 없이 게이트 문자열을 늘림**(S5의 head −11B는 이득이지만 반대 방향 변경) | 선차감 없이 조립이 캡을 넘어 `truncateUtf8Bytes`가 뒤에서 자르고, 잘리는 곳은 **log.md tail 전량** |
| 5 | **R3을 R0보다 먼저** | reliability §5 항목 11의 조건 위반. 잘못 만들면 "중복 spawn은 안전하다"가 "**아무 배치도 못 돈다**"가 되고 그것을 잡을 테스트가 없다 |
| 6 | **R2를 R3보다 먼저** | `updateLastBatch(home, result, spend)`가 R3의 `{blocked:{...}}`를 `spend`로 해석 → `tokens.input_tokens === undefined`, `blocked` 미기록 |
| 7 | **S4를 R3보다 먼저** | `acquireLock`이 `lib/lock.mjs`에 없다. 있더라도 `recoveredFromStaleLock`을 버리면 `/okf:okf-deprecate`가 **크래시 잔여물을 영구 커밋**한다 |
| 8 | **S4를 S5보다 먼저** | SCHEMA 규칙 4에 `status: deprecated` 규정이 없는 상태로 생산이 시작된다. 그리고 두 WP가 같은 파일을 서로 다른 텍스트로 고친다 |
| 9 | **S1의 스탬핑을 `Buffer.compare` 앞에** | 모든 파일이 매 회차 재기록 → `bin/batch.mjs:828-831`의 유실 백스톱 **영구 무력화** |
| 10 | **S1의 스탬핑을 SCHEMA/`okf_seed` 차단 게이트 앞에** | 드라이버가 지키던 경계가 뚫려 시드가 스탬프된다 |
| 11 | **S1이 `destAbs`에만 쓰고 `abs`에 되쓰지 않음** | 2차 apply에서 repair가 건드리지도 않은 파일의 `at`이 전부 갈아엎힌다 |
| 12 | **R1의 설치 하한을 클램프 없이** | 설치 3일 된 기존 사용자의 **4~7일 전 transcript가 영구 배제**된다(`SWEEP_LOOKBACK_DAYS`는 하드 창이라 다음 회차에도 안 돌아온다) |
| 13 | **R4의 W6을 `buildRepairPrompt` 필터 없이** | repair가 "쪼개라"는 지시를 받는데 새 파일을 만들 수 없다 → 헛돌거나 **파일을 임의로 잘라낸다**. `applyAnalyzerWorkspace`에 신규 파일 차단이 없어 실제로 반영된다 |
| 14 | **설정 키를 추가하면서 `test/smoke.mjs:194-212` 픽스처를 안 고침** | `warnings.length >= Object.keys(DEFAULT_CONFIG).length`가 현재 **15==15 등호 경계**라 즉시 빨개진다 |
| 15 | **여러 WP가 각자 `plugin.json` + `smoke:1174`를 올림** | 버전이 두세 칸 뛰거나 한쪽만 고쳐 스모크 즉시 실패. → 릴리스 통합 커밋 1개만 |
| 16 | **S4/S6/S3a가 각자 `status` 판정자를 만듦** | `lib/index-gen.mjs`와 `lib/viz.mjs`가 다른 판정기를 써서 `status: Deprecated `(끝 공백)·미지 값에서 **index.md와 그래프가 다른 답**을 낸다 |

---

## Part 2 — 보완·개선

Part 1이 "스펙을 지키는가"였다면 Part 2는 **"이 번들이 실제로 값을 하는가"**다. 판정 기준은 사용자가 정의한 OKF의 의의다 — 코드와 문서에 **내포되어 있지 않은** 의사결정·히스토리·도메인 지식·정책·엣지케이스·실수와 해결. 이 정의는 취향이 아니라 측정된 사실이다: v3 벤치마크에서 OKF는 grep 한 번으로 답이 나오는 질문에서 zero-base 대비 **1.2~1.7배 비싼 순수 오버헤드**였고, "코드에 존재하지 않는 팀 정책"에서만 압도했다(11/15 vs 0/15, Fisher p=5e-5. 오염 보정 하한 9/15에서도 p=0.0007). 정의에 부합하지 않는 지식이 번들에 쌓이는 것 자체가 세 목표를 전부 해친다.

---

### 2.0 문제 정의 — 세 목표가 지금 왜 달성되지 않는가

숫자는 전부 커밋된 선행 조사(`docs/okf-v0.2-2026-07-25-reliability.md`, `-spec-conformance.md`)와 이 워크트리에서의 읽기 전용 재현 실행에서 나왔다. 라이브 번들 관측은 2026-07-25 1회 기준이며, **통과 규칙에는 쓰지 않는다**(재현 불가). 통과 규칙은 전부 커밋되는 픽스처 위에서 판정한다.

#### 목표 1 — 토큰 효율성: 게이트 예산의 25%가 고정비고, 넘친 만큼은 조용히 잘린다

| 관측 | 값 | 출처 |
|---|---|---|
| 주입되는 concept | **22개 중 12개** | T7.1 / 재현 확인 |
| 조립 바이트 → 최종 | 9,218B → 9,000B, **218B 절단** | T7.3 / 재현 확인 |
| 절단되는 위치 | 문서 끝 = **log.md tail 전량** | `bin/session-start.mjs:101` |
| 고정비(head+tail+heading) | **2,264B = 예산의 25.2%** | head 686B / tail 1,358B / heading 220B |
| tail 바이트 편차 | 1,358B ~ **5,288B (3.9배)** — `capLines(15)`는 줄만 막는다 | log.md 세 섹션 실측 |
| 최악 시나리오 주입량 | 5,288B 짜리 섹션이 최신인 날 **22개 중 3개** | 재현 확인 |
| 줄 캡 사용률 | 120줄 중 **42%** — 줄 캡은 사실상 비활성 파라미터 | T7.1 |
| 잔여 예산 | **58B** — 게이트 head에 한 줄만 더해도 concept가 축출된다 | 재현 확인 |

즉 바이트 캡은 100% 포화인데 줄 캡은 절반도 못 쓴다. 예산 회계가 틀려서(생략 마커를 선차감하지 않는다) 안전망 `truncateUtf8Bytes`가 매 세션 발동하고, 그 손실은 전부 "지난 세션 이후 번들이 이만큼 움직였다"는 신호다.

#### 목표 2 — 정확도: 번들에 쌓이는 것의 상당수가 OKF의 정의에 부합하지 않는다

| 관측 | 값 |
|---|---|
| raw 443개 중 실사용 세션 | **21~27개(5~6%)** — 나머지는 자기 벤치·테스트 잔여물 |
| 최대 concept | `troubleshooting/okf-sweep-self-consumption-loop.md` **20,381B** = 전체 concept 텍스트 91,029B의 **22.4%** |
| 그중 반복 관측 | **76.1%(15,502B)** — 정규화하면 동일한 `## 추가 관측` 섹션 11개 |
| 기존 분할 규칙 발동 | **0회** — SCHEMA의 "300줄 초과 시 분할"인데 그 파일은 199줄이다(한국어 102B/줄 → 300줄 = 30,600B 허용). **단위가 틀렸다** |
| references 게이트 슬롯 | 2/2를 지식가치 0으로 확정된 벤치 묘비가 점유 |
| `prompts/ingest.md`에 있는 "쓰지 않을 것" 규칙 | **0줄** (`:32-43`은 "무엇을 쓸 것인가"만 있다) |

번들에 자기 실행 관측이 최대 concept로 앉아 있고, 그것이 카테고리 최대 index 줄(973B)로 매 세션 예산을 먹는다. 배제 규칙이 없어서다.

#### 목표 3 — 탐색 속도: 같은 판단 지점에 상반된 두 규범이 주입된다

- `bin/session-start.mjs:83` 게이트: "제목·설명이 답을 담고 있으면 **Read 없이** 그 줄을 근거로 쓰라."
- `skills/okf-usage/SKILL.md:15-17`: "해당 파일을 **Read하라** … 요약만 보고 넘겨짚지 마라."

게이트가 Read를 낮춘 근거는 실측이다 — 게이트를 켠 조건이 토큰 13,787을 더 썼는데 그중 **91%(12,508)가 강제 Read 왕복**이었고 그 Read가 가져온 새 사실은 **0개**, 답 8/8이 이미 index 줄에 있었다. 그런데 스킬은 정반대를 지시하고, `SKILL.md:43-44`는 **스펙에서 사라진 프론트매터 필드를 "권장 순서"로 가르친다.** 게다가 **못 찾았을 때 어디서 멈추는지에 대한 규정이 어디에도 없다** — 탐색 상한 0, 종결 절차 0, 정정 전달 경로 0.

#### 그리고: 이 프로젝트는 근거 없는 개선을 두 번 철회했다

v2의 "비용 곡선" 6건이 철회됐고, v4 P1이 n=15에서 반증됐다. `reliability §6`은 게이트 관련성 라우팅을 v0.2에서 **명시적으로 제외**하며 이유를 적었다: "E1이 아직 안 돌았다. 근거 없이 튜닝하면 v2의 반복이다." **Part 2의 첫 작업패키지가 측정 장치(I6)인 이유가 이것이다.**

---

### 2.1 원칙 — 무엇을 기록하고 무엇을 기록하지 않는가

Part 2 전체의 뼈대다. 아래 5개는 프롬프트 문구가 아니라 **설계 제약**이며, 각 작업패키지가 이것을 코드/테스트로 시행한다.

**P1. 기록 대상은 "코드가 답하지 못하는 것"이다.**
한 사실이 대상 저장소에서 Grep/Glob/Read **한 번**으로 확인되면 그것은 번들의 몫이 아니다. 값·경로·시그니처·의존성 버전은 코드가 답한다. 코드에 없는 것은 언제나 **이유, 기각된 대안, 엣지케이스, 정책, 실수와 그 해결**이다.
→ 반례(반드시 기록): "청크 상한이 300KB인 이유는 15분 타임아웃 안에 끝내기 위함" — 값은 코드에 있지만 **이유는 코드에 없다.** 이 반례가 배제 규칙 전체의 안전핀이다.

**P2. 배제는 사실 단위다. digest 단위가 아니다.**
한 digest 안의 사실 하나가 배제 문항에 걸려도 다른 사실은 독립 판정한다. 이 규정이 없으면 모델이 digest 전체를 NO-OP 처리한다 — 과다 배제의 1차 실패 모드이며, 그것이 발생하면 OKF의 유일한 승리 축(팀 정책)이 함께 죽는다.

**P3. 한 번뿐인 실행 관측은 지식이 아니다. 특히 OKF 자신의 실행 관측은 아니다.**
판정 문항 하나: **이 사실을 알기 위해 OKF 파이프라인 자신을 실행해야 했는가?** 예 → 쓰지 않는다. 아니오 → 일반 프로젝트와 동일. **사용자가 okf-system을 개발하며 내린 설계 결정은 정상 기록 대상이다.** 이 구분을 놓치면 저자 본인의 프로젝트 지식이 통째로 사라진다.

**P4. 같은 사실의 N번째 관측은 새 섹션이 아니라 카운터다.**
반복은 파일을 키우고, 파일 크기는 index 줄 길이로 전이되며, index 줄은 매 세션 예산이다. 팽창은 세 목표를 동시에 해치는 유일한 축이다.

**P5. LLM 판단에 맡길 수 없는 것은 코드가 판정한다(전역 Rule 5).**
파일 바이트, 반복 섹션 수, 변경 종류(신규/순수추가/수정), 번들 총량, 게이트 조립 바이트·절단량은 전부 코드가 셀 수 있다. 프롬프트는 규범을 말하고, lint/계측이 그 규범의 위반을 **결정론적으로** 센다. 단 그 lint는 **반드시 W(경고)**여야 한다 — E로 올리는 순간 `handleDirtyWorkingTree`(`bin/batch.mjs:398-417`)가 기존 사용자 번들의 모든 ingest를 영구 정지시킨다.

**P6(금지 목록).** `stale_after` 자동 부여 / 배치의 `verified` 자기 서명 / `sources` 강제 / 기존 concept 프론트매터 일괄 변환 / Attested Computation 생산 / 이미 반증된 벤치마크 축 재실행. Part 2 전체에 **0건**이며, 통과 규칙 §2.y가 이를 grep으로 강제한다.

---

### 2.2 순서·소유권 — 같은 코드를 두 번 고치지 않기 위한 단일 소유자 지정

적대적 검토에서 **순환 의존 7건과 규칙 코드 충돌 5건**이 나왔다. 원인은 전부 "여러 작업패키지가 같은 함수를 각자 다른 자료구조로 재작성"이다. 아래가 확정된 소유권이고, 이걸 어기면 두 번째 패키지부터 런타임에서 죽는다.

| 자원 | 단일 소유자 | 다른 패키지는 |
|---|---|---|
| `lib/gate.mjs`(게이트 조립 4함수 추출) | **I6** (순수 이동, 릴리스 3 최초) | 그 위에서만 편집 |
| `buildInjectedIndex` / `readCategoryLines` / `extractLatestLogSection` | **I3** | I2는 `rankCategories(cats, signals)` 훅으로만 얹는다 |
| 게이트 head 문안 (`GATE_RULES`) | **I5** (I3의 head 압축을 흡수) | I3은 head를 건드리지 않는다 |
| 예산 회계(마커 선차감 + `lines=0;break;`→`continue`) | **R5**(릴리스 1, 이미 착지) | I3/I2는 재구현 금지 |
| lint 임계 상수 + 팽창 판정 순수 함수 | **`lib/bloat.mjs`** (I-M) | `lib/lint.mjs`가 import. **역방향 import 금지**(순환) |
| `updateLastBatch(home, result, extra={})` / `processChunkBody → {ok,fatal}` / `applyAnalyzerWorkspace → {applied, blocked}` | **R3**(릴리스 1) | I-M은 `extra`에 필드만 추가 |
| `prompts/ingest.md` 삽입 앵커 | I5 = 첫 bullet(`:47-48`) 뒤 / I-M = `okf_seed` bullet(`:49-53`) 뒤 | 겹치면 반드시 충돌 |
| `.claude-plugin/plugin.json:3` + `test/smoke.mjs:1174` 리터럴 | **릴리스 통합 커밋 1개** | 개별 WP는 두 줄 중 어느 것도 건드리지 않는다 |

**lint 규칙 코드 레지스트리** — W5·W6은 릴리스 1에서 R4가 선점했다. Part 2는 그 뒤 번호를 쓴다.

| 코드 | 의미 | 소유 | 등급 |
|---|---|---|---|
| W9 | concept 본문 바이트 상한 초과 | I-M | W |
| W10 | 반복 섹션 제목 ≥3 | I-M | W |

`buildRepairPrompt`는 **W6/W9/W10을 필터링해야 한다** — 셋 다 "분할·요약" 지시인데 `prompts/repair.md`는 새 파일 생성을 금지한다. 모델이 지시를 받고 수행할 수 없으면 헛돌거나 **파일을 임의로 잘라낸다**. 그리고 `applyAnalyzerWorkspace`에는 신규 파일 차단이 없어(`prev===null`이면 그대로 write) 그 결과가 실제로 번들에 반영된다. W1/W3는 그대로 싣는다(유일한 자동 교정 경로).

**I1과 I4는 병합됐다.** 두 패키지가 같은 규칙(반복 관측 카운터)을 각자 프롬프트에 넣었고, lint 코드가 **정확히 뒤바뀌어** 있었으며(I1: W5=바이트/W6=반복, I4: W5=반복/W6=바이트), `prompts/ingest.md`의 같은 2줄 경계를 둘 다 잡았다. 아래 `I-M` 하나로 간다. I1의 `test/exclusion-audit.mjs`는 `lib/bloat.mjs`와 중복이므로 **폐기**한다.

**착지 순서**: `I6` → (`I5`, `I3`, `I-M`) → `I2`. I6 이전에는 아무것도 착수하지 않는다.

---

### I6 — 측정 설계: `lib/gate.mjs` 추출 + recall@cap 사전등록 실험($0)

#### 목표
Part 2의 어떤 개선도 "좋아 보인다"로 발행되지 않도록, 측정 장치를 개선보다 먼저 만든다. (1) 게이트 조립을 `lib/gate.mjs`로 순수 추출하고 `stats` 계측을 달아 주입 수·조립/최종 바이트·절단량·starvation을 **유료 호출 0으로** 관측 가능하게 한다. (2) 사람이 사전 지정한 질문 20개와 정답 concept를 동결하고, 번들 크기 N을 24→200으로 키우며 정답 줄이 캡을 통과하는 비율(**recall@cap**)을 결정론적으로 측정한다. (3) 반증 기준 R1~R5와 I2·I3-step4의 승인 조건을 **측정 전에** 못 박는다. 이 패키지는 게이트 선택 정책을 한 줄도 바꾸지 않는다 — 재는 것만 한다.

#### 근거
`reliability §5 항목 15`("E1 사전등록 + 실행, $0")를 실행 가능한 형태로 펼친 것이다. T7.1(게이트는 번들 크기와 무관한 상수 창), T7.2(`bin/session-start.mjs` 177줄에 cwd·최신성·질의어 참조 **0건**, 유일한 순서 결정자는 round-robin + 파일명 사전순), T7.3(마커 미선차감 → 218B 절단), T7.4(`:45`의 `lines = 0; break;`가 157샘플 중 79건 starvation). `§6`이 라우팅 재설계를 v0.2에서 제외한 이유가 이 패키지의 부재였다. 사전등록 관례는 `docs/benchmarks/pre-registration-2026-07-16-v3.md`(v2가 발행한 거짓 6건을 먼저 기록하는 형식)와 `-v4.md`(예측 → 기계 판정 반증기준 → 알려진 한계 → 사후 수정 기록)를 따르고, 기계 판정 규약은 `test/bench-report.mjs:1-16`이 확립했다. 생존 판정 관용구는 `lib/bench-audit.mjs:53-79`에 이미 있다.

#### 구현 방안
- 추출은 **순수 이동**이다. 같은 커밋에서 로직을 개선하지 않는다 — 섞으면 baseline 측정이 불가능해진다(전역 Rule 3).
- `stats`는 **선택 인자로 받아 제자리 변형**한다. 반환형을 바꾸면 호출부와 기존 23개 게이트 단언이 동시에 깨진다.
- 하니스는 라이브와 **같은 예산에서** 재야 한다. `ensureBootstrap`은 log.md를 `# Log\n`으로만 만들어 tail이 **54B**가 되는데 라이브는 **1,358B**다 — 고정하지 않으면 index에 +1,304B를 더 준 상태로 recall을 재고, 그 편향은 하필 "개선하지 않는다"(R1) 쪽으로 기운다.
- 번들 홈 **경로 길이를 고정**한다. head가 `전역 지식 번들: ${okfHome}`으로 경로를 그대로 싣기 때문에, `mkdtempSync`를 번들마다 부르면 같은 `(level, seed)`에서도 head 바이트가 달라져 결정성 테스트가 원리적으로 통과 불가다(실측: 경로 35B 차이 → head 811B vs 846B).
- 유료 0은 **상수 선언이 아니라 실행으로 증명**한다. `meta.paidCalls: 0`은 자기충족이다.

#### 구현 방법
1. **`lib/gate.mjs` 신설 — 순수 이동.** `bin/session-start.mjs:15-21 readCategoryLines`, `:29-61 buildInjectedIndex`, `:63-71 extractLatestLogSection`, `:73-102 buildContext`를 **주석 포함 문자 그대로** 옮긴다(`:10-14`, `:23-28`, `:36`, `:55-57`, `:74-78`, `:92-94`의 실측 근거 주석은 이 서브시스템의 판단 근거다 — 지우지 마라). `import { truncateUtf8Bytes, capLines } from './text.mjs'; import { discoverConceptDirs, DIR_DESCRIPTIONS } from './index-gen.mjs';`를 gate.mjs로 옮긴다. export 시그니처:
   ```js
   export function readCategoryLines(okfHome, dir)
   export function extractLatestLogSection(logContent, maxLines = 15)
   export function buildInjectedIndex(okfHome, budgetLines, budgetBytes, stats = null)
   export function buildContext({ okfHome, latestLog, injectMaxLines, injectMaxBytes }, stats = null)
   ```
   `bin/session-start.mjs`는 `:7-8`의 두 import를 `import { buildContext, extractLatestLogSection } from '../lib/gate.mjs';` 한 줄로 대체하고 `:10-102`를 삭제한다. `:139`·`:141-146`의 호출부는 **손대지 않는다**(stats 없이 호출 → 동작 변화 0). 파일 하단 `:171-177`의 `process.exit` 금지 주석은 훅 쪽에 남긴다.
2. **`stats` 계측.** `buildInjectedIndex` 안에서: 예산 계산 직후 `if (stats) { stats.budgetLines = lines; stats.budgetBytes = bytes; stats.headingBytes = budgetBytes - bytes; }`. `if (lines < 1 || bytes < cost)` 분기 안에 `if (stats) stats.starvationEvents = (stats.starvationEvents ?? 0) + 1;`. 루프 종료 직후 `stats.leftoverBytes/leftoverLines/taken/total/cats`(cats는 `{dir, total, taken, lineBytes[]}`). 마커 생성부에서 `stats.markerBytes` 누적. `buildContext`에서 마지막 줄을 쪼갠다:
   ```js
   const assembled = `${head}${idx}\n${tail}`;
   const final = truncateUtf8Bytes(capLines(assembled, injectMaxLines), injectMaxBytes);
   if (stats) {
     stats.headBytes = Buffer.byteLength(head, 'utf8');
     stats.tailBytes = Buffer.byteLength(tail, 'utf8');
     stats.assembledBytes = Buffer.byteLength(assembled, 'utf8');
     stats.finalBytes = Buffer.byteLength(final, 'utf8');
     stats.truncatedBytes = stats.assembledBytes - stats.finalBytes;
     stats.cappedLines = assembled.split('\n').length - final.split('\n').length;
   }
   return final;
   ```
   `truncatedBytes`와 `cappedLines`를 **분리**하는 이유: 합치면 줄 캡과 바이트 캡의 원인이 섞여 어느 안전망이 발동했는지 알 수 없다. 둘 다 0이어야 "예산 계산이 맞았다"는 뜻이다.
   **`starvationEvents`를 통과 규칙에 쓰지 마라** — R5 착지 전에는 최대 1(첫 미스에서 바깥 루프까지 죽는다), 착지 후에는 수십까지 오른다. 수정 전후로 의미가 다른 값이다.
3. **형상 동결 픽스처.** `test/fixtures/bench/gate-recall/live-shape-2026-07-25.json`. **사용자 지식 텍스트는 한 글자도 넣지 않는다 — 줄 바이트 길이와 더미 log만 넣는다.**
   ```json
   { "capturedAt": "2026-07-25",
     "source": "카테고리별 index.md의 줄 바이트 길이만. 제목·설명 텍스트 미포함(프라이버시).",
     "config": { "inject_max_bytes": 9000, "inject_max_lines": 120 },
     "headBytes": 686, "tailBytes": 1358,
     "logMd": "<사용자 텍스트 없는 더미 bullet. tail이 정확히 1,358B / 18줄이 되도록 패딩>",
     "categories": { "decisions": [423,413], "patterns": [1546,489,660,549,379,466],
       "preferences": [510,206,1207], "projects": [503,321,283],
       "references": [602,554,222,202,219,944], "troubleshooting": [973,126] },
     "expected": { "taken": 12, "total": 22, "assembledBytes": 9218,
       "finalBytes": 9000, "truncatedBytes": 218, "leftoverBytes": 58 } }
   ```
   캘리브레이션 테스트는 `headBytes`/`tailBytes`를 **픽스처 값으로 주입**해 계산한다(`buildInjectedIndex(home, 92, 6956, stats)` = 9000 − 686 − 1358). 실제 head를 쓰면 I5의 head 변경이 이 기준선을 흔들어 형상 재현 검증과 head 문구 변경이 뒤섞인다.
4. **질문 세트 동결 — 라우팅 코드가 존재하기 전에.** `test/fixtures/bench/gate-recall.json`:
   ```json
   { "frozenAt": "2026-07-25", "levels": [24,50,100,200], "seeds": [1,"…",20],
     "compositionRules": { "questions": 20, "minPerCategory": 2, "minCwdIndependent": 6 },
     "questions": [ { "id": "q01", "question_ko": "…",
       "answerConcept": "troubleshooting/slim4-version-constant-mismatch.md",
       "sourceFile": "docs/benchmarks/bundles/slim-L20/troubleshooting/slim4-version-constant-mismatch.md",
       "authored": false, "cwdIndependent": false, "grepable": false,
       "cwd": "<repo>/test/fixtures/bench/gate-recall/cwd/slim" } ] }
   ```
   정답 concept 조달: 커밋된 실번들 우선(`docs/benchmarks/bundles/slim-L20` 8개, `bundles/rfcs-L20` 1개, `bundles-chain-v4/chain-*` 중복 제거 후 ~5개 = 최소 10개). 나머지는 `test/fixtures/bench/gate-recall/concepts/`에 **직접 작성**해 `authored: true`로 표시한다 — **라이브 번들에서 복사 금지**(사용자 지식 발행이다). `cwdIndependent: true` 6개 이상은 어떤 저장소에도 매칭되지 않는 툴체인 함정이어야 한다(§5 항목 15(b)의 요구. 이게 빠지면 I2가 자기 차별점을 차단하는 방향으로 튜닝된다). `distractors.json`에 카테고리별 10개씩 60개를 **같은 커밋에서** 동결한다 — 라우터를 쓴 뒤에 distractor를 추가/삭제하면 그 순간 측정이 튜닝이 된다.
   **레벨 하한이 24인 이유**: 정답 20 + 부트스트랩 시드 4 = 24. N=8·22는 원리적으로 불가능하다(항목 15가 적은 값은 이 제약을 몰랐다). 이 사실을 사전등록서에 명시하라.
5. **하니스 `test/gate-recall.mjs`.** CLI: `node test/gate-recall.mjs [--levels 24,50,100,200] [--seeds 20] [--out …]`.
   - PRNG는 외부 의존 0(`mulberry32` 인라인) — CI에 npm install이 없다.
   - **홈 경로 길이 고정**: 루트 tmp를 **한 번만** 만들고 그 아래에 길이가 항상 같은 홈을 판다.
     ```js
     const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-bench-recall-'));
     const home = path.join(root, `L${String(level).padStart(3,'0')}-S${String(seed).padStart(3,'0')}`);
     ```
     접두는 반드시 `okf-bench-` — `lib/paths.mjs:56`의 `OKF_TEST_FIXTURE`에 `bench`가 이미 있어 무수정으로 sweep 제외에 걸린다(`okf-gate-recall-`은 걸리지 않는다).
   - `buildBundle`: `ensureBootstrap(home)` → 시드 concept 수를 **세어서** `seedCount`로 기록(하드코딩 금지) → 정답 concept 복사 → `level - questions.length - seedCount`개 filler를 라이브 비율로 생성하고 목표 줄 바이트를 `shape.categories`에서 복원추출 → **`fs.writeFileSync(path.join(home,'log.md'), shape.logMd)`** → `regenerateIndex(home)`.
   - `measure`: `buildContext({...}, stats)` 호출 후 **즉시 예산 동형을 검사한다**:
     ```js
     if (stats.headBytes !== shape.headBytes || stats.tailBytes !== shape.tailBytes) {
       throw new Error(`shape drift: head ${stats.headBytes}/${shape.headBytes}, tail ${stats.tailBytes}/${shape.tailBytes}`);
     }
     ```
   - `survivors`: 게이트 텍스트를 줄로 쪼개 `/^- \[[^\]]*\]\((\/[^)\s]+)\)/`로 링크만 뽑아 Set을 만들고 `set.has('/' + q.answerConcept)`. `lib/bench-audit.mjs:70`의 `includes('/'+rel)`보다 엄격하다 — 설명문 안의 링크 언급을 생존으로 오판하지 않는다.
   - **유료 0 증명(PATH 트랩)**: 훅 서브프로세스를 띄울 때 `PATH`를 `${trapDir}${path.delimiter}${process.env.PATH}`로 바꾸고 `trapDir/claude`(win32는 `claude.cmd`)에 "호출되면 `${trapDir}/TRIPPED`를 쓰고 exit 1" 스텁을 심는다. 실행 후 `meta.paidCallTrapTripped = fs.existsSync(trap)`를 기록한다. **`meta.paidCalls: 0` 상수 선언은 하지 마라.**
   - 레벨마다 첫 시드 1회는 실제 훅으로 교차검증한다. 반드시 `okfPaths(home).lock`에 `{pid: process.pid, startedEpochMs: Date.now()}`를 먼저 심어라(`test/smoke.mjs:86-93` 관용구) — 빼면 detached 실배치가 뜨고 개발 머신에서 과금된다. `finally`에서 락 제거.
   - 측정 직후 `fs.rmSync(home, {recursive:true, force:true})`. 스모크의 sandbox 미정리 관례에 대한 **의도적 예외**이며 이유를 주석에 남긴다(200 concept × 20 시드 × 4 레벨 × git 오브젝트).
6. **사전등록서 — 측정 실행보다 먼저 커밋.** `docs/benchmarks/pre-registration-2026-07-25-e1.md`. 절 구성은 v4를 따른다. 필수 내용:
   - **재탕 금지 축 명시**: 번들 크기 대비 비용 / 체인 누적 효과 / 같은 저장소 OKF vs CLAUDE.md 재측정 / v3·v4 재실행. 이미 $151을 썼고 결론은 각각 '반증' 또는 '분리 안 됨'이다.
   - 예측 P1~P5: P1 `recall(N)`은 N에 단조 감소, `recall(200) ≤ 0.15`. P2 `recall(24) ∈ [0.45, 0.70]`. P3 recall은 카테고리별 정답 수에 반비례. P4 시드 간 표준편차 ≤ 0.25. P5 `cwdIndependent` 부분집합과 전체의 차이 ≤ 0.10(현행 게이트에 관련성 신호가 0건이므로 차이가 나면 효과가 아니라 픽스처 인공물이다).
   - **반증 기준 R1~R5(코드가 JSON에 찍는다)**: R1 `recall(50) ≥ 0.90` → 라우팅은 병목이 아니다 → **I2를 v0.3에서도 착수하지 않는다** / R2 `recall(24) < 0.60` → 실사용 규모에서 이미 실패 중 / R3 단조 감소 위반 → 하니스 결함, 전 결과 폐기 / R4 표준편차 > 0.25 → filler 명명에 지배됨, 정책 결론 금지 / R5 캘리브레이션 5개 값 불일치 → 전 결과 무효.
   - **알려진 한계**: 합성 distractor는 라우터 성능의 **상한만** 준다 / recall은 정답률이 아니다 / 라이브 형상은 n=1 / 하니스는 동결된 `logMd`로 예산을 고정하며 그것이 라이브와 다른 날에는 다른 값이다.
7. **측정 실행과 리포트($0).** `docs/benchmarks/gate-recall-2026-07-25-e1.md`. 레벨별 `recallMean ± stdev`에 **n·min–max를 같은 표에** 찍는다(`test/bench-report.mjs:14-15`의 "2개짜리 중앙값을 곡선의 점처럼 보여주던 v2 #2를 기계적으로 막는다"). 질문별 생존율 20행, `cwdIndependent` 부분집합 별도 행, R1~R5 판정, 재현 명령. **결과가 예측과 달라도 서술을 바꾸지 마라** — R1이 발화하면 이 릴리스의 결론은 "I2를 하지 않는다"이고 그것을 그대로 발행하는 것이 성공이다.
8. **스모크 회귀 가드.** `test/smoke.mjs:262-358` 블록 뒤에 `=== gate module + recall harness ===` 섹션 신설. 축소 실행(레벨 24·50 × 시드 2)만 CI에 태우고, 단언은 recall 값이 아니라 **불변식**에 건다. `.github/workflows/test.yml`은 손대지 않는다(`node test/smoke.mjs` 하나가 전부). **`.claude-plugin/plugin.json`과 `test/smoke.mjs:1174`의 `'0.1.6'` 리터럴은 이 패키지가 건드리지 않는다** — 이 패키지는 plugin.json을 바꾸지 않으므로 그 단언은 그대로 통과한다. 버전 승격은 릴리스 통합 커밋 소관이다.

#### 검증 방법
| 테스트 이름 | 픽스처 | 단언 |
|---|---|---|
| `gate module and session-start subprocess emit byte-identical context` | `bootstrapped('gate-drift')` + concept 3개 + `regenerateIndex` | `buildContext({...})` 결과 === `runHook('bin/session-start.mjs')`의 `additionalContext` |
| `gate stats reproduce the frozen live shape` | `live-shape` 바이트 벡터로 합성, `buildInjectedIndex(home, 92, 6956, stats)` 직접 호출 | `stats.taken===12 && stats.total===22 && stats.leftoverBytes===58`, 조립 9218, 절단 218 |
| `gate-recall harness measures under the frozen live budget` | 각 레벨·시드의 `measure()` | `stats.headBytes===shape.headBytes && stats.tailBytes===shape.tailBytes` |
| `gate stats instrumentation does not change gate output` | 기존 `session-start-starvation` 픽스처 | `buildContext(args)` === `buildContext(args, {})`, 그리고 `stats.cats.length===6` |
| `gate-recall harness is deterministic for a fixed (level, seed)` | 같은 `{level:24, seed:7}`로 두 번 조립 | `sha256(idxOf(a.text)) === sha256(idxOf(b.text))` **및** `JSON.stringify(a.survivors)===JSON.stringify(b.survivors)`. `idxOf = (t) => t.slice(t.indexOf('--- index.md ---'), t.indexOf('--- 최근 변경'))` — 전체 텍스트가 아니라 index 구간만 |
| `gate head byte length does not depend on the sandbox path length` | 길이가 다른 두 홈으로 `buildContext` | 두 결과의 index 구간이 동일 |
| `gate-recall harness never invokes a paid LLM` | `test/gate-recall.mjs` 소스 | `!/claude_bin\|runClaude\|fake-claude\|OKF_RUN_LIVE_BENCH/.test(src)` **및** `!/execFileSync\([^)]*claude/i.test(src)`. **`\bclaude\b`는 절대 쓰지 마라** — `.claude`(CLAUDE_CONFIG_DIR 조립)에 걸려 반드시 실패한다 |
| `gate-recall harness trips no paid claude invocation` | PATH 트랩 스텁 | `meta.paidCallTrapTripped === false` |
| `frozen gate-recall question set satisfies its own composition rules` | `gate-recall.json` | 질문 20개, `answerConcept` 중복 0, `cwdIndependent` ≥6, 6개 디렉토리 각 ≥2, 모든 `sourceFile` 존재 |
| `gate-recall levels clear the planted-concept floor` | 같은 JSON + `bootstrapped()`의 시드 수 실측 | `Math.min(...levels) >= questions.length + seedCount` (=24) |
| `reduced recall run stays inside the frozen budget and plants only known concepts` | `runLevel({level:24, seeds:[1,2]})` | 모든 샘플에서 `truncatedBytes===0 && cappedLines===0` **및** `survivors.every((rel) => plantedSet.has(rel))`. recall 값 자체는 OS·tmpdir 의존이라 CI 단언 대상이 아니다 |
| `E1 pre-registration fixes refutation criteria before any report` | `pre-registration-…-e1.md` | `R1`~`R5`, `I2 승인 조건`, `recall(50)`, `0.90`, `재탕` 문자열 전부 포함. 리포트가 존재하면 그 본문이 사전등록 파일명을 링크로 포함 |
| `gate-recall report records n and min–max per recall cell` | 리포트 존재 시 | 각 recall 셀 행에 `n=` 와 `–`(min–max)가 정규식으로 매치 |

#### 통과 규칙
- **캘리브레이션(G3-0a)**: `taken 12/22`, 조립 **9,218B**, 절단 **218B**, 잔여 **58B** — 5개 값 전부 오차 0. 불일치 시 R5 발화, **전 결과 무효**.
- **예산 동형(G3-0b)**: 모든 레벨·시드에서 `stats.headBytes`/`tailBytes`가 픽스처 값과 일치. 불일치 시 하니스가 `shape drift`로 조기 실패한다.
- **결정성(G3-0c)**: 동일 `(level, seed)` **10회 재조립 → index 구간 sha256 10/10 동일**, 생존 집합 10/10 동일.
- **유료 0(G3-0d)**: PATH 트랩 **미발동**, 총 측정 비용 **$0.00**, `OKF_RUN_LIVE_BENCH=1` 실행 0회.
- **안정성(G3-0e)**: 4개 레벨 전부에서 시드 20개 간 표준편차 **≤ 0.25**. 초과 시 R4 발화 → 정책 결론 금지.
- **순서(G3-0f)**: `git log --diff-filter=A -- docs/benchmarks/pre-registration-2026-07-25-e1.md`가 반환하는 커밋이 리포트 최초 추가 커밋보다 **앞선다**(같은 커밋 불가).
- **drift 0**: `lib/gate.mjs` 산출과 훅 서브프로세스 출력이 바이트 동일, 교차검증 실패 **0건**.
- **스모크**: 적용 직전 passed 수를 N이라 할 때 **정확히 N+13 passed, 0 failed**, exit 0. **`test/smoke.mjs:262-358`의 기존 게이트 단언 23건 중 수정되는 것 0건**(추출이 동작을 바꾸지 않았다는 증거).
- **실행 시간**: 전체 실행(4레벨 × 20시드) 5분 이하, 스모크 축소판 5초 이하.

#### 선행·롤백
**선행**: 없음. Part 2의 진입점이다. 릴리스 1의 R5(예산 회계 수정)가 이미 착지해 있어야 캘리브레이션이 의미를 갖는다 — 라이브 218B 절단은 R5가 고칠 대상이고, 이 픽스처는 **R5 착지 이전의 형상**을 동결한 것이므로 그 사실을 픽스처 `source` 필드에 적어라.

**롤백**: 프로덕션 변경은 **1단계의 `lib/gate.mjs` 추출 하나뿐**이며 순수 리팩터다. `git revert` 하나로 `bin/session-start.mjs:10-102`에 함수 4개가 되돌아간다 — 번들 마이그레이션·설정 키·사용자 데이터 변경이 0이다. 계측만 문제면 더 작은 되돌림이 가능하다: `if (stats)` 블록만 제거하면 게이트 동작은 그대로고 하니스만 죽는다. 나머지(하니스·픽스처·사전등록서·리포트·스모크 블록)는 순수 추가라 삭제로 원복된다. **주의**: 결과를 발행한 뒤 하니스를 되돌리는 경우 리포트를 지우지 말고 사전등록서의 '사후 수정 기록' 절에 이유와 날짜를 남겨라 — 결과를 조용히 회수하는 것이 v2가 저지른 실패의 형태다.

---

### I5 — 세션 소비 규약: 게이트 head 정본화 + okf-usage 일치 + 정정 피드백 경로

#### 목표
세션이 번들을 어떻게 읽고, 언제 Read를 승격하고, 못 찾았을 때 어디서 멈추고, 틀린 것을 발견했을 때 무엇을 하는지를 **하나의 정본**(`lib/session-contract.mjs`의 `GATE_RULES`)에서 정의한다. 게이트 head는 그 정본을 조립하고, `skills/okf-usage/SKILL.md`는 같은 문장을 글자 그대로 인용하며, CI가 일치를 강제한다. 여기에 (b) `status: deprecated` 처리, (c) `verified` 부재가 정상이라는 규정, (d) 탐색 상한(도구 호출 2회)과 종결 절차, (e) 정정을 배치로 전달하는 유일한 경로(transcript 평문 한 문장)를 더한다. **I3의 head 압축을 이 패키지가 흡수하므로 규칙 4를 추가해도 head는 오히려 작아진다.**

#### 근거
`reliability §4 T7.5`(CONFIRMED): 게이트(`bin/session-start.mjs:83`)와 `skills/okf-usage/SKILL.md:15-17`이 같은 판단 지점에서 상반된다 — 실측 확인. 게이트가 Read를 낮춘 근거는 `bin/session-start.mjs:74-77` 주석의 실측(토큰 +13,787 중 91%가 강제 Read 왕복, 새 사실 0개, 답 8/8이 index 줄에 있었다). `spec-conformance §4 P15`가 이 작업을 지정한다(stale 시 Read 승격 / 확인 결과를 대화에 남기게 / "unverified가 정상이며 그것을 이유로 정보를 버리지 마라" / `:15-17`을 게이트와 일치 / `:43-44`의 폐기 필드 정리). `:43-44`는 실측 확인했다 — **스펙에서 사라진 필드를 "권장 순서"로 가르치고 있다.** SPEC §5.4(deprecated = kept for links and history), §5.3(신뢰 등급은 `verified`에서만 파생), §11(선택 필드 누락으로 소비자가 거부 MUST NOT). 레퍼런스 실측: 자동 파이프라인이 만든 51개 concept가 전부 unverified — unverified는 결함이 아니라 우리와 같은 부류의 정상 상태다. T3.1: 배치 도구에 delete가 없어 concept 삭제 경로가 코드에 없다 → 세션의 정정은 Edit 요청으로만 도달한다. T8.9: 세션 직접 쓰기 예외가 문서에 도달 불가. 게이트 바이트 제약: `§5 제외 목록`("신뢰 등급 배지" 9B가 concept 1개를 축출, 12→11 실측), `lib/config.mjs`의 `inject_max_bytes` 상한 9000.

#### 구현 방안
- 규칙 문안의 **사본을 두지 않는다.** 사본은 반드시 갈라진다 — 그것이 T7.5와 `:43-44`가 같은 병인 이유다.
- 게이트에는 **규칙 4(정정 피드백)만** 올리고 (b)(c)(d)는 스킬에만 둔다. 규칙 4가 게이트에 있어야 하는 이유: 이것이 시스템의 유일한 피드백 경로인데, "번들이 틀렸다"를 깨닫는 순간은 대개 코드를 보고 있을 때라 스킬이 안 켜진다.
- **I3의 head 압축을 여기서 흡수한다**(C7). 규칙 1을 3줄 369B → 2줄로, 규칙 2+3을 한 줄로 병합하면 규칙 4(+138B)를 더해도 고정부가 현행보다 작다.
- (e)는 반쪽만으로 무의미하므로 `prompts/ingest.md`에 배치 쪽 수신 규칙을 함께 넣는다.

#### 구현 방법
1. **`lib/session-contract.mjs` 신설** — 의존 0, 순수 함수만.
   ```js
   // 게이트 head(매 세션 주입)와 skills/okf-usage/SKILL.md(스킬 발동 시 로드)는 같은 판단
   // 지점을 다룬다 — 문안이 갈리면 세션이 상반된 두 규범을 받는다(reliability T7.5 실측:
   // 게이트는 "Read 없이 그 줄을 근거로 쓰라", 스킬은 "반드시 Read하라"였다).
   // 규칙 문장의 정본은 이 배열 하나다. SKILL.md가 같은 문장을 글자 그대로 인용하고
   // test/smoke.mjs가 일치를 강제한다.
   export const GATE_RULES = [
     { id: 'find', text: '1. 아래 인덱스에서 관련 concept를 먼저 찾아라. 제목·설명이 답이면 Read 없이 그 줄을 근거로 쓰고,\n   근거·맥락·예외가 필요하거나 설명이 …로 끝났으면 그때 Read 하라.' },
     { id: 'id-write', text: '2. 링크는 번들 루트 절대경로(/decisions/...). 번들은 배치가 관리 — 세션 중 직접 수정 금지.' },
     // 규칙 3이 게이트에 있어야 하는 이유: 이것이 유일한 피드백 경로다. 스킬은 모델이
     // 관련성을 인정할 때만 로드되는데, "번들이 틀렸다"를 깨닫는 순간은 대개 코드를
     // 보고 있을 때라 스킬이 안 켜진다. 늘 주입되는 게이트에 있어야 닿는다.
     { id: 'feedback', text: '3. 번들에 답이 없거나 틀렸으면 그 사실을 대화에 한 문장으로 남겨라 — 배치가 이 대화를 읽는다.' },
   ];

   // 게이트 head는 concept 예산에서 직접 차감된다(lib/gate.mjs의 buildContext).
   // 고정부(경로 제외) 상한 620B. 현행 고정부는 661B(686B − 경로 25B)다 — 규칙 1·2의
   // 압축이 규칙 3의 비용을 흡수해 head는 오히려 작아진다.
   export function buildGateHead(okfHome) {
     return `=== OKF KNOWLEDGE GATE (필수) ===\n전역 지식 번들: ${okfHome}\n규칙:\n${GATE_RULES.map((r) => r.text).join('\n')}\n--- index.md ---\n`;
   }
   ```
   산출 예상(경로 제외): 배너 36 + 경로줄 23 + `규칙:` 8 + 규칙1 229 + 규칙2 124 + 규칙3 139 + 구분자 17 = **576B / 9줄**. 규칙 1의 2번째 줄은 공백 3칸 들여쓰기이며 `\n   ` 시퀀스가 SKILL.md 인용과 **글자 그대로** 같아야 한다(편집기 자동정렬 주의).
   **`(OKF v0.1)` 표기는 여기 없다** — 릴리스 2에서 제거됐고 되살리지 마라. 플러그인 상수 보간도 틀린다(`readExistingOkfVersion`이 외부 값을 보존하므로 번들 선언과 갈라진다).
2. **`lib/gate.mjs`의 head 리터럴 교체.** I6이 옮겨온 `buildContext` 안의 `const head = \`=== OKF KNOWLEDGE GATE …\`` 템플릿 리터럴 **전체**를 `const head = buildGateHead(okfHome);`로 바꾸고 상단에 `import { buildGateHead } from './session-contract.mjs';`를 추가한다. **`bin/session-start.mjs`는 이 패키지에서 한 줄도 건드리지 않는다**(I6 착지 후 그 파일에는 head 리터럴이 없다). 예산 계산(`head.split('\n').length`, `Buffer.byteLength(head + tail)`)은 head를 동적으로 재므로 다른 코드 변경이 없다. I6이 함께 옮겨온 실측 근거 주석 끝에 한 줄 덧붙인다: `// 규칙 문안의 정본은 lib/session-contract.mjs다 — SKILL.md가 같은 문장을 인용하고 smoke가 일치를 강제한다.`
3. **`skills/okf-usage/SKILL.md:13-50` 전량 교체.** frontmatter(`:1-5`)와 intro(`:7-11`)는 그대로 둔다. 새 본문 구성:
   - `## 규칙 (게이트 문안 그대로)` — `GATE_RULES` 3개를 글자 그대로 인용하고, 위에 "이 문서와 게이트가 갈라지면 세션이 상반된 두 규범을 받는다 — CI가 일치를 강제한다"를 적는다.
   - `## 규칙 1을 실제로 적용하는 법 — 탐색의 시작과 끝`: 줄로 충분하면 거기서 끝낸다(실측 91%/12,508 토큰 인용) / **Read 승격은 셋뿐이다**(줄이 끊겼다 / 근거·맥락·예외가 필요하다 / 줄이 지금 보는 코드·사용자 진술과 어긋난다) / **종결 절차**: 인덱스에 없으면 → 카테고리 `index.md` Read → 그래도 없으면 `<OKF_HOME>` 안에서 Grep/Glob 1회. **여기까지가 상한이다(도구 호출 2회).** 그 뒤엔 탐색을 늘리지 말고 **"번들에 없다"고 명시적으로 말한 뒤** 코드·문서·사용자에게서 답을 구한다. 그리고 규칙 3에 따라 "번들에 <무엇>이 없었다"를 한 문장으로 남긴다.
   - `## 생애주기·신뢰 신호를 만났을 때`: `status: deprecated`는 읽지 말고 본문의 `superseded by /...`를 찾는다, 대체가 없으면 "은퇴했고 대체가 없다"는 사실 자체를 답으로 삼는다, `status` 부재 = `stable` / **`verified` 부재가 정상이다** — 배치 산출물이라 설계상 unverified이며 "아직 사람이 독립 확인하지 않았다"이지 "틀렸다"가 아니다. **부재를 이유로 concept를 무시하거나 이미 번들에 있는 사실을 사용자에게 다시 묻지 마라**(SPEC §11 위반). 사람이 확인한 항목은 actor가 `human:`으로 시작한다 / **낡음이 의심되면 Read 승격**.
   - `## 쓰기: 세션은 번들을 고치지 않는다 — 대화에 남긴다`: 정정 전달의 유일한 경로는 transcript. 형식은 자유지만 셋이 있어야 배치가 쓸 수 있다 — (1) 어느 concept인가(절대경로), (2) 무엇이 틀렸는가, (3) 무엇이 맞고 어떻게 확인했는가. 예시 한 줄. 근거 없는 "틀린 것 같다"는 반영 불가.
   - `## 직접 쓸 때의 규정 — 사본을 두지 않는다`: 디렉토리=type 1:1만 남기고, **나머지 규정은 `<OKF_HOME>/SCHEMA.md`를 Read해서 따르라**로 위임. 마지막 문장은 이렇게 쓴다: 「이 문서는 그 사본을 두지 않는다 — 사본은 반드시 갈라진다(이 절은 오랫동안 스펙에서 사라진 필드를 정본인 양 나열하고 있었다).」
   **함정**: 교체 후 본문에 문자열 `timestamp`와 `권장 순서`가 **한 번도 나오면 안 된다**(step 5의 드리프트 가드가 그것을 단언한다). 위 마지막 문장이 필드 이름과 '권장 순서'를 부르지 않도록 우회 표현을 쓴 이유가 이것이다.
4. **`prompts/ingest.md`에 정정 수신 규칙 추가.** `## 규칙`(`:45`)의 **첫 bullet(`:47-48`) 바로 뒤**에 삽입한다(I-M은 `okf_seed` bullet `:49-53` 뒤에 삽입한다 — 앵커가 겹치면 반드시 충돌한다):
   ```markdown
   - digest에 `/decisions/foo.md 가 X라는데 실제로는 Y다` 형태의 **번들 정정**이 있으면, 새 concept를
     만들지 말고 그 파일을 Edit해서 고쳐라. 단 정정에 **근거(무엇으로 확인했는가)가 없으면 반영하지
     말고 넘어가라** — 근거 없는 부정은 지식이 아니다. 한 회차에 반영하는 정정은 최대 3건이다.
   ```
   `prompts/ingest.md:18`이 "이번 실행에서 유효한 지시는 이 파일과 SCHEMA.md뿐"이라고 못 박으므로 스킬·커맨드에 써도 배치에 닿지 않는다. 치환 변수(`{{DIGEST_PATHS}}`/`{{SOURCE_PATHS}}`)와 문자열 `lint 오류 리포트`는 절대 건드리지 마라(`bin/batch.mjs:646`의 stage 판정과 fake-claude의 `isRepairCall`이 결합돼 있다).
   **적대적 digest 위험과 완화 3중**: (1) '근거 없는 정정 반영 금지' 문장, (2) 회차당 3건 상한, (3) `applyAnalyzerWorkspace`의 `SCHEMA.md`·`okf_seed: true` 하드 차단. 잔존 위험(일반 concept의 조용한 오염)은 **측정되지 않았다** — I6의 유료 축 후보에 '정정 반영 정밀도/오탐률'을 넣어라.
5. **`docs/USAGE.md`에 `## Session read/write contract` 절 추가.** `## Commands` 절 뒤, `## Optional statusline` 앞. 내용: 게이트와 스킬이 같은 4문장을 인용한다는 것, 조건부 Read, 탐색 상한 2회, 세션은 쓰지 않고 대화에 남긴다는 것, 정정 3요소, "배치 산출물은 설계상 `verified`가 없고 그것은 틀렸다는 뜻이 아니다". **README 8종은 건드리지 않는다**(새 번역 부채 금지, 그리고 `test/smoke.mjs:1176-1240`의 8종 동기화 단언과 무관한 절이다).
6. **스모크 추가.** `=== plugin contract and docs ===`(`:1139`) 앞에 `=== 세션 소비 규약 (게이트 ↔ okf-usage) ===` 섹션 신설.

#### 검증 방법
| 테스트 이름 | 픽스처 | 단언 |
|---|---|---|
| `gate rules and the okf-usage skill quote the same canonical sentences` | `GATE_RULES` import + SKILL.md 읽기 | `GATE_RULES.filter((r) => !skill.includes(r.text))`가 빈 배열. 실패 시 detail에 누락 `id` 목록 |
| `okf-usage no longer orders an unconditional Read` | SKILL.md | `!skill.includes('해당 파일을 Read하라') && !skill.includes('요약만 보고')` |
| `okf-usage keeps no second copy of SCHEMA.md field rules` | SKILL.md | `!skill.includes('timestamp') && !skill.includes('권장 순서') && skill.includes('SCHEMA.md`를 Read')` (백틱 포함 → 작은따옴표 문자열로 쓸 것) |
| `okf-usage says a missing verified entry is normal` | SKILL.md | `skill.includes('unverified') && skill.includes('다시 묻지 마라')` |
| `okf-usage routes deprecated concepts to their replacement` | SKILL.md | `skill.includes('status: deprecated') && skill.includes('superseded by')` |
| `okf-usage terminates the not-found path with an explicit budget` | SKILL.md | `skill.includes('도구 호출 2회') && skill.includes('번들에 없다')` |
| `okf-usage escalates Read when the index line cannot be trusted` | SKILL.md | `skill.includes('Read를 승격')` |
| `okf-usage names the transcript as the only correction path` | SKILL.md | `skill.includes('유일한 경로는 transcript')` |
| `skill stays inside its load-cost budget` | SKILL.md | `Buffer.byteLength(skill,'utf8') <= 4200` (현행 3,403B) |
| `gate head fixed portion stays within 620 bytes` | `buildGateHead('')` | `Buffer.byteLength(fixed,'utf8') <= 620`, detail로 실제 바이트 출력. **경로 몫을 분리한다** — head는 홈 경로를 그대로 싣기 때문에 사용자마다 값이 다르다 |
| `gate head stays within 10 lines` | 같은 출력 | `buildGateHead('').split('\n').length <= 10` |
| `session-contract module is the only place the gate rules are spelled out` | `lib/gate.mjs` 소스 | `'OKF KNOWLEDGE GATE'` 리터럴이 `lib/gate.mjs`에 **정확히 0회**. 리터럴을 남긴 채 모듈만 추가해도 문안 일치 테스트는 통과하므로, 정본화가 실제로 일어났는지는 이 단언만 잡는다 |
| `injected gate carries the correction-feedback rule` | `bootstrapped('session-contract')` + `runHook('bin/session-start.mjs')` | `ctx.includes('배치가 이 대화를 읽는다')` — 정본이 실제 주입 경로까지 도달했는지(서브프로세스 결과 단언) |
| `gate head change does not evict a concept from the live-shape fixture` | I6이 동결한 `live-shape` 바이트 벡터로 합성한 번들 | 이 변경 **전후로 `stats.taken` 동일** 및 `stats.truncatedBytes === 0`. 산문이 아니라 기계가 지킨다 |
| `ingest 프롬프트가 세션 정정을 근거 있는 경우에만 반영하라고 요구한다` | 기존 `ingestPrompt` 재사용 | `ingestPrompt.includes('번들 정정') && /근거[^\n]{0,40}없으면 반영하지/.test(ingestPrompt)` |
| `usage guide documents the session read/write contract` | `docs/USAGE.md` | `usage.includes('okf-usage') && usage.includes('unverified')` — 문장 일치가 아니라 키워드(USAGE는 영어, SKILL은 한국어) |

프롬프트/문안 단언 블록 상단에 이 코드베이스의 관용구(`test/smoke.mjs:1152-1160`)대로 면책 주석을 단다: **이것은 행동 단언의 프록시다. 규약이 실제로 탐색 호출 수와 정답률을 바꾸는지는 유료 축이 측정하며(I6 P-B), fake-claude는 고정 응답을 낼 뿐 개념을 저술하지 않는다.**

#### 통과 규칙
- `buildGateHead('')` 고정부 **≤ 620B**, 줄 수 **≤ 10**. 현행 고정부 661B 대비 **감소**한다(압축 흡수). 사용자 홈 경로가 길수록 head가 그만큼 커진다는 사실을 통과 규칙에 명기한다(25B 경로 기준 ~601B).
- `GATE_RULES` 3개 전부가 SKILL.md에 문자 그대로 포함 = **3/3**.
- SKILL.md에서 `timestamp` **0회**, `해당 파일을 Read하라` **0회**, `요약만 보고` **0회**, `권장 순서` **0회**. 총 바이트 **≤ 4,200B**.
- `lib/gate.mjs`에 `'OKF KNOWLEDGE GATE'` 리터럴 **0회**.
- live-shape 픽스처에서 이 변경 전후 **주입 concept 수 변화 0**, `truncatedBytes` **0B**.
- `prompts/ingest.md` 이 패키지 증가분 **≤ 400B**, `lint 오류 리포트` 문자열 무변경, 치환 변수 정확히 2개.
- 스모크: 적용 직전 passed 수 N에 대해 **정확히 N+16 passed, 0 failed**, exit 0. 유료 호출 **0회**. 기존 `test/smoke.mjs:289`의 `gate allows answering from the index line without a redundant Read`가 계속 통과(규칙 1이 `Read 없이`를 보존한다).

#### 선행·롤백
**선행**: **I6**(`lib/gate.mjs` 추출이 먼저여야 이 패키지가 편집할 파일이 존재한다), **I-M**(`prompts/ingest.md` 앵커 분리 합의). 릴리스 1의 **R5**가 착지해 있어야 한다 — 다만 이 패키지가 head를 줄이므로 R5 없이도 축출은 발생하지 않는다. 그래도 live-shape 단언은 R5 착지 상태에서 돌려라.

**롤백**: 단일 커밋 revert로 완전히 되돌아간다 — 설정 키 0개, `.okf/` 상태 파일 0개, `schema_version`/`okf_version` 무변경, 사용자 번들 파일 무수정, 마이그레이션 0줄. 되돌리면 다음 SessionStart부터 이전 head가 주입되고 번들에는 아무 흔적이 없다.
부분 롤백: (a) 규칙 3(피드백)만 문제 → `GATE_RULES`에서 `feedback` 항목 하나 제거 + **SKILL.md의 같은 줄도 함께 제거**(두 파일이 한 쌍이라 한쪽만 지우면 일치 테스트가 빨개진다). (b) 정본 모듈 자체가 문제 → `lib/gate.mjs`의 `const head = buildGateHead(okfHome);`만 리터럴로 되돌리고 head 단언 2개를 제거. 모듈과 SKILL.md는 남겨도 무해하다. (c) 배치 정정 규칙만 문제(오탐 오염) → `prompts/ingest.md` bullet 3줄과 단언 1개만 제거. 이미 잘못 반영된 concept는 `git -C <OKF_HOME> revert <커밋>` — 배치 커밋은 `okf: ingest <date> (chunk i/N)`로 분리돼 있어 회차 단위 원복이 가능하다. **되돌릴 수 없는 것은 없다.**

---

### I3 — 게이트 고정비 상한화: tail 바이트 캡 + 줄 파서 (2층 설명 배급은 플래그 뒤에 보류)

#### 목표
9,000B 예산에서 concept에 실제로 도달하는 바이트를 늘린다. 지금 예산의 25.2%(2,264B)가 고정비인데, 그중 tail(log.md 최신 섹션)은 `capLines(15)`로 **줄 수만** 제한돼 바이트가 사실상 무제한이다 — 라이브 세 섹션의 tail 비용이 1,358B / 1,826B / 5,288B로 **3.9배** 흔들리고, 5,288B인 날은 예산의 58.8%를 tail이 먹어 주입 concept가 **3개**로 떨어진다. 이 패키지는 (1) tail을 바이트로 캡해 고정비를 확정하고, (2) index 줄을 제목/설명으로 분해하는 파서를 넣는다. **(3) 2층 설명 배급은 구조 플래그 뒤에 두고 기본 OFF다** — 실측상 그것은 "22/22 주입"이지만 **설명 보유 줄을 13 → 10으로 줄이고**, 설명 없는 줄은 SCHEMA가 '예고편'이라 부르며 왕복 1회 ≈ 12,500토큰으로 가격을 매긴 바로 그것이다.

#### 근거
`reliability §4 T7.1/T7.3/T7.4`, `spec-conformance §3 B4/B5`. 정찰 기준선(12/22, 조립 9,218B, 절단 218B, head 686B/tail 1,358B/heading 220B, 잔여 58B)을 이 워크트리에서 `bin/session-start.mjs:29-101`의 산술로 그대로 재현해 확인했다.
신규 실측 3건이 설계 근거다.
1. **tail 바이트 무제한** — `extractLatestLogSection`(`:63-71`)이 `capLines(section, 15)`로 줄만 자른다. 배치가 bullet을 어디서 접느냐는 규정된 적이 없으므로(`prompts/ingest.md`는 "최상단 `## YYYY-MM-DD` 섹션에 bullet"만 요구) 고정비가 LLM의 줄바꿈 습관에 종속된다. 2026-07-17 섹션은 **5줄인데 1,826B** — 줄 캡이 아예 발동하지 않는다.
2. **줄 바이트 구성** — 라이브 22줄에서 설명 8,760B(**75.4%**, 평균 398B, 최대 1,329B), 제목 1,959B(16.9%, 평균 89B), 링크 902B(7.8%). 예산을 먹는 것은 설명이고 "이 concept를 읽을지" 판단에 쓰이는 것은 제목이다.
3. **설명 절단은 공짜가 아니다** — v3가 OKF의 유일한 압승 영역으로 측정한 "코드에 없는 팀 정책"의 실물이 `/preferences/rust-msrv-freeze-policy.md`(설명 1,009B)인데, 300B 캡에서 핵심 답은 살아남지만 **예외 2건이 잘리고**, 160B에서는 핵심 답도 사라진다.

**적대적 검토가 뒤집은 것(반영됨)**: 2층 배급(step 4)을 `INDEX_DESC_CAP_BYTES = 0`으로 켜면 라이브에서 **설명 보유 줄이 13 → 10으로 감소**한다. 헤드라인 "22/22 주입"은 제목 수를 세는 지표로 바꿔치기한 것이다. 그리고 롤백 레버로 제시됐던 `INDEX_DESC_CAP_BYTES = 0`은 **절단만 끄고 2층 생략은 남겨** 가장 나쁜 상태를 고정한다. 따라서 롤백 레버를 **구조 플래그**로 바꾸고 기본을 OFF로 한다.
**(d) "루트는 카테고리와 대표 concept만" 기각**: 그것이 정확히 PR #1이 고친 이전 상태이고(`bin/session-start.mjs:10-14` 주석), v3에서 게이트 초과 토큰의 91%가 강제 Read 왕복이었다. concept를 안 보이게 만들어 Read를 유도하는 방향은 이미 반증된 축으로의 회귀다.

#### 구현 방안
- **마커 환급 회계와 `lines=0;break;`→`continue`는 이 패키지가 손대지 않는다.** 릴리스 1의 R5가 이미 했다. 여기서 재구현하면 세 번째 설계가 같은 30줄에 겹친다(Rule 7).
- **head도 손대지 않는다.** I5가 소유한다(C7).
- tail 캡 값은 **config 키로 만들지 않는다.** 설정 키 하나는 6표면 동기화 + config-invalid 픽스처 수정을 강제하는데, 이 값은 사용자가 조율할 성질이 아니라 상한이다(전역 Rule 2).
- 파서 실패는 **원문 통과**다. 압축 실패가 유실이 되면 안 된다.

#### 구현 방법
1. **tail 바이트 캡.** `lib/gate.mjs` 상단에 상수 2개:
   ```js
   // 게이트 고정비(head+tail+heading)는 concept 예산에서 그대로 빠진다. tail은 log.md의 최신
   // `## YYYY-MM-DD` 섹션인데 지금은 capLines(15)로 *줄* 수만 제한한다 — 배치가 bullet을
   // 어디서 접을지는 어디에도 규정돼 있지 않아 바이트는 사실상 무제한이다. 라이브 실측
   // (2026-07-25, 세 섹션): 1,358B(20줄) / 1,826B(5줄 — 줄 캡 무발동) / 5,288B(21줄)로
   // 3.9배 흔들렸고, 5,288B인 날은 9,000B 예산의 58.8%를 tail이 먹어 주입 concept가
   // 22개 중 3개로 떨어졌다. 줄로는 못 막는다.
   const TAIL_MAX_BYTES = 600;
   const TAIL_TRUNCATED_MARKER = '\n...(생략 — 전체는 /log.md 를 Read)';
   ```
   `extractLatestLogSection`의 본문은 한 글자도 손대지 않고 마지막 `return capLines(...)` 한 줄만 교체한다:
   ```js
   export function extractLatestLogSection(logContent, maxLines = 15, maxBytes = TAIL_MAX_BYTES) {
     /* :64-69 기존 본문 그대로 */
     const capped = capLines(section.trimEnd(), maxLines);
     if (Buffer.byteLength(capped, 'utf8') <= maxBytes) return capped;
     // 잘렸다는 사실과 내려가는 길을 함께 남긴다 — index 쪽 생략 마커와 같은 계약이다.
     return `${truncateUtf8Bytes(capped, maxBytes - Buffer.byteLength(TAIL_TRUNCATED_MARKER, 'utf8'))}${TAIL_TRUNCATED_MARKER}`;
   }
   ```
   tail 총비용 상한 = 600 + 헤딩 `--- 최근 변경 (log.md) ---\n` 31B = **631B 확정**.
   **함정**: 마커 문자열에 '생략'이 들어가는데 `test/smoke.mjs:321`의 `ctx.includes('생략')`은 **index 절단**을 겨냥한 단언이다. tail 마커가 그 단언을 우연히 통과시켜 index 절단 회귀를 가릴 수 있으므로, tail 마커는 `전체는 /log.md 를 Read`, index 마커는 `전체 목록은 /<dir>/index.md 를 Read`로 **문자열을 의도적으로 다르게** 두고 검증에서 index 마커를 정규식으로 특정한다.
2. **index 줄 파서.** `readCategoryLines` 바로 아래:
   ```js
   // index.md 한 줄은 `- [제목](/경로): 설명` 형태다(lib/index-gen.mjs:111). 라이브 22줄 실측:
   // 설명이 줄 바이트의 75.4%(평균 398B, 최대 1,329B), 제목 16.9%, 링크 7.8%.
   // 제목 안의 ')'는 안전하지만 ']'가 들어가면 매치가 실패한다 — 그때는 줄을 원문 그대로
   // 쓴다. 압축 실패가 유실이 되면 안 된다.
   const INDEX_LINE_RE = /^(- \[[^\]]*\]\([^)\s]*\)): (.*)$/s;
   const DESC_TRUNCATED_MARKER = '…';   // U+2026 = 3바이트. 1을 빼면 캡을 2B 초과한다.

   export function splitIndexLine(line) {
     const m = INDEX_LINE_RE.exec(line);
     return m ? { lead: m[1], desc: m[2] } : { lead: line, desc: '' };
   }

   export function renderIndexLine(item, descCapBytes) {
     if (!item.desc) return item.lead;
     if (descCapBytes <= 0 || Buffer.byteLength(item.desc, 'utf8') <= descCapBytes) {
       return `${item.lead}: ${item.desc}`;
     }
     const room = descCapBytes - Buffer.byteLength(DESC_TRUNCATED_MARKER, 'utf8');
     return `${item.lead}: ${truncateUtf8Bytes(item.desc, room)}${DESC_TRUNCATED_MARKER}`;
   }
   ```
   정규식은 라이브 22줄 전부 + 적대적 입력으로 실행 검증했다: 제목 내 `)` 정상 / 설명 내 마크다운 링크 `[/references/x.md](/references/x.md)` 정상(선두 앵커 + `[^)\s]*`가 공백을 못 넘어 첫 `)`에서 끊긴다) / 설명 내 `): ` 정상 / 설명 없는 줄 → NO MATCH → 원문 / 제목 내 `]` → NO MATCH → 원문(훼손 없음).
   `DESC_TRUNCATED_MARKER`는 I5의 head 규칙 1에 있는 "설명이 …로 끝났으면 그때 Read 하라"와 **한 쌍**이다. 한쪽만 바꾸면 모델이 절단을 인지하지 못한다.
3. **2층 배급은 구조 플래그 뒤에.** `INDEX_DESC_CAP_BYTES` 값이 아니라 **구조 자체**를 끈다:
   ```js
   // I6 승인 전까지 false. false이면 buildInjectedIndex는 현행 1층 경로를 그대로 탄다.
   // 실측: 2층을 켜면 "22/22 주입"이지만 설명 보유 줄이 13 → 10으로 줄어든다.
   // 설명 없는 줄은 SCHEMA.md가 '예고편'이라 부르며 왕복 1회 ≈ 12,500토큰으로 가격을
   // 매긴 바로 그것이고, v3 실측에서 게이트 초과 토큰의 91%가 그 왕복이었다.
   const INDEX_TWO_LAYER = false;
   const INDEX_DESC_CAP_BYTES = 0;
   ```
   `buildInjectedIndex`는 `INDEX_TWO_LAYER === false`일 때 R5가 고친 현행 `c.lines`/`taken` 경로를 **그대로** 탄다. true일 때만 `c.items = readCategoryLines(...).map(splitIndexLine)` 구조로 들어가고, 1층(제목+링크 round-robin) → 2층(남은 바이트로 설명 부착) 순서를 돈다. 2층 루프의 blocking을 반드시 고쳐라 — 긴 설명 하나가 그 카테고리의 이후 설명 전부를 굶기면 그것은 step 4가 고치겠다던 starvation을 2층에서 재생산한 것이다:
   ```js
   if (bytes < delta) { c.upgraded += 1; progress = true; continue; }  // 다음 item에게 기회를 준다
   ```
   그리고 2층에서는 **`lines`를 절대 건드리지 마라** — 설명은 기존 줄 뒤에 붙으므로 줄 수가 늘지 않는다. 여기서 `lines -= 1`을 하면 줄 예산이 이중 차감돼 카테고리가 조용히 굶는다.
4. **`buildContext`의 이중 캡은 그대로 둔다.** `truncateUtf8Bytes(capLines(...), injectMaxBytes)`는 예산이 아니라 안전망이고, 이 패키지의 통과 규칙 중 하나가 **"이 안전망이 한 바이트도 자르지 않는다"**이다. 안전망 발동 자체가 예산 계산이 틀렸다는 신호다.

#### 검증 방법
| 테스트 이름 | 픽스처 | 단언 |
|---|---|---|
| `gate log tail is capped by bytes, not just by line count` | `bootstrapped('session-start-fat-log')` + concept 8개 + **줄 수는 적고 바이트는 큰** log.md(`'## 2026-07-15\n- ' + '배치가 접지 않은 아주 긴 bullet 한 줄 '.repeat(80)`) | `Buffer.byteLength(tail,'utf8') <= 700`, detail로 실제 바이트 |
| `a byte-fat log tail no longer starves the concept index` | 같은 홈 | `(ctx.match(/^- \[뚱뚱한 결정/gm)\|\|[]).length >= 6`. 수정 전 코드에서는 3 이하로 떨어진다(라이브 최악 시나리오 3/22의 픽스처 재현) |
| `a small log tail gets no truncation marker` | 기존 `session-start` 픽스처(log.md 45B) | `!ctx.includes('전체는 /log.md 를 Read')` — 캡이 **발동하면 안 되는** 구간의 음성 단언. 이게 없으면 tail 마커가 `includes('생략')`을 우연히 통과시켜 index 절단 회귀를 가린다 |
| `the omission marker is the index marker, not the log tail marker` | 기존 `session-start-starvation` 픽스처 | `/\.\.\.\(\d+개 생략 — 전체 목록은 \/[a-z]+\/index\.md 를 Read\)/.test(ctx)` |
| `an index line the splitter cannot parse is injected verbatim` | `bootstrapped('session-start-line-split')` + 제목에 `]`가 든 concept(`title: 배열[0] 인덱싱 규칙`) | `ctx.includes('배열[0] 인덱싱 규칙')` |
| `a description containing a markdown link keeps its link intact` | 같은 홈 + `description: 유일한 성공 사례는 [/references/x.md](/references/x.md).` | `ctx.includes('](/references/x.md)')` |
| `a concept with no description still gets its title injected` | 같은 홈 + description 없는 concept | 제목 문자열 포함 |
| `the byte-cap safety net never actually truncates the assembled gate` | 기존 `session-start-oversized`의 log.md 마지막 줄을 `- SENTINEL_TAIL_END`로 | `ctx.trimEnd().endsWith('SENTINEL_TAIL_END')`. 카테고리가 여러 개인 픽스처에서는 `Buffer.byteLength(ctx,'utf8') < DEFAULT_CONFIG.inject_max_bytes`(정확히 9000 = 절단 발생) |
| `two-layer rationing is off by default` | `lib/gate.mjs` 소스 | `/const INDEX_TWO_LAYER = false;/.test(src)` — 플래그가 켜진 채 머지되는 것을 CI가 막는다 |
| `the gate does not deliver fewer answers than the single-layer gate` | live-shape 픽스처 | 플래그 ON/OFF 각각에 대해 `(ctx.match(/^- \[[^\]]*\]\([^)]*\): /gm)\|\|[]).length` (=**설명 보유 줄 수**)를 세고, ON이 OFF 이상. 지금 구현으로는 ON이 더 작으므로 이 단언이 플래그를 잠그는 자물쇠다 |
| `a long description does not starve the shorter ones in its category` | 플래그 ON + 한 카테고리에 [설명 2,000B 1개 + 설명 100B 5개], 예산은 짧은 5개를 담을 만큼 | 짧은 5개 중 최소 4개가 설명을 얻는다. blocking 수정 전에는 0개다 |

#### 통과 규칙
- **고정비**: live-shape 픽스처에서 head+tail+heading 선차감 합계 **≤ 1,500B**(현행 2,264B). 산출: head ≤620(I5) + tail ≤631 + heading 220.
- **tail 결정성**: log.md 세 섹션(원본 1,824B / 1,794B / 9,226B) **어느 것이 최신이어도** 조립 tail 총 바이트 **≤ 700B**(현행 1,358 / 1,826 / 5,288, 편차 3.9배 → **1.0배**).
- **최악 시나리오 주입량**: 9,226B 섹션이 최신인 조건에서 주입 concept **≥ 13개 / 22개**(현행 3개).
- **절단 0**: 위 3개 log 시나리오 + `session-start-oversized`(500 concept) + `session-start-starvation`(201 concept) **전부에서** `stats.truncatedBytes === 0` **및** `stats.cappedLines === 0`.
- **캡 준수**: 모든 픽스처에서 `Buffer.byteLength(additionalContext,'utf8') <= 9000`. 이 패키지는 **바이트를 더 쓰는 방향으로 가지 않는다**(Claude Code 10,000자 out-of-band 경계).
- **파서 무손실**: `splitIndexLine`이 실패한 줄은 원문 그대로 주입돼 **주입 concept 줄 수 === `readCategoryLines` 반환 줄 수**(훼손·유실 0건).
- **설명 보유 줄 수 비감소**: 플래그 OFF 상태에서 이 패키지 적용 전후로 설명 보유 주입 줄 수 감소 **0**.
- **스모크**: 적용 직전 passed 수 N에 대해 **정확히 N+10 passed, 0 failed**(플래그 OFF 상태에서 실행되는 단언 기준. 2층 관련 2건은 플래그를 코드에서 true로 바꿔 로컬에서만 돌린다). 설정 키를 추가하지 않으므로 config-invalid 픽스처와 README 8종 동기화 검사는 **건드리지 않는다**.

#### 선행·롤백
**선행**: **I6**(`lib/gate.mjs` 추출), **R5**(예산 회계 — 릴리스 1). I5와는 파일을 공유하지만 함수가 다르다(I5는 head, I3은 index/tail) — 머지 순서는 무관하되 같은 파일이므로 rebase가 필요하다.
**2층 배급(플래그 ON) 승인 조건**: §2.x 참조. 세 조건 전부 충족 전에는 **별도 커밋으로도 켜지 마라.**

**롤백**: 변경 표면이 `lib/gate.mjs` 한 파일과 스모크 신규 블록뿐이라 `git revert` 한 번이면 된다. 마이그레이션·재생성·사용자 번들 커밋이 **전혀 필요 없다** — 이 패키지는 주입 시점의 문자열 조립만 건드리고 디스크의 `index.md` 포맷·내용(`lib/index-gen.mjs`), `SCHEMA.md`, 설정 키, `templates/`·`commands/`·README를 일절 수정하지 않는다. **설명 절단은 주입된 문자열에만 존재하고 파일에는 전문이 남는다.** revert 후 다음 SessionStart 한 번이면 복원된다.
부분 롤백: tail 캡만 끄려면 `TAIL_MAX_BYTES = Infinity`(상수 한 줄, 긴급 완화 경로). 2층만 끄려면 `INDEX_TWO_LAYER = false` — **`INDEX_DESC_CAP_BYTES = 0`은 롤백 레버가 아니다.** 그것은 절단만 끄고 2층 생략은 남겨 정보 손실이 더 큰 상태를 고정한다.
**되돌림 실패 모드 하나**: I5의 head 규칙 1("설명이 …로 끝났으면 그때 Read")과 `DESC_TRUNCATED_MARKER`는 한 쌍이다. **2층이 켜져 있는 동안 I5를 되돌리지 마라** — 모델이 잘린 설명을 완결된 답으로 오독한다. 반대 방향(2층만 끄고 I5 유지)은 무해하다.

---

### I-M — 배제 규칙 + 팽창 억제 + 코드 백스톱 (I1 + I4 병합)

> **병합 사유(적대적 검토)**: I1과 I4가 동일 규칙(반복 관측 카운터)을 각자 프롬프트에 넣었고, lint 코드가 **정확히 뒤바뀌어** 있었으며, `prompts/ingest.md`의 같은 2줄 경계를 둘 다 잡았다. I1의 `test/exclusion-audit.mjs`는 `lib/bloat.mjs`와 중복이므로 **폐기**한다. 임계 상수는 `lib/bloat.mjs`가 export하고 lint가 import해 **단일 정의**로 만든다.

#### 목표
"무엇을 쓰지 않을 것인가"를 판정 가능한 형태로 프롬프트에 넣고(현재 `prompts/ingest.md`에 **0줄**), 같은 사실이 새 섹션으로 무한히 쌓이는 것을 막고, 그 팽창을 코드가 결정론적으로 세게 만든다. 산출물 4개: (a) 배제 4문항 + 카테고리 소속 조건 + 자기참조 차단, (b) `lib/bloat.mjs`(팽창 판정 순수 함수 + 번들 스캐너 + CLI), (c) lint W9/W10 백스톱과 repair 누수 차단, (d) 회차별 팽창 계측(`last-batch.json.growth`)과 `/okf:okf-status` 노출. **핵심 정직성 고지: 프롬프트 diff가 모델 산출을 실제로 바꾸는지는 유료 호출 없이 확인 불가하다** — fake-claude는 고정 응답을 낼 뿐 개념을 저술하지 않는다. 무료 축이 보장하는 것은 "규칙이 프롬프트에 살아 있고, 코드 백스톱이 알려진 오염 형태를 정확히 N건 잡고, 사전등록에 과다 배제 탐침이 실제로 들어 있다"까지다.

#### 근거
T1.3(raw 443개 중 실사용 5~6%, "그 대가가 번들에 남았다 — 최대 concept이 사용자 지식이 아니라 OKF 자기 버그 기록이다"), T3.5(20,381B 중 15,502B(76.1%)가 '추가 관측 2'~'추가 관측 11', 실질 진단은 앞 4,879B뿐인데 index 줄 973B가 카테고리 최대치로 예산을 계속 먹는다 — 원인으로 `prompts/ingest.md:47-48` 병합 규칙 지목), T3.2/T3.3(references 슬롯 2/2를 벤치 묘비가 점유, 라이브 22개 중 4개가 벤치 유래 오염), `§5 항목 7(A)` 말미("부수로 `ingest.md`에 '동일 사실의 N번째 반복 관측은 새 섹션으로 추가하지 말고 기존 섹션의 카운터만 갱신하라'를 넣는다"), `§5 항목 5(c)`(description은 절단이 아니라 상류 규율 + lint W 경고), v3 벤치(배제 축을 "grep으로 확인 가능한가"로 잡는 근거).
**임계값은 라이브에서 직접 계산했다**: concept 22개 91,029B, body 최대 정상값 **8,461B**(`projects/okf-system.md`) vs 오염 **19,362B** → `CONCEPT_MAX_BYTES = 12000`은 그 사이에 있어 **적중 1/22, 오탐 0**. 정규화 헤딩 반복 최대 정상값 **1회** vs 오염 **11회** → `REPEAT_HEADING_MIN = 3`은 여유 2단계, **적중 1/22, 오탐 0**.
**기존 300줄 규칙이 한 번도 발동하지 않은 이유**: 그 파일이 199줄이다. 한국어 102B/줄 → 300줄이 30,600B를 허용한다. 단위가 틀렸다.
**보고 전용으로만 두는 신호(기계를 얹지 않는다)**: 제목 토큰 Dice ≥ 0.30 유사쌍은 253쌍 중 **1쌍**(n=1이라 근거 약함), `resource` 동일 그룹 **0건**(resource 보유 concept 자체가 5개), 링크 고아 1건(연결성 신호이지 중복 신호가 아니다).

#### 구현 방안
- 배제 절은 **`## 규칙`(`:45`) 앞**에 넣는다. 뒤에 넣으면 `:47-48`의 "기존 파일을 Edit하라"가 먼저 읽혀 배제 판정 전에 쓰기 대상이 확정된다.
- **과다 배제 안전핀 3개는 절대 빼지 마라**: (1) 배제 문항 1의 반례("이유는 코드에 없다"), (2) "배제되는 것은 그 사실이지 digest 전체가 아니다", (3) "배제가 과하면 그것도 실패다" 항.
- W9/W10은 **반드시 W**. 그리고 **`buildRepairPrompt`가 코드로 필터**한다 — 메시지 안의 "repair는 무시하라" 같은 영어 한 구절에 맡기는 것은 코드가 답할 수 있는 것을 모델에게 부탁하는 것이다(전역 Rule 5).
- 정밀도 주장은 **커밋된 합성 픽스처**로만 한다. 라이브 번들 실측은 커밋 불가(사용자 지식 발행)이고 이동 표적이다(오늘 다시 세면 23개다).
- `stale` 보고는 **출처를 밝힌다.** 기존 concept의 `timestamp`는 배치가 기계 복사한 값이라 22개 중 4개가 8~10일 틀렸다 — 그 값을 날짜로 그대로 내밀면 안 된다.

#### 구현 방법
1. **`lib/bloat.mjs` 신설 — 임계 상수와 순수 함수의 단일 소유자.**
   ```js
   import fs from 'node:fs';
   import path from 'node:path';
   import { pathToFileURL } from 'node:url';
   import { resolveOkfHome, SCAN_EXCLUDE_DIRS } from './paths.mjs';
   import { parseFrontmatter } from './frontmatter.mjs';
   import { toIsoDate, isPlainObject } from './trust.mjs';   // 릴리스 1 S3a 산출물

   // 실측(2026-07-25, concept 22개): body 최대 정상값 8,461B vs 오염 19,362B.
   // 12,000은 그 사이라 적중 1/22·오탐 0이다. 기존 SCHEMA의 '300줄'은 그 파일이 199줄이라
   // 한 번도 발동하지 않았다 — 한국어 102B/줄이라 300줄이 30,600B를 허용한다. 단위가 틀렸다.
   export const CONCEPT_MAX_BYTES = 12000;
   export const CONCEPT_MAX_LINES = 300;    // 둘 중 먼저 닿는 쪽
   export const REPEAT_HEADING_MIN = 3;     // 실측: 적중 1/22, 오탐 0
   export const DUPLICATE_DICE_MIN = 0.30;  // 보고 전용. n=1이라 기계를 얹지 않는다
   ```
   **`walkMdFiles`를 `lib/lint.mjs:27`에서 이 파일로 옮기고 export한다.** import 방향은 **lint → bloat 단방향**이며 bloat는 lint를 절대 import하지 않는다(순환). 이 이동은 **별도 커밋**으로 분리하라(롤백 단위).
   export 함수:
   - `normalizeHeading(text)` — 끝의 괄호 주석과 일련번호만 뗀다. 가드 2개 필수:
     ```js
     export function normalizeHeading(text) {
       const s = String(text).trim();
       if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;  // 날짜 섹션은 연대기다 — 뭉치면 안 된다
       const out = s
         .replace(/\s*[（(][^）)]*[）)]\s*$/, '')
         .replace(/[\s\-–—:·.#]*\d+\s*(?:회|차|번|건)?\s*$/, '')
         .trim().toLowerCase().replace(/\s+/g, ' ');
       return out || s.toLowerCase();   // "## 1","## 2"가 전부 빈 키로 뭉치는 것을 막는다
     }
     ```
     실행 검증: `추가 관측 2 (2026-07-16, 동일 batch의 후속 ingest 실행)` → `추가 관측`, `2026-07-16` → 불변, `관측 3회` → `관측`, `1` → `1`.
   - `repeatedHeadingGroups(content, min)` — **코드 펜스를 먼저 제거한다**: `const scan = content.replace(/^```[\s\S]*?^```/gm, '');` 후 `scan`에서 `^#{2,3}[ \t]+(.*)$`를 훑는다. 셸/마크다운 예시를 3개 이상 담은 정상 concept가 오탐되는 구조적 경로를 막는다.
   - `classifyChange(prevBuf, nextBuf)` → `{ kind: 'created'|'append-only'|'edited', bytesBefore, bytesAfter }`. **본문(body)만 비교한다** — frontmatter를 넣으면 `generated` 스탬핑(릴리스 2)이 매번 `at`을 바꿔 바이트 접두 비교가 항상 거짓이 되고 '순수 추가' 신호가 영구 소멸한다.
   - `bundleConceptBytes(okfHome)`, `titleTokens`, `duplicateCandidates`, `scanBundle(okfHome)`.
   - `scanBundle` 반환: `{ conceptCount, totalBytes, oversize[], repeated[], stale[], duplicateCandidates[], orphans[] }`. **`stale` 원소는 출처를 싣는다**: `{ rel, at, ageDays, source: 'generated.at' | 'legacy-timestamp' }`.
   - **날짜 지뢰**: 따옴표 없는 `at: 2026-07-25T10:30:00Z`는 js-yaml이 **`Date` 객체**로 돌려주고 문자열 비교가 NaN이 된다. 반드시 `toIsoDate(v)`를 쓴다. **`generated`가 객체라는 보장도 없다** — `data.generated?.at`을 그냥 쓰면 `generated`가 문자열/배열일 때 `.at`이 프로토타입 메서드로 잡혀 truthy가 된다. `isPlainObject(g)` 가드 필수.
   - **CLI 진입 가드는 플랫폼 무관 형태로.** `lib/lint.mjs:203`의 `import.meta.url === \`file://${process.argv[1]}\`` 관용구를 **복제하지 마라** — 그것은 lint CLI가 코드에서 호출되지 않아 잠들어 있던 함정이고, Windows에서 `file://C:\...`가 되어 절대 발동하지 않는다. `/okf:okf-status`가 이 CLI에 의존하므로:
     ```js
     if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
     ```
   - `main()`은 `process.exit()`를 쓰지 않는다(항상 exit 0 — 진단 도구지 게이트가 아니다). `SCAN_EXCLUDE_DIRS`는 **`Set`이다 — `.has()`를 써라**(`lib/paths.mjs:45` 확인. `.includes()`는 첫 디렉토리에서 TypeError).
2. **`buildRepairPrompt`가 W6/W9/W10을 코드로 거른다.** `bin/batch.mjs:695-699`:
   ```js
   function buildRepairPrompt(pluginRootDir, report) {
     const t = fs.readFileSync(path.join(pluginRootDir, 'prompts', 'repair.md'), 'utf8');
     // W6(description 길이)/W9(본문 바이트)/W10(반복 섹션)은 '분할·병합' 지시인데 repair는
     // 새 파일을 만들 수 없다(prompts/repair.md:6-18). 리포트에 실으면 헛돌거나 파일을
     // 임의로 잘라낸다. 나머지 경고(W1/W3)는 자동 교정 경로라 그대로 싣는다.
     const SPLIT_RULES = new Set(['W6', 'W9', 'W10']);
     const filtered = { errors: report.errors, warnings: report.warnings.filter((w) => !SPLIT_RULES.has(w.rule)) };
     return t.replace('{{LINT_REPORT}}', () => formatReport(filtered));
   }
   ```
   repair 트리거는 `report.errors.length > 0`이므로 이 변경으로 repair가 안 도는 경우는 생기지 않는다. `prompts/repair.md:20`의 헤딩 `## lint 오류 리포트`는 절대 건드리지 마라(`bin/batch.mjs:646`의 stage 판정과 fake-claude의 `isRepairCall`이 그 문자열에 결합돼 있다).
3. **lint W9/W10 추가.** `lib/lint.mjs` 상단에 `import { CONCEPT_MAX_BYTES, CONCEPT_MAX_LINES, REPEAT_HEADING_MIN, repeatedHeadingGroups, walkMdFiles } from './bloat.mjs';`. `checkNonReserved`(`:115-143`)의 시그니처 **끝에** `body` 파라미터를 추가하고 호출부(`:167`)를 `checkNonReserved(relPath, hasFrontmatter, data, parseError, errors, warnings, hasFrontmatter ? body : content)`로 바꾼다. **반드시 `body`다** — `content`를 넘기면 frontmatter 바이트가 섞여 임계값 실측이 무효가 된다. W3 블록 뒤에:
   ```js
   // 팽창 억제는 W로만 착지한다. E로 올리면 기존 사용자 번들에서 handleDirtyWorkingTree
   // (bin/batch.mjs:398-417)가 이후 모든 ingest를 영구 정지시킨다.
   const bytes = Buffer.byteLength(body, 'utf8');
   const lineCount = body.split('\n').length;
   if (bytes > CONCEPT_MAX_BYTES || lineCount > CONCEPT_MAX_LINES) {
     warnings.push({ file: relPath, rule: 'W9',
       message: `concept body is ${bytes} bytes / ${lineCount} lines (cap ${CONCEPT_MAX_BYTES}B / ${CONCEPT_MAX_LINES})` });
   }
   for (const g of repeatedHeadingGroups(body, REPEAT_HEADING_MIN)) {
     warnings.push({ file: relPath, rule: 'W10',
       message: `${g.count} sections share the heading shape "${g.key}"` });
     break;   // 리포트 폭주 방지. checkLogHeadings(lib/lint.mjs:66-96)의 기존 관용구.
   }
   ```
   **메시지에 행동 지시("split it", "쪼개라")를 넣지 마라.** 규범은 `prompts/ingest.md`와 `templates/SCHEMA.md`에만 둔다 — 그 둘은 ingest 단계에만 도달하므로 repair.md의 '새 파일 금지'와 충돌하지 않는다. 규칙 코드 `W9`/`W10`은 `summarizeLintForLog`(`bin/batch.mjs:52`)의 `/^[A-Z][0-9]{1,2}$/`를 만족해 로그에 `W9=1` 형태로 집계된다(제목 원문은 로그로 새지 않는다).
4. **`prompts/ingest.md` — 배제 절 신설.** `## 무엇을 남기나` 절의 마지막 줄(`:43`)과 `## 규칙`(`:45`) **사이**에 `## 무엇을 남기지 않나 — 쓰기 직전 이 4문항을 통과해야 한다` 절을 삽입한다. 내용(압축 필수 — 아래 통과 규칙의 바이트 상한이 이를 강제한다):
   - 서두: "위 5단계에서 걸린 **사실 하나하나마다** 자문하라. 하나라도 '예'면 그 사실은 쓰지 마라. **배제되는 것은 그 사실이지 digest 전체가 아니다** — 같은 digest 안의 다른 사실은 독립 판정하라."
   - 문항 1 **코드가 이미 답하는가?** Grep/Glob/Read **한 번**으로 확인되는가(경로·시그니처·설정 현재값·의존성 버전·디렉토리 구조). → 예면 쓰지 마라. **반례(반드시 써라)**: "청크 상한이 300KB인 이유는 15분 타임아웃 안에 끝내기 위함" — 값은 코드에 있지만 **이유는 코드에 없다.** 코드에 없는 것은 언제나 이유·기각된 대안·엣지케이스·정책·실수와 해결이다.
   - 문항 2 **한 번뿐인 실행 관측인가?**(파일 개수, 테스트 통과 수, 로그 한 줄, 벤치 수치, 소요 시간) → 단, **원인 규명까지 도달해 재발 방지 규칙이 됐다면** troubleshooting으로 남긴다 — 남기는 것은 규칙이지 관측치가 아니다.
   - 문항 3 **주체가 OKF 자신인가?** 판정 문항 하나: **이 사실을 알기 위해 OKF 파이프라인 자신을 실행해야 했는가?** 예 → `.okf/logs/` 내용, 회차 결과, sweep 회수 수, NO-OP 발생, 락 상태, 자기 벤치 수치 전부 배제. 아니오 → 일반 프로젝트와 동일. **사용자가 okf-system을 개발하며 내린 설계 결정과 정책은 정상 기록 대상이다.** 둘을 혼동하면 사용자 자신의 프로젝트 지식이 통째로 사라진다.
   - 문항 4 **다음 세션이 이걸 몰라서 틀릴 수 있는가?**
   - `### 배제가 과하면 그것도 실패다` — "한 digest의 모든 사실이 4문항에 전부 걸리는 경우는 잡담뿐이다. 남길 것이 하나도 없다고 판단했다면 한 번 더 의심하라."
5. **`prompts/ingest.md` — 카테고리 소속 조건 + 반복/모순/분할 규칙.** (a) `:34-39`의 5개 bullet 각각에 `*조건*:` 문장을 병기한다(project=상태·다음 단계가 README/이슈/커밋 메시지에 적혀 있지 않을 것 / decision=**기각된 대안 1개 이상** / preference=**사용자가 직접 말한 지속 규칙** / pattern=2회 이상 또는 재발 조건 명시, troubleshooting=**증상·원인·해결 셋이 모두** / reference=출처가 대상 저장소 밖). **bullet의 순서와 번호는 유지하라**(`:32`가 순서에 의미를 부여한다). **절 제목 `무엇을 남기나`를 바꾸지 마라**(`test/smoke.mjs:1146`이 단언한다).
   (b) `## 규칙`의 `okf_seed` bullet(`:49-53`) **뒤에** 3개 bullet을 삽입한다(I5는 `:47-48` 뒤 — 앵커 충돌 방지):
   - **반복 관측 카운터**: 셋을 자문하라 — (1) 기존 concept의 어떤 섹션과 같은가, (2) 그 섹션에 없는 새 사실이 하나라도 있는가. (1)예·(2)아니오면 **새 `##` 섹션을 만들지 마라.** `관측: N회 (최초 YYYY-MM-DD, 최근 YYYY-MM-DD)` 줄에서 N을 1 올리고 '최근'만 바꾼다. (2)예면 그 섹션 **안에 bullet 한 줄**로 새 사실만 덧붙인다. **한 파일에 한 회차가 추가할 수 있는 `##` 섹션은 최대 1개.**
   - **모순 갱신**: 모순되는 사실을 만나면 새 파일이 아니라 그 파일을 갱신하고 log.md에 한 줄. **낡았다는 이유만으로는 아무것도 지우거나 폐기하지 마라** — 대체할 새 사실이 이번 digest에 실제로 있을 때만.
   - **분할**: 12,000바이트를 넘으면 분할(회차당 1개). 가장 응집된 축 하나를 새 파일로 떼고 원본에 요약 한 줄 + 링크. 원본 이동·개명 금지.
   **`stale_after`·`status`·`verified`를 이 프롬프트에 절대 언급하지 마라** — "소개하면 모델이 채우려 든다"(§4(c)). 위 문안은 필드 이름을 부르지 않는다.
6. **`templates/SCHEMA.md` — 택소노미 표 4열 + 병합 규칙 갱신.** `:55-62` 표에 `필수 조건 (미충족 시 쓰지 마라)` 열을 추가하고, `:65-68 # 병합 규칙`을 반복 카운터 규약 + **바이트 상한**(`12,000바이트 또는 300줄 중 먼저 닿는 쪽`) + "낡음만으로는 폐기하지 않는다" + 자기참조/grep 배제 3줄로 갱신한다.
   **함정**: `:63`의 "미지 type: 거부하지 말고…" 줄이 표 바로 아래를 유지해야 한다(SPEC §11). `# 절대 규칙` 헤딩(`:8`)을 절대 건드리지 마라 — `test/smoke.mjs:172-189`가 `synced.replace('# 절대 규칙', …)`로 로컬 편집 보존을 검사하는데, 바꾸면 그 replace가 no-op이 되어 테스트가 **조용히 무의미해진다**.
   **`schema_version` 범프는 릴리스 3에서 정확히 1회.** 이 패키지가 `templates/SCHEMA.md:3`을 `2 → 3`으로 올리는 **유일한** 주체다. `lib/bootstrap.mjs`의 비교가 `<`라 다운그레이드가 불가능하므로 릴리스 노트에 `git checkout <이전커밋> -- SCHEMA.md` 복구 안내를 반드시 넣어라.
7. **팽창 계측.** `applyAnalyzerWorkspace`(`bin/batch.mjs:756`)는 R3가 이미 `{applied, blocked}`를 반환한다. 여기에 `growth = {created, appendOnly, edited}`를 더한다. 순서를 지켜라: ① 동일성 검사(`Buffer.compare`) → ② 차단 게이트(`SCHEMA.md`/`okf_seed`) → ③ **`classifyChange(prev, next)` (generated 스탬핑 전의 `next`로)** → ④ 스탬핑 → ⑤ 쓰기 → ⑥ 카운터. `path.basename(childRel) !== 'log.md'`인 것만 센다 — log.md는 예약 파일이고 분석기가 규정상 매번 append하므로 빼지 않으면 `appendOnly`가 매 회차 1을 깔고 시작한다.
   `processChunkBody`에 누산기 인자를 추가하고, **커밋 분기 직전**(실패 반환 경로들 뒤 — 롤백된 청크가 지표에 섞이지 않는다)에 `bundleConceptBytes` 차분을 누산한다. **바이트는 `applyAnalyzerWorkspace` 안에서 합산하지 마라** — 그 함수는 청크당 최대 2회(ingest + repair) 호출되어 이중 계상된다. `kind` 카운터는 **ingest 호출의 반환만** 채택한다(repair는 지식 생산이 아니라 교정 패스다).
   `runBatch`는 `updateLastBatch(okfHome, result, { ...spendExtra(...), growth, bundleBytes: bundleConceptBytes(okfHome) })`로 넘긴다. **`updateLastBatch`의 시그니처는 R3가 소유한다** — 이 패키지는 `extra`에 필드만 얹는다.
8. **`/okf:okf-status` 노출.** `commands/okf-status.md:21-38`의 `## 2. 조사할 항목` 끝에 bullet 추가: `node "${CLAUDE_PLUGIN_ROOT}/lib/bloat.mjs" --json` 실행 + `last-batch.json`의 `growth`/`bundleBytes` 읽기. `## 3. 보고 형식`(`:41-46`)에 예시 줄 추가. 그리고 규범 문단 3개를 못 박는다:
   - 「노후 항목은 **사실 보고 전용**이다. 오래됐다는 이유로 파일을 지우거나 `stale_after`·`status` 같은 필드를 붙이거나 그렇게 하라고 권하지 마라. 중복 후보도 보여주기만 하고 병합하지 마라.」
   - 「`source`가 `legacy-timestamp`인 항목은 배치가 기계 복사한 값이라 실제 갱신 시각이 아니다(실측: 22개 중 4개가 8~10일 어긋났다). 날짜를 그대로 보고하지 말고 '갱신 시각 미상(레거시 timestamp)'이라고 밝혀라.」
   - 「`growth`/`bundleBytes`는 배치가 실제로 청크를 처리한 회차에만 기록된다 — noop·error 회차에는 없다. 없으면 '마지막 배치는 반영할 것이 없었다'로 보고하고 추측하지 마라.」
   **`bin/statusline.mjs`는 건드리지 마라** — 팽창을 억제하려는 패키지가 매 턴 렌더되는 줄에 바이트를 더하는 것은 방향이 반대이고, `:10-12`가 스스로 '매 턴 렌더되므로 파일 내용은 읽지 않는다'고 규정한다.
9. **동결 픽스처 2종.**
   (a) `test/fixtures/bloat/live-shape-2026-07-25.json` — **텍스트 0, 숫자만**: `{ conceptCount: 22, totalBytes: 91029, files: [{ dir, bytes, lines, headings: [{ normalizedKey: 'h1'|'h2'…, count }] }] }`. 제목 원문 대신 익명 키를 쓴다. 이것이 정밀도 주장의 **유일한 CI 근거**다(라이브 실측은 커밋 불가).
   (b) `test/fixtures/exclusion/` — digest 8개 + `expected.json`. 픽스처 역할: `01-grep-answerable`(noop_expected) / `02-decision-with-rejected`(**과다 배제 탐침**) / `03-self-observation`(noop_expected) / `04-repeat-observation`(must_edit + growth_max_bytes 400) / `05-user-policy`(**탐침 — 이게 NO-OP이 되면 배제 규칙이 OKF의 유일한 승리 축을 죽인 것이다**) / `06-mixed`(**탐침 — '사실 단위 판정'의 유일한 픽스처**) / `07-troubleshooting-no-cause`(noop_expected) / `08-real-session`(기존 `sample-transcript.jsonl` 파생, 회귀 앵커). **실행은 하지 않는다** — I6의 유료 축(P-A)이 집행한다. 사용자 대화 복사 금지, 합성 텍스트만.
10. **fake-claude `append-observation` 모드.** `test/fixtures/fake-claude.mjs`의 `switch (mode)`에 case 추가. 워크스페이스 사본의 기존 `## 추가 관측` 수를 세어 다음 번호를 붙이므로 상태 파일이 필요 없다. `path` import는 추가하지 말고 **상대 경로**를 써라(스텁의 cwd가 곧 워크스페이스 루트다 — 이 파일은 `import fs from 'node:fs';` 하나뿐이다). log.md는 건드리지 않는다(계측 제외 로직 검증용).

#### 검증 방법
| 테스트 이름 | 픽스처 | 단언 |
|---|---|---|
| `bloat: normalizeHeading strips trailing enumeration and parenthetical` | 순수 함수 | `'추가 관측 2 (2026-07-16, …)'→'추가 관측'`, `'관측 3회'→'관측'`, `'증상'→'증상'` |
| `bloat: ISO date headings are never collapsed` | 순수 함수 | `'2026-07-16'`/`'2026-07-15'` 불변이고 서로 다르다, `'1'`이 빈 문자열이 아니다 |
| `bloat: repeated headings inside a code fence are not counted` | 본문에 ```` ``` ```` 블록 안 `## x` 4개 | `repeatedHeadingGroups(body).length === 0` |
| `bloat: classifyChange distinguishes created / append-only / edited` | Buffer 3쌍 | kind 각각 `created`/`append-only`/`edited` |
| `bloat: classifyChange ignores frontmatter churn` | prev `timestamp: 2026-07-15` + body `a\n`, next `2026-07-20` + `a\nb\n` | `kind === 'append-only'` — generated 스탬핑이 순수 추가 신호를 영구히 죽이는 회귀를 고정 |
| `bloat: stale entries disclose whether the date came from a legacy timestamp` | `generated` 없는 concept | `stale[0].source === 'legacy-timestamp'` |
| `bloat CLI runs as a subprocess and emits JSON` | `spawnSync(process.execPath, [PLUGIN_ROOT+'/lib/bloat.mjs', home, '--json'])` | `status === 0` 및 `JSON.parse(stdout).conceptCount >= 4`. **`/okf:okf-status`가 의존하는 유일한 경로이고 Windows에서만 깨지는 결함을 이것만이 잡는다** |
| `lint W9 flags an oversized concept body` | `bootstrapped('bloat-lint')` + `decisions/oversize.md`에 `'가'.repeat(12000)`(36,000B) | W9 경고 존재, **같은 파일 errors 0건** |
| `lint W9 leaves the largest known-good concept size alone` | `decisions/normal.md`에 `'x'.repeat(8500)`(라이브 최대 정상값 8,461B 바로 위) | W9 없음 — 오탐 0 회귀 고정. **이 값을 줄이면 회귀 방어력이 사라진다** |
| `lint W10 flags three same-normalized sections` | 정규화 후 동일 헤딩 3개 | W10 정확히 1건(`break` 고정) |
| `lint W10 tolerates two sections that share a heading shape` | 같은 형태 2개 | W10 없음 |
| `seeded bundle produces no W9/W10` | `bootstrapped('bloat-clean')` | 시드 concept에서 W9·W10 각 0건 |
| `bloat rules reproduce the frozen live-shape precision` | (a) 픽스처로 합성한 22-concept 번들 | oversize **정확히 1**, repeated **정확히 1**, 나머지 21개 경고 **0** |
| `bloat warnings never reach the repair prompt` | oversize concept가 있는 번들 + `FAKE_CLAUDE_MODE: 'badoutput'` + `FAKE_CLAUDE_DUMP_PROMPT_TO` | 덤프된 repair 프롬프트에 `'W9'`·`'W10'`·`'W6'` **각 0회**, `'W1'`은 실릴 수 있다. **텍스트 문구가 아니라 프롬프트 표면을 직접 본다** |
| `append-observation: batch counts the edit as append-only growth` | `setupBatchSandbox('append-observation')` + 섹션 2개 심고 배치 1회 | `growth === {appendOnly:1, created:0, edited:0}` |
| `append-observation: recorded bytesAdded matches the actual file growth` | 배치 전후 `statSync().size` | `growth.bytesAdded === after - before` (±0) |
| `a bundle carrying W9/W10 warnings still runs a batch` | 오염 concept를 심은 `setupBatchSandbox` | `lastBatch(home).lastResult === 'ok'`, `errors.length === 0`, `listRaw(home).length === 0` |
| `scanBundle reports duplicate candidates and orphans without merging anything` | 유사 제목 2개 + 고립 1개 | `duplicateCandidates.length === 1`, orphans 포함, **호출 전후 번들 파일 목록·바이트 완전 동일** |
| `nested concepts are covered by the bulk rules` | `decisions/sales/orders.md`(oversize) | W9 발화 — `walkMdFiles`는 재귀하는데 스캐너가 안 하면 두 수치가 갈린다 |
| `ingest prompt keeps the exclusion rules and their safety pins` | `ingestPrompt` | `/코드가 이미 답하는가[\s\S]{0,400}Grep\/Glob\/Read \*\*한 번\*\*/`, `includes('배제되는 것은 **그 사실**이지 digest 전체가 아니다')`, `/OKF 파이프라인 자신을 실행해야 했는가[\s\S]{0,800}okf-system을 개발하며/`, `/N번째 반복 관측은 새 섹션으로 추가하지 마라/`, 6개 카테고리 조건 문자열 전부 |
| `ingest prompt stays within its batch-call byte budget` | `prompts/ingest.md` | `Buffer.byteLength(...) <= 10600`, detail로 실제 바이트. **이 단언이 없어서 계획 자신이 예산을 어긴 것을 아무도 못 잡았다** |
| `SCHEMA template stays within its per-batch read budget` | `templates/SCHEMA.md` | `<= 5600`, 그리고 `includes('# 절대 규칙')` |
| `exclusion fixture set pre-registers over-exclusion probes` | `expected.json` + 디렉토리 | `fixtures.length === digestFiles.length`, `over_exclusion_probe:true` **≥3**, `noop_expected:true` **≥1**, 모든 `must_write[].type`이 6개 택소노미 안 |

프롬프트 단언 블록에는 관용구대로 면책 주석을 단다: **이건 프롬프트 텍스트 단언이며 행동 단언의 프록시다. fake-claude는 저술하지 않으므로 무과금 CI에서 "실제로 덜 쓰는가"는 단언할 수 없다. 산출물 비교는 `test/fixtures/exclusion/expected.json`에 사전등록돼 있고 유료 축이 집행한다.**

#### 통과 규칙
- **정밀도(합성 픽스처 기준)**: 동결된 22-concept live-shape 픽스처에서 W9 **정확히 1건**, W10 **정확히 1건**, 나머지 21개에서 W9·W10 **각 0건**(오탐 0/21). 라이브 번들 수치는 통과 규칙이 아니라 근거 절에 '2026-07-25 1회 관측'으로만 남긴다.
- **무해성**: 갓 부트스트랩된 번들과 합성 픽스처 양쪽에서 이 패키지 적용 전후 **`runLint().errors` 개수 변화 0**. 신규 규칙 중 E 등급 **0개**. 오염 concept를 담은 번들에서 배치가 정지하는 경우 **0건**.
- **repair 누수 0**: 덤프된 repair 프롬프트에 `W6`/`W9`/`W10` **각 0회**. 인자 없는 `formatReport(report)` 출력은 변경 전과 **바이트 동일**(기존 호출부 회귀 0).
- **계측 정확도**: `append-observation` 1회 후 `growth.appendOnly === 1 && created === 0 && edited === 0`이고 `bytesAdded`가 실제 바이트 증가와 **오차 0**.
- **CLI**: `spawnSync`로 `lib/bloat.mjs --json` 실행 시 3-OS 전부 exit 0 + 파싱 가능한 JSON.
- **프롬프트 예산(I5 합산)**: `prompts/ingest.md` **≤ 10,600B**(현행 6,820B), `templates/SCHEMA.md` **≤ 5,600B**(현행 4,271B). 둘 다 스모크가 기계로 잰다.
- **게이트 무영향**: 이 패키지 적용 전후로 카테고리 `index.md` 총 바이트 동일, `bin/session-start.mjs`·`lib/gate.mjs`·`lib/index-gen.mjs`의 diff 라인 수 **0**.
- **설정 표면 무증가**: `Object.keys(DEFAULT_CONFIG).length` 변화 **0**. 임계값 3개는 `lib/bloat.mjs` export 상수로만 존재하고 `grep -rn 'CONCEPT_MAX_BYTES\|REPEAT_HEADING_MIN' lib/`의 히트가 `lib/bloat.mjs`와 그 import 구문에만 있다(이중 정의 0).
- **성능**: concept 500개(각 2KB) 픽스처에서 `scanBundle` 1회 **≤300ms**, `bundleConceptBytes` 1회 **≤50ms**. `grep -rn 'bloat.mjs' bin/statusline.mjs` **0건**.
- **schema 범프**: 저장소 전체에서 릴리스 3의 `schema_version` 범프 **정확히 1회**(2 → 3).
- **사전등록 무결성**: `expected.json`의 `fixtures` 길이 == `.digest.md` 개수, 탐침 ≥3, `noop_expected` ≥1, 택소노미 밖 type **0개**.
- **스모크**: 적용 직전 passed 수 N에 대해 **정확히 N+23 passed, 0 failed**, exit 0. 유료 호출 0회.
- **과다 배제 운영 임계(추가 유료 호출 0)**: 표본 20회차가 모인 뒤 **P-B(NO-OP 비율)가 기준선 대비 +15%p 이상** 상승했거나 **P-C(회차당 신규 concept 중앙값)가 기준선의 50% 미만**이면 프롬프트 변경을 되돌린다. **표본 20 미만인 동안 이 지표로 판단하지 마라**(라이브는 운영 10일차에 ingest 커밋 16회뿐). P-B/P-C는 정상 운영 중 쌓이는 로그·커밋에서만 계산한다 — 지표를 얻으려 배치를 강제 실행하면 그 자체가 유료 호출이다.

#### 선행·롤백
**선행**: **R3**(`applyAnalyzerWorkspace`/`updateLastBatch` 시그니처), **S3a**(`lib/trust.mjs`의 `toIsoDate`/`isPlainObject`), **R4**(W5/W6 코드 선점 확정), **I6**(측정 설계), **I5**(`prompts/ingest.md` 앵커 분리). 전부 릴리스 1·2에 있으므로 릴리스 3 시점에는 충족돼 있다.

**롤백**: 세 층으로 나뉜다.
1. **코드·픽스처 — 완전 가역.** `lib/bloat.mjs` 삭제, `lib/lint.mjs`의 W9/W10 블록과 `body` 파라미터 제거, `buildRepairPrompt` 원복, `bin/batch.mjs`의 growth 누산 제거, 픽스처·스모크 블록 제거. W9/W10은 경고라 어떤 배치도 막지 않았으므로 남는 상태가 없다. **`walkMdFiles` 이동은 별도 커밋으로 분리해 두었으므로 그 커밋만 따로 revert**해야 lint가 깨지지 않는다.
2. **`prompts/ingest.md` — 완전 가역.** 플러그인 파일이라 사용자 번들에 복사되지 않는다. revert 즉시 다음 배치부터 이전 프롬프트가 쓰인다. 그 사이 배치가 쓴 concept는 남지만 이 패키지는 삭제를 하지 않으므로 손실이 없다. 이미 쓰인 `관측: N회 (…)` 줄은 그냥 산문이라 lint·index·게이트 어디에도 영향이 없다.
3. **`templates/SCHEMA.md` — 편도.** `lib/bootstrap.mjs`의 비교가 `<`라 `schema_version`을 되돌려도 사용자 번들의 SCHEMA.md는 v3 문구로 남는다. 복구 경로는 사용자가 번들 저장소에서 `git checkout <bootstrap 이전 커밋> -- SCHEMA.md`뿐이고, **이 안내를 릴리스 노트에 넣어야 롤백이 성립한다.** 배치 산출물에 미치는 영향은 무해하다 — 병합 규칙은 서술일 뿐 어떤 코드도 파싱하지 않는다.
4. **운영 임계 부분 롤백**: P-B/P-C가 임계를 넘으면 전체가 아니라 **카테고리 조건 중 troubleshooting('원인 미규명이면 쓰지 마라')과 decision('기각 대안 1개 이상')을 먼저 완화**하라 — 이 둘이 실사용 대화에서 가장 자주 미충족이고, 배제 4문항은 v3 벤치마크가 직접 뒷받침하는 축이라 마지막에 되돌린다.

---

### I2 — 관련성 라우팅 (구현하되 기본 OFF. 기본값 전환은 I6 조건 충족 시에만)

#### 목표
게이트가 지금 한 번도 계산하지 않는 "관련성"을 결정론적·무LLM·무추가I/O로 계산해, **카테고리 내부의** 주입 순서를 현재 세션의 맥락(cwd / git remote / 브랜치)에 맞춰 재정렬한다. 카테고리 간 round-robin(공정성 층)은 그대로 둔다 — 이 분리가 `§5 항목 15(b)`가 경고한 "라우팅이 OKF의 유일한 구조적 차별점(cwd와 무관한 patterns/troubleshooting 지식)을 스스로 차단하는 방향으로 튜닝되는 것"을 **구조적으로** 막는다. 신호가 없거나 전부 약하면 현행 출력과 **바이트 단위로 동일**하게 폴백한다.

#### 근거 — 그리고 이 항목의 근거가 약하다는 사실
T7.1, T7.2(`bin/session-start.mjs` 177줄에 cwd·프로젝트 식별자·최신성·빈도 참조 **0건**. 유일한 순서 결정자는 round-robin + 파일명 사전순이고, 그 결과 7월 25일 갱신된 현재 진행 프로젝트 `/projects/okf-system.md`(283B)가 **항상 배제된다**), T3.2(references 슬롯 2/2를 지식가치 0 확정 묘비가 점유). `§6`은 이 재설계를 v0.2에서 **명시적으로 제외**했다.

**이 계획이 직접 실행한 읽기 전용 실측**:
1. 현행 알고리즘 재현 성공 — 12/22 주입으로 T7.1과 완전 일치.
2. **index.md 줄 텍스트만으로 점수를 매기는 방식(추가 파일 I/O 0)이, 프론트매터 `tags`를 읽는 방식(파일 22개 추가 read)과 동일한 순위를 낸다.** → 프론트매터 읽기는 불필요하다(전역 Rule 2).
3. **그러나 이득이 작다.** cwd=프로젝트A → 12/22(순득 0), cwd=프로젝트B → 12/22(순득 0), cwd=okf-system → 13/22(**순득 concept 1개**). 실제 cwd 3종 중 2종에서 이득이 0이다. (저자 머신의 실제 프로젝트 디렉토리 3개로 측정했고, okf-system 외 두 개는 이름만 익명화했다.) **그리고 그 2종에서도 `maxScore ≥ 4`라 재정렬은 일어난다 — 출력은 baseline과 다르다.** '순득 0'과 '무변화'는 다른 말이다.
4. **관측된 이득의 대부분은 라우팅이 아니라 은퇴에 귀속된다.** 묘비 2건에 `status: deprecated`만 적용하고 round-robin을 그대로 두면 **14/20**이 된다 — 라우팅 단독(13/22)보다 낫다. 같은 문제를 더 싸게 푸는 수단이 이미 릴리스 2(S4)에 있다.
5. 라우팅의 값이 나타나는 구간은 큰 번들이다(N=110/220 복제에서 'okf 관련' 주입이 4→8). **단 이 복제는 합성이며 측정이 아니다.**

**정직한 결론**: N=22에서 round-robin보다 낫다는 근거는 concept 1개, 3개 cwd 중 1개뿐이다. **이 크기에서는 켤 이유가 없다.** 라우팅이 의미를 갖는 구간은 아무도 측정한 적이 없다(v3 리포트 자신이 "게이트 캡에 도달한 레벨: 없음"이라 적었다). **I6 없이 기본 활성으로 배포하면 v2 '비용 곡선' 철회의 정확한 반복이다.** 그래서 이 패키지는 "구현하되 기본값 off, 전환은 사전등록 수치 조건에 종속"으로만 승인 요청한다.

**의도적으로 채택하지 않은 신호(전부 근거 있음)**: (a) `generated.at`/`timestamp` 최신성 — 라이브 22개 중 4개(18%)의 timestamp가 8~10일 틀렸다. **알려진 오염 데이터 위에 축출 순서를 세우면 안 된다.** (b) `resource`/`tags` — 실측 2번이 index 줄 텍스트로 같은 결과를 냈고 N개 파일 추가 open은 매 세션 비용이다. (c) 최근 수정 파일 스캔 — 대형 monorepo에서 15초 훅 예산을 위협한다. (d) `status` — 게이트가 아니라 `lib/index-gen.mjs`가 처리한다(S4). (e) 사용 빈도 — 기록하는 코드도 저장소도 없다.

#### 구현 방안
- **1단계는 blocking 선행조건이다.** SessionStart stdin에 `cwd`가 오는지 확정하고, 결과에 따라 두 갈래 중 하나로 설계가 **미리** 결정돼 있어야 한다.
- `readFileSync(0)`은 이 서브시스템의 절대 규칙("훅은 절대 세션 시작을 막지 않는다")을 깰 수 있는 유일한 신규 지점이다. **stdin 읽기를 1순위에서 내리고 조건부로 만든다.**
- 안전판은 **전역**이어야 한다. 카테고리별로 폴백을 판정하면 한 카테고리의 약한 오탐만으로 그 카테고리만 재정렬되어 '신호 없음'인데 출력이 달라진다.
- 마커 바이트 증가분은 **하드코딩하지 말고 실제 문자열에서 계산**한다.

#### 구현 방법
1. **입력 확정 프로브(구현 전 필수, 저장소 무수정).** 확정된 사실: `bin/session-start.mjs`는 stdin을 전혀 읽지 않는다(`grep -rn 'stdin' bin/ hooks/ lib/` 히트 0). `test/smoke.mjs:80`의 `runHook`은 이미 `execFileSync(..., { input: stdin })`로 페이로드를 넘긴다.
   미확정 3개를 `~/.claude/settings.json`에 임시 훅 1회 등록으로 확정한다: (i) stdin JSON에 `cwd`가 오는가, (ii) `CLAUDE_PROJECT_DIR`이 설정되는가, (iii) 훅의 `process.cwd()`가 프로젝트 루트인가. 결과를 `lib/route-signals.mjs` 상단에 실측 주석으로 남긴다.
   **두 갈래를 미리 확정한다**: payload에 `cwd`가 **있으면** 폴백 체인 `payload.cwd → CLAUDE_PROJECT_DIR → process.cwd()`, **없으면 `readHookPayload`를 아예 삭제**하고 env/cwd 경로만 남긴다. 프로브 결과가 어느 쪽이든 설계가 결정되게 하는 것이 이 단계의 목적이다.
   **완료 조건에 `rm -rf /tmp/okf-probe`가 포함된다** — 페이로드에 `transcript_path`(전사 절대경로)가 들어 있을 가능성이 높다. 얻은 값을 로그·번들·커밋 메시지에 붙여넣지 마라.
2. **`lib/route-signals.mjs` 신설** — 서브프로세스 0개, concept 파일 읽기 0개.
   - `tokenize(str)`: 소문자화 → `/[^a-z0-9]+/` 분할 → 길이 ≥3 && `STOP_TOKENS`에 없는 것. `STOP_TOKENS`에 `claude`/`worktrees`를 넣는다 — 이 저장소의 개발 경로 `.claude/worktrees/okf-v02-feature`가 그대로 신호가 되면 OKF 자기 문서만 뽑히는 자기참조가 생긴다.
   - **홈 디렉토리 절단**(실측으로 발견한 오탐 원인): cwd 토큰에 사용자명이 남으면, description에 우연히 홈 경로가 실린 concept가 무관한 cwd에서도 점수를 얻는다. `pathTokens(absPath)`는 홈 이하 상대경로만 토큰화한다.
   - `readGitSignals(root)`: `.git`이 디렉토리면 그대로, 파일이면 `gitdir:` 한 줄을 읽고 `commondir`로 공용 `.git`을 찾는다(**워크트리 대응 — 이 저장소 자신의 개발 형태다**). HEAD에서 브랜치, `config`의 `[remote "origin"]`에서 url. origin이 없으면 빈 문자열 폴백. 섹션 경계를 `(?=\n\[|$)`로 좁혀 `[remote "upstream"]`이 먼저 오는 config에서 오매치를 막는다.
   - `collectSignals({ cwdOverride } = {})`: `base`(강한 신호: cwd basename + remote repo 이름)와 `wide`(약한 신호: 경로 나머지 + 브랜치)를 분리해 반환. **`cwdOverride`가 주어지면 stdin을 읽지 않는다** — I6 재생 하니스가 같은 프로세스에서 수십 번 호출할 때 stdin을 소진하지 않게 하는 계약이다.
   - 환경변수 폴백은 **빈 문자열을 신호로 취급하지 않는다**: `typeof process.env.CLAUDE_PROJECT_DIR === 'string' && process.env.CLAUDE_PROJECT_DIR !== '' ? … : ''`.
3. **`lib/route-rank.mjs` 신설** — index.md 줄 텍스트만 입력. 배점(라이브에서 조정): 링크 경로에 `base` 토큰 → **+4** / 제목+설명에 `base` 토큰 히트당 +2, 최대 2회 / `wide` 토큰 히트당 +1, 최대 2회. 상한이 없으면 긴 description이 자동으로 이긴다.
   ```js
   export const STRONG_MATCH_SCORE = 4;

   export function rankCategories(cats, signals, tokenize) {
     const scored = cats.map((c) => c.items.map((item, i) => ({
       item, i, score: scoreIndexItem(item, signals, tokenize),
     })));
     const maxScore = scored.reduce((m, arr) => arr.reduce((n, x) => Math.max(n, x.score), m), 0);
     // 안전판은 전역이다. 카테고리별로 판정하면 한 카테고리의 약한 오탐(s=1)만으로
     // 그 카테고리만 재정렬되어 '신호 없음'인데 출력이 달라진다.
     if (maxScore < STRONG_MATCH_SCORE) return { routed: false, maxScore };
     cats.forEach((c, ci) => {
       const arr = scored[ci];
       arr.sort((a, b) => b.score - a.score || a.i - b.i);  // 동점은 사전순 유지(폴백 계약의 코드적 근거)
       c.items = arr.map((x) => x.item);
     });
     return { routed: true, maxScore };
   }
   ```
   **입력은 I3의 `c.items`(`{lead, desc}`)다** — `c.lines`가 아니다(C1). 점수 계산 입력은 `item.lead + ': ' + item.desc`로 원본 index 줄과 동일하게 만든다. `Array.prototype.sort`가 Node 11+에서 안정 정렬이라도 `|| a.i - b.i` 타이브레이크를 반드시 넣어라. 이 모듈은 `lib/frontmatter.mjs`를 import하지 않는다 — 그것이 '추가 I/O 0' 계약의 코드적 증거이고 소스 검사로 고정된다.
4. **배선.** `lib/gate.mjs`의 `buildInjectedIndex` 시그니처에 `signals = null`을 추가하고, `cats` 구성 직후 `const routing = signals ? rankCategories(cats, signals, tokenize) : { routed: false, maxScore: 0 };`. **round-robin 층은 건드리지 않는다.** `bin/session-start.mjs`의 `main()`에서:
   ```js
   // 라우팅은 기본 off다. E1(게이트 recall@cap) 사전등록 측정이 통과하기 전까지 기본 활성으로
   // 바꾸지 않는다 — 근거 없는 게이트 튜닝은 v2 '비용 곡선' 철회의 반복이다(reliability §6).
   let signals = null;
   if (config.inject_routing) {
     try { signals = collectSignals(); } catch { signals = null; }  // 신호 실패는 라우팅 포기이지 게이트 포기가 아니다
   }
   ```
   **게이트 head는 바이트를 늘리지 않는다** — 라우팅 ON에서도 규칙 문구를 추가하지 마라(head는 I5 소유이며 예산이 곧 concept다).
5. **설정 키 `inject_routing` — 동기화 표면 7곳 전부.** ① `lib/config.mjs`의 `DEFAULT_CONFIG`에 `inject_routing: false` ② `VALIDATORS`에 `(v) => typeof v === 'boolean'` ③ `templates/config.md` frontmatter ④ `commands/okf-config.md`의 **키 설명 절과 안전 범위 절 양쪽** ⑤ `docs/USAGE.md` 표 ⑥ README **8종**(표형 3종은 행 추가, 산문형 5종은 문단에 키:기본값 나열 — 산문형은 grep 히트가 1줄뿐이라 누락이 리뷰에서 안 보인다. `seed_language`가 8종 전부에서 누락된 전례가 있다) ⑦ **`test/smoke.mjs`의 invalid-config 픽스처에 `inject_routing: 'maybe'`를 반드시 넣어라** — `warnings.length >= Object.keys(DEFAULT_CONFIG).length` 단언이 등호 경계라 키만 추가하고 픽스처를 안 고치면 즉시 빨개진다.
6. **생략 마커와의 결합 — 예산 선차감 안에서.** 라우팅 ON일 때 마커 문구에 `위가 현재 작업 관련성 순, `를 넣는다. **이 문자열은 UTF-8로 38바이트다(24가 아니다 — 한글 11자×3 + ASCII 5).** R5가 도입한 환급식 선차감의 마커 비용을 **하드코딩하지 말고 실제 문자열에서 계산**하라: `Buffer.byteLength(markerFor(c, c.items.length), 'utf8')`. 상수로 고정하면 카테고리 6개 기준 84B가 과소 예약되어 `truncateUtf8Bytes`가 다시 물고 그 손실은 전부 log.md tail이다.
   **재정렬은 주입에만 적용하고 디스크 `index.md`는 사전순 그대로 둔다.** 이유 셋: (i) `lib/index-gen.mjs`가 유일한 생성자라는 계약이 깨지면 배치·lint·게이트가 서로 다른 정본을 본다, (ii) cwd마다 다른 순서로 재작성하면 매 세션 번들이 dirty가 되어 유실 백스톱이 영구 무력화된다, (iii) 디스크가 사전순이라는 사실이 곧 '내려가면 다른 순서의 전체 목록이 있다'는 점진적 공개의 실질이다.
7. **프라이버시.** 신호를 stderr에 찍고 싶은 유혹이 생긴다 — **금지다.** 필요하면 개수만 남겨라(`[okf gate] routing: 2 signals, max score 9`). 마커 문구에 cwd나 저장소 이름을 절대 넣지 마라 — 게이트는 `suppressOutput: true`로 나가지만 그 내용은 모델 컨텍스트이고 프라이버시 표면이 하나 는다.

#### 검증 방법
| 테스트 이름 | 픽스처 | 단언 |
|---|---|---|
| `routing is off by default and leaves the injected gate byte-identical` | `bootstrapped('routing-default')` + concept 6개(하나는 `z-payload-repo.md`로 사전순 마지막) | 키 미설정 상태와 `inject_routing: false` 상태의 `additionalContext`가 `Buffer.compare` 0 |
| `routing surfaces the concept whose path matches the session cwd` | 같은 홈 + `inject_routing: true` + `inject_max_bytes: 1500` | OFF에는 대상 title이 **없고** ON에는 **있다**. T7.2의 '현재 진행 프로젝트가 항상 배제된다'의 회귀 테스트 |
| `routing falls back to the current order byte-for-byte when no signal matches` | cwd `/tmp/zz-no-match-here` | `Buffer.compare(on, off) === 0` |
| `routing never reorders on a weak-only match` | `rankCategories` 직접 호출, `base:{'nomatch'}` / `wide:{'shared'}` | `routed === false && maxScore < 4` 및 원래 순서 유지 |
| `routing reads cwd from the SessionStart payload, not the hook process cwd` | stdin `{cwd: '<sandbox>/payload-repo'}` | 주입된 줄이 `payload-repo-note`이고 `okf-system-note`가 아니다. 프로브에서 payload에 `cwd`가 없다고 확정되면 `CLAUDE_PROJECT_DIR` env 버전으로 바꾼다 |
| `the gate output does not depend on an inherited CLAUDE_PROJECT_DIR` | 같은 홈, `env: { CLAUDE_PROJECT_DIR: '' }` vs 미설정 | 두 출력의 sha256 동일. **`runHook`이 자식 env를 `{...process.env}`로 만들므로 Claude Code 안에서 스모크를 돌리는 개발자에게는 그 값이 상속된다** — 이 단언 없이는 CI와 로컬이 다르게 동작한다 |
| `a malformed hook payload never costs the gate` | stdin `'not json at all'` 및 `''` | 두 경우 모두 `ctx.includes('OKF KNOWLEDGE GATE')`, exit 0, OFF 출력과 바이트 동일 |
| `routing works in a repo without .git and in a linked worktree` | (a) `.git` 없는 디렉토리 (b) `.git` **파일** + `gitdir:` + `commondir` + 공용 `config` | (a) 정상 출력, (b) `readGitSignals`가 `{remote:'https://github.com/acme/payload-repo.git', branch:'feat/routing'}` |
| `routing never spawns a subprocess and never opens a concept file` | 두 모듈 소스 | `!/child_process\|execFileSync\|execSync\|spawn/.test(src)` 및 `route-rank.mjs`에 `readFileSync`·`frontmatter` 0회 |
| `routing output is deterministic across repeated hook runs` | 동일 stdin으로 5회 | 5회 출력 전부 동일 |
| `routed gate never trips the truncation safety net` | 생략 카테고리 0·3·6개 × on/off 6조합, 마커 문구가 길어진 상태 | 전부 `stats.truncatedBytes === 0 && stats.cappedLines === 0` — 6단계의 38B 증가분이 선차감됐다는 증거 |
| `routing does not shrink the injected set when a long line ranks first` | 관련성 1위가 **가장 긴 설명 줄**인 픽스처 | ON의 주입 concept 수가 OFF 대비 **−1 이내**. 짧은 줄 픽스처만으로는 이 실패 모드를 절대 재현하지 못한다 |
| `routing does not echo cwd or git remote into logs or state` | cwd 토큰 `zzsecretrepo`, `readIfExists`로 감싼 로그 결합 | `!combined.includes('zzsecretrepo') && !combined.includes('github.com')`. **`fs.readdirSync`를 직접 부르지 마라** — 디렉토리가 비어 있거나 없으면 `ok()`가 조건식 평가 중 throw해 스위트 전체가 죽는다 |
| `invalid config falls back safely: inject_routing` | invalid-config 픽스처에 `'maybe'` 추가 | `config.inject_routing === false`. `Object.keys(DEFAULT_CONFIG)` 루프가 자동 생성 |

#### 통과 규칙
- **폴백 동치**: `inject_routing: true`이고 최대 점수 < 4인 cwd 픽스처 **20종 전부**에서 `additionalContext`가 OFF 출력과 SHA-256 **20/20 일치**, 불일치 0건. `CLAUDE_PROJECT_DIR` 설정 유무에 관계없이 동일.
- **결정론**: 동일 (번들, 페이로드, git 상태)로 10회 실행 → SHA-256 **10/10 일치**.
- **성능**: 500 concept 번들에서 실행 시간 중앙값(5회)이 OFF 대비 **CI 단언 +150ms 이하**(로컬 목표 +15ms, 실측을 PR 본문에). 추가 concept 파일 open **0개**(소스 검사로 고정). 라우팅이 여는 파일은 세션당 **최대 3개**(`<cwd>/.git`, `<gitDir>/HEAD`, `<commonDir>/config`)로 상한 고정.
- **게이트 예산 불변**: 6조합 전부에서 `truncatedBytes` **0B**, `cappedLines` **0줄**.
- **무해성(이득이 아니라 무해를 고정한다)**: live-shape 픽스처(N=22)에서 **cwd 20종 전부에 대해 ON의 주입 concept 수가 OFF 대비 −1개 이내**이고, 감소가 발생한 cwd를 목록으로 기록한다. cwd=`<...>/okf-system`에서는 `/projects/okf-system.md`가 주입에 **포함**되고 주입 수 ≥ 13.
- **프라이버시**: 라우팅 ON 실행 후 `.okf/logs/*` + `.okf/last-batch.json` 합친 문자열에 cwd 토큰과 `github.com` 각 **0회**.
- **스모크**: 적용 직전 passed 수 N에 대해 **정확히 N+15 passed**(신규 explicit 14 + `inject_routing` 자동 생성 1), **0 failed**, 3-OS 전부.
- **기본값 전환 게이트**: §2.x의 5개 조건 **전부** 충족 시에만 `true`로 바꾼다. 하나라도 불성립이면 `false`로 릴리스한다. **"조금 좋아졌다"로 기본값을 바꾸지 않는다.**

#### 선행·롤백
**선행**: **I6**(`lib/gate.mjs` 추출 + 측정), **I3**(`buildInjectedIndex`/`c.items` 소유자 — I3이 먼저 착지하지 않으면 `rankCategories`가 런타임에 `c.lines.map`에서 죽는다), **R5**(예산 회계 — 마커가 38B 늘기 때문).

**롤백**: 3단이며 각각 독립이다.
1. **런타임 즉시 무력화(코드 변경 0줄)**: `.okf/config.md`에서 `inject_routing`을 `false`로 하거나 줄을 지운다. 기본값이 false라 지우는 것으로 충분하다. 다음 세션부터 round-robin으로 복귀하고, 통과 규칙 1(바이트 동치)이 그 복귀가 **출력 수준에서 완전함**을 보장한다. **번들 파일은 하나도 변하지 않는다** — 라우팅은 주입 순서만 바꾸고 디스크 `index.md`를 절대 재작성하지 않는다.
2. **코드 되돌림(부분)**: `main()`의 `signals` 수집 블록(~8줄)과 `buildInjectedIndex` 호출의 `signals` 인자를 제거. 두 모듈은 남겨도 무해하다(죽은 모듈이 되고 `signals = null`로 현행과 동일 동작). 설정 키를 지운다면 **7표면을 같은 커밋에서 전부** 지워야 한다 — 하나라도 남기면 등호 경계가 깨진다.
3. **전체 되돌림**: `git revert`. **I6의 재생 하니스가 `lib/gate.mjs`를 import하고 있으므로** 전체 revert 전에 그 import를 확인하고, 필요하면 2단계를 택하라.
**되돌릴 수 없는 것은 없다.** 이 패키지는 번들 파일·git 이력·`schema_version`·프롬프트·SCHEMA.md를 일절 건드리지 않으며 배치 경로에 코드를 추가하지 않는다(유료 호출 0).

---

### 2.x 승인 조건 — 측정 없이 구현하면 안 되는 것

**이 절이 없어서 이 프로젝트는 두 번 철회했다.** 아래는 전부 사전등록서에 **측정 전에** 커밋되며, 판정은 코드가 JSON에 찍는다(`test/bench-report.mjs:1-16`의 규약). 결과를 본 뒤 유리하게 해석할 여지를 남기지 않는다.

| 항목 | 승인 조건 (I6 산출 지표) | 미충족 시 |
|---|---|---|
| **I2 기본값 `inject_routing: true`** | **5개 전부**: (a) R1 미발화, (b) `recall(50) < 0.90`, (c) 라우팅 적용 후 **같은 하니스·같은 질문·같은 시드**에서 `recall(50)` 절대 **+0.20 이상**, (d) `cwdIndependent` 부분집합 recall **감소 0pp**, (e) `truncatedBytes = 0` 유지 | `false` 유지, 실험 플래그로만 존속. **R1 발화 시 v0.3에서도 착수하지 않는다** — "라우팅은 병목이 아니다"를 그대로 발행하는 것이 성공이다 |
| **I3 `INDEX_TWO_LAYER = true`** | **3개 전부**: (a) I6 정답률이 현행 대비 **하락 0**, (b) **설명 보유 주입 줄 수가 현행 이상**(실측: cap=0에서 13→10으로 감소한다 — 이 조건이 자물쇠다), (c) `/preferences/rust-msrv-freeze-policy.md` 유형(설명 1,009B, 예외가 문장 뒤쪽)에서 예외 2건 질문의 정답률 하락 0 | `false` 유지. step 1·2만으로 이미 순개선이다(전량 설명 + 절단 0B) |
| **I-M 배제 규칙 강도** (특히 troubleshooting "원인 미규명이면 쓰지 마라", decision "기각 대안 1개 이상") | **P-A**(유료, v0.3): `over_exclusion_probe: true` 픽스처 3개(02·05·06)에서 NO-OP **0개**. **P-B**(무료): NO-OP 비율이 기준선 20회차 대비 **+15%p 미만**. **P-C**(무료): 회차당 신규 concept 중앙값이 기준선의 **50% 이상**. **표본 20 미만이면 P-A만이 판정 근거** | troubleshooting·decision 조건을 **먼저** 완화한다(실사용 대화에서 가장 자주 미충족). 배제 4문항 본체는 v3 벤치가 직접 뒷받침하므로 마지막에 되돌린다 |
| **I-M lint 임계값**(12,000B / 반복 3) | 동결 합성 픽스처에서 oversize **정확히 1**, repeated **정확히 1**, 나머지 21개 오탐 **0** | 임계 조정 후 재측정. 라이브 실측은 커밋 불가이므로 **합성 픽스처가 유일한 CI 근거** |
| **I5 규칙 3 추가** | 측정 불필요(계약 통일). 단 **live-shape에서 주입 concept 수 변화 0, 절단 0B**를 기계로 확인 | 압축 흡수 실패 시(고정부 > 620B) 규칙 3만 제거 |
| **게이트 선택 정책 일반**(정렬·축출·관련성) | **E1 발행 전 어떤 정책 변경도 금지.** 릴리스 1·2는 회귀 수정만(R5) | — |

**유료 축은 전부 v0.3 이후, 각자 별도 사전등록.**

| 후보 | 무엇을 재는가 | 규모·추정 | 실행 조건 |
|---|---|---|---|
| **P-A** recall → 정답률 전이 | 정답 concept 줄이 캡을 통과하느냐만 다른 2아암 | 질문 8 × 2아암 × n=15 = 240세션 ≈ **$28** | $0 축 발행 완료 **AND** `recall(50) < 0.90` **AND** 비교할 구현이 실재 |
| **P-B** 줄로 답하기 vs 강제 Read | T7.5의 두 규범 중 어느 쪽이 정확한가(**한 번도 잰 적 없다**) | 질문 8 × 2아암 × n=10 = 160세션 ≈ **$17** | 동일 |

**금지 축(재탕)**: 번들 크기 대비 비용 / 체인 누적 효과 / 같은 저장소 OKF vs CLAUDE.md 재측정 / v3·v4 재실행. 이미 $151을 썼고 결론은 각각 '반증' 또는 '분리 안 됨'이다.

**측정 한계를 산출물에 명시할 것**: 프롬프트 diff가 모델 산출을 실제로 바꾸는지는 유료 호출 없이 확인 불가하다(fake-claude는 고정 응답을 낼 뿐 개념을 저술하지 않는다). 무료 축이 보장하는 것은 **"규칙이 프롬프트에 살아 있고, 코드 백스톱이 알려진 오염 형태를 정확히 N건 잡고, 사전등록에 과다 배제 탐침이 실제로 들어 있다"**까지다.

---

### 2.y 롤백 트리거

각 지표는 **이 계획이 만든 하니스(`stats`, `recall`, `growth`)나 기존 스모크가 기계적으로 산출하는 값**이다. '느낌'으로 쓰면 아무도 발동시키지 않는다.

| 항목 | 지표 (산출 주체) | 요구 방향 | 롤백 트리거 | 되돌리는 법 |
|---|---|---|---|---|
| **I6** `lib/gate.mjs` 추출 | 훅 서브프로세스 출력 vs `buildContext` 산출 | 바이트 동일 | drift 1건 | 커밋 revert(순수 이동, 단일 파일) |
| **I6** 계측 | `stats.*` | 게이트 출력 불변 | `buildContext(a)` ≠ `buildContext(a, {})` | `if (stats)` 블록만 제거 — 게이트는 그대로, 하니스만 죽는다 |
| **I6** 측정 자체 | 캘리브레이션 5값 / 표준편차 | 오차 0 / ≤0.25 | R5 발화(캘리브레이션 불일치) 또는 R4 발화 | **전 결과 무효 선언.** 리포트를 지우지 말고 사전등록서 '사후 수정 기록'에 이유와 날짜를 남긴다 |
| **I5** 게이트 head | `buildGateHead('')` 바이트 / live-shape `stats.taken` | ≤620B / 변화 0 | 고정부 >620B 또는 taken 감소 1건 | `GATE_RULES`에서 `feedback` 항목 제거 **+ SKILL.md의 같은 줄 동시 제거**(한 쌍) |
| **I5** 정정 수신 | 정정으로 Edit된 concept의 오탐 건수(사람 리뷰 + P-A) | 오탐 0 | 근거 없는 정정이 반영된 사건 **1건** | `prompts/ingest.md` bullet 3줄 제거. 오염 concept는 `git -C <OKF_HOME> revert <청크 커밋>` |
| **I3** tail 캡 | `stats.tailBytes` / `truncatedBytes` | ≤631B / 0B | 어떤 픽스처에서든 `truncatedBytes > 0` | `TAIL_MAX_BYTES = Infinity`(상수 한 줄, 긴급 완화) |
| **I3** 2층 배급 | **설명 보유 주입 줄 수** | 현행 이상 | ON이 OFF보다 **1줄이라도 적으면** | `INDEX_TWO_LAYER = false`. **`INDEX_DESC_CAP_BYTES = 0`은 롤백 레버가 아니다** — 절단만 끄고 생략은 남겨 더 나쁜 상태를 고정한다 |
| **I-M** 배제 규칙 | P-B(NO-OP 비율), P-C(회차당 신규 concept 중앙값) | +15%p 미만 / 50% 이상 | 표본 20회차 이후 어느 하나라도 위반 | troubleshooting·decision 조건 **먼저** 완화 → 그래도 안 되면 카테고리 조건 전체 → 배제 4문항은 **마지막** |
| **I-M** lint W9/W10 | 합성 픽스처 오탐 수 / 배치 정지 수 | 0 / 0 | 오탐 1건 또는 배치 정지 1건 | 임계 상향 후 재측정. 정지가 났다면 **즉시** 해당 규칙 제거(W가 E로 새는 경로가 있다는 뜻) |
| **I-M** repair 필터 | 덤프된 repair 프롬프트의 `W6\|W9\|W10` 출현 수 | 0회 | 1회 | `buildRepairPrompt`의 `SPLIT_RULES` 확장(코드 한 줄) |
| **I-M** 계측 | `growth.bytesAdded` vs 실제 파일 증가 | 오차 0 | 오차 1B | 누산 지점을 커밋 분기 직전으로 되돌린다(이중 계상 = 잘못된 호출부에서 합산했다는 뜻) |
| **I-M** SCHEMA v3 | 릴리스당 `schema_version` 범프 횟수 | 정확히 1 | 2회 이상 | **되돌릴 수 없다.** 사용자에게 `git checkout <이전커밋> -- SCHEMA.md` 안내(릴리스 노트 필수) |
| **I2** 라우팅 | `recall(50)`, `recallCwdIndependent`, 시드 표준편차, 주입 concept 수 | +0.20↑ / 감소 0pp / 개선 전 이하 / −1 이내 | 승인 조건 (c)(d) 중 하나라도 불충족, 또는 표준편차가 개선 전보다 큼 | `.okf/config.md`에서 `inject_routing: false`(코드 변경 0줄) |
| **I2** 프라이버시 | 로그·상태 파일의 cwd/remote 토큰 출현 | 0회 | 1회 | 즉시 해당 로그 줄 제거 + 릴리스 회수 |

**전역 폐기 목록 준수(계획 완료 시 grep으로 판정)**: `stale_after` 자동 부여 **0** / 배치의 `verified` 자기 서명 **0** / `sources` 강제 **0** / 기존 concept 프론트매터 일괄 변환 **0** / Attested Computation 생산 **0** / 반증된 벤치마크 축 재실행 **0** / `grep -rn "stale_after" prompts templates skills commands` → **0**.

**Part 2 완료 판정(전부 기계 판정)**
1. `docs/benchmarks/pre-registration-2026-07-25-e1.md`가 리포트보다 **앞선 커밋**에 존재하고, R1~R5 판정이 코드가 찍은 값이며, **결론이 예측과 달라도 그대로 발행됐다.**
2. live-shape 픽스처에서 주입 concept 수 **≥13**(계획 착수 전 12), `truncatedBytes` **0B**, `cappedLines` **0줄**, 최종 바이트 **≤9,000**.
3. 게이트 고정비 **≤1,500B**(착수 전 2,264B), tail 편차 **3.9배 → 1.0배**.
4. 합성 22-concept 픽스처에서 팽창 규칙 적중 **2/2**, 오탐 **0/21**. 갓 시드된 번들에서 W9·W10 **0건**.
5. `GATE_RULES` 3/3이 SKILL.md에 문자 그대로 존재하고, `lib/gate.mjs`에 게이트 배너 리터럴 **0회**.
6. 라이브 번들에 대해 착수 전/후 `node lib/lint.mjs` **errors 개수 변화 0**, 배치 정지·청크 롤백·추가 유료 repair 호출 **0회**. (측정 시 **번들을 복사하지 마라** — `git worktree`로 코드만 두 벌 확보해 같은 번들 경로를 두 CLI에 넘기고 stdout을 비교한다. `raw/`·`_remove_candidate/`에는 사용자 대화 원문이 있고 `cp -R`은 그것을 0755 디렉토리에 노출시킨다. 실행 전후 `git -C "$OKF_LIVE" status --porcelain`이 0바이트여야 한다.)
7. Part 2 전체가 추가한 **유료 LLM 호출 0회**, `OKF_RUN_LIVE_BENCH=1` 실행 **0회**, 회차당 유료 호출 상한 4회 불변.