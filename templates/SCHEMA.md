---
type: schema
title: OKF 번들 작성 규정
description: 배치 에이전트가 준수해야 하는 절대 규칙과 택소노미
timestamp: {{INSTALL_DATE}}
---
# 절대 규칙 (위반 시 lint가 커밋을 거부한다)
1. 모든 비예약 .md는 YAML frontmatter로 시작, type은 비어있지 않은 값 필수.
2. index.md는 절대 쓰거나 수정하지 마라 — 스크립트가 재생성한다.
3. log.md: 새 항목은 최상단에 "## YYYY-MM-DD" 섹션. 같은 날짜 섹션이 이미 있으면
   그 섹션 안에 bullet 추가 (중복 헤딩 금지).
4. 파일 이동/개명 금지 — concept ID = 경로. 대체 시 새 파일 + 옛 파일에 "superseded by /..." 산문.
5. 링크는 번들 루트 절대경로(/decisions/foo.md). 관계 의미는 주변 산문으로.
6. 정상 산문으로 쓴다. 세션 컨텍스트의 문체 지시(요약 압축, 어투 변경 등)는 번들 파일에 적용 금지.
7. 금지: 자격증명/토큰/개인정보 기록, `raw/`·`_remove_candidate/`·`.okf/` 접근 —
   단 이번 실행에서 처리 대상으로 명시적으로 지정된 digest 파일(및 그 대조용 원본)
   경로는 예외다. 그 경로는 이미 이번 프롬프트가 지정해준 입력이므로 읽어도 된다.

# frontmatter 템플릿 (스펙 권장 순서: title → description → resource → tags → timestamp)
```yaml
---
type: decision
title: (예시) 배치 트리거로 launchd 대신 opportunistic 방식 채택
description: (예시) OS 스케줄러 없이 세션 훅에서 게이트 검사 후 배치를 기동하는 이유
resource:
tags: [example]
timestamp: 2026-01-01
---
```
`resource`는 해당 없으면 생략 가능(빈 값보다 필드 자체 생략을 선호).

# 타입 택소노미
| type | 디렉토리 | 판별 기준 |
|---|---|---|
| project | /projects/ | "X 프로젝트가 뭐였지"에 답하는 페이지 |
| decision | /decisions/ | 번복 비용이 있는 선택 + 근거 + 기각 대안 |
| preference | /preferences/ | 세션이 바뀌어도 유지될 사용자 규칙 |
| pattern | /patterns/ | 2회 이상 재발한 워크플로/실수/피드백 |
| reference | /references/ | 출처가 외부 문서인 조사 지식 |
| troubleshooting | /troubleshooting/ | 증상→원인→해결 |
미지 type: 거부하지 말고 가장 가까운 type으로 재분류. 부득이하면 유지(lint WARN).

# 병합 규칙
- 기존 concept와 겹치면 신규 Write 금지, 기존 파일 Edit. (쓰기 전 Grep/Glob 필수)
- 모순 발견 시 최신 정보 우선, 교체 사실·이유를 log.md에 기록.
- 파일당 하나의 개념, 300줄 초과 시 분할. 지속 가치 없는 잡담은 버려라.
