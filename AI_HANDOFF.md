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

## OKF 효과 벤치마크

`test/bench-okf.mjs`는 `OKF_RUN_LIVE_BENCH=1` 없이는 유료 호출을 거부한다. 동일 모델/effort/
도구/max-turns/JSON schema/fixture로 조건별 최소 5회, 순서 교차, 첫 회 cold·나머지 warm을 실행한다.

- A: memory 없음, 재설명 없음
- B: memory 없음, 사용자 수동 재설명
- C: 실제 SessionEnd capture → batch ingest → SessionStart gate
- D: 무관한 OKF concept만 주입

아키텍처, 코딩 규칙, 실패 해결책, 응답 선호, 파일·배포 정책, 무관 산술을 자동 assertion한다.
stream-json 원본에서 usage/cache, tool별 호출, 첫 assistant event, API/wall 시간, turn, CLI cost,
resolved model을 보존한다. CLI가 제공하지 않는 user-only/gate-only/transcript token과 retry 수는
`null`과 이유로 남기며 추정하지 않는다. 원본 token 항목은 분리하고 `tokenActivity` 계산식만
별도 제공한다.

batch ingest/repair usage와 비용은 응답 내용 없이 별도 telemetry에 기록한다. 토큰·실비용
손익분기는 모두 `batch + max(0, D-A)`를 초기 비용으로 하고 `B-C`가 양수일 때만 계산한다.
2026-07-15 Anthropic 공식 Sonnet 5 가격을 확인했지만 계산은 CLI `total_cost_usd`를 사용한다.

### 라이브 결과

유효 실행: `2026-07-15T15:03:01.343Z`, 조건별 5회. C preflight는 목표 사실 8/8 존재와
gate routing 8/8, D는 목표 사실 0/8이었다.

| 조건 | 연속성 성공 | 준수율 p50 | token activity p50/p95 | wall p50/p95 | 비용 p50 |
|---|---:|---:|---:|---:|---:|
| A no memory | 0/5 | 0% | 27,320/27,574 | 16.40/18.17초 | $0.024037 |
| B manual restatement | 5/5 | 100% | 9,070/9,093 | 6.07/7.42초 | $0.008410 |
| C OKF enabled | 5/5 | 100% | 22,857/22,883 | 11.33/12.80초 | $0.033189 |
| D irrelevant OKF | 0/5 | 0% | 21,507/22,261 | 16.92/18.88초 | $0.030332 |

C는 사용자 재설명 없이 8개 사실을 5/5 모두 회수했지만 같은 정답률의 B보다 token activity
13,787, wall 5.26초, 비용 $0.024779가 중앙값 기준 더 컸다. 따라서 토큰·응답속도 개선을
주장할 수 없다. batch 1회는 token activity 111,381, $0.164360이었고 B−C 절감이 음수여서
토큰·비용 손익분기점은 없다. cold는 조건별 n=1이라 별도 성능 주장에 쓰지 않는다.

유효 보고서: `docs/benchmarks/okf-live-2026-07-15T15-03-01-343Z.md`; raw JSON은 같은 이름으로
`docs/benchmarks/raw/`에 있다. 최초 `14:44:09Z` 실행은 실제 Claude history sweep 오염과
과도한 exact 채점 때문에 Markdown에 `INVALID`로 표시해 감사용으로만 보존했다. 이를 계기로
benchmark-only sweep 차단, C/D bundle preflight, 의미 동등 채점, deterministic regrade script를
추가했다. 격리 preflight 실패 `15:00:53Z` 감사 JSON도 보존한다.

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
