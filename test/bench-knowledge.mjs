#!/usr/bin/env node
// 벤치마크가 쓸 "실제 지식"을 만든다. 손으로 concept을 쓰지 않는 이유는 단순하다 — 손으로 쓴
// 지식으로 측정하면 그건 OKF 파이프라인이 아니라 내 글솜씨를 측정하는 것이다.
//
// 여기서 하는 일은 진짜 세션을 돌리는 것뿐이다: 핀 고정된 공개 저장소를 claude가 실제로 탐색하고
// 결론을 남긴다. 그 결과물인 Claude Code transcript(JSONL)를 픽스처로 얼려 커밋한다. 이후 배치가
// 그 transcript를 실제 ingest 경로로 씹어 concept을 만든다.
//
// 실행: node test/bench-knowledge.mjs --target slim --count 40 --dir <경로>
// 유료다. transcript는 한 번 만들어 커밋하면 재생성할 필요가 없다.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ROOT = path.join(ROOT, 'test', 'fixtures', 'bench', 'transcripts');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const target = arg('target', 'slim');
const targetDir = path.resolve(arg('dir', ''));
const count = Number(arg('count', '10'));
const model = arg('model', 'haiku');
const concurrency = Number(arg('concurrency', '6'));
// target: 벤치 시나리오가 묻는 그 사실을 실제로 조사했던 "이전 작업" 세션. 이 세션의 결론이
//   concept이 되고, 나중 세션이 그걸 다시 탐색하지 않아도 되는지를 측정한다.
// filler: 같은 저장소에 대한 다른 실제 작업. 번들 볼륨을 만든다.
const mode = arg('mode', 'filler');
const only = arg('only', '');
const budget = arg('budget', '0.25');
const turns = arg('turns', '8');

if (!fs.existsSync(targetDir)) {
  console.error(`대상 디렉토리가 없습니다: ${targetDir}`);
  process.exit(2);
}
if (process.env.OKF_RUN_LIVE_BENCH !== '1') {
  console.error('유료 실행입니다. OKF_RUN_LIVE_BENCH=1을 명시하세요.');
  process.exit(2);
}

// 탐색 주제는 저장소 자체에서 뽑는다 — 내가 지어낸 가짜 주제가 아니라 그 저장소에 실제로 있는
// 파일들이다. 사람이 하는 일과 같다: 코드베이스를 하나씩 이해해 나간다.
function topics() {
  if (mode === 'target') {
    const scenarios = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'bench', 'scenarios.json'), 'utf8')).scenarios;
    const want = only ? only.split(',') : null;
    return scenarios.filter((s) => s.target === target && (!want || want.includes(s.key))).map((s) => ({
      slug: `target-${s.key}`,
      prompt: s.work_prompt_ko,
      // slim_stale의 지식은 옛 커밋에서 만든다. 인위적으로 틀린 지식을 심는 게 아니라, 코드가
      // 나중에 바뀌면서 저절로 낡는 실제 경로 그대로다(f897118b가 이스케이프를 도입했다).
      atCommit: s.key === 'slim_stale' ? 'f897118b^' : null,
    }));
  }
  if (target === 'slim') {
    const files = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === '.git' || e.name === 'vendor') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.php') && !p.includes('/tests/')) files.push(path.relative(targetDir, p));
      }
    };
    walk(targetDir);
    files.sort();
    return files.slice(0, count).map((rel) => ({
      slug: rel.replace(/[^\w]+/g, '-').toLowerCase(),
      prompt: `이 저장소(Slim PHP 프레임워크)의 \`${rel}\` 를 읽고, 이 파일이 프레임워크 안에서 맡는 역할과 이 코드를 다룰 때 주의할 점을 조사해서 결론을 남겨라. 필요하면 관련 파일도 같이 읽어라. 조사 결과를 근거(파일:라인)와 함께 간결히 정리하라.`,
    }));
  }
  const files = fs.readdirSync(path.join(targetDir, 'text'))
    .filter((n) => n.endsWith('.md')).sort();
  const picked = [];
  // 651개에서 고르게 뽑는다. 앞에서 N개만 뽑으면 번호가 낮은(오래된) RFC에만 지식이 쏠린다.
  const stride = Math.max(1, Math.floor(files.length / count));
  for (let i = 0; i < files.length && picked.length < count; i += stride) picked.push(files[i]);
  return picked.map((name) => ({
    slug: name.replace(/[^\w]+/g, '-').toLowerCase(),
    prompt: `이 문서 더미(rust-lang/rfcs)에서 \`text/${name}\` 를 읽고, 이 RFC가 내린 핵심 결정과 그 근거, 그리고 이 RFC가 명시적으로 기각한 대안이 있다면 그 이유를 조사해서 정리하라. 근거가 되는 문서의 해당 부분을 인용하라.`,
  }));
}

// 옛 커밋의 코드를 조사해야 하는 세션(낡은 지식의 출처)은 그 커밋의 워크트리에서 돌린다.
function checkoutAt(commitish) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-live-bench-old-'));
  const wt = path.join(dir, 'repo');
  const r = spawnSync('git', ['worktree', 'add', '--detach', wt, commitish], { cwd: targetDir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git worktree add ${commitish} 실패: ${r.stderr}`);
  return wt;
}

function runSession(topic, cwd) {
  return new Promise((resolve) => {
    const args = ['-p', '--output-format', 'json', '--safe-mode', '--model',
      topic.atCommit ? 'sonnet' : model,
      '--max-turns', turns, '--max-budget-usd', budget, '--permission-mode', 'dontAsk',
      '--tools', 'Read,Glob,Grep', '--allowedTools', 'Read,Glob,Grep'];
    // OKF_BATCH=1: 이 세션들이 사용자의 진짜 번들에 배치를 트리거하지 못하게 막는다.
    const child = spawn('claude', args, {
      cwd, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, OKF_BATCH: '1' },
    });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', () => {});
    child.stdin.end(topic.prompt);
    child.on('close', () => {
      let parsed = null;
      try { parsed = JSON.parse(out); } catch { /* 세션 실패는 아래에서 걸러진다 */ }
      if (Array.isArray(parsed)) parsed = parsed.reverse().find((e) => e.type === 'result') || null;
      resolve({ topic, result: parsed });
    });
  });
}

// 실제 transcript는 Claude Code가 ~/.claude/projects/<cwd슬러그>/<session_id>.jsonl 에 쓴다.
// 그걸 그대로 픽스처로 옮긴다 — 내가 재구성한 게 아니라 Claude Code가 쓴 원본이다.
function claimTranscript(sessionId, outPath) {
  const projects = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projects)) return null;
  for (const dir of fs.readdirSync(projects)) {
    const p = path.join(projects, dir, `${sessionId}.jsonl`);
    if (fs.existsSync(p)) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      // 옮긴다(복사가 아니라). 사용자의 실제 번들 sweep이 이 벤치 세션을 지식으로 착각해
      // 수집하는 오염을 원천 차단한다.
      fs.renameSync(p, outPath);
      return p;
    }
  }
  return null;
}

const list = topics();
console.log(`${target}: 세션 ${list.length}개 (model=${model}, concurrency=${concurrency})`);
const outDir = path.join(OUT_ROOT, target);
fs.mkdirSync(outDir, { recursive: true });

let cursor = 0;
let ok = 0;
let failed = 0;
let cost = 0;
const manifest = [];

async function worker() {
  while (cursor < list.length) {
    const topic = list[cursor++];
    let cwd = targetDir;
    if (topic.atCommit) {
      cwd = checkoutAt(topic.atCommit);
      process.stderr.write(`  ${topic.slug}: 옛 커밋 ${topic.atCommit} 워크트리에서 조사\n`);
    }
    const { result } = await runSession(topic, cwd);
    const sessionId = result?.session_id;
    if (!result || result.is_error || !sessionId) {
      failed++;
      process.stderr.write(`  실패: ${topic.slug.slice(0, 30)} subtype=${result?.subtype} err=${result?.is_error} :: ${String(result?.result || '').slice(0, 120)}\n`);
      continue;
    }
    cost += Number(result.total_cost_usd) || 0;
    const outPath = path.join(outDir, `${mode === "target" ? "0" : "1"}${String(manifest.length).padStart(3, "0")}-${topic.slug.slice(0, 44)}.jsonl`);
    const from = claimTranscript(sessionId, outPath);
    if (!from) { failed++; continue; }
    ok++;
    manifest.push({ file: path.basename(outPath), topic: topic.slug, mode, atCommit: topic.atCommit || null, bytes: fs.statSync(outPath).size });
    process.stderr.write(`[${ok + failed}/${list.length}] ${topic.slug.slice(0, 40)} (\$${cost.toFixed(3)})\n`);
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));
fs.writeFileSync(path.join(outDir, `manifest-${mode}.json`), `${JSON.stringify({
  target, model, generatedAt: new Date().toISOString(), sessions: manifest,
}, null, 2)}\n`);
console.log(`완료: ${ok}개 성공, ${failed}개 실패, 비용 \$${cost.toFixed(4)}`);
