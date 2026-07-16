---
name: okf-usage
description: OKF(전역 지식 번들) 읽기/쓰기 규약. 과거 결정·프로젝트·선호·트러블슈팅과 관련된
  작업을 할 때, 또는 SessionStart에서 주입된 OKF 인덱스를 어떻게 활용할지 판단할 때 사용한다.
---

# OKF 사용 규약

OKF는 세션 간에 유지되는 전역 지식 번들이다(`<OKF_HOME>`, 보통 `~/.claude/okf`). 세션 시작
시 `SessionStart` 훅이 번들의 `index.md`와 `log.md` 최신 항목을 컨텍스트에 필수로 주입한다
("OKF KNOWLEDGE GATE" 섹션).

## 읽기: 세션 중 반드시 지킬 것

- 과거 결정/프로젝트/선호/트러블슈팅과 관련된 작업을 시작하기 전, 주입된 인덱스에서 관련
  concept를 찾아 **해당 파일을 Read하라**. 인덱스에 요약만 있고 본문은 없으므로, 요약만 보고
  넘겨짚지 마라.
- concept ID는 번들 루트 기준 경로다(예: `/decisions/foo.md`). 인덱스나 concept 본문에 나오는
  링크는 이 절대경로 형식을 그대로 따른다.
- 관련 concept가 안 보이거나 애매하면 번들 디렉토리를 Grep/Glob으로 더 찾아봐도 된다 — 주입된
  인덱스는 카테고리 요약일 뿐 전수 검색을 대체하지 않는다.

## 쓰기: 세션 중에는 원칙적으로 하지 않는다

번들은 **배치(opportunistic `claude -p` ingest)가 전담 관리**한다. 대화가 마지막 활동 후 일정
시간(기본 60분) 조용해지면 배치의 sweep이 transcript를 통째로 `raw/`에 수집하고, 이후 배치가
그것을 압축·정리해 번들에 반영한다(세션을 명시적으로 끝낼 필요 없음). 따라서 세션 중에는:

- 원칙적으로 `<OKF_HOME>` 아래 어떤 파일도 직접 Write/Edit하지 않는다 — 배치가 별도로, 더
  신중하게(린트·커밋 단위로) 반영하므로 세션이 끼어들 필요가 없다.
- **예외**: 사용자가 "이거 지금 바로 OKF에 기록해줘" 같이 명시적으로 요청한 경우에만 직접
  쓴다. 이때도 아래 "concept 구조" 규칙을 그대로 지켜라.
- `index.md`는 세션이든 배치든 절대 직접 쓰지 않는다 — 결정적 생성기가 재생성한다.

## concept 파일 구조 (SCHEMA.md 압축 요약)

직접 쓸 일이 생겼을 때 참고하라. 정확한 원본 규정은 번들의 `SCHEMA.md`다.

- 모든 비예약 `.md`는 YAML frontmatter로 시작하고 `type`이 비어있지 않아야 한다.
- 타입 택소노미(디렉토리=type 1:1): `projects/` project · `decisions/` decision ·
  `preferences/` preference · `patterns/` pattern · `references/` reference ·
  `troubleshooting/` troubleshooting.
- frontmatter 권장 순서: `title` → `description` → `resource`(없으면 필드 생략) → `tags` →
  `timestamp`.
- 파일 경로가 곧 concept ID다 — 기존 파일을 옮기거나 이름을 바꾸지 않는다. 내용을 대체할 때는
  새 파일을 만들고 옛 파일에 "superseded by /..." 문장을 남긴다.
- 기존 concept와 겹치면 새로 만들지 말고 기존 파일을 Edit한다(쓰기 전 Grep으로 중복 확인).
- `log.md`에 새 항목을 추가할 때는 최상단 "## YYYY-MM-DD" 섹션에 bullet을 더한다. 같은 날짜
  섹션이 이미 있으면 새 헤딩을 만들지 말고 그 안에 추가한다.
- 자격증명/토큰/개인정보는 기록하지 않는다.
