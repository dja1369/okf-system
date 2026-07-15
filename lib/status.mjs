import fs from 'node:fs';
import { okfPaths } from './paths.mjs';
import { withPrivateLock, writePrivateJsonAtomic } from './permissions.mjs';

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function pendingRaw(okfHome) {
  try {
    return fs.readdirSync(okfPaths(okfHome).raw).filter((name) => name.endsWith('.jsonl')).length;
  } catch {
    return 0;
  }
}

export function safeErrorCode(error) {
  const code = typeof error?.code === 'string' ? error.code : 'UNKNOWN';
  return /^[A-Z0-9_-]{1,64}$/.test(code) ? code : 'UNKNOWN';
}

export function recordCaptureStatus(okfHome, update) {
  try {
    const paths = okfPaths(okfHome);
    const result = withPrivateLock(`${paths.captureStatus}.lock`, () => {
      const previous = readJson(paths.captureStatus);
      const now = Date.now();
      const next = {
        lastAttemptEpochMs: now,
        lastSuccessEpochMs: update.status === 'ok' ? now : (previous.lastSuccessEpochMs ?? null),
        lastStatus: update.status,
        stage: update.stage,
        errorCode: update.errorCode || null,
        configWarnings: Array.isArray(update.configWarnings) ? update.configWarnings : [],
        pendingRaw: pendingRaw(okfHome),
      };
      writePrivateJsonAtomic(paths.captureStatus, next);
    }, { timeoutMs: 1_000, staleMs: 5_000 });
    return result.acquired;
  } catch {
    // Observability must never block capture or the opportunistic batch spawn.
    return false;
  }
}
