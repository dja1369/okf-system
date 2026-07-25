// docs/0-2_benchmark.md 축 A-2/A-3 하네스 — **유료 0**.
// 같은 지식을 평면/중첩으로 배치했을 때 게이트가 싣는 concept 줄이 어떻게 달라지는지 잰다.
// 실행: node test/bench-nesting.mjs
// 라이브 형상 픽스처로 구/신 포맷의 게이트 산출을 같은 예산에서 비교한다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const ROOT = new URL('..', import.meta.url).pathname; // 저장소 루트 — 경로 하드코딩 금지
const { regenerateIndex } = await import(`${ROOT}/lib/index-gen.mjs`);
const { ensureBootstrap } = await import(`${ROOT}/lib/bootstrap.mjs`);
const { okfPaths } = await import(`${ROOT}/lib/paths.mjs`);

const pad = (n) => (n <= 0 ? '' : '가'.repeat(Math.floor(n / 3)) + 'x'.repeat(n % 3));

// 라이브와 같은 규모: concept 25개를 6개 카테고리에 분산, 설명 190B 내외
function build(home, nested) {
  const cats = ['decisions', 'patterns', 'preferences', 'projects', 'references', 'troubleshooting'];
  const TYPE = { decisions: 'decision', patterns: 'pattern', preferences: 'preference',
    projects: 'project', references: 'reference', troubleshooting: 'troubleshooting' };
  let made = 0;
  for (const c of cats) {
    for (let i = 0; i < 5 && made < 25; i++, made++) {
      const sub = nested ? path.join(c, `주제${i % 3}`) : c;
      fs.mkdirSync(path.join(home, sub), { recursive: true });
      const name = `c${String(made).padStart(2, '0')}.md`;
      const title = `개념 제목 ${String(made).padStart(2, '0')}`;
      fs.writeFileSync(path.join(home, sub, name),
        `---\ntype: ${TYPE[c]}\ntitle: ${title}\ndescription: ${pad(190)}\ntimestamp: 2026-07-15\n---\n본문\n`);
    }
  }
  // 라이브 tail 규모에 맞춰 log를 채운다
  const bullets = Array.from({ length: 14 }, (_, i) => `- log 항목 ${i} ${pad(80)}`);
  fs.writeFileSync(okfPaths(home).log, `# Log\n\n## 2026-07-25\n${bullets.join('\n')}\n`);
  regenerateIndex(home);
}

function measure(label, nested) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-bench-'));
  ensureBootstrap(home);
  build(home, nested);
  const lockPath = okfPaths(home).lock;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedEpochMs: Date.now() }));
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-fh-'));
  const res = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'session-start.mjs')], {
    input: '{}',
    env: { ...process.env, OKF_HOME: home, HOME: fake, USERPROFILE: fake, CLAUDE_CONFIG_DIR: path.join(fake, '.claude') },
    encoding: 'utf8',
  });
  fs.rmSync(lockPath, { force: true });
  const ctx = JSON.parse(res.stdout).hookSpecificOutput.additionalContext;
  const iAt = ctx.indexOf('--- index.md ---');
  const tAt = ctx.indexOf('--- 최근 변경 (log.md) ---');
  const idxPart = ctx.slice(iAt, tAt);
  const bullets = idxPart.split('\n').filter((l) => l.startsWith('* '));
  const domainLinks = bullets.filter((l) => /\]\([^)]*index\.md\)/.test(l));
  // index 파일 총 바이트
  let indexBytes = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['.git', '.okf', 'raw', '_remove_candidate'].includes(e.name)) continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name === 'index.md') indexBytes += fs.statSync(f).size;
    }
  };
  walk(home);
  return {
    label,
    주입_bullet: bullets.length,
    그중_concept: bullets.length - domainLinks.length,
    그중_도메인링크: domainLinks.length,
    게이트_총바이트: Buffer.byteLength(ctx, 'utf8'),
    index파일_총바이트: indexBytes,
  };
}

const rows = [measure('평면(F)', false), measure('중첩(N2)', true)];
console.log('=== 축 A-2/A-3 실측 (유료 0, concept 25개 고정) ===');
for (const r of rows) {
  console.log(`\n[${r.label}]`);
  for (const [k, v] of Object.entries(r)) if (k !== 'label') console.log(`  ${k.padEnd(18)} ${v}`);
}
const [f, n] = rows;
console.log(`\n중첩 비용: concept 줄 ${f.그중_concept} → ${n.그중_concept} (${((n.그중_concept - f.그중_concept) / f.그중_concept * 100).toFixed(0)}%)`);
console.log(`index 파일 바이트: ${f.index파일_총바이트} → ${n.index파일_총바이트}`);
