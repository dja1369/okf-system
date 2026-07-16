---
type: schema
schema_version: 1
title: OKF 번들 작성 규정
description: 배치 에이전트가 준수해야 하는 절대 규칙과 택소노미
timestamp: 2026-07-16
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
description: (예시) launchd는 설치 승인과 절대경로에 묶여서, 세션 훅이 인터벌을 확인한 뒤 배치를 기동한다
resource:
tags: [example]
timestamp: 2026-01-01
---
```
`resource`는 해당 없으면 생략 가능(빈 값보다 필드 자체 생략을 선호).

## description은 요약이 아니라 **답**이다

`title`과 `description`은 index.md에 실리고, index는 매 세션 게이트로 주입된다. 즉 이 두 줄은
**파일을 열지 않은 모델이 보는 전부**다. 그러니 "이 문서가 무엇에 **관한** 글인지"가 아니라
"무엇이 **사실인지**"를 쓴다.

| 쓰지 마라 (예고편) | 써라 (답) |
|---|---|
| `배치를 기동하는 이유` | `launchd는 설치 승인과 절대경로에 묶여서, 세션 훅이 인터벌을 확인한 뒤 기동한다` |
| `SQLITE_BUSY 대응 정리` | `동시 쓰기의 SQLITE_BUSY는 busy_timeout=5000으로 해결한다` |
| `배포 정책에 대한 결정` | `배포는 npm run deploy:canary로 하고, 오류율 0.5% 초과 시 롤백한다` |

이건 문체 취향이 아니라 **측정된 비용**이다. 게이트가 index만으로 답할 수 있으면 도구 왕복이
0회고, 답이 없으면 모델은 파일을 열어야 한다 — 왕복 1회가 약 12,500 토큰(대부분은 두 번째 API
호출이 시스템 프롬프트를 다시 읽는 고정비)이다. 실측: 무관한 concept 20개가 번들에 섞이자
`description`이 답을 담지 않은 줄들 때문에 모델이 확신을 잃고 파일을 열기 시작했고(Read 0→3회),
같은 정답률에 토큰이 10,395 → 25,384로 뛰었다. 예고편으로 쓰인 description 하나하나가 미래
세션마다 왕복 비용을 청구한다.

한 줄에 다 담기지 않으면 concept를 쪼개라. 그게 index가 존재하는 이유다.

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
