import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveOkfHome, okfPaths, pluginRoot, claudeConfigDir, isOkfTestSessionDir, sanitizeForFilename, SCAN_EXCLUDE_DIRS } from '../lib/paths.mjs';
import { readConfig, DEFAULT_CONFIG } from '../lib/config.mjs';
import { git, isDirty, commitAll, rollback } from '../lib/git.mjs';
import { runLint, formatReport } from '../lib/lint.mjs';
import { regenerateIndex } from '../lib/index-gen.mjs';
import { digestFile } from '../lib/digest.mjs';
import { matchGlob } from '../lib/glob.mjs';
import { readLock, isLockStale } from '../lib/lock.mjs';
import { ensurePrivateDir, securePrivateFile, writePrivateJsonAtomic } from '../lib/permissions.mjs';
import { safeErrorCode } from '../lib/status.mjs';

const LOCK_ACQUIRE_MAX_ATTEMPTS = 10; // 경합 재시도 상한 — 이론상 수렴하지만 무한루프 방지용 안전판
const SWEEP_LOOKBACK_DAYS = 7; // §7-8: 이보다 오래된 orphan transcript는 sweep 대상에서 제외
// 유휴 판정은 config(sweep_min_idle_minutes, 기본 60분)로 옮겼다 — "마지막 활동 후 N분"이
// 수집의 1차 기준이 됐기 때문이다. 세션 훅은 수집 시점이 아니라 배치를 깨우는 트리거일 뿐이다.
const BATCH_SESSION_RETENTION_MS = 14 * 86400_000;
const BATCH_SESSION_REGISTRY_LIMIT = 2000;
const CHUNK_BYTE_LIMIT = 300 * 1024; // §5-5 6단계
const INGEST_TIMEOUT_MS = 15 * 60_000;
const REPAIR_TIMEOUT_MS = 15 * 60_000;
// 링거(유휴 대기) 노브 — 기본 5분 간격 확인, 최대 8시간. 테스트가 수 분씩 잠들지 않도록
// env로만 조정한다(사용자 노브는 sweep_min_idle_minutes 쪽이다).
const LINGER_POLL_MS = positiveIntFromEnv('OKF_LINGER_POLL_MS', 5 * 60_000);
const LINGER_MAX_MS = positiveIntFromEnv('OKF_LINGER_MAX_MS', 8 * 3600_000);
const SESSION_ID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

// 리뷰 지적(사후 반영): capture.mjs는 로컬 날짜(toLocaleDateString('en-CA'))를 쓰는데
// 이 파일은 toISOString(UTC)을 섞어 써서, UTC+ 시간대의 이른 새벽 시간대에 라벨이 하루
// 어긋났다(§5-2/§5-5/§6 안건5가 명시하는 "로컬 날짜" 요구와 불일치). 한 곳으로 통일한다.
function localDateString(date = new Date()) {
  return date.toLocaleDateString('en-CA');
}

function log(okfHome, msg) {
  try {
    const paths = okfPaths(okfHome);
    ensurePrivateDir(paths.logs);
    const today = localDateString();
    const logPath = path.join(paths.logs, `batch-${today}.log`);
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`, { mode: 0o600 });
    securePrivateFile(logPath);
  } catch {
    // 로그 기록 실패는 배치 진행을 막지 않는다.
  }
  console.error(msg);
}

function summarizeLintForLog(report) {
  const counts = new Map();
  for (const item of [...report.errors, ...report.warnings]) {
    const rule = /^[A-Z][0-9]{1,2}$/.test(item.rule) ? item.rule : 'UNKNOWN';
    counts.set(rule, (counts.get(rule) || 0) + 1);
  }
  return [...counts.entries()].sort().map(([rule, count]) => `${rule}=${count}`).join(', ') || 'none';
}

function tryUnlink(p) {
  try {
    fs.unlinkSync(p);
  } catch {
    // no-op
  }
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function sessionIdFromFilename(filename) {
  const m = SESSION_ID_RE.exec(filename);
  return m ? m[1] : filename.replace(/\.jsonl$/, '');
}

function rememberBatchSession(okfHome, sessionId) {
  if (typeof sessionId !== 'string' || !/^[0-9a-z-]{8,128}$/i.test(sessionId)) return;
  const paths = okfPaths(okfHome);
  let sessions = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(paths.batchSessions, 'utf8'));
    if (Array.isArray(parsed.sessions)) sessions = parsed.sessions;
  } catch {
    // Missing/corrupt registry is rebuilt from the current result.
  }
  const cutoff = Date.now() - BATCH_SESSION_RETENTION_MS;
  const byId = new Map();
  for (const item of sessions) {
    if (typeof item?.id !== 'string' || !Number.isFinite(item.recordedEpochMs) || item.recordedEpochMs < cutoff) continue;
    byId.set(item.id, item);
  }
  byId.set(sessionId, { id: sessionId, recordedEpochMs: Date.now() });
  const kept = [...byId.values()].sort((a, b) => a.recordedEpochMs - b.recordedEpochMs).slice(-BATCH_SESSION_REGISTRY_LIMIT);
  writePrivateJsonAtomic(paths.batchSessions, { sessions: kept });
}

function batchSessionIds(okfHome) {
  try {
    const parsed = JSON.parse(fs.readFileSync(okfPaths(okfHome).batchSessions, 'utf8'));
    return new Set((Array.isArray(parsed.sessions) ? parsed.sessions : []).map((item) => item?.id).filter((id) => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

function samePath(a, b) {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

// Claude may write a large queue-operation record before the first user/assistant record that
// carries cwd. Read a bounded prefix larger than the batch chunk ceiling, never the whole file.
function readTranscriptCwd(transcriptPath) {
  let prefix;
  try {
    const fd = fs.openSync(transcriptPath, 'r');
    try {
      const buffer = Buffer.alloc(1024 * 1024);
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
      prefix = buffer.subarray(0, bytes).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  for (const line of prefix.split('\n')) {
    if (!line.includes('"cwd"')) continue;
    try {
      const row = JSON.parse(line);
      if (typeof row.cwd === 'string') return row.cwd;
    } catch {
      // The bounded prefix may end mid-record; the session-id registry remains the primary guard.
    }
  }
  return null;
}

function transcriptCwdIsOkfHome(transcriptPath, okfHome) {
  const cwd = readTranscriptCwd(transcriptPath);
  return cwd != null && samePath(cwd, okfHome);
}

// ---------- 0. 락 획득 (원자적 wx + stale 판정 2단계) ----------
function tryAcquireOnce(lockPath, payload) {
  try {
    fs.writeFileSync(lockPath, payload, { flag: 'wx' });
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
}

function acquireLock(okfHome) {
  const paths = okfPaths(okfHome);
  fs.mkdirSync(paths.state, { recursive: true });
  const payload = JSON.stringify({ pid: process.pid, startedEpochMs: Date.now() });

  for (let attempt = 0; attempt < LOCK_ACQUIRE_MAX_ATTEMPTS; attempt++) {
    if (tryAcquireOnce(paths.lock, payload)) {
      return { acquired: true, recoveredFromStaleLock: false };
    }

    // lib/lock.mjs의 동일 판정(죽은 PID, 또는 살아있어도 하드 상한 초과)을 쓴다 — 이 판정
    // 로직이 여기와 lib/batch-gate.mjs 두 곳에 따로 있으면 서로 어긋나기 쉽다(리뷰 지적 사후 반영).
    const existing = readLock(paths.lock);
    if (isLockStale(existing)) {
      log(okfHome, existing ? `stale lock 회수 (PID ${existing.pid})` : 'stale lock 회수 (락 파일 파손/부재)');
      tryUnlink(paths.lock);
      if (tryAcquireOnce(paths.lock, payload)) return { acquired: true, recoveredFromStaleLock: true };
      continue;
    }

    return { acquired: false, recoveredFromStaleLock: false }; // 다른 배치가 정상 진행 중
  }
  return { acquired: false, recoveredFromStaleLock: false };
}

function releaseLock(okfHome) {
  tryUnlink(okfPaths(okfHome).lock);
}

// ---------- 1. 수집 (sweep, §7-8 — 이제 1차 수집 경로) ----------
// 수집 기준은 세션 훅이 아니라 "마지막 활동 후 sweep_min_idle_minutes 유휴 + 크기 성장"이다.
// - 유휴: 사용자·에이전트 대부분은 세션을 명시적으로 끝내지 않으므로, 조용해진 대화만 완결로 본다.
// - 크기: 이미 수집/처리된 세션은 원본이 그보다 커졌을 때만(=대화가 이어졌을 때만) 다시 수집한다.
//   같은 크기면 절대 재수집하지 않는다(불변식). resume발 중간 스냅샷이 세션ID를 "처리됨"으로
//   못박아 후반 대화를 영영 잃던 버그의 해법이기도 하다.
// CLAUDE_CONFIG_DIR 존중(리뷰 지적 사후 반영): OKF_HOME 해석과 같은 루트를 봐야 한다.
// collect=false면 판정만 하고 복사하지 않는다 — 링거의 probe용.
function scanOrphanSessions(okfHome, config, collect) {
  const projectsDir = path.join(claudeConfigDir(), 'projects');
  let projectDirs;
  try {
    projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return { recovered: 0, freshPending: 0 };
  }

  const paths = okfPaths(okfHome);
  const idleMs = config.sweep_min_idle_minutes * 60_000;

  const queuedById = new Map();
  for (const f of safeReaddir(paths.raw)) {
    if (!f.endsWith('.jsonl')) continue;
    try {
      queuedById.set(sessionIdFromFilename(f), { dest: path.join(paths.raw, f), size: fs.statSync(path.join(paths.raw, f)).size });
    } catch {
      // 방금 이동/삭제된 큐 파일은 없는 것으로 본다
    }
  }
  const archivedMaxById = new Map();
  for (const dateDir of safeReaddir(paths.removeCandidate)) {
    for (const f of safeReaddir(path.join(paths.removeCandidate, dateDir))) {
      if (!f.endsWith('.jsonl')) continue;
      const id = sessionIdFromFilename(f);
      let size = 0;
      try {
        size = fs.statSync(path.join(paths.removeCandidate, dateDir, f)).size;
      } catch {
        // stat 실패한 보관본은 0으로 취급 — 재수집이 유실보다 낫다
      }
      archivedMaxById.set(id, Math.max(archivedMaxById.get(id) ?? 0, size));
    }
  }
  const selfSessionIds = batchSessionIds(okfHome);

  const cutoff = Date.now() - SWEEP_LOOKBACK_DAYS * 86400_000;
  let recovered = 0;
  let freshPending = 0;

  for (const dirent of projectDirs) {
    // OKF 자신의 테스트·벤치가 임시 디렉토리에서 남긴 세션은 사용자 지식이 아니다. 이 필터가
    // 없어서 실제 projects/에 쌓인 241개 디렉토리(295개 transcript)가 전부 sweep 대상이었고,
    // 유료 배치를 돌려 번들에 테스트 픽스처를 지식으로 기록했다.
    if (isOkfTestSessionDir(dirent.name)) continue;
    const dir = path.join(projectsDir, dirent.name);
    for (const f of safeReaddir(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      const sessionId = sessionIdFromFilename(f);
      if (selfSessionIds.has(sessionId)) continue;

      const full = path.join(dir, f);
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.size === 0 || st.mtimeMs < cutoff) continue;

      const queued = queuedById.get(sessionId);
      const knownSize = Math.max(queued?.size ?? 0, archivedMaxById.get(sessionId) ?? 0);
      if (st.size <= knownSize) continue; // 그 크기까지는 이미 수집/처리됨 — 성장했을 때만 다시 본다

      const cwd = readTranscriptCwd(full);
      if (cwd != null && samePath(cwd, okfHome)) continue; // 분석기 자신의 세션
      if (cwd != null && matchGlob(cwd, config.capture_exclude_cwd)) continue; // 사용자 지정 수집 제외

      if (Date.now() - st.mtimeMs < idleMs) {
        freshPending++; // 아직 대화 중일 수 있다 — 유휴 도달까지 링거가 기다린다
        continue;
      }

      if (!collect) {
        recovered++;
        continue;
      }

      const project = sanitizeForFilename(dirent.name);
      const dateStr = localDateString(st.mtime);
      const dest = queued ? queued.dest : path.join(paths.raw, `${dateStr}--${project}--${sessionId}.jsonl`);
      try {
        fs.mkdirSync(paths.raw, { recursive: true });
        fs.copyFileSync(full, dest); // 큐에 이미 있으면 superset으로 교체된다
        securePrivateFile(dest);
        queuedById.set(sessionId, { dest, size: st.size });
        recovered++;
      } catch (err) {
        log(okfHome, `sweep 복사 실패 ${path.basename(full)}: code=${safeErrorCode(err)}`);
      }
    }
  }
  return { recovered, freshPending };
}

function sweepOrphanSessions(okfHome, config) {
  return scanOrphanSessions(okfHome, config, true);
}

// ---------- 2. 크래시 복구 ----------
function recoverStagingLeftovers(okfHome) {
  const paths = okfPaths(okfHome);
  for (const runId of safeReaddir(paths.staging)) {
    const runDir = path.join(paths.staging, runId);
    for (const f of safeReaddir(runDir)) {
      const full = path.join(runDir, f);
      if (f.endsWith('.jsonl')) {
        try {
          fs.mkdirSync(paths.raw, { recursive: true });
          fs.renameSync(full, path.join(paths.raw, f));
        } catch (err) {
          log(okfHome, `staging 잔재 반환 실패 ${path.basename(full)}: code=${safeErrorCode(err)}`);
        }
      } else {
        tryUnlink(full); // *.digest.md 등 파생물은 폐기 (보존 대상 아님)
      }
    }
    try {
      fs.rmdirSync(runDir);
    } catch {
      // no-op
    }
  }
}

// ---------- 1.5 큐 위생 ----------
// sweep 필터(isOkfTestSessionDir, §7-8)는 "앞으로 줍지 않기"만 한다 — 필터가 생기기 전(또는
// 구버전 훅)이 이미 raw/에 넣어버린 오염은 회차마다 유료 배치에 실렸다. 실측(2026-07-16,
// 실번들): raw 165개 중 158개가 okf-smoke-* 테스트 픽스처, 6개가 분석기 자기 세션(cwd=OKF_HOME)
// 이었고, 배치 7회가 전부를 LLM에 태워 NO-OP만 받았다. 격리는 삭제가 아니라 _remove_candidate
// 이동이라 remove_candidate_ttl_days(기본 30일) 동안 가역이다.
// raw 파일명은 `YYYY-MM-DD--<project>--<sessionId>.jsonl`이고 project 자체가 '--'를 포함할 수
// 있으므로(워크트리 경로 등) sessionId는 마지막 '--' 뒤로 잘라낸다.
function projectSegmentOf(filename) {
  const core = filename.replace(/\.jsonl$/, '').replace(/^\d{4}-\d{2}-\d{2}--/, '');
  const sep = core.lastIndexOf('--');
  return sep > 0 ? core.slice(0, sep) : core;
}

function quarantineJunkRaw(okfHome) {
  const paths = okfPaths(okfHome);
  const todayDir = path.join(paths.removeCandidate, localDateString());
  let quarantined = 0;
  for (const f of safeReaddir(paths.raw)) {
    if (!f.endsWith('.jsonl')) continue;
    const full = path.join(paths.raw, f);
    if (!isOkfTestSessionDir(projectSegmentOf(f)) && !transcriptCwdIsOkfHome(full, okfHome)) continue;
    try {
      fs.mkdirSync(todayDir, { recursive: true });
      fs.renameSync(full, path.join(todayDir, f));
      quarantined++;
    } catch (err) {
      log(okfHome, `큐 위생 격리 실패 ${f}: code=${safeErrorCode(err)}`);
    }
  }
  if (quarantined > 0) {
    log(okfHome, `큐 위생: 오염 raw ${quarantined}개 격리(테스트 픽스처/분석기 자기 세션) — LLM 호출 없이 _remove_candidate로 이동`);
  }
  return quarantined;
}

// dirty 작업트리 판정: recoveredFromStaleLock이면 무조건 크래시 잔여물로 간주해 원복(§7-4 코덱스 2차 지적).
// 정상적으로 락을 처음부터 획득했을 때만 "사용자 편집"으로 취급해 lint-gate 후 커밋.
function handleDirtyWorkingTree(okfHome, recoveredFromStaleLock) {
  const home = okfPaths(okfHome).home;
  if (!isDirty(home)) return { ok: true };

  if (recoveredFromStaleLock) {
    log(okfHome, '크래시 잔여물로 판단되는 dirty 작업트리 발견(stale lock 회수됨) — lint 결과 무관 무조건 원복');
    rollback(home);
    return { ok: true };
  }

  const report = runLint(okfHome);
  if (report.errors.length === 0) {
    log(okfHome, '배치 시작 전 사용자 편집 발견, lint 통과 — pre-batch 커밋 후 진행');
    commitAll(home, 'okf: pre-batch: user edits');
    return { ok: true };
  }

  log(okfHome, `배치 시작 전 dirty 작업트리가 lint 실패 — 배치 시작하지 않고 중단. rules=${summarizeLintForLog(report)}`);
  return { ok: false };
}

// ---------- 3. purge ----------
function purgeRemoveCandidate(okfHome, ttlDays) {
  const dir = okfPaths(okfHome).removeCandidate;
  for (const name of safeReaddir(dir)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) continue; // §7-2 안건5: 디렉토리명 날짜 기준(mv가 mtime 보존하므로)
    const dirDate = new Date(`${name}T00:00:00Z`).getTime();
    if (Number.isNaN(dirDate)) continue;
    if (dirDate < Date.now() - ttlDays * 86400_000) {
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
      log(okfHome, `purge: _remove_candidate/${name} (TTL ${ttlDays}일 초과)`);
    }
  }
}

// ---------- 4. raw 스냅샷 ----------
function snapshotRaw(okfHome, runId, maxSessions) {
  const paths = okfPaths(okfHome);
  const files = safeReaddir(paths.raw)
    .filter((f) => f.endsWith('.jsonl'))
    .sort(); // 파일명이 YYYY-MM-DD로 시작 -> 오름차순 정렬 = 오래된 순
  const selected = files.slice(0, maxSessions);
  const stagingDir = path.join(paths.staging, runId);
  fs.mkdirSync(stagingDir, { recursive: true });
  for (const f of selected) {
    fs.renameSync(path.join(paths.raw, f), path.join(stagingDir, f)); // 원자적 — capture 경합 원천 차단(§7-3)
  }
  return { stagingDir, files: selected };
}

// ---------- 5. digest 생성 ----------
function generateDigests(okfHome, stagingDir, files, capKb) {
  const digestPaths = [];
  for (const f of files) {
    const input = path.join(stagingDir, f);
    const output = path.join(stagingDir, f.replace(/\.jsonl$/, '.digest.md'));
    try {
      digestFile(input, output, capKb);
      digestPaths.push({ source: input, digest: output });
    } catch (err) {
      log(okfHome, `digest 생성 실패 ${path.basename(input)}: code=${safeErrorCode(err)} — 원본 텍스트 폴백`);
      try {
        const text = fs.readFileSync(input, 'utf8').slice(0, capKb * 1024);
        fs.writeFileSync(output, text);
        digestPaths.push({ source: input, digest: output });
      } catch (err2) {
        log(okfHome, `digest 폴백도 실패 ${path.basename(input)}: code=${safeErrorCode(err2)} — 이 세션은 이번 배치에서 스킵`);
      }
    }
  }
  return digestPaths;
}

// digest가 비었다 = 그 세션에서 배울 게 없다. LLM에 빈 입력을 보내는 건 순수한 낭비이므로
// 여기서 걸러낸다.
//
// 다만 이건 조용히 넘어가면 안 되는 사건이다(적대적 리뷰 지적): digest 필터가 오작동하거나
// 하네스 transcript 스키마가 바뀌어 진짜 대화까지 boilerplate로 오인되면, 모든 세션이 빈
// digest가 되고 → 전부 "처리 완료"로 archive되고 → 30일 뒤 삭제되어 **지식이 통째로 조용히
// 사라진다**. 그래서 개별 건은 로그로 남기고, 한 회차가 전부 비면 필터 오작동을 의심하라고
// 크게 경고한다. archive 자체는 유지한다 — 정말 잡담뿐인 세션도 흔하고, _remove_candidate의
// 30일 창이 오판에 대한 복구 수단이다.
function partitionEmptyDigests(okfHome, digestPaths) {
  const withContent = [];
  const empty = [];
  for (const dp of digestPaths) {
    let size = 0;
    try {
      size = fs.statSync(dp.digest).size;
    } catch {
      // 크기를 못 재면 내용이 있다고 보고 LLM에 맡긴다 — 여기서 버리는 것보다 안전하다
    }
    (size === 0 ? empty : withContent).push(dp);
  }
  if (empty.length > 0) {
    log(okfHome, `digest가 빈 세션 ${empty.length}개 — LLM 호출 없이 처리 완료로 이동: ${empty.map((d) => path.basename(d.source)).join(', ')}`);
  }
  if (digestPaths.length >= 3 && empty.length === digestPaths.length) {
    log(okfHome, `경고: 이번 회차 ${digestPaths.length}개 세션의 digest가 전부 비었다. 정상적인 경우(잡담뿐인 세션들)일 수도 있으나, digest 필터 오작동이나 transcript 스키마 변경일 수 있으니 lib/digest.mjs를 확인하라. 원본은 _remove_candidate/에 30일간 보관된다.`);
  }
  return { withContent, empty };
}

// 실행당 digest 총량 예산을 적용한다. 예산을 넘는 세션은 raw로 되돌려 다음 회차로 미룬다.
//
// 왜 개수가 아니라 크기인가: 세션 하나가 100바이트일 수도 100KB일 수도 있어서 개수 상한은
// 비용을 전혀 대변하지 못했다. 잡담 10개로 회차를 소진하는 동안 실제 처리량은 0에 가깝고,
// 그 사이 유입은 계속돼 backlog가 영구히 증가했다(실측: pendingAfter가 매 회차 증가).
// 바이트 예산이면 작은 세션은 얼마든지 한 번에 딸려 들어가고, 큰 세션만 회차를 차지한다.
//
// 최소 1개는 항상 통과시킨다 — 단일 세션이 예산보다 크면 영원히 처리 못 하고 raw에 갇힌다
// (digest는 batch_digest_cap_kb로 이미 파일당 상한이 걸려 있으므로 폭주하지 않는다).
function applyDigestBudget(okfHome, digestPaths, budgetBytes) {
  const selected = [];
  const deferred = [];
  let total = 0;
  for (const dp of digestPaths) {
    let size = 0;
    try {
      size = fs.statSync(dp.digest).size;
    } catch {
      // 크기를 못 재면 0으로 두고 통과시킨다 — 어차피 LLM 입력이 거의 없다는 뜻이다
    }
    if (selected.length > 0 && total + size > budgetBytes) {
      deferred.push(dp);
    } else {
      selected.push(dp);
      total += size;
    }
  }
  return { selected, deferred, totalBytes: total };
}

// ---------- 6. 청크별 순차 처리 ----------
function chunkBySize(digestPaths, limitBytes) {
  const chunks = [];
  let current = [];
  let currentSize = 0;
  for (const dp of digestPaths) {
    let size = 0;
    try {
      size = fs.statSync(dp.digest).size;
    } catch {
      // no-op
    }
    if (current.length > 0 && currentSize + size > limitBytes) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(dp);
    currentSize += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

// 번들은 ~/.claude 아래에 산다 — Claude Code는 그 경로의 쓰기를 "sensitive file"로 보고 승인을
// 요구하는데, headless 배치에는 승인할 사람이 없어 분석기의 모든 Write/Edit이 조용히 거부됐다.
// 실측(E3, stream-json 추적): 분석기가 concept 3개를 정확히 쓰려다 전부 차단됐고, 배치는 이를
// "NO-OP(반영할 지식 없음)"으로 오분류했다 — 시스템이 지식을 하나도 못 쌓던 근본 원인.
// 번들 디렉토리 안으로만 한정한 allow 규칙을 주입한다('//' 접두 = 절대경로 규칙). 번들 밖
// 쓰기는 여전히 기본 정책이 막는다.
function buildAnalyzerSettings(bundleDir) {
  const root = bundleDir.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  return JSON.stringify({
    hooks: {},
    permissions: { allow: [`Write(//${root}/**)`, `Edit(//${root}/**)`] },
  });
}

function runClaude(prompt, { cwd, okfHome, timeoutMs, claudeBin, model, effort }) {
  const bin = claudeBin || 'claude';
  const args = [
    // The ingest prompt contains transcript-derived project names. Keep it off the command
    // line so Windows' required shell:true path for claude.cmd cannot reinterpret &, |, %, etc.
    '-p',
    // 리뷰 지적(사후 반영, 실측 확인): --allowedTools는 권한 프롬프트 생략 목록일 뿐
    // 실제 도구 가용성을 제한하지 않는다 — 실측 결과 --allowedTools에서 Bash를 뺐는데도
    // 모델이 Bash를 호출해 그대로 실행됐다. --tools(가용 도구 집합 자체를 제한)가 실제
    // 차단 메커니즘이고, --disallowedTools는 보조로 병기한다(§9 item 4, 이번에 실측 완료).
    '--tools', 'Read,Glob,Grep,Write,Edit',
    '--disallowedTools', 'Bash',
    '--settings', buildAnalyzerSettings(cwd),
    // 실측 발견(사후 반영, 중대): CLAUDE_CONFIG_DIR을 통째로 격리하면 keychain/OAuth 인증까지
    // 함께 격리되어 `claude -p`가 "Not logged in"으로 즉시 실패한다 — API 키 사용자만 우연히
    // 동작하고 (이 프로젝트 사용자 다수가 그럴) OAuth/구독 로그인 사용자는 배치가 원천적으로
    // 작동하지 않는 심각한 결함이었다. `--safe-mode`(훅/플러그인/MCP/커스텀 전부 비활성화하되
    // "Auth, model selection, built-in tools, and permissions work normally")로 교체 —
    // 실측 결과 동일 세션에서 인증은 유지되면서 훅(이 플러그인 자신 포함)은 실제로 발화하지
    // 않음을 확인(OKF_HOME이 생성되지 않음). §7-1의 1차 가드를 이걸로 교체.
    '--safe-mode',
    // Do not create a ~/.claude/projects transcript for the batch itself. The session-id
    // registry and cwd check below remain as backstops for transcripts left by older versions.
    '--no-session-persistence',
    '--permission-mode', 'acceptEdits',
    '--max-turns', '80',
    '--output-format', 'json',
  ];
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  try {
    const output = execFileSync(
      bin,
      args,
      {
        cwd,
        timeout: timeoutMs,
        shell: process.platform === 'win32', // claude.cmd 대응(§2, §9)
        encoding: 'utf8',
        input: prompt,
        env: {
          ...process.env,
          OKF_BATCH: '1', // defense-in-depth (§7-1 2차 가드) — --safe-mode가 불완전할 경우의 백업
        },
      }
    );
    let result;
    try {
      result = JSON.parse(output);
    } catch {
      const error = new Error('claude result parse failed');
      error.code = 'CLAUDE_INVALID_JSON';
      return { ok: false, error };
    }
    try {
      // cwd는 이제 임시 워크스페이스다 — 레지스트리는 반드시 번들(.okf)에 남아야 다음 sweep이 본다.
      rememberBatchSession(okfHome || cwd, result?.session_id);
    } catch {
      // Registry failure is covered by the transcript cwd backstop and must not fail ingest.
    }
    // The live benchmark needs batch cost for an honest break-even calculation. Persist only
    // Claude's numeric usage metadata when explicitly opted in; never write result/errors/session
    // content, which may contain transcript-derived private data.
    if (process.env.OKF_BENCH_USAGE_FILE) {
      try {
        const usagePath = path.resolve(process.env.OKF_BENCH_USAGE_FILE);
        fs.mkdirSync(path.dirname(usagePath), { recursive: true });
        const numericUsage = {};
        for (const [key, value] of Object.entries(result?.usage || {})) {
          if (typeof value === 'number' && Number.isFinite(value)) numericUsage[key] = value;
        }
        const record = {
          stage: prompt.includes('lint 오류 리포트') ? 'repair' : 'ingest',
          models: Object.keys(result?.modelUsage || {}),
          usage: numericUsage,
          duration_ms: Number.isFinite(result?.duration_ms) ? result.duration_ms : null,
          duration_api_ms: Number.isFinite(result?.duration_api_ms) ? result.duration_api_ms : null,
          total_cost_usd: Number.isFinite(result?.total_cost_usd) ? result.total_cost_usd : null,
          num_turns: Number.isFinite(result?.num_turns) ? result.num_turns : null,
        };
        fs.appendFileSync(usagePath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
        securePrivateFile(usagePath);
      } catch {
        // Benchmark telemetry must never affect ingest success or normal diagnostics.
      }
    }
    if (result?.type !== 'result' || result.subtype !== 'success' || result.is_error === true) {
      const error = new Error('claude result incomplete');
      error.code = 'CLAUDE_INCOMPLETE';
      return { ok: false, error };
    }
    return { ok: true, output: result.result ?? '' };
  } catch (err) {
    return { ok: false, error: err };
  }
}

// Persistent logs are privacy-safe diagnostics only. Claude stdout/stderr and raw error
// messages can contain transcript text, tokens, credentials, or absolute paths.
function describeClaudeError(err) {
  const parts = [`code=${safeErrorCode(err)}`];
  if (err.killed) parts.push('killed=true');
  if (err.code === 'ETIMEDOUT' || (err.killed && err.signal === 'SIGTERM')) parts.push('timeout=true');
  if (typeof err.status === 'number') parts.push(`exit=${err.status}`);
  return parts.join(' | ');
}

// 리뷰 지적(사후 반영): String.replace(placeholder, value)에서 value가 문자열이면
// $&/$'/$`/$$ 같은 특수 치환 패턴으로 해석된다 — project 디렉토리 이름(사용자가 통제하는
// cwd basename에서 옴, sanitizeForFilename은 파일시스템 안전 문자만 처리하고 '$'는 그대로
// 둔다)에 '$'가 섞이면 프롬프트 템플릿이 스플라이스되어 깨진다. 치환값을 함수로 감싸면
// 특수 패턴 해석이 아예 발생하지 않는다.
function buildIngestPrompt(pluginRootDir, chunk) {
  const template = fs.readFileSync(path.join(pluginRootDir, 'prompts', 'ingest.md'), 'utf8');
  const digestPaths = chunk.map((c) => c.digest).join('\n');
  const sourcePaths = chunk.map((c) => c.source).join('\n');
  return template
    .replace('{{DIGEST_PATHS}}', () => digestPaths)
    .replace('{{SOURCE_PATHS}}', () => sourcePaths);
}

function buildRepairPrompt(pluginRootDir, report) {
  const template = fs.readFileSync(path.join(pluginRootDir, 'prompts', 'repair.md'), 'utf8');
  const reportText = formatReport(report);
  return template.replace('{{LINT_REPORT}}', () => reportText);
}

function rollbackChunk(okfHome, chunk) {
  const paths = okfPaths(okfHome);
  rollback(paths.home); // repo-root 스코프(§5-5 6e, §7-4) — raw/·_remove_candidate/·.okf/는 .gitignore로 보호됨
  for (const dp of chunk) {
    try {
      fs.mkdirSync(paths.raw, { recursive: true });
      fs.renameSync(dp.source, path.join(paths.raw, path.basename(dp.source)));
    } catch (err) {
      log(okfHome, `청크 원복 중 raw 반환 실패 ${path.basename(dp.source)}: code=${safeErrorCode(err)}`);
    }
    tryUnlink(dp.digest);
  }
}

// ---------- 5.5 분석기 워크스페이스 ----------
// 번들은 ~/.claude 아래에 살고, Claude Code는 그 경로의 모든 쓰기를 "sensitive file"로 차단한다.
// 실측(E3/E5): headless에서 이 차단은 --settings allow 규칙으로도 --allowedTools로도 안 풀리고
// bypassPermissions만 뚫리는데, 그건 분석기를 디스크 전체에 풀어놓는 것이라 채택할 수 없다.
// 그래서 분석기는 임시 워크스페이스(비민감 경로)의 지식 사본을 상대로 작업하고, 드라이버가
// 산출물을 검증해 번들로 반영한다. 부수 효과: 분석기가 raw/·_remove_candidate/·.okf/·.git에
// 물리적으로 접근할 수 없다(SCHEMA 규칙 7이 프롬프트 규범에서 물리 격리로 승격).
const INGEST_INBOX_DIR = '.ingest-inbox';

function copyKnowledgeTree(srcDir, destDir, isRoot) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const e of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (isRoot && (SCAN_EXCLUDE_DIRS.has(e.name) || e.name === INGEST_INBOX_DIR)) continue;
    if (e.name === '.git') continue;
    const s = path.join(srcDir, e.name);
    const d = path.join(destDir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) copyKnowledgeTree(s, d, false);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

function buildAnalyzerWorkspace(okfHome, runId, chunkIndex, chunk) {
  const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), `okf-ingest-${runId}-${chunkIndex}-`));
  copyKnowledgeTree(okfHome, wsRoot, true);
  const inbox = path.join(wsRoot, INGEST_INBOX_DIR);
  fs.mkdirSync(inbox, { recursive: true });
  const wsChunk = chunk.map((dp) => {
    const digest = path.join(inbox, path.basename(dp.digest));
    const source = path.join(inbox, path.basename(dp.source));
    fs.copyFileSync(dp.digest, digest);
    fs.copyFileSync(dp.source, source);
    return { digest, source };
  });
  return { wsRoot, wsChunk };
}

// 워크스페이스 → 번들 반영. 정규 .md 파일만 반영한다: 심링크·스크립트 등 다른 파일형은
// (오염된 digest에 넘어간 분석기의 산출물일 수 있으므로) 번들에 닿지 않고, index.md는
// 드라이버가 재생성하므로 제외, 예약 디렉토리는 루트에서 걸러진다. 삭제는 반영하지 않는다
// (SCHEMA 규칙 4 — 대체는 새 파일 + superseded 산문). 반영 후 lint가 내용 규정을 검사한다.
function applyAnalyzerWorkspace(okfHome, wsRoot) {
  let applied = 0;
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (rel === '' && (SCAN_EXCLUDE_DIRS.has(e.name) || e.name === INGEST_INBOX_DIR)) continue;
      if (e.name === '.git') continue;
      const abs = path.join(dir, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        walk(abs, childRel);
        continue;
      }
      if (!e.isFile() || !e.name.endsWith('.md') || e.name === 'index.md') continue;
      const destAbs = path.join(okfHome, childRel);
      const next = fs.readFileSync(abs);
      let prev = null;
      try {
        prev = fs.readFileSync(destAbs);
      } catch {
        // 신규 파일
      }
      if (prev && Buffer.compare(prev, next) === 0) continue;
      fs.mkdirSync(path.dirname(destAbs), { recursive: true });
      fs.writeFileSync(destAbs, next);
      applied++;
    }
  };
  walk(wsRoot, '');
  return applied;
}

// 리뷰 지적(사후 반영): regenerateIndex/runLint/commitAll 중 하나가 (git commit 실패,
// ENOSPC, index.lock 경합 등으로) 동기 예외를 던지면 이전엔 그 예외가 processChunks 밖으로
// 그대로 전파돼 runBatch()의 try/finally가 락만 정상 해제하고 죽었다 — 다음 실행은 "락이
// 없다" -> 정상 신규 획득(recoveredFromStaleLock=false)으로 보고, 청크 도중 남은 dirty
// 작업트리를 "사용자 편집"으로 오분류할 위험이 있었다(§7-4가 막으려던 바로 그 상황).
// 여기서 즉시 잡아서 그 청크만 롤백하면, 다음 실행이 헷갈릴 dirty 상태 자체가 안 남는다.
function processChunkBody(okfHome, chunk, i, totalChunks, paths, pluginRootDir, config, runId) {
  const { wsRoot, wsChunk } = buildAnalyzerWorkspace(okfHome, runId, i, chunk);
  try {
    const ingestResult = runClaude(buildIngestPrompt(pluginRootDir, wsChunk), {
      cwd: wsRoot,
      okfHome,
      timeoutMs: INGEST_TIMEOUT_MS,
      claudeBin: config.claude_bin,
      model: config.batch_model,
      effort: config.batch_effort,
    });
    if (!ingestResult.ok) {
      log(okfHome, `청크 ${i + 1} ingest 실패: ${describeClaudeError(ingestResult.error)} — 원복 후 배치 중단`);
      return false;
    }

    applyAnalyzerWorkspace(okfHome, wsRoot);

    // 실측(E3): 쓰기가 막히면 분석기는 성공 종료하지만 아무것도 못 쓰고, NO-OP 선언 대신 차단
    // 사정을 설명한다. 이를 NO-OP으로 오분류하면 지식이 조용히 유실된다(30일 뒤 삭제).
    // "무변경 + NO-OP 미선언"은 실패다 — raw를 되돌려 재시도 대상으로 남기고, 상태에 드러낸다.
    if (!isDirty(paths.home) && !/\bNO-OP\b/.test(ingestResult.output)) {
      log(okfHome, `청크 ${i + 1}: 무변경인데 NO-OP 선언 없음 — 쓰기 차단/유실 의심, 원복 후 중단`);
      return false;
    }

    regenerateIndex(okfHome);
    let report = runLint(okfHome);

    if (report.errors.length > 0) {
      log(okfHome, `청크 ${i + 1} lint 실패, repair 1회 시도. rules=${summarizeLintForLog(report)}`);
      const repairResult = runClaude(buildRepairPrompt(pluginRootDir, report), {
        cwd: wsRoot,
        okfHome,
        timeoutMs: REPAIR_TIMEOUT_MS,
        claudeBin: config.claude_bin,
        model: config.batch_model,
        effort: config.batch_effort,
      });
      if (repairResult.ok) {
        applyAnalyzerWorkspace(okfHome, wsRoot);
        regenerateIndex(okfHome);
        report = runLint(okfHome);
      }
    }

    if (report.errors.length > 0) {
      log(okfHome, `청크 ${i + 1} repair 후에도 lint 실패 — 원복. rules=${summarizeLintForLog(report)}`);
      return false;
    }

    // ingest가 "재사용 가치 없음(NO-OP)" 판단으로 아무것도 안 썼을 수 있다 — 이 경우 커밋할 diff가
    // 없으므로(빈 git commit은 에러) 커밋을 스킵하고 raw만 처리 완료로 이동한다.
    if (isDirty(paths.home)) {
      commitAll(paths.home, `okf: ingest ${localDateString()} (chunk ${i + 1}/${totalChunks})`);
      log(okfHome, `청크 ${i + 1} 커밋 완료`);
    } else {
      log(okfHome, `청크 ${i + 1}: NO-OP (반영할 지식 없음)`);
    }
    return true;
  } finally {
    fs.rmSync(wsRoot, { recursive: true, force: true });
  }
}

function processChunks(okfHome, chunks, pluginRootDir, config, runId) {
  const paths = okfPaths(okfHome);
  const todayDir = path.join(paths.removeCandidate, localDateString());

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    log(okfHome, `청크 ${i + 1}/${chunks.length} 처리 시작 (세션 ${chunk.length}개)`);

    let succeeded;
    try {
      succeeded = processChunkBody(okfHome, chunk, i, chunks.length, paths, pluginRootDir, config, runId);
    } catch (err) {
      log(okfHome, `청크 ${i + 1} 처리 중 예외 발생: code=${safeErrorCode(err)} — 크래시로 간주해 원복 후 배치 중단`);
      succeeded = false;
    }

    if (!succeeded) {
      rollbackChunk(okfHome, chunk);
      return { processedChunks: i, aborted: true };
    }

    fs.mkdirSync(todayDir, { recursive: true });
    for (const dp of chunk) {
      fs.renameSync(dp.source, path.join(todayDir, path.basename(dp.source)));
      tryUnlink(dp.digest);
    }
  }
  return { processedChunks: chunks.length, aborted: false };
}

// ---------- 7. last-batch.json 갱신 ----------
function updateLastBatch(okfHome, result) {
  const paths = okfPaths(okfHome);
  const pendingAfter = safeReaddir(paths.raw).filter((f) => f.endsWith('.jsonl')).length;
  writePrivateJsonAtomic(paths.lastBatch, { lastRunEpochMs: Date.now(), lastResult: result, pendingAfter });
  log(okfHome, `배치 종료: ${result} (잔여 raw: ${pendingAfter})`);
}

function runBatch() {
  const okfHome = resolveOkfHome();
  const configWarnings = [];
  const config = readConfig(okfHome, (warning) => configWarnings.push(warning));
  const pluginRootDir = pluginRoot();
  const runId = `${Date.now()}-${process.pid}`;

  const lockResult = acquireLock(okfHome);
  // 다른 배치가 정상 진행 중이거나 경합 상한 초과 — 다음 스케줄에 재시도
  if (!lockResult.acquired) return { acquiredLock: false, freshPending: 0 };

  try {
    log(okfHome, `배치 시작 (recoveredFromStaleLock=${lockResult.recoveredFromStaleLock})`);
    for (const warning of configWarnings) {
      log(okfHome, `config ${warning.key}: ${warning.code} — 기본값 사용`);
    }

    // §5-5 순서(0.락 1.sweep 2.크래시복구 3.purge 4.스냅샷)대로: sweep을 purge보다 먼저 실행한다.
    // 리뷰 지적(사후 반영) — 이전엔 purge가 먼저 돌아서, TTL 경계에 걸린 _remove_candidate
    // 마커를 sweep이 "known" 판정에 쓰기도 전에 지워버려 이미 처리된 세션을 같은 실행 안에서
    // orphan으로 오판해 재수집·재ingest하는 경로가 있었다. §5-4/§7-8: raw 상태와 무관하게
    // 항상 실행 — 유일한 백스톱이 raw-empty 게이트에 막히면 안 됨.
    // The paid synthetic benchmark preserves the user's real Claude auth, so changing
    // CLAUDE_CONFIG_DIR would break login. Its explicit isolation flag prevents real session
    // history from entering the synthetic condition; normal production batches always sweep.
    const skipSweepForBenchmark = process.env.OKF_BENCH_SKIP_SWEEP === '1'
      && Boolean(process.env.OKF_BENCH_USAGE_FILE);
    const swept = skipSweepForBenchmark ? { recovered: 0, freshPending: 0 } : sweepOrphanSessions(okfHome, config);
    if (skipSweepForBenchmark) log(okfHome, 'benchmark isolation: orphan sweep 생략');
    if (swept.recovered > 0) log(okfHome, `sweep: 세션 ${swept.recovered}개 수집`);

    recoverStagingLeftovers(okfHome);
    quarantineJunkRaw(okfHome);

    const dirtyResult = handleDirtyWorkingTree(okfHome, lockResult.recoveredFromStaleLock);
    if (!dirtyResult.ok) {
      updateLastBatch(okfHome, 'aborted: pre-batch dirty tree lint failed');
      return { acquiredLock: true, freshPending: swept.freshPending };
    }

    purgeRemoveCandidate(okfHome, config.remove_candidate_ttl_days);

    const { stagingDir, files } = snapshotRaw(okfHome, runId, config.batch_max_sessions);
    if (files.length === 0) {
      log(okfHome, '처리할 raw 없음(sweep 이후에도) — LLM 호출 없이 조기 종료');
      try {
        fs.rmdirSync(stagingDir);
      } catch {
        // no-op
      }
      updateLastBatch(okfHome, 'noop');
      return { acquiredLock: true, freshPending: swept.freshPending };
    }

    const digestPaths = generateDigests(okfHome, stagingDir, files, config.batch_digest_cap_kb);
    if (digestPaths.length === 0) {
      log(okfHome, 'digest 생성이 전부 실패 — 원본 raw 반환 후 종료');
      const paths = okfPaths(okfHome);
      for (const f of files) {
        try {
          fs.renameSync(path.join(stagingDir, f), path.join(paths.raw, f));
        } catch {
          // no-op
        }
      }
      updateLastBatch(okfHome, 'error: digest generation failed');
      return { acquiredLock: true, freshPending: swept.freshPending };
    }

    // 빈 digest는 LLM에 보내지 않고 바로 처리 완료 처리한다(위 partitionEmptyDigests 참고).
    const { withContent, empty } = partitionEmptyDigests(okfHome, digestPaths);
    const emptyArchiveDir = path.join(okfPaths(okfHome).removeCandidate, localDateString());
    for (const dp of empty) {
      try {
        fs.mkdirSync(emptyArchiveDir, { recursive: true });
        fs.renameSync(dp.source, path.join(emptyArchiveDir, path.basename(dp.source)));
        tryUnlink(dp.digest);
      } catch (err) {
        log(okfHome, `빈 digest 세션 이동 실패 ${path.basename(dp.source)}: code=${safeErrorCode(err)}`);
      }
    }

    // 실행당 비용 상한(크기 기반). 예산 밖 세션은 raw로 되돌려 다음 회차가 가져간다.
    // 설정값 검증: 숫자가 아니면 NaN이 되어 모든 비교가 false가 되고 예산이 통째로 무력화된다
    // (비용 상한이 사라지는 것 — 리뷰 지적). 빈 값/오타는 조용히 넘기지 말고 기본값으로 되돌린다.
    const rawBudget = Number(config.batch_max_digest_kb);
    const budgetKb = Number.isFinite(rawBudget) && rawBudget > 0 ? rawBudget : DEFAULT_CONFIG.batch_max_digest_kb;
    if (budgetKb !== rawBudget) {
      log(okfHome, `batch_max_digest_kb 값이 올바르지 않음(${JSON.stringify(config.batch_max_digest_kb)}) — 기본값 ${budgetKb}KB 사용`);
    }
    const budgetBytes = budgetKb * 1024;
    const { selected, deferred, totalBytes } = applyDigestBudget(okfHome, withContent, budgetBytes);
    if (deferred.length > 0) {
      const paths = okfPaths(okfHome);
      for (const dp of deferred) {
        try {
          fs.renameSync(dp.source, path.join(paths.raw, path.basename(dp.source)));
          tryUnlink(dp.digest);
        } catch (err) {
          log(okfHome, `예산 초과분 raw 반환 실패 ${path.basename(dp.source)}: code=${safeErrorCode(err)}`);
        }
      }
      log(okfHome, `digest 예산 ${budgetKb}KB 초과 — ${selected.length}개 처리, ${deferred.length}개 다음 회차로 이월`);
    }
    log(okfHome, `이번 회차 처리 대상: 세션 ${selected.length}개, digest 합계 ${(totalBytes / 1024).toFixed(1)}KB`);

    const chunks = chunkBySize(selected, CHUNK_BYTE_LIMIT);
    const { processedChunks, aborted } = processChunks(okfHome, chunks, pluginRootDir, config, runId);

    try {
      fs.rmdirSync(stagingDir);
    } catch {
      // no-op (혹시 남은 게 있으면 다음 실행의 크래시 복구 단계가 처리)
    }

    updateLastBatch(okfHome, aborted ? `partial: ${processedChunks}/${chunks.length} chunks` : 'ok');
    return { acquiredLock: true, freshPending: swept.freshPending };
  } finally {
    releaseLock(okfHome);
  }
}

function positiveIntFromEnv(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 링거(유휴 수집의 시계): 방금까지 활동한 세션이 있으면 프로세스가 남아서 유휴 도달을 기다렸다가
// 수집한다. 세션 훅은 다시 안 울릴 수 있으므로(백그라운드 에이전트, 방치된 창) 이 대기가
// "대화가 끝나고 sweep_min_idle_minutes가 지나면 번들에 반영된다"를 보장하는 유일한 시계다.
// 대기 중에는 락을 잡지 않고 판정(probe)만 반복하다가, 유휴에 도달한 세션이 생겼을 때만 전체
// 사이클을 다시 돈다 — last-batch/log가 폴링 간격마다 갈리는 것을 막는다.
async function runLoop() {
  const startedMs = Date.now();
  for (;;) {
    const cycle = runBatch();
    if (!cycle.acquiredLock) return; // 다른 배치가 살아있다 — 링거도 그쪽 몫이다
    if (cycle.freshPending === 0) return;
    const okfHome = resolveOkfHome();
    const config = readConfig(okfHome);
    log(okfHome, `링거: 활동 직후 세션 ${cycle.freshPending}개 — 유휴 도달까지 대기 (poll ${Math.round(LINGER_POLL_MS / 1000)}s)`);
    for (;;) {
      if (Date.now() - startedMs >= LINGER_MAX_MS) {
        log(okfHome, '링거: 최대 수명 도달 — 종료 (다음 세션 훅이 재기동한다)');
        return;
      }
      await sleep(LINGER_POLL_MS);
      const probe = scanOrphanSessions(okfHome, config, false);
      if (probe.recovered > 0) break; // 유휴에 도달한 세션이 생겼다 — 전체 사이클 재실행
      if (probe.freshPending === 0) return; // 기다리던 세션이 사라졌다(제외 판명, 정리 등)
    }
  }
}

await runLoop();
