import fs from 'node:fs';
import path from 'node:path';
import { resolveOkfHome, okfPaths, SCAN_EXCLUDE_DIRS } from '../lib/paths.mjs';
import { readLock, isLockStale } from '../lib/lock.mjs';

// 상태줄용 한 줄 요약. 사용자가 아무것도 안 물어봐도 배치가 살아있는지, 지식이 쌓이는지,
// backlog가 새는지 보이게 하는 게 목적이다 — 이 시스템은 조용히 백그라운드에서 도는 물건이라
// 문제가 생겨도 티가 안 나는 게 가장 큰 위험이다(실제로 배치가 매번 NO-OP인 걸 한참 몰랐다).
//
// 상태줄은 매 턴 렌더되므로 절대 느리면 안 된다: 디렉토리 나열 몇 번 + 작은 JSON 하나만 읽고,
// 파일 내용은 읽지 않는다. 어떤 오류에서도 조용히 빈 문자열을 내고 끝낸다 — 상태줄 때문에
// 세션 UI가 깨지면 그게 더 나쁘다.

function countConcepts(okfHome) {
  let n = 0;
  let entries;
  try {
    entries = fs.readdirSync(okfHome, { withFileTypes: true });
  } catch {
    return -1; // 번들 없음(아직 부트스트랩 전)
  }
  for (const d of entries) {
    if (!d.isDirectory() || SCAN_EXCLUDE_DIRS.has(d.name)) continue;
    try {
      n += fs.readdirSync(path.join(okfHome, d.name)).filter((f) => f.endsWith('.md') && f !== 'index.md').length;
    } catch {
      // 읽을 수 없는 디렉토리는 세지 않는다
    }
  }
  return n;
}

function relTime(ms) {
  const d = Date.now() - ms;
  if (d < 0) return 'now';
  const m = Math.floor(d / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function build() {
  const okfHome = resolveOkfHome();
  const p = okfPaths(okfHome);

  const concepts = countConcepts(okfHome);
  if (concepts < 0) return ''; // 번들이 아직 없으면 상태줄을 어지럽히지 않는다

  const parts = [`OKF ${concepts}`];

  let pending = 0;
  try {
    pending = fs.readdirSync(p.raw).filter((f) => f.endsWith('.jsonl')).length;
  } catch {
    // raw 없음 = 0
  }
  // 대기 중인 세션은 곧 처리될 정상 상태이므로, 쌓이기 시작할 때만 눈에 띄게 한다.
  if (pending > 0) parts.push(`+${pending}${pending >= 20 ? '!' : ''}`);

  const lock = readLock(p.lock);
  if (lock && !isLockStale(lock)) {
    parts.push('batch running');
  } else {
    try {
      const last = JSON.parse(fs.readFileSync(p.lastBatch, 'utf8'));
      if (last.lastResult && last.lastResult !== 'ok' && last.lastResult !== 'noop') {
        parts.push(`last: ${last.lastResult}`); // 실패는 조용히 넘기지 않는다
      } else if (typeof last.lastRunEpochMs === 'number') {
        parts.push(relTime(last.lastRunEpochMs));
      }
    } catch {
      parts.push('no batch yet');
    }
  }

  return parts.join(' · ');
}

try {
  const line = build();
  if (line) process.stdout.write(line);
} catch {
  // 상태줄이 세션 UI를 깨뜨리는 일은 없어야 한다
}
process.exit(0);
