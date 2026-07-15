import fs from 'node:fs';
import path from 'node:path';

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const LOCK_POLL_MS = 25;
const sleeper = new Int32Array(new SharedArrayBuffer(4));

function chmodIfPosix(target, mode) {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(target, mode);
  } catch {
    // Permission hardening is best-effort so hooks remain fail-open on unusual filesystems.
  }
}

export function ensurePrivateDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true, mode: PRIVATE_DIR_MODE });
  chmodIfPosix(dirPath, PRIVATE_DIR_MODE); // also migrates an existing permissive directory
}

export function securePrivateFile(filePath) {
  chmodIfPosix(filePath, PRIVATE_FILE_MODE);
}

export function writePrivateFile(filePath, content, options = {}) {
  ensurePrivateDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, { ...options, mode: PRIVATE_FILE_MODE });
  securePrivateFile(filePath);
}

export function writePrivateJsonAtomic(filePath, value) {
  const tmp = `${filePath}.tmp-${process.pid}`;
  writePrivateFile(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, filePath);
  securePrivateFile(filePath);
}

export function withPrivateLock(lockPath, callback, { timeoutMs = 30_000, staleMs = 30_000 } = {}) {
  ensurePrivateDir(path.dirname(lockPath));
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      fs.mkdirSync(lockPath, { mode: PRIVATE_DIR_MODE });
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > staleMs) {
          fs.rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline) return { acquired: false, value: undefined };
      Atomics.wait(sleeper, 0, 0, LOCK_POLL_MS);
    }
  }
  try {
    return { acquired: true, value: callback() };
  } finally {
    try {
      fs.rmdirSync(lockPath);
    } catch {
      // A stale-lock recovery may already have removed it.
    }
  }
}
