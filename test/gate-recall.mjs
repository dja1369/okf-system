// recall@cap 하니스 (docs/0-2_develop_plan.md I6-5).
//
// 무엇을 재는가: 게이트가 예산(inject_max_bytes/lines) 안에서 index를 조립할 때, 동결된 20개
// 질문의 정답 concept 줄이 **몇 개나 살아남는가**. 번들 크기 N을 24/50/100/200으로 늘리며
// 시드 20개로 반복한다. 라우팅 코드는 아직 없다 — 이 값은 "관련성 신호 0인 현행 게이트"의
// 기준선이고, I2(라우터)를 착수할지 말지를 R1~R5가 기계로 판정한다.
//
// **유료 호출 0.** 이 하니스는 LLM을 부르지 않는다. 그것을 주장이 아니라 증거로 남기려고
// PATH 트랩(아래 plantPathTrap)을 깐다 — 훅 서브프로세스가 어떤 경로로든 CLI를 부르면
// TRIPPED 파일이 생기고 산출 JSON의 meta.paidCallTrapTripped가 true가 된다.
//
// CLI:
//   node test/gate-recall.mjs [--levels 24,50,100,200] [--seeds 20] [--out <경로>]
//   node test/gate-recall.mjs --determinism-check
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ensureBootstrap } from '../lib/bootstrap.mjs';
import { regenerateIndex } from '../lib/index-gen.mjs';
import { buildContext, extractLatestLogSection } from '../lib/gate.mjs';
import { okfPaths, SCAN_EXCLUDE_DIRS, NON_CONCEPT_BASENAMES } from '../lib/paths.mjs';
import { readConfig } from '../lib/config.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = path.join(PLUGIN_ROOT, 'test', 'fixtures', 'bench', 'gate-recall');
const SHAPE_REL = 'test/fixtures/bench/gate-recall/live-shape-2026-07-26.json';

const B = (s) => Buffer.byteLength(s, 'utf8');
const INDEX_MARKER = '--- index.md ---\n';
const TAIL_MARKER = '--- 최근 변경 (log.md) ---\n';

// ---------------------------------------------------------------------------
// PRNG. 외부 의존 0 — CI에 npm install이 없다(계획서 I6-5).
function mulberry32(a) {
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { levels: null, seeds: 20, outPath: null, determinismCheck: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--levels') out.levels = argv[++i].split(',').map((s) => Number(s.trim()));
    else if (a === '--seeds') out.seeds = Number(argv[++i]);
    else if (a === '--out') out.outPath = argv[++i];
    else if (a === '--determinism-check') out.determinismCheck = true;
    else throw new Error(`unknown flag: ${a}`);
  }
  return out;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const SHAPE = readJson(path.join(PLUGIN_ROOT, SHAPE_REL));
const QUESTIONS_FILE = readJson(path.join(PLUGIN_ROOT, 'test', 'fixtures', 'bench', 'gate-recall.json'));
const QUESTIONS = QUESTIONS_FILE.questions;
const DISTRACTORS = readJson(path.join(FIXTURE_DIR, 'distractors.json'));

// ---------------------------------------------------------------------------
// 바이트 단위 절단/패딩. 코드포인트 경계에서만 자르고 모자란 만큼 ASCII로 채워
// **정확히** targetBytes를 만든다(패딩이 ASCII라 UTF-8 경계 문제가 없다).
function fitBytes(text, targetBytes) {
  if (targetBytes <= 0) return '';
  let out = '';
  let used = 0;
  for (const ch of text) {
    const w = B(ch);
    if (used + w > targetBytes) break;
    out += ch; used += w;
  }
  return out + 'x'.repeat(targetBytes - used);
}

// filler 텍스트는 index 줄로 흘러 들어간다. index-gen의 foldToSingleLine이 대괄호·마크업형
// `<`·제어문자를 접으면(1B → 3B) 목표 바이트가 어긋나므로, 접기 대상 문자를 미리 없앤다.
function sanitize(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, ' ').replace(/[[\]<>]/g, '');
}

// ---------------------------------------------------------------------------
// 번들에 실제로 존재하는 concept 파일 수. **하드코딩 금지** — 부트스트랩 시드 개수는
// templates/seed/ 내용에 따라 바뀌고, 그때 filler 수가 조용히 어긋나면 레벨 N이 거짓이 된다.
function listConcepts(home, rel = '') {
  const dir = path.join(home, rel);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) {
      if (rel === '' && SCAN_EXCLUDE_DIRS.has(e.name)) continue;
      out.push(...listConcepts(home, rel ? `${rel}/${e.name}` : e.name));
    } else if (e.name.endsWith('.md') && !NON_CONCEPT_BASENAMES.has(e.name) && rel !== '') {
      out.push(`${rel}/${e.name}`);
    }
  }
  return out;
}

// 라이브 형상의 카테고리별 concept 수를 그대로 filler 배분 가중치로 쓴다.
const CATEGORY_WEIGHTS = SHAPE.categories.map((c) => ({ dir: c.dir, weight: c.lineBytes.length }));
const WEIGHT_TOTAL = CATEGORY_WEIGHTS.reduce((s, c) => s + c.weight, 0);
// 목표 줄 바이트는 전 카테고리의 lineBytes를 합친 풀에서 **복원추출**한다.
const LINE_BYTE_POOL = SHAPE.categories.flatMap((c) => c.lineBytes);
const TYPE_OF = {
  projects: 'project', decisions: 'decision', preferences: 'preference',
  patterns: 'pattern', references: 'reference', troubleshooting: 'troubleshooting',
};

function pickCategory(r) {
  let x = r * WEIGHT_TOTAL;
  for (const c of CATEGORY_WEIGHTS) {
    x -= c.weight;
    if (x < 0) return c.dir;
  }
  return CATEGORY_WEIGHTS[CATEGORY_WEIGHTS.length - 1].dir;
}

// ---------------------------------------------------------------------------
// 번들 합성. 반환값의 plantedSet은 **번들 루트 기준 절대경로**(`/decisions/x.md`)로,
// 게이트가 주입하는 링크 형식과 같은 표기다.
function buildBundle(root, level, seed) {
  const home = path.join(root, `L${String(level).padStart(3, '0')}-S${String(seed).padStart(3, '0')}`);
  fs.mkdirSync(home, { recursive: true });
  ensureBootstrap(home);

  const seedConcepts = listConcepts(home);
  const seedCount = seedConcepts.length;
  const planted = new Set(seedConcepts.map((rel) => `/${rel}`));

  for (const q of QUESTIONS) {
    const dest = path.join(home, q.answerConcept);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(PLUGIN_ROOT, q.sourceFile), dest);
    planted.add(`/${q.answerConcept}`);
  }

  const fillerCount = level - QUESTIONS.length - seedCount;
  if (fillerCount < 0) {
    throw new Error(`level ${level} is below the planted floor: ${QUESTIONS.length} questions + ${seedCount} bootstrap seeds`);
  }

  const rand = mulberry32((seed * 0x9e3779b1) >>> 0);
  const cursor = new Map(CATEGORY_WEIGHTS.map((c) => [c.dir, Math.floor(rand() * DISTRACTORS[c.dir].length)]));
  for (let i = 0; i < fillerCount; i++) {
    const dir = pickCategory(rand());
    const pool = DISTRACTORS[dir];
    const at = cursor.get(dir);
    cursor.set(dir, at + 1);
    const src = pool[at % pool.length];
    const target = LINE_BYTE_POOL[Math.floor(rand() * LINE_BYTE_POOL.length)];

    // slug 중복 금지 — 같은 distractor를 여러 번 쓰므로 인덱스 접미를 붙인다.
    const name = `${src.slug}-f${String(i).padStart(3, '0')}.md`;
    const link = `/${dir}/${name}`;
    // 주입되는 줄: `* [title](link) - description`
    const overhead = 3 + 2 + B(link) + 4;
    const avail = target - overhead;
    const titleBytes = Math.max(4, Math.min(B(sanitize(src.title)), Math.floor(avail / 3)));
    const title = fitBytes(sanitize(src.title), titleBytes);
    const description = fitBytes(sanitize(src.description), Math.max(1, avail - B(title)));
    const abs = path.join(home, dir, name);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    // YAML 이중 인용 스칼라로 쓴다 — 원문에 `:`가 들어가도 파싱이 깨지지 않는다.
    fs.writeFileSync(abs, `---\ntype: ${TYPE_OF[dir]}\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\ntimestamp: 2026-07-15\n---\n본문\n`);
    planted.add(link);
  }

  fs.writeFileSync(path.join(home, 'log.md'), SHAPE.logMd);
  regenerateIndex(home);
  return { home, seedCount, fillerCount, planted };
}

// ---------------------------------------------------------------------------
// 게이트 텍스트에서 index 구간만 떼어낸다. tail(log bullets)의 `- ` 줄을 concept로 오인하지
// 않기 위해서다.
function indexSection(text) {
  const iAt = text.indexOf(INDEX_MARKER);
  const tAt = text.indexOf(TAIL_MARKER);
  const from = iAt >= 0 ? iAt + INDEX_MARKER.length : 0;
  return tAt >= 0 ? text.slice(from, tAt) : text.slice(from);
}

// 실제 주입 줄은 `* [제목](/dir/file.md) - 설명`이다(OKF 공식 번들 규범의 bullet 문자는 `*`).
const LINK_RE = /^\* \[[^\]]*\]\((\/[^)\s]+)\)/;
// 계획서 I6-5가 적어둔 정규식. `- ` bullet을 가정해 **한 건도 매치되지 않는다** —
// 사양 불일치의 증거로 매 샘플에서 함께 세어 산출 JSON에 남긴다.
const PLAN_LINK_RE = /^- \[[^\]]*\]\((\/[^)\s]+)\)/;

function extractSurvivors(text, re) {
  const set = new Set();
  for (const line of indexSection(text).split('\n')) {
    const m = re.exec(line);
    if (m) set.add(m[1]);
  }
  return set;
}

// ---------------------------------------------------------------------------
// 계획서 I6-5는 tmp 홈 **경로 길이**를 고정해 headBytes를 라이브의 686B에 맞추라고 했지만,
// head는 `전역 지식 번들: ${okfHome}`로 경로를 그대로 싣는다 — macOS의 `/var/folders/...`
// tmpdir은 라이브 경로(`/Users/…/.claude/okf`, 25자)보다 이미 길어서 **원리적으로 불가능**하다.
// 그래서 고정 대상을 바꾼다: **index에 주어지는 예산**을 라이브와 정확히 같게 역산해 넘긴다.
//   effectiveCap = indexBudget + 실측 head + 실측 tail
// cap − head 는 경로와 무관하므로 index 조립 산술 전체가 라이브와 동형이 된다. 이것이
// G3-0b("하니스는 라이브와 같은 예산에서 잰다")를 경로 길이에 의존하지 않고 만족하는 방법이다.
function probeHeadTail(home, latestLog) {
  const probe = buildContext({ okfHome: home, latestLog, injectMaxLines: 1e6, injectMaxBytes: 1e8 }, null);
  const headStr = probe.slice(0, probe.indexOf(INDEX_MARKER) + INDEX_MARKER.length);
  const tailStr = probe.slice(probe.indexOf(TAIL_MARKER));
  return {
    headBytes: B(headStr), headLines: headStr.split('\n').length,
    tailBytes: B(tailStr), tailLines: tailStr.split('\n').length,
  };
}

function measure(home) {
  let logContent = '';
  try {
    logContent = fs.readFileSync(okfPaths(home).log, 'utf8');
  } catch { /* 없으면 빈 문자열 — 훅(bin/session-start.mjs:38-44)과 같은 처리 */ }
  const latestLog = extractLatestLogSection(logContent);

  const probe = probeHeadTail(home, latestLog);
  const injectMaxBytes = SHAPE.indexBudgetBytes + probe.headBytes + probe.tailBytes;
  const injectMaxLines = SHAPE.indexBudgetLines + probe.headLines + probe.tailLines;

  const stats = {};
  const text = buildContext({ okfHome: home, latestLog, injectMaxLines, injectMaxBytes }, stats);

  // 예산 동형 검사. stats.budgetBytes/budgetLines는 heading 선차감 **이후** 값이므로
  // (lib/gate.mjs:92-98) 그대로 비교하면 카테고리 수·자릿수에 따라 흔들린다 — 선차감을
  // 되돌려 index에 실제로 주어진 원 예산을 복원해 비교한다.
  const rawBudgetBytes = stats.budgetBytes + stats.headingBytes;
  const rawBudgetLines = stats.budgetLines + stats.cats.length * 2;
  if (rawBudgetBytes !== SHAPE.indexBudgetBytes || rawBudgetLines !== SHAPE.indexBudgetLines) {
    throw new Error(`shape drift: index budget ${rawBudgetBytes}B/${rawBudgetLines}L vs frozen ${SHAPE.indexBudgetBytes}B/${SHAPE.indexBudgetLines}L (head ${probe.headBytes}B/${probe.headLines}L, tail ${probe.tailBytes}B/${probe.tailLines}L)`);
  }
  if (probe.tailBytes !== SHAPE.tailBytes || probe.tailLines !== SHAPE.tailLines) {
    throw new Error(`shape drift: tail ${probe.tailBytes}B/${probe.tailLines}L vs frozen ${SHAPE.tailBytes}B/${SHAPE.tailLines}L`);
  }

  return { text, stats, probe, latestLog, injectMaxBytes, injectMaxLines };
}

// ---------------------------------------------------------------------------
// 캘리브레이션(G3-0a / R5). 형상 픽스처의 바이트 벡터로 번들을 합성해 5개 값을 재현한다.
function calibrate(root) {
  const pad = (n) => (n <= 0 ? '' : '가'.repeat(Math.floor(n / 3)) + 'x'.repeat(n % 3));
  const home = path.join(root, 'calibration');
  fs.mkdirSync(home, { recursive: true });
  ensureBootstrap(home);
  for (const cat of SHAPE.categories) {
    const dir = path.join(home, cat.dir);
    fs.mkdirSync(dir, { recursive: true });
    const existing = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'index.md').sort();
    const names = [...existing];
    for (let i = existing.length; i < cat.lineBytes.length; i++) names.push(`s${String(i).padStart(2, '0')}.md`);
    for (const extra of names.slice(cat.lineBytes.length)) fs.rmSync(path.join(dir, extra), { force: true });
    names.slice(0, cat.lineBytes.length).forEach((name, i) => {
      const title = `T${String(i).padStart(2, '0')}`;
      const fixed = 3 + B(title) + 2 + B(`/${cat.dir}/${name}`) + 4;
      fs.writeFileSync(path.join(dir, name),
        `---\ntype: ${TYPE_OF[cat.dir]}\ntitle: ${title}\ndescription: ${pad(cat.lineBytes[i] - fixed)}\ntimestamp: 2026-07-15\n---\n본문\n`);
    });
  }
  fs.writeFileSync(path.join(home, 'log.md'), SHAPE.logMd);
  regenerateIndex(home);

  const { stats, probe, text } = measure(home);
  // head는 경로 길이에 비례하므로 라이브 head(686B)로 정규화해 비교한다(픽스처 note 참조).
  const observed = {
    taken: stats.taken,
    total: stats.total,
    indexBytes: B(indexSection(text).replace(/\n$/, '')),
    assembledBytes: stats.assembledBytes - probe.headBytes + SHAPE.liveHeadBytes,
    finalBytes: stats.finalBytes - probe.headBytes + SHAPE.liveHeadBytes,
    truncatedBytes: stats.truncatedBytes,
    leftoverBytes: stats.leftoverBytes,
    cappedLines: stats.cappedLines,
  };
  fs.rmSync(home, { recursive: true, force: true });
  const mismatches = Object.entries(SHAPE.expected)
    .filter(([k, v]) => observed[k] !== v)
    .map(([k, v]) => ({ key: k, expected: v, observed: observed[k] }));
  return { observed, expected: SHAPE.expected, mismatches };
}

// ---------------------------------------------------------------------------
// 유료 0 증명. 훅 서브프로세스의 PATH 맨 앞에 스텁을 깐다 — 어떤 경로로든 CLI가 실행되면
// TRIPPED 파일이 남는다. `meta.paidCalls: 0` 같은 상수 선언은 증거가 아니다.
function plantPathTrap(root) {
  const trapDir = path.join(root, 'path-trap');
  fs.mkdirSync(trapDir, { recursive: true });
  const tripped = path.join(trapDir, 'TRIPPED');
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(trapDir, 'claude.cmd'), `@echo off\r\n>"${tripped}" echo tripped\r\nexit /b 1\r\n`);
  } else {
    const stub = path.join(trapDir, 'claude');
    fs.writeFileSync(stub, `#!/bin/sh\necho tripped > "${tripped}"\nexit 1\n`);
    fs.chmodSync(stub, 0o755);
  }
  return { trapDir, tripped };
}

// 훅 교차검증. 훅은 **자기 config(9000/120)**로 돌고 하니스는 예산 동형을 위해 역산한 cap
// (≈9046/120)으로 돌므로, 두 산출의 바이트가 같을 수 없다. 그래서 세 가지를 나눠 대조한다.
//
//  (a) **drift 0(엄밀 검사)**: 훅과 *같은 config*로 lib/gate.mjs를 직접 호출한 결과가 훅
//      서브프로세스 출력과 **바이트 동일**인가. 이것이 "모듈 추출이 동작을 바꾸지 않았다"의 증거다.
//  (b) index 구간의 카테고리 heading 구조(디렉토리 순서·개수)가 같은가.
//  (c) 예산이 다른 두 실행의 생존 집합 관계(정보용).
//
// **(c)를 통과 조건으로 걸면 안 된다.** buildInjectedIndex의 round-robin + 마커 환급은 예산에
// 대해 단조가 아니다 — 바이트가 46B 더 많은 하니스가 긴 줄 하나를 먼저 담아 짧은 줄 둘을 놓칠
// 수 있다. 레벨 200에서 실제로 관측했다(훅 11줄 vs 하니스 10줄). 그건 결함이 아니라 예산이
// 다르다는 사실 그 자체이므로, 포함관계는 숫자로 남기기만 한다.
function crossCheckWithHook(home, trap, harnessSurvivors, latestLog) {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-bench-fakehome-'));
  const lockPath = okfPaths(home).lock;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  // **락을 반드시 먼저 심는다.** 빼면 훅 끝의 maybeSpawnBatch가 detached 실배치를 띄우고,
  // CLI가 설치된 개발 머신에서는 그 배치가 진짜 LLM을 호출한다(과금). test/smoke.mjs:86-93 관용구.
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedEpochMs: Date.now() }));
  const hookArgs = [path.join(PLUGIN_ROOT, 'bin', 'session-start.mjs')];
  try {
    const res = spawnSync(process.execPath, hookArgs, {
      input: '{}',
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${trap.trapDir}${path.delimiter}${process.env.PATH}`,
        OKF_HOME: home,
        HOME: fakeHome,
        USERPROFILE: fakeHome,
        CLAUDE_CONFIG_DIR: path.join(fakeHome, '.claude'),
      },
    });
    if (res.status !== 0) throw new Error(`hook exited ${res.status}: ${res.stderr}`);
    const ctx = JSON.parse(res.stdout).hookSpecificOutput.additionalContext;
    const cfg = readConfig(home);
    const moduleCtx = buildContext({
      okfHome: home, latestLog,
      injectMaxLines: cfg.inject_max_lines,
      injectMaxBytes: cfg.inject_max_bytes,
    });
    const hookSurvivors = extractSurvivors(ctx, LINK_RE);
    const headingsOf = (t) => indexSection(t).split('\n').filter((l) => l.startsWith('## ')).map((l) => l.split(' (')[0]);
    const missing = [...hookSurvivors].filter((rel) => !harnessSurvivors.has(rel));
    return {
      compared: [
        '(a) drift 0: buildContext(훅과 같은 config) === 훅 서브프로세스 additionalContext, 바이트 동일',
        '(b) index 구간 카테고리 heading 목록/순서',
        '(c) 생존 집합 포함관계 — 예산이 다르므로 정보용, 통과 조건 아님',
      ],
      hookConfig: { inject_max_bytes: cfg.inject_max_bytes, inject_max_lines: cfg.inject_max_lines },
      byteIdenticalAtHookConfig: moduleCtx === ctx,
      hookBytes: B(ctx),
      moduleBytes: B(moduleCtx),
      categoryHeadingsMatch: JSON.stringify(headingsOf(ctx)) === JSON.stringify(headingsOf(moduleCtx)),
      hookCategoryHeadings: headingsOf(ctx),
      hookSurvivorCount: hookSurvivors.size,
      harnessSurvivorCount: harnessSurvivors.size,
      hookSurvivorsSubsetOfHarness: missing.length === 0,
      survivorsNotInHarness: missing,
    };
  } finally {
    fs.rmSync(lockPath, { force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
function mean(xs) { return xs.reduce((s, x) => s + x, 0) / xs.length; }
function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

function runSample(root, level, seed) {
  const built = buildBundle(root, level, seed);
  const { text, stats, probe, latestLog, injectMaxBytes, injectMaxLines } = measure(built.home);
  const survivors = extractSurvivors(text, LINK_RE);
  const planSurvivors = extractSurvivors(text, PLAN_LINK_RE);
  const hit = QUESTIONS.filter((q) => survivors.has(`/${q.answerConcept}`)).map((q) => q.id);
  return {
    home: built.home,
    planted: built.planted,
    survivors,
    text,
    latestLog,
    sample: {
      level,
      seed,
      seedCount: built.seedCount,
      fillerCount: built.fillerCount,
      recall: hit.length / QUESTIONS.length,
      hitIds: hit,
      survivorCount: survivors.size,
      planRegexSurvivorCount: planSurvivors.size,
      taken: stats.taken,
      total: stats.total,
      truncatedBytes: stats.truncatedBytes,
      cappedLines: stats.cappedLines,
      leftoverBytes: stats.leftoverBytes,
      starvationEvents: stats.starvationEvents ?? 0,
      assembledBytes: stats.assembledBytes,
      finalBytes: stats.finalBytes,
      headBytes: probe.headBytes,
      tailBytes: probe.tailBytes,
      injectMaxBytes,
      injectMaxLines,
      survivorsAllPlanted: [...survivors].every((rel) => built.planted.has(rel)),
    },
  };
}

function determinismCheck(root) {
  const LEVEL = 24, SEED = 7, RUNS = 10;
  const digests = [];
  const survivorSigs = [];
  for (let i = 0; i < RUNS; i++) {
    const r = runSample(root, LEVEL, SEED);
    digests.push(crypto.createHash('sha256').update(indexSection(r.text)).digest('hex'));
    survivorSigs.push(JSON.stringify([...r.survivors].sort()));
    fs.rmSync(r.home, { recursive: true, force: true });
  }
  const identical = digests.every((d) => d === digests[0]);
  const survivorsIdentical = survivorSigs.every((s) => s === survivorSigs[0]);
  return {
    level: LEVEL, seed: SEED, runs: RUNS,
    identicalDigests: `${digests.filter((d) => d === digests[0]).length}/${RUNS}`,
    identicalSurvivorSets: `${survivorSigs.filter((s) => s === survivorSigs[0]).length}/${RUNS}`,
    digest: digests[0],
    pass: identical && survivorsIdentical,
  };
}

// ---------------------------------------------------------------------------
function main() {
  const args = parseArgs(process.argv.slice(2));
  const levels = args.levels ?? QUESTIONS_FILE.levels;
  const startedAt = new Date();

  // 루트 tmp는 **한 번만** 만든다. 접두 `okf-bench-`는 필수 — lib/paths.mjs의
  // OKF_TEST_FIXTURE가 `bench`를 이미 sweep 제외로 잡는다(임시 경로 AND 픽스처명).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-bench-recall-'));
  const trap = plantPathTrap(root);

  try {
    if (args.determinismCheck) {
      const result = determinismCheck(root);
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.pass ? 0 : 1;
      return;
    }

    const calibration = calibrate(root);
    const samples = [];
    const crossChecks = [];

    for (const level of levels) {
      for (let seed = 1; seed <= args.seeds; seed++) {
        const r = runSample(root, level, seed);
        if (seed === 1) {
          crossChecks.push({ level, seed, ...crossCheckWithHook(r.home, trap, r.survivors, r.latestLog) });
        }
        samples.push(r.sample);
        // **측정 직후 삭제.** 스모크의 sandbox 미정리 관례에 대한 의도적 예외다 —
        // 200 concept × 20 시드 × 4 레벨이면 홈 80개에 concept 파일 ~9,000개와 그만큼의
        // git 오브젝트가 tmpdir에 남는다. 재현은 (level, seed)로 언제든 다시 조립된다.
        fs.rmSync(r.home, { recursive: true, force: true });
      }
    }

    const byLevel = levels.map((level) => {
      const rs = samples.filter((s) => s.level === level).map((s) => s.recall);
      const cwdIds = new Set(QUESTIONS.filter((q) => q.cwdIndependent).map((q) => q.id));
      const cwdRs = samples.filter((s) => s.level === level)
        .map((s) => s.hitIds.filter((id) => cwdIds.has(id)).length / cwdIds.size);
      return {
        level,
        n: rs.length,
        recallMean: mean(rs),
        recallStdev: stdev(rs),
        recallMin: Math.min(...rs),
        recallMax: Math.max(...rs),
        cwdIndependentRecallMean: mean(cwdRs),
        cwdIndependentRecallStdev: stdev(cwdRs),
        cwdIndependentN: cwdIds.size,
      };
    });

    const perQuestion = QUESTIONS.map((q) => ({
      id: q.id,
      answerConcept: q.answerConcept,
      cwdIndependent: !!q.cwdIndependent,
      survivalRate: samples.filter((s) => s.hitIds.includes(q.id)).length / samples.length,
      byLevel: Object.fromEntries(levels.map((level) => {
        const rs = samples.filter((s) => s.level === level);
        return [level, rs.filter((s) => s.hitIds.includes(q.id)).length / rs.length];
      })),
    }));

    const at = (level) => byLevel.find((b) => b.level === level)?.recallMean ?? null;
    const monotonicViolations = [];
    for (let i = 1; i < byLevel.length; i++) {
      if (byLevel[i].recallMean > byLevel[i - 1].recallMean) {
        monotonicViolations.push({
          from: byLevel[i - 1].level, to: byLevel[i].level,
          means: [byLevel[i - 1].recallMean, byLevel[i].recallMean],
          delta: byLevel[i].recallMean - byLevel[i - 1].recallMean,
          stdevAtTo: byLevel[i].recallStdev,
        });
      }
    }
    const worstStdev = byLevel.reduce((a, b) => (b.recallStdev > a.recallStdev ? b : a), byLevel[0]);
    const refutation = {
      R1: { fired: at(50) !== null && at(50) >= 0.90, basis: { 'recall(50)': at(50), threshold: 0.90 }, meaning: '라우팅은 병목이 아니다 → I2를 v0.3에서도 착수하지 않는다' },
      R2: { fired: at(24) !== null && at(24) < 0.60, basis: { 'recall(24)': at(24), threshold: 0.60 }, meaning: '실사용 규모에서 이미 실패 중' },
      R3: { fired: monotonicViolations.length > 0, basis: { violations: monotonicViolations }, meaning: '단조 감소 위반 → 하니스 결함, 전 결과 폐기' },
      R4: { fired: worstStdev ? worstStdev.recallStdev > 0.25 : false, basis: { worstLevel: worstStdev?.level ?? null, stdev: worstStdev?.recallStdev ?? null, threshold: 0.25 }, meaning: 'filler 명명에 지배됨, 정책 결론 금지' },
      R5: { fired: calibration.mismatches.length > 0, basis: { mismatches: calibration.mismatches }, meaning: '캘리브레이션 불일치 → 전 결과 무효' },
    };

    const pluginVersion = readJson(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json')).version;
    const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: PLUGIN_ROOT, encoding: 'utf8' }).stdout?.trim() || null;
    const out = {
      meta: {
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        nodeVersion: process.version,
        platform: process.platform,
        pluginVersion,
        commit,
        levels,
        seeds: args.seeds,
        questionSet: 'test/fixtures/bench/gate-recall.json',
        questionSetFrozenAt: QUESTIONS_FILE.frozenAt,
        shapeFixture: SHAPE_REL,
        // PATH 트랩이 발동했는가. 상수가 아니라 파일시스템 실측이다.
        paidCallTrapTripped: fs.existsSync(trap.tripped),
        actualHeadBytes: samples[0]?.headBytes ?? null,
        actualTailBytes: samples[0]?.tailBytes ?? null,
        liveHeadBytes: SHAPE.liveHeadBytes,
        indexBudgetBytes: SHAPE.indexBudgetBytes,
        indexBudgetLines: SHAPE.indexBudgetLines,
        // 계획서 I6-5의 `- [` 정규식으로 센 생존 수(전 샘플 합). 0이면 사양이 신 포맷(`* `)과
        // 어긋난다는 증거다.
        planRegexSurvivorTotal: samples.reduce((s, x) => s + x.planRegexSurvivorCount, 0),
      },
      calibration,
      refutation,
      byLevel,
      perQuestion,
      crossChecks,
      samples,
    };

    const iso = startedAt.toISOString().replace(/[:.]/g, '-');
    const outPath = args.outPath ?? path.join(PLUGIN_ROOT, 'docs', 'benchmarks', 'raw', `gate-recall-${iso}.json`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);

    for (const b of byLevel) {
      console.log(`N=${b.level}  recall ${b.recallMean.toFixed(3)} ± ${b.recallStdev.toFixed(3)}  (n=${b.n}, ${b.recallMin.toFixed(2)}–${b.recallMax.toFixed(2)})  cwdIndep ${b.cwdIndependentRecallMean.toFixed(3)}`);
    }
    console.log(`calibration mismatches: ${calibration.mismatches.length}`);
    console.log(`R1..R5 fired: ${Object.entries(refutation).filter(([, v]) => v.fired).map(([k]) => k).join(',') || 'none'}`);
    console.log(`paidCallTrapTripped: ${out.meta.paidCallTrapTripped}`);
    console.log(`hook cross-check byte-identical at hook config: ${crossChecks.filter((c) => c.byteIdenticalAtHookConfig).length}/${crossChecks.length}`);
    console.log(`plan-regex (\`- [\`) survivors across all samples: ${out.meta.planRegexSurvivorTotal}`);
    console.log(`out: ${outPath}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
