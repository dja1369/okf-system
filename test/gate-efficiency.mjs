// 축 E — 게이트 효율 하니스.
//
// **무엇을 재는가.** E1~E3는 전부 OKF 자신의 입력만 흔들었다(번들 크기, title 섭동, 중첩 깊이).
// 그래서 "게이트가 얼마나 살아남느냐"는 알았지만 **"그 형식이 값을 하느냐"**는 한 번도 묻지
// 않았다. 비교 대상이 없었기 때문이다. 이 회차는 비교 대상을 세운다:
//
//   같은 번들, 같은 바이트 예산에서 인덱스 전략을 갈아끼우고 답 도달률을 잰다.
//
// 이 질문은 저장소 밖에 근거가 있다. 라이브 번들의 `/references/okf/okf-system-architecture.md`는
// 2026-07-17에 게이트를 "카테고리 개수만 주입" → "제목+설명 주입"으로 바꾼 근거를 이렇게 적었다:
// *"실측 결과 이 형태는 실효성이 없었다 — 개수만으로는 관련성을 판단할 근거가 없어 모델이 하위
// concept를 Read하지 않았다(실제로 관련 문서가 있었는데도 열지 않은 사례가 실측으로 확인됨)."*
// 근거가 **사례 1건**이고, 같은 문서가 비용을 *"concept 3개 기준"*(n=3)으로 적었다. 즉 출하된
// 형식의 값어치는 지금까지 일화로만 정당화됐다. 여기서 그것을 수치로 바꾸거나 반증한다.
//
// **유료 호출 0.** LLM을 부르지 않는다. 주장이 아니라 증거로 남기려고 하니스 자신의 PATH 앞에
// `claude` 스텁을 깔고(plantPathTrap), 스텁 존재 여부와 발동 여부를 둘 다 파일시스템에서 실측해
// meta에 남긴다. 스텁이 없으면 "발동 안 함"은 증거가 아니다.
//
// CLI:
//   node test/gate-efficiency.mjs --freeze-queries     # 쿼리 픽스처 생성(측정 아님)
//   node test/gate-efficiency.mjs [--levels 26,50,100,200] [--seeds 30] [--budgets 2048,4096,9000]
//   node test/gate-efficiency.mjs --determinism-check
//   node test/gate-efficiency.mjs --smoke              # 축소 실행(스모크용)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { ensureBootstrap } from '../lib/bootstrap.mjs';
import { regenerateIndex } from '../lib/index-gen.mjs';
import { buildInjectedIndex, collectConceptLines } from '../lib/gate.mjs';
import { discoverConceptDirs } from '../lib/index-gen.mjs';
import { SCAN_EXCLUDE_DIRS, NON_CONCEPT_BASENAMES } from '../lib/paths.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = path.join(PLUGIN_ROOT, 'test', 'fixtures', 'bench', 'gate-recall');
const EFF_FIXTURE = path.join(PLUGIN_ROOT, 'test', 'fixtures', 'bench', 'gate-efficiency-queries.json');
const B = (s) => Buffer.byteLength(s, 'utf8');

// ---------------------------------------------------------------------------
// 인자

function parseArgs(argv) {
  // 시드 40은 측정 **전에** 검정력으로 정했다. 짝지은 양측 부호검정 α=0.05에서 효과가 시드의
  // 80%에 일관되면 검정력 0.981, 70%면 0.703이다 — 즉 이 회차의 "차이 없음"은 70% 수준의
  // 효과를 배제하지 못한다. 그 한계는 리포트에 그대로 싣는다(E3가 n=20으로 겪은 실패의 교정).
  const out = { levels: [26, 50, 100, 200], seeds: 40, budgets: [2048, 4096, 9000] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--freeze-queries') out.freezeQueries = true;
    else if (a === '--determinism-check') out.determinismCheck = true;
    else if (a === '--smoke') out.smoke = true;
    else if (a === '--levels') out.levels = argv[++i].split(',').map(Number);
    else if (a === '--budgets') out.budgets = argv[++i].split(',').map(Number);
    else if (a === '--seeds') out.seeds = Number(argv[++i]);
    else if (a === '--out') out.out = argv[++i];
    else throw new Error(`unknown arg: ${a}`);
  }
  if (out.smoke) { out.levels = [26, 50]; out.seeds = 3; out.budgets = [4096]; }
  return out;
}
const ARGS = parseArgs(process.argv.slice(2));

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const SHAPE = readJson(path.join(FIXTURE_DIR, 'live-shape-2026-07-27-e2.json'));
const DISTRACTORS = readJson(path.join(FIXTURE_DIR, 'distractors-e2.json'));
// 정답 concept 목록은 E3 픽스처에서 **경로만** 승계한다. 질문 텍스트는 쓰지 않는다 —
// 이 회차의 쿼리는 아래 deriveQuery가 concept 본문에서 기계 생성한다(저자 편향 제거).
const SOURCE_CONCEPTS = readJson(path.join(PLUGIN_ROOT, 'test', 'fixtures', 'bench', 'gate-recall-e3.json'))
  .questions.map((q) => ({ id: q.id, answerConcept: q.answerConcept, sourceFile: q.sourceFile }));

// ---------------------------------------------------------------------------
// 토크나이저. 번들이 한국어 위주라 공백 분할은 조사가 붙어 무용하다. 라틴/숫자는 단어 단위로,
// 한글·가나·한자는 **문자 바이그램**으로 쪼갠다. 형태소 분석기를 쓰지 않는 이유는 사전이
// 결과를 좌우해 재현이 사전 버전에 묶이기 때문이다 — 바이그램은 사전이 없다.
// 이 함수는 전략에 대해 중립이다: 어떤 전략이 실은 텍스트든 **같은 규칙**으로 쪼갠다.
function tokenize(s) {
  const out = [];
  for (const m of s.toLowerCase().matchAll(/[a-z0-9]+/g)) out.push(m[0]);
  for (const m of s.matchAll(/[가-힯぀-ヿ一-鿿]+/g)) {
    const r = m[0];
    if (r.length === 1) { out.push(r); continue; }
    for (let i = 0; i + 1 < r.length; i++) out.push(r.slice(i, i + 2));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 쿼리 생성 — **손으로 쓰지 않는다.**
//
// E1~E3의 질문 20개는 내가 썼고(6개는 처음부터 창작), 그 사실이 매 회차 한계로 남았다.
// 이 회차는 그 손을 뗀다: 쿼리는 정답 concept의 **본문**에서 tf-idf 상위 항을 뽑아 만든다.
// 본문은 인덱스에 실리지 않는 부분이므로(인덱스는 title+description만 싣는다) "정답을 보고
// 질문을 만든" 것이 아니다 — 사용자가 그 문서의 내용을 기억해 떠올리는 상황의 근사다.
//
// 전략 간 공정성: 쿼리는 전략을 보지 않고 만들어지고, 모든 전략에 **같은 쿼리**가 간다.
function stripBody(md) {
  let s = md;
  if (s.startsWith('---')) {
    const end = s.indexOf('\n---', 3);
    if (end !== -1) s = s.slice(end + 4);
  }
  return s.replace(/```[\s\S]*?```/g, ' ');
}

function deriveQueries(topK = 8) {
  const docs = SOURCE_CONCEPTS.map((c) => {
    const abs = path.join(PLUGIN_ROOT, c.sourceFile);
    return { ...c, tokens: tokenize(stripBody(fs.readFileSync(abs, 'utf8'))) };
  });
  const df = new Map();
  for (const d of docs) for (const t of new Set(d.tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  return docs.map((d) => {
    const tf = new Map();
    for (const t of d.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    const scored = [...tf].map(([t, f]) => [t, f * Math.log(docs.length / df.get(t))]);
    // 동점은 토큰 사전순으로 깬다 — Map 삽입 순서에 결과가 묶이면 재현이 파일 읽기 순서에 묶인다.
    scored.sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return { id: d.id, answerConcept: `/${d.answerConcept}`, terms: scored.slice(0, topK).map(([t]) => t) };
  });
}

// ---------------------------------------------------------------------------
// BM25. 문서 = **주입된 텍스트의 각 줄**. 모델이 보는 것이 그것뿐이므로 그것만 순위 대상이다.
// 길이 정규화가 있는 BM25를 쓰는 이유: 정규화 없는 점수 합은 긴 줄(=description을 실은 줄)을
// 기계적으로 이롭게 해서 "설명이 값을 한다"는 이 회차의 결론을 미리 심는다. BM25의 b=0.75는
// 오히려 긴 문서에 **벌점**을 준다. 파라미터는 표준 기본값이고 측정 전에 고정했다.
const BM25_K1 = 1.2;
const BM25_B = 0.75;

function bm25Rank(lines, queryTerms) {
  const docs = lines.map((l) => tokenize(l));
  const N = docs.length;
  if (N === 0) return [];
  const avgdl = docs.reduce((s, d) => s + d.length, 0) / N;
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const scores = docs.map((d, i) => {
    const tf = new Map();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let s = 0;
    for (const q of queryTerms) {
      const f = tf.get(q);
      if (!f) continue;
      const idf = Math.log(1 + (N - df.get(q) + 0.5) / (df.get(q) + 0.5));
      s += idf * (f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + BM25_B * (d.length / (avgdl || 1))));
    }
    return { i, s };
  });
  // 동점은 **주입 순서**로 깬다(먼저 실린 줄이 앞). 무작위 tie-break은 재현을 깬다.
  scores.sort((a, b) => (b.s - a.s) || (a.i - b.i));
  return scores;
}

// ---------------------------------------------------------------------------
// 번들 합성. E2/E3와 **같은 형상·distractor 픽스처를 읽어** 만든다(사본을 뜨지 않는다).
// 여기서 바꾸는 것은 오직 "무엇을 재는가"이고 번들 자체는 앞 회차와 같은 모집단이다.

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fitBytes(text, targetBytes) {
  if (targetBytes <= 0) return '';
  let out = ''; let used = 0;
  for (const ch of text) {
    const w = B(ch);
    if (used + w > targetBytes) break;
    out += ch; used += w;
  }
  return out + 'x'.repeat(targetBytes - used);
}

// index-gen의 foldToSingleLine이 대괄호·마크업형 `<`·제어문자를 접으면 1B가 3B가 되어 목표
// 줄 바이트가 어긋난다. 정규식 리터럴 대신 코드포인트로 거르는 이유는 이스케이프가 한 겹만
// 어긋나도 조용히 다른 문자를 지우기 때문이다 — 여기서는 무엇을 지우는지가 눈에 보여야 한다.
const FOLD_CHARS = new Set(['[', ']', '<', '>']);
function sanitize(t) {
  let out = '';
  for (const ch of t) {
    const cp = ch.codePointAt(0);
    const isControl = cp <= 0x1f || cp === 0x7f || cp === 0x85 || cp === 0x2028 || cp === 0x2029;
    if (isControl) { out += ' '; continue; }
    if (FOLD_CHARS.has(ch)) continue;
    out += ch;
  }
  return out;
}

function listConcepts(home, rel = '') {
  let entries;
  try { entries = fs.readdirSync(path.join(home, rel), { withFileTypes: true }); } catch { return []; }
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

const CATEGORY_WEIGHTS = SHAPE.categories.map((c) => ({ dir: c.dir, weight: c.lineBytes.length }));
const WEIGHT_TOTAL = CATEGORY_WEIGHTS.reduce((s, c) => s + c.weight, 0);
const LINE_BYTE_POOL = SHAPE.categories.flatMap((c) => c.lineBytes);
const TYPE_OF = {
  projects: 'project', decisions: 'decision', preferences: 'preference',
  patterns: 'pattern', references: 'reference', troubleshooting: 'troubleshooting',
};

function pickCategory(r) {
  let x = r * WEIGHT_TOTAL;
  for (const c of CATEGORY_WEIGHTS) { x -= c.weight; if (x < 0) return c.dir; }
  return CATEGORY_WEIGHTS[CATEGORY_WEIGHTS.length - 1].dir;
}

function buildBundle(root, level, seed) {
  const home = path.join(root, `L${String(level).padStart(3, '0')}-S${String(seed).padStart(3, '0')}`);
  fs.mkdirSync(home, { recursive: true });
  ensureBootstrap(home);

  const seedConcepts = listConcepts(home);
  for (const c of SOURCE_CONCEPTS) {
    const dest = path.join(home, c.answerConcept);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(PLUGIN_ROOT, c.sourceFile), dest);
  }

  const fillerCount = level - SOURCE_CONCEPTS.length - seedConcepts.length;
  if (fillerCount < 0) {
    throw new Error(`level ${level} < floor ${SOURCE_CONCEPTS.length + seedConcepts.length}`);
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
    const name = `${src.slug}-f${String(i).padStart(3, '0')}.md`;
    const overhead = 3 + 2 + B(`/${dir}/${name}`) + 4;
    const avail = target - overhead;
    const suffix = ` #f${String(i).padStart(3, '0')}`;
    const cap = Math.floor(avail / 3);
    const titleBytes = Math.max(4, Math.min(B(sanitize(src.title)), cap - B(suffix)));
    const title = fitBytes(sanitize(src.title), titleBytes) + suffix;
    const description = fitBytes(sanitize(src.description), Math.max(1, avail - B(title)));
    const abs = path.join(home, dir, name);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `---\ntype: ${TYPE_OF[dir]}\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\ntimestamp: 2026-07-15\n---\n본문\n`);
  }
  fs.writeFileSync(path.join(home, 'log.md'), SHAPE.logMd);
  regenerateIndex(home);
  return { home, seedCount: seedConcepts.length, fillerCount };
}

// ---------------------------------------------------------------------------
// 전략. 전부 **같은 바이트 예산**을 받고 index 블록 문자열을 낸다.
//
// 예산 동형: 게이트가 실제로 index에 쓰는 예산은 head/tail을 뺀 나머지다. 모든 전략에 그
// 나머지를 그대로 준다 — 전략끼리 예산이 다르면 비교 자체가 무의미하다.

const LINK_RE = /\]\((\/[^)\s]+)\)/;

function allConceptLines(home) {
  // 게이트가 실제로 순회하는 바로 그 순서·형식(절대경로 링크로 복원된 줄).
  const out = [];
  for (const dir of discoverConceptDirs(home)) {
    for (const line of collectConceptLines(home, dir)) out.push({ dir, line });
  }
  return out;
}

function fillToBudget(lines, budgetBytes, budgetLines) {
  const out = [];
  let bytes = 0;
  for (const l of lines) {
    const cost = B(`${l}\n`);
    if (bytes + cost > budgetBytes || out.length >= budgetLines) break;
    out.push(l); bytes += cost;
  }
  return out.join('\n');
}

const STRATEGIES = {
  // 출하 구현. round-robin + heading + 생략 마커 + title/description.
  okf: (home, bytes, lines) => buildInjectedIndex(home, lines, bytes),

  // round-robin을 뺀 것. 카테고리 순서대로 이어붙이고 캡에서 자른다.
  // heading·마커가 없으므로 그만큼 concept 줄을 **더** 실을 수 있다(전략에 유리한 쪽).
  dump: (home, bytes, lines) => fillToBudget(allConceptLines(home).map((x) => x.line), bytes, lines),

  // description을 뗀 것. 설명이 자기 바이트값을 하는지 묻는다.
  titles: (home, bytes, lines) => fillToBudget(
    allConceptLines(home).map((x) => x.line.replace(/\)\s*[-:].*$/, ')')), bytes, lines),

  // 링크 경로만. 바이트당 concept 수 최대.
  paths: (home, bytes, lines) => fillToBudget(
    allConceptLines(home).map((x) => LINK_RE.exec(x.line)?.[1]).filter(Boolean), bytes, lines),

  // 시드 셔플. "어떤 순서든 상관없다"의 귀무가설.
  random: (home, bytes, lines, seed) => {
    const all = allConceptLines(home).map((x) => x.line);
    const rand = mulberry32(((seed + 1) * 0x85ebca6b) >>> 0);
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    return fillToBudget(all, bytes, lines);
  },

  // 2026-07-17 이전 게이트: 루트 index.md 원문(카테고리 링크만).
  root: (home, bytes) => {
    const raw = fs.readFileSync(path.join(home, 'index.md'), 'utf8');
    const body = raw.replace(/^---[\s\S]*?\n---\n/, '');
    return B(body) <= bytes ? body : body.slice(0, bytes);
  },
};

// 예산 무관 천장. 캡 없이 전 concept 줄을 실었을 때의 sel@1 — 손실 중 얼마가 **예산** 탓이고
// 얼마가 **검색** 탓인지 가른다. 예산 비교 대상이 아니므로 표에서 분리해 싣는다.
const CEILING = (home) => allConceptLines(home).map((x) => x.line).join('\n');

// ---------------------------------------------------------------------------
// 측정

// 줄에서 concept 경로를 뽑는다. **마크다운 링크만 보면 안 된다** — `paths` 전략은 맨 경로를
// 싣는다. 첫 실행에서 이 함수가 링크 문법만 봐서 `paths`의 reach가 12셀 전부 0.000으로 나왔고,
// 그것을 "경로만으로는 도달 자체가 안 된다"는 발견으로 읽을 뻔했다. 발견이 아니라 결함이었다.
function conceptPathOf(line) {
  const md = LINK_RE.exec(line)?.[1];
  if (md) return md;
  const bare = line.trim();
  return /^\/[^\s)]+\.md$/.test(bare) ? bare : null;
}

function evaluate(indexText, queries) {
  const lines = indexText.split('\n').filter((l) => l.trim() !== '');
  const linkOf = lines.map(conceptPathOf);
  let reach = 0; let sel1 = 0; let sel5 = 0;
  const perQuery = [];
  for (const q of queries) {
    const at = linkOf.indexOf(q.answerConcept);
    const reached = at !== -1;
    let rank = null;
    if (reached) {
      const ranked = bm25Rank(lines, q.terms);
      rank = ranked.findIndex((r) => r.i === at) + 1; // 1-based
    }
    if (reached) reach++;
    if (rank === 1) sel1++;
    if (rank !== null && rank <= 5) sel5++;
    perQuery.push({ id: q.id, reached, rank });
  }
  const n = queries.length;
  const injectedBytes = B(indexText);
  return {
    injectedBytes,
    injectedLines: lines.length,
    conceptLines: linkOf.filter(Boolean).length,
    reach: reach / n,
    sel1: sel1 / n,
    sel5: sel5 / n,
    // **효율의 분해.** sel@1 = (도달률) x (도달했을 때 1위로 뽑힐 확률)이다. 두 항은 서로
    // 반대로 움직인다 — 줄을 짧게 하면 더 많이 실려 도달률이 오르지만 줄에 남는 식별 신호가
    // 줄어 정밀도가 떨어진다. 합쳐진 sel@1만 보면 어느 쪽이 움직였는지 알 수 없어서 나눠 싣는다.
    sel1GivenReached: reach > 0 ? sel1 / reach : null,
    // 정답 하나를 1위로 세우는 데 든 주입 바이트. 낮을수록 효율적이다.
    bytesPerSel1: sel1 > 0 ? injectedBytes / sel1 : null,
    perQuery,
  };
}

// ---------------------------------------------------------------------------
// 통계 — 짝지은 부호검정. 단위는 **시드**다(시드마다 20문항 평균을 하나의 관측으로).
// 같은 번들·같은 예산에서 두 전략을 비교하므로 번들 변동이 상쇄된다.

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}
function signTest(deltas) {
  const pos = deltas.filter((d) => d > 0).length;
  const neg = deltas.filter((d) => d < 0).length;
  const n = pos + neg;
  if (n === 0) return { pos, neg, ties: deltas.length, n: 0, p: 1 };
  const k = Math.min(pos, neg);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += choose(n, i);
  const p = Math.min(1, 2 * tail / 2 ** n);
  return { pos, neg, ties: deltas.length - n, n, p };
}
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

// 사전 검정력. 시드 n에서 "효과가 시드의 q 비율에 일관되게 나타난다"면 양측 부호검정이
// α에서 유의해질 확률. 측정 **전에** 시드 수를 정하려고 쓴다.
function signTestPower(n, q, alpha) {
  // 임계: 소수 쪽 개수 k 이하일 때 p <= alpha
  let crit = -1;
  for (let k = 0; k <= n / 2; k++) {
    let tail = 0;
    for (let i = 0; i <= k; i++) tail += choose(n, i);
    if (2 * tail / 2 ** n <= alpha) crit = k; else break;
  }
  if (crit < 0) return 0;
  // 관측 부호가 iid Bernoulli(q)일 때 소수 쪽이 crit 이하일 확률
  let power = 0;
  for (let k = 0; k <= crit; k++) power += choose(n, k) * q ** (n - k) * (1 - q) ** k;
  return power;
}

// ---------------------------------------------------------------------------
// 유료 0 증명

function plantPathTrap(root) {
  const trapDir = path.join(root, 'path-trap');
  fs.mkdirSync(trapDir, { recursive: true });
  const tripped = path.join(trapDir, 'TRIPPED');
  const stub = path.join(trapDir, process.platform === 'win32' ? 'claude.cmd' : 'claude');
  if (process.platform === 'win32') {
    fs.writeFileSync(stub, `@echo off\r\n>"${tripped}" echo tripped\r\nexit /b 1\r\n`);
  } else {
    fs.writeFileSync(stub, `#!/bin/sh\necho tripped > "${tripped}"\nexit 1\n`);
    fs.chmodSync(stub, 0o755);
  }
  process.env.PATH = `${trapDir}${path.delimiter}${process.env.PATH ?? ''}`;
  return { tripped, stub };
}

// ---------------------------------------------------------------------------

function runCell(home, seed, budgetBytes, queries) {
  // head/tail을 뺀 index 예산. lib/gate.mjs buildContext가 쓰는 것과 같은 계산이다.
  const HEAD_LINES = 9; const TAIL_LINES = 2;
  const budgetLines = Math.max(1, 120 - HEAD_LINES - TAIL_LINES);
  const out = {};
  for (const [name, fn] of Object.entries(STRATEGIES)) {
    const text = fn(home, budgetBytes, budgetLines, seed);
    out[name] = evaluate(text, queries);
  }
  out._ceiling = evaluate(CEILING(home), queries);
  return out;
}

function main() {
  if (ARGS.freezeQueries) {
    const queries = deriveQueries();
    fs.writeFileSync(EFF_FIXTURE, `${JSON.stringify({
      frozenAt: '2026-07-27',
      note: '쿼리는 정답 concept 본문의 tf-idf 상위 8항이다. 손으로 쓰지 않았다. 생성 규칙은 test/gate-efficiency.mjs deriveQueries.',
      topK: 8,
      tokenizer: 'latin/digit words + CJK character bigrams',
      queries,
    }, null, 2)}\n`);
    process.stdout.write(`froze ${queries.length} queries -> ${path.relative(PLUGIN_ROOT, EFF_FIXTURE)}\n`);
    return;
  }

  const QUERIES = readJson(EFF_FIXTURE).queries;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-eff-'));
  const trap = plantPathTrap(root);

  if (ARGS.determinismCheck) {
    const hashes = [];
    for (let i = 0; i < 3; i++) {
      const { home } = buildBundle(path.join(root, `d${i}`), 50, 7);
      const cell = runCell(home, 7, 4096, QUERIES);
      hashes.push(crypto.createHash('sha256').update(JSON.stringify(cell)).digest('hex'));
    }
    const same = new Set(hashes).size === 1;
    process.stdout.write(`${same ? 'DETERMINISTIC' : 'NON-DETERMINISTIC'} ${hashes[0].slice(0, 16)}\n`);
    process.exitCode = same ? 0 : 1;
    return;
  }

  // 같은 (level, seed)의 번들은 예산과 무관하게 동일하다 — 한 번 만들어 모든 예산에 쓴다.
  // 예산마다 다시 만들면 비용만 3배가 되고, 셀 사이에 번들이 달라질 위험만 새로 생긴다.
  const cells = [];
  for (const level of ARGS.levels) {
    for (let seed = 1; seed <= ARGS.seeds; seed++) {
      const { home, seedCount, fillerCount } = buildBundle(root, level, seed);
      for (const budget of ARGS.budgets) {
        cells.push({ level, budget, seed, seedCount, fillerCount, strategies: runCell(home, seed, budget, QUERIES) });
      }
      fs.rmSync(home, { recursive: true, force: true });
    }
  }

  // 집계
  const names = [...Object.keys(STRATEGIES), '_ceiling'];
  const byCell = [];
  for (const level of ARGS.levels) {
    for (const budget of ARGS.budgets) {
      const group = cells.filter((c) => c.level === level && c.budget === budget);
      const per = {};
      for (const n of names) {
        per[n] = {
          reach: mean(group.map((c) => c.strategies[n].reach)),
          sel1: mean(group.map((c) => c.strategies[n].sel1)),
          sel5: mean(group.map((c) => c.strategies[n].sel5)),
          injectedBytes: mean(group.map((c) => c.strategies[n].injectedBytes)),
          conceptLines: mean(group.map((c) => c.strategies[n].conceptLines)),
          // 도달률 0인 셀은 정밀도가 정의되지 않는다. null을 평균에 섞으면 0으로 취급돼
          // 정밀도가 거짓으로 낮아지므로, 정의된 셀만 모아 평균하고 그 개수를 함께 남긴다.
          sel1GivenReached: mean(group.map((c) => c.strategies[n].sel1GivenReached).filter((x) => x !== null)),
          sel1GivenReachedCells: group.filter((c) => c.strategies[n].sel1GivenReached !== null).length,
          bytesPerSel1: mean(group.map((c) => c.strategies[n].bytesPerSel1).filter((x) => x !== null)),
        };
      }
      // 짝지은 검정: okf vs 각 대안 (sel1 기준)
      const paired = {};
      for (const n of Object.keys(STRATEGIES)) {
        if (n === 'okf') continue;
        const dSel1 = group.map((c) => c.strategies.okf.sel1 - c.strategies[n].sel1);
        const dReach = group.map((c) => c.strategies.okf.reach - c.strategies[n].reach);
        paired[n] = {
          sel1: { meanDelta: mean(dSel1), ...signTest(dSel1) },
          reach: { meanDelta: mean(dReach), ...signTest(dReach) },
        };
      }
      // **등록된 H2는 두 변화를 겹쳐 잰다.** `titles`는 okf에서 설명을 뗀 것이 아니라
      // `dump` 순서 + 설명 없음이다. 그래서 okf ↔ titles 차이에는 "설명을 뗀 효과"와
      // "round-robin을 뺀 효과"가 함께 들어 있다. 등록된 전략만으로 둘을 가를 수 있다 —
      // 순서가 같은 쌍끼리 비교하면 된다. 새 전략을 추가하지 않으므로 사후 추가가 아니다.
      const contrast = (a, b) => {
        const d = group.map((c) => c.strategies[a].sel1 - c.strategies[b].sel1);
        return { a, b, meanDelta: mean(d), ...signTest(d) };
      };
      const decomposed = {
        // 순서 고정(둘 다 dump 순서), 설명만 다름 → 순수 "설명 효과"
        descriptionEffect: contrast('titles', 'dump'),
        // 내용 고정(둘 다 title+description), 순서·오버헤드만 다름 → 순수 "round-robin 효과"
        roundRobinEffect: contrast('okf', 'dump'),
      };
      byCell.push({ level, budget, seeds: group.length, per, pairedVsOkf: paired, decomposed });
    }
  }

  // 사전등록 가드 R3~R5. **문서에 적기만 하고 재지 않으면 가드가 아니다.**
  // 위반은 개수만이 아니라 첫 사례의 좌표까지 남긴다 — "몇 건"만으로는 고칠 수 없다.
  const violations = { budgetOverrun: [], identity: [] };
  for (const c of cells) {
    for (const [name, r] of Object.entries(c.strategies)) {
      if (name === '_ceiling') continue; // 천장은 예산 대상이 아니다(정의상 캡 없음)
      if (r.injectedBytes > c.budget) {
        violations.budgetOverrun.push({ level: c.level, budget: c.budget, seed: c.seed, strategy: name, bytes: r.injectedBytes });
      }
    }
    for (const [name, r] of Object.entries(c.strategies)) {
      if (r.sel1 > r.reach + 1e-9) {
        violations.identity.push({ level: c.level, budget: c.budget, seed: c.seed, strategy: name, sel1: r.sel1, reach: r.reach });
      }
    }
  }
  const ceilingSel1 = mean(cells.map((c) => c.strategies._ceiling.sel1));
  const guards = {
    R2_paidZero: { installed: fs.existsSync(trap.stub), tripped: fs.existsSync(trap.tripped) },
    R3_budgetRespected: { violations: violations.budgetOverrun.length, firstFew: violations.budgetOverrun.slice(0, 5) },
    R4_ceiling: { sel1: ceilingSel1, threshold: 0.80, pass: ceilingSel1 >= 0.80 },
    R5_identity: { violations: violations.identity.length, firstFew: violations.identity.slice(0, 5) },
  };
  guards.allPass = guards.R2_paidZero.installed && !guards.R2_paidZero.tripped
    && guards.R3_budgetRespected.violations === 0 && guards.R4_ceiling.pass
    && guards.R5_identity.violations === 0;

  const report = {
    guards,
    meta: {
      round: 'E-eff',
      axis: 'E — 게이트 효율(동일 예산 전략 비교)',
      generatedAt: new Date().toISOString(),
      commit: process.env.OKF_BENCH_COMMIT ?? null,
      node: process.version,
      levels: ARGS.levels,
      budgets: ARGS.budgets,
      seeds: ARGS.seeds,
      queries: QUERIES.length,
      queryOrigin: 'concept 본문 tf-idf 상위 8항 — 손으로 쓴 질문 없음',
      retriever: { name: 'BM25', k1: BM25_K1, b: BM25_B, tokenizer: 'latin words + CJK bigrams' },
      paidCallTrapInstalled: fs.existsSync(trap.stub),
      paidCallTrapTripped: fs.existsSync(trap.tripped),
    },
    powerAnalysis: {
      note: '측정 전에 시드 수를 정하려고 계산한 값. 짝지은 양측 부호검정, α=0.05.',
      alpha: 0.05,
      seeds: ARGS.seeds,
      powerIfConsistentIn: {
        '0.70': signTestPower(ARGS.seeds, 0.70, 0.05),
        '0.80': signTestPower(ARGS.seeds, 0.80, 0.05),
        '0.90': signTestPower(ARGS.seeds, 0.90, 0.05),
      },
    },
    byCell,
    cells,
  };

  const out = ARGS.out ?? path.join(PLUGIN_ROOT, 'docs', 'benchmarks', 'raw',
    `gate-efficiency-${report.meta.generatedAt.slice(0, 10)}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  fs.rmSync(root, { recursive: true, force: true });

  process.stdout.write(`${path.relative(PLUGIN_ROOT, out)}\n`);
  process.stdout.write(`guards: ${guards.allPass ? 'ALL PASS' : 'FAILED'} `
    + `(trap installed=${guards.R2_paidZero.installed} tripped=${guards.R2_paidZero.tripped}, `
    + `budget violations=${guards.R3_budgetRespected.violations}, ceiling=${ceilingSel1.toFixed(3)}, `
    + `identity violations=${guards.R5_identity.violations})\n`);
  for (const c of byCell) {
    const p = c.per;
    const f = (n) => `${n}=${p[n].sel1.toFixed(3)}/${p[n].reach.toFixed(3)}`;
    process.stdout.write(
      `L${String(c.level).padStart(3)} cap${String(c.budget).padStart(4)}  (sel@1/reach)  `
      + `${['okf', 'dump', 'titles', 'paths', 'random', 'root'].map(f).join('  ')}`
      + `  | ceiling=${p._ceiling.sel1.toFixed(3)}\n`);
  }
}

main();
