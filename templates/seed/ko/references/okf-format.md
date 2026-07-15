---
type: reference
title: OKF(Open Knowledge Format)란 무엇인가
description: Google Cloud가 발표한 v0.1 Draft 스펙 — YAML frontmatter가 붙은 마크다운 디렉토리로 지식을 표현하는 벤더 중립 포맷
resource: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
tags: [okf, spec, reference]
timestamp: {{INSTALL_DATE}}
---
# 무엇인가

OKF는 **지식**(데이터와 시스템을 둘러싼 메타데이터·맥락·정제된 통찰)을 표현하기 위한 개방형
포맷이다. Google Cloud가 2026-06-13에 발표했고 현재 버전은 **v0.1 Draft**다.

스펙의 표현을 그대로 옮기면:

> "The format is intentionally minimal: a directory of markdown files with YAML frontmatter.
> There is no schema registry, no central authority, and no required tooling. If you can `cat`
> a file, you can read OKF; if you can `git clone` a repo, you can ship it."

즉 런타임도, SDK도, 중앙 레지스트리도 없다. 파일을 읽을 수 있으면 OKF를 읽을 수 있다.

# 왜 만들어졌나

발표 블로그가 지목한 문제는 지식이 흩어져 있다는 것이다 — 메타데이터 카탈로그(각자 다른 API),
위키, 공유 드라이브, 코드 주석과 docstring, 그리고 "몇몇 시니어 엔지니어의 머릿속".

> "Every agent builder is solving the same context-assembly problem from scratch, every catalog
> vendor is reinventing the same data models, and the knowledge itself is locked behind whichever
> surface created it."

# 4대 설계 원칙 (스펙 §1)

- **Readable** — 도구 없이 사람이 읽을 수 있다
- **Parseable** — 전용 SDK 없이 에이전트가 파싱할 수 있다
- **Diffable** — 버전 관리에서 diff가 된다
- **Portable** — 도구·조직·시간을 넘어 이식된다

# 핵심 구조

- **concept ID = 번들 내 파일 경로에서 `.md`를 뗀 것** (`tables/users.md` → `tables/users`)
- **필수 frontmatter 필드는 `type` 단 하나.** 권장 필드: `title`, `description`, `resource`,
  `tags`, `timestamp`(ISO 8601)
- **타입 값에 중앙 등록은 없다.** 스펙 예시: `BigQuery Table`, `API Endpoint`, `Metric`,
  `Playbook`, `Reference`. 고정 택소노미 정의는 명시적 non-goal이다
- 예약 파일명: `index.md`(디렉토리 목록), `log.md`(날짜 역순 변경 이력). 둘 다 optional
- 링크는 번들 루트 기준 절대경로(`/tables/customers.md`)가 권장 — 문서가 이동해도 안정적이라서
- 버전 선언은 루트 `index.md` frontmatter의 `okf_version: "0.1"` — index.md에 frontmatter가
  허용되는 유일한 위치다

# 적합성(conformance)이 놀랍도록 느슨하다는 점이 중요하다

번들이 conformant하려면 3가지뿐이다: (1) 모든 비예약 `.md`가 파싱 가능한 YAML frontmatter를
가짐, (2) 모든 frontmatter가 비어있지 않은 `type`을 가짐, (3) 예약 파일이 규정 구조를 따름.

그리고 소비자가 번들을 **거부하면 안 되는(MUST NOT)** 사유가 명시돼 있다: optional 필드 누락,
알 수 없는 `type`, 알 수 없는 추가 키, **깨진 링크**, `index.md` 누락.

> "Consumers MUST tolerate broken links — a link whose target does not exist in the bundle is
> not malformed; it may simply represent not-yet-written knowledge."

이 관용성은 의도된 것이다 — 번들이 성장하고 리팩터링되고 부분적으로 에이전트에 의해 생성되는
동안에도 계속 쓸모 있어야 하기 때문이다.

# 다른 것들과의 관계

스펙 §10이 직접 밝힌다: OKF는 LLM "wiki" 저장소, Obsidian/Notion 같은 개인 지식 도구,
"metadata as code" 접근과 의도적으로 가깝다. 차이는 **명세화됐다는 것** — 상호운용에 필요한
최소한의 규칙만 못 박고 도구는 강제하지 않는다.

OKF는 Avro/Protobuf/OpenAPI 같은 도메인 스키마를 대체하지 않는다. 그것들을 *참조*할 뿐이다.

# 출처

- 스펙 원문: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md (Apache-2.0)
- 발표 블로그: https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/
- 기원이 된 패턴: [/references/okf-llm-wiki-lineage.md](/references/okf-llm-wiki-lineage.md)
