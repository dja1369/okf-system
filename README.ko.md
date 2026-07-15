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

첫 `SessionStart`가 `~/.claude/okf`(또는 `$CLAUDE_CONFIG_DIR/okf`)를 만듭니다. 이후 캡처와 기회주의적 배치는 자동입니다.

## 세션 연속성 흐름

```text
세션 1 결정       SessionEnd             백그라운드 배치             세션 2
정책 확정    ->   raw 무손실 복사   ->   재사용할 OKF Markdown  ->  작은 인덱스 주입
                                             |                          |
                                             +-- 로컬 git 이력          +-- 관련 concept Read
```

예를 들어 “10% → 50% → 100% 배포, 오류율 0.5% 초과 시 원복”을 한 세션에서 정합니다. 캡처와 ingest가 끝나면 다음 세션은 사용자가 정책을 다시 붙여넣지 않아도 인덱스에서 이 결정을 찾을 수 있습니다. 인덱스는 전체 기억이 아니라 탐색 경로이므로 Claude는 행동 전에 관련 concept 본문을 `Read`해야 합니다.

## 명령

플러그인 명령에는 항상 `okf:` namespace가 필요합니다.

| 명령 | 용도 |
|---|---|
| `/okf:okf-status` | 마지막 캡처/배치, 대기 세션, 잠금 상태 |
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

## OKF 효과 벤치마크

<!-- okf-live-benchmark: valid-2026-07-15T15-03-01Z -->

2026-07-15 라이브 실행: Claude Code `2.1.210`, 요청 모델 `sonnet`/medium(실제 Sonnet 5 + Haiku 4.5), macOS arm64, Node `v26.4.0`, commit `c00d3fc`, 조건별 순서 교차 5회. 후속 호출 전에 C 번들은 목표 사실 8/8을 모두 concept에 포함하고 gate에 8/8 경로를 노출했으며 D는 0/8이었습니다.

opt-in harness는 각 조건을 최소 5회 반복합니다.

| 조건 | 연속성 성공 | token activity p50 / p95 | wall p50 / p95 | 비용 p50 |
|---|---:|---:|---:|---:|
| A — 기억 없음 | 0/5 | 27,320 / 27,574 | 16.40 / 18.17초 | $0.024037 |
| B — 수동 재설명 | 5/5 | 9,070 / 9,093 | 6.07 / 7.42초 | $0.008410 |
| C — OKF 사용 | 5/5 | 22,857 / 22,883 | 11.33 / 12.80초 | $0.033189 |
| D — 무관한 OKF | 0/5 | 21,507 / 22,261 | 16.92 / 18.88초 | $0.030332 |

C는 목표 사실을 모두 회수했지만 같은 정답률의 B보다 토큰·응답시간·도구·비용을 줄이지 못했습니다. C 중앙값은 token activity가 13,787 많고 wall time이 5.26초 길었습니다. batch 1회 비용은 111,381 token activity/$0.164360이며 B−C 절감이 음수라 토큰·비용 손익분기점은 없습니다.

성공률, 결정 준수율, 잘못된 가정, 추가 질문, tool call, 첫 유효 응답, API/wall time, `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, CLI 비용을 기록합니다. 토큰 범주는 raw JSON에서 분리하며 batch ingest와 repair 비용도 손익분기에 포함합니다. Claude CLI가 사용자 전용·gate 전용 토큰처럼 별도로 제공하지 않는 값은 추정하지 않고 `null`로 남깁니다.

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs
```

유료·인증 실행이라 smoke/CI에서 제외합니다. 토큰 범주는 분리하며 CLI가 제공하지 않는 user-only/gate-only/transcript token은 `null`입니다. [유효 보고서](docs/benchmarks/okf-live-2026-07-15T15-03-01-343Z.md), [raw JSON](docs/benchmarks/raw/okf-live-2026-07-15T15-03-01-343Z.json), [해석 가이드](docs/USAGE.md)를 참고하세요.

### 로컬 오버헤드 — OKF 효과 결과가 아님

2026-07-15 macOS arm64, Node `v26.4.0`에서 새로 측정한 중앙값과 범위입니다.

| 로컬 작업 | 중앙값 | 범위 |
|---|---:|---:|
| SessionStart gate 프로세스 | 57.4 ms | 56.7–58.2 ms |
| SessionEnd 무손실 캡처 프로세스 | 43.4 ms | 41.8–43.9 ms |
| 상태줄 프로세스 | 36.7 ms | 34.8–36.8 ms |

`node test/bench.mjs [저장소]`로 재현합니다. 이 값은 로컬 hook/process 비용일 뿐 토큰 절감이나 모델 응답 개선을 증명하지 않습니다.

### 배치 비용과 손익분기

라이브 harness는 명시적 opt-in telemetry 파일에 batch/repair usage 숫자만 기록합니다. 반복 실험의 중앙 순절감이 양수일 때만 토큰 활동량과 CLI 비용 손익분기를 계산합니다.

```text
초기 OKF 비용 = batch ingest + repair + 무관 gate의 측정 오버헤드
세션당 순절감 = 수동 재설명 중앙값 - OKF 중앙값
손익분기 세션 수 = ceil(초기 OKF 비용 / 양수인 세션당 순절감)
```

측정된 B−C 절감이 음수이므로 이번 실행에는 토큰·비용 손익분기점이 없습니다.

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

- `SessionEnd`는 전체 transcript를 `raw/`에 복사하며 캡처 중 파싱하거나 자르지 않습니다.
- 배치는 상한이 있는 digest를 만들고 별도 `claude -p` 호출로 Anthropic에 전송합니다. 이것이 OKF가 추가하는 유일한 모델/API 전송입니다.
- 배치는 `--safe-mode`, 제한된 도구, stdin prompt, lint/rollback, Bash 없음으로 실행합니다.
- raw와 처리 대기 transcript는 git-ignore되며 추출된 Markdown 지식만 로컬 commit합니다.
- plugin은 push나 remote 추가를 하지 않습니다. POSIX 디렉터리는 `0700`, raw/state/log 파일은 `0600`이며 Windows는 계정 ACL을 사용합니다.
- 영구 진단 로그에는 transcript, Claude stdout/stderr, credential, 전체 raw 경로를 남기지 않습니다.
- 라이브 benchmark fixture는 합성 데이터이며 개인정보와 credential이 없습니다.

## 설정

`~/.claude/okf/.okf/config.md`를 편집하거나 `/okf:okf-config`를 사용합니다. 알 수 없거나 잘못된 값은 무시하고 안전한 기본값을 씁니다.

| 키 | 기본값 | 의미 |
|---|---:|---|
| `enabled` | `true` | 캡처·gate·배치 전체 스위치 |
| `batch_interval_hours` | `1` | 기회주의적 배치 최소 간격 |
| `batch_max_digest_kb` | `600` | 배치 전체 digest 예산 |
| `batch_max_sessions` | `50` | 폭주 방지 상한, 비용 제어는 byte 예산 |
| `batch_model` / `batch_effort` | `claude-sonnet-5` / `medium` | 배치 모델 설정, 빈 값은 CLI 기본값 |
| `capture_exclude_cwd` | `[]` | 명시적 캡처 제외 glob |
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
