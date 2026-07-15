# OKF for Claude Code

모든 세션에 프로젝트를 넘나드는 영구 지식 베이스를 자동으로 제공하는 Claude Code
플러그인입니다. 수동으로 메모할 필요도, 따로 실행할 도구도 없습니다.

**[English](README.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)**

## 하는 일

1. 세션이 끝날 때마다 대화 전체를 **무손실로 캡처**합니다.
2. 백그라운드에서(cron 같은 스케줄러가 아니라 기회주의적 배치 작업으로) 캡처된
   세션들을 `claude -p`로 **압축**해 재사용 가능한 지식 — 결정, 프로젝트 정보,
   선호, 패턴, 참고자료, 트러블슈팅 — 을 구조화된
   [OKF(Open Knowledge Format)](https://okf.md) 번들로 추출합니다.
3. 새 세션이 시작될 때마다 이 번들의 인덱스를 컨텍스트에 **필수 게이트로 주입**해서,
   관련 작업을 할 때마다 매번 처음부터 시작하지 않고 실제로 과거 지식을 Read하고
   시작하도록 합니다.

모든 데이터는 `~/.claude/okf`(또는 `$CLAUDE_CONFIG_DIR/okf`) 아래 로컬 git
저장소에 있습니다. 어디에도 push되지 않습니다. 유일한 네트워크 호출은 이미 쓰고
있는 Anthropic API 호출뿐입니다 — 배치 단계도 그냥 로컬에서 한 번 더 실행되는
`claude -p` 호출입니다.

## 요구사항

- 플러그인을 지원하는 Claude Code
- Node.js (`claude` 자체가 이미 요구하는 것과 동일 — 별도 런타임 불필요)
- git

`npm install` 단계 없음. 외부 서비스 없음. 시작하는 데 별도 설정 필요 없음.

## 설치

```
claude plugin marketplace add /path/to/okf-system
claude plugin install okf@okf-marketplace
```

(이 저장소가 GitHub에 올라가 있다면 `claude plugin marketplace add <owner>/<repo>`
형태도 동일하게 동작합니다 — 두 번째 명령에 쓰는 마켓플레이스 이름은
[`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json)을 참고하세요.)

이게 전부입니다 — 세션을 다시 시작하면 게이트/캡처 훅이 활성화됩니다. 다음 세션
시작 시 번들이 자동으로 부트스트랩됩니다(`~/.claude/okf` 아래 기본 구조를 갖춘
로컬 git 저장소가 생성됩니다).

제거: `claude plugin uninstall okf`. `~/.claude/okf`의 데이터는 그대로 남습니다 —
평범한 git 저장소이니 직접 살펴보거나 백업하거나, `rm -rf ~/.claude/okf`로 지워도
됩니다.

## 사용법

평소에는 아무것도 할 필요 없습니다. 캡처와 배치 압축은 자동으로 일어납니다.
수동으로 상태를 보거나 제어하고 싶을 때 쓸 수 있는 커맨드가 3개 있습니다 —
**`okf:` 접두사가 반드시 필요합니다**(플러그인 스코프 커맨드이기 때문입니다):

| 커맨드 | 하는 일 |
|---|---|
| `/okf:okf-status` | 마지막 배치 실행, 대기 중인 세션, 락 상태를 보고 |
| `/okf:okf-batch` | 즉시 배치 강제 실행(주기 게이트는 무시하되 락은 존중) |
| `/okf:okf-config` | 현재 설정을 보여주고 편집 가능하게 함 |

## 동작 원리

```
[세션 사용]                       [백그라운드 배치 (기회주의적, 스케줄 아님)]
SessionStart → 게이트 주입          실행 조건: 주기 경과 + 다른 배치 실행 중 아님
      │                             트리거: SessionEnd(주) 또는 SessionStart(캐치업)
SessionEnd → raw/에                      │
   무손실 캡처                       대기 중인 세션마다: `claude -p`로 재사용 가능한
      │                             지식 추출 → 구조 검증 → git commit. 한 세션
      └─▶ 게이트 검사 ──▶ 필요시     처리가 실패해도 이미 커밋된 것들은 안전(세션별로
          배치 기동                 각각 별도 commit).
```

- **캡처**는 순수 파일 복사입니다 — 파싱도, 필터링도, 용량 제한도 없습니다. 매
  `SessionEnd`마다 전체 transcript가 `raw/`로 갑니다. 의도한 설계입니다 — 일부만
  기억하는 지식 베이스는 아예 없는 것보다 나쁩니다.
- **압축**은 배치 시점에만, 스크래치 사본에서만 일어납니다 — 캡처된 원본은 절대
  건드리지 않습니다. 도구 접근은 `Read/Glob/Grep/Write/Edit`로 제한되고(`Bash`
  없음), 그 한 번의 호출 동안 *사용자의* 다른 훅·플러그인·MCP 서버는 전부
  비활성화됩니다(`--safe-mode`) — 그래서 배치가 스스로를 다시 캡처하는 루프가
  생기지 않습니다.
- **게이트**는 전체 concept 본문이 아니라 압축된 카테고리 인덱스와 최근 변경
  내역을 주입하고, 관련 작업 전에 해당 파일을 실제로 `Read`하라고 지시합니다 —
  인덱스만으로는 낡은 가정에 기대어 행동하기에 부족하기 때문입니다.
- 구조 린터가 번들을 항상 스펙 준수 상태로 유지합니다 — 배치 결과가 조금이라도
  형식에 안 맞으면 커밋 전에 자동으로 원복됩니다.

기반이 되는 포맷 스펙은 [okf.md](https://okf.md)를 참고하세요 — YAML frontmatter가
붙은 마크다운 파일일 뿐이라 이 플러그인 없이도 어떤 도구로든 읽을 수 있습니다.

## 설정

`~/.claude/okf/.okf/config.md`를 직접 편집하거나(frontmatter), `/okf:okf-config`를
쓰세요.

| 키 | 기본값 | 의미 |
|---|---|---|
| `enabled` | `true` | 전체 켬/끔 스위치(캡처·게이트·배치 전부 이 값을 따름) |
| `batch_interval_hours` | `12` | 배치 실행 사이 최소 간격 |
| `batch_max_sessions` | `10` | 배치 1회당 처리 세션 수(비용 상한) |
| `batch_model` | *(빈 값)* | 배치 ingest에 쓸 모델 override, 비면 CLI 기본값 |
| `capture_exclude_cwd` | `[]` | 캡처를 건너뛸 디렉토리 glob 패턴(opt-out 전용 — 캡처 자체는 절대 부분적이지 않음) |
| `batch_digest_cap_kb` | `150` | LLM에 보여줄 세션별 요약 용량 상한(캡처된 원본에는 적용 안 됨) |
| `remove_candidate_ttl_days` | `30` | 처리 완료된 raw transcript를 삭제 전까지 보관하는 기간 |
| `inject_max_lines` / `inject_max_bytes` | `120` / `16384` | 게이트 주입 용량 상한 |
| `claude_bin` / `node_bin` | *(빈 값)* | 환경에서 `PATH` 해석이 안 될 때 쓰는 절대경로 override |

## 데이터와 개인정보

- 모든 데이터는 로컬에만 있습니다: `~/.claude/okf`는 평범한 git 저장소이고 절대
  push되지 않습니다.
- 배치 단계는 요약/추출을 위해 세션 내용을 Anthropic API로 보냅니다 — 평소
  Claude Code 사용 시 이미 통신하는 그 API이고, `claude -p` 호출이 하나 더
  생기는 것뿐입니다. 제3자 서비스는 관여하지 않습니다.
- `raw/`(캡처된 전체 transcript)와 처리 완료 후 삭제 대기 중인 transcript는
  git에 커밋되지 않습니다(gitignore 처리) — 추출된 지식 번들만 커밋됩니다.

## 라이선스

MIT
