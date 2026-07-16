# OKF for Claude Code

**지난 Claude Code 세션의 결정을 로컬의 검토 가능한 지식 번들로 만들고, 다음 세션이 실제로 찾아 쓰게 합니다.**

![MIT license](https://img.shields.io/badge/license-MIT-blue) ![OKF v0.1](https://img.shields.io/badge/OKF-v0.1%20Draft-4ecdc4) ![Node only](https://img.shields.io/badge/runtime-Node%20only-5c6bc0) ![no npm install](https://img.shields.io/badge/dependencies-vendored-66bb6a)

[English](README.md) · **한국어** · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português](README.pt-BR.md)

OKF는 끝난 세션을 캡처하고, 재사용할 결정과 장애 해결법을 일반 Markdown으로 추출한 뒤, 다음 세션에 작은 인덱스를 주입합니다. 번들은 직접 열고 diff·백업·삭제할 수 있는 로컬 git 저장소입니다.

## 1분 빠른 시작

Claude Code 플러그인 지원, Node.js, git이 필요합니다. `npm install`은 없습니다.

```sh
claude plugin marketplace add dja1369/okf-system
claude plugin install okf@okf-marketplace
```

Claude Code를 다시 시작하고 평소처럼 세션을 끝낸 뒤 확인합니다.

```text
/okf:okf-status
/okf:okf-index
```

첫 `SessionStart`가 `~/.claude/okf`(또는 `$CLAUDE_CONFIG_DIR/okf`)를 만듭니다. 수집과 기회주의적 배치는 자동입니다 — 대화는 마지막 활동 후 약 1시간이 지나면 수집되므로, 세션을 명시적으로 끝낼 필요가 없습니다.

## 세션 연속성 흐름

```text
세션 1 결정        ~1시간 유휴            백그라운드 배치             세션 2
정책 확정     ->   sweep이 raw 수집  ->   재사용할 OKF Markdown  ->  작은 인덱스 주입
(명시적 종료       (무손실 복사,              |                          |
 불필요)            성장 시 재수집)           +-- 로컬 git 이력          +-- 관련 concept Read
```

예를 들어 “10% → 50% → 100% 배포, 오류율 0.5% 초과 시 원복”을 한 세션에서 정합니다. 수집과 ingest가 끝나면 다음 세션은 사용자가 정책을 다시 붙여넣지 않아도 인덱스에서 이 결정을 찾을 수 있습니다. 인덱스는 전체 기억이 아니라 탐색 경로이므로 Claude는 행동 전에 관련 concept 본문을 `Read`해야 합니다.

왜 유휴 기준인가: 세션은 명시적으로 끝나는 일이 드뭅니다 — 백그라운드 에이전트는 아예 끝내지 않고, `resume` 시점의 종료 스냅샷은 진행 중인 대화를 “처리됨”으로 못박아 이후 내용을 전부 잃게 했습니다. 그래서 sweep은 `sweep_min_idle_minutes`(기본 60분) 동안 조용해진 transcript만 수집하고, 배치 프로세스는 대기 중인 대화가 유휴에 도달할 때까지 남아서 기다리며(약 5분 간격 확인, 최대 8시간), 이미 수집된 세션은 **그 뒤에 더 커졌을 때만** 다시 수집하고, 변화 없는 세션은 절대 재수집하지 않습니다. 세션 훅은 배치를 깨우는 역할만 합니다.

## 명령

플러그인 명령에는 항상 `okf:` namespace가 필요합니다.

| 명령 | 용도 |
|---|---|
| `/okf:okf-status` | 마지막 배치, 대기 세션, 잠금 상태 |
| `/okf:okf-batch` | 잠금을 존중하며 즉시 ingest 실행 |
| `/okf:okf-config` | 검증된 설정 조회·편집 |
| `/okf:okf-index` | 카테고리, concept 제목, 최근 변경 조회 |
| `/okf:okf-visualize` | OKF concept와 concept 간 링크만 시각화 |
| `/okf:okf-analysis [경로]` | 저장소와 관련 있는 OKF concept만 함께 분석 |

`visualize`는 “번들이 무엇을 아는가?”에 답하며 저장소를 스캔하지 않습니다. `analysis`는 “번들이 아는 내용을 기준으로 이 코드는 무엇인가?”에 답합니다. 없는 경로나 파일 경로는 거부하고, 분석 잘림·제외된 무관 concept·언어별 파일/선언/internal edge 수를 표시합니다.

두 명령의 HTML은 외부 CDN이나 실행 중 네트워크 요청이 없는 자체완결 파일입니다.

## 선택형 상태줄

`bin/statusline.mjs`는 네트워크나 전체 그래프 분석 없이 로컬 상태 한 줄을 출력합니다.

```text
OKF 12 · +3 · 2h ago
OKF 12 · batch running
OKF 12 · last: partial: 1/3 chunks
```

Claude Code의 `statusLine`은 하나뿐입니다. OKF는 이를 자동 설치하거나 덮어쓰지 않습니다. 기존 스크립트에서 `node /path/to/okf/bin/statusline.mjs` 출력을 결합하거나, 기존 상태줄이 없을 때만 직접 설정하세요.

## OKF 벤치마크

<!-- okf-benchmark: 2026-07-16-v3 -->

**OKF는 탐색을 대신해 주지 않습니다. 탐색으로는 결코 찾을 수 없는 것을 저장할 뿐입니다.**

이 문장의 두 절반을 모두 아래에서, 실제 오픈소스 저장소에 대고, 비교 셀마다 n=15로 측정했습니다.
그중 OKF에 불리한 절반을 먼저 공개합니다.

### 측정 방법

고정(pinned)된 공개 저장소 두 개 — 합성 fixture가 아니므로 탐색에는 탐색이 실제로 치르는 비용이
그대로 들고, 기억 없는 baseline이 진짜로 이길 수 있습니다:

| 역할 | 저장소 | 커밋 |
|---|---|---|
| 코드베이스 | [slimphp/Slim](https://github.com/slimphp/Slim) | `80900fb3` (PHP 파일 125개) |
| 문서 더미 | [rust-lang/rfcs](https://github.com/rust-lang/rfcs) | `f635361c` (Markdown 파일 651개) |

모든 번들의 모든 concept은 실제 파이프라인이 만들었습니다 — 고정된 저장소를 탐색하는 실제
`claude -p` 세션, 실제 Claude Code 트랜스크립트, 실제 batch ingest, 실제 gate. **손으로 쓴
concept은 하나도 없습니다.** 번들은 이 저장소에 커밋되어 있으므로
([docs/benchmarks/bundles/](docs/benchmarks/bundles/)), 아래 모든 숫자가 딛고 선 정확한 gate 텍스트와
concept 본문을 직접 읽을 수 있고, v2가 반박된 방식 그대로 — 저자를 믿지 않고 저장소에서 — 이번
실행도 반박할 수 있습니다.

조건 5개. 모두 동일한 도구(`Read`, `Glob`, `Grep`, `Bash(git log/show/diff/blame/grep)`)와, 조건에
중립적인 동일한 지시문을 받습니다 — 어떤 조건에도 gate를 참고하라고 말하지 않습니다. gate는 프롬프트
앞에 붙이는 것이 아니라 **실제 `SessionStart` 훅**(`additionalContext`)으로 전달하며, 전달된 바이트를
실행마다 검증합니다.

- **zero-base** — 아무것도 없음. OKF가 대체한다고 주장하는 대상입니다.
- **answer key(정답지)** — 정답을 그대로 붙여 넣습니다. 그 문자열을 만들려면 이미 답을 알고 있어야
  하므로 어떤 사용자도 이 조건을 점유할 수 없습니다. 경쟁자가 아니라 하한선입니다.
- **OKF** — 실제 gate 텍스트.
- **wrong knowledge(무관한 지식)** — *다른* 저장소에 대한 실제 concept으로 크기를 맞춘 gate.
  "지식이 도왔다"와 "gate가 도왔다"를 분리합니다.
- **CLAUDE.md** — 똑같이 축적된 지식을 평평한 파일 하나에 붙여 넣은 것. 진짜 기존 강자입니다.

`total_cost_usd`가 헤드라인이고, sonnet 전용 비용을 총비용 옆에 함께 공개합니다. 그러면 CLI가 내부
작업용으로 해석해 쓰는 `claude-haiku`(지출의 2.3%)를 빼낼 수 있어 결론을 숨길 수 없습니다. 효율은
정답을 맞힌 실행끼리만 비교합니다. 각 답은 **atom** 단위로 채점합니다 — ground truth를 독립적으로
확인 가능한 사실들로 쪼개 측정 전에 동결했습니다 — 그리고 v2식 이진 점수(모든 atom 정답)를 그 옆에
함께 공개합니다. 실행마다 nonce를 넣어 prompt caching을 무력화합니다. **어떤 숫자도 시나리오 간에
평균 내지 않습니다.**

설계, 예측, 반증 기준 R1–R5는 **첫 유료 호출 전에**
[사전 등록](docs/benchmarks/pre-registration-2026-07-16-v3.md)하고 커밋했습니다. 그 문서에는 이
벤치마크의 이전(v2) 공개가 냈던 거짓되거나 뒷받침되지 않는 진술 여섯 건과, 각각을 그 자체의 원본
데이터로부터 어떻게 잡아냈는지도 상세히 기록되어 있습니다.

### OKF가 지는 곳: 코드가 답할 수 있는 모든 것

답이 소스나 git 히스토리, 또는 번들에 있는 시나리오 5개. 각각 고정된 체크아웃에서 검증했습니다.
비용은 정답을 맞힌 실행의 중앙값이며, 그 편차를 함께 싣습니다.

| 시나리오 | zero-base | OKF | 판정 |
|---|---:|---:|---|
| `rfcs_cheap` — grep 한 번 | **$0.062** · 13/15 | $0.077 · 14/15 | OKF가 1.2배 비쌈 |
| `slim_cheap` — grep 한 번 | **$0.067** · 14/15 | $0.114 · 15/15 | OKF가 1.7배 비쌈 |
| `rfcs_buried` — 문서 651개 속에서 근거 찾기 | **$0.097** · 12/15 | $0.112 · 13/15 | OKF가 1.2배 비쌈 |
| `slim_buried` — 파일 다섯 개짜리 호출 체인 추적 | $0.277 · 13/15 · **tool 10회** | **$0.232** · 9/15 · **tool 8회** | OKF가 더 싸고 tool 더 적음 |
| `slim_stale` — 이후 커밋으로 번들 지식이 낡음 | critical **15/15** | critical **15/15** | 무승부 — 아래 참조 |

**싼 grep에서 OKF는 순수한 오버헤드입니다** — 같은 답에 1.2~1.7배 비쌉니다. gate는 `grep`에게는
필요 없는 고정 비용이기 때문입니다. OKF는 탐색이 진짜로 비쌀 때만 본전을 뽑습니다: `slim_buried`는
파일 다섯 개짜리 호출 체인을 추적하는데, 거기서 OKF는 더 싸고 tool call도 더 적습니다. 이것은 결함이
아니라 산수입니다 — grep 한 번이 질문에 답한다면 gate에 돈을 쓰지 마세요.

`slim_stale`은 atom 단위 채점이 값을 한 곳입니다. 번들은 이후 커밋으로 낡아 버린 주장을 담고
있었고, 이진 점수는 **모든 조건에서 0/15**로 읽힙니다 — 완전한 전멸처럼 보입니다. 아닙니다.
*critical* atom(질문이 실제로 묻는 것 — HTML 렌더러가 이스케이프하는지, 어떤 함수와 플래그로
하는지)은 **15/15**입니다: 모델은 코드를 읽고 핵심 사실을 올바르게 답했습니다. 놓친 atom은 질문이
한 번도 요구하지 않은 출처(이스케이프를 도입한 커밋 SHA)뿐입니다. 낡은 지식은 모델을 자신 있게
틀리게 만들지 **않았습니다** — 그러리라던 사전 등록 예측은 틀렸고, 이진 점수만으로는 그 사실이
가려졌을 것입니다.

### 탐색이 도울 수 없는 곳: 코드가 담고 있지 않은 지식

대화에서 정해졌고 저장소에는 한 번도 기록되지 않은 팀 정책. RFC 더미에는 함정까지 있습니다: MSRV
정책을 검색하면 문서들은 `N-2`를 제안하지만 — 팀의 실제 규칙은 다릅니다.

| 시나리오 | zero-base | OKF | 무관한 지식 | CLAUDE.md |
|---|---:|---:|---:|---:|
| `rfcs_policy` — 팀의 "thaw rule": 대기 기간, MSRV 주기, 예외 조항 둘 | **0/15** | **11/15** · $0.075 | — | 15/15 · $0.144 |

**zero-base는 15전 0승입니다.** 돈은 썼는데 아무것도 얻지 못했습니다. 답이 저장소에 없기
때문입니다 — 작업 트리, git 히스토리, 커밋 메시지, 문서, 설정을 뒤진 적대자가 적중 0건으로
확인했습니다. 함정도 zero-base를 잡지 못했습니다; 그저 답할 수 없었을 뿐입니다.

OKF는 **15개 중 11개**를 맞혔고, 같은 사실을 담은 CLAUDE.md의 대략 절반 비용으로 그렇게 했습니다.
이것이 탐색은 할 수 없고 저장된 결정은 할 수 있는 단 하나입니다. **CLAUDE.md도 답합니다**(15/15) —
OKF는 여기서 유일하지 않으며, 같은 기존 강자를 더 싸고 주입량이 제한된 형태로 구현한 것입니다. 이
시나리오의 `wrong knowledge` 대조군은 제외합니다: 측정 오염 버그(아래)가 그것이 답을 읽게 했으므로,
이번 실행에서 "gate 하나만으로는 도움이 안 된다"는 대조군 역할을 할 수 없습니다.

이것은 깨끗한 정책 시나리오 하나이지 셋이 아닙니다. 다른 둘(`slim_policy`, `slim_domain`)은
측정했다가 **제외**했습니다 — 아래 참조.

### 이번 실행이 말해 줄 수 없는 것

- **정책 시나리오 두 개는 오염으로 제외했습니다.** Claude Code는 디렉터리별 프로젝트
  메모리(`~/.claude/projects/<cwd>/memory/`)를 모든 세션에 자동 주입합니다. 지식을 구축하는 동안
  대상 저장소를 탐색하던 `claude -p` 세션이 팀 결정을 그 메모리에 저장했고, 측정이 같은 작업
  디렉터리에서 돌아간 탓에 그 메모리가 아무 지식도 없어야 할 **zero-base** 조건에까지 닿았습니다.
  `slim_domain`에서는 그 결과 zero-base가 코드 어디에도 없는 팀 결정을 15/15로 "답해" 버렸습니다.
  zero-base 실행이 프로젝트 메모리를 읽은 시나리오는 모두 공개에서 뺍니다(`slim_domain`,
  `slim_policy`); 하니스는 이제 측정 전에 그 메모리를 비우고, 보고서는 그런 시나리오를 기계적으로
  탐지해 제외합니다. 위의 깨끗한 시나리오들은 메모리 읽기가 0건이었습니다.
- **비교 조건은 n=15, 대조군은 n=5.** 작습니다. 분포가 완전히 분리될 때만 승리라고 말합니다.
- **저장소 두 개, 생태계 두 개(PHP + Markdown).** 규모나 언어 전반에 걸친 일반성은 주장하지
  않습니다. 세 번째 저장소를 설계했다가, 돈을 쓰기 전에 신뢰도 대비 비용을 이유로 접었습니다.
- **단일 질문 세션.** OKF의 고정 gate 비용은 실제 다중 질문 세션에 걸쳐 분산되지 않고 질문 하나당
  한 번씩 치러지므로, 이번 실행은 OKF를 *과소평가*합니다.
- **심판은 단일 LLM 계열**이며, 소스로 검증한 ground truth에 대고 atom 단위로 채점합니다.

반증 기준 **R1–R5는 모두 기계적으로 평가했고 어느 것도 발동하지 않았습니다**(오염된 셀을 제외한
뒤) — 이번 실행은 그 주장을 반박하지 않습니다. 이는 n=15에서의 강한 확증과 같지 않으며, 반박의
부재일 뿐입니다.

### 체인 후속 실험: 실제 누적은 도움이 되는가? (v4, 반증됨)

<!-- okf-benchmark-chain: 2026-07-16-v4 -->

별도의 사전 등록 실행이 OKF의 메커니즘을 직접 검증했습니다: `kubernetes/kubernetes`의
`pkg/scheduler`(v1.30.0, 178개 Go 파일)에 관한, 서로 관련되지만 다른 질문 4개를 이어 붙인
체인으로, 각 세션의 결론을 다음 세션이 시작되기 전에 **실제 batch**에 통과시키고, 이를 누적을
전혀 하지 않은 채 던진 같은 질문 4개와 비교합니다. 이것은 v3의 사전 등록이 "OKF에 유리하고
OKF를 돋보이게 하도록 조정할 수 있다"고 지적하며 실행을 거부했던 바로 그 형태입니다. v4는 이번에는
가드를 두고 그것을 실행했습니다: 질문 4개는 돈을 쓰기 전에 고정하고 소스로 검증했으며, 오염
가드는 **매** 세션 전에 Claude Code의 프로젝트 메모리를 비우고(한 번만이 아니라), 반증 기준은
측정 전에 고정했습니다 — [사전 등록](docs/benchmarks/pre-registration-2026-07-16-v4.md)을
보십시오.

실제 누적은 일어났습니다: gate byte는 스텝을 거치며 단조 증가했고(1835 → 2613 → 3675 → 4950,
n=15 체인), 실제로 측정된 batch 지출($25.81 총액)이 이를 뒷받침합니다. **핵심 예측 — 비용이
체인을 거치며 감소한다 — 은 반증되었습니다.** OKF의 비용은 질문 4개에 걸쳐 $0.231 → $0.216 →
$0.258 → **$0.447**로 움직였고, 기억 없는 대조군도 같은 방향으로 움직였습니다($0.255 → $0.256 →
$0.272 → $0.411). 가장 그럴듯한 설명은 네 번째 질문이 두 arm 모두에게 그저 더 어려웠다는
것입니다 — 이 질문은 메커니즘 두 개를 한꺼번에 묻습니다 — 누적이 도움이 되거나 해가 됐다는 것이
아닙니다. OKF의 atom 단위 정확도는 어느 스텝에서도 baseline을 넘지 못했고, 첫 질문과 마지막 질문
모두에서 baseline보다 낮았습니다. 이진(모든 atom 정답) 채점은 두 arm 모두 0/106이었습니다 — 이
질문 세트는 atom 단위 점수만이 그나마 쓸 만할 만큼 어렵습니다.
[전체 보고서](docs/benchmarks/okf-benchmark-chain-2026-07-16-v4.md).

### 로컬 오버헤드 (효과 결과가 아님)

2026-07-16 측정, macOS arm64, Node `v26.4.0`, 중앙값과 최소/최대.

| 로컬 작업 | 중앙값 | 범위 |
|---|---:|---:|
| SessionStart gate 프로세스 | 57.3 ms | 56.1–60.0 ms |
| SessionEnd batch 트리거 프로세스 | 40.1 ms | 39.3–40.8 ms |
| 상태줄 프로세스 | 35.8 ms | 34.6–36.3 ms |

`node test/bench.mjs [저장소]`로 재현합니다. 로컬 프로세스 비용일 뿐이며, 토큰이나 모델 지연에
대해서는 아무것도 증명하지 않습니다.

### 비용, 재현, 링크

측정한 440회 실행에 **$66.26**, 채점에 **$14.74**가 들었습니다; 지식과 번들 구축에 ~$3.2가 더
들었습니다. 이번 실행 총액 ≈ **$84**. 유료·인증 실행이며, 일부러 smoke 테스트와 CI에서
제외했습니다.

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-knowledge.mjs --target slim --dir <repo>   # 실제 세션 → 트랜스크립트
OKF_RUN_LIVE_BENCH=1 node test/bench-bundles.mjs --target slim --levels 20      # 실제 batch → 번들
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                                    # 측정
```

v4 체인 실행(120 세션, 스텝 사이에 실제 batch)에는 측정 **$31.95** + 채점 **$9.20** + 실제
ingest **$25.81** ≈ **$67**이 들었습니다:

```sh
OKF_RUN_LIVE_BENCH=1 OKF_BENCH_CHAINS=15 node test/bench-chain.mjs   # 체인 세션, 실제 batch, 측정
```

[전체 보고서](docs/benchmarks/okf-benchmark-2026-07-16-v3.md) ·
[체인 후속 보고서](docs/benchmarks/okf-benchmark-chain-2026-07-16-v4.md) ·
[raw JSON](docs/benchmarks/raw/) ·
[커밋된 번들](docs/benchmarks/bundles/) ·
[사전 등록](docs/benchmarks/pre-registration-2026-07-16-v3.md) ·
[체인 사전 등록](docs/benchmarks/pre-registration-2026-07-16-v4.md) ·
[사용 가이드](docs/USAGE.md).

## 언어 지원

fallback 분석기는 결정적이고 의존성이 없으며 보수적으로 연결합니다. “파일 발견”과 “구조 분석”을 구분해 `/okf:okf-analysis`에 표시합니다.

| 언어 | 내부 관계 | 선언 | 주요 한계 |
|---|---|---|---|
| JavaScript / TypeScript | 상대 import/export/require, NodeNext `.js` → TS | function, class | bare package는 외부 |
| Python | 절대/상대 dotted module | function, class | dynamic import 미지원 |
| Go | `go.mod` 기반 저장소 내부 package node | function, struct | 거짓 file-to-file edge를 만들지 않음 |
| Rust | `mod`, `use crate/self/super` | function, struct/enum/trait | macro 생성 구조 생략 |
| Java / Kotlin | 저장소에 선언된 package/class path | class/interface/enum, Kotlin function | reflection 생략 |
| Ruby | `require_relative` | class, method | gem은 외부 |
| PHP | namespace/use/alias/grouped use, require/include | class/interface/trait/enum/function | 동적 autoload/call target 생략 |
| C / C++ | quoted include, 명시 경로를 가진 유일한 local angle include | class/struct/enum/union/typedef/namespace/function definition | regex 기반, macro·복잡한 여러 줄 문법 누락 가능 |
| C# | 저장소가 선언한 namespace node | class/interface/struct/record/enum | 외부 namespace는 외부 |
| Swift | 명시적 상속·conformance·extension target | class/struct/enum/protocol/actor/extension/typealias/function | 이름 충돌 방지를 위해 중첩 cross-file target 생략 |

2,000개 파일 상한에 닿으면 `truncated`를 표시합니다. 512 KiB 초과 파일은 노드는 유지하되 미분석으로 표시합니다. vendor/generated 디렉터리를 보수적으로 제외하지만 특이한 레이아웃은 수동 해석이 필요할 수 있습니다.

## 실제 오픈소스 검증

고정 commit을 clone하고 대표 edge를 원본과 대조했습니다. 시간은 운영 안전성 단일 실행값이며 모델 속도 benchmark가 아닙니다.

| 저장소 | commit | 언어 파일 | 선언 | 내부 edge | 잘림 |
|---|---|---:|---:|---:|---:|
| [Slim](https://github.com/slimphp/Slim) | `80900fb` | 125 | 127 | 305 | 아니요 |
| [Redis](https://github.com/redis/redis) | `f76dff7` | 784 | 5,796 | 990 | 아니요 |
| [fmt](https://github.com/fmtlib/fmt) | `a79df45` | 46 | 283 | 121 | 아니요 |
| [Alamofire](https://github.com/Alamofire/Alamofire) | `903c53c` | 98 | 2,052 | 215 | 아니요 |

검증 중 Swift 표준 `Error`가 무관한 중첩 `Error`에 연결되는 문제와 C 표준 header가 vendored 호환 header에 연결되는 문제를 발견해 수정했습니다. 원본 행 대조와 남은 공백은 [검증 보고서](docs/benchmarks/oss-analysis-2026-07-15.md)에 있습니다.

## 데이터 흐름과 개인정보

- 유휴 sweep이 전체 transcript를 `raw/`에 복사하며 수집 중 파싱하거나 자르지 않습니다. 세션 훅은 배치를 깨울 뿐입니다.
- 배치는 상한이 있는 digest를 만들고 별도 `claude -p` 호출로 Anthropic에 전송합니다. 이것이 OKF가 추가하는 유일한 모델/API 전송입니다.
- 배치는 `--safe-mode`, 제한된 도구, stdin prompt, lint/rollback, Bash 없음으로 실행합니다.
- 분석기는 임시 워크스페이스의 지식 파일 사본에서 작업하며 `raw/`·`.okf/`·`.git`에 물리적으로 접근할 수 없습니다. 드라이버는 정규 `.md` 파일만 번들로 반영합니다(스크립트·심링크는 번들에 닿지 않음).
- raw와 처리 대기 transcript는 git-ignore되며 추출된 Markdown 지식만 로컬 commit합니다.
- plugin은 push나 remote 추가를 하지 않습니다. POSIX 디렉터리는 `0700`, raw/state/log 파일은 `0600`이며 Windows는 계정 ACL을 사용합니다.
- 영구 진단 로그에는 transcript, Claude stdout/stderr, credential, 전체 raw 경로를 남기지 않습니다.
- 라이브 benchmark fixture는 합성 데이터이며 개인정보와 credential이 없습니다.

## 설정

`~/.claude/okf/.okf/config.md`를 편집하거나 `/okf:okf-config`를 사용합니다. 알 수 없거나 잘못된 값은 무시하고 안전한 기본값을 씁니다.

| 키 | 기본값 | 의미 |
|---|---:|---|
| `enabled` | `true` | 수집·gate·배치 전체 스위치 |
| `batch_interval_hours` | `1` | 기회주의적 배치 최소 간격 |
| `batch_max_digest_kb` | `600` | 배치 전체 digest 예산 |
| `batch_max_sessions` | `50` | 폭주 방지 상한, 비용 제어는 byte 예산 |
| `batch_model` / `batch_effort` | `claude-sonnet-5` / `medium` | 배치 모델 설정, 빈 값은 CLI 기본값 |
| `capture_exclude_cwd` | `[]` | 수집 제외 glob — 세션 cwd에 대해 판정 |
| `sweep_min_idle_minutes` | `60` | 마지막 활동 후 이 시간이 지나야 완결된 대화로 보고 수집. `0`은 즉시 수집 |
| `batch_digest_cap_kb` | `150` | 세션별 LLM digest 상한, raw는 무손실 |
| `remove_candidate_ttl_days` | `30` | 처리된 raw 삭제 전 보존일 |
| `inject_max_lines` / `inject_max_bytes` | `120` / `9000` | Claude Code 10,000자 기준 아래 inline gate 상한 |

## 제거

```sh
claude plugin uninstall okf
```

데이터는 `~/.claude/okf`에 남습니다. 검토·백업 후 원할 때 직접 삭제하세요.

## 개발 검증

```sh
node test/smoke.mjs
node test/bench.mjs
for file in $(rg --files -g '*.mjs'); do node --check "$file"; done
claude plugin validate .claude-plugin/plugin.json
claude plugin validate .claude-plugin/marketplace.json
git diff --check
```

라이브 benchmark는 별도 opt-in입니다: `OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs`.

## 참고와 라이선스

README 구조는 [uv](https://github.com/astral-sh/uv), [Ruff](https://github.com/astral-sh/ruff), [Playwright](https://github.com/microsoft/playwright), [fmt](https://github.com/fmtlib/fmt), [Slim](https://github.com/slimphp/Slim)의 짧은 설치·재현 구조를 참고했으며 문구나 benchmark 주장을 복사하지 않았습니다.

OKF 배경: [Open Knowledge Format specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md). 이 plugin은 [MIT](LICENSE) 라이선스입니다.
