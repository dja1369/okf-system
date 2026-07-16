// 성능 측정. 이 시스템은 사용자의 모든 세션에 훅으로 끼어들기 때문에, "빠르다"는 주장이 아니라
// 수치여야 한다. 특히 SessionStart는 사용자가 프롬프트를 치기 전에 끝나야 하고, SessionEnd는
// 세션 종료를 지연시키면 안 된다.
//
// 실행: node test/bench.mjs [분석할_저장소_경로]
// 여기서 재는 건 우리 코드의 시간뿐이다 — 배치의 `claude -p` 호출(수십 초~분)은 LLM 시간이라
// 측정 대상이 아니고, 애초에 백그라운드에서 detached로 돈다.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ensureBootstrap } from '../lib/bootstrap.mjs';
import { okfPaths } from '../lib/paths.mjs';
import { analyzeProject } from '../lib/analyze.mjs';
import { buildGraph, renderHtml } from '../lib/viz.mjs';
import { digestFile } from '../lib/digest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = path.join(ROOT, 'test', 'fixtures', 'sample-transcript.jsonl');
const target = process.argv[2] || ROOT;

function sandbox(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `okf-bench-${label}-`));
}

// 중앙값을 쓴다 — 평균은 첫 실행의 파일시스템 캐시 미스 한 번에 끌려간다.
function measure(label, fn, runs = 5) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  const med = times[Math.floor(times.length / 2)];
  console.log(`${label.padEnd(42)} ${med.toFixed(1).padStart(8)}ms  (min ${times[0].toFixed(1)}, max ${times[times.length - 1].toFixed(1)})`);
  return med;
}

// 훅은 별도 프로세스로 실행되므로 node 기동 시간이 실제 체감의 큰 부분이다 — 라이브러리 함수만
// 재면 사용자가 겪는 지연을 과소평가하게 된다. 그래서 실제 프로세스로 잰다.
function measureProcess(label, args, opts, runs = 3) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    try {
      execFileSync(process.execPath, args, { stdio: 'ignore', ...opts });
    } catch {
      // 훅은 fail-open이라 종료코드와 무관하게 시간만 잰다
    }
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  const med = times[Math.floor(times.length / 2)];
  console.log(`${label.padEnd(42)} ${med.toFixed(1).padStart(8)}ms  (min ${times[0].toFixed(1)}, max ${times[times.length - 1].toFixed(1)})`);
  return med;
}

console.log('OKF benchmark');
console.log('node', process.version, '·', os.platform(), os.arch());
console.log('analysis target:', target);
console.log('');

console.log('--- session hooks (per-process, includes node startup) ---');
const home = sandbox('home');
ensureBootstrap(home);
// Keep the batch gate from spawning during SessionEnd measurements without using OKF_BATCH=1,
// because that environment variable short-circuits the hook itself.
fs.writeFileSync(okfPaths(home).lock, JSON.stringify({ pid: process.pid, startedEpochMs: Date.now() }));
const fakeHome = sandbox('fakehome');
const hookEnv = { ...process.env, OKF_HOME: home, HOME: fakeHome, USERPROFILE: fakeHome };

measureProcess('SessionStart (gate injection)', [path.join(ROOT, 'bin', 'session-start.mjs')], {
  env: hookEnv,
  input: '{}',
});
measureProcess('SessionEnd (batch trigger)', [path.join(ROOT, 'bin', 'session-end.mjs')], {
  env: hookEnv,
  input: JSON.stringify({ session_id: 'bench0000-0000-0000-0000-000000000000', transcript_path: SAMPLE, cwd: '/tmp/bench' }),
});
measureProcess('statusline (rendered every turn)', [path.join(ROOT, 'bin', 'statusline.mjs')], { env: hookEnv });

console.log('');
console.log('--- library operations (in-process) ---');
const bootHome = sandbox('boot');
measure('bootstrap (first run, seeds + git init)', () => {
  fs.rmSync(bootHome, { recursive: true, force: true });
  ensureBootstrap(bootHome);
}, 3);

const digestOut = path.join(sandbox('digest'), 'out.md');
measure('digest one session transcript', () => digestFile(SAMPLE, digestOut, 150));

let g;
const analyzeMs = measure('analyze codebase', () => { g = analyzeProject(target); }, 3);
const files = g.nodes.filter((n) => n.type === 'file').length;
console.log(`${''.padEnd(42)} ${files} files, ${g.nodes.length} nodes, ${g.edges.length} edges` + (g.truncated ? ' (TRUNCATED)' : ''));
if (files > 0) console.log(`${''.padEnd(42)} ${(analyzeMs / files).toFixed(2)}ms per file`);

let graph;
measure('build graph (bundle + code + crosslinks)', () => { graph = buildGraph(home, target); }, 3);
let html;
measure('render self-contained HTML', () => { html = renderHtml(graph); }, 3);
console.log(`${''.padEnd(42)} ${(Buffer.byteLength(html) / 1024).toFixed(0)}KB output`);

console.log('');
console.log('--- memory ---');
// before/after 차분은 도중에 GC가 돌면 음수가 나온다(실제로 -1.0MB를 보고했었다). 차분 대신
// 분석 직후의 절대값과 프로세스 RSS를 쓴다 — 덜 정밀하지만 거짓말은 하지 않는다.
const memGraph = analyzeProject(target);
const mem = process.memoryUsage();
console.log(`heap in use after analysis`.padEnd(42) + `${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB`.padStart(10));
console.log(`process RSS`.padEnd(42) + `${(mem.rss / 1024 / 1024).toFixed(1)}MB`.padStart(10));
console.log(`${''.padEnd(42)} for a ${memGraph.nodes.length}-node graph`);

fs.rmSync(okfPaths(home).lock, { force: true });
for (const d of [home, fakeHome, bootHome]) fs.rmSync(d, { recursive: true, force: true });
