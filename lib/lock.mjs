import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { okfPaths } from './paths.mjs';

// ---------- OKF 번들 락 계약 ----------
// 누가 잡는가: <OKF_HOME> 아래 .md를 쓰거나 git 커밋을 만드는 모든 프로세스.
//   현재 홀더: 'batch'(bin/batch.mjs), 'deprecate'(/okf:okf-deprecate).
//   잡지 않고 쓰면 (1) 배치의 유실 백스톱(bin/batch.mjs의 Buffer.compare 동일성 검사)이
//   무력화되고 (2) 배치가 stale lock을 회수한 회차라면 그 쓰기가 무조건 원복된다.
// 누가 존중하는가: lib/batch-gate.mjs, bin/statusline.mjs, lib/bootstrap.mjs.
// stale 판정: 페이로드가 객체가 아니거나 pid가 양의 정수가 아니거나 startedEpochMs가 유한수가
//   아니면 stale / PID가 죽었으면 stale(EPERM은 '남의 소유 = 살아있음') / 살아있어도
//   HARD_LOCK_CEILING_MS 초과면 stale.
// 소유권: releaseLock은 token이 자기 것일 때만 unlink한다.
//
// implement.md §7-2: 2단계 stale 판정(죽은 PID, 또는 살아있어도 하드 상한 초과)을
// 한 곳에만 둔다 — 리뷰 지적(사후 반영): batch-gate.mjs의 사전 게이트가 이 로직을
// 복제하지 않고 PID 생존만 봤던 탓에, hung-but-alive 배치가 자동 spawn 경로를 영구히
// 막아도 batch.mjs 내부의 하드 상한 백스톱이 결코 실행될 기회를 못 얻는 결함이 있었다.
export const HARD_LOCK_CEILING_MS = 4 * 3600_000;
export const LOCK_ACQUIRE_MAX_ATTEMPTS = 10; // 경합 재시도 상한 — 이론상 수렴하지만 무한루프 방지용 안전판

export function readLock(lockPath) {
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    return null;
  }
}

export function isLockStale(lock) {
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) return true;
  // {pid: 0}이면 process.kill(0, 0)이 '프로세스 그룹 시그널'로 해석돼 성공하므로 영원히 alive가
  // 되고, startedEpochMs가 없으면 `NaN > ceiling === false`라 하드 상한이 결코 발동하지 않는다.
  // 두 경우 모두 배치가 영구 정지한다 — 페이로드를 먼저 검증해야 하는 이유다.
  if (!Number.isInteger(lock.pid) || lock.pid <= 0) return true;
  if (!Number.isFinite(lock.startedEpochMs)) return true;
  let alive = false;
  try {
    process.kill(lock.pid, 0);
    alive = true;
  } catch (err) {
    // EPERM = 그 PID가 존재하지만 남의 소유다 = 살아있다. ESRCH만 '죽었다'이다.
    alive = err?.code === 'EPERM';
  }
  if (!alive) return true;
  return Date.now() - lock.startedEpochMs > HARD_LOCK_CEILING_MS;
}

// 번들에 쓰려는 다른 주체(bootstrap 등)가 "지금 배치가 도는가"를 묻는 단일 술어.
export function isBundleLocked(okfHome) {
  return !isLockStale(readLock(okfPaths(okfHome).lock));
}

function tryUnlink(p) {
  try {
    fs.unlinkSync(p);
  } catch {
    // no-op
  }
}

// ---------- 락 획득 (원자적 wx + stale 판정 2단계 + TOCTOU 재확인) ----------
function tryAcquireOnce(lockPath, payload) {
  try {
    fs.writeFileSync(lockPath, payload, { flag: 'wx' });
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
}

// ---------- stale lock 회수 (rename 기반 원자적 클레임) ----------
// 문제: "stale이라고 판정" → "unlink"는 두 시스템 콜이고, 그 사이에 다른 프로세스가 이미
// 회수하고 **자기 유효 락**을 새로 쓸 수 있다. 그러면 우리는 살아있는 남의 락을 지운다(ABA).
// 지우기 직전에 한 번 더 되읽는 방식은 창을 좁힐 뿐 닫지 못한다 — 되읽기와 unlink 사이가
// 그대로 남는다.
//
// 해법: 지우지 말고 **rename으로 가져온다.** rename(A→B)는 A를 원자적으로 소비하므로 동시에
// 시도한 두 프로세스 중 정확히 하나만 성공하고, 나머지는 ENOENT를 받는다. 가져온 뒤에 내용을
// 확인한다:
//   - 내가 stale로 판정한 그 페이로드 그대로 → 진짜 stale이다. 버린다.
//   - 다른 페이로드 → 남의 유효 락을 훔친 것이다. linkSync로 **되돌린다**(link는 대상이
//     있으면 EEXIST로 실패하므로, 그 사이 제3자가 wx로 새 락을 만들었다면 덮어쓰지 않는다).
// 실패 경로는 전부 fail-safe다: 클레임이 안 되면 아무것도 지우지 않고 다음 시도로 넘어간다.
function reclaimStaleLock(lockPath, existing) {
  const claimPath = `${lockPath}.claim-${process.pid}-${randomUUID()}`;
  try {
    fs.renameSync(lockPath, claimPath);
  } catch {
    return; // 남이 먼저 가져갔거나 이미 사라졌다 — 우리가 지울 것은 없다
  }
  const claimed = readLock(claimPath);
  if (JSON.stringify(claimed) === JSON.stringify(existing)) {
    tryUnlink(claimPath); // 판정 대상 그대로 = 진짜 stale
    return;
  }
  // 훔쳤다. 원자적으로 되돌린다.
  try {
    fs.linkSync(claimPath, lockPath);
  } catch {
    // EEXIST = 그 사이 제3자가 새 락을 만들었다. 유효한 락이 존재한다는 사실은 지켜졌다.
  }
  tryUnlink(claimPath);
}

// rename 클레임이 여는 **유일한 새 창**: `renameSync`가 락 파일을 즉시 없애므로, 그 직후
// 프로세스가 죽으면 락은 사라지고 `.claim-*`만 남는다. 그러면 다음 배치가
// `recoveredFromStaleLock=false`로 들어가 반쯤 반영된 분석기 산출물을 **사용자 편집으로 보고
// 커밋**한다 — §7-4가 막으려던 바로 그 오분류다(수정 전에는 크래시가 stale 락을 *남겨서*
// 다음 회차가 그것을 증거로 삼았다). 그래서 `.claim-*`의 존재 자체를 "회수가 중단됐다"는
// 증거로 읽는다. 청소 경로도 여기 하나로 모인다.
function harvestAbandonedClaims(paths) {
  const dir = paths.state;
  const prefix = `${path.basename(paths.lock)}.claim-`;
  let found = false;
  for (const name of safeReaddirSync(dir)) {
    if (!name.startsWith(prefix)) continue;
    found = true;
    tryUnlink(path.join(dir, name));
  }
  return found;
}

function safeReaddirSync(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

export function acquireLock(okfHome, holder, { onLog = () => {} } = {}) {
  const paths = okfPaths(okfHome);
  fs.mkdirSync(paths.state, { recursive: true });
  const token = randomUUID();
  const payload = JSON.stringify({ pid: process.pid, startedEpochMs: Date.now(), holder, token });
  // 우리 자신의 클레임보다 **먼저** 본다 — reclaimStaleLock이 만드는 것과 구별해야 한다.
  let recoveredFromStaleLock = harvestAbandonedClaims(paths);
  let loggedRecovery = false;
  if (recoveredFromStaleLock) {
    onLog('중단된 락 회수 흔적(.claim-*) 발견 — 크래시 잔여물로 간주해 원복 경로로 진입한다');
    loggedRecovery = true;
  }

  for (let attempt = 0; attempt < LOCK_ACQUIRE_MAX_ATTEMPTS; attempt++) {
    if (tryAcquireOnce(paths.lock, payload)) {
      // 되읽어 자기 token인지 확인한다. wx는 원자적이지만 그 직후 다른 프로세스가 우리 락을
      // stale로 오판해 지우고 자기 것을 쓸 수 있다 — 그 경우 우리는 락을 쥔 것이 아니다.
      const mine = readLock(paths.lock);
      if (mine && mine.token === token) return { acquired: true, recoveredFromStaleLock, token };
      continue;
    }

    const existing = readLock(paths.lock);
    if (isLockStale(existing)) {
      if (!loggedRecovery) {
        onLog(existing && Number.isInteger(existing.pid)
          ? `stale lock 회수 (PID ${existing.pid})`
          : 'stale lock 회수 (락 파일 파손/부재)');
        loggedRecovery = true;
      }
      recoveredFromStaleLock = true;
      reclaimStaleLock(paths.lock, existing);
      // 여기서 곧바로 재획득하지 않는다 — 회수와 재획득 사이가 벌어지면 두 프로세스가 서로의
      // 락을 번갈아 지우는 이중 회수가 된다. 루프 상단의 wx가 유일한 획득 경로다.
      continue;
    }

    return { acquired: false, recoveredFromStaleLock: false, token: null }; // 다른 홀더가 정상 진행 중
  }
  return { acquired: false, recoveredFromStaleLock: false, token: null };
}

export function releaseLock(okfHome, token) {
  // **token은 필수다.** 예전엔 `(token && ...)` 단락 평가라 인자를 빠뜨리면 조건이 `!current`만
  // 남아 아무 락이나 지웠다 — 주석으로 위험을 적어두는 것만으로는 exported API를 지킬 수 없다.
  // 잘못된 해제는 두 프로세스가 동시에 번들에 쓰게 만들고, 그건 배치의 유실 백스톱을 무력화한다.
  if (typeof token !== 'string' || token === '') return false;
  const current = readLock(okfPaths(okfHome).lock);
  if (!current || current.token !== token) return false; // 남의 락은 지우지 않는다
  try {
    fs.unlinkSync(okfPaths(okfHome).lock);
    return true;
  } catch {
    return false;
  }
}
