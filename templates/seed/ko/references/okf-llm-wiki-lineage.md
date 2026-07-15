---
type: reference
title: OKF는 Karpathy의 LLM-wiki 패턴을 형식화한 것이다
description: 이 시스템의 3계층(raw/wiki/schema)·3연산(ingest/query/lint) 구조가 어디서 왔는지
resource: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
tags: [okf, background, reference]
timestamp: {{INSTALL_DATE}}
---
# 계보

Andrej Karpathy가 2026-04-04에 "LLM wiki" gist를 공개했고, 약 10주 뒤 Google Cloud가 OKF를
발표하며 **이 패턴을 명시적으로 형식화한 것**이라고 밝혔다. 추측이 아니라 Google이 직접 한 말이다:

> "Introducing the Open Knowledge Format (OKF), an open specification that **formalizes the
> LLM-wiki pattern** into a portable, interoperable format."
> — Google Cloud Tech

OKF 스펙 §10도 인접 패턴 1순위로 "LLM 'wiki' repositories"를 나열한다.

# 패턴의 구조

LLM-wiki는 3개 계층과 3개 연산으로 이루어진다:

| 계층 | 성격 |
|---|---|
| raw sources | 불변. 원본 기록. 절대 손대지 않는다 |
| wiki | LLM이 쓴다. raw에서 정제된 지식 |
| schema | 규정. wiki를 어떻게 쓸지에 대한 규칙 |

| 연산 | 하는 일 |
|---|---|
| ingest | raw → wiki로 지식을 정제해 넣는다 |
| query | wiki에서 필요한 지식을 찾아 쓴다 |
| lint | wiki가 규정을 지키는지 검사한다 |

# 이 시스템이 그 패턴에 대응되는 방식

이 플러그인은 위 구조를 그대로 구현한다:

| Karpathy | 이 시스템 |
|---|---|
| raw sources | `raw/` — 세션 transcript 무손실 전체 사본. 배치만 옮긴다 |
| wiki | 번들의 concept 파일들 — 배치의 `claude -p`만 쓰고, 세션은 읽기만 |
| schema | `SCHEMA.md` + 배치 ingest 프롬프트 |
| ingest | SessionEnd 캡처 + 배치 압축·반영 |
| query | SessionStart 게이트 주입 + 세션 중 Read/Grep |
| lint | 구조 린터(매 배치, fail-closed) |

자세한 동작은 [/references/okf-system-architecture.md](/references/okf-system-architecture.md) 참고.

# 출처

- Karpathy gist: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
- OKF 스펙: [/references/okf-format.md](/references/okf-format.md)
