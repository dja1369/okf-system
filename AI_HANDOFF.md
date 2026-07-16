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
# 254 passed, 0 failed

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

## 작업 시 주의

- 현재 dirty worktree를 먼저 확인하고 사용자 변경을 덮어쓰지 않는다.
- commit, push, PR은 명시 요청 전까지 만들지 않는다.
- 기능 변경은 `test/smoke.mjs`의 실패 회귀 테스트부터 추가한다.
- 완료 주장 전 smoke, local bench, Node syntax, 두 manifest, workflow YAML, diff 검증을 재실행한다.
- 작업 종료 시 이 문서의 마지막 작업, 검증 결과, 남은 개선점을 갱신한다.
