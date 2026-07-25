# AI 인수인계

마지막 갱신: 2026-07-15 (Asia/Seoul)

## 한눈에 보는 현재 상태

OKF Claude Code 플러그인의 캡처·배치 안전성, PHP/C/C++/Swift 정적 분석, 코드/번들
시각화 분리, 선택형 상태줄, 로컬·라이브 벤치마크 하네스, 8개 언어 README를 보완했다.
배포 버전은 `0.1.5`이며 변경사항은 아직 커밋하지 않았다. 사용자 dirty worktree를 보존했고
commit, push, PR, destructive Git 명령은 실행하지 않았다.

이 저장소에서 작업을 시작하는 AI는 먼저 이 문서와 현재 diff를 확인한다. 이 프로젝트에서는
`task_plan.md`, `findings.md`, `progress.md`를 만들지 않는다.

## 마지막으로 한 작업

**OKF 스펙 v0.2 대응 — 릴리스 1(`0.2.0` 신뢰성) + 릴리스 2(`0.2.1` 스펙 대응) 구현 완료.**
계획서는 [`docs/0-2_develop_plan.md`](docs/0-2_develop_plan.md), 근거 조사는
`docs/okf-v0.2-2026-07-25-*.md` 3종이다. 브랜치 `feature/okf-v0.2-conformance`.

릴리스 1 — 신뢰성 (R0 → R5 → R3 → R2 → R1 → R4 → S3a)
- **R0** 동시 프로세스 락 경합 하네스(`runBatchDetached`), 라이브 형상 동결 픽스처
  (`test/fixtures/live-shape-2026-07-25.json` — 줄 바이트 벡터만, 전사 텍스트 0), lint 규칙
  코드 레지스트리. 코드 동작 변경 0줄.
- **R5** 게이트 예산 회계 수정: 생략 마커·heading 최악값 선차감 + 환급, starvation 제거.
  실측(cap 4,000~9,000B를 50B 간격으로 훑은 101샘플): 절단 발생 샘플 72→0, 주입 concept
  총합 571→597, 감소 샘플 20건이며 감소폭 전부 −1.
- **R3** 락 계약을 `lib/lock.mjs`로 이관(holder/token, 페이로드 검증, TOCTOU 이중 회수 차단),
  bootstrap 락 가드, archive 이동 3단 폴백 + `.archived` 마커, NO-OP 마커 + AND 판정,
  청크 독립 트랜잭션, `blocked` 상태 표면화, top-level 예외 착지.
- **R2** 비용 가시화(4개 반환 경로 전부 — 지불 후 실패 포함) + `batch_max_usd_per_day`
  기본 0(무제한). 상한은 best-effort임을 문서에 명시.
- **R1** 설치 하한(`lib/installed-at.mjs`) · glob 트레일링 `/**` 수정 · 내장 제외.
  설정 키 `sweep_backfill_days` 기본 0.
- **R4** W5(무따옴표 ` #` 절단) · W6(description 500자) · digest 줄단위 스킵과 손실 계량 ·
  추출기 없는 언어의 `analyzedFiles` 분리. digest의 원본 텍스트 폴백(유출 경로) 제거.
- **S3a** `lib/trust.mjs` 신설, W2를 시간 신호 OR 검사로(폐기 필드 재생산 진동 차단),
  미지 status W7, `TYPE_TO_DIR`를 Map으로.

릴리스 2 — OKF 스펙 v0.2 대응 (S5 → S3b → S1 → S2 → S4)
- **S5** `templates/SCHEMA.md` v2(schema_version 1→2, 릴리스 유일 범프), ingest/repair 프롬프트
  v0.2, 게이트 head에서 버전 표기 제거(−11B, 줄 수 불변), README 배지 2종 승격.
- **S3b** 중첩 `log.md` 사각지대 폐쇄 — 루트는 E3b 유지, 비루트만 W8.
- **S1** `generated: {by, at}`를 **코드가** 찍는다(`lib/generated-stamp.mjs`). 위조 차단은
  `prev` 기준 `trustExisting`, 워크스페이스 되쓰기로 2차 apply 오염 방지.
- **S2** `okf_version` "0.1"→"0.2" 승격(외부 값 보존), 루트 index 미지 키 round-trip 보존.
- **S4** `status: deprecated` 생산·소비 + `/okf:okf-deprecate`(`bin/deprecate.mjs`),
  청크당 은퇴 상한 3건을 드라이버가 시행.

검증 라운드(적대적 4회 + codex 3회)에서 나와 반영한 것 — 각 항목은 되돌리면 실패하는 테스트를
동반한다(mutation으로 확인):
- **무한 재과금 차단**: 영구히 실패하는 세션은 매 회차 유료 호출을 한 번씩 태웠다(기본 인터벌
  1시간 × `batch_max_usd_per_day: 0` 무제한 = 하루 24회 무기한). `MAX_CHUNK_ATTEMPTS`(3)회
  실패하면 raw로 되돌리지 않고 `_remove_candidate/`로 격리한다. 원장은
  `.okf/chunk-retries.json`(sessionLabel 해시 → 횟수)이고, 성공은 카운트를 지우며, raw·staging
  어디에도 없는 항목은 저장 시 정리한다. 격리 건수는 `last-batch.json`의 `chunks.quarantined`.
  **상한의 범위는 "같은 입력"이다 — 영구 차단이 아니다.** `_remove_candidate` TTL(기본 30일)이
  격리 사본을 지우면 `archivedMaxById`(`bin/batch.mjs:258`)가 그 세션ID를 잊는다. 그때 원본
  transcript가 sweep 창(`SWEEP_LOOKBACK_DAYS` 7일) 안에 있으면 재수집되어 3회 사이클이 다시
  시작된다. 그 조건은 "격리 후 30일이 지났는데 그 대화가 여전히 최근 7일 안에 이어지고 있다"
  이고, 그러면 transcript는 자란 상태다 — 같은 입력이 아니라 새 입력이므로 새 시도를 주는 것이
  맞다. 원장 키가 `sessionLabel(파일명)`이고 파일명이 `localDateString(mtime)`을 담는 것도 같은
  판단이다(대화가 자라 날짜를 넘기면 카운트도 리셋된다). 세션ID 키로 바꿔 '평생 3회'로 조이면
  나중에 자라서 처리 가능해진 대화가 영구히 버려지므로 채택하지 않았다.
- **락 ABA 폐쇄**: "stale 판정 → unlink"는 두 시스템 콜이라 그 사이에 남이 잡은 **유효한** 락을
  지울 수 있었다(되읽기는 창을 좁힐 뿐이다). `rename`으로 원자적으로 클레임한 뒤 내용을 확인하고,
  남의 것이면 `linkSync`로 되돌린다(그 사이 제3자가 `wx`로 만든 락은 덮지 않는다).
- **index·lint 비대칭 제거**: 예약 디렉토리 이름은 **루트 자식일 때만** 예약이다. index-gen만
  깊이 무관하게 걸러서 `projects/raw/x.md`가 lint 소견 0건으로 통과하면서 어떤 index.md에도
  안 나타났다 — 게이트는 index 기반이라 영구히 발견 불가능했다.
- **프롬프트 유출 차단**: 로그는 `sessionLabel`로 해시했지만 분석기 워크스페이스 사본이 원본
  파일명(`날짜--<cwd 전체 경로>--<세션UUID>.jsonl`)을 그대로 써서 같은 식별자가 유료 LLM으로
  나갔다. inbox 사본을 해시 이름으로 바꿨다.
- **훅 stderr의 `err.message` 제거**(`bin/session-start.mjs`, `lib/bootstrap.mjs` 2곳): js-yaml
  파싱 오류 메시지는 위반한 YAML **원문**을 담고, 그 원문은 전사 파생 concept 본문이다.
  `bin/batch.mjs`가 로그에 대해 지키던 계약을 훅에도 맞췄다.
- **번들 파일 권한 회귀 고정**: 기존 테스트는 `.okf/` 상태 파일만 봤는데 그것들은
  `writePrivateJsonAtomic`이 rename 뒤 한 번 더 chmod한다. `writePrivateFile`의 0600 강제를
  지우면 실제로 0644가 되는 것은 `SCHEMA.md`·`log.md`였다. `index.md`는 `writeAtomic`이
  기본 모드를 써서 baseline에서도 0644였다 — 같은 번들 안의 정책 불일치라 0600으로 통일했다.
- **U+0085(NEL)**를 게이트 접기 집합과 lint W12 집합에 추가. 줄을 가르지는 않지만 게이트 줄이
  `…재시도 3회- [주입](…)`처럼 공백 없이 붙은 채 통과했다.
- **게이트 링크 타깃 위조 차단**: 접기는 개행만 다루고 `](`는 손대지 않아서, LLM이 저술한
  title/description이 `- [정상](/Users/victim/.ssh/id_rsa) 그리고 [](/decisions/x.md): …`처럼
  게이트에 **링크 타깃**을 위조할 수 있었다. 게이트 규칙 2가 링크를 번들 루트 기준으로
  프레이밍하므로 즉시 exfil 프리미티브는 아니지만, 사용자 홈의 실제 경로가 게이트에 concept
  링크로 제시되고 lint는 W1(경고)만 낸다 — 경고는 커밋도 게이트도 막지 않는다.
  `foldToSingleLine`에서 `[ ] ( )`를 전각으로 치환한다.
- **재시도 상한의 다중 청크 구멍**(독립 검증이 찾은 신규 MAJOR): `saveRetryLedger`의 live 집합이
  `staging/<runId>/` 아래로 내려가지 않아 staging이 아무것도 기여하지 못했다. `snapshotRaw`가
  회차 시작에 **모든 청크의 소스**를 staging으로 옮기므로, 청크 1이 실패해 원장을 저장하는 순간
  뒤 청크의 세션이 전부 '없는 것'으로 판정돼 지워졌다 — 마지막 청크의 세션은 카운트가 매 회차
  1로 리셋되어 영원히 상한에 닿지 않았다. **무한 재과금을 막으려던 기능이 다중 청크 회차
  (=비용이 큰 쪽)에서 정확히 안 들었다.** 실측(5세션 3청크): 5회차 뒤에도 raw에 1개가 남아
  매 회차 재과금됐다.
- **원장 값 검증**: `Number.isInteger`는 음수를 통과시켜 `-1000000` 하나면 상한이 영구
  무력화된다(부분 쓰기·디스크 손상으로 도달 가능). `> 0`을 추가했다.
- **`.claim-*` 크래시 창**: rename 클레임은 락 파일을 즉시 없애므로 그 직후 크래시하면 락이
  사라지고 `recoveredFromStaleLock=false`가 된다 — 다음 배치가 반쯤 반영된 분석기 산출물을
  **사용자 편집으로 보고 커밋**한다(§7-4가 막으려던 오분류). 수정 전에는 크래시가 stale 락을
  *남겨서* 다음 회차가 그것을 증거로 삼았다. 이제 `.claim-*`의 존재 자체를 회수 중단의 증거로
  읽고 청소한다(§9의 잔재 문제도 함께 닫힌다).
- **무커버 방어 5종에 테스트**: `OKF_BATCH=1` 재귀 가드(§7-1 2차), sweep의 분석기 자기세션
  cwd 가드, `actorFor` 화이트리스트(모델 이름이 `generated.by`로 번들에 영구히 남는다),
  워크스페이스 `rmSync`(지우지 않으면 **전사 사본**이 /tmp에 회차마다 쌓인다), 전 세션
  빈-digest 경고.

미착수: 릴리스 3(`0.3.0`, Part 2)은 I6의 recall@cap 측정 발행이 선행 조건이다.

### 그 이전 작업

- `SessionEnd` 무손실 캡처를 비동기 600초 계약으로 바꾸고, 같은 세션의 역순 완료가 더 긴
  최신 transcript를 덮지 못하도록 사본+세션 잠금+크기 비교를 적용했다.
- 캡처 상태는 transcript 내용·경로 없이 `.okf/capture-status.json`에 기록한다. POSIX bundle
  디렉터리는 `0700`, raw/state/log 파일은 `0600`; Windows는 계정 ACL을 사용한다.
- 설정을 중앙 검증하고 잘못된 값은 안전한 기본값으로 되돌린다. 배치 프롬프트는 stdin으로
  전달하며 도구 집합에서 Bash를 제외하고 JSON 성공 subtype을 확인한다. 미완료·lint 실패는
  작업트리와 raw를 원복한다.
- 배치 `claude -p`에 `--safe-mode`, `OKF_BATCH=1`, `--no-session-persistence`를 적용했다.
  세션 ID 레지스트리와 transcript cwd 필터도 유지해 과거 batch transcript가 orphan sweep으로
  재수집되는 자기증식 루프를 차단한다.
- sweep은 `CLAUDE_CONFIG_DIR`을 따르며 smoke는 `HOME`, `USERPROFILE`,
  `CLAUDE_CONFIG_DIR`을 모두 격리한다. SessionStart smoke에는 임시 batch lock을 두어 실제 유료
  배치가 뜨지 않는다.
- hook 입력의 `session_id`를 안전한 파일명 경계로 정규화해 raw 디렉터리 밖 경로 생성을 막았다.
- 기존 `~/.claude/projects`, 실제 OKF `raw/`, `_remove_candidate/` 데이터는 삭제하지 않았다.

## 언어별 분석 지원 변화

- PHP: namespace, use/alias/grouped use, require/include, class/interface/trait/enum/function 선언을
  지원한다. 저장소가 실제 선언한 symbol만 내부 연결하며 외부 Composer namespace는 연결하지
  않는다. `composer.json` PSR-4 정보도 사용한다.
- C/C++: quoted include, 명시적 경로의 유일한 local angle include, class/struct/enum/union/
  typedef/namespace/함수 정의를 지원한다. prototype·시스템 헤더·주석·문자열 오탐을 억제한다.
- Swift: class/struct/enum/protocol/actor/extension/typealias/function과 명시적 상속·conformance·
  extension 관계를 지원한다. module import를 가짜 파일 edge로 만들지 않고, cross-file type
  대상은 top-level 선언으로 제한한다.
- 공통: 존재하지 않는 경로와 파일 경로는 서로 다른 오류, 빈 디렉터리는 정상 0 그래프다.
  512 KiB 초과 파일은 발견하되 분석 생략으로 표시하고, 2,000 파일 상한은 `truncated`로
  노출한다. 디렉터리 심볼릭 링크를 따라가지 않아 순환 링크가 종료된다.
- `languageStats`는 언어별 발견 파일, 분석 파일, 선언, 내부 edge를 제공하고
  `primaryLanguages`는 선언·edge·파일 수 순으로 구조적 주 언어를 표시한다.
- 기존 JS/TS/Python/Go/Rust/Java/Kotlin/Ruby/C# 회귀 fixture를 유지한다.

## 실제 오픈소스 분석 검증

공식 저장소를 `/tmp/okf-oss-validation`에 clone하고 SHA를 고정했다. 대표 edge는 원본 source의
include/use/상속 줄과 대조했다. 상세 결과는 `docs/benchmarks/oss-analysis-2026-07-15.{md,json}`.

| 저장소 | commit | 언어 파일 | 분석 파일 | 선언 | 내부 edge | truncated |
|---|---|---:|---:|---:|---:|---:|
| Slim | `80900fb39cafce3ae53b18a2c4f642a122f03095` | 125 PHP | 125 | 127 | 305 | false |
| Redis | `f76dff71ec60a203f55b00224bee2391f9445223` | 784 C | 783 | 5,796 | 990 | false |
| fmt | `a79df4504cd4e42ed004b1113fb82171e62ed822` | 46 C++ | 45 | 283 | 121 | false |
| Alamofire | `903c53c710d1cbbac0b4b9c2527aefb791e1fee3` | 98 Swift | 98 | 2,052 | 215 | false |

실저장소 검증에서 Swift 표준 `Error`가 nested `Error`에 연결되는 오탐과 C 표준 헤더가 vendored
compatibility header에 연결되는 오탐을 발견해 회귀 테스트와 함께 수정했다. 측정 시간·RSS는
운영 안전성 자료일 뿐 OKF 토큰/응답 성능 근거로 사용하지 않는다.

## 명령·상태줄·문서

- `/okf:okf-visualize`는 bundle concept와 concept 간 관계만 그리며 코드를 분석하지 않는다.
- `/okf:okf-analysis [경로]`는 경로를 검증한 후 코드와 관련 concept만 그리고 제외 수,
  truncated, 언어별 분석 공백을 보고한다.
- `bin/statusline.mjs`는 작은 상태 파일과 디렉터리 수만 읽는다. 네트워크·그래프 분석이 없고
  기존 `statusLine`을 덮지 않도록 자동 설치하지 않는다.
- `README.md`와 ko/ja/zh-CN/es/fr/de/pt-BR 7개 번역을 동일 구조로 전면 갱신했다. Quick Start,
  실제 흐름, 6개 명령, benchmark, 언어 지원, OSS 검증, privacy, 제거, 개발 검증을 포함한다.
- `docs/USAGE.md`는 첫 capture→batch→next gate 흐름, 상태/시각화/분석/상태줄, cache 해석,
  batch 비용·손익분기, 합성 fixture와 라이브 재현 절차를 설명한다.

## OKF 효과 벤치마크 (v3, 2026-07-16)

현재 벤치마크는 v3다. 이전 A/B/C/D 합성 fixture 실행은 목표 사실이 어디에도 없는 디렉토리를
baseline이 뒤지게 해 baseline이 구조적으로 0/5였고(OKF의 성질이 아니라 설계 때문), 폐기했다.
그 결과는 인용하지 않는다. v3는 고정된 공개 저장소 두 개(Slim `80900fb3`, rust-lang/rfcs
`f635361c`)에 대고 zero-base·answer-key·OKF·wrong-knowledge·CLAUDE.md 5조건을, 대조 n=15/통제 n=5로
측정한다.

`test/bench-okf.mjs`는 `OKF_RUN_LIVE_BENCH=1` 없이는 유료 호출을 거부한다. gate는 프롬프트 prepend가
아니라 실제 `SessionStart` 훅(`additionalContext`)으로 전달하고 전달 바이트를 실행마다 검증한다.
채점은 정답을 원자로 쪼개 원자별로 하고(측정 전 고정) v2식 이진 점수를 나란히 발행한다. 비용은
`total_cost_usd`가 헤드라인이며 sonnet 단독 비용을 옆에 실어 CLI가 내부 작업에 쓰는 haiku(지출의
2.3%)를 빼고 볼 수 있게 한다.

v3에서 실패로부터 배워 넣은 두 가드: (1) 조건별 비주(non-primary) 모델 비용 비중이 임계값(기본
15%)을 넘으면 결과를 쓰고 non-zero로 중단한다 — 균일하게 섞인 haiku는 교란이 아니라 정량화 대상.
(2) Claude Code가 cwd별 프로젝트 메모리를 모든 세션에 자동 주입하는데, 지식 세션이 그 메모리에
팀 결정을 저장하면 측정이 같은 cwd에서 zero-base에까지 새어든다 — 하니스가 측정 전 그 메모리를
지우고, 리포트가 zero-base 오염 시나리오를 기계적으로 배제한다.

### 라이브 결과

유효 실행: `2026-07-16T08:31:48Z`, 440런. modelMixConfound 없음(haiku 2.3%), gate flake 재시도 0회.
발행 6개 시나리오(오염된 slim_domain·slim_policy 배제):

- **코드로 알 수 있는 질문**: OKF는 grep 한 번짜리에서 1.2~1.7배 비싸다(slim_cheap zero $0.067 vs
  OKF $0.114). 탐색이 비싼 slim_buried에서만 OKF가 더 싸고 도구 호출이 적다.
- **코드에 없는 정책**(rfcs_policy): zero-base 0/15(탐색으로는 못 찾음) vs OKF 11/15, CLAUDE.md의
  약 절반 비용. CLAUDE.md도 15/15로 답하므로 OKF는 유일한 게 아니라 더 싼 형태의 대안이다.
- **slim_stale**: 이진 0/15로 "전멸"처럼 보이지만 critical 원자는 15/15 — 모델이 코드를 다시 읽어
  핵심을 바로잡았고 놓친 건 커밋 SHA 같은 부수 원자뿐이다. "낡은 지식이 자신있는 오답을 만든다"는
  예측과 반대.

반증 기준 R1~R5 전부 발동 안 함(오염 배제 후). 측정 $66.26 + 채점 $14.74.
리포트: `docs/benchmarks/okf-benchmark-2026-07-16-v3.md`, 사전등록:
`docs/benchmarks/pre-registration-2026-07-16-v3.md`, 번들: `docs/benchmarks/bundles/`(커밋됨),
raw JSON: `docs/benchmarks/raw/okf-live-2026-07-16T08-31-48-458Z.json`. v2 실행의 raw(05-28·06-13)는
v3 사전등록서가 v2 허위 진술 6건을 반박하는 증거로 보존한다.

## 점진적 체인 벤치마크 (v4, 2026-07-16) — 반증됨

`test/bench-chain.mjs` 신규. v3 사전등록서가 "방향이 OKF에 유리하고 조작 가능"하다는 이유로
명시적으로 기각했던 설계(세션이 이어지며 배치로 실제 축적 → 다음 세션이 변형 질문에 답함)를,
이번엔 가드를 갖춰(Q1~Q4 사전고정+소스 대조 검증, 매 스텝 프로젝트 메모리 클리어, 기계적 반증
기준) 다시 시도했다. 대상: `kubernetes/kubernetes` v1.30.0(`7c48c2bd`), `pkg/scheduler`(178 Go
파일, sparse-checkout). 체인 15개 × 2 arm(okf_chain/zero_base_chain) × 4스텝 = 120세션.

**핵심 발견(raw JSON 직접 검증):** 게이트 바이트는 실제로 단조 증가(1835→2613→3675→4950B,
`gateGrewMonotonically=true`, 실제 배치비용 $25.81) — 축적 자체는 인프라 수준에서 확인됨. 그러나
핵심 예측(체인이 진행될수록 OKF 비용이 내려간다, P1)은 **반증**됨: okf_chain 비용이 $0.231→
$0.216→$0.258→**$0.447**로 오히려 순증가했고, zero_base_chain도 $0.255→$0.256→$0.272→$0.411로
같은 모양으로 올랐다. 가장 그럴듯한 설명은 Q4가 두 arm 모두에게 유독 어려운 2부 구성 질문이었다는
것(축적 효과가 아님). 반증 기준 R2(비용 하락 없음)·R3(두 arm 같은 방향, 단 난이도차 대안설명
있음)·R4(OKF 정확도가 zero_base보다 낮은 스텝 존재)가 발동했고, R1(게이트 성장)·R5(모델믹스)는
발동 안 함. harness 레벨 result-누락 flake 14/120(11.7%, exitCode=0인데 result 이벤트 없음)도
발견돼 오답과 분리 집계했다.

발견한 실제 버그(수정 완료): `path.resolve(cwd).replace(/\//g,'-')`만으로 Claude Code의 cwd 슬러그를
계산하면 `.`·`_`가 든 경로(예: `.claude`, `side_project`)에서 실제 슬러그와 어긋난다(실제는 영숫자가
아닌 모든 문자를 `-`로 바꿈). `bench-chain.mjs`는 `[^a-zA-Z0-9]`로 고쳤다 — `bench-okf.mjs`의
`projectMemoryDir`도 같은 패턴을 쓰지만 v3 대상 경로(`targets/slim`, `targets/rfcs`)에 점/언더스코어가
없어 우연히 안 걸렸을 뿐, 잠재적으로 같은 결함이 있다(이번 PR 범위 밖 — 별도 확인 필요).

측정 총비용 ≈ $67(측정 $31.95 + 채점 $9.20 + 실제 배치 $25.81). 리포트:
`docs/benchmarks/okf-benchmark-chain-2026-07-16-v4.md`, 사전등록:
`docs/benchmarks/pre-registration-2026-07-16-v4.md`, raw JSON:
`docs/benchmarks/raw/okf-chain-live-2026-07-16T11-49-21-216Z.json`.

## 마지막 검증 결과

실행 환경: macOS arm64, Node `v26.4.0`, Claude Code `2.1.210`.

```sh
node test/smoke.mjs
# 586 passed, 0 failed   (릴리스 1+2 + 검증 라운드 반영 후. 착수 시점 기준선은 303)

node test/bench.mjs
# SessionStart 57.4ms (56.7-58.2), SessionEnd 43.4ms (41.8-43.9)
# statusline 36.7ms (34.8-36.8), analyze 13.0ms (11.8-22.5)

for file in $(rg --files -g '*.mjs'); do node --check "$file"; done
# 28개 전체 통과

claude plugin validate .claude-plugin/plugin.json
claude plugin validate .claude-plugin/marketplace.json
# 모두 Validation passed; 루트 CLAUDE.md가 플러그인 context는 아니라는 예상 warning 1건

# Ruby 표준 YAML 파서로 .github/workflows/test.yml 파싱 통과
git diff --check
# 출력 없음

# 유효/무효 benchmark raw에서 사용자 home 절대경로와 secret 패턴 scan 통과
```

## 독립 리뷰 결과

구현과 분리한 전체 diff 리뷰에서 기능 회귀, false edge, benchmark 공정성·집계, cache 해석,
batch 비용, 개인정보, README 과장을 우선 점검했다. 발견한 Important 이슈는 다음과 같이 해결했다.

1. 별도 OKF_HOME 배치 transcript가 다른 sweep에 들어갈 수 있음 → `--no-session-persistence`.
2. 비용 손익분기 분자에 무관 gate 비용이 빠짐 → `batch + max(0, D-A)`로 수정.
3. untrusted `session_id`가 raw 경로에 직접 들어감 → 안전 ID/hash 경계와 회귀 테스트.
4. live raw 초기화 이벤트에 사용자 plugin 절대경로가 남음 → `<PLUGIN_ROOT>`/`<USER_HOME>` 치환.

현재 미해결 Critical/Important 이슈는 없다.

## 남은 개선점

0. **릴리스 3(`0.3.0`, 계획서 Part 2)은 I6가 선행이다.** `lib/gate.mjs` 추출 + recall@cap
   사전등록 실험($0)을 먼저 발행하지 않으면 I5/I3/I-M/I2에 착수하지 않는다. I2(관련성 라우팅)는
   구현하더라도 기본 OFF이며, 기본값 전환은 I6의 조건 A~E를 전부 충족할 때만 별도 커밋으로 한다.
1. GitHub Actions를 실제 원격에서 실행해 Node 20 Windows/macOS/Linux 결과를 확인한다.
2. regex fallback은 compiler/indexer가 아니다. PHP dynamic autoload, C/C++ macro/generated 선언,
   Swift generic/typealias 해석 등은 tree-sitter/LSP 없이 보수적으로 누락될 수 있다.
3. orphan sweep의 30분 idle 휴리스틱은 장시간 조용한 활성 세션을 회수할 수 있다. Claude가
   제공하는 안정적인 종료/활성 메타데이터가 생기면 휴리스틱을 대체한다.
4. 라이브 효과 벤치마크는 5회 소표본이고 네트워크/서버 분산 영향을 받는다. 결과가 작거나
   성공률이 낮으면 개선으로 표현하지 말고 10회 이상 추가 실행한다.
5. 기존 사용자의 `~/.claude/projects` 내 과거 smoke 세션, 실제 bundle raw,
   `_remove_candidate` 오염 데이터는 자동 삭제하지 않았다. 정리가 필요하면 백업 후
   `[OKF-BATCH]`/`okf-smoke-*`만 별도 선별해야 한다.
6. 외부 README 링크와 공식 가격은 시간이 지나면 변할 수 있으므로 릴리스 전에 재확인한다.
7. **`batch_max_usd_per_day` 기본값은 여전히 0(무제한)이다.** 재시도 상한(`MAX_CHUNK_ATTEMPTS`)이
   "영구 실패 세션이 무한히 재과금"을 닫았으므로 무제한 기본값의 최악 시나리오는 사라졌지만,
   상한 자체는 여전히 사용자가 켜야 한다. 기본값 전환은 별도 판단이다.
8. **`MAX_CHUNK_ATTEMPTS`는 설정 키가 아니라 상수(3)다.** 실패가 청크 단위이므로 큰 세션 하나가
   같은 청크의 다른 세션까지 카운트를 올린다(청크 전체가 원복되므로). 실측 데이터가 쌓이면
   세션 단위 격리로 좁히거나 설정 키로 올리는 것을 검토한다.
9. ~~락 회수의 `.claim-*` 잔재~~ — 해소됨. `acquireLock` 진입 시 `harvestAbandonedClaims`가
   잔재를 청소하고, 그 존재 자체를 크래시 증거로 삼아 `recoveredFromStaleLock=true`로 들어간다.

## 작업 시 주의

- 현재 dirty worktree를 먼저 확인하고 사용자 변경을 덮어쓰지 않는다.
- commit, push, PR은 명시 요청 전까지 만들지 않는다.
- 기능 변경은 `test/smoke.mjs`의 실패 회귀 테스트부터 추가한다.
- 완료 주장 전 smoke, local bench, Node syntax, 두 manifest, workflow YAML, diff 검증을 재실행한다.
- 작업 종료 시 이 문서의 마지막 작업, 검증 결과, 남은 개선점을 갱신한다.
