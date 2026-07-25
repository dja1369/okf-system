# okf v0.2 조사 리포트 (최종)

**작성일** 2026-07-25 · **대상** okf-system 0.1.6 · **근거 코드** `/Users/ducksu/side_project/okf-system/.claude/worktrees/okf-v02-research` (이하 `<WT>`) · **관찰 대상 실번들** `/Users/ducksu/.claude/okf` (읽기 전용) · **조사 방식** 읽기 전용. 유료 벤치마크 미실행, 스모크 미실행

---

## 1. 결론

**v0.2는 okf-system을 더 좋게 만드는 릴리스가 아니라, 이미 문서로 한 약속을 코드가 지키게 만드는 릴리스다.**

조사에서 나온 것은 기능 부족이 아니었다. 프라이버시를 약속했는데 설치 버튼 한 번으로 지난 7일치 전 프로젝트 대화가 유료 LLM으로 나가고(`<WT>/bin/batch.mjs:17,259`), 유일한 옵트아웃인 `capture_exclude_cwd`는 제외 루트 자신을 못 막는다(`<WT>/lib/glob.mjs:5-26`, 실행 검증). 손실 없는 축적을 약속했는데 YAML 절단으로 concept 22개 중 2개의 description이 조용히 잘렸고 digest는 중간 38%를 말없이 버렸다. 되돌릴 수단이 없어 벤치마크 픽스처 4개가 사용자 preference로 굳었고, 배치는 크래시 후 8일간 statusline이 정상으로 보이는 채로 멈춰 있었다.

여기에 초안이 놓친 두 축이 추가된다.

**첫째, 돈이 보이지 않는다.** Claude CLI는 `--output-format json`으로 회차별 `total_cost_usd`를 이미 무료로 돌려주는데, `runClaude`가 그 값을 벤치마크 전용 환경변수 게이트 안에서만 파일로 흘리고 호출자에게는 버린다(`<WT>/bin/batch.mjs:637,665`). 그래서 로그·`last-batch.json`·statusline·`/okf:okf-status` 어디에도 지출이 없다(라이브 로그 5개 263줄에 cost/usd/token 문자열 0건). 더 나쁜 것은 상한이다 — `batch_interval_hours` 게이트는 spawn 시점(`<WT>/lib/batch-gate.mjs:28`)에만 있고 링거 루프가 반복 호출하는 `runBatch()` 내부에는 간격 검사가 아예 없어(`<WT>/bin/batch.mjs:910-1030,1050-1069`), 8시간 링거 안에서 5분 폴링마다 유료 회차가 재발화할 수 있고 달러 천장은 존재하지 않는다. 실측 기준점은 이미 저장소 안에 있다 — v4 체인의 실제 배치 60회 비용 중앙값 $0.4423/회.

**둘째, 산출물의 언어를 정하는 규칙이 아예 없다.** 게이트 텍스트만 한국어인 게 아니다. `prompts/ingest.md`(82줄)·`prompts/repair.md`(22줄)·`templates/SCHEMA.md`(68줄) 전문이 한국어이고, 세 파일 어디에도 "어떤 언어로 concept를 쓸 것인가"를 규정한 문장이 0건이다. 언어는 지시가 아니라 프롬프트 문체로 암묵 상속된다.

그래서 v0.2의 판정 기준은 하나다 — **v0.2 이후 사용자가 "뭔가 이상하다"고 느꼈을 때, 무슨 일이 일어났는지(그리고 얼마를 썼는지) 로그와 `/okf:okf-status`만으로 알 수 있고 되돌릴 수 있어야 한다.** 게이트 관련성 라우팅, OKF 스펙 v0.2 전면 마이그레이션, 서브에이전트 수집은 전부 v0.2에서 뺀다. 그것들은 새 약속이고, 그 마이그레이션을 실행할 배치·락·롤백 경로가 지금 신뢰할 수 없다.

**그리고 이 릴리스의 사용자는 아직 저자 본인이다.** 채택 실측(2026-07-25 GitHub API)은 star 1 · fork 0 · watcher 0 · release 0 · 외부 issue 0 · 외부 PR 0이며, clone unique 102는 저장소 생성 이틀에 100% 몰린 스파이크다(최근 주 clone 2회/unique 2). 따라서 릴리스 커트라인은 "사용자 수"가 아니라 **"저자 1인 도그푸딩에서 반증 가능한가"**로 잡아야 한다.

---

## 2. "okf v0.2"의 두 가지 해석

### (a) OKF 스펙 자체의 v0.2 — 나왔다. 2026-07-24, 조사 하루 전.

| 항목 | 값 |
|---|---|
| 선언 | SPEC.md §12 "This document specifies OKF version 0.2" |
| 커밋 | `780fe9d` — *okf: migrate format and tooling to Open Knowledge Format v0.2 (#227)*, 2026-07-24 머지 (이후 `3fcbb9f` "Update SPEC.md" 1건) |
| 원문 | https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md |
| PR | https://github.com/GoogleCloudPlatform/knowledge-catalog/pull/227 |
| 이력 | https://github.com/GoogleCloudPlatform/knowledge-catalog/commits/main/okf/SPEC.md |

**확인 방법과 시점**: 2026-07-25에 저장소 원문·커밋 이력·PR을 직접 조회하고, SPEC.md를 두 번 독립적으로 재조회해 교차 확인했다. 웹 검색으로는 확인 불가다 — 발표 후 하루밖에 지나지 않아 2차 매체는 전부 아직 v0.1만 다룬다. 재확인 방법은 위 SPEC.md 원문의 §12를 읽는 것뿐이다.

**변경 내용**: breaking 2건 — (1) `timestamp` → `generated.at`(§5.2), (2) 본문 `# Citations` → frontmatter `sources`. additive 4계열 — `sources`/`usage_window`, `generated`/`verified` + 신뢰 등급(§5.2-5.3), `status`/`stale_after`(§5.4-5.5), `Attested Computation` 타입 + actor 규약(§7,§10).

**우리에게 무슨 뜻인가**: PR #227이 명시적으로 하위호환을 보장한다 — *"v0.1 bundles remain valid v0.2 bundles"*. §11 conformance 조건, 예약 파일명, 필수 `type`, index/log 규칙은 v0.1과 동일하고, §11은 "깨진 링크·미지 type·선택 필드 누락"을 이유로 번들을 거부하는 것을 MUST NOT으로 금지한다. **현재 번들은 부적합이 아니다. 긴급 장애가 아니다.** 정확히는 v0.1 방언에 고정된 채 v0.2 기능을 하나도 안 쓰는 상태이며, 코드가 그 고정을 능동적으로 재생산하고 있다(T10).

한 가지 예외가 이번 조사에서 새로 드러났다 — **§5.4의 `status: draft|stable|deprecated`는 v0.2의 "마이그레이션"이 아니라 "부재 시 stable"로 해석되는 additive 필드이며, 이것이 v0.2 스코프에서 유일하게 필요한 스펙 요소다**(T3·T10.7 참조).

### (b) 이 플러그인의 v0.2 — 위 스펙 v0.2 추종이 아니다.

플러그인 버전 0.2와 스펙 버전 0.2가 우연히 같아 혼동되지만 둘은 다른 축이다. 이 리포트가 권고하는 플러그인 0.2.0은 **신뢰성 릴리스**이고, 스펙 v0.2 전면 마이그레이션은 v0.3로 뺀다. 이유는 6장에 있다. v0.2에서 스펙 관련으로 하는 것은 두 가지뿐이다 — 폐기된 필드를 배치에게 강요하는 lint 규칙 제거(더 파는 것을 멈추는 것)와 `status: deprecated` 도입(은퇴 수단이 필요해서).

---

## 3. 현황: 지금 서 있는 자리

### 코드

- 배포 버전 0.1.6(`.claude-plugin/plugin.json:3`). 3단 구조(SessionEnd 캡처 → `claude -p` 배치 → SessionStart 게이트).
- **테스트 수는 이 조사에서 검증하지 않았다.** 스모크가 tmpdir에 파일을 쓰므로 읽기 전용 제약상 실행하지 않았다. 저장소에 기록된 유일한 값은 `<WT>/AI_HANDOFF.md:152`의 `# 254 passed, 0 failed`다. 초안이 적은 "303 passed"는 출력 근거가 없어 **미검증으로 강등한다.**
- 커맨드 5개 + 스킬 2개. README 8개 언어.

### 실번들 (`/Users/ducksu/.claude/okf`, 운영 10일차, n=1)

| 지표 | 값 |
|---|---|
| concept | 22개 (본문 합계 91,029B) |
| index 줄 합계 | 11,797B (평균 536B, 최대 1,546B) |
| 게이트 실제 주입 | **12/22 concept, 9,000/9,000B (바이트 캡 100% 포화), 50/120줄** |
| raw/ | 0개 (파이프라인 자체는 건강) |
| _remove_candidate/ | 443개 / 175MB, 최상위 엔트리는 날짜 4개(`2026-07-15/16/17/25`) |
| 파이프라인 입력 실사용 비율 | raw 443개 중 실사용 세션 **21~27개 (5~6%)** |
| 배치 | 시작 37회 / **종료 35회** / 청크 커밋 16회 / NO-OP 프로토콜 미준수로 중단 9회 + 예외로 중단 1회 = **유료 호출 지불 후 롤백 최소 10회** |
| 회차 비용 기록 | **0건** (로그 5개 263줄에 cost/usd/token 문자열 0) |
| 최초 지식까지 | bootstrap 07-15 19:26 → 첫 ingest 07-16 13:21 = **약 18시간** |
| 번들 최대 concept | `troubleshooting/okf-sweep-self-consumption-loop.md` 20,381B — 전체 concept 텍스트의 22.4%, 그중 76.1%가 OKF 자기 벤치마크 반복 관측 |
| git 이력 잔존량 | 도달 가능 blob 89개 379,955B vs 워킹트리 추적 32파일 120,541B → **259,414B(3.15배)가 이력에만 존재**. 19개 커밋 중 파일 삭제 커밋 0건 |

### 채택 (2026-07-25 GitHub API 실측 — 초안의 "스타 사실상 0"을 대체)

| 지표 | 값 |
|---|---|
| star / fork / watcher / network | **1 / 0 / 0 / 0** |
| star 주체 | `Corykidios`, 2026-07-22T16:50:30Z. 2025-11 생성, public repo 17, follower 51, 타 저장소 30개 star — 봇 프로필 아님, 저자와 별개 계정 |
| issue | 3건(#3/#4/#5) 전부 OPEN, 전부 `dja1369` 작성. close된 issue 0건 |
| PR | 11건 전부 `dja1369`, 전부 merged |
| release | **0건** — 다운로드 기반 채택 측정 경로가 아예 없다 |
| clone (14일) | count 2302 / **unique 102** |
| clone (주 단위) | 07-13주 2300/100 · **07-20주 2/2** |
| clone (일별) | 07-15 592/69, 07-16 1691/33, 07-17 13/3, 07-18 3/2, 07-19 1/1, 07-20 0, 07-21 1/1, 07-22 0, 07-23 0, 07-24 1/1 |
| view (14일) | 92 / unique 4. 07-20~07-24 전부 0 |
| CI | 워크플로 run 51건이 전부 07-15T15:37 ~ 07-16T23:29에 집중, 이후 0건. 3-OS 매트릭스이므로 checkout 최대 153회 |

읽는 법 세 가지.

1. **`unique 102`는 채택 스톡이 아니다.** 저장소 생성 이틀과 저자의 유일한 CI 활동 구간에 100% 몰려 있고, 정상 상태 유입은 주당 1~2건이다. 초안 비평이 제시한 "설치했다가 첫 실행 침묵으로 이탈한 102명" 가설을 지지하는 데이터는 **없다.**
2. **그렇다고 CI로 설명되지도 않는다.** CI 기여 상한은 그 이틀 clone 2,283회의 6.7%(153/2283)뿐이고, 나머지 약 2,130회의 출처는 **확인 불가**다(벤치 하니스는 okf-system을 clone하지 않는다 — `--setting-sources ''` + OKF_HOME 주입 방식). unique 쪽은 07-15의 CI job 75건 vs clone unique 69로 근접해 ephemeral runner 오염 가능성을 배제할 수 없으나, GitHub이 Actions checkout을 어떻게 dedupe하는지는 확인 불가다.
3. **view 시계열은 undercount가 실증됐다.** Corykidios가 star를 누른 07-22의 view는 0/0으로 기록됐다. 따라서 "view 0 = 아무도 안 봤다"는 결론은 성립하지 않으며, **view를 반증 트리거로 쓸 수 없다.**

부수: 설치 경로는 clone 1회이고 이후 갱신은 pull이므로(설치본 reflog: clone 1회 + `pull ... Fast-forward` 4회) clone은 원리적으로 설치 대리 지표가 맞다 — 그래서 위 낮은 수치가 더 무겁다. 그리고 저자 본인의 설치본조차 `102af6e`(2026-07-16)에 고정되어 origin/main보다 2커밋 뒤처져 있다. 발견 가능성도 0에 가깝다: 검색에서 okf-system은 나오지 않고 동일 카테고리 경쟁 3종(theesfeld/claude-okf, scaccogatto/okf-skills, mattjoyce-okf)만 반환되며, okf-skills는 awesome-claude-code 이슈(#2141)와 여러 플러그인 디렉토리에 등재돼 있다. traffic API는 14일 롤링이라 **07-15/07-16 원자료는 2026-07-29~30에 영구 소멸한다 — 위 표가 그 유일한 사본이다.**

### 벤치마크가 증명한 것 (2건, 이것이 전부다)

1. 코드가 답할 수 있는 질문에서 OKF는 zero-base 대비 **1.2~1.7배 비싼 순수 오버헤드**다(v3, 4개 코드 유래 시나리오 중 3개).
2. 코드에 존재하지 않는 팀 정책에서만 OKF가 zero-base를 압도한다. rfcs_policy **11/15 vs 0/15**(Fisher p=5e-5). 단 오염 2건 보정 시 하한 **9/15**(p=0.0007) — 방향은 유지된다.

### 벤치마크가 반증한 것

- "번들이 커질수록 질문당 비용이 싸진다" — 수학적으로 반증(concept당 토큰 기울기 OKF 66.3 vs 수동 24). v2에서 발행 후 철회.
- v4 사전등록 P1 "체인이 진행될수록 OKF 비용이 내려간다" — 반증($0.231→$0.216→$0.258→$0.447 순증). zero_base arm도 같은 모양이라 Q4 난이도 대안설명 존재.
- "OKF가 유일한 해법" — CLAUDE.md도 rfcs_policy에서 15/15로 답한다.

### 아무도 재지 않은 것 (v0.3 이후의 재료)

- **게이트 잘림 구간.** v3 리포트가 스스로 명시한다: *"게이트 캡에 도달한 레벨: 없음"*(`<WT>/docs/benchmarks/okf-benchmark-2026-07-16-v3.md:179`). v4 최대 게이트도 4,950B로 캡 아래. **$151(v3 $84 + v4 $67)을 쓴 두 벤치마크가 잰 것은 concept 8개·1개짜리 번들이고, 실사용자는 열흘 만에 아무도 측정하지 않은 구간(캡 100% 포화)에 들어와 있다.**
- 전역 번들 vs 저장소별 CLAUDE.md — OKF의 유일한 구조적 차별점인데 v3/v4 모두 같은 저장소 안에서만 비교했다(CLAUDE.md가 구조적으로 가장 강한 조건).
- Claude Code 네이티브 auto-memory 대비. 이건 이미 이 머신에서 동작 중이다(프로젝트 3개, .md 10개). 무설정 1st-party 경쟁자다.
- **평상시 운영 비용.** 벤치마크 비용은 있으나 사용자 1인의 일/주 지출은 한 번도 관측된 적이 없다 — 애초에 기록되지 않기 때문이다.

---

## 4. 조사에서 나온 사실 — 주제별, 심각도 순

검증 상태: **CONFIRMED** = 파일:라인 직접 확인 또는 실행/실측 재현. **PARTIALLY_TRUE** = 핵심은 사실이나 수치·범위 정정 또는 실기 미검증. **확인 불가** = 근거가 코드 추적·2차 자료에 머물러 실행으로 확정하지 못함.

### T1. 캡처 경계가 없다 — 유입되는 것의 94%가 쓰레기이고, 나가는 것에 동의 창이 없다

| # | 사실 | 상태 | 근거 |
|---|---|---|---|
| 1.1 | **설치 직후 첫 SessionStart가 과거 7일치 전 프로젝트 히스토리를 즉시 유료 배치에 태운다.** 부트스트랩 직후 `maybeSpawnBatch` 호출 → `lastRunEpochMs=0`이라 인터벌 무조건 통과 → sweep이 `claudeConfigDir()/projects` 전체를 `SWEEP_LOOKBACK_DAYS=7`로 훑는다. 저자 로그 실증: 설치 당일 16/10/37/183개 세션 회수, 8개 청크 유료 호출, 전부 NO-OP. 유일한 옵트아웃 `capture_exclude_cwd` 기본값은 `[]`이고 config.md는 바로 그 SessionStart에서 처음 생성되므로 **설정할 창이 물리적으로 없다.** README에 한 줄도 없다. | CONFIRMED | `<WT>/bin/session-start.mjs:159`, `<WT>/lib/batch-gate.mjs:22`, `<WT>/bin/batch.mjs:17,223,259`, `<WT>/lib/config.mjs:19`, `<WT>/lib/bootstrap.mjs:102`, `<WT>/README.md:293-300`, `/Users/ducksu/.claude/okf/.okf/logs/batch-2026-07-15.log:3,20` |
| 1.2 | **`capture_exclude_cwd`가 제외 루트 자신을 못 막는다.** matchGlob이 `/**`를 `.*`로 바꾸고 앞의 `/`를 리터럴로 요구한다. 실행 검증: `matchGlob('/Users/me/secret', ['/Users/me/secret/**']) === false`, `('/Users/me/secret/a') === true`. 즉 cwd가 정확히 제외 디렉토리인 세션(=가장 흔한 경우)이 통과한다. 스모크는 하위 디렉토리만 검증해 이 구멍을 못 봤다. | CONFIRMED | `<WT>/lib/glob.mjs:5-26`, `<WT>/bin/batch.mjs:290-298`, `<WT>/test/smoke.mjs:861-874` |
| 1.3 | **파이프라인 실제 수율: raw 443개 중 실사용 세션 21~27개(5~6%).** 분류: 스모크/e2e 픽스처 306, bench-chain 워크트리 60, claude-jobs tmp 타깃 51, 번들 자기 세션 14. 그 대가가 번들에 남았다 — 최대 concept이 사용자 지식이 아니라 OKF 자기 버그 기록이다(전체 concept 텍스트의 22.4%). | CONFIRMED | `/Users/ducksu/.claude/okf/_remove_candidate/`, `/Users/ducksu/.claude/okf/troubleshooting/okf-sweep-self-consumption-loop.md` |
| 1.4 | **자기증식 루프는 정상 경로에선 막혔으나 벤치 워크트리 경로로는 그대로 재현된다.** `isOkfTestSessionDir`가 TEMP_CWD **AND** 픽스처명 교집합이라 `~/side_project/okf-system/.claude/worktrees/bench-v4/...`가 두 조건 다 불일치로 통과한다. bench-chain은 OKF arm에 `--no-session-persistence`를 의도적으로 쓰지 않아 전사가 남는다. 지금 조용한 이유는 수정이 아니라 `SWEEP_LOOKBACK_DAYS=7` 만료다. | CONFIRMED | `<WT>/lib/paths.mjs:53-59`, `<WT>/test/bench-chain.mjs:246`, `<WT>/bin/batch.mjs:17,942`, `/Users/ducksu/.claude/okf/log.md:42-50` |
| 1.5 | **sweep이 서브에이전트 전사 362개(58MB, 실사용 전사의 77%)를 구조적으로 못 본다.** `scanOrphanSessions`가 프로젝트 디렉토리 1단계만 읽는데 실제 배치는 `<projectDir>/<sessionId>/subagents/workflows/wf_<id>/*.jsonl`이다(manna 부모 1 : 중첩 154). 부모에 인라인되는 경우도 `isSidechain===true`를 버려 유실된다. | CONFIRMED | `<WT>/bin/batch.mjs:264,270`, `<WT>/lib/digest.mjs:98`, `/Users/ducksu/.claude/projects/-Users-ducksu-side-project-manna/` |

### T2. 조용한 데이터 파괴 — 지식이 사라지는데 아무도 모른다

| # | 사실 | 상태 | 근거 |
|---|---|---|---|
| 2.1 | **YAML 미인용 스칼라의 ` #`이 주석으로 파싱돼 title/description이 문장 중간에서 잘린다. 라이브 22개 중 2개(9.1%).** `projects/okf-system.md`의 description은 `…수정(PR`에서, `troubleshooting/python-tooling-gotchas.md`는 title이 `matplotlib mplstyle의`, description이 `…줄 중간의`에서 끊겼다. lint는 `isNonEmptyString`만 보므로 통과시키고, 파일 본문은 멀쩡해 사람이 열어봐도 안 보인다. 치명적인 이유: 게이트 규칙 1이 "제목·설명이 답을 담고 있으면 Read 없이 그 줄을 근거로 쓰라"이므로 **잘린 줄이 곧 모델이 보는 전부다.** | CONFIRMED | `<WT>/lib/frontmatter.mjs:15`, `<WT>/lib/lint.mjs:130`, `<WT>/bin/session-start.mjs:83`, `/Users/ducksu/.claude/okf/projects/okf-system.md:4`, `/Users/ducksu/.claude/okf/troubleshooting/python-tooling-gotchas.md:3-4` |
| 2.2 | **커밋 성공 직후의 archive 이동만 예외 무방비 → 같은 세션이 두 번 유료 ingest된다.** `processChunkBody`는 try/catch로 감쌌고 주석이 이유까지 적어놨는데, 바로 다음의 `mkdirSync`+`renameSync`가 try 밖이다. ENOSPC/EPERM 하나면 지식은 커밋됐는데 source가 staging에 남아 다음 회차 `recoverStagingLeftovers`가 되돌리고 같은 digest를 재과금한다. 대조군: 구조가 같은 빈-digest 이동(986-994)과 예산 이월(1006-1015)은 try/catch가 있다. | CONFIRMED | `<WT>/bin/batch.mjs:888-898`, `:799-804`, `:986-994`, `:1072` |
| 2.3 | **digest 150KB 캡이 실사용 세션에서 실제로 물렸고 로그에 안 남는다.** 07-25 세션 재계산: stripped digest 242.6KB → `truncateHeadTail`이 앞뒤 75KB만 남기고 **가운데 38%를 버렸다**(유지율 61.8%). 07-17도 '150.0KB' 정확히 일치. 즉 마지막 두 번의 실사용 ingest가 만든 concept는 대화의 앞머리와 결말만 보고 쓴 것이다. | CONFIRMED | `<WT>/lib/digest.mjs:25,109`, `/Users/ducksu/.claude/okf/.okf/logs/batch-2026-07-25.log` |
| 2.4 | **'무변경인데 NO-OP 문자열 완전일치 실패'로 배치 전체가 롤백·중단된 것이 9회.** no-op 판정 경로 25회 중 9회(36%)가 프로토콜을 못 맞췄다. 매번 LLM 호출은 이미 지불한 뒤이고 raw는 큐에 남아 재과금된다. 3회 연속 실패 구간 존재(07-16T14:14 → 14:19 → 07-17T00:30). | CONFIRMED | `<WT>/bin/batch.mjs:828`, `/Users/ducksu/.claude/okf/.okf/logs/batch-2026-07-16.log`, `batch-2026-07-17.log` |
| 2.5 | **추출기 없는 '지원 언어'가 '선언 0개'라는 거짓 사실을 발행한다.** `LANG_BY_EXT` 18개 중 `DECL_PATTERNS`는 13개뿐이고 shell/markdown/json/yaml/toml이 빠졌다. 실측: 함수 3개짜리 `deploy.sh`가 `shell 파일, 9줄, 선언 0개, import 0개 (정적 분석)`으로 집계됐다. `analyze.mjs:443-446`이 스스로 금지한 '지어낸 사실'이다. | CONFIRMED | `<WT>/lib/analyze.mjs:29-44,108-161,443-446,590-598` |

### T3. 되돌릴 수 없다 — 오염이 게이트를 점유하고 있고, "잊기"는 설계가 아직 없다

| # | 사실 | 상태 | 근거 |
|---|---|---|---|
| 3.1 | **concept 삭제 경로가 코드에 존재하지 않는다. 가설이 아니라 실제로 물린 기록이 번들에 남아 있다.** 배치 도구는 `Read,Glob,Grep,Write,Edit` + Bash 차단. log.md:43: *"delete 도구가 없어 두 파일을 완전 제거하진 못하고, 대신 트러블슈팅 문서로의 리다이렉트로 축소해 정정"*. `_remove_candidate/`는 raw transcript 전용이지 concept 휴지통이 아니다. | CONFIRMED | `<WT>/bin/batch.mjs:584-585`, `<WT>/lib/paths.mjs:30`, `<WT>/prompts/ingest.md:74`, `/Users/ducksu/.claude/okf/log.md:43` |
| 3.2 | **그 결과 references 게이트 슬롯 2/2를 지식 가치 0으로 확정된 벤치 묘비 2건(1,156B)이 100% 점유한다.** 축출 순서가 파일명 사전순이라 `kube-*`가 0·1번이고 round-robin은 앞 2개를 집는다. 밀려나는 것은 okf-format(222B)·okf-llm-wiki-lineage(202B)·okf-system-architecture(219B)·slim-psr15(944B)로, 앞 셋은 합쳐 643B라 묘비를 빼면 전부 들어가고도 남는다. 예산 잠식: index 예산 6,968B 중 1,156B(16.6%). | CONFIRMED | `/Users/ducksu/.claude/okf/references/index.md:1-2`, `<WT>/lib/index-gen.mjs:95-98`, `<WT>/bin/session-start.mjs:42-47` |
| 3.3 | **v3 벤치 픽스처가 사용자 preference로 굳었다.** `preferences/rust-msrv-freeze-policy.md`는 rfcs_policy 시나리오의 "thaw rule"이고, description에 임시 벤치 경로 `cwd .../tmp/targets/rfcs`까지 실린 채 매 세션 주입된다. 라이브 22개 중 **4개가 벤치마크 유래 오염**이다. | CONFIRMED | `/Users/ducksu/.claude/okf/preferences/rust-msrv-freeze-policy.md:3`, `<WT>/README.md:157` |
| 3.4 | **손으로 지우면 되살아나거나 배치가 영구 정지한다.** stale lock 상태면 dirty 트리를 무조건 크래시 잔여물로 판정해 `git checkout -- . && git clean -fd`로 되돌린다. 정상 락이면 lint 실패로 `aborted: pre-batch dirty tree lint failed`가 되어 **이후 모든 ingest가 멈춘다.** 신호는 opt-in statusline 한 줄뿐이다. | CONFIRMED | `<WT>/bin/batch.mjs:402-405,948-952`, `<WT>/lib/git.mjs:25-27`, `<WT>/bin/statusline.mjs:72-75` |
| 3.5 | **삭제 부재의 2차 효과: 노이즈가 기존 concept로 역류했다.** '신규 파일 금지' 병합 규칙과 결합해, `troubleshooting/okf-sweep-self-consumption-loop.md` 20,381B 중 15,502B(76.1%)가 '추가 관측 2'~'추가 관측 9' 벤치 반복 기록이다. 실질 진단은 앞 4,879B뿐인데 index 줄은 973B(카테고리 최대)로 예산을 계속 먹는다. | CONFIRMED | 동 파일 34,46,63,73,93,109,124,140,150행, `<WT>/prompts/ingest.md:47-48` |
| 3.6 | **초안의 `/okf:okf-forget` 설계 전제가 코드로 무너진다 — `_remove_candidate/`는 `.gitignore:2`가 무시하므로 "이동"은 git 관점에서 순수 삭제 커밋이고 원문은 `.git/`에 영구 잔존한다.** 라이브 `.gitignore`와 `<WT>/templates/gitignore`는 3줄(`raw/`,`_remove_candidate/`,`.okf/`)로 동일. `git check-ignore -v`로 `_remove_candidate/concepts/<date>/x.md`·`_remove_candidate/<date>/x.md` 두 레이아웃 모두 `.gitignore:2` 매치 확인. `commitAll`은 `git add -A`라 gitignore를 존중한다. 실측 잔존량: 259,414B(3.15배). 개별로 `okf-sweep-self-consumption-loop.md`는 12리비전 149,283B이며 지워도 128,902B 과거 판본 + 마지막 커밋의 20,381B가 남는다. `lib/git.mjs`는 27줄·export 4개(git/isDirty/commitAll/rollback)로 이력 재작성 코드가 없다. 사용자는 이 문제를 이미 알고 있다 — 번들에 `patterns/git-history-purge-filter-repo.md`가 있다. | CONFIRMED | `/Users/ducksu/.claude/okf/.gitignore:1-3`, `<WT>/templates/gitignore:1-3`, `<WT>/lib/git.mjs:17-20`, `/Users/ducksu/.claude/okf` (`git rev-list --objects --all` 89 blobs 379,955B vs `git ls-files` 32파일 120,541B) |
| 3.7 | **제안된 `_remove_candidate/concepts/<date>/` 레이아웃은 30일 TTL purge를 조용히 우회한다 — 잊었다고 믿는 원문이 평문으로 영구 잔존한다.** `purgeRemoveCandidate`는 최상위 엔트리 이름이 `^\d{4}-\d{2}-\d{2}$`에 **정확히** 일치할 때만 삭제한다. `concepts`는 불일치 → `continue` → 영원히 purge 안 됨. 반대로 `<date>/concepts/...`로 넣으면 30일 뒤 자동 하드 삭제라 '가역'이 30일 시한부가 된다. 어느 쪽도 무의식적으로 고르면 안 된다. | CONFIRMED | `<WT>/bin/batch.mjs:420-431`, `<WT>/lib/config.mjs:26`, `/Users/ducksu/.claude/okf/_remove_candidate/`(엔트리: 2026-07-15/16/17/25), `<WT>/AGENDA.md:51` |
| 3.8 | **커밋하지 않은 forget은 다음 배치의 stale-lock 무조건 rollback에 의해 조용히 되살아나고, `_remove_candidate/` 사본은 남아 중복이 생긴다.** `rollback`은 `git checkout -- .` + `git clean -fd`인데 `-x`가 없어 ignore 대상은 건드리지 않는다(주석 주장 맞음). 그러나 `checkout`은 추적 파일 삭제를 되돌린다. `recoveredFromStaleLock`이면 lint 결과와 무관하게 무조건 rollback. stale lock이 아니면 삭제는 lint 에러가 아니므로 `okf: pre-batch: user edits`로 커밋된다 — **같은 미커밋 상태가 배치 상황에 따라 '커밋됨'/'되돌려짐'으로 비결정적으로 갈린다.** | CONFIRMED | `<WT>/lib/git.mjs:22-27`, `<WT>/bin/batch.mjs:398-416,948-952`, `man git-clean` (-x 설명) |
| 3.9 | **concept 물리 삭제는 lint를 통과한다 — 깨진 링크는 W1 경고이고, log.md의 백틱 경로 참조는 경고조차 안 난다.** 게이트는 전부 errors 기준(`batch.mjs:409,836,853`, `lint.mjs:200`)이라 warnings를 무시한다. 라이브 log.md는 concept 경로를 마크다운 링크가 아니라 백틱으로 쓰므로 `LINK_RE`에 아예 안 걸린다. 게다가 log.md는 어떤 코드도 재작성하지 않는다(index.md만 `regenerateIndex`가 재생성). 실측 이력: log.md 17리비전 93,075B(현재 12,856B), patterns/index.md 7리비전 18,404B(현재 4,095B). | CONFIRMED | `<WT>/lib/lint.mjs:54-64,196-201`, `<WT>/bin/batch.mjs:408-413`, `/Users/ducksu/.claude/okf/log.md:7,18,37,42-47` |
| 3.10 | **프라이버시 누출 표면은 concept 파일 하나가 아니라 최소 3곳이며, description은 게이트를 통해 매 세션 재주입된다.** 게이트는 카테고리 index.md의 `- [제목](/dir/file.md): 설명` 줄을 병합해 주입한다. 비밀이 title/description에 들어가면 (1) concept 파일, (2) 카테고리 index.md와 그 이력, (3) log.md와 그 이력에 복제되고, (2)는 이후 모든 세션 컨텍스트로 흘러간다. index.md 워킹트리는 재생성으로 정리되지만 이력은 남고, log.md는 워킹트리조차 자동 정리되지 않는다. | CONFIRMED | `<WT>/bin/session-start.mjs:14-19,87-101`, `<WT>/lib/index-gen.mjs:108-112`, `/Users/ducksu/.claude/okf`(index.md 10revs/4,929B, references/index.md 4revs/4,986B) |
| 3.11 | **정정: kube-scheduler 묘비의 '원문'은 git 이력에 없다.** 해당 두 파일을 건드린 커밋은 `6042e93` 하나이고 상태는 `A`뿐이며, 그 커밋의 blob 크기(1,203B/1,167B)가 현재 워킹트리와 바이트 단위로 동일하다. 이유는 `processChunkBody`가 청크 끝에서 딱 한 번 `commitAll`을 호출하기 때문 — 같은 회차 안의 자체 정정은 이력에 도달하지 않는다. **이 사례는 '이력 노출 증거'로 인용하면 안 되고, '삭제 수단 부재의 필요성 근거'로만 유효하다.** 이력 노출의 진짜 경로는 다회차 누적 concept다(3.6). | CONFIRMED (초안 근거 오류 정정) | `/Users/ducksu/.claude/okf` (`git log --name-status -- 'references/kube-scheduler-*.md'` → 6042e93 A 2건), `<WT>/bin/batch.mjs:858-865` |

### T4. 조용한 고장 — 멈춰도 정상으로 보인다

| # | 사실 | 상태 | 근거 |
|---|---|---|---|
| 4.1 | **배치가 청크 처리 중 죽은 뒤 아무도 몰랐다.** 크래시 시점 2026-07-17T15:55:23Z 기준 7.65일 방치. 다만 정체 기간의 last-batch.json 값은 그 뒤 완료된 noop 사이클이 덮어쓴 07-17T06:12:35Z의 `{lastResult:'noop'}`이었고, 마지막 상태 기록 기준으로는 8.05일이다. statusline이 noop을 ok와 같은 분기로 처리하므로 **크래시와 무실행이 구분되지 않는다**는 결론은 유효하다. | **PARTIALLY_TRUE** (수치·경로 정정 반영) | `/Users/ducksu/.claude/okf/.okf/logs/batch-2026-07-18.log`, `batch-2026-07-25.log`, `<WT>/bin/statusline.mjs:68`, `<WT>/bin/batch.mjs:906` |
| 4.2 | **acquireLock의 stale 회수가 TOCTOU이고 실제 로그에 흔적이 남았다.** unlink가 '내가 읽은 그 stale 락이 아직 그대로인지'를 확인하지 않는다. `batch-2026-07-25.log`에 `stale lock 회수 (PID 45270)`이 **동일 밀리초에 두 줄** 기록됐다. releaseLock도 소유권 확인 없이 unlink한다. | CONFIRMED | `<WT>/bin/batch.mjs:200,210`, `/Users/ducksu/.claude/okf/.okf/logs/batch-2026-07-25.log` |
| 4.3 | **PID 재사용 시 최대 4시간 배치 정지, 그동안 statusline은 'batch running'을 표시한다.** `isLockStale`이 `process.kill(pid,0)` 생존만 보고 살아 있으면 `HARD_LOCK_CEILING_MS`(4h)까지 유효로 판정한다. 락 페이로드에 pid와 startedEpochMs만 있어 재사용을 구분할 정보가 없다. | CONFIRMED | `<WT>/lib/lock.mjs:17-28`, `<WT>/bin/batch.mjs:185-208`, `<WT>/bin/statusline.mjs:62-64` |
| 4.4 | **claude 바이너리 미발견이 영구 조용한 실패가 된다.** ENOENT가 catch에 삼켜지고 `describeClaudeError`가 프라이버시 때문에 원문을 버려 진단이 아무 데도 안 남는다. GUI/IDE 런처가 로그인 셸 PATH를 못 받는 흔한 케이스. 해결책 `claude_bin`/`node_bin`은 README 8개 어디에도 없다(grep 0건). | CONFIRMED | `<WT>/bin/batch.mjs:570,666,673-679,817`, `<WT>/templates/config.md:16-17`, `<WT>/README.md:306-317` |
| 4.5 | **링거가 대기 중 락을 놓아 유휴 프로세스가 최대 8개까지 누적되고 게이트가 살아있는 배치를 인식하지 못한다.** 실측: batch.mjs PID 61353이 16분째 살아 있는데 `batch.lock` 파일이 없다. 8h/1h = 최대 8개 공존, 각자 5분마다 `~/.claude/projects` 전체 스캔. | CONFIRMED | `<WT>/bin/batch.mjs:1045-1070`, `<WT>/lib/batch-gate.mjs:22-29`, `/Users/ducksu/.claude/okf/.okf/` |

### T5. 프라이버시 — 문서와 코드의 불일치

| # | 사실 | 상태 | 근거 |
|---|---|---|---|
| 5.1 | **JSONL 파싱이 한 줄만 실패해도 tool_result 포함 원본 전체의 앞 150KB가 API로 나간다. 부분 복구도, 실패 줄 스킵도, 레닥션도 없다.** `digestFile`은 첫 파싱 실패에서 즉시 `fallback = true; break`하고, 그러면 `truncateHead(raw, capBytes)`가 **앞쪽**을 남긴다 — 정상 경로에서 tool_result를 전부 `null`로 버리는 `extractContent` 필터를 통째로 건너뛴다. 앞쪽을 남기는 것이 최악을 강화한다: transcript 앞부분은 시스템 프롬프트·CLAUDE.md 주입·초반 파일 Read/`env` 류 tool_result가 몰린 구간이다. 레닥션 코드는 전 코드베이스에 0건(redact/scrub/secret/credential/mask grep의 유일한 히트는 `batch.mjs:672`의 **로그 출력용** 주석). `lint.mjs`에는 내용 검사 규칙이 하나도 없고(E1/E2/E3a/E3b/W1~W4 전부 구조 검사), SCHEMA.md 규칙 7의 "자격증명 기록 금지"는 **번들에 쓰지 마라**이지 **보내지 마라**가 아니다 — digest는 이미 전송된 뒤다. README는 "capped digest를 보낸다"고만 써서 이 폴백을 읽어낼 수 없다. | CONFIRMED (코드 추적) / 실행 재현은 **확인 불가** | `<WT>/lib/digest.mjs:19-23,36-47,60,89-97,107-109`, `<WT>/lib/config.mjs:20`, `<WT>/lib/lint.mjs:115-143`, `<WT>/bin/batch.mjs:672`, `<WT>/templates/SCHEMA.md:16`, `<WT>/README.md:294` |
| 5.2 | **배치 분석기의 Read에 경로 제한이 없다.** Bash는 차단됐고 Write/Edit은 워크스페이스 한정이지만 Read는 무제한이다. 입력인 digest는 100% 신뢰 불가 텍스트다. 프롬프트 인젝션 한 번이면 임의 로컬 파일이 concept가 되어 모든 세션 게이트에 실린다. 원격 유출은 막혀 있으나 '로컬 파일 → 번들 → 모든 세션 컨텍스트' 경로는 열려 있다. | CONFIRMED | `<WT>/bin/batch.mjs:561-567,576-601,756-797` |
| 5.3 | **"Windows uses account ACLs"는 코드 근거가 0인 주장이다.** `chmodIfPosix`가 win32에서 즉시 return하고 저장소 전체에 `icacls` 호출이 0건이다. CI는 windows-latest에서 돌지만 권한 단언은 `process.platform !== 'win32'` 가드로 skip되어 검증된 적이 없다. 이 문장은 세 문서에 실려 있다. | CONFIRMED | `<WT>/lib/permissions.mjs:9-16`, `<WT>/README.md:298`, `<WT>/README.ko.md:295`, `<WT>/docs/USAGE.md:68`, `<WT>/test/smoke.mjs:161` |
| 5.4 | **배치가 쓰는 concept은 0644, 새 디렉토리는 0755로 `lib/permissions.mjs`를 우회한다.** 라이브 실측: bootstrap이 쓴 SCHEMA.md/config.md만 `-rw-------`, 배치가 쓴 concept 전부와 index.md·log.md는 `-rw-r--r--`. 지금은 번들 루트 0700이 막지만 보호가 전부 한 겹에 걸려 있다. | CONFIRMED | `<WT>/bin/batch.mjs:787-789`, `<WT>/lib/permissions.mjs:23-31` |
| 5.5 | **spawn된 `claude -p`는 사용자의 대화형 세션과 동일한 계정·구독·API 키로 과금된다 — 코드로 확정되지만 문서에 한 줄도 없다.** 근거 셋: (1) 자식 env가 `{...process.env, OKF_BATCH:'1'}`로 전부 상속된다. (2) `CLAUDE_CONFIG_DIR` 격리를 시도했다 되돌린 이력이 코드 주석에 실측으로 남아 있다 — "격리하면 keychain/OAuth 인증까지 격리되어 'Not logged in'으로 즉시 실패", 그래서 `--safe-mode`로 교체했고 이는 "Auth, model selection, ... work normally". (3) args에 `--bare`가 없고 공식 문서는 "Bare mode skips OAuth and keychain reads"라고 명시한다. `--settings` 임시 파일은 hooks 비우기와 번들 내 Write/Edit allow만 담고 과금에 관여하지 않는다. README:294와 USAGE:64는 "a separate authenticated `claude -p` call"이라고만 한다. | CONFIRMED | `<WT>/bin/batch.mjs:561-567,587-594,614-617`, `<WT>/README.md:294`, `<WT>/docs/USAGE.md:64`, https://code.claude.com/docs/en/headless |

### T6. 발행된 사실의 오류 — 문서가 저장소 안의 데이터와 모순된다

| # | 사실 | 상태 | 근거 |
|---|---|---|---|
| 6.1 | **README의 "The clean scenarios above had zero memory reads"는 사실이 아니다.** flagship인 rfcs_policy의 okf 셀 2/15가 project memory를 읽었다. 원인은 `bench-okf.mjs:424`의 슬러그 계산이 `replace(/\//g,'-')`(슬래시만)이라는 것 — 실제 Claude Code 슬러그는 비영숫자 전부를 '-'로 바꾼다. **디스크의 실제 디렉토리명으로 실증됐다**(`_`와 `.`이 전부 `-`). `bench-chain.mjs:128`만 정답이다. 결과: v3의 오염 차단이 v3 대상 경로에서 **단 한 번도 실행되지 않았다.** 보수적 하한은 11/15가 아니라 9/15(Fisher p=0.0007, 방향 유지). | CONFIRMED (배경 미결항목 #7 확정) | `<WT>/test/bench-okf.mjs:422-433`, `<WT>/test/bench-chain.mjs:123-134`, `<WT>/README.md:188`, `<WT>/docs/benchmarks/raw/okf-live-2026-07-16T08-31-48-458Z.json`, `/Users/ducksu/.claude/projects/-Users-ducksu-side-project-okf-system/memory/` |
| 6.2 | **"CLAUDE.md의 대략 절반 비용" 주장은 리포트가 스스로 '분리 안 됨'이라 적은 셀에서 뽑았다.** OKF $0.0340–$0.1436(n=11) vs CLAUDE.md $0.0648–$0.2492(n=15) — 범위가 겹친다. 사전등록서가 정확히 금지한 형태다. 분리가 확인된 셀은 rfcs_cheap·slim_cheap·slim_buried 셋뿐이다. | CONFIRMED | `<WT>/README.md:163`, `<WT>/docs/benchmarks/okf-benchmark-2026-07-16-v3.md:85`, `<WT>/docs/benchmarks/pre-registration-2026-07-16-v3.md:228-231` |
| 6.3 | **slim_buried의 "OKF cheaper" verdict는 정확도 27pp 손실을 숨긴다.** 정답 okf 9/15 vs zero_base 13/15, '자신있게 틀림' 6/15 vs 2/15(3배). README 표에는 9/15 숫자만 있고 verdict·본문 어디에도 이 사실이 없다. correct-runs-only 중앙값 비교도 정답률이 27pp 다를 때 선택 편향이 들어간다 — 손익분기 23세션이 그 위에 세워져 있다. | CONFIRMED | `<WT>/README.md:131-139`, `<WT>/docs/benchmarks/okf-benchmark-2026-07-16-v3.md:93,99,146` |
| 6.4 | **사전등록 반증기준 R4는 '미발동'이 아니라 '평가 불가'였다.** R4는 OKF의 메커니즘 자체를 검증하는 유일한 기준인데, rfcs_policy의 wrong_knowledge는 5/5 정답 — 정확히 R4가 잡으라고 만든 패턴이다. 리포트는 이 셀을 오염으로 제외하고 '아니오'를 찍은 뒤 "사전등록한 반증 기준이 하나도 발동하지 않았다"고 결론지었다. 같은 문서 안에서 제외 목록도 어긋난다(:28은 2개, :165는 rfcs_policy). | CONFIRMED | `<WT>/docs/benchmarks/okf-benchmark-2026-07-16-v3.md:28,75,83,165,168` |
| 6.5 | **README 배지 `OKF v0.1 Draft`와 AGENDA의 'v0.1 draft 스펙' 서술이 낡았다.** 스펙은 2026-07-24로 v0.2다. | CONFIRMED | `<WT>/README.md:5`, `<WT>/AGENDA.md:7`, SPEC.md §12 |

### T7. 게이트 — 번들이 커져도 주입은 12개에서 멈춘다

| # | 사실 | 상태 | 근거 |
|---|---|---|---|
| 7.1 | **게이트는 번들 크기와 무관한 상수 창이다.** 라이브 index 줄을 2배·5배·10배로 복제해도 주입은 각각 12/44, 12/110, 12/220. 바이트 캡이 유일한 병목이고 `inject_max_lines: 120`은 50/120줄만 쓰여 **사실상 비활성 파라미터**다. 원인은 index 줄 크기(평균 536B, 최대 1,546B) — `index-gen.mjs:111`이 description을 길이 제한 없이 싣기 때문이고, 그건 `ingest.md:56-59`의 'description에 답을 써라' 지침의 부작용이다. | CONFIRMED | `<WT>/bin/session-start.mjs:29-61,95-101`, `<WT>/lib/index-gen.mjs:32,111`, `/Users/ducksu/.claude/okf/.okf/config.md:12-13` |
| 7.2 | **관련성 신호가 코드에 단 하나도 없다.** `session-start.mjs` 177줄 전체에 cwd·프로젝트 식별자·최신성·빈도·질의어 참조가 0건(grep 확인). 유일한 순서 결정자는 카테고리 round-robin + 파일명 사전순. 피해: 7월 25일 갱신된 현재 진행 프로젝트 `/projects/okf-system.md`(283B)는 projects 3번째라 항상 배제되고, 종료된 남의 저장소 조사 concept이 1,546B(예산의 22.2%)를 혼자 먹으며 매 세션 주입된다. | CONFIRMED | `<WT>/bin/session-start.mjs:1-177`, `/Users/ducksu/.claude/okf/projects/index.md:3` |
| 7.3 | **'...(N개 생략)' 마커가 예산에 미반영돼 게이트가 218B 초과하고, 그 벌로 log.md 최신 섹션이 잘린다.** heading은 선차감하는데 마커는 안 한다. 라이브에서 조립 9,218B → 절단 9,000B, 잃는 218B는 정확히 문서 끝(log.md '최근 변경'). `:92-94` 주석이 "전체를 뒤에서 자르면 log.md 섹션이 조용히 사라진다"며 예산 선계산으로 막는다고 명시한 바로 그 현상이다 — **방지 로직이 자기 의도를 깨고 있다.** | CONFIRMED | `<WT>/bin/session-start.mjs:37-38,58,92-94,101`, `<WT>/lib/text.mjs:3-9` |
| 7.4 | **채우기 루프가 첫 미스에서 `lines = 0; break;`로 바깥 루프까지 종료해 남은 예산에 들어갈 짧은 줄까지 버린다.** 4,000~14,000B를 50B 간격으로 훑은 157개 샘플 중 **79개(50.3%)**에서 발생. 현행 기본값에서 손해가 0인 것은 잔여가 70B라는 우연이다. | CONFIRMED | `<WT>/bin/session-start.mjs:45` |
| 7.5 | **게이트 규칙과 okf-usage 스킬이 정반대를 지시한다.** 게이트: "제목·설명이 답을 담고 있으면 Read 없이 그 줄을 근거로 쓰라"(실측: 게이트 켠 조건이 토큰 13,787을 더 썼고 91%인 12,508이 강제 Read 왕복, 그 Read가 가져온 새 사실 0개, 답 8/8이 이미 index 줄에 있었다). SKILL.md: "해당 파일을 Read하라 … 요약만 보고 넘겨짚지 마라". 트리거가 같은 판단 지점이라 실제로 충돌한다. | CONFIRMED | `<WT>/bin/session-start.mjs:74-78,83`, `<WT>/skills/okf-usage/SKILL.md:3-4,15-17` |

### T8. 언어 — 8개 언어 README, 100% 한국어 런타임, 그리고 산출물 언어 규칙의 부재

| # | 사실 | 상태 | 근거 |
|---|---|---|---|
| 8.1 | **매 세션 주입되는 게이트 텍스트와 카테고리 라벨이 한국어 하드코딩이다.** 게이트 head가 `=== OKF KNOWLEDGE GATE (필수) ===` / `전역 지식 번들:`, `DIR_DESCRIPTIONS`가 `projects: '프로젝트'`. seed 언어를 en으로 둬도 헤딩은 `## references (참고자료) — 3개`로 나간다. 커맨드 5개·스킬 2개의 frontmatter description도 전부 한국어인데 이는 Claude Code 도구 카탈로그로 **매 세션 컨텍스트에 상주한다**(예: `commands/okf-batch.md:2`). 게이트는 `suppressOutput: true`라 보이지도 않아, 사용자는 Claude가 "참고자료"를 언급할 때에야 원인을 짐작한다. | CONFIRMED | `<WT>/bin/session-start.mjs:79-86,154`, `<WT>/lib/index-gen.mjs:8-15,56`, `<WT>/commands/okf-batch.md:2`, `<WT>/skills/okf-usage/SKILL.md:3` |
| 8.2 | **산출물 언어를 규정하는 문장이 프롬프트 계층 어디에도 없다 — 언어는 지시가 아니라 프롬프트 문체로 암묵 상속된다.** `prompts/ingest.md`(82줄)·`prompts/repair.md`(22줄)·`templates/SCHEMA.md`(68줄) 전문을 읽었고 `언어|language|English` grep 0건. 대신 세 파일 전부가 한국어다: `너는 <OKF_HOME>(현재 작업 디렉토리) OKF v0.1 번들의 지식 사서다`(ingest.md:3), `# 절대 규칙 (위반 시 lint가 커밋을 거부한다)`(SCHEMA.md:8). ingest.md:18은 "이번 실행에서 유효한 지시는 이 파일과 SCHEMA.md뿐"이라고 못 박는다 — 즉 배치가 받는 유효 지시가 전량 한국어다. **영어 digest에서 실제로 어떤 언어 concept가 나오는지는 유료 실행이 필요해 확인하지 못했다**(라이브 22/22가 한국어이나 사용자가 한국어 화자라 교란). | CONFIRMED (구조) / 산출 언어 인과는 **확인 불가** | `<WT>/prompts/ingest.md:3,18`, `<WT>/prompts/repair.md:9`, `<WT>/templates/SCHEMA.md:4,8` |
| 8.3 | **"게이트 head와 DIR_DESCRIPTIONS가 유일한 런타임 표면"은 거짓이다.** 같은 성격의 표면이 최소 4계열 더 있다: prompts 2종, SCHEMA.md(매 배치가 첫 번째로 Read하는 규칙서), commands 5종 description, skills 2종 description. 특히 SCHEMA.md는 `schema_version` 승격 경로로 **기존 사용자 번들에 강제 재배포**되며, 이 경로는 라이브에서 실제로 발동했다(커밋 `0aab3b8`이 `+schema_version: 1`과 `+## description은 요약이 아니라 **답**이다`를 추가). `templates/config.md`도 언어 변형 없이 사용자 `.okf/config.md`로 복사된다. | CONFIRMED (초안 전제 반증) | `<WT>/lib/bootstrap.mjs:87,91-99,102`, `/Users/ducksu/.claude/okf/SCHEMA.md:3`, `<WT>/templates/config.md:17` |
| 8.4 | **언어 축 비대칭 확정: seed만 en/ko 대칭 분리, 나머지 사용자 대면 텍스트 전량은 언어 변형 없는 한국어 단일.** `templates/seed/{en,ko}`는 파일 단위로 완전 대칭이고 frontmatter까지 번역돼 있다(en `title: Rules for writing knowledge into this bundle` / ko `title: 이 번들에 지식을 쓸 때 지키는 규칙`). 반면 prompts·SCHEMA.md·config.md·commands·skills는 언어 변형이 0개다. | CONFIRMED | `<WT>/templates/seed/en/preferences/okf-bundle-rules.md:3`, `<WT>/templates/seed/ko/preferences/okf-bundle-rules.md:3`, `<WT>/lib/bootstrap.mjs:36-39,105` |
| 8.5 | **이슈 #3 실측: 시드는 en/ko 2개뿐이고 `seed_language`는 문서화 1건 + 기능적으로 죽어 있다.** `bootstrap.mjs:102`가 기본 config.md를 쓴 직후 `:105`가 그걸 읽으므로 첫 부트스트랩은 **항상 en**이고, 나중에 ko로 바꿔도 `writeIfMissing`이 아무것도 안 쓴다. 번들을 통째로 지우는 것 외에 ko 시드를 받을 방법이 없다. 문서화는 저장소 전체에서 `templates/config.md:8`의 한국어 주석 1줄뿐이며 README 8종·USAGE·okf-config 키 목록에 grep 0건. 이름도 실제 범위보다 넓게 읽힌다 — 시드에만 적용되고 이후 배치 산출 언어에는 아무 영향이 없다. | CONFIRMED | `<WT>/lib/bootstrap.mjs:10-14,39,102,105`, `<WT>/lib/config.mjs:18`, `<WT>/templates/config.md:8`, `<WT>/README.md:259` |
| 8.6 | **lint에는 언어 의존 규칙이 없다 — 프롬프트/SCHEMA를 번역해도 lint는 깨지지 않는다.** 문자열 매칭이 전부 언어 중립(`ISO_DATE_RE`, `LOG_HEADING_RE`, `LINK_RE`)이고, log.md 검사는 헤딩 문구가 아니라 ISO 날짜 형식·내림차순·중복만 본다. 타입 검사는 영어 type 키를 쓴다. **"번역하면 lint가 깨질 것"이라는 우려는 근거 없음으로 확인됐다.** | CONFIRMED | `<WT>/lib/lint.mjs:8-15,17,66-95` |
| 8.7 | **대신 번역하면 조용히 깨지는 한국어 하드코딩이 6곳 있다(lint가 아니라 텔레메트리 + 스모크).** `batch.mjs:646`이 `prompt.includes('lint 오류 리포트') ? 'repair' : 'ingest'`로 단계를 판정하는데 이는 `repair.md:20`의 헤딩과 문자열 결합이다 — repair.md를 영어화하면 모든 repair가 'ingest'로 오분류되고 예외가 통째로 삼켜져(:657) 경고조차 없다. smoke는 ingest.md 한국어 substring 4건(:1145,:1146,:1147,:1161-1162)과 seed 문자열 2건(:1129 ko, :1135 en)을 단언한다. | CONFIRMED | `<WT>/bin/batch.mjs:646`, `<WT>/prompts/repair.md:20`, `<WT>/test/smoke.mjs:1129,1135,1145-1147,1161` |
| 8.8 | **첫 지식까지 18시간, 그 사이 기본 설정 사용자에게 가는 신호는 0이다.** 게이트는 숨겨지고, statusline은 "OKF does not install or overwrite it"이라 수동 배선 opt-in이며, 훅 statusMessage는 수십 ms 스쳐 간다. 시드 concept 4개가 게이트를 비우진 않지만 그 4개는 전부 OKF 자기 자신에 대한 문서다. | CONFIRMED | `/Users/ducksu/.claude/okf/.okf/logs/batch-2026-07-15.log:6`, `<WT>/bin/batch.mjs:28`, `<WT>/bin/session-start.mjs:154`, `<WT>/README.md:69`, `<WT>/lib/bootstrap.mjs:28-35` |
| 8.9 | **README가 시키는 `/okf:okf-index`는 커맨드가 아니라 스킬이고, 유일한 우회로인 okf-usage 스킬은 문서에 없다.** README는 "commands always require the `okf:` namespace" 선언 후 6행 표를 제시하지만 commands/에는 5개뿐이다. 반대로 okf-usage의 "사용자가 명시적으로 요청하면 세션이 번들에 직접 쓴다" 예외는 README·USAGE 어디에도 없다 — **통제 수단이 존재하는데 문서로 도달할 수 없다.** | CONFIRMED | `<WT>/README.md:22-25,44,46-53`, `<WT>/skills/okf-index/SKILL.md:1`, `<WT>/skills/okf-usage/SKILL.md:29-31`, `<WT>/docs/USAGE.md:22` |

### T9. 플랫폼 / 부채

| # | 사실 | 상태 | 근거 |
|---|---|---|---|
| 9.1 | **Windows: `shell:true`가 인자를 인용 없이 join해, 공백 있는 %TEMP%/claude_bin 경로에서 배치가 실패한다.** Node는 shell:true일 때 `[file,...args]`를 공백으로 join한 문자열 하나를 셸에 넘긴다(macOS 등가 실험으로 재파싱 실증). `--settings` 값은 `os.tmpdir()/okf-ingest-...`이고 Windows %TEMP%는 보통 `C:\Users\<이름>\AppData\Local\Temp` — 이름에 공백이 있으면 쪼개진다. config 검증기 `SAFE_COMMAND_PATH`는 공백을 명시적으로 허용한다. CI windows-latest는 runner 계정 경로에 공백이 없어 영원히 초록이다. **Windows 실기 검증은 하지 않았다.** | **PARTIALLY_TRUE** (메커니즘 실증, 실기 미검증) | `<WT>/bin/batch.mjs:569-619,611`, `<WT>/lib/config.mjs:38`, `<WT>/test/smoke.mjs:1243` |
| 9.2 | **`isOkfTestSessionDir`가 Windows에서 항상 false.** TEMP_CWD 정규식이 소문자 `tmp-`와 macOS 전용 `var-folders-...-T-`만 본다. Windows 슬러그 `C--Users-dev-AppData-Local-Temp-okf-smoke-...`는 대문자 `Temp-`에 안 걸린다(두 종류 Windows 모양 슬러그 모두 false 실증). 즉 과거 실번들을 165개 오염 raw로 채운 그 가드가 Windows에서 통째로 무효다. | CONFIRMED | `<WT>/lib/paths.mjs:53-59`, `<WT>/test/smoke.mjs:412-430` |
| 9.3 | **스모크가 커버하지 않는 축이 7개다**: 실제 동시 프로세스 락 경합, 커밋 후 실패, 손상된 상태 파일(비-JSON last-batch/lock), 대용량 digest, Windows 모양 경로, viz 중첩 도메인, 링거 다중 프로세스. v0.2 스코프 대부분이 정확히 이 빈 축에 있다. (테스트 총 개수는 이 조사에서 미실행 — 3장 참조.) | CONFIRMED (커버 공백) | `<WT>/test/smoke.mjs:1650-1652` |
| 9.4 | **viz가 중첩 도메인 concept을 통째로 못 본다.** `collectOkfNodes`가 카테고리 디렉토리 1단계만 읽는다. `index-gen.mjs:79-122`는 같은 문제를 재귀로 고쳤고 그 주석이 "하위 concept이 어떤 index.md에도 안 나타나 영구히 발견 불가능했다"고 적어놨다 — 미이식 잔존. 실측: `decisions/sales/orders.md`는 하위 index.md엔 실리는데 그래프 노드엔 없다. | CONFIRMED | `<WT>/lib/viz.mjs:34-71`, `<WT>/lib/index-gen.mjs:79-122` |
| 9.5 | **`primaryLanguages`가 추출기 편차를 '주 언어' 순위로 발행한다.** java/csharp DECL_PATTERNS에 클래스 패턴만 있고 메서드가 없다. 실측: Java 20파일(클래스 20, 메서드 60) + Python 3파일(def 30) 저장소가 `python > java > shell`로 나온다 — 파일 수 80%가 Java인데 파이썬 프로젝트로 보고되고, 그 값이 viz의 'Primary structure' 배지에 박힌다. | CONFIRMED | `<WT>/lib/analyze.mjs:126-128,153-155,777-783`, `<WT>/lib/viz.mjs:275` |
| 9.6 | **죽은 코드**: `lib/permissions.mjs:40`의 `withPrivateLock`은 저장소 전체(테스트 포함)에 호출자 0개. `analyze.mjs:88`의 PHP `use` 패턴은 정상 PHP에서 도달 불가이고, 도달하는 유일한 경우인 줄바꿈된 grouped use에서는 잘린 문자열을 `dep:` 외부 의존성으로 잘못 태깅한다. | CONFIRMED | `<WT>/lib/permissions.mjs:40-70`, `<WT>/lib/analyze.mjs:87-90,474-492` |
| 9.7 | **v4의 harness flake 11.7%는 제품 버그가 아니라 하니스 버그다.** 근거 4: (1) 동일 파서인데 v3는 440런 중 subtype=null 0건, v4는 120런 중 14건. (2) v4에만 있는 구조적 차이 — 측정 루프 안의 `spawnSync`가 이벤트 루프를 정지시켜 동시 실행 중인 claude 자식들의 stdout 파이프가 역압에 걸린다. (3) 실패 14건 중 9건(64%)이 `firstValidMs/wallMs ≥ 0.8`(성공은 12/106, 중앙값 0.143). (4) 상한 미도달(최대 턴 19/40, 최대 비용 $0.7475/$1.25). 별개로 `pending += chunk`가 Buffer를 청크 단위로 디코드해 멀티바이트 경계에서 U+FFFD를 만든다 — JSON은 안 깨지지만 한국어 답변 본문을 손상시킨 채 채점기에 넘긴다. | CONFIRMED | `<WT>/test/bench-chain.mjs:234-237,273-296,355-358`, `<WT>/test/bench-okf.mjs:157-215`, `<WT>/docs/benchmarks/raw/okf-chain-live-2026-07-16T11-49-21-216Z.json` |
| 9.8 | **`_remove_candidate` TTL purge는 배포 이래 한 번도 실행되지 않았다.** 매 배치 호출되지만 로그 5개 전체에 `purge:` 0건 — 최고령 디렉토리가 10일이고 TTL이 30일이라 만료 대상이 없다. 즉 **정리 코드가 실전에서 검증된 적이 없다.** 첫 실행 예상 시점은 2026-08-14 전후. | CONFIRMED | `<WT>/bin/batch.mjs:420-428,954`, `/Users/ducksu/.claude/okf/_remove_candidate/` |

### T10. 스펙 / 생태계

| # | 사실 | 상태 | 근거 |
|---|---|---|---|
| 10.1 | **`index-gen.mjs:49`가 okf_version 기본값 `'0.1'`을 하드코딩하고, 기존값 보존 로직 때문에 자동 승격 경로가 없다.** 오늘 새로 부트스트랩하는 사용자도 v0.1 번들을 받는다. 라이브 `index.md:2`가 `okf_version: "0.1"`. 테스트도 이 값을 잠그고 있다. | CONFIRMED | `<WT>/lib/index-gen.mjs:39-50,58`, `<WT>/test/smoke.mjs:475,497`, `/Users/ducksu/.claude/okf/index.md:2` |
| 10.2 | **lint가 폐기된 `timestamp`를 권장 필드로 강제해, 배치를 v0.1 방언 쪽으로 능동적으로 민다.** `lint.mjs:130`의 `['title','description','timestamp']` 누락 시 W2. SCHEMA.md 템플릿도 `timestamp: 2026-01-01`을 명시하고 "스펙 권장 순서"라고 못 박는다. 두 번째 breaking(`# Citations` → `sources`)은 해당 구현 자체가 없다. | CONFIRMED (본 조사에서 재확인) | `<WT>/lib/lint.mjs:130`, `<WT>/templates/SCHEMA.md:20,28` |
| 10.3 | **seed concept과 okf-usage 스킬이 v0.1 사실을 가르쳐, 지식 시스템이 스스로 낡은 지식을 매 세션 주입한다.** seed의 okf-format.md(en/ko)가 "Version is declared as `okf_version: \"0.1\"`"를 사실로 기술하고, 이 파일은 부트스트랩 시 사용자 번들 concept이 되어 게이트에 실린다. 이미 배포된 0.1.6 사용자 번들에도 들어가 있다. | CONFIRMED | `<WT>/templates/seed/en/references/okf-format.md:51`, `<WT>/templates/seed/ko/references/okf-format.md:48`, `<WT>/skills/okf-usage/SKILL.md:44` |
| 10.4 | **v0.2의 `generated`/`verified` 신뢰 등급(§5.2-5.3)과 actor 규약(§7)은 LLM이 쓴 메모리 번들에 맞는 축이다.** 배치 산출 = machine-confirmed, 사용자 확인분 = human-reviewed. Google 레퍼런스 visualizer도 trust tier/status/staleness를 표면화하도록 갱신됐다. | CONFIRMED | SPEC.md §5,§7; PR #227 |
| 10.5 | **확인된 커뮤니티 OKF 구현체는 전부 v0.1에 머물러 있고 규모가 극히 작다.** mattdav/okflint(star 4), rakibtg/okf-skill(star 4/fork 1 — 가장 직접 겹치는 경쟁자). Google 공식 툴링은 reference_agent(Python)와 kcmd CLI + MCP 서버뿐이고 **공식 validator·conformance checker·GitHub Action이 없다.** okf.md가 열거한 나머지 구현체는 개별 검증 안 함 — 확인 불가. 별도로 Claude Code 생태계에는 동일 카테고리 3종(theesfeld/claude-okf, scaccogatto/okf-skills, mattjoyce-okf)이 디렉토리에 등재돼 있다. | CONFIRMED (열거된 나머지는 확인 불가) | https://okf.md/tools/ , https://github.com/mattdav/okflint , https://github.com/rakibtg/okf-skill , https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf , https://github.com/hesreallyhim/awesome-claude-code/issues/2141 |
| 10.6 | **Claude Code 네이티브 auto-memory가 이미 이 머신에서 동작 중이다** — 프로젝트 3개, .md 10개. 무설정 1st-party 경쟁자다. 차이(사실 서술): 네이티브는 스키마 없는 자유형·벤더 종속·프로젝트별 격리, OKF는 벤더 중립 표준·전역·택소노미/lint/index. **비용 비교를 포함해 우열은 측정된 적이 없다** — 초안의 "비용이 0이다"는 미측정 주장이므로 삭제한다. | CONFIRMED (차이 서술) / 우열·비용은 **미측정** | `/Users/ducksu/.claude/projects/-Users-ducksu-side-project-okf-system/memory/MEMORY.md`, https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool |
| 10.7 | **SPEC v0.2에 "delete"라는 단어가 없다 — 위생 목적 은퇴의 스펙 정합 형태는 물리 삭제가 아니라 deprecation이다.** §5.4가 `status: draft|stable|deprecated`("deprecated: kept for links and history; no longer current", 부재 시 stable)를 정의하고, §6.1이 "Consumers MUST tolerate broken links"를, §9가 log 리딩 볼드워드 `**Deprecation**`을 관용으로 명시한다. 이는 okf-system 자신의 SCHEMA.md 규칙 4("파일 이동/개명 금지 — concept ID = 경로. 대체 시 새 파일 + 옛 파일에 superseded 산문")와 같은 방향이다. **그런데 okf-system은 `status`를 전혀 구현하지 않았다** — SCHEMA.md·lint.mjs·index-gen.mjs·prompts 어디에도 `status:` 문자열이 없고, `extractEntry`는 title/description만 뽑으므로 deprecated 표시를 해도 index에 동일 가중치로 실려 게이트 예산을 먹는다. | CONFIRMED | SPEC.md §5.4,§6.1,§9,§11; `<WT>/templates/SCHEMA.md:13`, `<WT>/lib/index-gen.mjs:25-37` |

### T11. 비용 — 얼마 쓰는지 아무도 모르고, 천장이 없다 (신규)

| # | 사실 | 상태 | 근거 |
|---|---|---|---|
| 11.1 | **`runClaude`가 CLI로부터 이미 받은 `total_cost_usd`를 호출자에게 반환하지 않고 버린다 — 벤치마크 환경변수가 켜졌을 때만 파일로 샌다.** `--output-format json`(:600)으로 파싱한 result에서 `total_cost_usd`/`usage`/`num_turns`를 갖고 있지만(:645-653) 쓰는 곳은 `if (process.env.OKF_BENCH_USAGE_FILE)`(:637) 안의 JSONL append뿐이고, 반환값은 `{ ok:true, output }`(:665)다. 그래서 `processChunkBody`(:808,:838)와 `runBatch`(:1029)는 자기 지출을 구조적으로 알 수 없고, `updateLastBatch`(:903-908)가 비용을 못 쓰는 이유는 '값이 없어서'가 아니라 '전달을 안 해서'다. **비용을 얻는 데 추가 API 호출·추가 지출이 전혀 필요 없다.** | CONFIRMED | `<WT>/bin/batch.mjs:600,637,645-653,665,903-908` |
| 11.2 | **`total_cost_usd`가 항상 제공된다는 것이 공식 문서와 저장소 실측 양쪽으로 확인된다.** 공식 headless 문서: `--output-format json`의 응답에 `total_cost_usd`와 모델별 분해가 포함되어 스크립트가 호출당 지출을 추적할 수 있다. 저장소 실측: 같은 경로로 기록된 v4 체인 배치 60회 전부 non-null(합계 $25.8086, 최소 $0.1834, 중앙값 $0.4423, 평균 $0.4301, 최대 $0.7711). 테스트 픽스처도 이미 `total_cost_usd: 0.001`을 낸다 — **회귀 테스트를 유료 실행 없이 쓸 수 있다.** | CONFIRMED | https://code.claude.com/docs/en/headless , `<WT>/docs/benchmarks/raw/okf-chain-live-2026-07-16T11-49-21-216Z.json`, `<WT>/docs/benchmarks/okf-benchmark-chain-2026-07-16-v4.md:7`, `<WT>/test/fixtures/fake-claude.mjs:31` |
| 11.3 | **라이브 로그·상태 파일 전체에 비용 기록 0건 — 배치 35회의 지출이 관측 불가.** 로그 5개(263줄) `grep -ric 'cost\|usd\|token'` 전부 0. 로그가 남기는 것은 '처리 대상 세션 N개, digest 합계 X KB', '청크 i 커밋 완료', '배치 종료: ok (잔여 raw: N)'뿐이고 `last-batch.json`은 `{lastRunEpochMs,lastResult,pendingAfter}` 3필드다. digest KB는 입력 크기일 뿐 출력·thinking·repair 재호출을 반영하지 않아 대리 지표로도 부족하다. | CONFIRMED | `/Users/ducksu/.claude/okf/.okf/logs/`, `/Users/ducksu/.claude/okf/.okf/last-batch.json`, `<WT>/bin/batch.mjs:907` |
| 11.4 | **35회 중 최소 10회가 유료 호출을 지불한 뒤 롤백했고, 그 낭비 금액은 어디에도 남지 않는다.** '배치 종료' 35회(07-15:4, 07-16:26, 07-17:4, 07-25:1). 같은 로그에 NO-OP 프로토콜 실패 롤백 9건 + 예외 롤백 1건 + lint 실패 후 repair 재시도 3건. 코드상 이 롤백은 전부 `runClaude` 성공 반환 **이후**이므로 LLM 비용은 이미 지불된 상태이고, repair는 그 위에 두 번째 유료 호출을 얹는다. v4 중앙값 $0.4423/회를 적용하면 **약 $4 이상이 지식 0개로 소각**된 셈인데(단, 이 곱셈은 v4 하니스 조건의 중앙값을 라이브에 외삽한 추정치다) 사용자가 알 수 있는 표면이 없다. | CONFIRMED (횟수) / 금액은 **외삽 추정** | `/Users/ducksu/.claude/okf/.okf/logs/batch-2026-07-16.log`, `<WT>/bin/batch.mjs:816-831,838,853-856` |
| 11.5 | **링거 루프 안의 `runBatch`에는 `batch_interval_hours` 게이트가 없다 — 8시간 링거가 5분 간격으로 유료 회차를 재발화할 수 있고 달러 천장은 존재하지 않는다.** 간격 게이트는 오직 `maybeSpawnBatch`(`lib/batch-gate.mjs:28`)에만 있고 이는 훅이 프로세스를 띄울지 결정할 때만 평가된다. 프로세스가 뜬 뒤의 `runLoop`는 `LINGER_POLL_MS`(5분) 간격으로 probe하다 유휴 세션이 생기면 `runBatch()`를 다시 호출하는데 `runBatch`(:910-1030) 어디에도 간격 검사가 없다. 회차 내부 상한도 달러가 아니다: `batch_max_digest_kb: 600` ÷ `CHUNK_BYTE_LIMIT 300KB` = 청크 최대 2개, 청크당 ingest 1 + repair 1 = 회차당 최대 4회 유료 호출. **이론상 한 링거에서 최대 96 사이클 × 4 = 384회가 가능하며 이를 막는 코드는 없다**(실제로 그렇게 도는 것을 관측하지는 못했다 — 상한 계산이다). | CONFIRMED (코드 경로) / 실제 발생은 **미관측** | `<WT>/lib/batch-gate.mjs:28`, `<WT>/bin/batch.mjs:22,27-28,910-1030,1020,1050-1069` |
| 11.6 | **일일 지출 상한 키를 넣을 자리는 이미 있고 기존 사용자 config.md를 건드리지 않아도 적용된다 — 단 동기화할 표면이 4곳.** `normalizeConfig`가 `{...DEFAULT_CONFIG}` 베이스 머지라 마이그레이션 불필요. `finiteNumber(min,max,integer=false)`는 세 번째 인자 생략 시 비정수를 허용하므로 `finiteNumber(0, 1000)`이 기존 컨벤션에 맞는다. 동기화 대상: `lib/config.mjs`(DEFAULT_CONFIG+VALIDATORS), `templates/config.md:3-7`, `commands/okf-config.md:17-27`과 `:34-38`(안전 범위 하드코딩 — 누락되면 커맨드가 잘못 안내한다), `README.md:311`·`docs/USAGE.md:50` 표. 부수: `templates/config.md:7`이 `batch_max_digest_kb`를 "실제 비용 상한"이라 적어놨는데 이는 입력 크기 상한이므로 정정 대상이다. | CONFIRMED | `<WT>/lib/config.mjs:40-46,48-66,69`, `<WT>/templates/config.md:3-7`, `<WT>/commands/okf-config.md:17-27,34-38` |
| 11.7 | **누적 지출을 적을 슬롯이 없고 `last-batch.json`은 회차마다 통째로 덮어써진다.** `okfPaths`에 원장 슬롯이 없고 `updateLastBatch`는 기존 파일을 읽지 않은 채 3필드 객체로 교체한다 — 누계를 넣으려면 read-modify-write로 바꿔야 한다. 날짜 경계는 로그가 이미 쓰는 `localDateString()` 재사용 가능. 필드 추가는 안전하다: 소비자 3곳(`batch-gate.mjs:24`, `statusline.mjs:67-72`, `commands/okf-status.md:25-27`)이 전부 필드 이름 접근이고 스모크도 필드 단위 단언이다. **단 `test/smoke.mjs:553`이 벤치 usage 레코드에 `!usageText.includes('result')`를 단언하므로 새 필드명에 'result'를 넣으면 깨진다.** | CONFIRMED | `<WT>/lib/paths.mjs:22-38`, `<WT>/bin/batch.mjs:42,906`, `<WT>/lib/batch-gate.mjs:24`, `<WT>/bin/statusline.mjs:67-72`, `<WT>/test/smoke.mjs:130-131,548,553` |
| 11.8 | **statusline과 `/okf:okf-status`에 비용을 붙일 지점이 명확하고 추가 I/O가 0이다.** statusline은 이미 `last-batch.json`을 파싱하므로(:66-72) 필드 하나를 더 꺼내는 것은 파일 읽기 증가가 없어 '매 턴 렌더되므로 절대 느리면 안 된다'는 설계 제약(:10-12)을 만족한다. 반면 `commands/okf-status.md`의 조사 항목 4개(:25-37)와 보고 형식 예시(:41-46)에는 비용 항목이 전혀 없어, 사용자가 '이상하다'고 느껴 커맨드를 실행해도 지출을 확인할 방법이 없다. | CONFIRMED | `<WT>/bin/statusline.mjs:10-12,59-60,66-72`, `<WT>/commands/okf-status.md:25-37,41-46` |
| 11.9 | **구독 사용자에게 피해 단위는 달러가 아니라 플랜 한도이며, `--no-session-persistence` 때문에 배치 소비가 `/usage` 분해에도 안 잡힐 가능성이 크다.** 공식 문서: 구독 플랜에서 Claude Code 사용량은 5시간 롤링 + 주간 좌석 할당량에서 차감되고 Claude chat과 공유되며, Max/Pro 구독자에게 세션 달러 수치는 청구 목적으로 무의미하다. `/usage`의 플러그인별 분해는 "computed from local session history on this machine"인데 OKF 배치는 `--no-session-persistence`로 돌아 로컬 히스토리를 남기지 않는다. 두 사실을 합치면 OKF 소비는 자체 로그에도 `/usage` 분해에도 귀속되지 않는다. **실제로 `/usage`가 이 배치를 누락하는지는 실행 관찰로 확인하지 않았다 — 확인 불가(추론).** | **확인 불가** (문서+코드 기반 추론) | `<WT>/bin/batch.mjs:595-597`, https://code.claude.com/docs/en/costs |

### 4-X. 반박되어 폐기·강등된 것 (이 조사의 신뢰성 근거)

**이전 조사에서 이미 폐기된 것 (재사용 금지)**
- **"번들이 커질수록 질문당 비용이 싸진다"** — 수학적 반증(기울기 OKF 66.3 vs 수동 24). v2에서 발행 후 철회.
- **"체인이 진행될수록 OKF 비용이 내려간다"(v4 P1)** — $0.231→$0.216→$0.258→$0.447 순증. zero_base arm도 같은 모양(Q4 난이도 대안설명).
- **"CLAUDE.md의 대략 절반 비용"** — 리포트 자신이 '분리 안 됨'이라 적은 셀에서 뽑았다.
- **"clean scenarios had zero memory reads"** — flagship 셀 okf 2/15가 실제로 읽었다.
- **"slim_buried에서 OKF가 더 싸다"(단독 진술)** — 정확도 9/15 vs 13/15, 자신있게 틀림 6/15 vs 2/15 병기 없이는 오도.
- **"사전등록 반증 기준이 하나도 발동하지 않았다"** — 4개 평가, R4는 컨트롤 오염으로 평가 불가.
- **"OKF만이 해법"** — CLAUDE.md도 rfcs_policy를 15/15로 답한다.
- **"v4 flake는 제품 결함"** — 하니스 측정 루프 내 spawnSync로 특정(T9.7).
- **"손익분기 23세션"** — 조건부 폐기. 정답률 27pp 차이로 인한 선택 편향 위에 있다. 병기 없이 인용 금지.

**이번 조사에서 새로 폐기·정정된 것**
- **"게이트 head와 DIR_DESCRIPTIONS가 매 세션 주입되는 유일한 런타임 표면"** — 거짓. prompts 2종·SCHEMA.md·commands/skills description이 같은 표면이다(T8.3).
- **"모든 index.md에 한글 코드포인트 0개"(항목 8 완료 기준)** — 라이브 번들에서 원리적으로 달성 불가. index 줄은 concept의 title/description 원문이고 라이브 22/22가 한국어를 포함한다(한글 1,874자 / 전체 5,327자). 기준을 '플러그인이 생성하는 문자열'로 좁힌다(T8, 항목 9).
- **"kube-scheduler 묘비 원문이 git 이력에 있다"** — 거짓. 커밋 1개·상태 A뿐이고 blob 크기가 현재와 동일하다(T3.11).
- **"`_remove_candidate/concepts/<date>/`로 옮기면 TTL 30일 가역"** — 거짓. gitignore 대상이라 git 관점 순수 삭제이고, purge 정규식에도 불일치해 영구 잔존한다(T3.6, T3.7).
- **"네이티브 auto-memory는 비용이 0이다"** — 미측정 주장. 삭제한다(T10.6).
- **"스타 사실상 0"** — 부정확. star 1은 실재 외부 계정이며(2026-07-22), 반대로 'clone unique 102 = 설치 102건'도 성립하지 않는다(T3장 채택).
- **"clone unique 102는 설치 대리 지표"** — 절반만 참. clone이 설치 경로인 것은 맞으나, 102는 생성 이틀 스파이크이고 CI로 설명 가능한 상한은 6.7%, 나머지는 **귀속 불가**다.
- **"view 0 = 아무도 안 봤다"** — 폐기. star 이벤트가 view 0인 날 발생해 undercount가 실증됐다.
- **"`node test/smoke.mjs` → 303 passed"** — **미검증으로 강등.** 이 조사는 스모크를 실행하지 않았다. 저장소 기록치는 254(`AI_HANDOFF.md:152`).
- **"프롬프트를 번역하면 lint가 깨진다"(우려)** — 근거 없음. lint는 언어 중립이다. 대신 깨지는 것은 `batch.mjs:646` 텔레메트리와 smoke 5건이다(T8.6, T8.7).
- **"스펙 v0.2가 나왔으니 현재 번들이 부적합"** — 거짓. §11 conformance·예약 파일명·index/log 규칙이 v0.1과 동일하고 v0.2가 하위호환을 명시 보장한다.

**미결이던 것 → 확정**
- `bench-okf.mjs`의 슬러그 결함은 "확인 필요"가 아니라 **결함 확정**(T6.1).
- `DECL_PATTERNS` 언어 누락은 "미지원"이 아니라 **거짓 사실 발행**으로 확정(T2.5).

---

## 5. v0.2 권고 스코프 — 우선순위 순

**릴리스 성격**: 신뢰성. 새 기능은 은퇴 명령과 비용 표면 둘뿐. **breaking 0건 → 0.2.0(minor).**
**릴리스 커트라인**: 1–9가 "쓸 수 있는 물건"의 최소 집합이다. 10–15는 여유가 있을 때. 항목 수가 15개인 것은 한 릴리스로 이미 상한을 넘는다는 점을 먼저 밝힌다. 그리고 3장 채택 실측에 따라 **이 릴리스의 검증자는 저자 1인이다 — 커트라인 판정 기준은 "외부 사용자에게 필요한가"가 아니라 "저자 도그푸딩에서 반증 가능한가"다.**

---

**1. 캡처 경계 확정** — L · breaking 아님(기본값 변화) · 근거 T1.1/1.2/1.4

`.okf/installed-at` 마커를 쓰고 sweep cutoff를 `max(now - 7d, installedAt)`로 잡아 설치 이전 대화를 기본 제외. 소급을 원하면 `sweep_backfill_days`(기본 0). `matchGlob`이 `<p>/**`를 `<p>` 자신 + 하위 전체로 정규화(또는 prefix 매칭으로 교체). 기본 `capture_exclude_cwd`에 OKF 자기 벤치/워크트리/스모크 패턴 시드. README quick start와 privacy 섹션에 소급 범위 명시.

*완료 기준*: 설치 이전 mtime transcript N≥20개가 있는 가짜 홈에서 첫 배치의 raw 복사 수 = 0, 유료 호출 stub 카운터 = 0. `sweep_backfill_days=7`에서만 N개 수집. `matchGlob('/Users/x/secret', ['/Users/x/secret/**']) === true`. 벤치·워크트리 모양 cwd 픽스처 수집 0개.

**업그레이드 사용자 주의**: `installed-at`을 '업그레이드 시각'으로 쓰면 미처리 과거 세션이 영구 배제된다 — 기존 번들에서는 `.okf/last-batch.json` 최초 기록 시각 또는 번들 git 첫 커밋 시각으로 소급 설정하고, 이 분기를 smoke로 고정한다.

---

**2. 비용 가시화 + 일일 지출 상한** — M · breaking 아님(필드 추가) · 근거 T11 전체 **[신규]**

(a) `runClaude` 반환값을 `{ok, output, costUsd, usage, numTurns}`로 확장한다. **실패·롤백 경로(:626/:663/:667)에서도 result가 파싱된 경우 costUsd를 실어 보낸다** — 지불하고 버린 회차의 지출을 잃지 않기 위해 필수다. `OKF_BENCH_USAGE_FILE` 게이트는 벤치 재현성을 위해 그대로 둔다. (b) `processChunkBody`가 ingest+repair 비용을 합산해 `runBatch`로 올리고 `updateLastBatch`가 기록한다 — `updateLastBatch`를 read-modify-write로 바꾸고 `{costUsd, spendTodayUsd, spendDate: localDateString()}`을 추가(`spendDate`가 다르면 리셋). **필드명에 'result' 문자열 금지**(smoke:553). (c) 로그 한 줄에 회차 비용 추가: `배치 종료: ok (잔여 raw: 0, 비용 $0.43)` — 숫자만이라 로그 프라이버시 원칙을 위반하지 않는다. (d) **`runBatch()` 진입부에 달러 하드 게이트**: 당일 누계가 `batch_max_usd_per_day`(신규, `finiteNumber(0,1000)`, 0=무제한)를 넘으면 즉시 `updateLastBatch(okfHome, 'skipped: daily spend cap')`로 종료. spawn 게이트가 아니라 **회차 게이트**여야 링거 루프까지 덮는다. 청크 루프에서도 누계를 재검사해 초과 시 남은 청크를 raw로 되돌린다. (e) statusline은 절제 원칙에 따라 상한 대비 소진율이 의미 있을 때만 표시(`OKF 42 · 1h ago · $0.44 today`). `commands/okf-status.md` §2에 비용 조사 항목, §3 예시에 한 줄 추가. (f) 설정 키 추가 4표면 동기화(T11.6) + `templates/config.md:7`의 "실제 비용 상한" 문구를 "입력 크기 상한"으로 정정. (g) 토큰 수(input/output/cache_read/cache_creation)도 함께 남긴다 — 구독 사용자에게 달러는 정가표 추정치일 뿐이고 실제 피해 단위는 플랜 한도다(`runClaude:641-643`에 이미 숫자 필터가 있다).

*완료 기준*: fake-claude(`total_cost_usd: 0.001`)로 (i) 정상 회차 후 `last-batch.json`에 `costUsd`·`spendTodayUsd`가 있고, (ii) NO-OP 롤백 회차에서도 지불액이 기록되며, (iii) `batch_max_usd_per_day`를 0.0005로 둔 픽스처에서 두 번째 회차가 `skipped: daily spend cap`으로 종료되고 유료 호출 stub 카운터가 증가하지 않는다. **유료 실행 없이 전부 검증 가능하다.**

*문서*: README/USAGE의 데이터 흐름 절에 사실 그대로 — "배치는 사용자의 기존 Claude Code 인증(OAuth/keychain 또는 ANTHROPIC_API_KEY)을 그대로 써서 대화형 세션과 동일한 계정에 과금된다. 구독 플랜에서는 5시간/주간 롤링 한도를 함께 소비하며 그 한도는 Claude chat과도 공유된다"(T5.5, T11.9). 공표 기준점은 "배치 1회 실측 중앙값 $0.44(v4 체인 60회, 범위 $0.18~$0.77)"로 하고, 이후 사용자 로컬 실측치가 그 자리를 대체하게 한다.

---

**3. 커밋 이후 실패 방어 + NO-OP 프로토콜 완화** — M · breaking 아님 · 근거 T2.2/2.4

`batch.mjs:893-897`의 archive 이동을 try/catch로 감싸고 실패 시 로그 + partial 종료. `await runLoop()`도 감싸 어떤 예외에서도 `updateLastBatch`가 남게 한다. NO-OP 선언을 자유 텍스트 완전일치가 아니라 **워크스페이스 마커 파일**로 바꾸고, 실패 시 배치 전체가 아니라 해당 청크만 skip.

*완료 기준*: archive 이동을 EACCES로 강제하는 테스트에서 (a) unhandled rejection 없음, (b) last-batch.json에 상태·비용 기록, (c) 다음 배치가 같은 세션에 LLM 호출 0회. 비-NO-OP 문자열 + 무변경 픽스처에서 해당 청크만 skip되고 나머지가 계속 처리되며 로그에 청크별 결과가 남는다.

---

**4. 게이트 예산 회귀 수정** — S · breaking 아님 · 근거 T7.3/7.4

**선택 정책은 건드리지 않는다.** 마커 바이트를 heading과 같이 선차감(최악의 경우 전 카테고리 생략을 가정한 상한 계산). `lines = 0; break;` → `continue`(종료는 기존 `progress` 플래그가 처리하므로 무한 루프 없음).

*완료 기준*: 생략 카테고리 0~6개 픽스처 전부에서 `truncateUtf8Bytes`가 실제 절단한 횟수 0, log.md tail 손실 0B(현행 218B). 4,000~14,000B 157개 샘플 스캔에서 starvation 0건(현행 79건).

---

**5. 조용한 손실을 시끄럽게** — M · breaking 아님 · 근거 T2.1/2.3/2.5/T5.1

(a) lint에 YAML 절단 검출 규칙: 원문 frontmatter의 raw 줄에 ` #`이 있고 파싱값이 더 짧으면 E/W. (b) `ingest.md`+SCHEMA.md에 title/description 큰따옴표 강제. (c) description 길이는 **상류에서 규율** — index 생성 시 절단이 아니라 `ingest.md`에 상한 명시 + lint W 경고(절단으로 구현하면 (a)가 고치려는 문장 중간 파편이 그대로 생긴다). (d) digest 캡 절단 로그: `세션 X: digest 242.6KB → 150KB 절단(중간 38% 손실)`. (e) `DECL_PATTERNS`·`IMPORT_PATTERNS`가 둘 다 없는 언어는 `skipped='no-extractor'`로 표시해 analyzedFiles로 집계하지 않는다. (f) **digest fallback을 '첫 실패에서 전체 원문 전송'에서 '실패 줄만 스킵하고 파싱된 줄로 계속'으로 바꾼다** — 스킵 건수를 로그에 남긴다. 이 한 줄이 T5.1의 tool_result 원문 유출 경로 대부분을 닫는다(항목 11의 나머지 봉인보다 비용 대비 효과가 크다).

*완료 기준*: 알려진 절단 2건을 픽스처로 검출, 나머지 20개에 오탐 0. 캡 초과 세션에 절단 로그 1줄. 함수 3개짜리 `deploy.sh`가 '선언 0개'로 보고되지 않는다. **'깨진 JSONL 1줄 + 뒤에 가짜 자격증명 tool_result' 픽스처에서 LLM에 전달되는 바이트에 그 자격증명 문자열이 0회 등장한다.**

---

**6. 회귀 테스트 축 확대 + 벤치 슬러그 공용화** — M · breaking 아님 · 근거 T9.3/T6.1/T9.7

슬러그 계산을 공용 헬퍼로 뽑아 `bench-okf.mjs`/`bench-chain.mjs`가 공유. 스모크 단언을 '식별자 존재'에서 값 비교로(`/a/b_c/.d` → `-a-b-c--d`). 헬퍼가 대상 디렉토리 부재 시 조용히 넘어가지 않고 '없음'을 기록. `bench-chain`의 측정 루프 내 `spawnSync` → `await spawn`, `setEncoding('utf8')`, result 없음 시 fail-loud + 1회 재시도. **벤치 실행은 하지 않는다.** 신규 테스트 축 최소 4개: 실제 동시 프로세스 락 경합 / 커밋 후 실패 / 손상된 상태 파일 / 대용량 digest.

*완료 기준*: `node test/smoke.mjs` 0 failed, skip 0(플랫폼 가드 skip은 출력에 명시). 위 4축 포함. **PR 본문에 실행 출력을 붙인다 — 이 조사가 테스트 수를 확인하지 못한 이유가 그것이 어디에도 기록돼 있지 않아서다.**

> **순서 제약**: 이 항목의 '실제 동시 프로세스 락 경합' 테스트는 **항목 11(락 재설계)보다 먼저** 작성되어야 한다.

---

**7. 되돌리기 수단 — `/okf:okf-deprecate`(v0.2) + `/okf:okf-purge`(설계만)** — L · breaking 아님 · 근거 T3 전체

**초안의 단일 `/okf:okf-forget`은 폐기한다.** '되돌릴 수 있어야 한다'와 '지워져야 한다'는 같은 도구로 동시에 만족할 수 없고, `_remove_candidate/` 경유 설계는 두 목적 어느 쪽에도 맞지 않는다(T3.6, T3.7).

**(A) `/okf:okf-deprecate <path|검색어>` — v0.2 스코프.** 위생·오염 정리용. 파일을 **옮기지 않고** frontmatter에 `status: deprecated`를 세팅한다. 스펙 정합(§5.4), 가역(값 되돌리면 끝), TTL 문제 없음, git 이력 문제 없음. 함께 필요한 것: `extractEntry`가 status를 읽어 deprecated concept를 하위 index에서 제외(그래야 게이트 예산을 안 먹는다), SCHEMA.md에 status 필드 규정 추가, lint에 status 값 검증(W), `ingest.md`에 "deprecated 개념은 다시 살리지 마라". log.md에 `**Deprecation**` 항목 추가(§9 관용).
- **명령은 락을 존중하고, 자기 실행 안에서 `commitAll`까지 마쳐야 한다** — dirty 워킹트리를 남긴 채 끝나면 다음 배치의 stale-lock 무조건 rollback에 되돌려지거나 `pre-batch: user edits`로 커밋되거나가 비결정적으로 갈린다(T3.8). 현재 락은 `bin/batch.mjs`만 잡는다.
- 부수로 `ingest.md`에 "동일 사실의 N번째 반복 관측은 새 섹션으로 추가하지 말고 기존 섹션의 카운터만 갱신하라"를 넣는다(T3.5). 배치의 은퇴 계약은 판단만 LLM, 파일 조작은 코드(Rule 5)이며 마커 파일 메커니즘을 항목 3의 NO-OP 신호와 **통일해 계약을 하나만 늘린다.** 계약 문서에 **회차당 은퇴 상한 3건**, **자동 삭제는 어떤 경우에도 없다**를 문장으로 명시.
- stale-lock 무조건 rollback은 `_remove_candidate/pre-rollback/<date>/` 백업 후 원복으로 바꾼다. pre-batch lint 실패 시 `/okf:okf-status`가 최상단에 '수동 편집이 lint를 깨서 배치가 멈춰 있음 + 파일 + 규칙'을 보고.

*완료 기준*: deprecate 후 (a) 파일이 제자리에 있고 `status: deprecated`, (b) 카테고리·루트 index.md에서 해당 줄 부재(또는 명시적 접미 표기), (c) 게이트 조립 바이트가 그만큼 감소, (d) `runLint()` error 0, (e) 워킹트리 clean(자체 커밋 완료), (f) **커밋 직후 stale-lock 배치를 돌려도 status가 되살아나지 않는다**, (g) `grep -rn '<대상 경로>' *.md` 결과를 명령이 스스로 확인해 log.md 잔존 참조를 사용자에게 보고한다(T3.9). 동일 digest 연속 2회 투입 시 번들 총 바이트 증가가 1회차 대비 5% 이하.

**(B) `/okf:okf-purge` — v0.2에서는 설계 문서만.** 프라이버시용. 완료 기준에 **'git 이력에서 해당 blob이 사라졌음을 `git rev-list --objects --all | git cat-file --batch-check`로 검증'**을 포함해야 하고, 구현은 이력 재작성(filter-repo 또는 orphan 커밋 재구성) + `reflog expire --expire=now --all` + `gc --prune=now`를 포함해야 한다. 표면 목록을 명시: concept 파일 / 모든 index.md(재생성) / log.md 본문 / 이 셋의 git 이력. **`_remove_candidate/`를 경유해서는 안 된다** — gitignore 안이든 밖이든 평문 사본을 남기는 순간 목적을 배반한다. 비가역이므로 사람 확인 절차 필수. 첫 검증 픽스처로는 현재 kube-scheduler 스텁 2건이 적합하다(§5.4 관점에서 정확히 deprecated 대상이기도 하다).

> **스코프 충돌 명시(Rule 7)**: 6장은 "스펙 v0.2 마이그레이션 전체"를 제외한다. `status`는 그 예외다 — additive이고(부재 시 stable) 기존 번들을 변환하지 않으며 새로 은퇴하는 concept에만 붙는다. 다만 SCHEMA.md에 필드를 추가하면 `schema_version` 승격 여부를 의식적으로 결정해야 하고(항목 9와 얽힌다), 이는 7장 열린 질문이다.

---

**8. 첫 실행 신호 — 1회성 온보딩 + 첫 ingest 확인** — S · breaking 아님 · 근거 T8.8

항목 1이 만드는 `.okf/installed-at` 마커를 재사용해, 최초 1회만 `suppressOutput` 없이 안내 블록을 낸다: 번들 절대경로 / 첫 지식 예상 시점(마지막 활동 +60분) / `/okf:okf-status` / 소급 수집 기본값 0과 `sweep_backfill_days` 키 이름 / **배치가 사용자 계정에 과금된다는 사실과 `batch_max_usd_per_day` 기본값**. 첫 ingest 성공 다음 세션에 "OKF가 N개 concept를 처음 기록했다(비용 $X)" 1줄.

> 항목 1이 수집을 **줄이는** 변경이라 침묵 구간이 더 길어진다. 안내를 v0.3으로 미루면 순서가 거꾸로다.

*완료 기준*: 최초 부트스트랩 세션 stdout에 블록 정확히 1회, 두 번째 세션 0회. 위 5개 요소 전부 문자열 단언.

---

**9. 런타임 언어 계약 — 기본 en** — M · breaking 아님(복구 가능) · 근거 T8.1~8.7

초안은 "게이트 head + DIR_DESCRIPTIONS만"이었으나, T8.3이 그 전제를 반증했으므로 **범위를 조정한다.**

포함: (a) 게이트 head + `DIR_DESCRIPTIONS` 문자열 테이블 분리, `seed_language`를 `bundle_language`로 승격, 기본값 en, `bundle_language: ko`로 완전 복구. (b) **commands 5종·skills 2종의 frontmatter description을 영어로 전환** — 7줄이고, 이것들은 매 세션 도구 카탈로그로 컨텍스트에 상주하므로 게이트와 동일한 런타임 표면이다. 8개 언어 번역이 아니라 en 단일 전환이므로 유지보수 계약이 늘지 않는다. (c) **`ingest.md`에 산출물 언어 규칙 1줄 추가** — 이것이 없으면 프롬프트만 영어로 옮겼을 때 한국어 digest에서 영어 concept가 나오는 반대 회귀가 생긴다(현재 규칙이 아예 없다는 것이 T8.2다). (d) `bundle_language`를 README(최소 en/ko)와 USAGE 설정 표에 문서화 — 현재 `seed_language`는 저장소 전체에서 한국어 주석 1줄뿐이다.

제외(명시적): prompts/SCHEMA.md/config.md 본문의 전면 영어화는 **v0.2 범위 밖으로 기록한다.** 이유는 `schema_version` 승격 문제다 — 올리면 기존 사용자의 로컬 편집까지 덮이고, 안 올리면 영어화가 영원히 도달하지 않는다(T8.3). 중간 선택지가 코드에 없으므로 별도 설계가 필요하다.

*완료 기준*(초안의 달성 불가 기준을 교체): **기본값 en에서 "플러그인이 생성하는 문자열"** — 게이트 head, `DIR_DESCRIPTIONS`, 루트/카테고리 index 헤더, commands/skills description — 에 한글 코드포인트(U+AC00–U+D7A3) 0개. **사용자 concept의 title/description 언어는 이 항목이 아니라 (c)의 프롬프트 규칙이 담당한다**(라이브 22/22가 한국어이므로 index 본문 한글 0은 원리적으로 불가능하다). `bundle_language: ko`에서 현행 출력과 골든 일치.

*체크리스트(번역 시 조용히 깨지는 것)*: `batch.mjs:646`의 `prompt.includes('lint 오류 리포트')` 판정을 **명시적 stage 인자로 교체**(문자열 결합 제거), smoke의 프롬프트/시드 substring 단언 6건(:1129,:1135,:1145-1147,:1161) 동시 갱신. **`DIR_DESCRIPTIONS` 변경은 전 index.md 재생성을 유발하므로, 그 커밋이 lint를 통과하는지 실번들 사본에서 먼저 확인할 것.**

---

*— 여기까지가 릴리스 커트라인 —*

---

**10. 유출 경로 봉인 (나머지)** — M · breaking 아님 · 근거 T5.1/5.2/5.4

(a) 항목 5(f)로도 fallback이 남는 경우 최소한의 패턴 레닥션(`Authorization:` 헤더, `-----BEGIN ... PRIVATE KEY-----`, 일반적 토큰 형태) 적용. (b) 분석기 Read를 `--add-dir`/권한 규칙으로 워크스페이스 한정, 최소한 '워크스페이스 밖 Read'를 로그에 남긴다. (c) `applyAnalyzerWorkspace`가 `ensurePrivateDir`/`writePrivateFile`을 쓰게 한다. (d) README privacy 섹션에 "digest에는 발화 원문이 그대로 들어가며 리댁션은 없다", "파싱 실패 세션에서는 tool_result 원문이 전달될 수 있다"를 알려진 한계로 명시.

*완료 기준*: 배치가 만든 concept 0600, 새 디렉토리 0700(POSIX). 레닥션 픽스처에서 토큰 문자열이 전달 바이트에 0회.

---

**11. 배치 상태 정직성** — L · breaking 아님 · 근거 T4.1~4.5

락 획득 직후 `{lastResult:'running', startedEpochMs}` 선기록 → 다음 배치가 stale lock 회수 시 `'crashed'` 확정. statusline이 crashed를 ok/noop과 구분. TOCTOU 수정(고유 임시파일 + rename/link 경합 또는 회수 후 재판독으로 자기 PID 확인), releaseLock은 pid가 자기 것일 때만 unlink. 락 페이로드에 프로세스 시작시각 추가(PID 재사용 판별) 또는 heartbeat. 링거 마커 파일. ENOENT/EACCES는 프라이버시 위험이 없으므로 특별 처리해 `claude 실행 파일을 찾지 못함 — config.md의 claude_bin에 절대경로를 지정하라`를 로그와 lastResult에 남긴다. `claude_bin`/`node_bin`을 README 8개와 USAGE 표에 추가.

*완료 기준*: SIGKILL 후 다음 배치에서 lastResult == 'crashed'이고 statusline에 노출. PATH에 claude 없는 환경에서 lastResult가 사람이 읽을 수 있는 문장을 담고 그 문자열에 transcript 원문이 섞이지 않는다. **실패한 회차가 얼마를 태웠는지 보인다**(항목 2와 결합).

> **조건부 항목.** 항목 6의 동시 프로세스 경합 테스트가 **먼저** 작성되지 않으면 v0.2.1로 미룬다. 잘못 만들면 '중복 spawn은 안전하다'는 현재 전제 대신 '아무 배치도 못 돈다'가 된다.

---

**12. Windows 실검증** — M · breaking 아님 · 이슈 #5 · 근거 T9.1/9.2

win32에서도 `shell:false`로 실행하고 .cmd/.bat는 `cmd.exe /d /s /c` + `windowsVerbatimArguments`로 감싸거나, 최소한 shell:true 경로의 모든 인자를 따옴표로 감싼다. TEMP_CWD를 `/i`로 바꾸고 `appdata-local-temp-`, `windows-temp-` 추가. CI에 **공백 포함 TEMP/claude_bin 경로 매트릭스** 추가.

*완료 기준*: 공백 포함 경로 조건에서 1청크 ingest 성공(현재 이 조건의 테스트 자체가 없다). Windows 모양 슬러그 2종이 `isOkfTestSessionDir`에 걸린다.

> icacls 구현은 하지 **않는다** — 항목 13에서 해당 문장을 삭제하는 것이 최소 안전선이고, 구현하면 검증 불가능한 주장을 다시 만들 위험이 있다.

---

**13. 발행된 사실 정정 + 스펙 고정 해제** — L(문서량)/S(코드) · breaking 아님 · 근거 T6.1~6.5, T10.2

코드 2줄: (a) `lint.mjs:130` 권장 필드에서 `timestamp` 제거 — **okf_version 승격도 generated.at 마이그레이션도 하지 않는다.** 폐기된 필드를 배치에게 W2로 강요하는 것을 멈추는 것뿐이다(마이그레이션 0, breaking 0). (b) `bench-okf.mjs:424` 슬러그(항목 6에서 처리).

문서: 8개 언어에서 `zero memory reads` 계열 삭제, `절반 비용` 주장 삭제 또는 '이 셀에서 비용 분포는 분리되지 않는다'로 교체, `Windows uses account ACLs` 삭제, slim_buried 행에 정답률 9/15 vs 13/15와 자신있게 틀림 6/15 vs 2/15 병기, rfcs_policy를 '11/15(오염 2건 포함) / 보수적 하한 9/15'로 재발행, 헤드라인 2절('CLAUDE.md가 이긴다')을 근거에 맞게 재작성. v3 리포트 R4 칸을 '평가 불가'로, :168을 '4개 평가, R4는 컨트롤 오염으로 평가 불가'로 정정. README 배지와 `AGENDA.md:7`의 v0.1 서술을 v0.2로. **"최초의 v0.2 구현"이라고 주장하지 마라 — 구현하지 않았다.** 문구는 en에서 먼저 확정하고 일괄 반영.

v0.3용 원칙을 지금 문서에 못 박는다: (i) `timestamp`를 제거하지 말고 `generated.at`을 **병기**해 additive로 착지. (ii) okf_version 승격은 **마이그레이션 성공 커밋에서만** — 내용이 v0.1 방언인데 헤더만 0.2로 올리는 것은 거짓 선언이다. (iii) 스펙 마이그레이션의 **선행 조건은 항목 3과 항목 11**이다.

*완료 기준*: README 8종에서 해당 문자열 grep 0건, 배지 `OKF-v0.1` grep 0건. slim_buried 행에 `9/15`와 `13/15` 동시 등장.

---

**14. 기여자 유입 표면 + 릴리스 발행** — S · 근거 T9.4/9.5/2.5, 3장 채택 실측, 이슈 #4/#5

CONTRIBUTING.md(`node test/smoke.mjs` 실행법 + **유료 벤치 `OKF_RUN_LIVE_BENCH=1` 실행 금지 경고** + PR 규약), 이슈/PR 템플릿, good first issue 3건 등록 — `analyze.mjs` 추출기 부재 5개 언어 / `viz.mjs` 중첩 도메인 미탐 / `paths.mjs` Windows TEMP_CWD. 셋 다 **고치지 말고** 파일:라인 + 재현 절차 + 기대 동작 + 검증 명령과 함께 등록만 한다.

추가(채택 실측 근거): **git tag + GitHub Release를 발행한다.** 현재 release 0건이라 14일 롤링 traffic API 외에 채택을 관측할 경로가 아예 없다. 비용 0이다. 그리고 **버전 드리프트를 보이게 한다** — 저자 본인 설치본조차 9일 뒤처진 `102af6e`에 고정돼 있었고 아무 신호도 없었다. 최소한 설치된 version 문자열을 `/okf:okf-status`에 표기한다. 외부 채널 제출(awesome-claude-code 등)은 **반드시 사람이 직접.**

---

**15. E1 사전등록 + 실행 ($0, 유료 호출 없음)** — M · 근거 T7.1/T7.2 + v3:179

게이트 recall@cap. 이미 커밋된 `docs/benchmarks/bundles/`, `bundles-chain-v4/`와 라이브 형태로 N=8/22/50/100 번들을 조립하고, 정답이 특정 concept에 있는 고정 질문 20개에 대해 '그 줄이 캡을 통과하는가'를 결정론적으로 센다. **이 릴리스에서 게이트 선택 정책 코드는 바꾸지 않는다** — 재는 것만 한다. 조건 2개: (a) 질문 20개·정답 concept·**반증 기준을 구현 전에 커밋**한다("N=50에서 목표 줄 생존율 90% 이상이면 라우팅은 병목이 아니므로 v0.3에서 게이트를 건드리지 않는다"). (b) 질문 세트에 **현재 cwd와 무관한 concept가 정답인 문항을 반드시 포함** — 라이브 patterns 6건(playwright/GitHub Actions/git filter-repo 같은 툴체인 함정)처럼 어떤 프로젝트에도 매칭되지 않는 것이 OKF의 유일한 구조적 차별점이고, 빼면 v0.3 라우팅이 자기 차별점을 차단하는 방향으로 튜닝된다.

*완료 기준*: N별 생존율이 입력 번들·질문 20개·재현 명령과 함께 `docs/benchmarks`에 커밋되어 v0.3 사전등록에서 인용 가능한 형태.

---

## 6. v0.2에서 명시적으로 빼는 것

| 뺀 것 | 이유 |
|---|---|
| **OKF 스펙 v0.2 마이그레이션 전체** (okf_version 승격, generated.at, sources, 신뢰 등급, stale_after, seed 갱신 전파) | 가장 탐나는 항목이고 '최초의 v0.2 구현' 선점 창도 실재한다. 그러나 breaking 2건을 포함하며 기존 사용자 번들 전체를 건드리는 마이그레이션인데, **그것을 실행할 배치·락·롤백 경로가 지금 신뢰할 수 없다**(T2.2 커밋 후 archive 실패, T4.2 TOCTOU 이중 회수 실제 로그, T3.4/3.8 stale-lock 무조건 rollback). 깨진 파이프라인 위에서 전 번들 변환을 돌리는 것은 이 조사가 찾은 모든 실패 모드를 한 번에 소환한다. 스펙이 하위호환을 보장하므로 **긴급하지 않다.** v0.3 단독 주제. **예외는 `status` 하나** — additive이고 마이그레이션이 없으며 항목 7이 그것 없이는 스펙과 어긋난 삭제를 구현하게 되기 때문이다(T10.7). |
| **게이트 관련성 라우팅 재설계** (cwd 매칭, timestamp 최신순 축출, round-robin 폐기) | 조사가 지목한 최대 개선 여지이고 T7.1/7.2는 확실하지만, 이건 결함 수정이 아니라 **새 정책**이다. E1이 아직 안 돌았다. 근거 없이 튜닝하면 v2의 '비용 곡선' 철회를 반복한다. v0.2는 자기 의도를 깨는 두 회귀(항목 4)만 고치고 정책은 그대로 둔다. E1은 $0이므로 병행(항목 15). |
| **서브에이전트 전사 수집** (T1.5, 58MB·77%) | 수율 관점 최대 미수집 자원이지만 **v0.2는 캡처를 좁히는 릴리스다.** 같은 릴리스에서 범위를 77% 넓히면 항목 1의 효과를 측정할 수 없고, digest 150KB 캡이 이미 물린 상태(T2.3)에서 입력만 늘리면 절단 손실이 커지며, 항목 2의 지출 상한 기본값을 정할 근거도 흔들린다. v0.3. |
| **prompts/SCHEMA.md/config.md 본문의 영어화** | 항목 9는 게이트·index 라벨·commands/skills description·산출물 언어 규칙까지다. 본문 영어화는 `schema_version` 승격 딜레마(올리면 사용자 로컬 편집을 덮고, 안 올리면 도달하지 않음, 중간 선택지가 코드에 없음 — T8.3)를 먼저 설계해야 한다. **범위 밖임을 문서에 기록한다.** |
| **ja/zh-CN 시드 추가와 `seed_language` 실동작 수정** (이슈 #3) | 항목 9가 `bundle_language`를 신설하므로 시드 언어 축은 그 위에 올려야 순서가 맞다. v0.3. |
| **`/okf:okf-purge` 구현** (이력 재작성) | 설계 문서만 v0.2. 구현은 이력 재작성이므로 비가역이고, 항목 7(A)의 가역 경로가 실전 검증된 뒤에 붙인다. |
| **`_remove_candidate` 175MB / `~/.claude/projects` 테스트 잔재 정리 커맨드** | 저자 머신 한정 오염이고, 사용자 홈을 스캔해 대량 삭제를 제안하는 커맨드는 그 자체로 위험도가 높다. 선행으로 **TTL purge 첫 실행(2026-08-14 전후)을 관측할 것**(T9.8 — 이 코드는 아직 한 번도 안 돌았다). |
| **viz 중첩 도메인, primaryLanguages 정렬, 죽은 코드 제거** (T9.4/9.5/9.6) | 조용한 은폐이긴 하나 지식이 유실되지 않고 게이트·배치 핵심 경로가 아니다. 항목 14로 good first issue 등록만. |
| **E2 저장소 간 전이 벤치마크 (≈$28)** | OKF가 CLAUDE.md와 다른 유일한 축을 처음 재는 실험이지만, v0.2가 캡처 경계·락·NO-OP 프로토콜·게이트 예산을 전부 바꾸므로 **그 전에 측정하면 v0.2 이후 코드에 대해 아무것도 말해주지 않는다.** 선행조건(슬러그 공용화, spawnSync 제거, README 정정)은 v0.2에 포함. 실행은 v0.3, 사전등록 후. |
| **v3/v4 재실행, 체인 길이 확장** | **이미 반증된 방향이다.** v4의 실제 한계는 체인 길이가 아니라 Q1~Q4 난이도 미통제다. 같은 저장소 안에서 OKF vs CLAUDE.md를 또 재는 것도 금지 — v3가 이미 n=15로 쟀고 결론은 '분리 안 됨'이다. |
| **네이티브 auto-memory 대비 우위 주장** | 비교 데이터가 0이다(비용 포함). v0.2에서는 **근거 없는 우위를 README에 쓰지 않는 것**으로만 대응한다. 차별점은 사실 서술로만: 벤더 중립 표준 / 전역 번들 / 택소노미·lint·index. |
| **SPEC §10 Attested Computation** | `runtime`/`executor`/`attester`/`receipt`는 BigQuery 지표·재무 계산 검증용이고 세션 지식과 도메인이 다르다. §11이 미지 type 거부를 금지하므로 몰라도 부적합이 아니다. **문서에 명시적 제외로 적어 "왜 안 했나"를 미리 닫는다.** |
| **"수율"·"번들 성장"·"clone 102"를 릴리스 노트 근거로 쓰는 것** | 라이브 raw 443개 중 실사용은 21~27개(5~6%)이고, clone unique 102는 생성 이틀 스파이크로 6.7%만 CI로 설명되고 나머지는 귀속 불가다. 이 숫자들로 성장 서사를 쓰지 않는다. |

---

## 7. 열린 질문 — 사용자 결정이 필요한 것

1. **릴리스 커트라인.** 15개는 한 릴리스로 과하다. 권고는 1–9이지만, 어디서 자를지는 일정에 달렸다. 항목 11(락)은 조건 미충족 시 자동으로 v0.2.1이다. 그리고 3장 채택 실측을 받아들이면 커트라인 기준은 **"저자 1인 도그푸딩에서 반증 가능한가"**여야 한다 — 이 재정의를 승인할 것인가.

2. **`batch_max_usd_per_day` 기본값.** v4 실측 중앙값 $0.4423/회를 기준으로 하루 몇 회차를 허용할 것인가(예: 2.0 = 약 4~5회차). 0(무제한)을 기본값으로 두면 T11.5의 구조적 위험이 그대로 남는다. 구독 사용자에게는 달러가 아니라 플랜 한도가 실제 단위라는 점도 함께 고려해야 한다.

3. **기본 언어를 en으로 전환할 것인가.** 항목 9는 **당신 본인의 라이브 번들 게이트를 영어로 바꾼다**(`bundle_language: ko`로 복구 가능). DIR_DESCRIPTIONS 변경은 전 카테고리 index.md 재생성이라 큰 diff가 난다. 개인 사용성 vs 비한국어 시장 접근의 트레이드오프다.

4. **SCHEMA.md에 `status`를 추가하며 `schema_version`을 올릴 것인가.** 올리면 기존 사용자의 SCHEMA.md 로컬 편집이 템플릿으로 덮인다(라이브에서 이미 한 번 발동한 경로다 — 커밋 `0aab3b8`). 안 올리면 `status` 규정이 기존 번들에 영원히 전파되지 않는다. 중간 선택지가 코드에 없다.

5. **업그레이드 사용자의 `installed-at` 소급 기준.** '번들 git 첫 커밋 시각'(=과거 미처리 세션을 계속 수집)인가 '업그레이드 시각'(=영구 배제)인가. 후자는 조용한 지식 유실이 될 수 있다.

6. **README의 flagship 승리를 9/15로 낮추는 것.** 오염 2건 보정은 데이터가 지지한다(방향 유지, p=0.0007). 그러나 star 1인 상태에서 유일한 승리 서사를 축소하는 것은 단기적으로 채택에 불리하다. 정정을 권고하지만 **발행 여부는 결정 사항**이다. (조사의 판단: 유지 비용이 더 크다 — 저장소 안의 raw JSON이 그 문장을 반박한다.)

7. **라이브 번들 오염 4건의 직접 정리.** kube-scheduler 묘비 2건, rust MSRV thaw rule 등. 항목 7(A)이 도구를 주지만 **방아쇠는 사람이 당긴다.** 이 조사는 읽기 전용이라 아무것도 건드리지 않았다. 정리하지 않으면 references 게이트 슬롯 100% 낭비가 v0.2 배포 후에도 그대로다.

8. **E1 질문 20개와 정답 concept 선정.** 사전등록이므로 사람이 서명해야 한다. 에이전트가 고르면 자기채점이 된다.

9. **스펙 v0.2 마이그레이션을 v0.3로 미루는 판단 확인.** 미루면 '최초의 v0.2 Claude Code 플러그인' 선점 창이 닫힐 수 있다(경쟁 구현체는 star 4 규모 2개, 전부 v0.1). 이 선점 가치는 **측정된 적이 없는 마케팅 가설**이고, 반대편에는 깨진 파이프라인 위에서 전 번들 변환을 돌리는 실재 위험이 있다. 권고는 미루기이지만, 선점을 우선한다면 항목 3·11을 먼저 완료한 뒤 0.2.1로 붙이는 경로가 유일하게 안전하다.

10. **노출 대 신뢰성의 배분.** 발견 가능성이 사실상 0이고(검색 미노출, referrer 없음, release 0) 외부 피드백 채널이 한 번도 작동하지 않았다. 신뢰성 15개를 다 태우기 전에 노출 1건(디렉토리 등재 — **반드시 사람이 직접 제출**)을 병행할 것인가.

11. **`/usage` 귀속 여부 1회 수동 관찰.** 배치 소비가 Claude Code의 플러그인별 사용량 분해에 나타나는지 확인은 무료다. v0.2 착수 시 한 번 보고 문서 문구를 확정할 것인가.

---

### 부록: 이 릴리스가 스스로에게 거는 반증 장치

- **채택 트리거를 view에서 clone/star/issue로 교체한다** — view 시계열은 undercount가 실증됐다(star 이벤트 당일 view 0). v0.2 이후 신규 이슈·문의에 '아무것도 안 쌓인다'류 보고가 나오면 항목 1·11이 유효했다는 신호다. **주간 clone 0 && star 증가 0 && 외부 issue 0**이 계속되면 병목은 첫 실행이 아니라 발견 가능성이므로 v0.3의 각도를 바꾼다.
- E1이 'N=50에서 생존율 90% 이상'을 내면 게이트 라우팅은 병목이 아니므로 **v0.3에서 게이트를 건드리지 않는다.**
- **v0.2 배포 2주 뒤 자기 `last-batch.json`의 `spendTodayUsd` 분포를 본다.** 중앙값이 v4 실측($0.44/회)과 자릿수가 다르면 벤치 조건이 실사용을 대표하지 않는다는 뜻이고, 그 경우 v3/v4의 비용 결론 전체가 외적 타당성 문제를 갖는다.
- TTL purge 첫 실행(2026-08-14 전후) 로그를 확인한다 — 그 코드는 아직 한 번도 돌지 않았다.
- traffic 원자료는 2026-07-29~30에 소멸한다. 3장 표가 유일한 사본이다.

---

## 이 조사의 한계

이 프로젝트는 과장으로 두 번 철회한 이력이 있다. 아래는 이 리포트가 **하지 못한 것**과 **신뢰도가 낮은 항목**이다.

**실행하지 않은 것 (읽기 전용 제약)**
1. **스모크를 돌리지 않았다.** 따라서 "테스트 N개 통과"를 이 리포트는 주장하지 않는다. 초안의 303은 근거가 없어 삭제했고, 저장소 기록치 254(`AI_HANDOFF.md:152`)도 현재 코드 기준으로 재확인된 값이 아니다. **T9.3의 '커버 안 되는 축 7개'는 코드 읽기 기반이며 실행으로 확인한 것이 아니다.**
2. **유료 벤치마크를 실행하지 않았다.** 비용 수치는 전부 기존 raw JSON(`okf-chain-live-2026-07-16T11-49-21-216Z.json`) 재집계다. 그 데이터셋 자체가 harness flake 11.7%를 포함하고(T9.7), 벤치 조건(합성 저장소, 4문항 체인)이 실사용을 대표한다는 근거는 없다. **"배치 1회 $0.44"를 실사용 기대값으로 인용할 때 이 한계를 함께 적어야 한다.** T11.4의 "$4 이상 소각"은 그 중앙값을 라이브 롤백 횟수에 곱한 외삽이지 측정치가 아니다.
3. **T5.1(digest fallback 원문 유출)과 T11.5(링거 무제한 재발화)는 코드 추적으로만 확정했다.** 픽스처 실행 재현을 하지 않았으므로, 다른 경로가 실제로 막고 있을 가능성을 완전히 배제하지 못한다. 특히 T11.5의 "최대 384회"는 상한 계산이고 실제 발생을 관측한 것이 아니다.
4. **`/okf:okf-forget`/`deprecate`의 동작은 전부 설계 단계다.** stale-lock 부활(T3.8), purge 정규식 우회(T3.7), gitignore 상호작용(T3.6)은 코드와 라이브 저장소 상태로 확정했으나, 명령 자체가 없으므로 통합 동작을 시연한 것은 아니다.

**검증하지 못한 인과**
5. **영어 digest에서 실제로 어떤 언어의 concept가 나오는지 모른다**(T8.2). 라이브 22/22가 한국어이지만 사용자가 한국어 화자라 프롬프트 언어와 대화 언어가 교란돼 있다. "프롬프트가 한국어라서 산출물이 한국어다"는 **구조적 사실(언어 규칙 부재)은 확정, 인과는 미검증**이다.
6. **`/usage`의 플러그인별 분해가 OKF 배치를 누락하는지 확인하지 못했다**(T11.9). 공식 문서 두 문장과 `--no-session-persistence` 코드를 합친 추론이다.
7. **Windows는 실기 검증이 없다**(T9.1). `shell:true` 인용 문제는 macOS 등가 실험으로 메커니즘만 실증했다.

**표본과 귀속의 한계**
8. **실번들 통계는 전부 n=1이다.** 사용자 1명, 머신 1대, 10일, 한국어 화자, 그리고 그 사용자가 개발자 본인이다. "concept의 9.1%가 YAML 절단", "raw의 5~6%만 실사용", "게이트 캡 100% 포화" 같은 수치는 **단일 번들의 성질이지 사용자 일반의 성질이 아니다.**
9. **clone 2,302회 중 약 2,130회의 출처를 설명하지 못한다.** CI 상한 6.7%를 뺀 나머지는 귀속 불가다. GitHub이 Actions checkout을 unique 집계에서 어떻게 dedupe하는지도 확인하지 못했으므로, **"unique 102 중 몇이 사람인가"는 이 조사로 답할 수 없다.** star 1(Corykidios)만이 확정된 외부 인간 신호다.
10. **로그 기반 카운트는 로그가 남은 구간만 센다.** 배치 시작 37회/종료 35회/롤백 10회는 `.okf/logs/` 5개 파일의 문자열 집계이며, 로그가 유실되거나 프로세스가 로그 쓰기 전에 죽은 구간은 셀 수 없다. 시작과 종료의 차이(2회)도 그런 성질이다.

**외부 자료의 시의성**
11. **OKF SPEC v0.2는 발표 익일에 확인했다.** 2차 매체가 전무하고 발표 직후라 이후 수정될 수 있다. §5.4 `status` 해석은 SPEC 원문 2회 조회에 근거하나, 레퍼런스 구현으로 교차 검증하지는 않았다.
12. **okf.md가 열거한 커뮤니티 구현체 대부분을 개별 확인하지 않았다**(T10.5). 확인한 것은 2개뿐이다.
13. **경쟁 플러그인 3종(claude-okf, okf-skills, mattjoyce-okf)의 내용은 읽지 않았다.** 검색 결과에 등장한다는 사실만 확인했다 — 기능 비교가 아니다.

**판단이 섞인 항목 (사실이 아님)**
14. **항목별 공수 추정(S/M/L)에는 근거가 없다.** 코드 규모에서 온 감각치다.
15. **우선순위와 커트라인은 조사 결과가 아니라 권고다.** 특히 "스펙 마이그레이션을 v0.3로 미룬다"와 "저자 1인 도그푸딩을 기준으로 자른다"는 선점 가치 대 파이프라인 위험의 저울질이며, 저울의 한쪽(선점 가치)은 **측정된 적이 없다.**
16. **T3.11처럼 초안의 근거가 틀린 사례가 최소 1건 있었다.** 이 리포트의 다른 근거도 같은 방식으로 틀릴 수 있다 — 인용된 파일:라인은 재확인 가능하도록 전부 남겼으니, 중요한 결정 전에는 직접 열어보는 편이 낫다.