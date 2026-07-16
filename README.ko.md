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

<!-- okf-benchmark: 2026-07-16 -->

> **철회 공지 (2026-07-16).** 이 절에 처음 공개했던 주장 세 건을, 이번 실행이 남긴 원본 데이터를
> 감사한 뒤 철회했습니다: `rfcs_policy` 함정 설명(날조 — 함정은 발동한 적이 없습니다), 축적 추세
> 헤드라인(표본이 뒷받침하지 못합니다), 그리고 이 절의 원래 제목이던 "OKF만이 작동하는 곳"(자기
> 표에 의해 반박됩니다). 각 철회는 해당 주장이 있던 자리에 표시해 두었습니다. 무엇을 철회했고 각각을
> 어떻게 잡아냈는지는 [v3 사전 등록](docs/benchmarks/pre-registration-2026-07-16-v3.md)에
> 기록했습니다. 이 절의 나머지 발견은 모두 그대로입니다.

**OKF는 탐색을 대신해 주지 않습니다. 탐색으로는 결코 찾을 수 없는 것을 저장할 뿐입니다.**

이 문장의 두 절반을 모두 실제 오픈소스 저장소에서 측정했고, 그중 OKF에 불리한 절반을 먼저
공개합니다.

### 측정 방법

고정(pinned)된 공개 저장소 두 개 — 합성 fixture가 아니므로 탐색에는 탐색이 실제로 치르는 비용이
그대로 들고, 기억 없는 baseline이 진짜로 이길 수 있습니다:

| 역할 | 저장소 | 커밋 |
|---|---|---|
| 코드베이스 | [slimphp/Slim](https://github.com/slimphp/Slim) | `80900fb3` (PHP 파일 125개) |
| 문서 더미 | [rust-lang/rfcs](https://github.com/rust-lang/rfcs) | `f635361c` (Markdown 파일 651개) |

모든 번들의 모든 concept은 실제 파이프라인이 만들었습니다 — 고정된 저장소를 탐색하는 실제
`claude -p` 세션, 실제 Claude Code 트랜스크립트, 실제 batch ingest, 실제 gate. **손으로 쓴
concept은 하나도 없습니다.** 분량을 만드는 filler까지 포함해서입니다.

조건 5개. 모두 동일한 도구(`Read`, `Glob`, `Grep`, `Bash(git log/show/diff/blame/grep)`)와, 조건에
중립적인 동일한 지시문을 받습니다 — 어떤 조건에도 gate를 참고하라고 말하지 않습니다.

- **zero-base** — 아무것도 없음. OKF가 대체한다고 주장하는 대상입니다.
- **answer key(정답지)** — 정답을 그대로 붙여 넣습니다. 그 문자열을 만들려면 이미 답을 알고 있어야
  하므로 어떤 사용자도 이 조건을 점유할 수 없습니다. 경쟁자가 아니라 하한선입니다.
- **OKF** — 실제 gate 텍스트.
- **wrong knowledge(무관한 지식)** — *다른* 저장소에 대한 실제 concept으로 크기를 맞춘 gate.
  "지식이 도왔다"와 "gate가 도왔다"를 분리합니다.
- **CLAUDE.md** — 똑같이 축적된 지식을 평평한 파일 하나에 붙여 넣은 것. 진짜 기존 강자입니다.

`total_cost_usd`가 헤드라인이고, token activity는 그 대신이 아니라 그 옆에 함께 보여줍니다.
`cache_read`가 그 합을 지배하는데 과금은 ~50배 싸서 두 열이 서로 반대 방향을 가리키기 때문입니다.
효율은 정답을 맞힌 실행끼리만 비교합니다. 실행마다 nonce를 넣어 prompt caching을 무력화합니다.
채점은 조건을 모르는 심판이 소스에서 검증한 ground truth에 대고 합니다. **어떤 숫자도 시나리오
간에 평균 내지 않습니다**: grep 한 번과 파일 다섯 개짜리 호출 체인은 서로 다른 현상이고, 섞으면
시나리오 선택이 헤드라인을 고르게 됩니다.

설계, 예측, 반증 기준은 **첫 유료 호출 전에**
[사전 등록](docs/benchmarks/pre-registration-2026-07-16.md)하고 커밋했습니다.

### OKF가 지는 곳: 코드가 답할 수 있는 모든 것

답이 소스나 git 히스토리에 있는 시나리오 5개. 고정된 체크아웃에서 검증했고, 각각 독립적인 반증
시도를 견뎌냈습니다.

| 시나리오 | zero-base | OKF | 판정 |
|---|---:|---:|---|
| `rfcs_cheap` — grep 한 번 | **$0.0256** · 4/5 | $0.0505 · 3/5 | OKF가 2.0배 비쌈 |
| `slim_cheap` — grep 한 번 | **$0.0198** · 4/5 | $0.0386 · 5/5 | OKF가 1.9배 비쌈 |
| `slim_stale` — 이후 커밋으로 번들 지식이 낡음 | **$0.0345** · 5/5 | $0.0632 · 4/5 | OKF가 1.8배 비쌈 |
| `rfcs_buried` — 문서 651개 속에서 근거 찾기 | **$0.0326** · 4/5 | $0.0910 · 3/5 | OKF가 2.8배 비쌈 |
| `slim_buried` — 파일 다섯 개짜리 호출 체인 추적 | $0.1669 · 2/5 · **tool 10회** | **$0.0701** · 2/5 · **tool 3회** | **OKF가 2.4배 쌈** |

**OKF는 다섯 중 넷을 집니다.** 탐색이 진짜로 비쌀 때만 이기고, 거기서는 tool call을 10회에서
3회로 줄입니다. grep 한 번이 질문에 답한다면 gate는 순수한 오버헤드입니다 — 이것은 결함이 아니라
산수입니다.

`slim_stale`은 짚어둘 만합니다: 번들이 낡은 주장을 담고 있었는데(HTML 에러 렌더러가 이스케이프하지
않는다 — 커밋 `f897118b` 이전에는 참, 고정된 커밋에서는 거짓), 모델은 **코드를 확인하고 알아서
바로잡았습니다**, 4/5. 낡은 지식이 모델을 자신 있게 틀리게 만들지 않았습니다. 그럴 것이라던 사전
등록 예측은 틀렸습니다.

### 탐색이 도울 수 없는 곳: 코드가 담고 있지 않은 지식

팀 정책과 도메인 어휘 — 대화에서 정해졌고 저장소에는 한 번도 기록되지 않은 것들. 각 시나리오는
독립적인 적대자가 공격했습니다. 그는 작업 트리, git 히스토리 ~300개 리비전, 커밋 메시지, 문서,
설정, stash, dangling object까지 뒤졌고(적중 0건), **보기 전에 관례로부터 추측을 기록**했습니다.
그 추측들은 0/3, 0/3, 1/5를 기록했습니다.

각 저장소에는 함정도 있습니다: "emitter"로 grep하면 `ResponseEmitter`가 나오고, 청크 크기를 찾으면
`4096`이 나오며, RFC 더미에서 MSRV 정책을 검색하면 문서들이 `N-2`를 제안합니다.

| 시나리오 | zero-base | OKF | 무관한 지식 | CLAUDE.md |
|---|---:|---:|---:|---:|
| `slim_policy` — 어떤 env가 에러 상세를 켜는지와 그 예외 조항 | **0/5** ($0.0509 지출) | **5/5** · $0.0840 | 0/5 | 5/5 · $0.1314 |
| `slim_domain` — 팀이 말하는 "에미터"가 무엇인지 | **0/5** · **자신 있게 틀림 5/5** | **4/5** · $0.0624 | 0/5 | 5/5 · $0.1198 |
| `rfcs_policy` — 팀의 "thaw rule" 대기 기간 | **0/5** | 2/5 · $0.0749 | 0/5 | 0/5 |

**zero-base는 15전 0승입니다.** 돈은 썼는데 얻은 게 없습니다. 답이 거기 없기 때문입니다.
`slim_domain`에서는 **5회 실행 중 5회 자신 있게 틀렸습니다**: 탐색해서 `ResponseEmitter`를 찾아내
높은 확신으로 답했습니다 — 하지만 팀의 "에미터"는 `OutputBufferingMiddleware`입니다. 그들은
FrankenPHP worker 모드로 돌리고 있어서 `ResponseEmitter`는 죽은 코드이기 때문입니다. 여기서 탐색은
단지 실패하는 게 아니라, 함정으로부터 자신 있는 오답을 제조해 냅니다.

**무관한 지식도 15전 0승입니다.** 진짜지만 무관한 concept으로 가득 찬 gate는 아무것도 되찾아 주지
않습니다. 이득은 gate를 가진 데서가 아니라 지식에서 옵니다.

OKF는 15개 중 11개를 맞혔고, 같은 사실을 담은 CLAUDE.md보다 1.6~1.9배 적은 비용으로 그렇게 했습니다.
`slim_domain`에서는 **concept 파일을 하나도 읽지 않았습니다**(0/5) — index 줄만으로 충분했고,
zero-base의 tool call 7회에 대해 2회였습니다.

**여기서는 CLAUDE.md도 작동합니다.** 표가 그렇게 말하고 있습니다: `slim_policy`에서 5/5,
`slim_domain`에서 5/5로 OKF의 4/5를 이깁니다. 이 표가 뒷받침하는 것은 기존 강자와 대등한 정확도를
1.6~1.9배 적은 비용과 제한된 주입량으로 낸다는 것이지, OKF만이 유일하다는 것이 아닙니다. 이 절은
처음에 "OKF만이 작동하는 곳"이라는 제목으로 공개됐지만 자기 표가 그 제목을 반박합니다. **그 제목은
철회합니다.**

`rfcs_policy`는 정직한 실패입니다: OKF는 2/5에 그쳤습니다. **여기 실었던 설명, 즉 문서 더미에 놓인
`N-2` 제안이 모델을 올바른 index 줄에서 끌어낼 만큼 강력한 함정이라는 설명은 틀렸으며, 이를
철회합니다.** OKF 실행 5회는 모두 번들 파일만 읽었습니다. RFC 문서를 연 실행은 하나도 없고, `N-2`라고
답한 실행도 하나도 없습니다. 다섯 모두 "릴리스 4개"라고 답했습니다. 함정은 발동한 적이 없습니다.
2/5의 원인은 공개 전에 조사하지 않았고, 여기에 대체 설명을 내놓지 않습니다. 재측정이 진행 중입니다.
이 시나리오에서 CLAUDE.md는 0/5였으므로, OKF는 여전히 기존 강자를 이깁니다.

### 축적: 추세 주장은 철회합니다

이 절은 처음에 번들 크기(concept 1개 → 35개)에 대한 비용 곡선과 함께 다음 헤드라인을 실었습니다:
**"concept 1개에서 35개로 가는 동안 OKF는 싸졌고($0.1291 → $0.0908), CLAUDE.md는 2.2배
비싸졌습니다($0.1279 → $0.2828). 두 곡선은 갈라집니다."** **그 추세 주장은 표본이 뒷받침하지
못하므로 철회합니다.**

숫자 자체는 날조가 아닙니다 — 사전 등록한 규칙대로 정답을 맞힌 실행만 모은 중앙값입니다. 하지만
그것은 각각 **3, 2, 5, 3, 2, 4회** 실행의 중앙값이고, 최저점 $0.0701은 *실행 두 번의 중앙값*입니다.
모든 실행을 놓고 보면 레벨별 분포는 완전히 겹치고(concept 1개 레벨은 $0.0774~$0.2214, 35개 레벨은
$0.0836~$0.1606), 전체 실행의 중앙값은 단조롭지도 않습니다: $0.1237, $0.1884, $0.1425, $0.0852,
$0.1142, $0.1135. 이 절은 이미 두 문단 뒤에서 "n=5에서는 여기서 갈리는 게 없습니다"라고 적고
있었습니다 — 그 문장이 맞았고, 그 위의 헤드라인이 틀렸습니다. 곡선은 여기 다시 싣지 않습니다. 실행
두 번의 중앙값은 곡선 위의 점이 될 수 없기 때문입니다.

gate가 평평해지는 구간에 대한 설명도 틀렸습니다. batch가 concept 14개를 index 한 줄로 접었기
때문이라며, OKF가 지식을 조직하는 방식에서 창발한 성질인 것처럼 제시했습니다. **그것은
`lib/config.mjs`의 `inject_max_lines: 120` 캡입니다** — 설정 상수입니다. `bench-bundles.mjs`는
`gateTruncated`를 기록하는데, 이 값은 평평해지기 시작하는 바로 그 레벨에서 참입니다. index 항목이
우아하게 중첩된 것이 아니라 **예산 때문에 버려진** 것입니다.

옛 주장의 절반은 살아남습니다. 다만 그 자체로만 적습니다: CLAUDE.md는 모든 프롬프트마다 모든
concept 본문을 실어 나르므로, 프롬프트가 concept 수에 따라 선형으로 자랍니다. 이는 그 형식에서
기계적으로 따라 나오는 사실입니다. 여기서 OKF 쪽과의 비교는 끌어내지 않습니다.

정확도는 분량이 늘어도 좋아지지 않았고 계속 들쭉날쭉했습니다(2/5~5/5). **레벨 축은 v3에서
폐기합니다**: 그 축은 설정 상수를 측정하고 있어서, 다시 돌려 봐야 설정 파일에서 읽어 낼 수 있는
숫자를 더 정밀하게 재는 것밖에 되지 않기 때문입니다.

### 로컬 오버헤드 (효과 결과가 아님)

2026-07-16 측정, macOS arm64, Node `v26.4.0`, 중앙값과 최소/최대.

| 로컬 작업 | 중앙값 | 범위 |
|---|---:|---:|
| SessionStart gate 프로세스 | 57.3 ms | 56.1–60.0 ms |
| SessionEnd batch 트리거 프로세스 | 40.1 ms | 39.3–40.8 ms |
| 상태줄 프로세스 | 35.8 ms | 34.6–36.3 ms |

`node test/bench.mjs [저장소]`로 재현합니다. 로컬 프로세스 비용일 뿐이며, 토큰이나 모델 지연에
대해서는 아무것도 증명하지 않습니다.

### 비용, 그리고 이번 실행이 말해 줄 수 없는 것

지식 구축에 실제 세션에서 **$3.59**, batch ingest에서 **$4.92**가 들었습니다. 측정한 250회 실행에는
**$28.16**과 채점에 **$9.44**가 들었습니다.

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-knowledge.mjs --target slim --dir <repo>   # 실제 세션 → 트랜스크립트
OKF_RUN_LIVE_BENCH=1 node test/bench-bundles.mjs --target slim --levels 1,5,20  # 실제 batch → 레벨별 번들
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                                    # 측정
```

유료·인증 실행이며, 일부러 smoke 테스트와 CI에서 제외했습니다.
[전체 보고서](docs/benchmarks/okf-benchmark-2026-07-16.md) ·
[raw JSON](docs/benchmarks/raw/) ·
[사전 등록](docs/benchmarks/pre-registration-2026-07-16.md) ·
[사용 가이드](docs/USAGE.md).

한계, 그대로 말하면:

- **셀당 n=5.** 작습니다. 여기서는 분포가 완전히 분리될 때만 승리라고 말합니다.
- **모델 조합이 고정되어 있지 않습니다.** `claude-sonnet-5`를 요청했지만 CLI가 내부 작업용으로
  `claude-haiku-4-5`를 함께 붙였습니다. 조건 간 비용 비교에는 그 아티팩트가 실려 있습니다.
- **저장소 두 개, 각각 언어 하나씩.** 규모나 생태계 전반에 걸친 일반성은 주장하지 않습니다.
- **wall-clock은 공개하지 않습니다.** 측정은 동시성 5로 돌렸습니다. 비용·토큰·tool call은 그 영향을
  받지 않지만 응답 지연은 받습니다. 속도 주장을 하려면 순차로 다시 돌려야 합니다.
- gate 텍스트는 프로덕션의 `SessionStart` `additionalContext` 경로가 아니라 프롬프트 앞에 붙여
  전달했습니다. 같은 텍스트, 다른 전달 방식입니다.
- 정책 시나리오는 사람이 정책을 작성한다는 전제 위에 서 있습니다. 정책이란 원래 그런 것입니다.
  변론은, 그 답이 저장소에 없다는 것이 증명 가능하고 적대자가 그것을 추측해 내지 못했다는 점입니다.

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
