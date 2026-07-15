---
type: reference
title: 이 OKF 플러그인이 실제로 어떻게 동작하는가
description: 캡처(무손실) → 배치 압축(claude -p) → 게이트 주입의 3단 구조와, 각 단계의 설계 근거
resource: https://github.com/dja1369/okf-system
tags: [okf, architecture, reference]
timestamp: {{INSTALL_DATE}}
---
# 3단 구조

```
[세션]                          [배치 (기회주의적, 스케줄러 없음)]
SessionStart → 게이트 주입        조건: 주기 경과 + 다른 배치 없음
      │                          트리거: SessionEnd(주) / SessionStart(캐치업)
SessionEnd → raw/ 무손실 캡처          │
      │                          세션마다: digest → claude -p로 지식 추출
      └─▶ 게이트 검사 ──▶ 배치     → 구조 lint → git commit (세션별 개별 커밋)
```

## 1. 캡처 — 무손실이 원칙

`SessionEnd`에 transcript 원본을 `raw/`로 **그냥 복사**한다. 파싱도 필터도 용량 제한도 없다.
의도한 설계다: 일부만 기억하는 지식 베이스는 없느니만 못하다. 캡처 시점의 손실은 되돌릴 수 없고,
크기 축약이 필요한 건 LLM에 넣을 때뿐이므로 그건 배치가 별도 임시 파일(digest)로 만든다.

부수 효과로 캡처는 JSONL을 파싱하지 않게 되어, 스키마 드리프트로 캡처가 깨지는 실패모드 자체가
사라졌다.

## 2. 배치 — 판단만 LLM에게

전 과정이 Node이고, "무엇이 재사용할 가치가 있는가"라는 판단만 `claude -p`에 위임한다.
결정적으로 할 수 있는 일(인덱스 생성, lint, git, 청킹)에 LLM을 쓰지 않는다.

- **digest**: raw에서 실제 대화만 결정적으로 추출한다. 하네스 boilerplate(도구 결과, 슬래시
  커맨드 에코, isMeta 턴)는 대화가 아니므로 걸러낸다 — 이걸 안 걸렀을 때 LLM이 커맨드 정의문을
  "대화"로 읽고 매번 NO-OP을 뱉는 문제가 실제로 있었다
- **비용 상한**: 실행당 digest 총 바이트 예산(`batch_max_digest_kb`). 세션 개수가 아니라 크기로
  잡는 이유는 세션 크기가 수십 배씩 차이나서 개수가 비용을 대변하지 못하기 때문이다
- **격리**: 배치의 `claude -p`는 `--safe-mode`로 돌아 사용자의 다른 훅·플러그인·MCP가 로드되지
  않는다. 그래서 배치가 자기 자신을 다시 캡처하는 루프가 구조적으로 성립하지 않는다
- **도구 제한**: `--tools`로 `Read/Glob/Grep/Write/Edit`만 허용하고 `Bash`를 막는다.
  digest 내용은 과거 대화에서 온 것이라 외부 텍스트가 섞여 있을 수 있어 injection 표면이 된다
- **트랜잭션**: 청크마다 즉시 lint→commit한다. 어느 청크에서 죽어도 이전 청크 결과는 이미
  git에 있다

## 3. 게이트 — 인덱스를 주입하되 본문은 읽게 한다

`SessionStart`가 루트 `index.md`(카테고리 요약)와 `log.md` 최근 변경을 컨텍스트에 주입하고,
관련 작업 전에 해당 concept를 **Read하라**고 지시한다. 본문을 통째로 주입하지 않는 이유는
컨텍스트 예산 때문이고, 경로만 주지 않는 이유는 그러면 모델이 읽기를 생략하기 때문이다.

# 저장 위치

`~/.claude/okf`(또는 `$CLAUDE_CONFIG_DIR/okf`). 작업 중인 저장소와 완전히 분리된 자체 git
저장소이며, **어떤 코드 경로도 push하지 않는다** — 쓰는 git 명령은 init/commit/checkout/clean뿐이다.

`raw/`와 처리 완료분(`_remove_candidate/`)은 gitignore 대상이라 커밋되지 않는다. 커밋되는 건
정제된 지식뿐이다.

# 규칙

번들에 무엇을 어떻게 쓰는지는 [/preferences/okf-bundle-rules.md](/preferences/okf-bundle-rules.md)와
번들 루트의 `SCHEMA.md`에 있다.
