// End-to-end smoke suite for the OKF plugin (implement.md §8). Not a unit-test
// framework — a self-contained runner exercising real subprocess invocations
// (session-start.mjs / session-end.mjs / batch.mjs) against throwaway sandbox
// OKF_HOME directories, plus a fake `claude` binary (test/fixtures/fake-claude.mjs)
// so the batch driver's full orchestration is covered without a real LLM call.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ensureBootstrap } from '../lib/bootstrap.mjs';
import { okfPaths, isOkfTestSessionDir } from '../lib/paths.mjs';
import { DEFAULT_CONFIG, readConfig } from '../lib/config.mjs';
import { runLint, formatReport } from '../lib/lint.mjs';
import { regenerateIndex } from '../lib/index-gen.mjs';
import { digestFile } from '../lib/digest.mjs';
import { captureSession, sanitizeForFilename } from '../lib/capture.mjs';
import { git } from '../lib/git.mjs';
import { analyzeProject } from '../lib/analyze.mjs';
import { buildGraph, renderHtml } from '../lib/viz.mjs';
import { recordCaptureStatus } from '../lib/status.mjs';
import { auditBenchmarkBundle, matchesBenchmarkAnswer } from '../lib/bench-audit.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAKE_CLAUDE = path.join(PLUGIN_ROOT, 'test', 'fixtures', process.platform === 'win32' ? 'fake-claude.cmd' : 'fake-claude.mjs');
const SAMPLE_TRANSCRIPT = path.join(PLUGIN_ROOT, 'test', 'fixtures', 'sample-transcript.jsonl');

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`PASS: ${name}`);
  } else {
    fail++;
    console.log(`FAIL: ${name} ${detail}`);
  }
}

function sandbox(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `okf-smoke-${label}-`));
}

// Polls a synchronous predicate without relying on a Unix-only `sleep` executable.
// Atomics.wait is available in Node on every supported desktop platform.
function waitUntil(predicate, timeoutMs = 8000, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < deadline) {
    if (predicate()) return true;
    Atomics.wait(sleeper, 0, 0, intervalMs);
  }
  return predicate();
}

function readIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return ''; // 없으면 빈 문자열 — 단언이 '없다'는 사실로 실패하게 둔다
  }
}

function bootstrapped(label) {
  const home = sandbox(label);
  ensureBootstrap(home);
  return home;
}

function writeConfig(okfHome, overrides) {
  const paths = okfPaths(okfHome);
  const lines = Object.entries(overrides).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  fs.writeFileSync(paths.config, `---\n${lines.join('\n')}\n---\n`);
}

function runHook(scriptRelPath, { okfHome, stdin = '{}', env = {} }) {
  const home = env.HOME || isolatedHome();
  const suppressAutoBatch = scriptRelPath === 'bin/session-start.mjs';
  const lockPath = okfPaths(okfHome).lock;
  let temporaryLock = false;
  if (suppressAutoBatch && !fs.existsSync(lockPath)) {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedEpochMs: Date.now() }));
    temporaryLock = true;
  }
  try {
    return execFileSync(process.execPath, [path.join(PLUGIN_ROOT, scriptRelPath)], {
      input: stdin,
      env: {
        ...process.env,
        OKF_HOME: okfHome,
        HOME: home,
        USERPROFILE: home,
        CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
        ...env,
      },
      encoding: 'utf8',
    });
  } finally {
    if (temporaryLock) fs.rmSync(lockPath, { force: true });
  }
}

// sweepOrphanSessions scans os.homedir()/.claude/projects — without overriding
// HOME here, every batch test would sweep in this *real machine's* actual
// Claude Code session history, corrupting raw/ counts. Default to an isolated,
// empty fake home; only the dedicated sweep test (9g) plants an orphan in one.
function isolatedHome() {
  return sandbox('fake-home');
}

function runBatch({ okfHome, env = {} }) {
  const home = env.HOME || isolatedHome();
  return execFileSync(process.execPath, [path.join(PLUGIN_ROOT, 'bin', 'batch.mjs')], {
    cwd: okfHome,
    env: { ...process.env, OKF_HOME: okfHome, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function lastBatch(okfHome) {
  return JSON.parse(fs.readFileSync(okfPaths(okfHome).lastBatch, 'utf8'));
}

function listRaw(okfHome) {
  try {
    return fs.readdirSync(okfPaths(okfHome).raw).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
}

function listRemoveCandidate(okfHome) {
  const dir = okfPaths(okfHome).removeCandidate;
  const dates = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  return dates.flatMap((d) => {
    const sub = path.join(dir, d);
    return fs.statSync(sub).isDirectory() ? fs.readdirSync(sub).map((f) => `${d}/${f}`) : [];
  });
}

// ---------------------------------------------------------------------------
console.log('\n=== bootstrap ===');
{
  const home = sandbox('bootstrap');
  ensureBootstrap(home);
  const paths = okfPaths(home);
  ok('bootstrap creates .git', fs.existsSync(paths.git));
  ok('bootstrap creates root index.md with okf_version', fs.readFileSync(paths.rootIndex, 'utf8').includes('okf_version'));
  ok('bootstrap creates SCHEMA.md with type: schema', fs.readFileSync(paths.schema, 'utf8').includes('type: schema'));
  ok('bootstrap creates config.md', fs.existsSync(paths.config));
  if (process.platform !== 'win32') {
    ok('bootstrap restricts OKF home to owner-only', (fs.statSync(paths.home).mode & 0o777) === 0o700);
    ok('bootstrap restricts runtime state directory to owner-only', (fs.statSync(paths.state).mode & 0o777) === 0o700);
  }
  const before = git(['log', '--oneline'], home);
  ensureBootstrap(home); // idempotent re-run
  const after = git(['log', '--oneline'], home);
  ok('bootstrap re-run is a no-op (no new commit)', before === after);
}

// ---------------------------------------------------------------------------
console.log('\n=== config validation ===');
{
  const home = bootstrapped('config-invalid');
  writeConfig(home, {
    enabled: 'false',
    batch_interval_hours: -1,
    batch_max_digest_kb: 0,
    batch_max_sessions: -50,
    batch_digest_cap_kb: 'huge',
    remove_candidate_ttl_days: -30,
    inject_max_lines: 0,
    inject_max_bytes: 999999,
    capture_exclude_cwd: '/private/**',
    batch_model: 'claude-sonnet-5 & calc',
    batch_effort: 'turbo',
    claude_bin: 'claude.cmd & calc',
    node_bin: 'node.exe | calc',
    seed_language: 'xx-NOPE',
    unexpected_key: 'must not escape normalization',
  });
  const warnings = [];
  const config = readConfig(home, (warning) => warnings.push(warning));
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    ok(`invalid config falls back safely: ${key}`, config[key] === DEFAULT_CONFIG[key] || JSON.stringify(config[key]) === JSON.stringify(DEFAULT_CONFIG[key]));
  }
  ok('unknown config keys are ignored', !Object.hasOwn(config, 'unexpected_key'));
  ok('invalid config diagnostics name keys without echoing values', warnings.length >= Object.keys(DEFAULT_CONFIG).length && warnings.every((w) => w.key && !Object.hasOwn(w, 'value')));
  ok('default hook context stays below Claude Code 10,000-character cap', DEFAULT_CONFIG.inject_max_bytes <= 9000);
}

// ---------------------------------------------------------------------------
console.log('\n=== capture (lib-level) ===');
{
  const home = bootstrapped('capture');
  const cwd = '/Users/tester/my-project';
  const r1 = captureSession({ okfHome: home, cwd, sessionId: 'aaaaaaaa-1111-2222-3333-444444444444', transcriptPath: SAMPLE_TRANSCRIPT });
  ok('capture reports captured:true', r1.captured === true);
  const raw1 = fs.readFileSync(r1.dest);
  const src = fs.readFileSync(SAMPLE_TRANSCRIPT);
  ok('captured raw file is byte-for-byte identical to source', Buffer.compare(raw1, src) === 0);
  if (process.platform !== 'win32') {
    ok('captured raw transcript is owner-readable only', (fs.statSync(r1.dest).mode & 0o777) === 0o600);
  }

  // resume: same session_id, longer transcript -> must overwrite same dest, not create a 2nd file
  const resumedPath = path.join(sandbox('resume-src'), 'resumed.jsonl');
  fs.writeFileSync(resumedPath, fs.readFileSync(SAMPLE_TRANSCRIPT, 'utf8') + '{"type":"user","message":{"role":"user","content":"추가 대화"}}\n');
  const r2 = captureSession({ okfHome: home, cwd, sessionId: 'aaaaaaaa-1111-2222-3333-444444444444', transcriptPath: resumedPath });
  ok('resume overwrites same destination path', r2.dest === r1.dest);
  ok('raw/ still has exactly one file for this session', listRaw(home).length === 1);
  ok('resumed content actually landed (superset)', fs.readFileSync(r2.dest, 'utf8').includes('추가 대화'));

  captureSession({ okfHome: home, cwd, sessionId: 'aaaaaaaa-1111-2222-3333-444444444444', transcriptPath: SAMPLE_TRANSCRIPT });
  ok('out-of-order older capture cannot truncate a resumed session', fs.readFileSync(r2.dest, 'utf8').includes('추가 대화'));

  const empty = sandbox('empty-transcript');
  const emptyPath = path.join(empty, 'empty.jsonl');
  fs.writeFileSync(emptyPath, '');
  const r3 = captureSession({ okfHome: home, cwd, sessionId: 'bbbbbbbb-0000-0000-0000-000000000000', transcriptPath: emptyPath });
  ok('empty transcript is skipped', r3.captured === false);

  const largeSource = path.join(sandbox('large-transcript'), 'large.jsonl');
  const largeContent = `${JSON.stringify({ type: 'user', message: { role: 'user', content: `한글-${'x'.repeat(2 * 1024 * 1024)}` } })}\n`;
  fs.writeFileSync(largeSource, largeContent);
  const largeResult = captureSession({ okfHome: home, cwd, sessionId: 'bbbbbbbb-1111-2222-3333-444444444444', transcriptPath: largeSource });
  ok('large UTF-8 transcript is captured byte-for-byte', Buffer.compare(fs.readFileSync(largeSource), fs.readFileSync(largeResult.dest)) === 0);

  ok('sanitizeForFilename replaces forbidden chars', sanitizeForFilename('a:b?c') === 'a_b_c');
  ok('sanitizeForFilename prefixes reserved Windows names', sanitizeForFilename('CON') === '_CON');
  ok('sanitizeForFilename is case-insensitive on reserved names', sanitizeForFilename('con') === '_con');
  ok('sanitizeForFilename falls back on empty result', sanitizeForFilename('') === 'project');

  const hostileHome = bootstrapped('capture-hostile-session-id');
  let hostileResult = null;
  try {
    hostileResult = captureSession({ okfHome: hostileHome, cwd, sessionId: '../../../../outside', transcriptPath: SAMPLE_TRANSCRIPT });
  } catch {
    // A rejected/escaped filename is a failed boundary contract, but keep the runner alive.
  }
  ok('capture confines untrusted session ids to raw/', hostileResult?.captured === true
    && path.dirname(hostileResult.dest) === okfPaths(hostileHome).raw
    && !path.basename(hostileResult.dest).includes('..'));
}

// ---------------------------------------------------------------------------
console.log('\n=== session-end.mjs (subprocess) ===');
{
  const blockedStatusHome = sandbox('capture-status-blocked');
  fs.writeFileSync(path.join(blockedStatusHome, '.okf'), 'not-a-directory');
  let statusThrew = false;
  try {
    recordCaptureStatus(blockedStatusHome, { status: 'error', stage: 'test', errorCode: 'TEST' });
  } catch {
    statusThrew = true;
  }
  ok('diagnostic status write failure never interrupts capture flow', !statusThrew);

  const home = bootstrapped('session-end');
  const input = JSON.stringify({
    session_id: 'cccccccc-1111-2222-3333-444444444444',
    transcript_path: SAMPLE_TRANSCRIPT,
    cwd: '/Users/tester/proj-x',
  });
  runHook('bin/session-end.mjs', { okfHome: home, stdin: input });
  ok('session-end hook writes a raw file', listRaw(home).length === 1);
  const captureStatusPath = path.join(okfPaths(home).state, 'capture-status.json');
  ok('session-end records a privacy-safe capture status', fs.existsSync(captureStatusPath));
  if (fs.existsSync(captureStatusPath)) {
    const captureStatus = JSON.parse(fs.readFileSync(captureStatusPath, 'utf8'));
    ok('capture status reports success without transcript paths', captureStatus.lastStatus === 'ok' && !JSON.stringify(captureStatus).includes(SAMPLE_TRANSCRIPT));
    if (process.platform !== 'win32') {
      ok('capture status file is owner-readable only', (fs.statSync(captureStatusPath).mode & 0o777) === 0o600);
    }
  }

  const missingHome = bootstrapped('session-end-missing');
  runHook('bin/session-end.mjs', {
    okfHome: missingHome,
    stdin: JSON.stringify({ session_id: 'eeeeeeee-1111-2222-3333-444444444444', transcript_path: path.join(missingHome, 'does-not-exist.jsonl'), cwd: '/Users/tester/proj-x' }),
  });
  const missingStatus = JSON.parse(fs.readFileSync(okfPaths(missingHome).captureStatus, 'utf8'));
  ok('missing transcript is visible without leaking its path', missingStatus.lastStatus === 'error' && missingStatus.errorCode === 'TRANSCRIPT_UNAVAILABLE' && !JSON.stringify(missingStatus).includes('does-not-exist'));

  // capture_exclude_cwd
  const home2 = bootstrapped('session-end-exclude');
  writeConfig(home2, { capture_exclude_cwd: ['/Users/tester/excluded/**'] });
  const input2 = JSON.stringify({
    session_id: 'dddddddd-1111-2222-3333-444444444444',
    transcript_path: SAMPLE_TRANSCRIPT,
    cwd: '/Users/tester/excluded/sub',
  });
  runHook('bin/session-end.mjs', { okfHome: home2, stdin: input2 });
  ok('capture_exclude_cwd glob skips capture', listRaw(home2).length === 0);

  // malformed stdin must not throw / must exit cleanly (fail-open)
  let threw = false;
  try {
    runHook('bin/session-end.mjs', { okfHome: bootstrapped('session-end-badstdin'), stdin: 'not json' });
  } catch {
    threw = true;
  }
  ok('session-end hook never throws on malformed stdin (fail-open)', !threw);

  const hookConfig = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const sessionEndHook = hookConfig.hooks.SessionEnd[0].hooks[0];
  ok('SessionEnd capture runs asynchronously beyond the plugin hook budget', sessionEndHook.async === true);
  ok('SessionEnd allows the documented ten-minute async copy window', sessionEndHook.timeout >= 600);
}

// ---------------------------------------------------------------------------
console.log('\n=== session-start.mjs (subprocess) ===');
{
  const home = bootstrapped('session-start');
  fs.mkdirSync(path.join(home, 'decisions'), { recursive: true });
  fs.writeFileSync(
    path.join(home, 'decisions', 'example.md'),
    '---\ntype: decision\ntitle: 예시 결정\ndescription: 게이트 주입 테스트용\ntimestamp: 2026-07-15\n---\n본문\n'
  );
  regenerateIndex(home);

  const out = runHook('bin/session-start.mjs', { okfHome: home });
  const parsed = JSON.parse(out);
  ok('session-start emits hookSpecificOutput.additionalContext', typeof parsed.hookSpecificOutput?.additionalContext === 'string');
  ok('gate context contains mandatory gate banner', parsed.hookSpecificOutput.additionalContext.includes('OKF KNOWLEDGE GATE'));
  // The gate's only job is to make the model Read the right concept before working on
  // something related. Category counts alone ("decisions — 1개") give it nothing to judge
  // relevance by, so the injected index must name each concept — the shape AGENDA.md:52
  // points at (native auto-memory's MEMORY.md: one title + hook per line, line-capped).
  const ctx = parsed.hookSpecificOutput.additionalContext;
  ok('gate context keeps category headings', ctx.includes('decisions'));
  ok('gate context names each concept', ctx.includes('예시 결정'));
  ok('gate context carries the concept description (the relevance hook)', ctx.includes('게이트 주입 테스트용'));
  ok('gate context links concepts by bundle-root path', ctx.includes('/decisions/example.md'));
  // Live-bench diagnosis (docs/benchmarks/okf-live-2026-07-15T15-03-01-343Z): of C's 13,787
  // excess token activity over B, 91% (12,508) was the mandated Read round-trip — and those
  // 5 Reads returned ZERO new facts, because 8/8 answers were already in the index lines.
  // Now that the index carries titles+descriptions, "반드시 Read 하라" orders the model to
  // re-fetch what it was already handed. The gate must let it answer from the line itself.
  ok('gate allows answering from the index line without a redundant Read', ctx.includes('Read 없이'));
  ok('suppressOutput is set', parsed.suppressOutput === true);

  const outBatchGuard = runHook('bin/session-start.mjs', { okfHome: home, env: { OKF_BATCH: '1' } });
  ok('OKF_BATCH=1 short-circuits to empty object', outBatchGuard.trim() === '{}');

  const disabledHome = bootstrapped('session-start-disabled');
  writeConfig(disabledHome, { enabled: false });
  const outDisabled = runHook('bin/session-start.mjs', { okfHome: disabledHome });
  ok('enabled:false suppresses gate injection', outDisabled.trim() === '{}');
}

{
  // Now that the index names every concept, it grows with the bundle — which is exactly the
  // cost AGENDA.md:52 flagged. The cap must bite the *index* and leave the rest standing:
  // if a 500-concept bundle silently pushes "최근 변경" out of the injection, the gate loses
  // the one signal that tells it the bundle moved since last session.
  const home = bootstrapped('session-start-oversized');
  fs.mkdirSync(path.join(home, 'decisions'), { recursive: true });
  for (let i = 0; i < 500; i++) {
    fs.writeFileSync(
      path.join(home, 'decisions', `d${String(i).padStart(3, '0')}.md`),
      `---\ntype: decision\ntitle: 결정 ${i}\ndescription: 설명 ${i}\ntimestamp: 2026-07-15\n---\n본문\n`
    );
  }
  fs.writeFileSync(path.join(home, 'log.md'), '## 2026-07-15\n- 번들이 이만큼 움직였다\n');
  regenerateIndex(home);

  const ctx = JSON.parse(runHook('bin/session-start.mjs', { okfHome: home })).hookSpecificOutput.additionalContext;
  ok('oversized index still leaves the recent-changes section injected', ctx.includes('최근 변경 (log.md)'));
  ok('oversized index still carries the latest log entry', ctx.includes('번들이 이만큼 움직였다'));
  ok('oversized index is visibly truncated, not silently cut', ctx.includes('생략'));
  ok('oversized injection still respects the byte cap', Buffer.byteLength(ctx, 'utf8') <= DEFAULT_CONFIG.inject_max_bytes);
}

{
  // Accumulation regime. The index fills category-by-category in alphabetical order, so one
  // large category eats the whole budget and the rest vanish — eviction is by FILENAME, not
  // by relevance or recency. Real Korean concept lines run ~200 bytes, so the byte cap binds
  // around 40 concepts, far below the 120-line cap. The 500-concept test above misses this
  // because its fixture lines (`결정 0` / `설명 0`) are ~50 bytes, tripping the LINE cap instead
  // — right intent, wrong regime. Here `decisions` is huge and the SQLITE_BUSY fix, the kind of
  // fact a user actually needs, sits in `troubleshooting` after it alphabetically.
  const home = bootstrapped('session-start-starvation');
  fs.mkdirSync(path.join(home, 'decisions'), { recursive: true });
  fs.mkdirSync(path.join(home, 'troubleshooting'), { recursive: true });
  for (let i = 0; i < 200; i++) {
    fs.writeFileSync(
      path.join(home, 'decisions', `concept-${String(i).padStart(3, '0')}.md`),
      `---\ntype: decision\ntitle: 서비스 계층 분리 결정 ${i}\ndescription: 도메인 로직을 컨트롤러에서 떼어내 서비스 계층으로 옮기기로 한 근거와 적용 범위 ${i}\ntimestamp: 2026-07-15\n---\n본문\n`
    );
  }
  fs.writeFileSync(
    path.join(home, 'troubleshooting', 'sqlite-busy.md'),
    '---\ntype: troubleshooting\ntitle: SQLITE_BUSY는 busy_timeout=5000으로 해결한다\ndescription: 동시 쓰기에서 SQLITE_BUSY가 발생하면 busy_timeout=5000을 설정해 해결한다\ntimestamp: 2026-07-15\n---\n본문\n'
  );
  regenerateIndex(home);

  const ctx = JSON.parse(runHook('bin/session-start.mjs', { okfHome: home })).hookSpecificOutput.additionalContext;
  ok('a large category does not evict the other categories from the index', ctx.includes('busy_timeout'));
  ok('a truncated category shows visible/total, so the model knows the index is partial', /\d+\/\d+개/.test(ctx));
  ok('starved index still respects the byte cap', Buffer.byteLength(ctx, 'utf8') <= DEFAULT_CONFIG.inject_max_bytes);
  // Progressive disclosure (OKF spec: an index.md enumerates its directory's contents so a
  // reader can descend on demand). Telling the model "159 were omitted" without telling it
  // WHERE they are is a dead end — it knows something is missing and cannot reach it. The
  // truncated category must name its own index.md as the way down.
  ok('a truncated category points to its own index.md so the rest stays reachable', ctx.includes('/decisions/index.md'));
}

// ---------------------------------------------------------------------------
console.log('\n=== index-gen: nested domains (OKF spec) ===');
{
  // OKF 스펙: "index.md 파일은 번들 루트를 포함해 어느 디렉토리에든 놓일 수 있습니다. 디렉토리의
  // 내용물을 열거하여 점진적 공개(progressive disclosure)를 지원합니다." 즉 도메인 안에 도메인이
  // 있을 수 있다(sales/tables/orders.md). 지금은 루트 1단계만 훑어서 decisions/sales/orders.md가
  // index.md에 영원히 나타나지 않고, 게이트는 index 기반이므로 세션에서도 영구히 발견 불가능하다.
  // index-gen.mjs가 이미 같은 부류의 버그를 고쳐뒀다 — 고정 6개 디렉토리만 순회하다가 동적 스캔으로
  // 바꾼 그 주석. 그 교훈이 한 단계 아래에는 적용되지 않았다.
  const home = bootstrapped('index-nested');
  fs.mkdirSync(path.join(home, 'decisions', 'sales', 'tables'), { recursive: true });
  fs.writeFileSync(
    path.join(home, 'decisions', 'top-level.md'),
    '---\ntype: decision\ntitle: 최상위 결정\ndescription: 카테고리 바로 아래 concept\ntimestamp: 2026-07-15\n---\n본문\n'
  );
  fs.writeFileSync(
    path.join(home, 'decisions', 'sales', 'orders.md'),
    '---\ntype: decision\ntitle: 주문 취소는 소프트 딜리트로 처리한다\ndescription: 정산 감사를 위해 하드 딜리트를 금지한 근거\ntimestamp: 2026-07-15\n---\n본문\n'
  );
  fs.writeFileSync(
    path.join(home, 'decisions', 'sales', 'tables', 'ledger.md'),
    '---\ntype: decision\ntitle: 원장 테이블은 append-only다\ndescription: 정정은 반대 분개로만 기록한다\ntimestamp: 2026-07-15\n---\n본문\n'
  );
  regenerateIndex(home);

  const nested = readIfExists(path.join(home, 'decisions', 'sales', 'index.md'));
  ok('a nested domain gets its own index.md', nested.includes('주문 취소는 소프트 딜리트로 처리한다'));
  const deep = readIfExists(path.join(home, 'decisions', 'sales', 'tables', 'index.md'));
  ok('a domain nested two levels deep gets an index.md too', deep.includes('원장 테이블은 append-only'));
  const parent = readIfExists(path.join(home, 'decisions', 'index.md'));
  ok('the parent index still lists its own concepts', parent.includes('최상위 결정'));
  ok('the parent index links down to the nested domain (progressive disclosure)', parent.includes('/decisions/sales/index.md'));
  ok('the nested index links further down', nested.includes('/decisions/sales/tables/index.md'));
  // 링크는 번들 루트 기준 절대경로여야 한다 — 게이트 규칙 2가 그렇게 약속한다.
  ok('nested concept links are bundle-root absolute', nested.includes('/decisions/sales/orders.md'));
  // 배치가 문서를 쓰면 그 문서를 품은 인덱스 사슬 전체가 역으로 갱신돼야 한다. 3단계 아래
  // ledger.md 하나가 중간 인덱스의 하위 도메인 개수와 루트의 카테고리 개수까지 올라오지 않으면,
  // 게이트는 "decisions 1개"라고 믿고 나머지 2개를 영영 모른다. 여기서 총 3개다:
  // top-level.md + sales/orders.md + sales/tables/ledger.md.
  ok('an intermediate index counts the concepts inside its nested domain', parent.includes('concept 2개'));
  const rootIdx = readIfExists(path.join(home, 'index.md'));
  ok('a concept three levels deep propagates its count to the root index', /\/decisions\/index\.md\) — 3개/.test(rootIdx));
}

// ---------------------------------------------------------------------------
console.log('\n=== sweep: test-session exclusion ===');
{
  // sweep은 ~/.claude/projects 전체를 훑어 "유실된" 세션을 회수한다. 그런데 OKF 자신의 테스트가
  // 임시 디렉토리에서 만든 세션도 그 안에 있고, 그것들은 사용자 지식이 아니다. 실측: 실제
  // projects/에 이런 디렉토리가 241개, transcript가 295개 남아 있었고 sweep에는 이를 걸러낼
  // 조건이 없었다 — 전부 유료 배치에 실려 번들을 오염시키는 경로다.
  // 반대 방향이 더 중요하다: 진짜 작업 디렉토리는 절대 걸리면 안 된다. 특히 이 저장소 자신
  // (side_project/okf-system)과 번들 홈(~/.claude/okf)은 이름에 'okf'가 들어가지만 사용자 작업이다.
  const excluded = [
    '-private-tmp-okf-gate-exp-bundle',
    '-private-tmp-okf-index-test-bundle',
    '-private-tmp-okf-security-test',
    '-private-var-folders-wt-pgkft3x170g9hf7-0bz80-zw0000gn-T-okf-smoke-session-end-156czk',
    '-private-var-folders-wt-pgkft3x170g9hf7-0bz80-zw0000gn-T-okf-smoke-session-start-umtk8O',
    '-Users-ducksu--claude-jobs-6eed7ade-tmp-okf-e2e-testproj',
    '-Users-ducksu--claude-jobs-6eed7ade-tmp-okf-verify2-bundle',
  ];
  for (const name of excluded) ok(`sweep skips the OKF test fixture session: ${name.slice(-28)}`, isOkfTestSessionDir(name));

  const kept = [
    '-Users-ducksu--claude-okf',              // 번들 홈 그 자체
    '-Users-ducksu-side-project-okf-system',  // 이 저장소에서 한 진짜 작업
    '-Users-ducksu-side-project-manna',       // 무관한 진짜 프로젝트
    '-private-tmp-my-okf-experiment',         // 임시 경로지만 OKF 테스트 픽스처가 아님
  ];
  for (const name of kept) ok(`sweep keeps the real session: ${name.slice(-26)}`, !isOkfTestSessionDir(name));
}

// ---------------------------------------------------------------------------
console.log('\n=== lint.mjs ===');
{
  const home = bootstrapped('lint');
  fs.mkdirSync(path.join(home, 'decisions'), { recursive: true });
  fs.mkdirSync(path.join(home, 'patterns'), { recursive: true });

  fs.writeFileSync(path.join(home, 'decisions', 'no-frontmatter.md'), '이 파일엔 frontmatter가 없다.\n');
  fs.writeFileSync(path.join(home, 'decisions', 'empty-type.md'), '---\ntype: ""\ntitle: x\n---\nbody\n');
  fs.mkdirSync(path.join(home, 'decisions', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(home, 'decisions', 'sub', 'index.md'), '---\nfoo: bar\n---\n지수 파일에 frontmatter가 있으면 안 됨\n');
  fs.writeFileSync(
    path.join(home, 'log.md'),
    '# Log\n\n## 2026-01-01\n- old\n\n## 2026-06-01\n- newer but placed after older (ascending violation)\n'
  );
  fs.writeFileSync(
    path.join(home, 'decisions', 'valid.md'),
    '---\ntype: decision\ntitle: 유효한 결정\ndescription: d\ntimestamp: 2026-07-15\n---\n본문\n'
  );
  fs.writeFileSync(
    path.join(home, 'patterns', 'wrong-dir.md'),
    '---\ntype: decision\ntitle: 잘못된 디렉토리\ndescription: d\ntimestamp: 2026-07-15\n---\n본문\n'
  );

  const report = runLint(home);
  const rules = report.errors.map((e) => `${e.file}:${e.rule}`);
  ok('E1 detected for missing frontmatter', rules.some((r) => r.includes('no-frontmatter.md:E1')));
  ok('E2 detected for empty type', rules.some((r) => r.includes('empty-type.md:E2')));
  ok('E3a detected for non-root index.md with frontmatter', rules.some((r) => r.includes('sub/index.md:E3a')));
  ok('E3b detected for ascending log dates', report.errors.some((e) => e.file === 'log.md' && e.rule === 'E3b'));
  ok('valid.md produces no errors', !report.errors.some((e) => e.file === 'decisions/valid.md'));
  const warnRules = report.warnings.map((w) => `${w.file}:${w.rule}`);
  ok('W3 warns on type/directory mismatch', warnRules.some((r) => r.includes('wrong-dir.md:W3')));
  ok('formatReport produces non-empty text when errors exist', formatReport(report).length > 0);

  // regression: .okf/config.md (no `type`) must NOT trip the linter (round-1 codex fix)
  const clean = bootstrapped('lint-clean');
  const cleanReport = runLint(clean);
  ok('.okf/config.md does not trip E2 (exclusion list works)', cleanReport.errors.length === 0, formatReport(cleanReport));

  // root index.md with an unknown extra frontmatter key -> W4, not E3a
  const rootExtraKey = bootstrapped('lint-root-extra-key');
  fs.writeFileSync(okfPaths(rootExtraKey).rootIndex, '---\nokf_version: "0.1"\nunexpected_key: yes\n---\n# root\n');
  const rootReport = runLint(rootExtraKey);
  ok('unknown root index.md key is W4 (warn), not an error', !rootReport.errors.some((e) => e.file === 'index.md'));
  ok('unknown root index.md key produces W4 warning', rootReport.warnings.some((w) => w.file === 'index.md' && w.rule === 'W4'));
}

// ---------------------------------------------------------------------------
console.log('\n=== index-gen.mjs ===');
{
  const home = bootstrapped('index-gen');
  fs.mkdirSync(path.join(home, 'decisions'), { recursive: true });
  fs.writeFileSync(
    path.join(home, 'decisions', 'a.md'),
    '---\ntype: decision\ntitle: A 결정\ndescription: 설명 A\ntimestamp: 2026-07-15\n---\n본문\n'
  );
  regenerateIndex(home);
  const dirIndex = fs.readFileSync(path.join(home, 'decisions', 'index.md'), 'utf8');
  ok('per-directory index.md has no frontmatter', !dirIndex.startsWith('---'));
  ok('per-directory index.md lists the concept with title+description', dirIndex.includes('A 결정') && dirIndex.includes('설명 A'));
  ok('per-directory index.md link uses .md extension + absolute path', dirIndex.includes('(/decisions/a.md)'));

  const rootIndex = fs.readFileSync(okfPaths(home).rootIndex, 'utf8');
  ok('root index.md preserves okf_version', rootIndex.includes('okf_version: "0.1"'));

  // unknown directory must not crash index-gen (defensive .get-with-fallback)
  fs.mkdirSync(path.join(home, 'projects'), { recursive: true });
  regenerateIndex(home); // re-run should stay idempotent/crash-free
  ok('index-gen re-run is crash-free with an empty taxonomy dir present', true);
}

// ---------------------------------------------------------------------------
console.log('\n=== digest.mjs ===');
{
  const dir = sandbox('digest');
  const out = path.join(dir, 'out.digest.md');
  digestFile(SAMPLE_TRANSCRIPT, out, 150);
  const content = fs.readFileSync(out, 'utf8');
  ok('digest keeps user/assistant text', content.includes('opportunistic'));
  ok('digest summarizes tool_use as one line', content.includes('[tool: Read]'));
  ok('digest drops sidechain lines', !content.includes('sidechain'));
  ok('digest drops tool_result content', !content.includes('파일 내용...'));

  const tinyOut = path.join(dir, 'tiny.digest.md');
  digestFile(SAMPLE_TRANSCRIPT, tinyOut, 1); // 1KB cap forces truncation of Korean text
  const tinyContent = fs.readFileSync(tinyOut, 'utf8');
  ok('truncation at tiny cap never emits a UTF-8 replacement char (boundary-safe cut)', !tinyContent.includes('�'));

  const badDir = sandbox('digest-badinput');
  const badInput = path.join(badDir, 'broken.jsonl');
  fs.writeFileSync(badInput, 'not valid jsonl at all {{{\n');
  const badOut = path.join(badDir, 'broken.digest.md');
  digestFile(badInput, badOut, 10);
  ok('malformed jsonl falls back without throwing', fs.existsSync(badOut));
}

// ---------------------------------------------------------------------------
console.log('\n=== batch.mjs (subprocess, fake claude) ===');
function setupBatchSandbox(label, rawSessionId = 'e0e0e0e0-1111-2222-3333-444444444444') {
  const home = bootstrapped(`batch-${label}`);
  writeConfig(home, { claude_bin: FAKE_CLAUDE });
  fs.mkdirSync(okfPaths(home).raw, { recursive: true });
  fs.copyFileSync(SAMPLE_TRANSCRIPT, path.join(okfPaths(home).raw, `2026-07-15--proj--${rawSessionId}.jsonl`));
  return home;
}

{
  // 9a. success
  const home = setupBatchSandbox('success');
  const usagePath = path.join(sandbox('batch-usage'), 'usage.jsonl');
  runBatch({ okfHome: home, env: { FAKE_CLAUDE_MODE: 'success', OKF_BENCH_USAGE_FILE: usagePath } });
  ok('success: raw/ drained', listRaw(home).length === 0);
  ok('success: file landed in _remove_candidate/', listRemoveCandidate(home).length === 1);
  ok('success: concept file committed', fs.existsSync(path.join(home, 'decisions', 'fake-test-concept.md')));
  ok('success: lastResult is ok', lastBatch(home).lastResult === 'ok');
  ok('success: post-lint clean (HEAD stays conformant)', runLint(home).errors.length === 0);
  const usageText = fs.existsSync(usagePath) ? fs.readFileSync(usagePath, 'utf8') : '';
  const usageRecord = usageText ? JSON.parse(usageText.trim()) : null;
  ok('live benchmark opt-in records batch token and cache usage', usageRecord?.usage?.input_tokens === 100 && usageRecord.usage.cache_read_input_tokens === 25);
  ok('live benchmark telemetry identifies the resolved batch model', usageRecord?.models?.includes('claude-sonnet-5'));
  ok('live benchmark usage record excludes Claude response text', !usageText.includes('done') && !usageText.includes('result'));
  if (process.platform !== 'win32') {
    ok('batch status file is owner-readable only', (fs.statSync(okfPaths(home).lastBatch).mode & 0o777) === 0o600);
    const logFiles = fs.readdirSync(okfPaths(home).logs);
    ok('batch diagnostic logs are owner-readable only', logFiles.length > 0 && logFiles.every((name) => (fs.statSync(path.join(okfPaths(home).logs, name)).mode & 0o777) === 0o600));
  }
}
{
  // 9b. NO-OP
  const home = setupBatchSandbox('noop');
  const commitsBefore = git(['rev-list', '--count', 'HEAD'], home).trim();
  runBatch({ okfHome: home, env: { FAKE_CLAUDE_MODE: 'noop' } });
  ok('noop: raw/ still drained (moved to _remove_candidate even with no LLM output)', listRaw(home).length === 0);
  ok('noop: file landed in _remove_candidate/', listRemoveCandidate(home).length === 1);
  const commitsAfter = git(['rev-list', '--count', 'HEAD'], home).trim();
  ok('noop: no empty commit was created', commitsBefore === commitsAfter, `${commitsBefore} -> ${commitsAfter}`);
}
{
  // 9c. ingest failure -> rollback, raw returned
  const home = setupBatchSandbox('fail');
  runBatch({ okfHome: home, env: { FAKE_CLAUDE_MODE: 'fail' } });
  ok('fail: raw file returned to raw/ (not lost)', listRaw(home).length === 1);
  ok('fail: nothing landed in _remove_candidate/', listRemoveCandidate(home).length === 0);
  const status = git(['status', '--porcelain'], home);
  ok('fail: working tree is clean after rollback', status.trim() === '');
}
{
  const home = setupBatchSandbox('private-error-log');
  const secret = 'SECRET_TRANSCRIPT_TOKEN_DO_NOT_LOG';
  runBatch({ okfHome: home, env: { FAKE_CLAUDE_MODE: 'leak-fail', FAKE_CLAUDE_SECRET: secret } });
  const logs = fs.readdirSync(okfPaths(home).logs)
    .map((name) => fs.readFileSync(path.join(okfPaths(home).logs, name), 'utf8'))
    .join('\n');
  ok('batch logs redact Claude stderr and transcript-derived secrets', !logs.includes(secret));
  ok('batch logs do not persist full raw transcript paths', !logs.includes(path.join(home, 'raw')));

  const lintHome = setupBatchSandbox('private-lint-log');
  runBatch({ okfHome: lintHome, env: { FAKE_CLAUDE_MODE: 'secret-lint', FAKE_CLAUDE_SECRET: secret } });
  const lintLogs = fs.readdirSync(okfPaths(lintHome).logs)
    .map((name) => fs.readFileSync(path.join(okfPaths(lintHome).logs, name), 'utf8'))
    .join('\n');
  ok('batch logs redact transcript-derived lint values', !lintLogs.includes(secret));
}
{
  // A clean process exit is not enough: Claude reports max-turn exhaustion in the JSON result.
  const home = setupBatchSandbox('max-turns');
  runBatch({ okfHome: home, env: { FAKE_CLAUDE_MODE: 'maxturns' } });
  ok('max-turns result returns raw for retry', listRaw(home).length === 1);
  ok('max-turns result is not archived as successfully processed', listRemoveCandidate(home).length === 0);
  ok('max-turns result is visible in last-batch status', lastBatch(home).lastResult.startsWith('partial:'));
}
{
  // 9d. lint fails, repair succeeds
  const home = setupBatchSandbox('repair-ok');
  runBatch({ okfHome: home, env: { FAKE_CLAUDE_MODE: 'badoutput' } });
  ok('repair-ok: raw/ drained after repair succeeds', listRaw(home).length === 0);
  ok('repair-ok: repaired concept committed', fs.readFileSync(path.join(home, 'decisions', 'bad-concept.md'), 'utf8').includes('수리된 결정'));
  ok('repair-ok: post-lint clean', runLint(home).errors.length === 0);
}
{
  // 9e. lint fails, repair also fails -> full rollback
  const home = setupBatchSandbox('repair-fail');
  runBatch({ okfHome: home, env: { FAKE_CLAUDE_MODE: 'badoutput-unfixable' } });
  ok('repair-fail: raw file returned to raw/', listRaw(home).length === 1);
  ok('repair-fail: bad-concept.md not left behind', !fs.existsSync(path.join(home, 'decisions', 'bad-concept.md')));
  const status = git(['status', '--porcelain'], home);
  ok('repair-fail: working tree clean after rollback', status.trim() === '');
}
{
  // 9f (§7-4 코덱스 2차 지적 regression): crash remnant must NOT be treated as user edit
  const home = setupBatchSandbox('stale-lock-crash');
  // simulate a crashed prior batch: dead-PID lock + a dirty working tree left behind mid-chunk
  const deadPid = execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']).toString().trim();
  fs.writeFileSync(okfPaths(home).lock, JSON.stringify({ pid: Number(deadPid), startedEpochMs: Date.now() - 1000 }));
  fs.writeFileSync(path.join(home, 'decisions', 'crash-remnant.md'), 'frontmatter 없는 크래시 잔여물\n');
  // raw/ already has one fixture session from setupBatchSandbox; keep FAKE_CLAUDE_MODE=success
  // so if the remnant were (wrongly) committed as "user edits", it would still be there after.
  runBatch({ okfHome: home, env: { FAKE_CLAUDE_MODE: 'success' } });
  ok(
    'stale-lock-crash: crash remnant was rolled back, not committed as user edit',
    !fs.existsSync(path.join(home, 'decisions', 'crash-remnant.md'))
  );
  ok('stale-lock-crash: batch still completed the real work afterward', fs.existsSync(path.join(home, 'decisions', 'fake-test-concept.md')));
}
{
  // 9g (§7-8/§5-4 코덱스 2차 지적 regression): sweep must run even when raw/ starts empty
  const home = bootstrapped('batch-sweep');
  writeConfig(home, { claude_bin: FAKE_CLAUDE });
  const fakeHome = sandbox('fake-home-for-sweep');
  const orphanSessionId = 'f1f1f1f1-1111-2222-3333-444444444444';
  const projectsDir = path.join(fakeHome, '.claude', 'projects', 'my-slug');
  fs.mkdirSync(projectsDir, { recursive: true });
  const orphanPath = path.join(projectsDir, `${orphanSessionId}.jsonl`);
  fs.copyFileSync(SAMPLE_TRANSCRIPT, orphanPath);
  // SWEEP_MIN_IDLE_MS (30min) skips anything touched too recently (still-open-session guard,
  // review regression fix) — backdate mtime so this fixture reads as a genuinely idle orphan.
  const past = new Date(Date.now() - 60 * 60_000);
  fs.utimesSync(orphanPath, past, past);
  // raw/ deliberately left empty here — this is exactly the round-2 regression scenario.
  ok('sweep precondition: raw/ starts empty', listRaw(home).length === 0);
  runBatch({ okfHome: home, env: { FAKE_CLAUDE_MODE: 'success', HOME: fakeHome, USERPROFILE: fakeHome } });
  ok(
    'sweep: orphan session recovered and processed even though raw/ started empty',
    listRemoveCandidate(home).some((f) => f.includes(orphanSessionId))
  );
  ok('sweep: raw/-empty case still resulted in a real ingest (not a silent noop)', lastBatch(home).lastResult === 'ok');
}
{
  // sweep must NOT recover a session that's still being actively written to (open in
  // another window) — only genuinely idle orphans (SWEEP_MIN_IDLE_MS regression).
  const home = bootstrapped('batch-sweep-active');
  writeConfig(home, { claude_bin: FAKE_CLAUDE });
  const fakeHome = sandbox('fake-home-for-active-sweep');
  const activeSessionId = 'a2a2a2a2-1111-2222-3333-444444444444';
  const projectsDir = path.join(fakeHome, '.claude', 'projects', 'my-slug');
  fs.mkdirSync(projectsDir, { recursive: true });
  fs.copyFileSync(SAMPLE_TRANSCRIPT, path.join(projectsDir, `${activeSessionId}.jsonl`)); // fresh mtime = "just touched"
  runBatch({ okfHome: home, env: { FAKE_CLAUDE_MODE: 'success', HOME: fakeHome, USERPROFILE: fakeHome } });
  ok(
    'sweep skips a just-touched (still-open-session-looking) transcript',
    !listRemoveCandidate(home).some((f) => f.includes(activeSessionId)) && listRaw(home).length === 0
  );
}
{
  // sweep must resolve its source directory the same way OKF_HOME does (CLAUDE_CONFIG_DIR override).
  const fakeHome = sandbox('fake-home-for-cfgdir-sweep');
  const customConfigDir = path.join(fakeHome, 'custom-claude-dir');
  const home = path.join(customConfigDir, 'okf');
  ensureBootstrap(home);
  writeConfig(home, { claude_bin: FAKE_CLAUDE });
  const cfgSessionId = 'c3c3c3c3-1111-2222-3333-444444444444';
  const projectsDir = path.join(customConfigDir, 'projects', 'my-slug');
  fs.mkdirSync(projectsDir, { recursive: true });
  const cfgPath = path.join(projectsDir, `${cfgSessionId}.jsonl`);
  fs.copyFileSync(SAMPLE_TRANSCRIPT, cfgPath);
  const past = new Date(Date.now() - 60 * 60_000);
  fs.utimesSync(cfgPath, past, past);
  runBatch({ okfHome: home, env: { FAKE_CLAUDE_MODE: 'success', HOME: fakeHome, USERPROFILE: fakeHome, CLAUDE_CONFIG_DIR: customConfigDir } });
  ok(
    'sweep honors CLAUDE_CONFIG_DIR for its projects/ source directory',
    listRemoveCandidate(home).some((f) => f.includes(cfgSessionId))
  );
}
{
  // The paid live benchmark must use only its synthetic captured fixture while preserving the
  // user's real Claude auth. It therefore opts out of the orphan-recovery side channel explicitly.
  const home = setupBatchSandbox('bench-isolated-sweep');
  const fakeHome = sandbox('fake-home-for-bench-isolated-sweep');
  const configDir = path.join(fakeHome, '.claude');
  const foreignSessionId = 'd4d4d4d4-1111-2222-3333-444444444444';
  const projectsDir = path.join(configDir, 'projects', 'foreign');
  fs.mkdirSync(projectsDir, { recursive: true });
  const foreignPath = path.join(projectsDir, `${foreignSessionId}.jsonl`);
  fs.copyFileSync(SAMPLE_TRANSCRIPT, foreignPath);
  const past = new Date(Date.now() - 60 * 60_000);
  fs.utimesSync(foreignPath, past, past);
  const usagePath = path.join(fakeHome, 'usage.jsonl');
  runBatch({ okfHome: home, env: {
    FAKE_CLAUDE_MODE: 'success', HOME: fakeHome, USERPROFILE: fakeHome,
    CLAUDE_CONFIG_DIR: configDir, OKF_BENCH_USAGE_FILE: usagePath, OKF_BENCH_SKIP_SWEEP: '1',
  } });
  ok('isolated live benchmark never sweeps the user Claude history',
    !listRemoveCandidate(home).some((f) => f.includes(foreignSessionId))
      && listRemoveCandidate(home).length === 1);
}
{
  // A batch-created Claude session is intentionally not captured by SessionEnd, but Claude Code
  // still writes it under projects/. The next orphan sweep must not re-ingest that transcript.
  const home = setupBatchSandbox('batch-session-registry');
  const fakeHome = sandbox('fake-home-for-batch-session-registry');
  const configDir = path.join(fakeHome, '.claude');
  const batchSessionId = 'b4b4b4b4-1111-2222-3333-444444444444';
  runBatch({ okfHome: home, env: { FAKE_CLAUDE_MODE: 'success', FAKE_CLAUDE_SESSION_ID: batchSessionId, HOME: fakeHome, USERPROFILE: fakeHome, CLAUDE_CONFIG_DIR: configDir } });
  const registryPath = okfPaths(home).batchSessions;
  const registryText = registryPath && fs.existsSync(registryPath) ? fs.readFileSync(registryPath, 'utf8') : '';
  ok('batch records its own Claude session id in a privacy-safe registry', registryText.includes(batchSessionId) && !registryText.includes('[OKF-BATCH]'));
  const projectsDir = path.join(configDir, 'projects', 'batch-home');
  fs.mkdirSync(projectsDir, { recursive: true });
  const transcript = path.join(projectsDir, `${batchSessionId}.jsonl`);
  fs.writeFileSync(transcript, `${JSON.stringify({ type: 'user', cwd: home, sessionId: batchSessionId, message: { role: 'user', content: '[OKF-BATCH] synthetic' } })}\n`);
  const past = new Date(Date.now() - 60 * 60_000);
  fs.utimesSync(transcript, past, past);
  runBatch({ okfHome: home, env: { FAKE_CLAUDE_MODE: 'noop', HOME: fakeHome, USERPROFILE: fakeHome, CLAUDE_CONFIG_DIR: configDir } });
  ok('sweep never re-ingests a registered batch Claude session', !listRemoveCandidate(home).some((f) => f.includes(batchSessionId)) && !listRaw(home).some((f) => f.includes(batchSessionId)));
}
{
  // Registry writes can be interrupted. Transcript cwd metadata provides a content-independent
  // backstop: a Claude session whose cwd is this OKF bundle is a batch/repair session, not user work.
  const fakeHome = sandbox('fake-home-for-batch-cwd');
  const configDir = path.join(fakeHome, '.claude');
  const home = path.join(fakeHome, 'isolated-okf-home');
  ensureBootstrap(home);
  writeConfig(home, { claude_bin: FAKE_CLAUDE });
  const sessionId = 'c5c5c5c5-1111-2222-3333-444444444444';
  const projectsDir = path.join(configDir, 'projects', 'isolated-okf-home');
  fs.mkdirSync(projectsDir, { recursive: true });
  const transcript = path.join(projectsDir, `${sessionId}.jsonl`);
  fs.writeFileSync(transcript, `${JSON.stringify({ type: 'user', cwd: home, sessionId, message: { role: 'user', content: 'synthetic batch prompt' } })}\n`);
  const past = new Date(Date.now() - 60 * 60_000);
  fs.utimesSync(transcript, past, past);
  runBatch({ okfHome: home, env: { FAKE_CLAUDE_MODE: 'noop', HOME: fakeHome, USERPROFILE: fakeHome, CLAUDE_CONFIG_DIR: configDir } });
  ok('sweep excludes transcripts whose cwd is the OKF home', !listRemoveCandidate(home).some((f) => f.includes(sessionId)) && !listRaw(home).some((f) => f.includes(sessionId)));
}
{
  // project directory names containing '$' must not corrupt the ingest prompt via
  // String.replace's special $-pattern interpretation of the replacement argument.
  const home = bootstrapped('dollar-sign');
  writeConfig(home, { claude_bin: FAKE_CLAUDE });
  const promptDumpPath = path.join(sandbox('dollar-dump'), 'prompt.txt');
  const argvDumpPath = path.join(sandbox('dollar-argv-dump'), 'argv.json');
  // Use captureSession() directly rather than the session-end.mjs hook — the hook's own
  // maybeSpawnBatch would race a second, unrelated auto-spawned batch.mjs against the
  // explicit runBatch() call below (both targeting the same home), which is a real
  // scenario but not what this test is about; captureSession() alone lands the raw
  // fixture under a project name containing '$' without triggering that spawn.
  captureSession({
    okfHome: home,
    cwd: "/Users/tester/client$'s-notes",
    sessionId: 'd4d4d4d4-1111-2222-3333-444444444444',
    transcriptPath: SAMPLE_TRANSCRIPT,
  });
  runBatch({ okfHome: home, env: { FAKE_CLAUDE_MODE: 'success', FAKE_CLAUDE_DUMP_PROMPT_TO: promptDumpPath, FAKE_CLAUDE_DUMP_ARGV_TO: argvDumpPath } });
  const dumped = fs.existsSync(promptDumpPath) ? fs.readFileSync(promptDumpPath, 'utf8') : '';
  const dumpedArgv = fs.existsSync(argvDumpPath) ? JSON.parse(fs.readFileSync(argvDumpPath, 'utf8')) : [];
  ok('$-containing project name does not leave an unresolved placeholder in the prompt', dumped.length > 0 && !dumped.includes('{{SOURCE_PATHS}}') && !dumped.includes('{{DIGEST_PATHS}}'));
  ok('$-containing project name does not splice/duplicate the prompt template', (dumped.match(/처리 대상 digest:/g) || []).length <= 1);
  ok('untrusted ingest prompt is sent over stdin, never a Windows shell argument', dumped.length > 0 && !dumpedArgv.includes(dumped));
}
{
  // batch-gate's pre-spawn check must respect the same hard lock-ceiling as batch.mjs's own
  // acquireLock — an alive-but-hung lock older than 4h must not block automatic respawning forever.
  const home = bootstrapped('batch-gate-ceiling');
  writeConfig(home, { claude_bin: FAKE_CLAUDE });
  fs.writeFileSync(okfPaths(home).lock, JSON.stringify({ pid: process.pid, startedEpochMs: Date.now() - 5 * 3600_000 }));
  const { maybeSpawnBatch } = await import('../lib/batch-gate.mjs');
  const { readConfig } = await import('../lib/config.mjs');
  maybeSpawnBatch(home, readConfig(home));
  const spawnedInTime = waitUntil(() => {
    try {
      return fs.readFileSync(okfPaths(home).lastBatch, 'utf8').length > 0;
    } catch {
      return false;
    }
  });
  ok('batch-gate spawns past an alive-but-over-ceiling lock instead of blocking forever', spawnedInTime);
}
{
  // index-gen must discover concepts committed into a novel (non-taxonomy) top-level
  // directory, not just the 6 fixed TAXONOMY_DIRS — otherwise they vanish from the gate.
  const home = bootstrapped('index-gen-novel-dir');
  fs.mkdirSync(path.join(home, 'notes'), { recursive: true });
  fs.writeFileSync(
    path.join(home, 'notes', 'idea.md'),
    '---\ntype: note\ntitle: 새 아이디어\ndescription: 미지 택소노미 디렉토리 테스트\ntimestamp: 2026-07-15\n---\n본문\n'
  );
  regenerateIndex(home);
  const rootIndex = fs.readFileSync(okfPaths(home).rootIndex, 'utf8');
  ok('root index.md includes a novel top-level directory', rootIndex.includes('notes'));
  ok('novel directory gets its own index.md', fs.existsSync(path.join(home, 'notes', 'index.md')) && fs.readFileSync(path.join(home, 'notes', 'index.md'), 'utf8').includes('새 아이디어'));
}
{
  // batch_model/batch_effort config must actually reach the claude -p invocation —
  // batch_model existed in DEFAULT_CONFIG but was never wired into runClaude() until now.
  const home = setupBatchSandbox('model-effort');
  writeConfig(home, { claude_bin: FAKE_CLAUDE, batch_model: 'claude-sonnet-5', batch_effort: 'medium' });
  const argvDumpPath = path.join(sandbox('argv-dump'), 'argv.json');
  runBatch({ okfHome: home, env: { FAKE_CLAUDE_MODE: 'success', FAKE_CLAUDE_DUMP_ARGV_TO: argvDumpPath } });
  const argv = fs.existsSync(argvDumpPath) ? JSON.parse(fs.readFileSync(argvDumpPath, 'utf8')) : [];
  ok('config.batch_model reaches the claude invocation as --model', argv.includes('--model') && argv[argv.indexOf('--model') + 1] === 'claude-sonnet-5');
  ok('config.batch_effort reaches the claude invocation as --effort', argv.includes('--effort') && argv[argv.indexOf('--effort') + 1] === 'medium');
  ok('batch Claude session is never persisted for a later orphan sweep', argv.includes('--no-session-persistence'));
}
{
  // empty batch_model/batch_effort (still the config.md seed convention for "use CLI default")
  // must NOT add --model/--effort with an empty-string value.
  const home = setupBatchSandbox('model-effort-empty');
  writeConfig(home, { claude_bin: FAKE_CLAUDE, batch_model: '', batch_effort: '' });
  const argvDumpPath = path.join(sandbox('argv-dump-empty'), 'argv.json');
  runBatch({ okfHome: home, env: { FAKE_CLAUDE_MODE: 'success', FAKE_CLAUDE_DUMP_ARGV_TO: argvDumpPath } });
  const argv = fs.existsSync(argvDumpPath) ? JSON.parse(fs.readFileSync(argvDumpPath, 'utf8')) : [];
  ok('empty batch_model omits --model entirely', !argv.includes('--model'));
  ok('empty batch_effort omits --effort entirely', !argv.includes('--effort'));
}
{
  // digest must drop harness boilerplate (command echo / isMeta / tool results) — verified
  // against a real transcript where 17 of 18 user turns were noise and every batch went NO-OP.
  const dir = sandbox('digest-noise');
  const input = path.join(dir, 'noisy.jsonl');
  fs.writeFileSync(input, [
    JSON.stringify({ type: 'user', message: { role: 'user', content: '진짜 사용자 발화입니다' }, promptSource: 'queued' }),
    JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: '커맨드 본문이 확장된 메타 턴' } }),
    JSON.stringify({ type: 'user', toolUseResult: { ok: true }, message: { role: 'user', content: '도구 결과가 user 턴으로 들어온 것' } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: '<command-name>/okf:okf-config</command-name>' } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: '<local-command-stdout>실행 출력</local-command-stdout>' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '진짜 어시스턴트 답변' }] } }),
  ].join('\n') + '\n');
  const out = path.join(dir, 'out.digest.md');
  digestFile(input, out, 150);
  const text = fs.readFileSync(out, 'utf8');
  ok('digest keeps genuine user speech', text.includes('진짜 사용자 발화입니다'));
  ok('digest keeps genuine assistant reply', text.includes('진짜 어시스턴트 답변'));
  ok('digest drops isMeta turns', !text.includes('커맨드 본문이 확장된 메타 턴'));
  ok('digest drops toolUseResult turns', !text.includes('도구 결과가 user 턴으로'));
  ok('digest drops slash-command echo', !text.includes('okf:okf-config'));
  ok('digest drops local-command output', !text.includes('실행 출력'));
}
{
  // a turn mixing real text with boilerplate must keep the real text (strip, don't drop wholesale)
  const dir = sandbox('digest-mixed');
  const input = path.join(dir, 'mixed.jsonl');
  fs.writeFileSync(input, JSON.stringify({
    type: 'user',
    message: { role: 'user', content: '<command-name>/foo</command-name>\n이건 사용자가 같이 쓴 진짜 문장' },
  }) + '\n');
  const out = path.join(dir, 'out.digest.md');
  digestFile(input, out, 150);
  const text = fs.readFileSync(out, 'utf8');
  ok('digest strips boilerplate but keeps real text in the same turn', text.includes('이건 사용자가 같이 쓴 진짜 문장') && !text.includes('/foo'));
}
{
  // size-based run budget: many small sessions ride along in one run; oversized backlog defers.
  const home = bootstrapped('digest-budget');
  writeConfig(home, { claude_bin: FAKE_CLAUDE, batch_max_digest_kb: 1, batch_max_sessions: 50 });
  fs.mkdirSync(okfPaths(home).raw, { recursive: true });
  // each fixture digests to well under 1KB, so several fit the budget and the rest defer
  const big = 'x'.repeat(700);
  for (let i = 0; i < 5; i++) {
    fs.writeFileSync(
      path.join(okfPaths(home).raw, `2026-07-15--proj--aaaaaaaa-0000-0000-0000-00000000000${i}.jsonl`),
      JSON.stringify({ type: 'user', message: { role: 'user', content: `${big} 세션 ${i}` } }) + '\n'
    );
  }
  runBatch({ okfHome: home, env: { FAKE_CLAUDE_MODE: 'success' } });
  const processed = listRemoveCandidate(home).length;
  const deferredLeft = listRaw(home).length;
  ok('budget processes more than one small session per run', processed >= 1);
  ok('budget defers the rest back to raw instead of dropping them', processed + deferredLeft === 5, `processed=${processed} left=${deferredLeft}`);
}
{
  // A fresh install must not leave an empty bundle — the gate would point at nothing and the
  // whole system looks inert (that misread actually happened). Seeded concepts must also be
  // lint-clean, since a batch would otherwise roll back on its very first run.
  const home = bootstrapped('seed');
  const report = runLint(home);
  ok('seeded bundle is lint-clean', report.errors.length === 0, formatReport(report));
  ok('seed ships OKF format reference', fs.existsSync(path.join(home, 'references', 'okf-format.md')));
  ok('seed ships architecture reference', fs.existsSync(path.join(home, 'references', 'okf-system-architecture.md')));
  ok('seed ships bundle rules', fs.existsSync(path.join(home, 'preferences', 'okf-bundle-rules.md')));
  ok('seed defaults to English', fs.readFileSync(path.join(home, 'references', 'okf-format.md'), 'utf8').includes('What OKF'));
  const rootIndex = fs.readFileSync(okfPaths(home).rootIndex, 'utf8');
  ok('seeded concepts appear in the generated root index', /references.*index\.md\) — 3개/s.test(rootIndex));

  // user edits to a seed file must survive re-bootstrap (a reinstall must not revert them)
  const seedFile = path.join(home, 'references', 'okf-format.md');
  fs.writeFileSync(seedFile, '---\ntype: reference\ntitle: 사용자가 고친 것\n---\n내 내용\n');
  ensureBootstrap(home);
  ok('re-bootstrap does not overwrite user-edited seed files', fs.readFileSync(seedFile, 'utf8').includes('사용자가 고친 것'));
}
{
  // seed_language must switch the seeded content, and fall back rather than leaving it empty
  const home = sandbox('seed-ko');
  fs.mkdirSync(path.join(home, '.okf'), { recursive: true });
  fs.writeFileSync(path.join(home, '.okf', 'config.md'), '---\nseed_language: "ko"\n---\n');
  ensureBootstrap(home);
  ok('seed_language: ko seeds the Korean concepts', fs.readFileSync(path.join(home, 'references', 'okf-format.md'), 'utf8').includes('란 무엇인가'));

  const home2 = sandbox('seed-bogus');
  fs.mkdirSync(path.join(home2, '.okf'), { recursive: true });
  fs.writeFileSync(path.join(home2, '.okf', 'config.md'), '---\nseed_language: "xx-NOPE"\n---\n');
  ensureBootstrap(home2);
  ok('unknown seed_language falls back to English rather than seeding nothing', fs.readFileSync(path.join(home2, 'references', 'okf-format.md'), 'utf8').includes('What OKF'));
}

// ---------------------------------------------------------------------------
console.log('\n=== plugin contract and docs ===');
{
  const batchCommand = fs.readFileSync(path.join(PLUGIN_ROOT, 'commands', 'okf-batch.md'), 'utf8');
  const configCommand = fs.readFileSync(path.join(PLUGIN_ROOT, 'commands', 'okf-config.md'), 'utf8');
  const statusCommand = fs.readFileSync(path.join(PLUGIN_ROOT, 'commands', 'okf-status.md'), 'utf8');
  const visualizeCommand = fs.readFileSync(path.join(PLUGIN_ROOT, 'commands', 'okf-visualize.md'), 'utf8');
  const analysisPath = path.join(PLUGIN_ROOT, 'commands', 'okf-analysis.md');
  const analysisCommand = fs.existsSync(analysisPath) ? fs.readFileSync(analysisPath, 'utf8') : '';
  const pluginManifest = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  ok('command docs never suggest bare /okf-status', !/\/okf-status\b/.test(batchCommand + configCommand));
  ok('status command reports capture observability state', statusCommand.includes('capture-status.json'));
  ok('behavior changes advance the distributable plugin version', pluginManifest.version === '0.1.5');

  const readmes = fs.readdirSync(PLUGIN_ROOT).filter((name) => /^README(?:\.[^.]+)?\.md$/.test(name));
  ok('all localized READMEs document the safe 9000-byte gate default', readmes.length === 8 && readmes.every((name) => {
    const text = fs.readFileSync(path.join(PLUGIN_ROOT, name), 'utf8');
    return /inject_max_lines[^\n]*inject_max_bytes[^\n]*`120` \/ `9000`/.test(text);
  }));
  ok('all localized READMEs keep commands and benchmark conditions in sync', readmes.length === 8 && readmes.every((name) => {
    const text = fs.readFileSync(path.join(PLUGIN_ROOT, name), 'utf8');
    return text.includes('/okf:okf-visualize')
      && /\/okf:okf-analysis\s+\[[^\]]+\]/.test(text)
      && !text.includes('/okf:okf-visualize [path]')
      && /\bA\s+—\s+/.test(text)
      && /\bB\s+—\s+/.test(text)
      && /\bC\s+—\s+/.test(text)
      && /\bD\s+—\s+/.test(text)
      && text.includes('OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs')
      && /<!-- okf-live-benchmark: [^>]+ -->/.test(text);
  }));
  ok('all localized READMEs publish the same pinned OSS validation counts', readmes.length === 8 && readmes.every((name) => {
    const text = fs.readFileSync(path.join(PLUGIN_ROOT, name), 'utf8');
    return text.includes('80900fb') && text.includes('125') && text.includes('127') && text.includes('305')
      && text.includes('f76dff7') && text.includes('784') && text.includes('5,796') && text.includes('990')
      && text.includes('a79df45') && text.includes('46') && text.includes('283') && text.includes('121')
      && text.includes('903c53c') && text.includes('98') && text.includes('2,052') && text.includes('215');
  }));
  ok('all localized READMEs publish the same valid live benchmark result', readmes.length === 8 && readmes.every((name) => {
    const text = fs.readFileSync(path.join(PLUGIN_ROOT, name), 'utf8');
    return text.includes('<!-- okf-live-benchmark: valid-2026-07-15T15-03-01Z -->')
      && text.includes('27,320 / 27,574') && text.includes('9,070 / 9,093')
      && text.includes('22,857 / 22,883') && text.includes('21,507 / 22,261')
      && text.includes('111,381') && text.includes('$0.164360')
      && text.includes('okf-live-2026-07-15T15-03-01-343Z.md')
      && !text.includes('okf-live-benchmark: pending');
  }));

  const workflow = path.join(PLUGIN_ROOT, '.github', 'workflows', 'test.yml');
  ok('CI verifies Linux, macOS, and Windows without external dependencies', fs.existsSync(workflow) && ['ubuntu-latest', 'macos-latest', 'windows-latest'].every((osName) => fs.readFileSync(workflow, 'utf8').includes(osName)));
  ok('visualize command is bundle-only and accepts no repository argument', !/argument-hint|analyzeProject|\$ARGUMENTS/.test(visualizeCommand) && /null/.test(visualizeCommand));
  ok('analysis command validates and analyzes an explicit or current path', /argument-hint/.test(analysisCommand) && /isDirectory/.test(analysisCommand) && /generateViz\(okfHome, target/.test(analysisCommand));
  ok('statusline is optional and never auto-installed by hooks', fs.existsSync(path.join(PLUGIN_ROOT, 'bin', 'statusline.mjs')) && !fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8').includes('statusline'));

  const liveBench = path.join(PLUGIN_ROOT, 'test', 'bench-okf.mjs');
  const liveBenchText = fs.existsSync(liveBench) ? fs.readFileSync(liveBench, 'utf8') : '';
  const localBenchText = fs.readFileSync(path.join(PLUGIN_ROOT, 'test', 'bench.mjs'), 'utf8');
  const benchFixture = path.join(PLUGIN_ROOT, 'test', 'fixtures', 'bench', 'session-one.jsonl');
  ok('live OKF benchmark harness exists and is opt-in', fs.existsSync(liveBench));
  ok('live benchmark records resolved models and official pricing provenance', liveBenchText.includes('resolvedModels') && liveBenchText.includes('officialPricing'));
  ok('live benchmark cost break-even includes measured irrelevant-gate overhead', liveBenchText.includes('gateCostOverhead') && liveBenchText.includes('initialCostUsd'));
  ok('live benchmark explicitly disables orphan sweep for synthetic isolation', liveBenchText.includes("OKF_BENCH_SKIP_SWEEP: '1'"));
  ok('live benchmark sanitizes user-home paths from raw events', liveBenchText.includes("'<USER_HOME>'") && liveBenchText.includes("'<PLUGIN_ROOT>'"));
  if (fs.existsSync(liveBench)) {
    const refused = spawnSync(process.execPath, [liveBench], { cwd: PLUGIN_ROOT, encoding: 'utf8' });
    ok('live benchmark refuses accidental paid execution', refused.status !== 0 && `${refused.stdout}${refused.stderr}`.includes('OKF_RUN_LIVE_BENCH=1'));
  } else {
    ok('live benchmark refuses accidental paid execution', false);
  }
  const fixtureText = fs.existsSync(benchFixture) ? fs.readFileSync(benchFixture, 'utf8') : '';
  ok('live benchmark fixture is deterministic and contains no credential-shaped values', fixtureText.includes('SQLite') && fixtureText.includes('deploy:canary') && !/(sk-ant-|api[_-]?key|password|credential)/i.test(fixtureText));
  const auditHome = bootstrapped('bench-bundle-audit');
  fs.mkdirSync(path.join(auditHome, 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(auditHome, 'decisions', 'bench-target.md'), `---
type: decision
title: Synthetic benchmark target
description: Routes every synthetic benchmark fact
---
SQLite; repository pattern; default exports are prohibited; busy_timeout=5000; Korean; concise;
src/config.mjs; npm run deploy:canary
`);
  const audit = auditBenchmarkBundle(auditHome, '- [target](/decisions/bench-target.md)');
  ok('live benchmark preflight proves all target facts exist and are gate-routed', audit.ready && audit.presentFacts === 8 && audit.routedFacts === 8);
  ok('live benchmark grading accepts semantically identical constrained answers',
    matchesBenchmarkAnswer('export_style', 'named export only (default export 금지)', 'named export only')
      && matchesBenchmarkAnswer('export_style', 'named export만 사용 (default export 금지)', 'named export only')
      && matchesBenchmarkAnswer('failure_solution', 'SQLITE_BUSY 문제는 busy_timeout=5000 설정으로 해결', 'busy_timeout=5000')
      && matchesBenchmarkAnswer('response_language', '한국어', 'Korean')
      && matchesBenchmarkAnswer('response_style', '간결하게', 'concise'));
  ok('local SessionEnd benchmark does not short-circuit capture', !/OKF_BATCH:\s*['"]1['"]/.test(localBenchText));
  ok('smoke hook runner isolates Claude history and suppresses paid auto-batches', /CLAUDE_CONFIG_DIR/.test(runHook.toString()) && /isolatedHome/.test(runHook.toString()) && /startedEpochMs/.test(runHook.toString()));
}

// ---------------------------------------------------------------------------
console.log('\n=== analyze.mjs ===');
{
  // analyze.mjs shipped with zero coverage, which is exactly why an adversarial review found
  // four real extraction bugs in it. These pin the ones that silently produced empty graphs.
  const root = sandbox('analyze');
  const w = (rel, body) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  // Prettier splits any import list past printWidth — line-by-line matching lost these entirely
  w('src/multi.js', 'import {\n  alpha,\n} from \'./dep.js\';\nexport {\n  gamma,\n} from \'./dep2.js\';\n');
  w('src/dep.js', 'export const alpha = 1;\n');
  w('src/dep2.js', 'export const gamma = 3;\n');
  w('src/single.js', "import x from './dep.js';\n");
  // these three are relative *by definition*, yet were all classified as external packages
  w('c/main.c', '#include "util.h"\nint main(){return 0;}\n');
  w('c/util.h', '#pragma once\n');
  w('rb/app.rb', "require_relative 'helper'\n");
  w('rb/helper.rb', 'def helper; end\n');
  w('rs/src/main.rs', 'mod helper;\nfn main(){}\n');
  w('rs/src/helper.rs', 'pub fn h(){}\n');
  // python dotted module paths
  w('py/pkg/a.py', 'from py.pkg.b import thing\n');
  w('py/pkg/b.py', 'thing = 1\n');

  const g = analyzeProject(root);
  const edge = (from, to) => g.edges.some((e) => e.type === 'imports' && e.source === `file:${from}` && e.target === `file:${to}`);
  ok('analyze: multi-line import resolves', edge('src/multi.js', 'src/dep.js'));
  ok('analyze: multi-line re-export resolves', edge('src/multi.js', 'src/dep2.js'));
  ok('analyze: single-line import still resolves', edge('src/single.js', 'src/dep.js'));
  ok('analyze: C quoted include resolves', edge('c/main.c', 'c/util.h'));
  ok('analyze: ruby require_relative resolves', edge('rb/app.rb', 'rb/helper.rb'));
  ok('analyze: rust mod resolves', edge('rs/src/main.rs', 'rs/src/helper.rs'));
  ok('analyze: python dotted module resolves', edge('py/pkg/a.py', 'py/pkg/b.py'));
  ok('analyze: graph reports it was not truncated', g.truncated === false);

  // Found by running against real OSS repos, not fixtures: resolving any specifier as a path
  // made Go's `import "errors"` (stdlib) link to gin's own errors.go — inventing a dependency
  // that does not exist. A language's import is only a file when its syntax says so.
  const phantom = sandbox('analyze-phantom');
  const pw = (rel, body) => {
    const p = path.join(phantom, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  pw('go.mod', 'module example.com/app\n\ngo 1.21\n');
  pw('errors.go', 'package app\n\ntype Err struct{}\n');           // same name as a stdlib package
  pw('path.go', 'package app\n\nfunc P() {}\n');
  pw('main.go', 'package main\n\nimport (\n\t"errors"\n\t"path"\n\t"example.com/app/internal/util"\n)\n\nfunc main() {}\n');
  pw('internal/util/util.go', 'package util\n\nfunc U() {}\n');
  pw('os.py', 'X = 1\n');                                          // same name as a stdlib module
  pw('app.py', 'import os\nimport json\n');
  const pg = analyzeProject(phantom);
  const pdeps = pg.edges.filter((e) => e.type === 'imports');
  ok('analyze: Go stdlib import does not link to a same-named local file', !pdeps.some((e) => e.target === 'file:errors.go' || e.target === 'file:path.go'));
  ok('analyze: Python stdlib import does not link to a same-named local file', !pdeps.some((e) => e.target === 'file:os.py'));
  // ...but a real module-internal Go package must still resolve, as a package node
  ok('analyze: Go module-internal import resolves to a package node', pdeps.some((e) => e.source === 'file:main.go' && e.target === 'module:internal/util'));
  ok('analyze: a Go package node contains its files', pg.edges.some((e) => e.type === 'contains' && e.source === 'module:internal/util' && e.target === 'file:internal/util/util.go'));

  // TypeScript NodeNext writes `import './x.js'` while the file on disk is `x.ts`. Missing this
  // silently flattened a modern TS repo: zod measured 559 files with 3 edges (1% connected).
  const ts = sandbox('analyze-ts');
  const tw = (rel, body) => {
    const p = path.join(ts, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  tw('src/index.ts', "import * as core from './core/index.js';\nimport { thing } from './schemas.js';\n");
  tw('src/schemas.ts', 'export const thing = 1;\n');
  tw('src/core/index.ts', 'export const core = 1;\n');
  const tg = analyzeProject(ts);
  const tdeps = tg.edges.filter((e) => e.type === 'imports');
  ok('analyze: TS NodeNext .js specifier resolves to the .ts source', tdeps.some((e) => e.target === 'file:src/schemas.ts'));
  ok('analyze: TS NodeNext .js directory index resolves', tdeps.some((e) => e.target === 'file:src/core/index.ts'));

  // a bare python import naming a real local package directory must still resolve —
  // blocking it wholesale cost flask's own `from flask import x` (31% -> 21% connected)
  const pkg = sandbox('analyze-pypkg');
  fs.mkdirSync(path.join(pkg, 'src', 'mylib'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'src', 'mylib', '__init__.py'), 'VERSION = 1\n');
  fs.mkdirSync(path.join(pkg, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'tests', 'test_it.py'), 'import mylib\n');
  const pkgG = analyzeProject(pkg);
  ok('analyze: bare python import of a real local package resolves', pkgG.edges.some((e) => e.type === 'imports' && e.target === 'file:src/mylib/__init__.py'));

  // Java/Kotlin/C# were never tested and every one produced a zero-edge graph. Each resolves
  // differently and none of them the way JS does.
  const jvm = sandbox('analyze-jvm');
  const jw = (rel, body) => {
    const p = path.join(jvm, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  // Java: the package path is a suffix of the file path (src/main/java/<pkg>/Class.java)
  jw('lib/src/main/java/com/acme/core/Engine.java', 'package com.acme.core;\n\nimport com.acme.util.Helper;\nimport java.util.List;\n\npublic class Engine {}\n');
  jw('lib/src/main/java/com/acme/util/Helper.java', 'package com.acme.util;\n\npublic class Helper {}\n');
  // Kotlin: no semicolons, and member imports name a symbol inside the file
  jw('app/src/main/kotlin/com/acme/app/Main.kt', 'package com.acme.app\n\nimport com.acme.core.Engine\nimport com.acme.model.Status.ACTIVE\n\nfun main() {}\n');
  jw('app/src/main/kotlin/com/acme/model/Status.kt', 'package com.acme.model\n\nenum class Status { ACTIVE }\n');
  const jg = analyzeProject(jvm);
  const jdeps = jg.edges.filter((e) => e.type === 'imports');
  ok('analyze: Java package import resolves through the source-root prefix', jdeps.some((e) => e.source === 'file:lib/src/main/java/com/acme/core/Engine.java' && e.target === 'file:lib/src/main/java/com/acme/util/Helper.java'));
  ok('analyze: Java stdlib import (java.util.List) creates no edge', !jdeps.some((e) => /List/.test(e.target)));
  ok('analyze: Kotlin import resolves without a semicolon', jdeps.some((e) => e.target === 'file:lib/src/main/java/com/acme/core/Engine.java' && e.source === 'file:app/src/main/kotlin/com/acme/app/Main.kt'));
  ok('analyze: Kotlin member import resolves to the declaring file', jdeps.some((e) => e.target === 'file:app/src/main/kotlin/com/acme/model/Status.kt'));
  ok('analyze: Kotlin declarations are extracted', jg.nodes.some((n) => n.type === 'class' && n.name === 'Status'));

  // C#: `using` names a namespace, which does not correspond to a file path at all —
  // real repos put namespace Polly in src/Polly.RateLimiting/. Model it as a namespace node.
  const cs = sandbox('analyze-cs');
  const cw = (rel, body) => {
    const p = path.join(cs, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  cw('src/Acme.Core/Pipeline.cs', 'using System.Threading;\nusing Acme.Utils;\n\nnamespace Acme.Core;\n\npublic sealed class Pipeline {}\n');
  cw('src/Acme.Core/Helper.cs', 'namespace Acme.Utils;\n\ninternal static class Helper {}\n');
  const cg = analyzeProject(cs);
  ok('analyze: C# using resolves to a namespace node declared in the repo', cg.edges.some((e) => e.type === 'imports' && e.source === 'file:src/Acme.Core/Pipeline.cs' && e.target === 'module:Acme.Utils'));
  ok('analyze: a C# namespace node contains the files declaring it', cg.edges.some((e) => e.type === 'contains' && e.source === 'module:Acme.Utils' && e.target === 'file:src/Acme.Core/Helper.cs'));
  ok('analyze: C# using of a namespace the repo does not declare stays external', !cg.nodes.some((n) => n.id === 'module:System.Threading'));
  ok('analyze: C# declarations are extracted', cg.nodes.some((n) => n.type === 'class' && n.name === 'Pipeline'));

  // PHP relationships are namespace/symbol based, not arbitrary filename matches. Grouped
  // imports and aliases must resolve only to declarations that actually exist in this repo.
  const php = sandbox('analyze-php');
  const phw = (rel, body) => {
    const p = path.join(php, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  phw('composer.json', JSON.stringify({ autoload: { 'psr-4': { 'Acme\\\\': 'src/' } } }));
  phw('src/Domain/User.php', '<?php\nnamespace Acme\\Domain;\nclass User {}\ninterface Identified {}\ntrait Auditable {}\nenum State { case Active; }\nfunction normalize() {}\n');
  phw('src/Domain/Order.php', '<?php\nnamespace Acme\\Domain;\nclass Order {}\n');
  phw('src/App/Service.php', "<?php\nnamespace Acme\\App;\nuse Acme\\Domain\\{User as Account, Order};\nuse Vendor\\Package\\User;\nrequire_once '../Support/helpers.php';\nclass Service {}\n");
  phw('src/Support/helpers.php', '<?php\nfunction helper() {}\n');
  const phg = analyzeProject(php);
  const phImports = phg.edges.filter((e) => e.type === 'imports' && e.source === 'file:src/App/Service.php');
  ok('analyze: PHP grouped use resolves repo-declared symbols', phImports.some((e) => e.target === 'file:src/Domain/User.php') && phImports.some((e) => e.target === 'file:src/Domain/Order.php'));
  ok('analyze: PHP external namespace does not cross-link to a same-named local symbol', phImports.filter((e) => e.target === 'file:src/Domain/User.php').length === 1);
  ok('analyze: PHP require/include relative path resolves', phImports.some((e) => e.target === 'file:src/Support/helpers.php'));
  for (const name of ['User', 'Identified', 'Auditable', 'State', 'normalize']) {
    ok(`analyze: PHP declaration extracted: ${name}`, phg.nodes.some((n) => n.name === name && n.filePath === 'src/Domain/User.php'));
  }

  // C/C++ declarations and include resolution must remain conservative: quoted includes are
  // local, while angle-bracket includes are internal only when a unique local header exists.
  const native = sandbox('analyze-native');
  const nw = (rel, body) => {
    const p = path.join(native, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  nw('include/acme/model.h', '#pragma once\nstruct Model {};\nenum State { Ready };\ntypedef unsigned long Id;\n');
  nw('include/acme/widget.hpp', '#pragma once\nnamespace acme {\nclass Widget {};\nunion Value { int i; };\n}\n');
  nw('compat/stdint.h', '#pragma once\n');
  nw('src/main.cpp', '#include "acme/model.h"\n#include <acme/widget.hpp>\n#include <vector>\n#include <stdint.h>\nint run(int value) { return value; }\nint declared_only(int value);\n');
  const ng = analyzeProject(native);
  const nImports = ng.edges.filter((e) => e.type === 'imports' && e.source === 'file:src/main.cpp');
  ok('analyze: C/C++ nested quoted include resolves from include root', nImports.some((e) => e.target === 'file:include/acme/model.h'));
  ok('analyze: C/C++ unique local angle include resolves', nImports.some((e) => e.target === 'file:include/acme/widget.hpp'));
  ok('analyze: C/C++ system header does not cross-link', !nImports.some((e) => /vector|stdint/.test(e.target)));
  for (const name of ['Model', 'State', 'Id', 'Widget', 'Value', 'acme', 'run']) {
    ok(`analyze: C/C++ declaration extracted: ${name}`, ng.nodes.some((n) => n.name === name));
  }
  ok('analyze: C/C++ prototype is not reported as a function definition', !ng.nodes.some((n) => n.name === 'declared_only'));

  // Swift file imports name modules, so file edges come only from explicit type relationships.
  const swift = sandbox('analyze-swift');
  const sw = (rel, body) => {
    const p = path.join(swift, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  sw('Sources/App/Types.swift', 'protocol Runnable {}\nclass Base {}\nstruct Config {}\nenum Mode { case fast }\nactor Worker {}\ntypealias Identifier = String\nclass Container {\n    enum Error {}\n}\n');
  sw('Sources/App/Feature.swift', 'import Foundation\nclass Feature: Base, Runnable {}\nclass NetworkFailure: Error {}\nextension Config: Runnable {}\nfunc launch() {}\n');
  sw('scripts/helper.py', 'class Unrelated:\n    pass\n');
  sw('web/vendor.js', 'class Vendored {}\n');
  const swg = analyzeProject(swift);
  for (const name of ['Runnable', 'Base', 'Config', 'Mode', 'Worker', 'Identifier', 'Feature', 'launch']) {
    ok(`analyze: Swift declaration extracted: ${name}`, swg.nodes.some((n) => n.name === name));
  }
  ok('analyze: Swift inheritance and conformance create explicit relations', swg.edges.some((e) => e.type === 'extends' && /Feature/.test(e.source) && /Base/.test(e.target)) && swg.edges.some((e) => e.type === 'conforms' && /Feature/.test(e.source) && /Runnable/.test(e.target)));
  ok('analyze: Swift extension creates an explicit relation', swg.edges.some((e) => e.type === 'extends' && /extension/.test(e.source) && /Config/.test(e.target)));
  ok('analyze: Swift external protocol does not link to a nested same-named type', !swg.edges.some((e) => /NetworkFailure/.test(e.source) && /Error/.test(e.target)));
  ok('analyze: Swift project reports Swift as its primary structure', swg.project.primaryLanguages?.[0] === 'swift');

  // Multi-line block comments must not manufacture imports or declarations. The raw regex
  // extractor previously skipped only lines beginning with /* or *, not arbitrary interior text.
  const comments = sandbox('analyze-comments');
  fs.writeFileSync(path.join(comments, 'fake.cpp'), '/*\n#include "ghost.h"\nclass Phantom {};\n*/\nconst char *s = "class StringGhost {};";\nstruct Real {};\n');
  fs.writeFileSync(path.join(comments, 'ghost.h'), 'struct Ghost {};\n');
  const commentGraph = analyzeProject(comments);
  ok('analyze: block-comment import is ignored', !commentGraph.edges.some((e) => e.type === 'imports'));
  ok('analyze: block-comment and string declarations are ignored', !commentGraph.nodes.some((n) => n.name === 'Phantom' || n.name === 'StringGhost'));
  ok('analyze: real declaration after comment is retained', commentGraph.nodes.some((n) => n.name === 'Real'));

  // Path semantics and machine-readable language coverage prevent false "empty repo" success.
  let missingError = '';
  try { analyzeProject(path.join(root, 'does-not-exist')); } catch (err) { missingError = err.message; }
  ok('analyze: missing path throws a clear error', /경로가 없습니다/.test(missingError));
  const notDir = path.join(root, 'src', 'dep.js');
  let fileError = '';
  try { analyzeProject(notDir); } catch (err) { fileError = err.message; }
  ok('analyze: file path is distinguished from a directory', /디렉터리가 아닙니다/.test(fileError));
  const empty = sandbox('analyze-empty');
  const emptyGraph = analyzeProject(empty);
  ok('analyze: empty directory returns a complete empty graph', emptyGraph.nodes.length === 0 && emptyGraph.edges.length === 0 && emptyGraph.truncated === false);
  const cyclic = sandbox('analyze-symlink-cycle');
  fs.writeFileSync(path.join(cyclic, 'main.js'), 'export function main() {}\n');
  let symlinkSupported = true;
  try {
    fs.symlinkSync(cyclic, path.join(cyclic, 'loop'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    symlinkSupported = false;
  }
  const cyclicGraph = analyzeProject(cyclic);
  ok('analyze: directory symlink cycles terminate without duplicate traversal', !symlinkSupported
    || cyclicGraph.nodes.filter((node) => node.type === 'file').length === 1);
  ok('analyze: per-language statistics match PHP nodes and edges', phg.languageStats?.php?.files === 4 && phg.languageStats.php.declarations >= 7 && phg.languageStats.php.internalEdges === phg.edges.filter((e) => e.type === 'imports' && e.source.includes('.php')).length);

  // a skipped file must not claim "0 lines, 0 imports" — that's fabricated, not measured
  const big = sandbox('analyze-big');
  fs.writeFileSync(path.join(big, 'huge.js'), "import x from './y.js';\n" + '// pad\n'.repeat(90000));
  fs.writeFileSync(path.join(big, 'y.js'), 'export default 1;\n');
  const gb = analyzeProject(big);
  const hugeNode = gb.nodes.find((n) => n.id === 'file:huge.js');
  ok('analyze: oversized file is marked skipped, not described as empty', /분석 생략/.test(hugeNode.summary) && !/0줄/.test(hugeNode.summary));

  // external packages must stay external rather than being linked to an arbitrary file
  const extTags = g.nodes.filter((n) => n.type === 'file').flatMap((n) => n.tags.filter((t) => t.startsWith('dep:')));
  ok('analyze: unresolvable specs remain external deps', extTags.length === 0 || extTags.every((t) => !t.includes('./')));
}

console.log('\n=== viz.mjs ===');
{
  // The viz renders concept text that originally came from a user's own past conversations,
  // so a malicious/accidental payload in a concept must never execute.
  const home = bootstrapped('viz-xss');
  fs.mkdirSync(path.join(home, 'decisions'), { recursive: true });
  fs.writeFileSync(
    path.join(home, 'decisions', 'evil.md'),
    '---\ntype: decision\ntitle: "</script><img src=x onerror=alert(1)>"\ndescription: "<img src=y onerror=alert(2)>"\ntimestamp: 2026-07-15\n---\n</script><script>alert(3)</script>\n'
  );
  const html = renderHtml(buildGraph(home, null));
  ok('viz: payload never appears as a live closing script tag', !/<\/script><img/i.test(html));
  ok('viz: angle brackets in concept data are escaped in the embedded JSON', html.includes('\\u003c/script>'));
  ok('viz: output has no external network references', !/src="http|href="http|cdn\.|fetch\(/i.test(html));

  // The codebase is the subject; OKF knowledge is the lens on it. A concept about some other
  // project has no business appearing as a node — that's screen noise, not information.
  const rel = bootstrapped('viz-relevance');
  fs.mkdirSync(path.join(rel, 'decisions'), { recursive: true });
  const repo = sandbox('viz-relevance-repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'server.js'), 'export const serve = () => {};\n');
  fs.writeFileSync(
    path.join(rel, 'decisions', 'about-this-repo.md'),
    '---\ntype: decision\ntitle: about this repo\ndescription: mentions src/server.js\ntimestamp: 2026-07-15\n---\n`src/server.js` handles it. See [/decisions/context.md](/decisions/context.md).\n'
  );
  fs.writeFileSync(
    path.join(rel, 'decisions', 'context.md'),
    '---\ntype: decision\ntitle: linked context\ndescription: reached via a link from a relevant concept\ntimestamp: 2026-07-15\n---\nbackground\n'
  );
  fs.writeFileSync(
    path.join(rel, 'decisions', 'unrelated.md'),
    '---\ntype: decision\ntitle: totally unrelated project\ndescription: about some other codebase entirely\ntimestamp: 2026-07-15\n---\nnothing to do with the repo under analysis\n'
  );
  const rg = buildGraph(rel, repo);
  const keptIds = rg.nodes.filter((n) => n.kind === 'okf').map((n) => n.id);
  ok('viz: concept that names a file in the repo is kept', keptIds.includes('/decisions/about-this-repo.md'));
  ok('viz: concept linked from a relevant one is kept for context', keptIds.includes('/decisions/context.md'));
  ok('viz: concept unrelated to the analyzed repo is dropped', !keptIds.includes('/decisions/unrelated.md'));
  // bootstrapped() also seeds OKF's own concepts, so assert on behaviour rather than a total
  ok('viz: the number of hidden concepts is reported, not silently swallowed', rg.meta.okfFiltered > 0 && rg.meta.okfTotal === rg.meta.okfCount + rg.meta.okfFiltered);

  // a bundle with nothing about this repo should show code only — not the whole bundle
  const none = buildGraph(rel, sandbox('viz-empty-repo'));
  ok('viz: bundle irrelevant to the repo yields zero concept nodes', none.nodes.every((n) => n.kind !== 'okf'));

  // Basename matching collapses on names every project has. Found on a real repo: a concept
  // explaining OKF's own index.md linked to zod's unrelated rfcs/index.md, making an unrelated
  // codebase look related. Such names must match on full path only.
  const amb = bootstrapped('viz-ambiguous');
  fs.mkdirSync(path.join(amb, 'references'), { recursive: true });
  fs.writeFileSync(
    path.join(amb, 'references', 'talks-about-index.md'),
    '---\ntype: reference\ntitle: mentions index.md generically\ndescription: the bundle regenerates index.md\ntimestamp: 2026-07-15\n---\nThe generator rewrites `index.md` and `README.md` wholesale.\n'
  );
  const ambRepo = sandbox('viz-ambiguous-repo');
  fs.mkdirSync(path.join(ambRepo, 'rfcs'), { recursive: true });
  fs.writeFileSync(path.join(ambRepo, 'rfcs', 'index.md'), '# unrelated project rfc index\n');
  fs.writeFileSync(path.join(ambRepo, 'README.md'), '# unrelated\n');
  const ambG = buildGraph(amb, ambRepo);
  ok('viz: a generic filename does not falsely link a concept to an unrelated repo', ambG.meta.crossCount === 0 && ambG.meta.okfCount === 0);

  // bundle-only view (no repo) must still show everything, including the concepts filtered above
  const all = buildGraph(rel, null);
  const allIds = all.nodes.filter((n) => n.kind === 'okf').map((n) => n.id);
  ok('viz: with no repo, the whole bundle is shown', allIds.includes('/decisions/unrelated.md') && allIds.length === rg.meta.okfTotal);

  // "what do I read first" should be answered explicitly, not by squinting at the picture.
  // Entry points (nothing imports them) and depended-on hubs answer different questions and
  // must not be conflated into one degree count.
  const spring = sandbox('viz-spring');
  const sw = (rel, body) => {
    const p = path.join(spring, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  sw('src/controller/UserController.js', "import { UserService } from '../service/UserService.js';\nimport { logger } from '../util/logger.js';\nexport class UserController {}\n");
  sw('src/service/UserService.js', "import { logger } from '../util/logger.js';\nexport class UserService {}\n");
  sw('src/util/logger.js', 'export const logger = console;\n');
  const sg = buildGraph(bootstrapped('viz-spring-bundle'), spring);
  ok('viz: analysis exposes language coverage instead of implying every file was analyzed', sg.meta.languageStats?.javascript?.files === 3 && sg.meta.primaryLanguages?.[0] === 'javascript');
  const deps = sg.edges.filter((e) => e.type === 'imports');
  const outOf = (f) => deps.filter((e) => e.source === `file:${f}`).length;
  const inTo = (f) => deps.filter((e) => e.target === `file:${f}`).length;
  ok('viz: a controller is an entry point (imports others, nothing imports it)', outOf('src/controller/UserController.js') === 2 && inTo('src/controller/UserController.js') === 0);
  ok('viz: a util is depended on rather than an entry point', inTo('src/util/logger.js') === 2 && outOf('src/util/logger.js') === 0);
  const springHtml = renderHtml(sg);
  ok('viz: the graph ships the entry-point list', springHtml.includes('Start here'));
  ok('viz: the graph ships the depended-on list', springHtml.includes('Most depended on'));
  // contains edges (file -> its classes) must not inflate out-degree into a fake entry point
  ok('viz: contains edges are excluded from dependency degree', springHtml.includes("DEP_EDGE"));

  // type is user data — it must not walk the prototype chain into a color lookup
  const proto = bootstrapped('viz-proto');
  fs.mkdirSync(path.join(proto, 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(proto, 'decisions', 'p.md'), '---\ntype: constructor\ntitle: p\ntimestamp: 2026-07-15\n---\nbody\n');
  const protoHtml = renderHtml(buildGraph(proto, null));
  ok('viz: prototype-chain type does not leak a function into the output', !/background:function|\[native code\]/.test(protoHtml));
}

// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
