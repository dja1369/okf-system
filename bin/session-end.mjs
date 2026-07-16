import { resolveOkfHome } from '../lib/paths.mjs';
import { readConfig } from '../lib/config.mjs';
import { maybeSpawnBatch } from '../lib/batch-gate.mjs';

// 세션 종료 훅은 "수집 시점"이 아니라 "배치를 깨울 좋은 순간"일 뿐이다.
//
// 예전에는 여기서 transcript를 raw/로 복사(캡처)했다. 그런데 수집 기준으로서 SessionEnd는
// 부정확하다 — 사용자·에이전트 대부분이 세션을 명시적으로 끝내지 않고(특히 백그라운드
// 에이전트), resume발 SessionEnd는 대화 중간 스냅샷을 캡처해 그 세션을 "처리됨"으로 못박아
// 이후 대화를 영영 잃게 했다(실측: 진행 중이던 12MB 세션이 절반만 ingest됨). 수집은 이제
// 배치의 sweep이 "마지막 활동 후 sweep_min_idle_minutes(기본 60분) 유휴 + 크기 성장" 기준으로
// 판정한다(bin/batch.mjs). 이 훅에는 그 배치를 깨우는 트리거만 남는다.
function main() {
  if (process.env.OKF_BATCH === '1') return; // §7-1 loop guard (defense-in-depth)

  const okfHome = resolveOkfHome();
  let config;
  try {
    config = readConfig(okfHome);
  } catch {
    return;
  }
  if (!config.enabled) return;

  try {
    maybeSpawnBatch(okfHome, config);
  } catch {
    // 배치 기동 실패가 세션 종료에 영향을 주면 안 된다.
  }
}

// 훅은 무슨 일이 있어도 성공 종료(fail-open, §5-2/§7-6) — 세션 종료를 절대 막지 않는다.
try {
  main();
} catch {
  // no-op
}
// process.exit()는 pipe에 쓴 stdout을 자를 수 있다 — bin/session-start.mjs 하단 주석 참조.
process.exitCode = 0;
