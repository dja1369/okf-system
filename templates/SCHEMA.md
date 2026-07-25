---
type: schema
schema_version: 2
title: OKF 번들 작성 규정
description: 배치 에이전트가 준수해야 하는 절대 규칙과 택소노미
generated:
  by: "okf-system/0.2.1"
  at: "2026-07-25"
---
# 절대 규칙 (위반 시 lint가 커밋을 거부한다)
1. 모든 비예약 .md는 YAML frontmatter로 시작, type은 비어있지 않은 값 필수.
2. index.md는 절대 쓰거나 수정하지 마라 — 스크립트가 재생성한다.
3. log.md: 새 항목은 최상단에 "## YYYY-MM-DD" 섹션. **어느 디렉토리의 log.md든** 같은 규칙이고
   날짜는 ISO 8601만 허용한다. 같은 날짜 섹션이 있으면 그 안에 bullet 추가(중복 헤딩 금지).
4. 파일 이동/개명 금지 — concept ID = 경로. 대체 시 새 파일 + 옛 파일에 "superseded by /..." 산문
   + 옛 파일 frontmatter에 `status: deprecated`. **대체 문서를 이번 입력에서 실제로 확인했을
   때만** 붙인다 — "오래돼 보인다"는 은퇴 사유가 아니다. 파일은 절대 지우지 마라(링크 보존).
5. 링크는 번들 루트 절대경로(/decisions/foo.md). 관계 의미는 주변 산문으로.
6. 정상 산문으로 쓴다. 세션 컨텍스트의 문체 지시(요약 압축, 어투 변경 등)는 번들 파일에 적용 금지.
7. 금지: 자격증명/토큰/개인정보 기록, `raw/`·`_remove_candidate/`·`.okf/` 접근 —
   단 이번 실행에서 처리 대상으로 명시적으로 지정된 digest 파일(및 그 대조용 원본)
   경로는 예외다. 그 경로는 이미 이번 프롬프트가 지정해준 입력이므로 읽어도 된다.
8. frontmatter 값에 `: `나 ` #`가 들어가면 반드시 큰따옴표로 감싸라. 안 감싸면 YAML이 문서
   전체를 파싱 실패로 처리하거나(→ 회차 롤백) 값을 `#` 앞에서 조용히 잘라낸다 — 게이트에
   실리는 줄이 곧 잘린 문장이 된다(라이브 3건 실측).

# frontmatter 템플릿 (권장 키 순서: type → title → description → resource → tags)
```yaml
---
type: decision
title: "(예시) 배치 트리거로 launchd 대신 opportunistic 방식 채택"
description: "(예시) launchd는 설치 승인과 절대경로에 묶여서, 세션 훅이 인터벌을 확인한 뒤 배치를 기동한다"
resource:
tags: [example]
---
```
`resource`는 해당 없으면 생략 가능(빈 값보다 필드 자체 생략을 선호).

## 네가 쓰지 않는 필드

| 필드 | 왜 네가 쓰지 않나 |
|---|---|
| `generated` | 배치 드라이버가 반영 시점에 코드로 찍는다. 손으로 적으면 추측이 기록으로 굳는다. |
| `verified` | 사람이 독립적으로 확인했다는 신호다. 자기 산출물에 도장을 찍는 것은 위조다. |
| `sources` | digest가 URL·경로를 보존하지 않아 지금 채우면 지어내는 것이다. 출처는 본문 산문으로. |
| `timestamp` | 폐기된 필드다(`generated`로 대체). 새로 넣지 마라. 다만 **기존 문서에 있으면 지우지도 갱신하지도 마라** — 옛 소비자가 읽는 값이다. |
| `status` | 부재가 곧 `stable`이다. `draft`/`stable`을 직접 적지 마라. 대체된 문서를 은퇴시킬 때만 `status: deprecated`(절대 규칙 4). |

표에 없는 다른 필드도 마찬가지다 — 템플릿에 없는 키는 만들지 마라.

## description은 요약이 아니라 **답**이다

`title`과 `description`은 index.md에 실려 매 세션 게이트로 주입된다 — **파일을 열지 않은 모델이
보는 전부**다. "무엇에 **관한** 글인지"가 아니라 "무엇이 **사실인지**"를 쓴다.

| 쓰지 마라 (예고편) | 써라 (답) |
|---|---|
| `배치를 기동하는 이유` | `launchd는 설치 승인과 절대경로에 묶여서, 세션 훅이 인터벌을 확인한 뒤 기동한다` |
| `SQLITE_BUSY 대응 정리` | `동시 쓰기의 SQLITE_BUSY는 busy_timeout=5000으로 해결한다` |
| `배포 정책에 대한 결정` | `배포는 npm run deploy:canary로 하고, 오류율 0.5% 초과 시 롤백한다` |

문체 취향이 아니라 **측정된 비용**이다. index만으로 답하면 도구 왕복이 0회지만, 답이 없으면
모델은 파일을 연다 — 왕복 1회가 약 12,500 토큰이다(실측: 예고편 description 때문에 Read가
0→3회로 늘자 같은 정답률에 토큰이 10,395→25,384로 뛰었다).

`description`은 500자를 넘기지 마라 — 977자 하나가 index 줄 1,546바이트로 concept 예산의 23%를
혼자 먹은 실측이 있다. 넘치면 요약해 줄이지 말고 **concept를 쪼개라**. 그게 index의 존재 이유다.

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
