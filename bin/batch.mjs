import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { resolveOkfHome, okfPaths, pluginRoot, claudeConfigDir } from '../lib/paths.mjs';
import { readConfig } from '../lib/config.mjs';
import { git, isDirty, commitAll, rollback } from '../lib/git.mjs';
import { runLint, formatReport } from '../lib/lint.mjs';
import { regenerateIndex } from '../lib/index-gen.mjs';
import { digestFile } from '../lib/digest.mjs';
import { sanitizeForFilename } from '../lib/capture.mjs';
import { readLock, isLockStale } from '../lib/lock.mjs';

const LOCK_ACQUIRE_MAX_ATTEMPTS = 10; // 경합 재시도 상한 — 이론상 수렴하지만 무한루프 방지용 안전판
const SWEEP_LOOKBACK_DAYS = 7; // §7-8: 이보다 오래된 orphan transcript는 sweep 대상에서 제외
// 리뷰 지적(사후 반영): mtime만 보면 아직 다른 창에서 진행 중인 세션(방금 메시지를 보냄 ->
// mtime이 "최근")까지 orphan으로 오판해 미완성 대화를 중간에 sweep-ingest해버릴 수 있다.
// 최소 유휴 시간을 두어, 최근에 계속 갱신되는 중인 파일은 이번 회차엔 건너뛰고 다음 배치가
// 다시 판단하게 한다 — 완벽하진 않지만(긴 침묵 중인 진행 세션은 여전히 걸릴 수 있음) 창을 크게 줄인다.
const SWEEP_MIN_IDLE_MS = 30 * 60_000;
const CHUNK_BYTE_LIMIT = 300 * 1024; // §5-5 6단계
const INGEST_TIMEOUT_MS = 15 * 60_000;
const REPAIR_TIMEOUT_MS = 15 * 60_000;
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
    fs.mkdirSync(paths.logs, { recursive: true });
    const today = localDateString();
    fs.appendFileSync(path.join(paths.logs, `batch-${today}.log`), `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    // 로그 기록 실패는 배치 진행을 막지 않는다.
  }
  console.error(msg);
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

// ---------- 1. 유실 세션 회수 (sweep, §7-8) ----------
function sweepOrphanSessions(okfHome) {
  // 리뷰 지적(사후 반영): CLAUDE_CONFIG_DIR을 무시하고 항상 os.homedir()/.claude만 봤다 —
  // lib/paths.mjs의 OKF_HOME 해석 규칙과 어긋나서, 사용자가 CLAUDE_CONFIG_DIR을 설정한
  // 환경에서는 sweep이 엉뚱한(또는 존재하지 않는) 위치를 스캔해 백스톱이 조용히 무력화됐다.
  const projectsDir = path.join(claudeConfigDir(), 'projects');
  let projectDirs;
  try {
    projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return 0;
  }

  const paths = okfPaths(okfHome);
  const knownSessionIds = new Set();
  for (const f of safeReaddir(paths.raw)) knownSessionIds.add(sessionIdFromFilename(f));
  for (const dateDir of safeReaddir(paths.removeCandidate)) {
    for (const f of safeReaddir(path.join(paths.removeCandidate, dateDir))) knownSessionIds.add(sessionIdFromFilename(f));
  }

  const cutoff = Date.now() - SWEEP_LOOKBACK_DAYS * 86400_000;
  let recovered = 0;

  for (const dirent of projectDirs) {
    const dir = path.join(projectsDir, dirent.name);
    for (const f of safeReaddir(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      const sessionId = sessionIdFromFilename(f);
      if (knownSessionIds.has(sessionId)) continue;

      const full = path.join(dir, f);
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.size === 0 || st.mtimeMs < cutoff) continue;
      if (Date.now() - st.mtimeMs < SWEEP_MIN_IDLE_MS) continue; // 아직 다른 창에서 진행 중일 가능성 — 이번 회차는 건너뜀

      const project = sanitizeForFilename(dirent.name);
      const dateStr = localDateString(st.mtime);
      const dest = path.join(paths.raw, `${dateStr}--${project}--${sessionId}.jsonl`);
      try {
        fs.mkdirSync(paths.raw, { recursive: true });
        fs.copyFileSync(full, dest);
        knownSessionIds.add(sessionId);
        recovered++;
      } catch (err) {
        log(okfHome, `sweep 복사 실패 ${full}: ${err.message}`);
      }
    }
  }
  return recovered;
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
          log(okfHome, `staging 잔재 반환 실패 ${full}: ${err.message}`);
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

  log(okfHome, `배치 시작 전 dirty 작업트리가 lint 실패 — 배치 시작하지 않고 중단.\n${formatReport(report)}`);
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
      log(okfHome, `digest 생성 실패 ${input}: ${err.message} — 원본 텍스트 폴백`);
      try {
        const text = fs.readFileSync(input, 'utf8').slice(0, capKb * 1024);
        fs.writeFileSync(output, text);
        digestPaths.push({ source: input, digest: output });
      } catch (err2) {
        log(okfHome, `digest 폴백도 실패 ${input}: ${err2.message} — 이 세션은 이번 배치에서 스킵`);
      }
    }
  }
  return digestPaths;
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

function runClaude(prompt, { cwd, timeoutMs, claudeBin }) {
  const bin = claudeBin || 'claude';
  const isolatedConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-batch-config-'));
  try {
    const output = execFileSync(
      bin,
      [
        '-p', prompt,
        // 리뷰 지적(사후 반영, 실측 확인): --allowedTools는 권한 프롬프트 생략 목록일 뿐
        // 실제 도구 가용성을 제한하지 않는다 — 실측 결과 --allowedTools에서 Bash를 뺐는데도
        // 모델이 Bash를 호출해 그대로 실행됐다. --tools(가용 도구 집합 자체를 제한)가 실제
        // 차단 메커니즘이고, --disallowedTools는 보조로 병기한다(§9 item 4, 이번에 실측 완료).
        '--tools', 'Read,Glob,Grep,Write,Edit',
        '--disallowedTools', 'Bash',
        '--settings', '{"hooks":{}}', // 1차 가드(CLAUDE_CONFIG_DIR)의 보조 수단으로 병기(§7-1)
        '--permission-mode', 'acceptEdits',
        '--max-turns', '80',
      ],
      {
        cwd,
        timeout: timeoutMs,
        shell: process.platform === 'win32', // claude.cmd 대응(§2, §9)
        encoding: 'utf8',
        env: {
          ...process.env,
          OKF_BATCH: '1', // defense-in-depth (§7-1 2차 가드)
          CLAUDE_CONFIG_DIR: isolatedConfigDir, // 1차 가드: 사용자 훅/플러그인을 아예 로드시키지 않음
        },
      }
    );
    // claude -p가 정상 종료했더라도 --max-turns 소진 등으로 미완성 상태일 수 있음(§9 item 4,
    // 정확한 판별 방법은 실측 필요로 문서에 명시된 채 v1 범위에서 보류됨) — 이후 lint가
    // 구조적 문제는 잡아내지만 "완결되지 않은 채 구조만 유효한" 산출물까지는 못 잡는다.
    return { ok: true, output };
  } catch (err) {
    return { ok: false, error: err };
  } finally {
    fs.rmSync(isolatedConfigDir, { recursive: true, force: true });
  }
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
      log(okfHome, `청크 원복 중 raw 반환 실패 ${dp.source}: ${err.message}`);
    }
    tryUnlink(dp.digest);
  }
}

// 리뷰 지적(사후 반영): regenerateIndex/runLint/commitAll 중 하나가 (git commit 실패,
// ENOSPC, index.lock 경합 등으로) 동기 예외를 던지면 이전엔 그 예외가 processChunks 밖으로
// 그대로 전파돼 runBatch()의 try/finally가 락만 정상 해제하고 죽었다 — 다음 실행은 "락이
// 없다" -> 정상 신규 획득(recoveredFromStaleLock=false)으로 보고, 청크 도중 남은 dirty
// 작업트리를 "사용자 편집"으로 오분류할 위험이 있었다(§7-4가 막으려던 바로 그 상황).
// 여기서 즉시 잡아서 그 청크만 롤백하면, 다음 실행이 헷갈릴 dirty 상태 자체가 안 남는다.
function processChunkBody(okfHome, chunk, i, totalChunks, paths, pluginRootDir, config) {
  const ingestResult = runClaude(buildIngestPrompt(pluginRootDir, chunk), {
    cwd: paths.home,
    timeoutMs: INGEST_TIMEOUT_MS,
    claudeBin: config.claude_bin,
  });
  if (!ingestResult.ok) {
    log(okfHome, `청크 ${i + 1} ingest 실패: ${ingestResult.error.stderr || ingestResult.error.message} — 원복 후 배치 중단`);
    return false;
  }

  regenerateIndex(okfHome);
  let report = runLint(okfHome);

  if (report.errors.length > 0) {
    log(okfHome, `청크 ${i + 1} lint 실패, repair 1회 시도\n${formatReport(report)}`);
    const repairResult = runClaude(buildRepairPrompt(pluginRootDir, report), {
      cwd: paths.home,
      timeoutMs: REPAIR_TIMEOUT_MS,
      claudeBin: config.claude_bin,
    });
    if (repairResult.ok) {
      regenerateIndex(okfHome);
      report = runLint(okfHome);
    }
  }

  if (report.errors.length > 0) {
    log(okfHome, `청크 ${i + 1} repair 후에도 lint 실패 — 원복\n${formatReport(report)}`);
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
}

function processChunks(okfHome, chunks, pluginRootDir, config) {
  const paths = okfPaths(okfHome);
  const todayDir = path.join(paths.removeCandidate, localDateString());

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    log(okfHome, `청크 ${i + 1}/${chunks.length} 처리 시작 (세션 ${chunk.length}개)`);

    let succeeded;
    try {
      succeeded = processChunkBody(okfHome, chunk, i, chunks.length, paths, pluginRootDir, config);
    } catch (err) {
      log(okfHome, `청크 ${i + 1} 처리 중 예외 발생: ${err.message} — 크래시로 간주해 원복 후 배치 중단`);
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
  fs.writeFileSync(paths.lastBatch, JSON.stringify({ lastRunEpochMs: Date.now(), lastResult: result, pendingAfter }, null, 2));
  log(okfHome, `배치 종료: ${result} (잔여 raw: ${pendingAfter})`);
}

function runBatch() {
  const okfHome = resolveOkfHome();
  const config = readConfig(okfHome);
  const pluginRootDir = pluginRoot();
  const runId = `${Date.now()}-${process.pid}`;

  const lockResult = acquireLock(okfHome);
  if (!lockResult.acquired) return; // 다른 배치가 정상 진행 중이거나 경합 상한 초과 — 다음 스케줄에 재시도

  try {
    log(okfHome, `배치 시작 (recoveredFromStaleLock=${lockResult.recoveredFromStaleLock})`);

    // §5-5 순서(0.락 1.sweep 2.크래시복구 3.purge 4.스냅샷)대로: sweep을 purge보다 먼저 실행한다.
    // 리뷰 지적(사후 반영) — 이전엔 purge가 먼저 돌아서, TTL 경계에 걸린 _remove_candidate
    // 마커를 sweep이 "known" 판정에 쓰기도 전에 지워버려 이미 처리된 세션을 같은 실행 안에서
    // orphan으로 오판해 재수집·재ingest하는 경로가 있었다. §5-4/§7-8: raw 상태와 무관하게
    // 항상 실행 — 유일한 백스톱이 raw-empty 게이트에 막히면 안 됨.
    const recovered = sweepOrphanSessions(okfHome);
    if (recovered > 0) log(okfHome, `sweep: 유실 세션 ${recovered}개 회수`);

    recoverStagingLeftovers(okfHome);

    const dirtyResult = handleDirtyWorkingTree(okfHome, lockResult.recoveredFromStaleLock);
    if (!dirtyResult.ok) {
      updateLastBatch(okfHome, 'aborted: pre-batch dirty tree lint failed');
      return;
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
      return;
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
      return;
    }

    const chunks = chunkBySize(digestPaths, CHUNK_BYTE_LIMIT);
    const { processedChunks, aborted } = processChunks(okfHome, chunks, pluginRootDir, config);

    try {
      fs.rmdirSync(stagingDir);
    } catch {
      // no-op (혹시 남은 게 있으면 다음 실행의 크래시 복구 단계가 처리)
    }

    updateLastBatch(okfHome, aborted ? `partial: ${processedChunks}/${chunks.length} chunks` : 'ok');
  } finally {
    releaseLock(okfHome);
  }
}

runBatch();
