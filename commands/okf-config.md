---
description: OKF 설정(config.md)을 조회하고, 사용자 요청에 따라 frontmatter 값만 수정한다.
---

OKF 설정 파일 `<OKF_HOME>/.okf/config.md`를 다룬다. `<OKF_HOME>`은 `/okf-status` 커맨드와
동일한 방식으로 해석하라(`OKF_HOME` env, 없으면 `CLAUDE_CONFIG_DIR/okf`, 없으면
`~/.claude/okf`).

## 1. 현재 설정 조회

`<OKF_HOME>/.okf/config.md`를 Read하고, frontmatter의 각 키를 사용자에게 보여줘라. 파일이
없으면 "아직 부트스트랩되지 않음 — 첫 세션이 시작되면 기본값으로 생성됨"이라고 안내하고
종료하라.

주요 키 의미(참고용, 그대로 사용자에게 설명해도 됨):
- `enabled`: 캡처/배치 전체를 켜고 끄는 스위치
- `batch_interval_hours`: 배치 재실행 최소 간격(시간)
- `batch_max_sessions`: 배치 1회 실행당 처리할 raw 세션 상한
- `batch_model`: 배치가 사용할 모델 (비면 CLI 기본값)
- `capture_exclude_cwd`: 캡처를 스킵할 작업 디렉토리 glob 목록
- `batch_digest_cap_kb`: digest(요약본) 파일당 용량 상한 — raw 원본에는 적용 안 됨
- `remove_candidate_ttl_days`: `_remove_candidate/`에 보관 후 자동 삭제까지의 일수
- `inject_max_lines` / `inject_max_bytes`: 세션 시작 시 주입되는 인덱스의 줄/바이트 상한
- `claude_bin` / `node_bin`: PATH 탐색이 실패할 때 쓸 절대경로 override

## 2. 값 변경

사용자가 특정 값 변경을 요청하면:
- `<OKF_HOME>/.okf/config.md`의 frontmatter 블록만 Edit하라(`---`로 감싸인 부분). 본문의
  설명 문구나 다른 키는 건드리지 마라.
- 값의 타입을 원래 형식과 맞춰라(불리언은 `true`/`false`, 숫자는 따옴표 없이, 리스트는
  YAML 배열, 문자열은 필요시 따옴표).
- 변경 후 실제로 반영된 값을 다시 Read해 사용자에게 확인시켜라.
- 이 변경은 다음 세션/배치부터 반영됨을 안내하라(현재 실행 중인 배치가 있다면 그 배치에는
  적용되지 않을 수 있음).
