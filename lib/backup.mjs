import fs from 'node:fs';
import path from 'node:path';
import { okfPaths } from './paths.mjs';
import { git } from './git.mjs';
import { safeErrorCode } from './status.mjs';
import { localDateString } from './time.mjs';

// 원복은 "잔여물을 버린다"인데, 그 판단이 틀렸을 때 되돌릴 방법이 없었다. 원복 전에 추적 파일을
// _remove_candidate 아래로 복사해 TTL(기본 30일) 동안 가역으로 만든다. 반드시 **날짜 디렉토리
// 아래**여야 purgeRemoveCandidate가 회수한다.
// `--ignored`는 절대 붙이지 마라 — raw/ 전사 원문이 통째로 딸려온다.
export function backupDirtyTree(okfHome, label, { onLog = () => {} } = {}) {
  const paths = okfPaths(okfHome);
  let entries;
  try {
    entries = git(['status', '--porcelain', '-z'], paths.home).split('\0').filter(Boolean);
  } catch (err) {
    onLog(`원복 전 백업 목록 조회 실패: code=${safeErrorCode(err)}`);
    return 0;
  }
  const destRoot = path.join(paths.removeCandidate, localDateString(), `pre-rollback-${label}`);
  let copied = 0;
  for (const entry of entries) {
    // `XY <path>`. rename은 `R  new\0old\0`라 두 번째 필드에 상태코드가 없다 — 그때는 통째로 경로다.
    const rel = /^[ MADRCU?!]{2} /.test(entry) ? entry.slice(3) : entry;
    if (!rel || rel.startsWith('.okf/')) continue;
    const src = path.join(paths.home, rel);
    const dest = path.join(destRoot, rel);
    try {
      if (!fs.statSync(src).isFile()) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      fs.chmodSync(dest, 0o600);
      copied++;
    } catch {
      // 삭제된 파일(D 상태) 등 — 백업할 바이트가 없다. 원복을 막지 않는다.
    }
  }
  if (copied > 0) onLog(`원복 전 dirty 추적 파일 ${copied}개를 _remove_candidate로 백업`);
  return copied;
}
