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

<!-- okf-live-benchmark: valid-2026-07-15T16-06-28Z -->

**OKF는 토큰을 아끼지 않습니다. 새 세션이 이미 잃어버린 것을 되찾을 뿐입니다.** 아래 숫자를 공개하는 이유는 그 사실을 그대로 말하기 위해서입니다.

측정 대상은 이전 세션이 확립한 사실 8개와 기억이 도움 되지 않는 대조 질문 1개입니다 — 아키텍처(SQLite / repository 패턴), 코딩 규칙(named export only), 과거 장애 수정(`busy_timeout=5000`), 응답 선호(한국어 / 간결), 파일·배포 정책(`src/config.mjs` / `npm run deploy:canary`), 무관한 산술 대조군(7 × 8 = 56). 조건 5개, 조건별 순서 교차 5회. C의 번들은 **실제** SessionEnd 캡처 → 격리 batch ingest → SessionStart gate로 만들며 손으로 심은 concept은 없습니다. C가 목표 사실을 전부 포함하고 gate로 라우팅하며 D는 하나도 없을 때에만 preflight가 유료 실행을 허용합니다.

- **A — 기억 없음.** 아무것도 재설명하지 않은 새 세션. 정직한 현상태입니다.
- **B_oracle — 정답지.** 기대값 8개를 그대로 붙여 넣습니다. 그 문자열을 만들려면 OKF가 되찾으려는 사실을 이미 전부 알아야 하므로 **어떤 사용자도 점유할 수 없습니다.** baseline이 아니라 상한선이고, 사람의 노동은 0으로 계산됩니다.
- **B_realistic — 사람들이 실제로 하는 것.** 다음 세션에 어떤 사실이 필요할지 미리 알 수 없으니 관련될 법한 것을 전부 재설명합니다. CLAUDE.md 습관이자 손익분기의 실제 비교군입니다.
- **C — OKF 사용.**
- **D — 무관한 OKF.** 관련 내용이 없는 gate로 "gate가 도왔다"와 "gate 자체가 비용이다"를 분리합니다.

2026-07-15 라이브 실행: Claude Code `2.1.210`, `sonnet`/medium(실제 Sonnet 5 + Haiku 4.5), macOS arm64, Node `v26.4.0`, 조건별 5회. C preflight: 사실 8/8 포함, 8/8 gate 경로. D: 0/8.

| 조건 | 연속성 | token activity p50 | wall p50 | 비용 p50 | 읽기 | 턴 |
|---|---:|---:|---:|---:|---:|---:|
| A — 기억 없음 | **0/5** | 27,246 | 13.82초 | $0.022218 | 2 | 4 |
| B_oracle (정답지) | 5/5 | 9,069 | 4.86초 | $0.008410 | 0 | 1 |
| B_realistic | 5/5 | 9,069 | 5.96초 | $0.008410 | 0 | 1 |
| **C — OKF 사용** | **5/5** | **10,395** | 6.46초 | $0.011329 | **0** | **1** |
| D — 무관한 OKF | 0/5 | 20,602 | 14.50초 | $0.025879 | 1 | 2 |

**A 행을 먼저 보세요.** 기억이 없으면 세션은 27,246 토큰을 태우고, 답을 찾겠다고 파일 두 개를 읽고, 네 턴을 쓰고도 여전히 **0/8**입니다. OKF가 실제로 대체하는 조건이 이것이고 C는 이를 이깁니다 — 토큰 2.6배 절감, 0/8 → 8/8, 파일 읽기 없이 단 한 턴.

**C는 B를 이기지 못하고 앞으로도 못 이깁니다.** B는 정답을 프롬프트에 그대로 붙입니다. 이미 갖고 있는 것보다 빨리 가져오는 방법은 없습니다. 지금 번들 크기에서는 재설명할 무관한 지식이 아직 없어 B_realistic이 B_oracle과 같은 9,069입니다. C는 세션당 1,326 토큰과 $0.0029를 더 씁니다. 번들 구축에는 batch ingest 1회, token activity **133,364**와 **$0.176758**이 들었습니다. **토큰·비용 손익분기점은 없습니다** — `perSessionTokenSaving`이 음수라 harness는 숫자를 지어내지 않고 `null`을 보고합니다.

지난 실행 이후 바뀐 것은 gate 자체입니다. C는 예전에 7턴·파일 읽기 5회로 **22,857** 토큰을 썼지만, 지금은 같은 5/5 회수율로 1턴·읽기 0회에 **10,395**입니다. 옛 gate는 무조건 `Read`를 시켰고 그 오버헤드의 91%가 index가 이미 전달한 사실을 다시 가져오는 왕복이었습니다. [수정 내역](https://github.com/dja1369/okf-system/pull/7).

### 축적의 한계 — 추정이 아니라 측정

"지식이 쌓일수록 OKF가 싸진다"는 주장은 측정을 견디지 못합니다. 무관한 concept 50개를 번들에 넣고 같은 벤치마크를 돌리면 **preflight가 실패합니다**:

```
checkedFacts: 8   presentFacts: 8   routedFacts: 6   ready: false
```

사실 두 개(`architecture_pattern`, `export_style`)가 `decisions/tech-stack.md`에 있는데, filler concept들이 알파벳 순으로 앞서면서 그 파일이 **주입 index에서 잘려나갔습니다**. gate의 index는 Claude Code의 hook 10,000자 한도를 지키려 상한이 걸려 있고, 실제 한국어 concept 줄은 ~214바이트입니다.

| 번들의 concept 수 | gate index 노출 |
|---:|---:|
| 20 | 20 |
| 40 | 40 |
| **55** | **43**(잘림) |
| 100 | 43(잘림) |

**~43개를 넘으면 index가 잘리고**, 무엇이 살아남을지는 관련성도 최신성도 아닌 파일명이 정합니다. 카테고리를 라운드로빈으로 배분해 굶는 카테고리는 없게 하고 잘린 카테고리는 자기 `index.md`를 가리켜 나머지도 내려가면 닿지만, 내려가려면 도구 왕복이 필요합니다 — 방금 gate 수정으로 없앤 바로 그 ~12,500 토큰 비용입니다. 그 지점을 넘으면 OKF의 경제성은 좋아지는 게 아니라 *나빠집니다*. 튜닝 손잡이가 아니라 설계의 정직한 현주소입니다.

harness는 결정 준수, 잘못된 가정, 추가 질문, tool call, 첫 유효 응답, API/wall time, `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, CLI 비용도 기록하며 토큰 범주는 raw JSON에서 분리합니다. `tokenActivity`는 cache read를 output token과 1:1로 더하지만 cache read 과금은 ~50배 싸므로 **방어 가능한 열은 비용**입니다. n=5에서 `p95`는 산술적으로 항상 max(cold run 하나)라 싣지 않습니다. CLI가 별도로 제공하지 않는 값(사용자 전용·gate 전용 토큰)은 추정하지 않고 `null`로 남깁니다.

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                      # 위에 게시한 실행
OKF_RUN_LIVE_BENCH=1 OKF_BENCH_FILLER=50 node test/bench-okf.mjs  # 축적 축
```

유료·인증 실행이라 smoke/CI에서 제외합니다. 토큰 범주는 분리하며 CLI가 제공하지 않는 user-only/gate-only/transcript token은 `null`입니다. [보고서](docs/benchmarks/okf-live-2026-07-15T16-06-28-592Z.md), [raw JSON](docs/benchmarks/raw/okf-live-2026-07-15T16-06-28-592Z.json), [해석 가이드](docs/USAGE.md)를 참고하세요. 수정 이전 실행은 감사 추적용으로 남겨둡니다.

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
세션당 순절감 = B_realistic 중앙값 - OKF 중앙값
손익분기 세션 수 = ceil(초기 OKF 비용 / 양수인 세션당 순절감)
```

비교 대상은 B_oracle이 아니라 **B_realistic**입니다. B_oracle의 재설명 문자열에는 정답 자체가 들어 있어, OKF가 존재하는 이유인 바로 그 작업을 0으로 계산합니다 — 그쪽으로 잡은 손익분기는 무의미합니다. 측정된 실행에서는 어느 쪽으로 봐도 절감이 음수(−1,326 토큰, −$0.0029)라 두 손익분기 필드 모두 `null`입니다. harness의 결함이 아니라 그게 결과입니다.

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
