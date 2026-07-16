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

## 3. 보고 형식

위 항목을 짧은 불릿 리스트로 요약해 보고하라. 예:

- OKF_HOME: `~/.claude/okf`
- 마지막 배치: 2026-07-15 09:12 (성공), 처리 후 잔여 raw 2개
- 대기 중인 raw: 3개
- 락 상태: 없음 (배치 실행 중 아님)

숫자·경로는 실제로 조사한 값을 그대로 쓰고, 파일이 없거나 파싱할 수 없는 항목은 추측하지
말고 있는 그대로 "확인 불가/없음"이라고 밝혀라.
