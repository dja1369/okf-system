---
type: preference
title: 이 번들에 지식을 쓸 때 지키는 규칙
description: 택소노미 6종, frontmatter 형식, 병합·링크 규칙 — 세션과 배치 양쪽에 적용되는 항구 규칙
tags: [okf, rules, preference]
timestamp: {{INSTALL_DATE}}
---
# 누가 쓰는가

번들은 **배치가 전담 관리**한다. 세션 중에는 원칙적으로 직접 쓰지 않는다 — 대화는 어차피
`raw/`에 통째로 캡처되고 배치가 정리해 반영한다. 사용자가 "지금 바로 기록해줘"라고 명시적으로
요청할 때만 예외다.

`index.md`는 사람도 LLM도 절대 직접 쓰지 않는다. 결정적 생성기가 전량 재생성한다.

# 택소노미 6종 (디렉토리 = type 1:1)

OKF 스펙 자체는 고정 택소노미를 정의하지 않는다(명시적 non-goal). 아래는 **이 번들이 선택한**
6종으로, 대화에서 나오는 지식이 실제로 답하는 질문 유형에 대응한다.

| type | 디렉토리 | 판별 기준 |
|---|---|---|
| project | /projects/ | "X 프로젝트가 뭐였지"에 답하는 페이지 |
| decision | /decisions/ | 번복 비용이 있는 선택 + 근거 + 기각한 대안 |
| preference | /preferences/ | 세션이 바뀌어도 유지될 사용자 규칙 |
| pattern | /patterns/ | 2회 이상 재발한 워크플로/실수/피드백 |
| reference | /references/ | 출처가 외부 문서인 조사 지식 |
| troubleshooting | /troubleshooting/ | 증상 → 원인 → 해결 |

6종에 안 맞는 type이 나와도 **거부하지 않는다** — 스펙이 미지 type 거부를 금지한다. 가장 가까운
type으로 재분류하고, 부득이하면 그대로 두되 린터가 경고만 남긴다.

# frontmatter

```yaml
---
type: decision            # 필수. 비어있으면 안 됨
title: 짧고 검색 가능한 제목
description: 한 줄 요약    # 인덱스와 게이트에 노출되므로 이게 검색 품질을 좌우한다
resource:                 # 해당 없으면 필드 자체를 생략
tags: [영역, 키워드]
timestamp: 2026-01-01     # ISO 8601
---
```

권장 순서는 title → description → resource → tags → timestamp다.

# 쓰는 방법

- **기존 concept와 겹치면 새로 만들지 말고 그 파일을 Edit한다.** 쓰기 전에 Grep으로 중복을 확인한다
- 파일 경로가 곧 concept ID다 — **옮기거나 이름을 바꾸지 않는다.** 내용을 대체할 때는 새 파일을
  만들고 옛 파일에 "superseded by /..." 문장을 남긴다
- 링크는 번들 루트 기준 절대경로(`/decisions/foo.md`)를 쓴다
- 모순을 발견하면 최신 정보를 우선하고, 교체 사실과 이유를 `log.md`에 남긴다
- `log.md`는 최상단에 `## YYYY-MM-DD` 섹션. 같은 날짜 섹션이 이미 있으면 새로 만들지 말고 그 안에 추가
- 파일당 하나의 개념. 300줄을 넘으면 분할한다
- 지속 가치가 없는 잡담은 아예 쓰지 않는다 — 안 쓰는 게 기본값이다
- **자격증명·토큰·개인정보는 기록하지 않는다**

# 왜 이렇게까지 규정하는가

린터가 매 배치마다 이 구조를 검사하고, 어긋나면 커밋 자체를 거부한다(fail-closed). 그래서
번들의 HEAD는 항상 OKF 적합 상태다. 규칙이 지켜지지 않으면 그 배치 결과는 통째로 원복된다.

포맷 자체의 규정은 [/references/okf-format.md](/references/okf-format.md), 이 시스템의 동작은
[/references/okf-system-architecture.md](/references/okf-system-architecture.md) 참고.
