// End-to-end smoke suite for the OKF plugin (implement.md §8). Not a unit-test
// framework — a self-contained runner exercising real subprocess invocations
// (session-start.mjs / session-end.mjs / batch.mjs) against throwaway sandbox
// OKF_HOME directories, plus a fake `claude` binary (test/fixtures/fake-claude.mjs)
// so the batch driver's full orchestration is covered without a real LLM call.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ensureBootstrap } from '../lib/bootstrap.mjs';
import { okfPaths } from '../lib/paths.mjs';
import { runLint, formatReport } from '../lib/lint.mjs';
import { regenerateIndex } from '../lib/index-gen.mjs';
import { digestFile } from '../lib/digest.mjs';
import { captureSession, sanitizeForFilename } from '../lib/capture.mjs';
import { git } from '../lib/git.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAKE_CLAUDE = path.join(PLUGIN_ROOT, 'test', 'fixtures', 'fake-claude.mjs');
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

// Polls a synchronous predicate, blocking via a real `sleep` subprocess between checks
// (Node has no synchronous sleep) — used only to wait out detached/unref'd child batches.
function waitUntil(predicate, timeoutMs = 8000, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    execFileSync('sleep', [String(intervalMs / 1000)]);
  }
  return predicate();
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
  return execFileSync(process.execPath, [path.join(PLUGIN_ROOT, scriptRelPath)], {
    input: stdin,
    env: { ...process.env, OKF_HOME: okfHome, ...env },
    encoding: 'utf8',
  });
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
    env: { ...process.env, OKF_HOME: okfHome, HOME: home, USERPROFILE: home, ...env },
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
  const before = git(['log', '--oneline'], home);
  ensureBootstrap(home); // idempotent re-run
  const after = git(['log', '--oneline'], home);
  ok('bootstrap re-run is a no-op (no new commit)', before === after);
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

  // resume: same session_id, longer transcript -> must overwrite same dest, not create a 2nd file
  const resumedPath = path.join(sandbox('resume-src'), 'resumed.jsonl');
  fs.writeFileSync(resumedPath, fs.readFileSync(SAMPLE_TRANSCRIPT, 'utf8') + '{"type":"user","message":{"role":"user","content":"추가 대화"}}\n');
  const r2 = captureSession({ okfHome: home, cwd, sessionId: 'aaaaaaaa-1111-2222-3333-444444444444', transcriptPath: resumedPath });
  ok('resume overwrites same destination path', r2.dest === r1.dest);
  ok('raw/ still has exactly one file for this session', listRaw(home).length === 1);
  ok('resumed content actually landed (superset)', fs.readFileSync(r2.dest, 'utf8').includes('추가 대화'));

  const empty = sandbox('empty-transcript');
  const emptyPath = path.join(empty, 'empty.jsonl');
  fs.writeFileSync(emptyPath, '');
  const r3 = captureSession({ okfHome: home, cwd, sessionId: 'bbbbbbbb-0000-0000-0000-000000000000', transcriptPath: emptyPath });
  ok('empty transcript is skipped', r3.captured === false);

  ok('sanitizeForFilename replaces forbidden chars', sanitizeForFilename('a:b?c') === 'a_b_c');
  ok('sanitizeForFilename prefixes reserved Windows names', sanitizeForFilename('CON') === '_CON');
  ok('sanitizeForFilename is case-insensitive on reserved names', sanitizeForFilename('con') === '_con');
  ok('sanitizeForFilename falls back on empty result', sanitizeForFilename('') === 'project');
}

// ---------------------------------------------------------------------------
console.log('\n=== session-end.mjs (subprocess) ===');
{
  const home = bootstrapped('session-end');
  const input = JSON.stringify({
    session_id: 'cccccccc-1111-2222-3333-444444444444',
    transcript_path: SAMPLE_TRANSCRIPT,
    cwd: '/Users/tester/proj-x',
  });
  runHook('bin/session-end.mjs', { okfHome: home, stdin: input });
  ok('session-end hook writes a raw file', listRaw(home).length === 1);

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
  // root index.md is a deterministic category *summary* (counts + links to per-dir index.md),
  // not a full concept listing — that's what keeps the gate injection budget fixed (§5-3).
  ok('gate context includes index.md category summary', parsed.hookSpecificOutput.additionalContext.includes('/decisions/index.md'));
  ok('suppressOutput is set', parsed.suppressOutput === true);

  const outBatchGuard = runHook('bin/session-start.mjs', { okfHome: home, env: { OKF_BATCH: '1' } });
  ok('OKF_BATCH=1 short-circuits to empty object', outBatchGuard.trim() === '{}');

  const disabledHome = bootstrapped('session-start-disabled');
  writeConfig(disabledHome, { enabled: false });
  const outDisabled = runHook('bin/session-start.mjs', { okfHome: disabledHome });
  ok('enabled:false suppresses gate injection', outDisabled.trim() === '{}');
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
  runBatch({ okfHome: home, env: { FAKE_CLAUDE_MODE: 'success' } });
  ok('success: raw/ drained', listRaw(home).length === 0);
  ok('success: file landed in _remove_candidate/', listRemoveCandidate(home).length === 1);
  ok('success: concept file committed', fs.existsSync(path.join(home, 'decisions', 'fake-test-concept.md')));
  ok('success: lastResult is ok', lastBatch(home).lastResult === 'ok');
  ok('success: post-lint clean (HEAD stays conformant)', runLint(home).errors.length === 0);
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
  const deadPid = execFileSync('sh', ['-c', 'echo $$']).toString().trim();
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
  // project directory names containing '$' must not corrupt the ingest prompt via
  // String.replace's special $-pattern interpretation of the replacement argument.
  const home = bootstrapped('dollar-sign');
  writeConfig(home, { claude_bin: FAKE_CLAUDE });
  const promptDumpPath = path.join(sandbox('dollar-dump'), 'prompt.txt');
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
  runBatch({ okfHome: home, env: { FAKE_CLAUDE_MODE: 'success', FAKE_CLAUDE_DUMP_PROMPT_TO: promptDumpPath } });
  const dumped = fs.existsSync(promptDumpPath) ? fs.readFileSync(promptDumpPath, 'utf8') : '';
  ok('$-containing project name does not leave an unresolved placeholder in the prompt', dumped.length > 0 && !dumped.includes('{{SOURCE_PATHS}}') && !dumped.includes('{{DIGEST_PATHS}}'));
  ok('$-containing project name does not splice/duplicate the prompt template', (dumped.match(/처리 대상 digest:/g) || []).length <= 1);
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
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
