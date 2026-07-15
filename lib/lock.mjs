import fs from 'node:fs';

// implement.md §7-2: 2단계 stale 판정(죽은 PID, 또는 살아있어도 하드 상한 초과)을
// 한 곳에만 둔다 — 리뷰 지적(사후 반영): batch-gate.mjs의 사전 게이트가 이 로직을
// 복제하지 않고 PID 생존만 봤던 탓에, hung-but-alive 배치가 자동 spawn 경로를 영구히
// 막아도 batch.mjs 내부의 하드 상한 백스톱이 결코 실행될 기회를 못 얻는 결함이 있었다.
export const HARD_LOCK_CEILING_MS = 4 * 3600_000;

export function readLock(lockPath) {
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    return null;
  }
}

export function isLockStale(lock) {
  if (!lock) return true;
  let alive = false;
  try {
    process.kill(lock.pid, 0);
    alive = true;
  } catch {
    alive = false;
  }
  if (!alive) return true;
  return Date.now() - lock.startedEpochMs > HARD_LOCK_CEILING_MS;
}
