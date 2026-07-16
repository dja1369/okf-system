# OKF 시스템 구축 — 설계 안건 리스트업

> 이 문서는 리서치 + 요구사항 확정 결과를 정리한 핸드오프 자료다. 실제 아키텍처 설계는 별도 모델이 진행한다.

## 1. 배경 지식 (OKF)

- **OKF(Open Knowledge Format)**: Google Cloud가 2026-06 발표한 v0.1 draft 스펙. YAML frontmatter 붙은 마크다운 파일 디렉토리로 지식 표현. 필수 필드는 `type` 하나뿐, SDK/서버 불필요.
- 기원: Andrej Karpathy의 "LLM Wiki" 패턴(3계층: raw sources(불변) → wiki(LLM이 전적으로 씀) → schema(워크플로우 규정), 3연산: ingest/query/lint) — OKF는 그 wiki 산출물 포맷을 표준화한 것.
- 참고 링크:
  - 공식 스펙: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
  - Karpathy gist: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
  - Google 발표 블로그: https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/
  - 저장소: https://github.com/GoogleCloudPlatform/knowledge-catalog (okf/, samples/, toolbox/ 구조)

## 2. OKF 스펙 준수 조건 (설계 시 필수 반영)

- **frontmatter**: `type`(필수, 유일) / `title` → `description` → `resource` → `tags` → `timestamp` (권장, 우선순위 순) / 그 외 확장 키 자유
- **예약 파일명 2개뿐**: `index.md`(디렉토리 목록 전용, frontmatter 금지 — **번들 루트 index.md만 예외로 `okf_version` 필드 허용**), `log.md`(변경이력, 날짜 헤딩은 ISO 8601 `YYYY-MM-DD` 필수, 최신순)
- **개념(Concept) ID = 파일 경로**(확장자 제외). 파일 이동 시 ID도 바뀜 → 절대경로 링크(`/` 시작) 권장
- **링크**: 절대/상대 두 형식만, 관계 종류는 링크가 아닌 주변 산문이 전달, 깨진 링크도 관대히 허용
- **적합성(conformance) 3조건만 강제**: (1) 비예약 `.md` 전부 parseable YAML frontmatter (2) 비어있지 않은 `type` (3) 예약 파일명이 구조 준수. 그 외(선택 필드 누락/미지 type/미지 키/깨진 링크/index.md 부재)로 번들 거부 금지(MUST NOT)
- **버전관리**: `<major>.<minor>`, minor=하위호환 추가, major=breaking change

## 3. 확정된 요구사항 (사용자 정의)

1. **전역 사용** — 프로젝트별이 아닌 전역 단일 지식 번들
2. **대화 내용 자동 캡처** — 세션 종료 시마다 훅으로 자동, `raw/`에 append-only 저장
3. **배치 반영** — `claude -p` 헤드리스 배치가 주기적으로 raw를 읽어 OKF 번들에 압축/반영
4. **세션 시작 시 인덱스 경로 주입, 필수 게이트로 등록** — 매 세션 시작마다 OKF 인덱스 경로를 컨텍스트에 강제 주입
5. **다중 사용자 배포 가능성** — 본인 머신 전용이 아니라 다른 사용자(맥/윈도우/기타 PC)에게 배포 가능한 형태를 염두. 스크립트 런타임(bash는 윈도우 불가 → Node 등 크로스플랫폼 런타임 검토), 경로 처리(`~` vs `%USERPROFILE%`), OS별 스케줄러 차이(launchd/cron vs Task Scheduler), 설치 방식(Claude Code 플러그인 패키징 등)을 설계에 반영

## 4. 이미 확정된 세부 설계 결정 (사용자 답변)

- **Raw 캡처 흐름**: 세션 종료 시 대화 이력을 `~/.claude/okf/raw/*`에 append-only로 추가 → 배치가 압축(반영) 완료하면 해당 raw 파일을 `~/.claude/okf/_remove_candidate/`로 이전(중복 처리 방지, 즉시 삭제 아님)
- **배치 메커니즘**: 캡처는 훅으로 자동, 압축·반영은 `claude -p` 배치 호출로 처리
- **번들 저장 위치**: `~/.claude/okf/` 로컬 git repo만. 원격(GitHub) push는 우선순위 낮음 — 추후 필요 시 추가

## 5. 로컬 환경 기존 인프라 (설계 시 충돌 방지용 고려사항)

- **claude-mem 플러그인**(서드파티, thedotmack/claude-mem): 이미 모든 세션에서 PostToolUse/Stop/SessionStart 훅으로 자동 캡처 중. 데이터는 `~/.claude-mem/claude-mem.db`(SQLite+FTS5) + `chroma/`(벡터DB)에 저장. **`settings.json`의 enabledPlugins에는 등록되어 있지 않은데 자체 CLI 설치로 상주 데몬 구동 중** — 신규 시스템과 역할이 겹치므로 통합할지 완전 별도로 갈지 결정 필요(사용자는 이번 답변에서 claude-mem 재사용 대신 자체 세션종료 훅 캡처 방식을 택함 → claude-mem과의 관계는 **미확정 상태로 남음**)
- **네이티브 auto-memory**(Claude Code 하네스 내장 기능): `~/.claude/projects/<slug>/memory/*.md`, 이미 `type: user|feedback|project|reference` frontmatter 구조로 OKF와 유사하나 **프로젝트별로 분산**되어 있고 전역이 아님, 세션당 소수만 생성(자동성 낮음)
- **기존 `settings.json` hooks**: `SessionStart`→`caveman-activate.js`, `UserPromptSubmit`→`caveman-mode-tracker.js` 등록됨. **신규 훅은 이 배열에 추가하는 형태여야 함**(기존 훅 보존, 대체 금지)
- **크론/스케줄**: 시스템 crontab 비어있음, Claude Code `CronList`도 등록 작업 없음. 배치 트리거로 `CronCreate`(클라우드 스케줄, 로컬 머신 꺼져있어도 동작) 또는 로컬 crontab 후보 — **미확정**

## 6. 미확정 안건 (다른 모델이 설계 시 결정 필요)

- [x] ~~SessionEnd 훅에서 정확히 무엇을 캡처할지~~ — 2026-07-16 해소: 훅 캡처 자체를 폐지했다. 사용자·에이전트는 세션을 명시적으로 끝내지 않고, resume발 SessionEnd가 대화 중간 스냅샷을 "처리됨"으로 못박아 이후 내용을 잃게 했다(실측). 수집은 배치 sweep이 "마지막 활동 후 `sweep_min_idle_minutes`(기본 60분) 유휴 + 크기 성장" 기준으로 하며 전체 transcript 원문을 무손실 복사한다. 세션 훅은 배치 트리거만 남았다.
- [ ] claude-mem, 네이티브 auto-memory와의 관계 — 완전 별도 시스템으로 갈지, 두 소스도 추가 raw input으로 흡수할지
- [ ] `claude -p` 배치의 정확한 트리거 주기/스케줄 방식(CronCreate vs crontab) 및 주기(예: 매일 1회?)
- [ ] OKF concept 파일들의 도메인/타입 택소노미(예: `projects/`, `decisions/`, `feedback-patterns/`, `references/` 등 카테고리 구조)
- [ ] `_remove_candidate/`로 이전된 raw 파일의 최종 삭제 정책(수동 검토 후 삭제? 일정 기간 후 자동 삭제?)
- [ ] SessionStart 게이트 훅의 정확한 주입 방식 — index.md 전체 내용을 `additionalContext`로 inline 주입할지, 경로만 주고 "필수로 Read할 것"이라 지시할지 (규모 커지면 inline은 컨텍스트 낭비 — 네이티브 auto-memory의 MEMORY.md가 200줄 제한 두는 방식 참고 가능)
- [ ] 원격(GitHub) 백업/멀티머신 동기화는 향후 필요 시 추가(현재는 로컬 git repo만)
- [ ] 배포 형태 — Claude Code 플러그인(hooks.json+skills+commands, marketplace 설치) vs 설치 스크립트 vs 둘 다. 크로스플랫폼 스케줄링 대안(OS 스케줄러 대신 SessionStart 시 마지막 배치 시각 확인 후 오래됐으면 백그라운드 배치 기동하는 opportunistic 방식 등) 결정 필요

## 7. 유사 OSS 참고 (설계 시 벤치마크 가능)

- **가장 유사한 철학**: Basic Memory(`basicmachines-co/basic-memory`, MCP서버 — 마크다운이 진실의 원천 + SQLite는 검색 캐시), Obsidian MCP 서버 생태계
- **자동 캡처+DB 방식(참고용, OKF와는 다른 축)**: mem0(벡터+그래프DB, 자동 추출), Letta(에이전트 자율 관리), Cognee(파이프라인 자동 ingest), Zep/Graphiti(실시간 temporal 그래프)
