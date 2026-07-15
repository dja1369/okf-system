import fs from 'node:fs';
import { resolveOkfHome } from '../lib/paths.mjs';
import { readConfig } from '../lib/config.mjs';
import { captureSession } from '../lib/capture.mjs';
import { matchGlob } from '../lib/glob.mjs';
import { maybeSpawnBatch } from '../lib/batch-gate.mjs';
import { recordCaptureStatus, safeErrorCode } from '../lib/status.mjs';

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  if (process.env.OKF_BATCH === '1') return; // §7-1 loop guard (defense-in-depth)

  const okfHome = resolveOkfHome();

  let input;
  try {
    input = JSON.parse(readStdin());
  } catch {
    recordCaptureStatus(okfHome, { status: 'error', stage: 'input', errorCode: 'INVALID_JSON' });
    return;
  }

  const configWarnings = [];
  let config;
  try {
    config = readConfig(okfHome, (warning) => configWarnings.push(`${warning.key}:${warning.code}`));
  } catch (err) {
    recordCaptureStatus(okfHome, { status: 'error', stage: 'config', errorCode: safeErrorCode(err) });
    return;
  }
  if (!config.enabled) return;

  const cwd = input.cwd || process.cwd();
  if (matchGlob(cwd, config.capture_exclude_cwd)) {
    recordCaptureStatus(okfHome, { status: 'skipped', stage: 'excluded', configWarnings });
    return;
  }

  try {
    const result = captureSession({
      okfHome,
      cwd,
      sessionId: input.session_id,
      transcriptPath: input.transcript_path,
    });
    recordCaptureStatus(okfHome, {
      status: result.captured ? 'ok' : (result.reason === 'empty' ? 'skipped' : 'error'),
      stage: result.captured ? 'captured' : `transcript_${result.reason}`,
      errorCode: result.reason === 'unavailable'
        ? 'TRANSCRIPT_UNAVAILABLE'
        : (result.reason === 'busy' ? 'CAPTURE_BUSY' : null),
      configWarnings,
    });
  } catch (err) {
    recordCaptureStatus(okfHome, { status: 'error', stage: 'capture', errorCode: safeErrorCode(err), configWarnings });
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
