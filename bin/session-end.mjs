import fs from 'node:fs';
import { resolveOkfHome } from '../lib/paths.mjs';
import { readConfig } from '../lib/config.mjs';
import { captureSession } from '../lib/capture.mjs';
import { matchGlob } from '../lib/glob.mjs';
import { maybeSpawnBatch } from '../lib/batch-gate.mjs';

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  if (process.env.OKF_BATCH === '1') return; // §7-1 loop guard (defense-in-depth)

  let input;
  try {
    input = JSON.parse(readStdin());
  } catch {
    return;
  }

  const okfHome = resolveOkfHome();
  let config;
  try {
    config = readConfig(okfHome);
  } catch {
    return;
  }
  if (!config.enabled) return;

  const cwd = input.cwd || process.cwd();
  if (matchGlob(cwd, config.capture_exclude_cwd)) return; // 사용자가 명시적으로 opt-out한 경로만 제외

  try {
    captureSession({
      okfHome,
      cwd,
      sessionId: input.session_id,
      transcriptPath: input.transcript_path,
    });
  } catch {
    // 캡처 실패가 세션 종료를 막으면 안 된다(§5-2, §7-6) — 유실분은 배치의 sweep(§7-8)이 회수.
  }

  try {
    maybeSpawnBatch(okfHome, config);
  } catch {
    // 배치 기동 실패도 세션 종료에 영향을 주면 안 된다.
  }
}

// 훅은 무슨 일이 있어도 exit 0 (fail-open, §5-2/§7-6) — 세션 종료를 절대 막지 않는다.
try {
  main();
} catch {
  // no-op
}
process.exit(0);
