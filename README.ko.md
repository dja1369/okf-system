# OKF for Claude Code

**에이전트는 어제 알려준 것을 전부 잊어버립니다. 이 플러그인이 그 문제를 해결합니다 —
그리고 그렇게 쌓이는 기억은 여러분이 소유하는 마크다운 폴더이지, 여러분을 가둬두는
데이터베이스가 아닙니다.**

![MIT license](https://img.shields.io/badge/license-MIT-blue) ![OKF v0.1](https://img.shields.io/badge/OKF-v0.1%20Draft-4ecdc4) ![Node only](https://img.shields.io/badge/runtime-Node%20only-5c6bc0) ![no npm install](https://img.shields.io/badge/dependencies-vendored-66bb6a)

**[English](README.md) · 한국어 · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português](README.pt-BR.md)**

![OKF 지식 그래프 — 각 개념이 그것을 설명하는 코드에 연결된 모습](docs/okf-graph.png)

<sub>`/okf:okf-visualize` — 내 지식(외곽선이 있는 노드)과 코드베이스를 하나의 그래프로.
핵심은 노란 점선 간선입니다. 각 개념이 실제로 다루고 있는 소스 파일에 연결됩니다.</sub>

모든 세션은 0에서 시작합니다. 같은 아키텍처 결정, 같은 배포 정책, 같은 "그거 해봤는데
깨졌다"를 매번 다시 설명하고 — 세션이 끝나는 순간 또 사라집니다. 정작 그 질문에 답이
*되었을* 지식은 위키와 코드 주석에, 그리고 Google의 OKF 발표글 표현을 빌리면
"the heads of a few senior engineers"(몇몇 시니어 엔지니어의 머릿속)에 흩어져 있습니다.

이 플러그인은 그 고리를 자동으로 닫습니다. 실제로 오간 대화를 캡처하고, 재사용 가능한
부분을 구조화된 지식 번들로 압축한 다음, 그 지식을 모든 세션 시작 시점에 다시 모델
앞에 놓아줍니다.

## 포맷

지식은 **[OKF (Open Knowledge Format)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)** 로
저장됩니다. Google Cloud가 [2026년 6월에 공개한](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/?hl=en&utm_source=pytorchkr&ref=pytorchkr)
개방형 명세입니다(v0.1 Draft, Apache-2.0). 의도적으로 특별할 게 없는 포맷이고, 바로 그게
핵심입니다:

> "The format is intentionally minimal: a directory of markdown files with YAML
> frontmatter. There is no schema registry, no central authority, and no required
> tooling. **If you can `cat` a file, you can read OKF; if you can `git clone` a
> repo, you can ship it.**"

OKF는 열 주 앞서 [Andrej Karpathy가 스케치한](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
"LLM 위키" 패턴을 형식화한 것입니다 — Google 발표글이 명시적으로 그렇게 밝히고 있습니다.
공개 이후 생성기·린터·뷰어·MCP 서버로 이루어진 [작은 생태계](https://github.com/search?q=%22open+knowledge+format%22&type=repositories)가
그 주변에 형성됐고, 이 포맷은 Google 바깥에서도 등장합니다(AWS는 Glue 데이터베이스를 OKF
번들로 제공하는 [샘플](https://github.com/aws-samples/sample-okf-llm-wiki)을 두고 있습니다).
아직 초기입니다 — 그 생태계 대부분이 몇 주밖에 안 됐습니다 — 하지만 포맷은 표방하는 바를
해내고 있습니다. 저자의 도구 없이도 읽힌다는 것 말입니다.

**왜 메모리 제품이 아니라 포맷인가.** mem0, Letta, Zep, Cognee 같은 도구는 메모리
*런타임*입니다 — 라이브러리를 붙이거나 서비스를 호스팅하면, 여러분의 기억은 그 시스템의
벡터 스토어나 그래프 스토어 안에 살게 됩니다. 이들은 경쟁자가 아니라 다른 레이어이고,
그중 일부는 OKF를 저장할 수도 있습니다. 실질적인 차이는 **이탈 비용(exit cost)** 입니다.
그래프 DB에 박힌 지식은 그 시스템에만 읽히지만, OKF 번들은 에디터에서 열리고, GitHub에서
렌더링되고, 풀 리퀘스트에서 diff가 잡히고, 변환 단계 없이 다른 어떤 에이전트에게도
읽힙니다. 이 플러그인은 유일한 사본을 자기에게 맡기라고 요구하지 않습니다.

## 하는 일

1. 세션이 끝날 때 그 세션의 대화 전체를 무손실로 **캡처합니다**.
2. 캡처된 세션을 백그라운드에서(cron 같은 스케줄 작업이 아니라 기회주의적 배치 작업으로)
   `claude -p`를 써서 **압축**해 재사용 가능한 지식 — decision, project, preference,
   pattern, reference, troubleshooting — 을 추출합니다.
3. 그 번들의 인덱스를 새 세션마다 컨텍스트에 필수 게이트로 **주입합니다**. 그래서 Claude가
   관련된 작업을 하기 전에 관련된 과거 지식을 실제로 읽게 되고, 매번 0에서 시작하지 않습니다.
4. 번들과 코드베이스를 하나의 그래프로 **시각화합니다**. 각 개념을 그것이 실제로 다루는
   파일에 연결합니다(`/okf:okf-visualize`).

모든 것은 `~/.claude/okf`(또는 `$CLAUDE_CONFIG_DIR/okf`) 아래 로컬 git 저장소에 있습니다.
어디로도 push되지 않습니다. 유일한 네트워크 호출은 이미 쓰고 있는 Anthropic API
호출뿐입니다 — 배치 단계도 로컬에서 실행되는 또 하나의 `claude -p` 호출일 뿐입니다.

## 요구사항

- 플러그인을 지원하는 Claude Code
- Node.js (`claude` 자체가 이미 요구하는 것과 동일 — 별도 런타임 불필요)
- git

`npm install` 단계 없음. 외부 서비스 없음. 시작하는 데 별도 설정 필요 없음.

## 설치

```
claude plugin marketplace add dja1369/okf-system
claude plugin install okf@okf-marketplace
```

(로컬 클론에서 설치하려면: `claude plugin marketplace add /path/to/your/clone`.)

이게 전부입니다 — 세션을 다시 시작하면 게이트/캡처 훅이 활성화됩니다. 다음 세션 시작 시
번들이 자동으로 부트스트랩됩니다(`~/.claude/okf` 아래 기본 구조를 갖춘 로컬 git 저장소가
생성됩니다).

제거: `claude plugin uninstall okf`. `~/.claude/okf`의 데이터는 그대로 남습니다 — 평범한
git 저장소이니 직접 살펴보거나 백업하거나, `rm -rf ~/.claude/okf`로 지워도 됩니다.

## 사용법

평소에는 아무것도 할 필요 없습니다. 캡처와 배치 압축은 자동으로 일어납니다. 수동으로
상태를 보거나 제어하고 싶을 때 쓸 수 있는 커맨드가 5개 있습니다 — **`okf:` 접두사가 반드시
필요합니다**(플러그인 스코프 커맨드이기 때문입니다):

| 커맨드 | 하는 일 |
|---|---|
| `/okf:okf-status` | 마지막 배치 실행, 대기 중인 세션, 락 상태를 보고 |
| `/okf:okf-batch` | 즉시 배치 강제 실행(주기 게이트는 무시하되 락은 존중) |
| `/okf:okf-config` | 현재 설정을 보여주고 편집 가능하게 함 |
| `/okf:okf-index` | 번들 개요를 읽기 좋게 출력 — 카테고리와 concept 제목 전체, 그리고 `log.md` 최근 변경 |
| `/okf:okf-visualize` | 번들 + 코드베이스를 하나의 인터랙티브 그래프로 렌더링(자체 완결형 HTML) |

새로 설치해도 비어 있지 않습니다. 번들에는 OKF 자체, 이 플러그인의 아키텍처, 번들의 작성
규칙을 설명하는 concept가 미리 심어져 배포됩니다 — 그래서 첫 세션부터 게이트가 가리킬 실체가
있고, 번들이 스스로를 문서화합니다.

## 시각화

`/okf:okf-visualize`는 내 지식과 내 코드를 하나의 그래프로 렌더링합니다. 흥미로운 건 어느 한쪽이
아니라 둘 사이의 점선 링크, 즉 각 개념을 그것이 실제로 이야기하는 소스 파일에 잇는
연결입니다.

[Understand-Anything](https://github.com/Egonex-AI/Understand-Anything)이 이미 저장소를 분석해
뒀다면(`.understand-anything/` 또는 `.ua/knowledge-graph.json`), LLM이 요약한 그 더 풍부한
그래프를 씁니다. 그렇지 않으면 이 플러그인 자체 분석기가 하나를 만듭니다 — 순수 Node,
네이티브 모듈 없음, JS/TS, Python, Go, Rust, Java/Kotlin, Ruby, PHP, C/C++, C#, Swift 전반에서
파일·함수·클래스와 import 그래프를 추출합니다.

출력은 자체 완결형 HTML 파일입니다: CDN도, 네트워크 요청도, 백엔드도 없습니다. 오프라인에서
열립니다. 자기 지식 베이스를 여는 데 어딘가로 전화를 걸 이유는 없으니까요.

## 동작 원리

![아키텍처: 세션이 raw로 캡처되고, 백그라운드 배치가 OKF 번들로 증류하며, 번들 인덱스가 다음 세션에 다시 주입된다](docs/architecture.svg)

- **캡처**는 순수 파일 복사입니다 — 파싱도, 필터링도, 용량 제한도 없습니다. 매
  `SessionEnd`마다 전체 transcript가 `raw/`로 갑니다. 의도한 설계입니다 — 무슨 일이
  있었는지 일부만 기억하는 지식 베이스는 아예 없는 것보다 나쁩니다.
- **압축**은 배치 시점에만, 스크래치 사본에서만 일어납니다 — 캡처된 원본은 절대 건드리지
  않습니다. 도구 접근은 `Read/Glob/Grep/Write/Edit`로 제한되고(`Bash` 없음), 그 한 번의 호출
  동안 *사용자의* 다른 훅·플러그인·MCP 서버는 전부 비활성화됩니다(`--safe-mode`) — 그래서
  배치가 스스로를 다시 캡처하는 루프가 생기지 않습니다.
- **게이트**는 전체 concept 본문이 아니라 압축된 카테고리 인덱스와 최근 변경 내역을
  주입하고, 관련 작업 전에 해당 파일을 실제로 `Read`하라고 지시합니다 — 인덱스만으로는 낡은
  가정에 기대어 행동하지 않게 하기에 부족하기 때문입니다.
- 구조 린터가 번들을 항상 스펙 준수 상태로 유지합니다 — 배치 결과가 조금이라도 형식에 안
  맞으면 커밋 전에 자동으로 원복됩니다.

포맷의 배경과 설계 의도는 Google Cloud의
[Open Knowledge Format 발표글](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/?hl=en&utm_source=pytorchkr&ref=pytorchkr)을
참고하세요 — YAML frontmatter가 붙은 마크다운 파일일 뿐이라 어떤 도구로든 읽을 수 있고, 이
플러그인에 종속되지 않습니다.

## 설정

`~/.claude/okf/.okf/config.md`를 직접 편집하거나(frontmatter), `/okf:okf-config`를 쓰세요.

| 키 | 기본값 | 의미 |
|---|---|---|
| `enabled` | `true` | 전체 켬/끔 스위치(캡처·게이트·배치 전부 이 값을 따름) |
| `batch_interval_hours` | `1` | 배치 실행 사이 최소 간격 |
| `batch_max_digest_kb` | `600` | 1회 실행당 전체 digest 바이트 예산 — 실질적인 비용 상한. 예산을 넘긴 세션은 다음 실행으로 넘어감 |
| `batch_max_sessions` | `50` | 안전용 상한일 뿐 — 실제로 조절하는 다이얼은 `batch_max_digest_kb` |
| `seed_language` | `en` | 최초 부트스트랩 때 심어지는 concept의 언어(`en`, `ko`; 모르는 값은 `en`으로 폴백) |
| `batch_model` | `claude-sonnet-5` | 배치 ingest에 쓸 모델, 비면 CLI 기본값 |
| `batch_effort` | `medium` | 배치 ingest의 추론 강도(`low`/`medium`/`high`/`xhigh`/`max`), 비면 CLI 기본값 |
| `capture_exclude_cwd` | `[]` | 캡처를 건너뛸 디렉토리 glob 패턴(opt-out 전용 — 캡처 자체는 절대 부분적이지 않음) |
| `batch_digest_cap_kb` | `150` | LLM에 보여줄 세션별 요약 용량 상한(캡처된 원본에는 적용 안 됨) |
| `remove_candidate_ttl_days` | `30` | 처리 완료된 raw transcript를 삭제 전까지 보관하는 기간 |
| `inject_max_lines` / `inject_max_bytes` | `120` / `16384` | 게이트 주입 용량 상한 |
| `claude_bin` / `node_bin` | *(빈 값)* | 환경에서 `PATH` 해석이 안 될 때 쓰는 절대경로 override |

## 데이터와 개인정보

- 모든 데이터는 로컬에만 있습니다: `~/.claude/okf`는 작업 중인 어떤 저장소와도 완전히
  분리된, 그 자체로 독립적인 평범한 git 저장소입니다. **이 플러그인의 어떤 코드 경로도 그
  저장소에 대해 `git push`·`git remote add` 등 네트워크 관련 동작을 하지 않습니다** — 어디서든
  쓰는 git 명령은 `init`, `commit`, `checkout`, `clean`뿐입니다(직접 확인 가능:
  `grep -n "push\|remote" lib/*.mjs bin/*.mjs` — 매치되는 건 전부 무관한 `Array.push()`
  호출입니다). 사용자가 직접 의도해서 push하지 않는 한 번들은 기기를 떠나지 않습니다.
- 배치 단계는 요약/추출을 위해 세션 내용을 Anthropic API로 보냅니다 — 평소 Claude Code 사용
  시 이미 통신하는 그 API이고, `claude -p` 호출이 하나 더 생기는 것뿐입니다. 제3자 서비스는
  관여하지 않습니다.
- `raw/`(캡처된 전체 transcript)와 처리 완료 후 삭제 대기 중인 transcript는 git에 커밋되지
  않습니다(gitignore 처리) — 추출된 지식 번들만 커밋됩니다.

## 이식성

경로를 하드코딩한 곳이 한 군데도 없습니다 — 전부 `os.homedir()` /
`process.env.CLAUDE_CONFIG_DIR` / `process.env.HOME`로 해석하므로, 다른 기기나 다른 사용자
계정에 새로 설치하면 각자 독립된 번들이 생깁니다. 테스트 스위트(`test/smoke.mjs`, 78개
시나리오)가 격리된 `HOME`/`CLAUDE_CONFIG_DIR` 샌드박스에서 이를 검증하며, 여기엔 **git
사용자 설정이 전혀 없는 환경**도 포함됩니다 — 이 플러그인은 사용자의 `user.name`/`user.email`에
의존하지 않고, 자동 커밋에는 항상 고정된 자체 identity(`OKF Batch <okf-batch@localhost>`)를
씁니다. macOS/Linux는 이런 방식으로 직접 검증했고, 윈도우 전용 경로(`claude.cmd`용
`shell:true`, 경로 구분자)는 설계 문서 요구사항대로 구현했지만 실제 윈도우 기기에서 아직
돌려보지 않았습니다 — 그 조합은 누군가 확인해주기 전까지 미검증으로 봐주세요.

## 라이선스

MIT
