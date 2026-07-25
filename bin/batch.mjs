import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolveOkfHome, okfPaths, pluginRoot, claudeConfigDir, isOkfTestSessionDir, sanitizeForFilename, SCAN_EXCLUDE_DIRS, BUILTIN_EXCLUDE_CWD } from '../lib/paths.mjs';
import { readInstalledAt } from '../lib/installed-at.mjs';
import { readConfig, DEFAULT_CONFIG } from '../lib/config.mjs';
import { git, isDirty, commitAll, rollback } from '../lib/git.mjs';
import { runLint, formatReport } from '../lib/lint.mjs';
import { regenerateIndex } from '../lib/index-gen.mjs';
import { digestFile } from '../lib/digest.mjs';
import { matchGlob } from '../lib/glob.mjs';
import { acquireLock, releaseLock } from '../lib/lock.mjs';
import { ensurePrivateDir, securePrivateFile, writePrivateJsonAtomic } from '../lib/permissions.mjs';
import { safeErrorCode } from '../lib/status.mjs';
import { stampGenerated, STAMP_UNSTAMPABLE } from '../lib/generated-stamp.mjs';
import { parseFrontmatter } from '../lib/frontmatter.mjs';
import { conceptStatus } from '../lib/trust.mjs';

const SWEEP_LOOKBACK_DAYS = 7; // §7-8: 이보다 오래된 orphan transcript는 sweep 대상에서 제외
// 유휴 판정은 config(sweep_min_idle_minutes, 기본 60분)로 옮겼다 — "마지막 활동 후 N분"이
// 수집의 1차 기준이 됐기 때문이다. 세션 훅은 수집 시점이 아니라 배치를 깨우는 트리거일 뿐이다.
const BATCH_SESSION_RETENTION_MS = 14 * 86400_000;
const BATCH_SESSION_REGISTRY_LIMIT = 2000;
// §5-5 6단계. env 조정은 LINGER_POLL_MS와 같은 관용구다(테스트가 청크 경계를 만들기 위한
// 수단일 뿐 사용자 노브가 아니다). positiveIntFromEnv는 함수 선언이라 호이스팅된다 —
// 화살표 함수로 바꾸면 TDZ로 즉사한다.
const CHUNK_BYTE_LIMIT = positiveIntFromEnv('OKF_CHUNK_BYTE_LIMIT', 300 * 1024);
const INGEST_TIMEOUT_MS = 15 * 60_000;
const REPAIR_TIMEOUT_MS = 15 * 60_000;
// 링거(유휴 대기) 노브 — 기본 5분 간격 확인, 최대 8시간. 테스트가 수 분씩 잠들지 않도록
// env로만 조정한다(사용자 노브는 sweep_min_idle_minutes 쪽이다).
const LINGER_POLL_MS = positiveIntFromEnv('OKF_LINGER_POLL_MS', 5 * 60_000);
const LINGER_MAX_MS = positiveIntFromEnv('OKF_LINGER_MAX_MS', 8 * 3600_000);
const SESSION_ID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
// 커밋은 끝났는데 archive 이동만 실패한 세션을 '미처리'와 구분하는 마커. 이게 없으면 다음
// 회차가 그 세션을 raw로 되돌려 이미 지불한 ingest를 다시 지불한다(T2.2).
const ARCHIVED_MARKER_SUFFIX = '.archived';
// 분석기가 '쓸 게 없었다'를 선언하는 유일한 수단. `.md`로 끝나면 안 된다 —
// applyAnalyzerWorkspace가 .md만 반영하므로 `.okf-noop.md`는 번들에 실린다.
const NOOP_MARKER = '.okf-noop';
// prompts/ingest.md·SCHEMA.md 규칙과 같은 값 — 한쪽만 고치면 계약이 갈린다.
// 드라이버가 시행하는 이유: 프롬프트 규범만으로는 오염된 digest에 넘어간 분석기가 번들 전체를
// 한 회차에 은퇴시킬 수 있다.
const MAX_DEPRECATIONS_PER_CHUNK = 3;

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

// **raw 파일명은 그 자체가 프라이버시 페이로드다**: `YYYY-MM-DD--<cwd의 / 를 - 로 바꾼 것>--<세션UUID>.jsonl`.
// 그래서 basename만 남기는 것으로는 이 파일이 스스로 약속한 "경로·세션ID는 절대 남기지 않는다"를
// 지킬 수 없다(실측: 로그에 클라이언트 디렉토리 전체 경로와 세션 UUID가 그대로 찍혔다).
// 진단에 필요한 것은 "어느 세션인지 구분되는가"뿐이므로, 파일명을 되돌릴 수 없는 짧은 다이제스트로
// 라벨링한다. 같은 파일은 회차가 바뀌어도 같은 라벨을 갖는다(추적 가능성 유지).
function sessionLabel(filePathOrName) {
  const base = path.basename(String(filePathOrName ?? ''));
  return `세션#${createHash('sha256').update(base).digest('hex').slice(0, 8)}`;
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

function readLastBatch(okfHome) {
  try {
    return JSON.parse(fs.readFileSync(okfPaths(okfHome).lastBatch, 'utf8'));
  } catch {
    return null; // 부재·파손은 '이전 상태 없음'과 같다 — 여기서 배치를 막지 않는다
  }
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
// carries cwd — 리뷰 확정(major): 고정 1MB 프리픽스만 보면 그런 transcript에서 cwd를 놓쳐
// 수집 제외(capture_exclude_cwd)가 무력화됐다. 완전한 줄 단위로 최대 32MB까지 훑되, 처음
// 발견되는 cwd에서 즉시 멈춘다(정상 transcript는 첫 몇 KB에서 끝난다). 바이트 단위 carry로
// 청크 경계의 멀티바이트 문자도 깨지지 않는다.
function readTranscriptCwd(transcriptPath) {
  const HARD_CAP = 32 * 1024 * 1024;
  let fd;
  try {
    fd = fs.openSync(transcriptPath, 'r');
  } catch {
    return null;
  }
  try {
    const chunk = Buffer.alloc(1024 * 1024);
    let carry = Buffer.alloc(0);
    let offset = 0;
    const cwdFromLine = (lineBuf) => {
      const line = lineBuf.toString('utf8');
      if (!line.includes('"cwd"')) return null;
      try {
        const row = JSON.parse(line);
        if (typeof row.cwd === 'string') return row.cwd;
      } catch {
        // 깨진/잘린 레코드 — 다음 줄에서 계속. 세션ID 레지스트리가 별도 가드로 남아 있다.
      }
      return null;
    };
    while (offset < HARD_CAP) {
      const bytes = fs.readSync(fd, chunk, 0, chunk.length, offset);
      if (bytes <= 0) break;
      offset += bytes;
      let buf = carry.length > 0 ? Buffer.concat([carry, chunk.subarray(0, bytes)]) : chunk.subarray(0, bytes);
      let start = 0;
      let nl;
      while ((nl = buf.indexOf(0x0a, start)) !== -1) {
        const cwd = cwdFromLine(buf.subarray(start, nl));
        if (cwd != null) return cwd;
        start = nl + 1;
      }
      carry = Buffer.from(buf.subarray(start)); // chunk 버퍼 재사용과의 aliasing 방지 복사
      if (carry.length > HARD_CAP) return null; // 한 줄이 캡을 초과 — 포기
    }
    return carry.length > 0 ? cwdFromLine(carry) : null; // 개행 없이 끝나는 마지막 줄
  } finally {
    fs.closeSync(fd);
  }
}

function transcriptCwdIsOkfHome(transcriptPath, okfHome) {
  const cwd = readTranscriptCwd(transcriptPath);
  return cwd != null && samePath(cwd, okfHome);
}

// ---------- 0. 락 획득 ----------
// 획득/해제는 lib/lock.mjs가 소유한다(락 계약의 단일 원천). /okf:okf-deprecate가 같은 API의
// 두 번째 소비자이고, lib/bootstrap.mjs가 isBundleLocked로 그 계약을 존중한다.

// ---------- 1. 수집 (sweep, §7-8 — 이제 1차 수집 경로) ----------
// 수집 기준은 세션 훅이 아니라 "마지막 활동 후 sweep_min_idle_minutes 유휴 + 크기 성장"이다.
// - 유휴: 사용자·에이전트 대부분은 세션을 명시적으로 끝내지 않으므로, 조용해진 대화만 완결로 본다.
// - 크기: 이미 수집/처리된 세션은 원본이 그보다 커졌을 때만(=대화가 이어졌을 때만) 다시 수집한다.
//   같은 크기면 절대 재수집하지 않는다(불변식). resume발 중간 스냅샷이 세션ID를 "처리됨"으로
//   못박아 후반 대화를 영영 잃던 버그의 해법이기도 하다.
// CLAUDE_CONFIG_DIR 존중(리뷰 지적 사후 반영): OKF_HOME 해석과 같은 루트를 봐야 한다.
// collect=false면 판정만 하고 복사하지 않는다 — 링거의 probe용.
// 설치 하한. 소급된 마커(git-root-commit/last-batch/unknown)에서는 기존 7일 창을 좁히면 안 된다 —
// 루트 커밋이 7일 이내인 번들에서 4~7일 전 미처리 transcript가 **영구** 배제되기 때문이다
// (SWEEP_LOOKBACK_DAYS는 하드 창이라 다음 회차에도 돌아오지 않는다). Math.max로 쓰면
// 문제가 발생하는 구간(설치 3일 된 번들)을 정확히 비켜간다 — 반드시 Math.min이다.
// readInstalledAt은 git 서브프로세스를 띄울 수 있으므로 **회차당 1회**만 부르고 링거 probe에도
// 같은 값을 재사용한다(그러지 않으면 8시간 동안 5분마다 git이 뜬다).
function computeInstallFloorMs(okfHome, config) {
  const windowStartMs = Date.now() - SWEEP_LOOKBACK_DAYS * 86400_000;
  const marker = readInstalledAt(okfHome);
  const rawFloorMs = marker.installedAtEpochMs - config.sweep_backfill_days * 86400_000;
  // 마커를 실제로 읽지 못했으면(쓰기 실패 등) 클램프하지 않는다 — 신규 설치인데 마커만
  // 실패한 경우가 소급 경로를 타고 설치 전 7일치를 끌어오는 구멍을 닫는다(lib/installed-at.mjs).
  const skipClamp = marker.source === 'bootstrap' || marker.persisted === false;
  return skipClamp ? rawFloorMs : Math.min(rawFloorMs, windowStartMs);
}

function scanOrphanSessions(okfHome, config, collect, installFloorMs) {
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

  const windowStartMs = Date.now() - SWEEP_LOOKBACK_DAYS * 86400_000;
  const floorMs = Number.isFinite(installFloorMs) ? installFloorMs : windowStartMs;
  let recovered = 0;
  let freshPending = 0;
  let unknownCwdHeld = 0;
  let outsideWindow = 0;
  let beforeInstall = 0;
  let builtinExcluded = 0;
  const builtinPatternHits = new Set();

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
      if (st.size === 0) continue;
      if (st.mtimeMs < windowStartMs) { outsideWindow++; continue; }
      // 설치 하한: 사용자가 이 플러그인을 넣기 **전**의 대화는 동의 범위 밖이다.
      if (st.mtimeMs < floorMs) { beforeInstall++; continue; }

      const queued = queuedById.get(sessionId);
      const knownSize = Math.max(queued?.size ?? 0, archivedMaxById.get(sessionId) ?? 0);
      if (st.size <= knownSize) continue; // 그 크기까지는 이미 수집/처리됨 — 성장했을 때만 다시 본다

      const cwd = readTranscriptCwd(full);
      if (cwd != null && samePath(cwd, okfHome)) continue; // 분석기 자신의 세션(2차 가드는 세션ID 레지스트리)
      // 내장 제외(OKF 자신의 개발·벤치·테스트 작업 디렉토리)는 위생 필터이므로 fail-closed
      // 분기를 켜지 않는다 — 프라이버시 약속은 사용자 목록(capture_exclude_cwd) 쪽의 것이다.
      if (cwd != null) {
        const builtinIdx = BUILTIN_EXCLUDE_CWD.findIndex((pattern) => matchGlob(cwd, [pattern]));
        if (builtinIdx >= 0) {
          builtinExcluded++;
          builtinPatternHits.add(builtinIdx);
          continue;
        }
      }
      if (config.capture_exclude_cwd.length > 0) {
        // 리뷰 확정(major): 제외는 프라이버시 약속이다 — cwd를 확인할 수 없으면 수집하지
        // 않는 쪽(fail-closed)이 맞다. 모르는 채로 LLM에 실어 보내는 것보다 보류가 낫다.
        if (cwd == null) {
          unknownCwdHeld++;
          continue;
        }
        if (matchGlob(cwd, config.capture_exclude_cwd)) continue; // 사용자 지정 수집 제외
      }

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
        log(okfHome, `sweep 복사 실패 ${sessionLabel(full)}: code=${safeErrorCode(err)}`);
      }
    }
  }
  if (collect && unknownCwdHeld > 0) {
    log(okfHome, `cwd 미확인 transcript ${unknownCwdHeld}개 수집 보류 — 수집 제외 설정이 활성이라 fail-closed`);
  }
  // 진단 로그는 **개수와 설정값만**. 경로·세션ID는 절대 남기지 않는다. 내장 제외는 어떤 규칙이
  // 걸렸는지 알아야 오탐을 신고할 수 있으므로 경로 대신 **패턴 인덱스**를 남긴다.
  if (collect && beforeInstall > 0) {
    log(okfHome, `설치 시각 이전 transcript ${beforeInstall}개 수집 제외 (sweep_backfill_days=${config.sweep_backfill_days})`);
  }
  if (collect && builtinExcluded > 0) {
    log(okfHome, `내장 제외 transcript ${builtinExcluded}개 (패턴 #${[...builtinPatternHits].sort((a, b) => a - b).join(',#')})`);
  }
  return { recovered, freshPending, outsideWindow, beforeInstall, builtinExcluded };
}

function sweepOrphanSessions(okfHome, config, installFloorMs) {
  return scanOrphanSessions(okfHome, config, true, installFloorMs);
}

// ---------- 2. 크래시 복구 ----------
function recoverStagingLeftovers(okfHome) {
  const paths = okfPaths(okfHome);
  for (const runId of safeReaddir(paths.staging)) {
    const runDir = path.join(paths.staging, runId);
    // 마커(.archived) 인지가 .jsonl 분기보다 **먼저** 와야 한다 — 순서를 뒤집으면 else의
    // tryUnlink가 마커를 지워버려 '커밋은 끝났고 이동만 실패했다'는 사실이 사라지고, 짝
    // transcript가 raw로 되돌아가 이미 지불한 세션이 재과금된다.
    const archivedMarkers = new Set(
      safeReaddir(runDir).filter((f) => f.endsWith(ARCHIVED_MARKER_SUFFIX))
        .map((f) => f.slice(0, -ARCHIVED_MARKER_SUFFIX.length))
    );
    const todayDir = path.join(paths.removeCandidate, localDateString());
    for (const f of safeReaddir(runDir)) {
      const full = path.join(runDir, f);
      if (f.endsWith(ARCHIVED_MARKER_SUFFIX)) {
        // **마커를 여기서 지우지 마라.** 짝 파일 이동이 이번에도 실패하면 마커까지 사라져,
        // 다음 회차가 그 세션을 '미처리'로 오판해 raw로 되돌리고 **이미 지불한 ingest를
        // 다시 지불한다** — 마커가 막으려던 바로 그 재과금이다. 짝을 성공적으로 옮긴 뒤에만,
        // 그리고 짝이 아예 없는 고아 마커일 때만 지운다(아래 두 경로).
        if (!fs.existsSync(full.slice(0, -ARCHIVED_MARKER_SUFFIX.length))) tryUnlink(full);
      } else if (f.endsWith('.jsonl') && archivedMarkers.has(f)) {
        // 이미 처리·커밋된 세션이다. raw가 아니라 _remove_candidate로 회수한다(LLM 호출 0회).
        try {
          fs.mkdirSync(todayDir, { recursive: true });
          fs.renameSync(full, path.join(todayDir, f));
          tryUnlink(`${full}${ARCHIVED_MARKER_SUFFIX}`); // 이동에 성공했을 때만 마커를 회수한다
        } catch (err) {
          log(okfHome, `아카이브 재시도 실패 ${sessionLabel(full)}: code=${safeErrorCode(err)} — 마커를 유지해 다음 회차가 다시 시도한다`);
        }
      } else if (f.endsWith('.jsonl')) {
        try {
          fs.mkdirSync(paths.raw, { recursive: true });
          fs.renameSync(full, path.join(paths.raw, f));
        } catch (err) {
          log(okfHome, `staging 잔재 반환 실패 ${sessionLabel(full)}: code=${safeErrorCode(err)}`);
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
      log(okfHome, `큐 위생 격리 실패 ${sessionLabel(f)}: code=${safeErrorCode(err)}`);
    }
  }
  if (quarantined > 0) {
    log(okfHome, `큐 위생: 오염 raw ${quarantined}개 격리(테스트 픽스처/분석기 자기 세션) — LLM 호출 없이 _remove_candidate로 이동`);
  }
  return quarantined;
}

// stale lock 회수 회차의 원복은 "크래시 잔여물을 버린다"인데, 그 판단이 틀렸을 때 되돌릴
// 방법이 없었다. 원복 전에 추적 파일을 _remove_candidate 아래로 복사해 TTL(기본 30일) 동안
// 가역으로 만든다. 반드시 **날짜 디렉토리 아래**여야 purgeRemoveCandidate가 회수한다.
// `--ignored`는 절대 붙이지 마라 — raw/ 전사 원문이 통째로 딸려온다.
function backupDirtyTree(okfHome, runId) {
  const paths = okfPaths(okfHome);
  let entries;
  try {
    entries = git(['status', '--porcelain', '-z'], paths.home).split('\0').filter(Boolean);
  } catch (err) {
    log(okfHome, `원복 전 백업 목록 조회 실패: code=${safeErrorCode(err)}`);
    return 0;
  }
  const destRoot = path.join(paths.removeCandidate, localDateString(), `pre-rollback-${runId}`);
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
  if (copied > 0) log(okfHome, `원복 전 dirty 추적 파일 ${copied}개를 _remove_candidate로 백업`);
  return copied;
}

// dirty 작업트리 판정: recoveredFromStaleLock이면 무조건 크래시 잔여물로 간주해 원복(§7-4 코덱스 2차 지적).
// 정상적으로 락을 처음부터 획득했을 때만 "사용자 편집"으로 취급해 lint-gate 후 커밋.
function handleDirtyWorkingTree(okfHome, recoveredFromStaleLock, runId) {
  const home = okfPaths(okfHome).home;
  if (!isDirty(home)) return { ok: true, report: null };

  if (recoveredFromStaleLock) {
    log(okfHome, '크래시 잔여물로 판단되는 dirty 작업트리 발견(stale lock 회수됨) — lint 결과 무관 무조건 원복');
    backupDirtyTree(okfHome, runId);
    rollback(home);
    return { ok: true, report: null };
  }

  const report = runLint(okfHome);
  if (report.errors.length === 0) {
    log(okfHome, '배치 시작 전 사용자 편집 발견, lint 통과 — pre-batch 커밋 후 진행');
    commitAll(home, 'okf: pre-batch: user edits');
    return { ok: true, report };
  }

  log(okfHome, `배치 시작 전 dirty 작업트리가 lint 실패 — 배치 시작하지 않고 중단. rules=${summarizeLintForLog(report)}`);
  return { ok: false, report };
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
      const stats = digestFile(input, output, capKb);
      digestPaths.push({ source: input, digest: output });
      // 세 가지 조용한 손실을 드러낸다. 로그에는 **basename과 정수만** — 전체 경로 금지.
      if (stats.droppedBytes > 0) {
        log(okfHome, `digest 캡 절단 ${sessionLabel(input)}: ${stats.droppedPct}% 손실 (${Math.round(stats.beforeBytes / 1024)}KB → ${Math.round(stats.afterBytes / 1024)}KB, 캡 ${capKb}KB)`);
      }
      if (stats.skippedLines > 0) {
        log(okfHome, `digest 파싱 실패 줄 ${stats.skippedLines}개 스킵 ${sessionLabel(input)} (전체 ${stats.totalLines}줄)`);
      }
      if (stats.totalLines > 0 && stats.parsedLines === 0) {
        log(okfHome, `경고: ${sessionLabel(input)}의 모든 줄이 파싱 실패 — digest가 비었다. transcript 스키마 변경을 의심하라(원본은 _remove_candidate에 30일 보관)`);
      }
    } catch (err) {
      // 원본 텍스트 폴백을 제거했다: 같은 유출 성질이고(.slice()가 **문자 수** 기준이라
      // 한국어에서 캡의 최대 3배가 나갔다) 필터를 하나도 거치지 않는다.
      // 다만 그냥 스킵하면 staging에 남아 다음 회차 recoverStagingLeftovers가 raw로 되돌리고
      // 같은 실패를 영원히 반복한다. 빈-digest 경로와 같은 관용구로 격리한다 —
      // 원본은 30일 보관되므로 유실이 아니다.
      log(okfHome, `digest 생성 실패 ${sessionLabel(input)}: code=${safeErrorCode(err)} — _remove_candidate로 격리(30일 보관)`);
      try {
        const quarantineDir = path.join(okfPaths(okfHome).removeCandidate, localDateString());
        fs.mkdirSync(quarantineDir, { recursive: true });
        fs.renameSync(input, path.join(quarantineDir, path.basename(input)));
      } catch (err2) {
        log(okfHome, `격리 실패: code=${safeErrorCode(err2)}`);
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
    log(okfHome, `digest가 빈 세션 ${empty.length}개 — LLM 호출 없이 처리 완료로 이동: ${empty.map((d) => sessionLabel(d.source)).join(', ')}`);
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

// 실제로 답한 모델을 고른다(출력 토큰 최다, 동점은 이름 오름차순으로 갈라 결정성 보장).
// config.batch_model로 대신 채우지 마라 — 그건 '오늘의 요청값'이지 '실제로 답한 모델'이 아니다.
function pickModelFromUsage(modelUsage) {
  if (!modelUsage || typeof modelUsage !== 'object') return '';
  const entries = Object.entries(modelUsage).filter(([k]) => typeof k === 'string' && k !== '');
  if (entries.length === 0) return '';
  entries.sort((a, b) => (Number(b[1]?.outputTokens) || 0) - (Number(a[1]?.outputTokens) || 0)
    || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return entries[0][0];
}

const SAFE_ACTOR_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
// OKF v0.2 actor 규약: `<producer>/<version>`. 화이트리스트를 통과 못 하면 unknown이다 —
// 모르는 것을 아는 척 적는 것이 §5.3 신뢰 등급 전체를 무의미하게 만든다.
function actorFor(model) {
  const m = typeof model === 'string' ? model.trim() : '';
  return SAFE_ACTOR_MODEL_RE.test(m) ? `okf-system/${m}` : 'okf-system/unknown';
}

// 이 파일의 날짜 라벨은 예외 없이 localDateString()(로컬)이다. generated.at만은 OKF SPEC
// §5.2가 ISO8601을 요구하므로 UTC다 — 의도된 예외이니 통일하려 들지 마라.
function isoSecondsUtc(d = new Date()) {
  return `${d.toISOString().slice(0, 19)}Z`;
}

// Claude CLI가 --output-format json으로 **이미 무료로** 돌려주는 지출 메타데이터를 호출자에게
// 전달한다. 예전엔 runClaude가 이 값을 손에 쥐고도 {ok, output}만 반환하며 버렸다(T11.1).
// costUsd는 null과 0을 구분한다 — 0 = 안 썼다, null = 얼마 썼는지 모른다.
function extractSpend(result) {
  const usage = {};
  for (const [key, value] of Object.entries(result?.usage || {})) {
    if (typeof value === 'number' && Number.isFinite(value)) usage[key] = value;
  }
  return {
    costUsd: Number.isFinite(result?.total_cost_usd) ? result.total_cost_usd : null,
    usage,
    numTurns: Number.isFinite(result?.num_turns) ? result.num_turns : null,
  };
}

// 표시용은 4자리로 고정한다(테스트가 오차 0을 단언한다). **누계는 4자리로 반올림하면 안 된다** —
// 회차당 $0.00004씩 쓰면 매번 0으로 반올림돼 누계가 영원히 0이 되고 상한이 결코 발동하지 않는다
// (실측: 20회차 $0.0008이 0으로 남았다). 누계는 6자리로 두어 소액이 살아남게 한다.
function roundUsd(v, digits = 4) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

// 누계기는 **가변 객체를 통과**시킨다. processChunks의 catch가 processChunkBody를 삼켜도
// 이미 누적된 지출이 살아남아야 한다 — 지불 후 실패한 회차의 금액이 가장 중요한 값이다.
function createSpendAccumulator() {
  return { costUsd: 0, usage: {}, calls: 0, unknownCalls: 0 };
}

function accrueSpend(acc, claudeResult) {
  if (!acc || !claudeResult) return;
  acc.calls += 1;
  if (Number.isFinite(claudeResult.costUsd)) acc.costUsd += claudeResult.costUsd;
  else acc.unknownCalls += 1; // 파싱 실패·타임아웃 — 호출은 났고 금액만 모른다
  for (const [k, v] of Object.entries(claudeResult.usage || {})) {
    if (typeof v === 'number' && Number.isFinite(v)) acc.usage[k] = (acc.usage[k] || 0) + v;
  }
}

// 당일 누계. 파손·부재는 0으로 본다(fail-open) — 상태 파일 하나 때문에 배치가 영구 정지하면 안 된다.
function readSpendToday(okfHome, today = localDateString()) {
  const prev = readLastBatch(okfHome);
  if (!prev || prev.spendDate !== today || !Number.isFinite(prev.spendTodayUsd)) return 0;
  return prev.spendTodayUsd;
}

// updateLastBatch의 extra 슬롯에 얹을 비용 필드. R3이 소유한 시그니처는 건드리지 않는다.
function spendExtra(okfHome, spend) {
  const today = localDateString();
  const carried = readSpendToday(okfHome, today);
  const runCost = Number.isFinite(spend?.costUsd) ? spend.costUsd : 0;
  return {
    costUsd: roundUsd(runCost),
    // **반올림하며 누적하지 않는다.** 어떤 자릿수를 골라도 그보다 작은 회차 비용은 매번
    // 0으로 접혀 영원히 사라진다(6자리로 올려도 $0.0000004는 같은 운명이다). 정수
    // 마이크로달러로 더한 뒤 마지막에만 나눈다 — 표시용 반올림은 소비자 쪽에서 한다.
    spendTodayUsd: (Math.round(carried * 1e6) + Math.round(runCost * 1e6)) / 1e6,
    spendDate: today,
    tokens: { ...(spend?.usage ?? {}) },
    llmCalls: spend?.calls ?? 0,
    unpricedCalls: spend?.unknownCalls ?? 0,
  };
}

function runClaude(prompt, { cwd, okfHome, timeoutMs, claudeBin, model, effort }) {
  const bin = claudeBin || 'claude';
  // --settings를 JSON 문자열로 명령줄에 실으면 Windows(claude.cmd 대응 shell:true) 경로에서
  // cmd.exe가 따옴표를 벗겨 JSON이 깨진다(CI 실측: "Expected property name or '}' in JSON").
  // 파일로 쓰고 경로만 넘긴다 — 워크스페이스(cwd) 안이라 실행 후 워크스페이스와 함께 삭제된다.
  const settingsPath = path.join(cwd, '.analyzer-settings.json');
  fs.writeFileSync(settingsPath, buildAnalyzerSettings(cwd));
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
    '--settings', settingsPath,
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
      // spend는 JSON.parse 성공 이후 스코프에서만 유효하다 — 여기서 `...spend`를 쓰면 TDZ다.
      // 호출은 났으므로 costUsd: null(= 얼마 썼는지 모른다)로 표시한다.
      return { ok: false, error, costUsd: null, usage: {}, numTurns: null, model: '' };
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
    const spend = extractSpend(result);
    if (process.env.OKF_BENCH_USAGE_FILE) {
      try {
        const usagePath = path.resolve(process.env.OKF_BENCH_USAGE_FILE);
        fs.mkdirSync(path.dirname(usagePath), { recursive: true });
        const record = {
          stage: prompt.includes('lint 오류 리포트') ? 'repair' : 'ingest',
          models: Object.keys(result?.modelUsage || {}),
          usage: spend.usage,
          duration_ms: Number.isFinite(result?.duration_ms) ? result.duration_ms : null,
          duration_api_ms: Number.isFinite(result?.duration_api_ms) ? result.duration_api_ms : null,
          total_cost_usd: spend.costUsd,
          num_turns: spend.numTurns,
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
      // 지불 후 실패다 — 파싱은 됐으므로 금액을 안다. 이 경로가 비용 기록에서 빠지면
      // "지불한 것은 전부 남는다"가 거짓이 된다(실측: 35회 중 최소 10회가 지불 후 롤백).
      return { ok: false, error, ...spend, model: pickModelFromUsage(result?.modelUsage) };
    }
    return { ok: true, output: result.result ?? '', ...spend, model: pickModelFromUsage(result?.modelUsage) };
  } catch (err) {
    return { ok: false, error: err, costUsd: null, usage: {}, numTurns: null, model: '' };
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
  // W6은 '분할' 규범인데 repair는 새 파일을 만들 수 없다(prompts/repair.md). 리포트에 실으면
  // 헛돌거나 파일을 임의로 잘라낸다 — applyAnalyzerWorkspace에는 신규 파일 차단이 없어
  // 그 절단이 실제로 번들에 반영된다. W5(따옴표 씌우기)와 W1/W3는 repair 범위 안이라 그대로
  // 싣는다. 규칙 코드 레지스트리는 lib/lint.mjs 상단.
  const filtered = { errors: report.errors, warnings: report.warnings.filter((w) => w.rule !== 'W6') };
  const reportText = formatReport(filtered);
  return template.replace('{{LINT_REPORT}}', () => reportText);
}

// ---------- 재시도 상한 (무한 재과금 차단) ----------
// 청크가 실패하면 source는 raw/로 돌아가 다음 회차에 **다시 유료로** 처리된다. 재시도 자체는
// 의도된 설계다(일시적 쓰기 차단·락·디스크는 다음 회차에 풀린다). 문제는 **영구히** 실패하는
// 입력이다 — 그 세션 하나가 매 회차 유료 호출을 한 번씩 태우고, 기본 인터벌 1시간에
// `batch_max_usd_per_day: 0`(무제한)이면 하루 24회를 무기한 반복한다. 관측 가능성만으로는
// 못 막는다: 배치는 정의상 사용자가 안 보는 동안 돈다.
// 그래서 세션 단위로 실패 횟수를 세고, 상한을 넘기면 raw/로 되돌리지 않고 _remove_candidate/로
// 격리한다(30일 보관 후 자동 삭제 — 유실이 아니라 유예다).
const MAX_CHUNK_ATTEMPTS = 3;

// 원장은 sessionLabel(해시) → 실패 횟수다. 원본 파일명은 cwd 전체 경로와 세션 UUID를 담으므로
// 상태 파일에도 남기지 않는다(로그·프롬프트와 같은 계약).
function readRetryLedger(paths) {
  try {
    const v = JSON.parse(fs.readFileSync(paths.chunkRetries, 'utf8'));
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return v;
  } catch {
    return {};
  }
}

// 원장을 무한히 키우지 않는다: raw/·staging/ 어디에도 없는 세션의 항목은 이미 처리됐거나
// 격리된 것이므로 버린다. 성공한 세션의 카운트가 남아 다음에 처음 실패한 회차를 3회차로
// 오인하는 것도 이 정리가 막는다.
function saveRetryLedger(paths, ledger) {
  const live = new Set();
  for (const f of safeReaddir(paths.raw)) if (f.endsWith('.jsonl')) live.add(sessionLabel(f));
  // **staging은 `<runId>/` 한 단계 아래에 .jsonl을 담는다.** 여기서 내려가지 않으면 staging이
  // live에 아무것도 기여하지 않고, 회차 시작에 snapshotRaw가 **모든 청크의 소스**를 staging으로
  // 옮기므로 청크 1이 실패하는 순간 아직 처리 대기 중인 뒤 청크의 세션이 전부 '없는 것'으로
  // 판정돼 원장에서 지워진다 → 그 세션들의 attempts가 매 회차 0부터 다시 센다.
  // 독립 검증 실측(5세션 3청크): 마지막 청크의 세션은 카운트가 영원히 1에 머물러 상한에 닿지
  // 않았고, 5회차 뒤에도 raw에 남아 매 회차 재과금됐다 — 무한 재과금을 막으려던 기능이
  // **다중 청크 회차(=비용이 큰 쪽)에서 정확히 안 들었다.**
  for (const runId of safeReaddir(paths.staging)) {
    for (const f of safeReaddir(path.join(paths.staging, runId))) {
      if (f.endsWith('.jsonl')) live.add(sessionLabel(f));
    }
  }
  for (const k of Object.keys(ledger)) if (!live.has(k)) delete ledger[k];
  try {
    writePrivateJsonAtomic(paths.chunkRetries, ledger);
  } catch {
    // 원장을 못 쓰면 상한이 한 회차 느슨해질 뿐이다 — 배치를 세우지는 않는다.
  }
}

function rollbackChunk(okfHome, chunk) {
  const paths = okfPaths(okfHome);
  rollback(paths.home); // repo-root 스코프(§5-5 6e, §7-4) — raw/·_remove_candidate/·.okf/는 .gitignore로 보호됨
  const ledger = readRetryLedger(paths);
  let quarantined = 0;
  for (const dp of chunk) {
    const label = sessionLabel(dp.source);
    // `> 0`을 빼지 마라 — Number.isInteger는 음수를 통과시키고, 손상된 원장에 음수가 들어가면
    // attempts가 영원히 상한 아래에 머물러 상한이 통째로 무력화된다(독립 검증 실측: 값 -1000000).
    // 공격자 통제는 아니지만 부분 쓰기·디스크 손상으로 도달 가능하다.
    const prior = ledger[label];
    const attempts = (Number.isInteger(prior) && prior > 0 ? prior : 0) + 1;
    const giveUp = attempts >= MAX_CHUNK_ATTEMPTS;
    const destDir = giveUp ? path.join(paths.removeCandidate, localDateString()) : paths.raw;
    try {
      fs.mkdirSync(destDir, { recursive: true });
      fs.renameSync(dp.source, path.join(destDir, path.basename(dp.source)));
      if (giveUp) {
        delete ledger[label];
        quarantined++;
        log(okfHome, `세션 ${label}: ${attempts}회 연속 실패 — raw로 되돌리지 않고 _remove_candidate로 격리한다(무한 재과금 차단, 30일 보관)`);
      } else {
        ledger[label] = attempts;
      }
    } catch (err) {
      log(okfHome, `청크 원복 중 반환 실패 ${label}: code=${safeErrorCode(err)}`);
    }
    tryUnlink(dp.digest);
  }
  saveRetryLedger(paths, ledger);
  return quarantined;
}

// 커밋 뒤의 archive 이동은 '이미 지불하고 이미 반영한' 다음에 오는 유일한 무방비 구간이었다
// (T2.2 — 대조군인 빈-digest 이동 경로에는 try/catch가 있었다). 실패해도 지식은 커밋돼 있고,
// 위험은 source가 staging에 남아 다음 회차가 **재과금**하는 것뿐이다. 그래서 실패 시 마커를
// 남겨 '처리 완료됐으나 이동만 실패'로 구분한다 — recoverStagingLeftovers가 그것을 읽는다.
function archiveChunk(okfHome, chunk, todayDir) {
  let allMoved = true;
  // 성공은 재시도 카운트를 지운다. 안 지우면 "1회 실패 → 성공 → (전사가 자라 재수집) → 2회 실패"가
  // 3회로 합산돼 실제로는 두 번만 실패한 세션이 격리된다.
  const ledgerPaths = okfPaths(okfHome);
  const ledger = readRetryLedger(ledgerPaths);
  let ledgerChanged = false;
  for (const dp of chunk) {
    const label = sessionLabel(dp.source);
    if (label in ledger) { delete ledger[label]; ledgerChanged = true; }
  }
  if (ledgerChanged) saveRetryLedger(ledgerPaths, ledger);
  for (const dp of chunk) {
    tryUnlink(dp.digest);
    const dest = path.join(todayDir, path.basename(dp.source));
    try {
      fs.mkdirSync(todayDir, { recursive: true });
      fs.renameSync(dp.source, dest);
      continue;
    } catch (err) {
      log(okfHome, `아카이브 이동 실패(커밋은 완료됨): code=${safeErrorCode(err)} — 복사 폴백 시도`);
    }
    try {
      fs.mkdirSync(todayDir, { recursive: true });
      fs.copyFileSync(dp.source, dest);
      // **삭제 성공을 확인해야 한다.** tryUnlink가 오류를 삼키면 원본이 staging에 남는데
      // 마커는 안 생겨서, 다음 회차가 그것을 '미처리'로 보고 raw로 되돌려 **이미 커밋·복사된
      // 세션을 다시 유료 처리**한다. 복사만 성공한 상태는 '이동 성공'이 아니다.
      fs.unlinkSync(dp.source);
      continue;
    } catch {
      // 마커로 넘어간다
    }
    try {
      fs.writeFileSync(`${dp.source}${ARCHIVED_MARKER_SUFFIX}`, '', { mode: 0o600 });
      log(okfHome, '아카이브 재시도 마커 기록 — 다음 회차가 LLM 호출 없이 이동만 재시도한다');
    } catch (err) {
      log(okfHome, `아카이브 마커 기록 실패: code=${safeErrorCode(err)}`);
    }
    allMoved = false;
  }
  return allMoved;
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
  // **inbox 사본은 원본 파일명을 쓰지 않는다.** raw 파일명은
  // `YYYY-MM-DD--<cwd의 /를 -로 치환>--<세션UUID>.jsonl`이라, 그대로 두면 로그에서 지운
  // 것과 **같은 식별자**(다른 프로젝트의 전체 경로 + 세션 UUID)가 프롬프트에 실려 유료 LLM으로
  // 나간다. 대화 본문이 어차피 가는 것과는 다른 문제다 — 이건 메타데이터이고, 분석기가 그
  // 문자열을 concept에 적으면 index를 거쳐 게이트까지 간다(독립 검증이 실측으로 재현).
  // 드라이버는 dp로 원본 매핑을 이미 들고 있으므로 이름은 버려도 된다.
  const wsChunk = chunk.map((dp) => {
    const label = sessionLabel(dp.source);
    const digest = path.join(inbox, `${label}.digest.md`);
    const source = path.join(inbox, `${label}.jsonl`);
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
function applyAnalyzerWorkspace(okfHome, wsRoot, stamp = null, chunkBudget = { deprecations: 0 }) {
  let applied = 0;
  let blocked = 0;
  let stamped = 0;
  let blockedDeprecations = 0;
  let blockedUnstampable = 0;
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
      // 리뷰 확정(minor): 규칙서(SCHEMA.md)와 okf_seed 시드는 "수정 금지"가 프롬프트 규범으로만
      // 있었다 — 오염된 digest에 넘어간 분석기가 규칙서를 영구 교체할 수 있는 경계 구멍이라
      // 여기 드라이버가 시행한다. SCHEMA는 bootstrap 버전 동기화가 유일한 갱신 경로다.
      if (childRel === 'SCHEMA.md' || (prev && /^[ \t]*(?:"okf_seed"|'okf_seed'|okf_seed)[ \t]*:\s*true\b/m.test(prev.subarray(0, 2048).toString('utf8')))) {
        blocked++;
        continue;
      }
      // 은퇴 상한. prev가 없는 신규 파일은 세지 않는다 — 기존 지식을 지우는 행위가 아니다.
      // 차단은 기존 blocked 관용구와 동일하게 '파일 전체를 반영하지 않는다'이다: 바이트 수술로
      // status 줄만 되돌리면 워크스페이스(abs)와 번들(destAbs)의 바이트가 갈려, 2차 호출에서
      // 무관한 파일까지 전부 재기록된다.
      // 이 블록은 반드시 위 Buffer.compare **뒤**여야 한다 — 변경 없는 파일까지 파싱하면
      // 매 회차 전 번들을 파싱한다.
      if (prev
        && conceptStatus(parseFrontmatter(prev.toString('utf8')).data) !== 'deprecated'
        && conceptStatus(parseFrontmatter(next.toString('utf8')).data) === 'deprecated') {
        chunkBudget.deprecations += 1;
        if (chunkBudget.deprecations > MAX_DEPRECATIONS_PER_CHUNK) {
          blockedDeprecations++;
          continue;
        }
      }
      // 스탬핑은 반드시 (a) 위 Buffer.compare 동일성 검사 **뒤**, (b) SCHEMA/okf_seed 차단
      // 게이트 **뒤**다. 앞에 두면 모든 파일이 매 회차 재기록돼 유실 백스톱이 영구 무력화되고,
      // 차단 게이트 앞에 두면 규칙서와 시드가 스탬프된다.
      // log.md 제외를 빼지 마라 — 지금은 프론트매터가 없어 우연히 안전하지만, 누군가
      // log.md에 프론트매터를 붙이는 순간 조용히 깨진다.
      let out = next;
      let stampSkip = null;
      if (stamp && e.name !== 'log.md') {
        // trustExisting은 **prev에 이미 generated가 있었는가**로 판정한다. `prev !== null`만
        // 보면 구멍이 남는다: 기존 파일을 고치면서 분석기가 `by: human:...`을 새로 써넣으면
        // "번들에 있던 남의 generated"로 둔갑해 스탬프를 회피하고 위조값이 그대로 커밋된다
        // (독립 검증이 무따옴표·flow·작은따옴표 3형태로 재현했다). next 기준으로 판정하면
        // 반대 방향으로 같은 회피가 열리므로, 기준은 언제나 prev의 **내용**이다.
        const prevHadGenerated = prev !== null
          && Object.hasOwn(parseFrontmatter(prev.toString('utf8')).data ?? {}, 'generated');
        const stampedText = stampGenerated(next.toString('utf8'), stamp,
          { trustExisting: prevHadGenerated, onSkip: (reason) => { stampSkip = reason; } });
        if (stampedText !== null) {
          out = Buffer.from(stampedText, 'utf8');
          stamped++;
          // 이 함수는 ingest 후와 repair 후 같은 wsRoot를 두 번 본다. 워크스페이스에 같은
          // 바이트를 되쓰지 않으면 2차 호출에서 스탬프된 파일 전부가 Buffer.compare != 0이
          // 되어, repair가 건드리지도 않은 파일의 at까지 새 시각으로 갈아엎힌다.
          try { fs.writeFileSync(abs, out); } catch { /* 번들 반영은 이미 안전하다 */ }
        }
      }
      // **fail-closed**: 스탬핑이 '남의 generated 존중' 이외의 이유로 실패했다면 그 파일은
      // 반영하지 않는다. 정규식이 모든 유효 YAML 표기를 커버한다는 가정에 안전을 걸면,
      // 그 가정이 깨지는 순간(`"generated" :`, 선행 공백, flow 형태 …) 위조된 출처가 조용히
      // 번들에 실린다 — 독립 검증이 정확히 그 경로를 재현했다. 못 찍으면 안 싣는다.
      if (stampSkip === STAMP_UNSTAMPABLE) {
        blockedUnstampable++;
        continue;
      }
      fs.mkdirSync(path.dirname(destAbs), { recursive: true });
      fs.writeFileSync(destAbs, out);
      applied++;
    }
  };
  walk(wsRoot, '');
  if (blocked > 0) {
    log(okfHome, `분석기 산출물 반영 거부 ${blocked}건 — SCHEMA.md/okf_seed 시드 수정 시도`);
  }
  // 숫자만 남긴다 — 파일명·스탬프 값은 로그에 싣지 않는다. N이 그 회차 변경 파일 수보다
  // 크면 전 번들 일괄 스탬핑(= 유실 백스톱 무력화)이라는 뜻이니 즉시 롤백하라.
  if (stamped > 0) log(okfHome, `generated 스탬프 ${stamped}건`);
  if (blockedUnstampable > 0) {
    log(okfHome, `출처 스탬프 불가로 반영 거부 ${blockedUnstampable}건 — frontmatter 표기를 확인하라`);
  }
  if (blockedDeprecations > 0) {
    log(okfHome, `은퇴 상한(청크당 ${MAX_DEPRECATIONS_PER_CHUNK}건) 초과 — ${blockedDeprecations}건 반영 거부`);
  }
  // blocked를 함께 돌려준다 — NO-OP 판정이 "쓴 게 없다"와 "쓰려다 거부당했다"를 구분해야
  // 하기 때문이다. 기존 호출부 두 곳은 반환값을 버리고 있었으므로 파급은 0이다.
  return { applied, blocked };
}

// 리뷰 지적(사후 반영): regenerateIndex/runLint/commitAll 중 하나가 (git commit 실패,
// ENOSPC, index.lock 경합 등으로) 동기 예외를 던지면 이전엔 그 예외가 processChunks 밖으로
// 그대로 전파돼 runBatch()의 try/finally가 락만 정상 해제하고 죽었다 — 다음 실행은 "락이
// 없다" -> 정상 신규 획득(recoveredFromStaleLock=false)으로 보고, 청크 도중 남은 dirty
// 작업트리를 "사용자 편집"으로 오분류할 위험이 있었다(§7-4가 막으려던 바로 그 상황).
// 여기서 즉시 잡아서 그 청크만 롤백하면, 다음 실행이 헷갈릴 dirty 상태 자체가 안 남는다.
// NO-OP 선언을 자유 텍스트 완전일치에서 워크스페이스 마커 파일로 옮긴다. 실측: no-op 회차
// 25번 중 9번(36%)이 프로토콜대로 정확히 'NO-OP' 한 줄을 내지 못해 실패로 오분류됐고,
// 3회 연속 실패 구간까지 있었다. 도구 호출(파일 생성)은 문장 생성보다 훨씬 안정적이다.
// 텍스트 폴백은 하위호환으로 남기되 **완전일치**를 유지한다(substring이면 설명문 속 언급이
// 선언으로 오인돼 지식이 조용히 archive된다).
//
// **트레이드오프를 알고 쓴다.** 라이브 실측(2026-07-25, 하루 4회차): 2회가 "무변경 + 선언 없음"으로
// 걸려 raw가 보존됐고, 같은 입력의 3번째 시도가 그제서야 실제 지식을 커밋했다 — 즉 그 두 번은
// '기록할 게 없어서'가 아니라 **기록해야 할 사실을 놓친 것**이었고, 프로토콜 미준수가 우연히
// 안전망 역할을 했다. 준수율을 올리면 모델의 *잘못된* NO-OP 판단도 그만큼 확실하게 archive된다.
// 이 판정을 되돌리는 대신 두 가지로 막는다: (a) applied/blocked와의 AND 조건(쓰려다 거부당한
// 회차는 절대 NO-OP이 아니다), (b) 아래 noopChunks 계수로 "ok인데 산출물 0"을 상태에 드러낸다.
// 원본은 _remove_candidate에 30일 남으므로 오판이 즉시 유실은 아니다.
function declaredNoOp(wsRoot, output) {
  try {
    if (fs.existsSync(path.join(wsRoot, NOOP_MARKER))) return true;
  } catch {
    // 텍스트 폴백으로
  }
  return output.trim() === 'NO-OP';
}

function processChunkBody(okfHome, chunk, i, totalChunks, paths, pluginRootDir, config, runId, spend) {
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
    // 누적은 반드시 `if (!ok) return` **앞**이다 — 지불 후 실패한 회차의 금액이 가장 중요하다.
    accrueSpend(spend, ingestResult);
    if (!ingestResult.ok) {
      // claude를 아예 못 부르는 상태라면 남은 청크도 15분씩 타임아웃만 태운다 — 치명 실패다.
      log(okfHome, `청크 ${i + 1} ingest 실패: ${describeClaudeError(ingestResult.error)} — 원복 후 배치 중단`);
      return { ok: false, fatal: true };
    }

    // at은 **호출당 1개**다 — 같은 LLM 호출에서 나온 파일들이 같은 시각을 공유해야 정직하고
    // 테스트에서도 결정적이다.
    const ingestStamp = { by: actorFor(ingestResult.model), at: isoSecondsUtc() };
    // 예산 객체는 청크당 **한 번만** 만든다 — ingest와 repair가 각자 만들면 3 + 3 = 6건으로 샌다.
    const chunkBudget = { deprecations: 0 };
    const applyResult = applyAnalyzerWorkspace(okfHome, wsRoot, ingestStamp, chunkBudget);

    // 실측(E3): 쓰기가 막히면 분석기는 성공 종료하지만 아무것도 못 쓰고, NO-OP 선언 대신 차단
    // 사정을 설명한다. 이를 NO-OP으로 오분류하면 지식이 조용히 유실된다(30일 뒤 삭제).
    //
    // NO-OP 선언은 '쓸 게 없었다'일 때만 유효하다. 분석기가 실제로 무언가를 썼는데(applied>0)
    // 또는 게이트가 그 산출물을 거부했는데(blocked>0) 마커가 있으면, 그건 NO-OP이 아니라
    // 실패이거나 오염된 digest의 지시를 따른 것이다 — 마커만 믿으면 지식이 조용히 archive된다.
    const noOpDeclared = applyResult.applied === 0 && applyResult.blocked === 0
      && declaredNoOp(wsRoot, ingestResult.output);
    if (!isDirty(paths.home) && !noOpDeclared) {
      log(okfHome, `청크 ${i + 1}: 무변경인데 NO-OP 마커·선언 모두 없음 — 쓰기 차단/유실 의심, 이 청크만 건너뛴다`);
      return { ok: false, fatal: false };
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
      accrueSpend(spend, repairResult);
      if (repairResult.ok) {
        // 폴백을 빼면 repair가 만든 파일이 같은 모델인데도 unknown이 된다.
        const repairStamp = { by: actorFor(repairResult.model || ingestResult.model), at: isoSecondsUtc() };
        applyAnalyzerWorkspace(okfHome, wsRoot, repairStamp, chunkBudget);
        regenerateIndex(okfHome);
        report = runLint(okfHome);
      }
    }

    if (report.errors.length > 0) {
      log(okfHome, `청크 ${i + 1} repair 후에도 lint 실패 — 원복. rules=${summarizeLintForLog(report)}`);
      return { ok: false, fatal: false };
    }

    // ingest가 "재사용 가치 없음(NO-OP)" 판단으로 아무것도 안 썼을 수 있다 — 이 경우 커밋할 diff가
    // 없으므로(빈 git commit은 에러) 커밋을 스킵하고 raw만 처리 완료로 이동한다.
    const committed = isDirty(paths.home);
    if (committed) {
      commitAll(paths.home, `okf: ingest ${localDateString()} (chunk ${i + 1}/${totalChunks})`);
      log(okfHome, `청크 ${i + 1} 커밋 완료`);
    } else {
      log(okfHome, `청크 ${i + 1}: NO-OP (반영할 지식 없음)`);
    }
    return { ok: true, fatal: false, noop: !committed };
  } finally {
    fs.rmSync(wsRoot, { recursive: true, force: true });
  }
}

// 청크는 독립 트랜잭션이다. 예전엔 한 청크의 비치명 실패(NO-OP 판정 실패, repair 후 lint
// 실패)가 배치 전체를 중단시켜 뒤 청크의 세션이 통째로 raw에 남았다 — 실측 2청크 픽스처에서
// 처리 0/2, archive 0, raw 2. 치명 실패(claude 자체를 못 부름)만 중단하고 나머지는 건너뛴다.
// 이월은 git을 건드리지 않는다. rollbackChunk를 부르면 이미 커밋된 앞 청크와 무관한 변경까지
// 날린다 — 이월은 실패가 아니라 '다음 회차에 하겠다'이다.
function returnChunkToRaw(okfHome, chunk) {
  const paths = okfPaths(okfHome);
  for (const dp of chunk) {
    try {
      fs.mkdirSync(paths.raw, { recursive: true });
      fs.renameSync(dp.source, path.join(paths.raw, path.basename(dp.source)));
    } catch (err) {
      log(okfHome, `이월 raw 반환 실패 ${sessionLabel(dp.source)}: code=${safeErrorCode(err)}`);
    }
    tryUnlink(dp.digest);
  }
}

function processChunks(okfHome, chunks, pluginRootDir, config, runId, spend, capUsd, spendBeforeUsd) {
  const paths = okfPaths(okfHome);
  const todayDir = path.join(paths.removeCandidate, localDateString());

  let succeededChunks = 0;
  let skippedChunks = 0;
  // "ok인데 산출물 0"을 상태에 드러내기 위한 계수. lastResult만으로는 정상 NO-OP과
  // 자기증식 루프(sweep 오분류)를 구분할 수 없다 — 실측으로 사용자를 혼란시킨 지점이다.
  let noopChunks = 0;
  // 상한 초과로 격리된 세션 수. 로그만으로는 사용자가 배치 로그를 열어야 알 수 있는데,
  // 이건 "지식이 반영되지 않고 폐기 예약됐다"는 사실이라 상태 파일에 드러나야 한다.
  let quarantinedSessions = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    // 진입 게이트를 통과한 회차는 최소 1청크는 처리해야 backlog가 줄어든다
    // (applyDigestBudget의 '최소 1개는 항상 통과'와 같은 논리) — 그래서 i > 0에서만 재검사한다.
    if (i > 0 && capUsd > 0 && spendBeforeUsd + spend.costUsd >= capUsd) {
      log(okfHome, `일일 지출 상한 도달 ($${roundUsd(spendBeforeUsd + spend.costUsd).toFixed(4)} / $${capUsd}) — 남은 청크 ${chunks.length - i}개를 다음 회차로 이월`);
      for (let j = i; j < chunks.length; j++) returnChunkToRaw(okfHome, chunks[j]);
      return { succeededChunks, skippedChunks, quarantinedSessions, aborted: true, reason: 'spend-cap' };
    }
    log(okfHome, `청크 ${i + 1}/${chunks.length} 처리 시작 (세션 ${chunk.length}개)`);

    let result;
    try {
      result = processChunkBody(okfHome, chunk, i, chunks.length, paths, pluginRootDir, config, runId, spend);
    } catch (err) {
      log(okfHome, `청크 ${i + 1} 처리 중 예외 발생: code=${safeErrorCode(err)} — 크래시로 간주해 원복 후 배치 중단`);
      result = { ok: false, fatal: true };
    }

    if (!result.ok) {
      quarantinedSessions += rollbackChunk(okfHome, chunk);
      if (result.fatal) {
        return { succeededChunks, skippedChunks, quarantinedSessions, aborted: true, reason: 'fatal' };
      }
      skippedChunks++;
      log(okfHome, `청크 ${i + 1} 건너뜀 — 나머지 청크는 계속 처리한다`);
      continue;
    }

    archiveChunk(okfHome, chunk, todayDir);
    succeededChunks++;
    if (result.noop) noopChunks++;
  }
  return {
    succeededChunks,
    skippedChunks,
    noopChunks,
    quarantinedSessions,
    aborted: skippedChunks > 0,
    reason: skippedChunks > 0 ? 'skipped' : null,
  };
}

// ---------- 7. last-batch.json 갱신 ----------
// extra는 이 함수의 유일한 확장 슬롯이다(비용 필드·blocked 등). 시그니처를 늘리지 마라 —
// 인자 순서가 갈리면 호출부마다 다른 객체를 다른 자리에 넘기게 된다.
function updateLastBatch(okfHome, result, extra = {}) {
  const paths = okfPaths(okfHome);
  const pendingAfter = safeReaddir(paths.raw).filter((f) => f.endsWith('.jsonl')).length;
  // blocked는 매 회차 명시적으로 null로 덮는다 — 해소된 뒤에도 옛 값이 남으면
  // /okf:okf-status가 이미 고쳐진 lint 실패를 영구히 보고한다.
  writePrivateJsonAtomic(paths.lastBatch, {
    lastRunEpochMs: Date.now(), lastResult: result, pendingAfter, blocked: null, ...extra,
  });
  // 비용은 숫자만 남긴다 — 경로·세션ID·모델 응답은 로그에 절대 싣지 않는다.
  const spendNote = Number.isFinite(extra.costUsd) && extra.llmCalls > 0
    ? `, 비용 $${extra.costUsd.toFixed(4)} / 오늘 누계 $${Number(extra.spendTodayUsd ?? 0).toFixed(4)} (호출 ${extra.llmCalls}회)`
    : '';
  log(okfHome, `배치 종료: ${result} (잔여 raw: ${pendingAfter}${spendNote})`);
}

function runBatch() {
  const okfHome = resolveOkfHome();
  const configWarnings = [];
  const config = readConfig(okfHome, (warning) => configWarnings.push(warning));
  const pluginRootDir = pluginRoot();
  const runId = `${Date.now()}-${process.pid}`;

  const lockResult = acquireLock(okfHome, 'batch', { onLog: (m) => log(okfHome, m) });
  // 다른 홀더(배치 또는 /okf:okf-deprecate)가 정상 진행 중이거나 경합 상한 초과 — 다음 스케줄에 재시도
  if (!lockResult.acquired) return { acquiredLock: false, freshPending: 0 };

  try {
    log(okfHome, `배치 시작 (recoveredFromStaleLock=${lockResult.recoveredFromStaleLock})`);
    // 회차 지출 누계기. 모든 종료 경로가 이것을 spendExtra로 상태 파일에 남긴다 —
    // 지불 후 실패한 회차의 금액이 기록에서 빠지면 "지불한 것은 전부 남는다"가 거짓이 된다.
    const spend = createSpendAccumulator();
    for (const warning of configWarnings) {
      log(okfHome, `config ${warning.key}: ${warning.code} — 기본값 사용`);
    }

    // 순서가 중요하다: staging 잔재 반환 → 큐 위생 → sweep.
    // 리뷰 확정(major): sweep이 staging 잔재보다 먼저 돌면, 직전 배치가 청크 실패로 중단되며
    // staging에 남긴 세션을 sweep의 크기 지도(queuedById)가 못 보고 knownSize=0으로 판정해
    // 같은 크기여도 재수집한다 — 같은 세션이 한 회차에 두 파일로 중복 유료 ingest됐다.
    // 잔재를 먼저 raw로 되돌리면 sweep이 그것을 큐 사본으로 보고 크기 비교가 성립한다.
    recoverStagingLeftovers(okfHome);
    quarantineJunkRaw(okfHome);

    // §5-5 순서: sweep을 purge보다 먼저 실행한다. 리뷰 지적(사후 반영) — 이전엔 purge가 먼저
    // 돌아서, TTL 경계에 걸린 _remove_candidate 마커를 sweep이 "known" 판정에 쓰기도 전에
    // 지워버려 이미 처리된 세션을 같은 실행 안에서 재수집·재ingest하는 경로가 있었다.
    // §5-4/§7-8: raw 상태와 무관하게 항상 실행 — 유일한 백스톱이 raw-empty 게이트에 막히면 안 됨.
    // The paid synthetic benchmark preserves the user's real Claude auth, so changing
    // CLAUDE_CONFIG_DIR would break login. Its explicit isolation flag prevents real session
    // history from entering the synthetic condition; normal production batches always sweep.
    const skipSweepForBenchmark = process.env.OKF_BENCH_SKIP_SWEEP === '1'
      && Boolean(process.env.OKF_BENCH_USAGE_FILE);
    const installFloorMs = computeInstallFloorMs(okfHome, config);
    const swept = skipSweepForBenchmark
      ? { recovered: 0, freshPending: 0 }
      : sweepOrphanSessions(okfHome, config, installFloorMs);
    if (skipSweepForBenchmark) log(okfHome, 'benchmark isolation: orphan sweep 생략');
    if (swept.recovered > 0) log(okfHome, `sweep: 세션 ${swept.recovered}개 수집`);

    const dirtyResult = handleDirtyWorkingTree(okfHome, lockResult.recoveredFromStaleLock, runId);
    if (!dirtyResult.ok) {
      // pre-batch lint 실패는 배치를 **영구 정지**시키는데, 지금까지 그 사실이 어디에도
      // 구조화돼 남지 않아 사용자가 알 방법이 없었다. since는 최초 발생 시각을 유지한다.
      // lint message는 절대 넣지 마라 — js-yaml 파싱 에러 메시지는 위반한 YAML 원문을 포함한다.
      // 규칙 코드와 파일 경로까지가 상한이고, 그것도 0600 상태 파일에만 들어간다.
      const prev = readLastBatch(okfHome);
      const since = prev?.blocked?.kind === 'pre-batch-lint' ? prev.blocked.since : Date.now();
      updateLastBatch(okfHome, 'aborted: pre-batch dirty tree lint failed', {
        ...spendExtra(okfHome, spend),
        blocked: {
          kind: 'pre-batch-lint',
          since,
          rules: summarizeLintForLog(dirtyResult.report),
          files: [...new Set(dirtyResult.report.errors.map((e) => e.file))].slice(0, 20),
        },
      });
      return { acquiredLock: true, freshPending: swept.freshPending };
    }

    purgeRemoveCandidate(okfHome, config.remove_candidate_ttl_days);

    // 일일 지출 상한. 위치가 요점이다 — 수집(sweep, 무료)은 이미 끝났다. 상한이 수집까지
    // 막으면 7일 창(SWEEP_LOOKBACK_DAYS)을 넘긴 transcript가 영구 소실된다.
    // normalizeConfig(lib/config.mjs)가 이미 잘못된 값을 기본값으로 되돌린 뒤이므로 여기서
    // 재검증하지 않는다(그 분기는 결코 발화하지 않는 죽은 코드다). 0 = 무제한.
    const capUsd = config.batch_max_usd_per_day;
    const spendBeforeUsd = readSpendToday(okfHome);
    if (capUsd > 0 && spendBeforeUsd >= capUsd) {
      log(okfHome, `일일 지출 상한 도달 ($${spendBeforeUsd.toFixed(4)} / $${capUsd}) — LLM 호출 없이 종료`);
      updateLastBatch(okfHome, 'skipped: daily spend cap', spendExtra(okfHome, spend));
      // freshPending 0으로 링거를 끝낸다 — 5분마다 이 경로를 밟으면 상태 파일을 96번 다시 쓴다.
      return { acquiredLock: true, freshPending: 0 };
    }

    const { stagingDir, files } = snapshotRaw(okfHome, runId, config.batch_max_sessions);
    if (files.length === 0) {
      log(okfHome, '처리할 raw 없음(sweep 이후에도) — LLM 호출 없이 조기 종료');
      try {
        fs.rmdirSync(stagingDir);
      } catch {
        // no-op
      }
      updateLastBatch(okfHome, 'noop', spendExtra(okfHome, spend));
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
      updateLastBatch(okfHome, 'error: digest generation failed', spendExtra(okfHome, spend));
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
        log(okfHome, `빈 digest 세션 이동 실패 ${sessionLabel(dp.source)}: code=${safeErrorCode(err)}`);
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
          log(okfHome, `예산 초과분 raw 반환 실패 ${sessionLabel(dp.source)}: code=${safeErrorCode(err)}`);
        }
      }
      log(okfHome, `digest 예산 ${budgetKb}KB 초과 — ${selected.length}개 처리, ${deferred.length}개 다음 회차로 이월`);
    }
    log(okfHome, `이번 회차 처리 대상: 세션 ${selected.length}개, digest 합계 ${(totalBytes / 1024).toFixed(1)}KB`);

    const chunks = chunkBySize(selected, CHUNK_BYTE_LIMIT);
    const { succeededChunks, aborted, reason, noopChunks, quarantinedSessions } = processChunks(
      okfHome, chunks, pluginRootDir, config, runId, spend, capUsd, spendBeforeUsd);

    try {
      fs.rmdirSync(stagingDir);
    } catch {
      // no-op (혹시 남은 게 있으면 다음 실행의 크래시 복구 단계가 처리)
    }

    const outcome = !aborted
      ? 'ok'
      : (reason === 'spend-cap'
        ? `partial: ${succeededChunks}/${chunks.length} chunks (daily spend cap)`
        : `partial: ${succeededChunks}/${chunks.length} chunks`);
    // chunks{total, committed, noop, skipped}: lastResult가 'ok'여도 산출물이 0일 수 있다.
    // 그 구분이 없어서 사용자가 정상 NO-OP과 sweep 자기증식 루프를 구별하지 못했다(실측).
    updateLastBatch(okfHome, outcome, {
      ...spendExtra(okfHome, spend),
      chunks: {
        total: chunks.length,
        committed: succeededChunks - noopChunks,
        noop: noopChunks,
        skipped: chunks.length - succeededChunks,
        // 상한(MAX_CHUNK_ATTEMPTS)을 넘겨 격리된 세션 수. 0이면 필드는 그대로 0이다 —
        // 없애면 구버전 상태 파일과 구별이 안 된다.
        quarantined: quarantinedSessions ?? 0,
      },
    });
    return { acquiredLock: true, freshPending: swept.freshPending };
  } finally {
    // token을 반드시 넘긴다 — 인자 없이 부르면 lib/lock.mjs의 단락 평가로 '남의 락도 무조건
    // unlink'가 되살아난다.
    releaseLock(okfHome, lockResult.token);
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
    // 링거 probe가 회차마다 readInstalledAt을 부르면 마커 쓰기가 실패한 번들에서 8시간 동안
    // 5분마다 git 서브프로세스가 뜬다 — 진입 시 한 번만 계산해 재사용한다.
    const lingerInstallFloorMs = computeInstallFloorMs(okfHome, config);
    log(okfHome, `링거: 활동 직후 세션 ${cycle.freshPending}개 — 유휴 도달까지 대기 (poll ${Math.round(LINGER_POLL_MS / 1000)}s)`);
    for (;;) {
      if (Date.now() - startedMs >= LINGER_MAX_MS) {
        log(okfHome, '링거: 최대 수명 도달 — 종료 (다음 세션 훅이 재기동한다)');
        return;
      }
      await sleep(LINGER_POLL_MS);
      const probe = scanOrphanSessions(okfHome, config, false, lingerInstallFloorMs);
      if (probe.recovered > 0) break; // 유휴에 도달한 세션이 생겼다 — 전체 사이클 재실행
      if (probe.freshPending === 0) return; // 기다리던 세션이 사라졌다(제외 판명, 정리 등)
    }
  }
}

try {
  await runLoop();
} catch (err) {
  // 예전엔 여기서 던진 예외가 unhandled rejection으로 사라져 상태 파일에 아무 흔적도 남지
  // 않았다 — 사용자에겐 배치가 조용히 멈춘 것으로만 보인다. err.message는 절대 남기지 마라
  // (전사 파생 문자열·YAML 원문이 섞일 수 있다) — 코드까지가 상한이다.
  const crashedHome = resolveOkfHome();
  log(crashedHome, `배치 루프 예외 종료: code=${safeErrorCode(err)}`);
  try {
    updateLastBatch(crashedHome, `error: batch loop crashed (${safeErrorCode(err)})`);
  } catch {
    // 상태 기록마저 실패하면 위 로그 한 줄이 마지막 신호다.
  }
  // process.exit()가 아니라 exitCode여야 한다 — pipe stdout 절단 전례(bin/session-start.mjs 하단).
  process.exitCode = 1;
}
