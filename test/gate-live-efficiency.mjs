// 축 E 보조 — 라이브 번들에서 게이트의 **실제 비용**을 잰다.
//
// 합성 번들은 "무엇이 더 나은가"를 재고, 이 스크립트는 "지금 얼마를 쓰고 얼마를 보여주는가"를
// 잰다. 둘 다 있어야 효율을 말할 수 있다.
//
// **읽기 전용이고, 산출물에 title·description·파일명·링크를 싣지 않는다.** 개수·바이트·비율만
// 낸다. `raw/`와 `_remove_candidate/`는 사용자 대화 전사 원문이므로 열지 않는다 —
// discoverConceptDirs가 SCAN_EXCLUDE_DIRS로 구조적으로 배제하지만, 여기서도 직접 밟지 않는다.
//
//   node test/gate-live-efficiency.mjs [--home <경로>] [--out <경로>]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildContext, extractLatestLogSection } from '../lib/gate.mjs';
import { discoverConceptDirs } from '../lib/index-gen.mjs';
import { SCAN_EXCLUDE_DIRS, NON_CONCEPT_BASENAMES } from '../lib/paths.mjs';
import { DEFAULT_CONFIG } from '../lib/config.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const B = (s) => Buffer.byteLength(s, 'utf8');

function parseArgs(argv) {
  const out = { home: path.join(process.env.HOME ?? '', '.claude', 'okf') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--home') out.home = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
    else throw new Error(`unknown arg: ${argv[i]}`);
  }
  return out;
}
const ARGS = parseArgs(process.argv.slice(2));

function walkConcepts(home, rel = '') {
  let entries;
  try { entries = fs.readdirSync(path.join(home, rel), { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) {
      if (SCAN_EXCLUDE_DIRS.has(e.name)) continue;
      out.push(...walkConcepts(home, rel ? `${rel}/${e.name}` : e.name));
    } else if (e.name.endsWith('.md') && !NON_CONCEPT_BASENAMES.has(e.name) && rel !== '') {
      out.push(path.join(home, rel, e.name));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// YAML 평문 스칼라 `#` 절단 누수.
//
// 라이브 번들의 `/troubleshooting/okf/okf-frontmatter-hash-truncation.md`가 기록한 실사용
// 결함이다: 따옴표 없는 값에서 **공백 뒤 `#`부터 파서가 값을 버린다.** 본문은 멀쩡하고 lint도
// 통과하므로 육안으로 안 보이는데, 잃는 것은 **게이트에 노출되는 요약뿐**이다.
//
// 이것이 효율 문제인 이유: 게이트는 그 줄에 바이트를 쓰고도 정보를 못 싣는다. 여기서는 절단이
// **몇 건이고 몇 바이트를 잃는가**만 센다 — 값 자체는 출력하지 않는다.
function truncationLeak(files) {
  let scanned = 0; let affected = 0; let lostBytes = 0; let keptBytes = 0;
  for (const abs of files) {
    const md = fs.readFileSync(abs, 'utf8');
    if (!md.startsWith('---')) continue;
    const end = md.indexOf('\n---', 3);
    if (end === -1) continue;
    for (const line of md.slice(4, end).split('\n')) {
      const m = /^(title|description):\s*(.*)$/.exec(line);
      if (!m) continue;
      const value = m[2];
      // 인용된 스칼라는 이 함정을 밟지 않는다. 블록 스칼라(`>-`, `|`)도 대상이 아니다.
      if (value === '' || value.startsWith('"') || value.startsWith("'") || value.startsWith('>') || value.startsWith('|')) continue;
      scanned++;
      const at = value.search(/\s#/);
      if (at === -1) { keptBytes += B(value); continue; }
      affected++;
      keptBytes += B(value.slice(0, at));
      lostBytes += B(value.slice(at));
    }
  }
  return { plainScalarsScanned: scanned, plainScalarsTruncated: affected, bytesKept: keptBytes, bytesLostToComment: lostBytes };
}

// ---------------------------------------------------------------------------

const home = ARGS.home;
if (!fs.existsSync(home)) {
  process.stderr.write(`no bundle at ${home}\n`);
  process.exit(2);
}

const files = walkConcepts(home);
const conceptBytes = files.reduce((s, f) => s + fs.statSync(f).size, 0);
const dirs = discoverConceptDirs(home);

const logMd = (() => {
  try { return fs.readFileSync(path.join(home, 'log.md'), 'utf8'); } catch { return ''; }
})();

const stats = {};
const injected = buildContext({
  okfHome: home,
  latestLog: extractLatestLogSection(logMd),
  injectMaxLines: DEFAULT_CONFIG.inject_max_lines,
  injectMaxBytes: DEFAULT_CONFIG.inject_max_bytes,
}, stats);

// 게이트가 실제로 실은 concept 줄 수는 stats.taken, 번들 전체는 stats.total이다.
// **구조 오버헤드**(head/tail/heading/마커)와 **지식 페이로드**(concept 줄)를 가른다 —
// "예산의 몇 %가 지식인가"가 이 축의 비용 쪽 답이다.
const structureBytes = stats.headBytes + stats.tailBytes + stats.headingBytes + stats.markerBytes;
const payloadBytes = stats.finalBytes - structureBytes;

const report = {
  meta: {
    round: 'E-eff (라이브 측정)',
    generatedAt: new Date().toISOString(),
    commit: process.env.OKF_BENCH_COMMIT ?? null,
    home: '(경로 비공개 — 사용자 홈)',
    config: { inject_max_lines: DEFAULT_CONFIG.inject_max_lines, inject_max_bytes: DEFAULT_CONFIG.inject_max_bytes },
    note: 'title·description·파일명·링크는 산출물에 싣지 않는다. 개수·바이트·비율만.',
  },
  bundle: {
    categories: dirs.length,
    conceptFiles: files.length,
    conceptFileBytes: conceptBytes,
    meanConceptFileBytes: files.length ? Math.round(conceptBytes / files.length) : null,
  },
  gate: {
    injectedBytes: stats.finalBytes,
    injectedLines: injected.split('\n').length,
    conceptLinesInjected: stats.taken,
    conceptLinesTotal: stats.total,
    coverage: stats.total ? stats.taken / stats.total : null,
    budgetUsed: stats.finalBytes / DEFAULT_CONFIG.inject_max_bytes,
    truncatedBytes: stats.truncatedBytes,
    starvationEvents: stats.starvationEvents ?? 0,
    leftoverBytes: stats.leftoverBytes,
  },
  overhead: {
    headBytes: stats.headBytes,
    tailBytes: stats.tailBytes,
    headingBytes: stats.headingBytes,
    markerBytes: stats.markerBytes,
    structureBytes,
    payloadBytes,
    // 주입 바이트 중 실제로 concept 지식인 비율.
    payloadShare: stats.finalBytes ? payloadBytes / stats.finalBytes : null,
  },
  compression: {
    // 번들 전체를 통째로 넣는 대신 게이트를 쓰면 몇 배를 아끼는가.
    bundleBytesPerInjectedByte: stats.finalBytes ? conceptBytes / stats.finalBytes : null,
    // 다만 게이트가 **보여주는** 것은 전체가 아니다 — 위 coverage와 함께 읽어야 한다.
    injectedBytesPerConceptShown: stats.taken ? stats.finalBytes / stats.taken : null,
  },
  truncationLeak: truncationLeak(files),
};

const out = ARGS.out ?? path.join(PLUGIN_ROOT, 'docs', 'benchmarks', 'raw',
  `gate-live-efficiency-${report.meta.generatedAt.slice(0, 10)}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${path.relative(PLUGIN_ROOT, out)}\n${JSON.stringify(report, null, 2)}\n`);
