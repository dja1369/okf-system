import fs from 'node:fs';
import path from 'node:path';
import { okfPaths } from './paths.mjs';

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

// implement.md §5-2: raw is a lossless full copy of the transcript — no parse,
// filter, or size cap here (that belongs to digest.mjs at batch time only).
export function captureSession({ okfHome, cwd, sessionId, transcriptPath }) {
  let stat;
  try {
    stat = fs.statSync(transcriptPath);
  } catch {
    stat = null;
  }
  if (!stat || stat.size === 0) return { captured: false, dest: null };

  const project = sanitizeForFilename(path.basename(cwd));
  const paths = okfPaths(okfHome);
  const rawDir = paths.raw;
  fs.mkdirSync(rawDir, { recursive: true });

  // Resume of the same session: transcriptPath is always that session's latest
  // full history (a superset of what's there), so overwriting the prior
  // destination is the documented append-only exception (§0/§5-2).
  const suffix = `--${sessionId}.jsonl`;
  const existing = fs.readdirSync(rawDir).find((f) => f.endsWith(suffix));
  const dest = existing
    ? path.join(rawDir, existing)
    : path.join(rawDir, `${new Date().toLocaleDateString('en-CA')}--${project}--${sessionId}.jsonl`);

  const tmp = path.join(rawDir, `.tmp-${process.pid}`);
  try {
    fs.copyFileSync(transcriptPath, tmp);
    fs.renameSync(tmp, dest);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // expected once renameSync succeeded — tmp no longer exists.
    }
  }

  return { captured: true, dest };
}
