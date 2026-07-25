import fs from 'node:fs';
import { okfPaths } from './paths.mjs';
import { git } from './git.mjs';
import { writePrivateJsonAtomic } from './permissions.mjs';

// 설치 시각 마커. 존재 이유는 하나다: 설치 버튼 한 번에 **지난 7일치 전 프로젝트 대화**가
// 유료 배치로 나가는 것을 막는다. 실측(저자 로그): 설치 직후 첫 SessionStart가
// lastRunEpochMs=0으로 인터벌을 통과해 16/10/37/183개를 회수하고 8청크를 유료로 태웠으며
// 전부 NO-OP이었다. 유일한 옵트아웃인 capture_exclude_cwd는 기본 []이고 config.md 자체가
// **바로 그 SessionStart에서 처음 생성**되므로 설정할 창이 물리적으로 존재하지 않는다.
//
// 기존 사용자에게 조용한 유실을 만들면 안 되므로, 마커는 신규 번들에서만 '지금'이고
// 기존 번들에서는 git 루트 커밋으로 소급한다. 소급된 마커는 7일 창을 절대 좁히지 않도록
// 호출부(bin/batch.mjs)가 클램프한다.

export function resolveInstalledAt(okfHome, bundleExisted) {
  if (!bundleExisted) return { installedAtEpochMs: Date.now(), source: 'bootstrap' };

  // `rev-list --format`은 `commit <sha>` 줄이 섞여 나온다 — 쓰지 마라(실행 확인).
  // `%ct`는 **초**다. `* 1000`을 빠뜨리면 하한이 1970년이 되어 기능이 통째로 무효화되고
  // 아무 테스트도 그것을 잡지 못한다.
  try {
    const out = git(['log', '--max-parents=0', '--format=%ct', 'HEAD'], okfHome, {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().split('\n')[0];
    const seconds = Number(out);
    if (Number.isFinite(seconds) && seconds > 0) {
      return { installedAtEpochMs: seconds * 1000, source: 'git-root-commit' };
    }
  } catch {
    // 커밋이 아직 없거나 git이 없다 — 아래로 폴백
  }

  try {
    const prev = JSON.parse(fs.readFileSync(okfPaths(okfHome).lastBatch, 'utf8'));
    if (Number.isFinite(prev?.lastRunEpochMs) && prev.lastRunEpochMs > 0) {
      return { installedAtEpochMs: prev.lastRunEpochMs, source: 'last-batch' };
    }
  } catch {
    // 상태 파일도 없다
  }

  // 기존 번들인데 설치 시각을 알 길이 없다. source를 'bootstrap'으로 두면 클램프가 꺼져
  // 기존 사용자의 7일 창이 조용히 좁아진다 — 그래서 반드시 다른 값이어야 한다.
  return { installedAtEpochMs: Date.now(), source: 'unknown' };
}

// 항상 {installedAtEpochMs, source, persisted}를 준다. **null을 절대 반환하지 마라** —
// 재계산 폴백이 곧 fail-closed 보장이다.
//
// `persisted`가 왜 필요한가: 호출부의 클램프는 "소급된 마커는 기존 7일 창을 좁히지 않는다"인데,
// **신규 설치인데 마커 쓰기만 실패한** 경우도 소급 경로(git 루트 커밋 = 방금 = now)를 타므로
// 그 클램프가 걸려 설치 전 7일치를 통째로 끌어온다 — R1이 막으려던 바로 그 사고다.
// 마커 파일을 실제로 읽었는지를 구분하면 그 구멍이 닫힌다: 못 읽었으면 클램프 없이
// fail-closed로 간다(그 회차는 소급 수집을 하지 않는다).
export function readInstalledAt(okfHome) {
  try {
    const parsed = JSON.parse(fs.readFileSync(okfPaths(okfHome).installedAt, 'utf8'));
    if (Number.isFinite(parsed?.installedAtEpochMs) && parsed.installedAtEpochMs > 0) {
      return { ...parsed, persisted: true };
    }
  } catch {
    // 재계산
  }
  return { ...resolveInstalledAt(okfHome, fs.existsSync(okfPaths(okfHome).git)), persisted: false };
}

export function ensureInstalledAt(okfHome, bundleExisted) {
  const markerPath = okfPaths(okfHome).installedAt;
  if (fs.existsSync(markerPath)) return readInstalledAt(okfHome);
  const resolved = resolveInstalledAt(okfHome, bundleExisted);
  try {
    writePrivateJsonAtomic(markerPath, resolved);
  } catch {
    // 쓰기 실패는 치명적이지 않다 — readInstalledAt이 매번 재계산한다.
  }
  return resolved;
}
