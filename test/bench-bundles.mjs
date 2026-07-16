#!/usr/bin/env node
// 레벨별 번들을 만든다. 지식은 실제 배치가 실제 transcript를 씹어서 만든 것만 쓴다 — 손으로 쓴
// concept은 한 줄도 없다.
//
// 레벨은 세션을 점증적으로 심고 매번 배치를 돌려 스냅샷을 뜨는 방식으로 만든다. "concept 20개
// 번들"을 흉내내는 게 아니라, 실제로 20개가 쌓일 때까지 배치를 돌린 그 번들이다.
//
// 실행: node test/bench-bundles.mjs --target slim --levels 1,5,10,15,20,40,80 --out <캐시경로>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ensureBootstrap } from '../lib/bootstrap.mjs';
import { okfPaths } from '../lib/paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const target = arg('target', 'slim');
const levels = arg('levels', '1,5,10,15,20').split(',').map(Number).filter((n) => n > 0);
const outRoot = path.resolve(arg('out', path.join(ROOT, '.bench-bundles')));
const model = arg('model', 'sonnet');

if (process.env.OKF_RUN_LIVE_BENCH !== '1') {
  console.error('유료 실행입니다. OKF_RUN_LIVE_BENCH=1을 명시하세요.');
  process.exit(2);
}

const srcDir = path.join(ROOT, 'test', 'fixtures', 'bench', 'transcripts', target);
// 심는 순서가 곧 레벨이다. 레벨 축을 재는 시나리오(buried)의 "이전 작업" 세션이 반드시 첫
// 번째여야 한다 — 그래야 L1이 "지식 1개를 가진 번들"이라는 의미를 갖는다. 그 다음이 나머지
// 시나리오 세션(기준 레벨에서 필요), 마지막이 볼륨용 세션이다.
const policyFirst = process.env.OKF_BENCH_POLICY_FIRST === '1';
const rank = (f) => (policyFirst
  ? (/target-(\w+_policy|slim_domain)/.test(f) ? 0 : /^0/.test(f) ? 1 : 2)
  : (/target-\w+_buried/.test(f) ? 0 : /^0/.test(f) ? 1 : 2));
const transcripts = fs.readdirSync(srcDir).filter((f) => f.endsWith('.jsonl'))
  .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
if (!transcripts.length) { console.error(`transcript가 없습니다: ${srcDir}`); process.exit(2); }

function conceptFiles(home) {
  const found = [];
  const walk = (dir, rel = '') => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'raw') continue;
      const rp = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), rp);
      else if (e.name.endsWith('.md') && !['index.md', 'log.md', 'SCHEMA.md'].includes(e.name)) found.push(rp);
    }
  };
  walk(home);
  return found.sort();
}
// 시드 4개는 부트스트랩이 심는 것이라 "쌓인 지식"이 아니다. 레벨 카운트에서 제외하되, 게이트
// 예산은 실제로 차지하므로 그 사실은 리포트에 남긴다.
const isSeed = (rel) => /okf-(format|llm-wiki-lineage|system-architecture|bundle-rules)\.md$/.test(rel);

const home = path.join(outRoot, `${target}-build`);
fs.rmSync(home, { recursive: true, force: true });
fs.mkdirSync(outRoot, { recursive: true });
ensureBootstrap(home);
const paths = okfPaths(home);
fs.writeFileSync(paths.config, `---\nenabled: true\nbatch_interval_hours: 8760\nbatch_model: ${JSON.stringify(model)}\nbatch_effort: "medium"\n---\n`);
const usageFile = path.join(outRoot, `${target}-batch-usage.jsonl`);
fs.rmSync(usageFile, { force: true });

function runBatchUntilDrained() {
  // 배치는 digest 예산(600KB)을 넘으면 남은 세션을 다음 회차로 미룬다. raw가 빌 때까지 돌린다.
  for (let round = 0; round < 12; round++) {
    const pending = fs.existsSync(paths.raw) ? fs.readdirSync(paths.raw).filter((f) => f.endsWith('.jsonl')).length : 0;
    if (pending === 0) return round;
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'batch.mjs')], {
      env: { ...process.env, OKF_HOME: home, OKF_BENCH_USAGE_FILE: usageFile, OKF_BENCH_SKIP_SWEEP: '1' },
      cwd: home, encoding: 'utf8', timeout: 30 * 60_000,
    });
    if (r.status !== 0) throw new Error(`batch 실패: ${String(r.stderr).slice(0, 300)}`);
  }
  throw new Error('배치가 raw를 비우지 못했습니다(12회차 초과)');
}

function gateBytes(bundleHome) {
  fs.writeFileSync(okfPaths(bundleHome).lock, JSON.stringify({ pid: process.pid, startedEpochMs: Date.now() }));
  try {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'session-start.mjs')], {
      env: { ...process.env, OKF_HOME: bundleHome }, input: '{}', cwd: ROOT, encoding: 'utf8',
    });
    const ctx = JSON.parse(r.stdout).hookSpecificOutput?.additionalContext || '';
    return { bytes: Buffer.byteLength(ctx), text: ctx };
  } finally {
    fs.rmSync(okfPaths(bundleHome).lock, { force: true });
  }
}

const snapshots = [];
let planted = 0;
for (const level of levels) {
  const want = Math.min(level, transcripts.length);
  while (planted < want) {
    const f = transcripts[planted++];
    fs.mkdirSync(paths.raw, { recursive: true });
    // sweep이 쓰는 파일명 규칙 그대로 심는다.
    fs.copyFileSync(path.join(srcDir, f), path.join(paths.raw, `2026-07-16--${target}--${crypto.randomUUID()}.jsonl`));
  }
  const rounds = runBatchUntilDrained();
  const all = conceptFiles(home);
  const real = all.filter((c) => !isSeed(c));
  const gate = gateBytes(home);
  const snapDir = path.join(outRoot, `${target}-L${level}`);
  fs.rmSync(snapDir, { recursive: true, force: true });
  fs.cpSync(home, snapDir, { recursive: true });
  fs.rmSync(path.join(snapDir, 'raw'), { recursive: true, force: true });
  const rows = fs.existsSync(usageFile) ? fs.readFileSync(usageFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const cost = rows.reduce((s, x) => s + (Number(x.total_cost_usd) || 0), 0);
  snapshots.push({
    requestedLevel: level, sessionsPlanted: planted, batchRounds: rounds,
    conceptsReal: real.length, conceptsSeed: all.length - real.length,
    gateBytes: gate.bytes, gateTruncated: /생략|truncat/i.test(gate.text),
    cumulativeBatchCostUsd: Number(cost.toFixed(4)),
    dir: path.basename(snapDir), concepts: real,
  });
  console.error(`L${level}: 세션 ${planted} → concept ${real.length}개 (시드 ${all.length - real.length}), 게이트 ${gate.bytes}B, 누적 배치 $${cost.toFixed(3)}`);
}

fs.writeFileSync(path.join(outRoot, `${target}-levels.json`), `${JSON.stringify({
  target, builtAt: new Date().toISOString(), model, transcriptCount: transcripts.length, snapshots,
}, null, 2)}\n`);
console.log(path.join(outRoot, `${target}-levels.json`));
