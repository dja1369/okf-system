import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { okfPaths, pluginRoot } from './paths.mjs';
import { readLock, isLockStale } from './lock.mjs';

// 리뷰 지적(사후 반영): 예전에는 PID 생존만 확인해서, hung-but-alive 배치 프로세스가
// 있으면 batch.mjs의 하드 상한(4h) 백스톱이 spawn될 기회 자체를 영원히 못 얻었다.
// bin/batch.mjs의 acquireLock()과 동일한 lib/lock.mjs 판정을 여기서도 써서 일치시킨다.
function isLockAlive(okfHome) {
  return !isLockStale(readLock(okfPaths(okfHome).lock));
}

// implement.md §5-4: interval + lock-liveness only — deliberately NOT gated on
// "raw/ non-empty", because sweep (§7-8, inside batch.mjs) must run on schedule
// even when raw/ is permanently empty (e.g. capture has been failing). This is
// only a fast pre-check to avoid pointless spawns; real exclusivity is batch.mjs's
// atomic `wx` lock (§5-5 step 0) — duplicate spawns here are safe, just wasteful.
export function maybeSpawnBatch(okfHome, config) {
  const paths = okfPaths(okfHome);

  let lastRunEpochMs = 0;
  try {
    lastRunEpochMs = JSON.parse(fs.readFileSync(paths.lastBatch, 'utf8')).lastRunEpochMs ?? 0;
  } catch {
    // no last-batch.json yet -> treat as never run
  }
  if (Date.now() - lastRunEpochMs < config.batch_interval_hours * 3600_000) return;
  if (isLockAlive(okfHome)) return;

  const nodeBin = config.node_bin || process.execPath;
  const batchScript = path.join(pluginRoot(), 'bin', 'batch.mjs');
  const child = spawn(nodeBin, [batchScript], {
    cwd: okfHome,
    // 발견된 버그(사후 반영, 리뷰 대상은 아니었으나 테스트 중 직접 재현): OKF_HOME을 자식에
    // 명시적으로 넘기지 않으면, 자식은 자기 own resolveOkfHome()으로 독립적으로 재해석한다.
    // 호출자가 이미 특정 okfHome을 확정해서 넘겼는데(OKF_HOME 환경변수를 안 쓰는 기본 설치
    // 환경이 아니라면) 부모·자식이 서로 다른 번들을 보게 될 수 있다 — cwd만으로는 해결 안 됨
    // (resolveOkfHome은 process.cwd()가 아니라 env var만 본다).
    env: { ...process.env, OKF_BATCH: '1', OKF_HOME: okfHome },
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    shell: false,
  });
  child.unref();
}
