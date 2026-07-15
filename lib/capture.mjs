import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { okfPaths } from './paths.mjs';
import { ensurePrivateDir, securePrivateFile, withPrivateLock } from './permissions.mjs';

const RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

// implement.md §5-2: filenames must survive on Windows even though paths
// elsewhere never hardcode Windows-specific handling — this is the one place
// that must, because project basenames are arbitrary user directory names.
export function sanitizeForFilename(name) {
  let out = name.replace(/[:?"<>|\\/*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
  if (RESERVED_NAMES.has(out.toUpperCase())) out = `_${out}`;
  return out || 'project';
}

function sessionIdForFilename(sessionId) {
  const value = String(sessionId ?? '');
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) return value;
  return `invalid-${crypto.createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

// implement.md §5-2: raw is a lossless full copy of the transcript — no parse,
// filter, or size cap here (that belongs to digest.mjs at batch time only).
export function captureSession({ okfHome, cwd, sessionId, transcriptPath }) {
  let stat;
  try {
    stat = fs.statSync(transcriptPath);
  } catch {
    stat = null;
  }
  if (!stat) return { captured: false, dest: null, reason: 'unavailable' };
  if (stat.size === 0) return { captured: false, dest: null, reason: 'empty' };

  const project = sanitizeForFilename(path.basename(cwd));
  const paths = okfPaths(okfHome);
  const rawDir = paths.raw;
  ensurePrivateDir(rawDir);

  // Copy outside the lock: only the tiny compare+rename critical section is serialized.
  // Async SessionEnd processes may complete out of order, so a shorter (older) snapshot
  // must never overwrite an already captured append-only superset.
  const safeSessionId = sessionIdForFilename(sessionId);
  const suffix = `--${safeSessionId}.jsonl`;
  const candidate = path.join(rawDir, `.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  const lockId = crypto.createHash('sha256').update(String(sessionId)).digest('hex').slice(0, 24);
  const lockPath = path.join(rawDir, `.capture-${lockId}.lock`);
  let dest = null;
  try {
    fs.copyFileSync(transcriptPath, candidate);
    securePrivateFile(candidate);
    const locked = withPrivateLock(lockPath, () => {
      const existing = fs.readdirSync(rawDir).find((f) => f.endsWith(suffix));
      dest = existing
        ? path.join(rawDir, existing)
        : path.join(rawDir, `${new Date().toLocaleDateString('en-CA')}--${project}--${safeSessionId}.jsonl`);
      const existingSize = existing ? fs.statSync(dest).size : -1;
      const candidateSize = fs.statSync(candidate).size;
      if (candidateSize >= existingSize) {
        fs.renameSync(candidate, dest);
        securePrivateFile(dest);
      }
    }, { timeoutMs: 540_000, staleMs: 30_000 });
    if (!locked.acquired) return { captured: false, dest, reason: 'busy' };
  } finally {
    try {
      fs.unlinkSync(candidate);
    } catch {
      // expected once renameSync succeeded — candidate no longer exists.
    }
  }

  return { captured: true, dest, reason: null };
}
