---
description: OKF 배치 상태(마지막 실행, 대기 중인 raw, 락 상태)를 조회해 요약 보고한다.
---

OKF(전역 지식 번들) 시스템의 현재 런타임 상태를 조사해 사용자에게 요약 보고하라.

## 1. OKF_HOME 경로 확인

`OKF_HOME = process.env.OKF_HOME || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'okf')` 규칙으로 결정된다.
가장 정확한 방법은 플러그인 자체의 경로 해석 로직을 그대로 호출하는 것이다. Bash로 아래처럼
실행해보라:

```
node -e "import('${CLAUDE_PLUGIN_ROOT}/lib/paths.mjs').then(m => console.log(m.resolveOkfHome()))"
```

이 방식이 실패하면(예: `${CLAUDE_PLUGIN_ROOT}`가 셸에서 展開되지 않는 환경) `$OKF_HOME`,
`$CLAUDE_CONFIG_DIR/okf` 환경변수를 순서대로 시도하고, 둘 다 없으면 일반적인 경로
`~/.claude/okf`(윈도우는 `%USERPROFILE%\.claude\okf`)를 시도하라.

## 2. 조사할 항목

OKF_HOME을 `<OKF_HOME>`이라 할 때, Read/Bash로 아래를 확인하라:

- `<OKF_HOME>/.okf/last-batch.json` — 있으면 Read해서 `lastRunEpochMs`(마지막 배치 실행 시각,
  사람이 읽을 수 있는 형태로 변환), `lastResult`, `pendingAfter`(그 실행 직후 남은 raw 수)를
  확인. 파일이 없으면 "배치가 아직 한 번도 실행되지 않음"으로 보고하라.
- `<OKF_HOME>/raw/` 디렉토리의 `.jsonl` 파일 개수 — 현재 수집되어 처리 대기 중인 세션 수.
  (수집은 세션 훅이 아니라 배치의 sweep이 한다: 마지막 활동 후 `sweep_min_idle_minutes`(기본
  60분) 유휴가 지난 세션만 수집하고, 이미 처리된 세션은 그 뒤 파일이 더 커졌을 때만 다시
  수집한다. `.okf/capture-status.json`이 남아 있다면 구버전(훅 캡처 시절)의 잔재이니 무시하라.)
- `<OKF_HOME>/.okf/batch.lock` 존재 여부 — 있으면 Read해서 `{pid, startedEpochMs}`를 확인하고,
  그 `pid`가 살아있는지 검사하라(macOS/Linux: `kill -0 <pid>` 종료 코드로 판정, Windows:
  `tasklist /FI "PID eq <pid>"` 출력에 해당 PID가 있는지로 판정). 살아있으면 "배치 실행 중",
  죽어있으면 "stale lock(다음 배치가 자동 정리함)"으로 보고하라.
- `<OKF_HOME>`이나 `<OKF_HOME>/.git`이 아예 존재하지 않으면 "아직 부트스트랩되지 않음(첫
  세션이 시작되면 자동 생성됨)"으로 보고하고 나머지 항목은 생략하라.
- **`last-batch.json`의 `blocked` 필드** — 값이 있으면(`kind: "pre-batch-lint"`) 배치가
  **영구 정지** 상태다. 이건 다른 어떤 항목보다 먼저, **보고서 맨 첫 줄부터** 경고로 내라.
  스스로 풀리지 않으며 사용자가 고치기 전까지 매 회차 같은 지점에서 멈춘다. 순서:
  1. `since`(최초 정지 시각)를 사람이 읽는 형태로,
  2. `files` 배열을 그대로 나열(이 파일들의 lint 에러가 원인이다),
  3. `rules` 요약,
  4. 해소 방법: `node "${CLAUDE_PLUGIN_ROOT}/lib/lint.mjs" <OKF_HOME>`를 실행해 남은 에러를
     확인하고 고친 뒤 다음 배치를 기다리면 자동으로 풀린다.

  `blocked`가 없거나 `null`이면 이 블록 자체를 출력하지 마라 — 정상 상태를 경고처럼 보이게
  하면 진짜 경고가 묻힌다.
- **`last-batch.json`의 `chunks` 필드** — `{total, committed, noop, skipped}`. **`lastResult: ok`는
  드라이버가 정상 종료했다는 뜻일 뿐 산출물 유무와 무관하다.** 실측으로 사용자를 혼란시킨
  지점이므로 반드시 갈라서 보고하라:
  - `committed > 0`이면 "지식 N청크 반영" — 정상이다.
  - `committed === 0 && noop > 0`이면 "LLM은 돌았지만 반영할 지식이 없다고 판단". 한두 번은
    정상이지만, **잔여 raw가 회차마다 단조 증가하면서 이 상태가 반복되면** sweep이 배치 자신의
    세션이나 테스트·벤치마크 하니스 세션을 사용자 대화로 오인해 되먹이는 자기증식 루프를
    의심하라. 판별 지표는 `pendingAfter`의 추세다 — 단조 증가면 sweep 오분류, 오르내리다 0으로
    수렴하면 정상 재시도다.
  - `skipped > 0`이면 그 청크들은 raw로 되돌아가 **다음 회차에 재시도된다**(유실이 아니다).
    같은 raw가 여러 회차 연속 skipped면 그때는 진짜 쓰기 차단(권한·락·디스크)을 의심하라.
  - `quarantined > 0`이면 그 세션들은 **3회 연속 실패해 재시도를 포기**하고 `_remove_candidate/`로
    옮겨졌다(30일 보관 후 자동 삭제). 무한 재과금을 막는 장치이므로 정상 동작이지만, 그 세션의
    지식은 반영되지 않았다는 뜻이다 — 보고에 반드시 포함하고, 원인은 배치 로그의
    "N회 연속 실패" 줄 근처를 보라고 안내하라.
  - 필드가 없으면 구버전이 쓴 상태 파일이다 — 없다고만 밝히고 추측하지 마라.
- **`last-batch.json`의 비용 필드** — `costUsd`(이번 회차 지출), `spendTodayUsd`/`spendDate`
  (그 로컬 날짜의 누계), `llmCalls`(유료 호출 횟수), `unpricedCalls`(호출은 났으나 금액을
  모르는 건수), `tokens`(입력/출력/캐시 토큰). 있으면 그대로 보고하라. 필드가 아예 없으면
  "비용 기록 없음(다음 배치부터 기록됨)"이라고 밝혀라 — 0원이라고 말하지 마라.
  `unpricedCalls > 0`이면 "표시된 금액은 하한이다"라고 덧붙여라.

## 3. 보고 형식

위 항목을 짧은 불릿 리스트로 요약해 보고하라. 예:

- OKF_HOME: `~/.claude/okf`
- 마지막 배치: 2026-07-15 09:12 (성공), 처리 후 잔여 raw 2개
- 대기 중인 raw: 3개
- 지출: 이번 회차 $0.43 / 오늘 누계 $1.72 (호출 2회, 토큰 in 41,203 / out 3,884)
- 락 상태: 없음 (배치 실행 중 아님)

숫자·경로는 실제로 조사한 값을 그대로 쓰고, 파일이 없거나 파싱할 수 없는 항목은 추측하지
말고 있는 그대로 "확인 불가/없음"이라고 밝혀라.

`blocked`가 있으면 위 불릿보다 **앞에** 이런 형태로 낸다:

- ⚠ 배치 정지: pre-batch lint 실패 (2026-07-24 03:11부터)
  - 원인 파일: `decisions/broken.md`
  - 규칙: `E1=1`
  - 해소: `node "${CLAUDE_PLUGIN_ROOT}/lib/lint.mjs" <OKF_HOME>`로 확인 후 수정
