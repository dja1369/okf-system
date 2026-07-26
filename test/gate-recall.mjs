// recall@cap 하니스 (docs/0-2_develop_plan.md I6-5).
//
// 무엇을 재는가: 게이트가 예산(inject_max_bytes/lines) 안에서 index를 조립할 때, 동결된 20개
// 질문의 정답 concept 줄이 **몇 개나 살아남는가**. 번들 크기 N을 24/50/100/200으로 늘리며
// 시드 20개로 반복한다. 라우팅 코드는 아직 없다 — 이 값은 "관련성 신호 0인 현행 게이트"의
// 기준선이고, I2(라우터)를 착수할지 말지를 R1~R5가 기계로 판정한다.
//
// **유료 호출 0.** 이 하니스는 LLM을 부르지 않는다. 그것을 주장이 아니라 증거로 남기려고
// PATH 트랩(아래 plantPathTrap)을 깐다 — 트랩은 **하니스 프로세스 자신의 PATH**에 걸리고 모든
// 자식이 그걸 상속하므로, 하니스든 훅 서브프로세스든 어떤 경로로든 CLI를 부르면 TRIPPED 파일이
// 생기고 산출 JSON의 meta.paidCallTrapTripped가 true가 된다. 스텁 존재 여부도 실측해
// meta.paidCallTrapInstalled로 남긴다(스텁이 없으면 "발동 안 함"은 증거가 아니다).
//
// CLI:
//   node test/gate-recall.mjs [--levels 24,50,100,200] [--seeds 20] [--out <경로>]
//   node test/gate-recall.mjs --determinism-check
//
// **E2(--e2)**: E1이 안고 간 결함 3건을 닫는 회차다. 픽스처 세트를 통째로 갈아끼운다
// (live-shape-2026-07-27-e2 / gate-recall-e2 / distractors-e2) — E1 산출물은 발행된 기록이므로
// 바이트 하나도 건드리지 않는다. `--e2`가 없으면 이 파일은 **E1과 완전히 동일하게** 동작한다.
//   node test/gate-recall.mjs --e2 [--perturb none|front|back|all|목록]
// `--perturb`는 **정답 concept의 frontmatter title 앞에만** 접두를 붙인다(파일명·경로·본문 불변).
// E1 §4가 "슬롯을 title 정렬이 정한다"고 진단했으므로, 그 진단의 순수 검정이 된다 — 세 조건의
// 레벨별 recall이 갈리지 않으면(R6) 진단이 반증된다.
//
// **E3(--e3)**: E2가 남긴 것을 닫는 회차다. **조건은 하나도 바꾸지 않는다** — 질문·레벨·섭동·
// distractor·형상 전부 E2에서 승계하고(그래서 byLevel이 E2와 바이트 단위로 재현돼야 한다),
// 늘어나는 것은 **계측**뿐이다.
//   node test/gate-recall.mjs --e3 --perturb all
// 게이트의 생존 조건은 정확히 `rank < taken`이다(rank = 카테고리 내 title 정렬 순위,
// taken = 그 카테고리가 실제로 실은 줄 수). 그래서 recall은 (rank 벡터, taken 벡터)의 **완전한**
// 함수이고, E2가 설명하지 않고 넘긴 "N이 커지는데 recall이 오른다"를 두 성분의 반사실 조합으로
// 정확 분해할 수 있다(근사가 아니다). 분해 모형이 맞는지는 R8이 매 샘플 실측으로 검사한다.
// 방향 판정은 E2의 `|Δ| ≤ 0.05`를 버리고 부호검정 + 분포무관 중앙값 신뢰구간으로 다시 세운다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ensureBootstrap } from '../lib/bootstrap.mjs';
import { regenerateIndex } from '../lib/index-gen.mjs';
import { buildContext, extractLatestLogSection, collectConceptLines } from '../lib/gate.mjs';
import { okfPaths, SCAN_EXCLUDE_DIRS, NON_CONCEPT_BASENAMES } from '../lib/paths.mjs';
import { readConfig } from '../lib/config.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = path.join(PLUGIN_ROOT, 'test', 'fixtures', 'bench', 'gate-recall');

const B =(s) => Buffer.byteLength(s, 'utf8');
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
  const out = { levels: null, seeds: 20, outPath: null, determinismCheck: false, e2: false, e3: false, perturb: null, quoteSafePerturb: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--levels') out.levels = argv[++i].split(',').map((s) => Number(s.trim()));
    else if (a === '--seeds') out.seeds = Number(argv[++i]);
    else if (a === '--out') out.outPath = argv[++i];
    else if (a === '--determinism-check') out.determinismCheck = true;
    else if (a === '--e2') out.e2 = true;
    else if (a === '--e3') out.e3 = true;
    else if (a === '--perturb') out.perturb = argv[++i];
    else if (a === '--quote-safe-perturb') out.quoteSafePerturb = true;
    else throw new Error(`unknown flag: ${a}`);
  }
  if (out.e2 && out.e3) throw new Error('--e2 와 --e3 는 함께 쓸 수 없다 — 어느 회차의 픽스처를 읽을지가 갈린다');
  return out;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// 인자를 **모듈 로드 시점에** 한 번 판독한다 — 어느 픽스처 세트를 읽을지가 여기서 갈리기 때문이다.
// E1 경로(플래그 없음)에서는 아래 세 상수가 E1과 정확히 같은 파일을 가리킨다.
const ARGS = parseArgs(process.argv.slice(2));
// E3는 **형상과 distractor를 E2에서 그대로 승계한다**(파일을 복사하지 않고 같은 파일을 읽는다).
// 조건이 한 바이트라도 다르면 "E2 재현"이 회귀 가드로 성립하지 않는다. 승계 대상 두 파일은
// E2 사전등록 커밋에 이미 들어 있으므로 픽스처 선행성 규율(스모크 §14)도 그대로 만족한다.
const SHAPE_REL = (ARGS.e2 || ARGS.e3)
  ? 'test/fixtures/bench/gate-recall/live-shape-2026-07-27-e2.json'
  : 'test/fixtures/bench/gate-recall/live-shape-2026-07-26.json';
const QUESTIONS_REL = ARGS.e3
  ? 'test/fixtures/bench/gate-recall-e3.json'
  : ARGS.e2
    ? 'test/fixtures/bench/gate-recall-e2.json'
    : 'test/fixtures/bench/gate-recall.json';
const DISTRACTORS_REL = (ARGS.e2 || ARGS.e3) ? 'distractors-e2.json' : 'distractors.json';
const ROUND = ARGS.e3 ? 'E3' : ARGS.e2 ? 'E2' : 'E1';

const SHAPE = readJson(path.join(PLUGIN_ROOT, SHAPE_REL));
const QUESTIONS_FILE = readJson(path.join(PLUGIN_ROOT, QUESTIONS_REL));
const QUESTIONS = QUESTIONS_FILE.questions;
const DISTRACTORS = readJson(path.join(FIXTURE_DIR, DISTRACTORS_REL));

// filler title 유일성 전략은 **픽스처가 정한다**. E1의 distractors.json에는 이 키가 없으므로
// E1 경로는 접미 없이 예전 그대로 돈다(중복이 나는 상태 그대로 — 발행된 기록이다).
const TITLE_SUFFIX_STRATEGY = DISTRACTORS._uniqueness?.strategy ?? null;
const TITLE_SUFFIX_DIGITS = DISTRACTORS._uniqueness?.minIndexDigits ?? 3;

// 섭동 조건. E1 픽스처에는 titlePerturbation이 없다 — 그때는 `none`만 가능하다.
const PERTURBATIONS = QUESTIONS_FILE.titlePerturbation?.conditions ?? [{ id: 'none', prefix: '' }];
function resolvePerturbations(spec) {
  if (spec == null) return [PERTURBATIONS.find((p) => p.id === 'none') ?? PERTURBATIONS[0]];
  const ids = spec === 'all' ? PERTURBATIONS.map((p) => p.id) : spec.split(',').map((s) => s.trim());
  return ids.map((id) => {
    const found = PERTURBATIONS.find((p) => p.id === id);
    if (!found) {
      throw new Error(`unknown perturbation "${id}" — 이 픽스처(${QUESTIONS_REL})가 정의한 조건은 ${PERTURBATIONS.map((p) => p.id).join(',')} 뿐이다`);
    }
    return found;
  });
}

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
//
// 정답 concept의 frontmatter `title` **앞에만** 접두를 붙인다. 파일명·경로·본문은 그대로다 —
// 그래야 "슬롯을 정하는 것이 title 정렬인가"의 순수 검정이 된다. frontmatter 블록(첫 `---`와
// 닫는 `---` 사이)의 **첫 `title:` 줄 하나**만 고치고, 값이 이중인용 스칼라면 인용 **안쪽**에
// 붙인다(밖에 붙이면 YAML이 깨져 title이 파일명 fallback으로 떨어지고, 그러면 이 실험은
// title이 아니라 파싱 실패를 재게 된다). 대상 줄을 못 찾으면 조용히 넘어가지 않고 던진다.
// **2026-07-26 발견: 인용 없는 title에 이 함수가 접두를 그냥 붙이면 frontmatter가 통째로 깨진다.**
// `!!!`는 YAML 태그 지시자라 `title: !!! 제목`이 파싱에 실패하고, index-gen은 그 concept를
// `# undefined` 섹션에 파일명 링크로 싣는다 — **description이 통째로 사라져 줄이 ~700B에서 ~30B로
// 짧아진다.** 즉 그 경우 실험은 "정렬 위치"가 아니라 "파싱 실패로 인한 줄 길이 붕괴"를 잰다.
// 동결 질문 20개 중 **14개가 인용 없는 title**이라 E2·E3의 `front` 조건이 그 상태로 측정됐다.
//
// **등록된 동작은 바꾸지 않는다** — E2·E3의 발행된 수치가 그 동작 위에 있고, 조건을 바꾸면
// 재현 가드가 무너진다. 대신 `--quote-safe-perturb`로 **옵트인** 경로를 둔다: 인용 없는 값을
// 이중인용 스칼라로 감싸 접두를 붙이므로 title 텍스트가 보존되고 YAML이 깨지지 않는다.
// 그 플래그로 돌린 결과는 사후 비교용이며 등록된 결과가 아니다.
function perturbTitle(md, prefix, label, quoteSafe = false) {
  if (!prefix) return md;
  const lines = md.split('\n');
  if (lines[0] !== '---') throw new Error(`no frontmatter to perturb: ${label}`);
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') break;
    if (!lines[i].startsWith('title:')) continue;
    const value = lines[i].slice('title:'.length).replace(/^ /, '');
    if (value.startsWith('"')) {
      lines[i] = `title: "${prefix}${value.slice(1)}`;
    } else if (quoteSafe) {
      lines[i] = `title: ${JSON.stringify(prefix + value)}`;
    } else {
      lines[i] = `title: ${prefix}${value}`;
    }
    return lines.join('\n');
  }
  throw new Error(`no frontmatter title: line to perturb: ${label}`);
}

function buildBundle(root, level, seed, perturb = { id: 'none', prefix: '' }) {
  const home = path.join(root, `L${String(level).padStart(3, '0')}-S${String(seed).padStart(3, '0')}-P${perturb.id}`);
  fs.mkdirSync(home, { recursive: true });
  ensureBootstrap(home);

  const seedConcepts = listConcepts(home);
  const seedCount = seedConcepts.length;
  const planted = new Set(seedConcepts.map((rel) => `/${rel}`));

  for (const q of QUESTIONS) {
    const dest = path.join(home, q.answerConcept);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const src = fs.readFileSync(path.join(PLUGIN_ROOT, q.sourceFile), 'utf8');
    fs.writeFileSync(dest, perturbTitle(src, perturb.prefix, q.id, ARGS.quoteSafePerturb));
    planted.add(`/${q.answerConcept}`);
  }

  const fillerCount = level - QUESTIONS.length - seedCount;
  if (fillerCount < 0) {
    throw new Error(`level ${level} is below the planted floor: ${QUESTIONS.length} questions + ${seedCount} bootstrap seeds`);
  }

  const rand = mulberry32((seed * 0x9e3779b1) >>> 0);
  const cursor = new Map(CATEGORY_WEIGHTS.map((c) => [c.dir, Math.floor(rand() * DISTRACTORS[c.dir].length)]));
  const fillerTitlesByDir = new Map(CATEGORY_WEIGHTS.map((c) => [c.dir, []]));
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
    // **title 중복의 원인은 풀 크기가 아니라 절단이다.** floor(avail/3)로 자르면 서로 다른
    // distractor도 같은 접두만 남아 같아진다(E1: N=200 seed1 patterns 42개 중 distinct 23).
    // 그래서 풀을 늘리는 대신, filler 인덱스 i에서 **결정적으로** 만든 접미를 절단 **뒤에**
    // 붙여 유일성을 구성으로 보장한다. i는 번들 안에서 유일하므로 같은 seed는 같은 번들을 낳는다.
    const suffix = TITLE_SUFFIX_STRATEGY === 'index-suffix' ? ` #f${String(i).padStart(TITLE_SUFFIX_DIGITS, '0')}` : '';
    const cap = Math.floor(avail / 3);
    const titleBytes = Math.max(4, Math.min(B(sanitize(src.title)), cap - B(suffix)));
    const title = fitBytes(sanitize(src.title), titleBytes) + suffix;
    fillerTitlesByDir.get(dir).push(title);
    const description = fitBytes(sanitize(src.description), Math.max(1, avail - B(title)));
    const abs = path.join(home, dir, name);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    // YAML 이중 인용 스칼라로 쓴다 — 원문에 `:`가 들어가도 파싱이 깨지지 않는다.
    fs.writeFileSync(abs, `---\ntype: ${TYPE_OF[dir]}\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\ntimestamp: 2026-07-15\n---\n본문\n`);
    planted.add(link);
  }

  fs.writeFileSync(path.join(home, 'log.md'), SHAPE.logMd);
  regenerateIndex(home);
  return { home, seedCount, fillerCount, planted, fillerTitleStats: titleStats(fillerTitlesByDir) };
}

// filler title 유일성 **실측**. 선언이 아니라 이 번들에 실제로 쓰인 title들을 센다 —
// index-gen이 섹션 안에서 정렬하는 키가 바로 이 값이므로, 중복은 두 슬롯을 같은 title 두 벌이
// 먹는 현상(E1 §6-b 3번)으로 직결된다. 어느 카테고리든 maxDuplicate > 1이면 R7이 발화한다.
function titleStats(byDir) {
  const out = {};
  for (const [dir, titles] of byDir) {
    const counts = new Map();
    for (const t of titles) counts.set(t, (counts.get(t) ?? 0) + 1);
    out[dir] = {
      fillerTitleCount: titles.length,
      fillerTitleDistinct: counts.size,
      maxDuplicate: counts.size ? Math.max(...counts.values()) : 0,
    };
  }
  return out;
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

  // 예산 동형 검사.
  //
  // **`stats.budgetBytes + stats.headingBytes === SHAPE.indexBudgetBytes`를 검사하면 안 된다.**
  // 바로 위에서 injectMaxBytes를 `indexBudget + 실측head + 실측tail`로 역산했으므로 그 등식은
  // 항진명제다 — throw를 지워도, 게이트 head에 규칙을 한 줄 더 실어 **라이브 예산이 실제로
  // 줄어들어도** 통과한다(하니스가 cap을 같이 늘려버리니까). 잡아야 하는 것은 그게 아니라
  // **라이브 예산이 움직였는가**다.
  //
  // head는 `전역 지식 번들: ${okfHome}`로 경로를 그대로 싣는다 — 즉 head = 상수 + 경로바이트다.
  // 그래서 샌드박스 head에서 경로 길이 차이만 빼면 라이브 head가 정확히 복원된다. 이 복원값이
  // 동결값과 다르면 head 리터럴이 바뀐 것이고, cap 9000B는 그대로이므로 index에 남는 예산도
  // 그만큼 바뀌었다는 뜻이다(픽스처 note 참조).
  const impliedFrozenHeadBytes = probe.headBytes - B(home) + SHAPE.frozenHomePathBytes;
  if (impliedFrozenHeadBytes !== SHAPE.frozenHeadBytes || probe.headLines !== SHAPE.frozenHeadLines) {
    throw new Error(`shape drift: head implies live ${impliedFrozenHeadBytes}B/${probe.headLines}L vs frozen ${SHAPE.frozenHeadBytes}B/${SHAPE.frozenHeadLines}L (sandbox head ${probe.headBytes}B, home ${B(home)}B, frozen home ${SHAPE.frozenHomePathBytes}B)`);
  }
  // 픽스처 내부 정합. 동결된 index 예산은 라이브 cap에서 head/tail을 뺀 값이어야 한다 —
  // 셋 중 하나만 손대면 하니스가 라이브와 다른 예산에서 재게 된다(G3-0b).
  const fixtureIndexBudgetBytes = SHAPE.config.inject_max_bytes - SHAPE.frozenHeadBytes - SHAPE.tailBytes;
  const fixtureIndexBudgetLines = SHAPE.config.inject_max_lines - SHAPE.frozenHeadLines - SHAPE.tailLines;
  if (SHAPE.indexBudgetBytes !== fixtureIndexBudgetBytes || SHAPE.indexBudgetLines !== fixtureIndexBudgetLines) {
    throw new Error(`shape drift: fixture index budget ${SHAPE.indexBudgetBytes}B/${SHAPE.indexBudgetLines}L but cap−head−tail gives ${fixtureIndexBudgetBytes}B/${fixtureIndexBudgetLines}L`);
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
    assembledBytes: stats.assembledBytes - probe.headBytes + SHAPE.frozenHeadBytes,
    finalBytes: stats.finalBytes - probe.headBytes + SHAPE.frozenHeadBytes,
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
// 유료 0 증명. **하니스 프로세스 자신의** PATH 맨 앞에 스텁을 깐다 — 훅 서브프로세스만
// 덮으면 하니스 본체(또는 훅이 아닌 다른 spawn)가 CLI를 부를 때 실제 PATH로 새 나간다.
// process.env.PATH를 덮으면 이후의 모든 자식이 그걸 상속하므로 경로가 하나로 모인다.
// 어떤 경로로든 CLI가 실행되면 TRIPPED 파일이 남는다.
// `meta.paidCalls: 0` 같은 상수 선언은 증거가 아니다 — 그리고 **스텁이 없으면 "발동 안 함"도
// 증거가 아니다**. 그래서 스텁 경로를 함께 돌려주고 산출 JSON에 존재 여부를 실측해 남긴다.
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
  return { trapDir, tripped, stub };
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
function crossCheckWithHook(home, harnessSurvivors, latestLog) {
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
      // PATH는 따로 덮지 않는다 — plantPathTrap이 하니스 프로세스의 PATH를 이미 트랩 우선으로
      // 바꿔놨고 여기서 그걸 상속한다. 여기서만 덮으면 하니스 본체가 트랩 밖에 남는다.
      env: {
        ...process.env,
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

// ---------------------------------------------------------------------------
// E3 계측 — recall을 (rank, taken) 두 성분으로 **정확 분해**하기 위한 관측.
//
// buildInjectedIndex는 카테고리마다 `collectConceptLines(home, dir)`의 **앞에서부터** taken개를
// 싣는다. 그러므로 정답 concept의 생존 조건은 정확히 `rank < taken`이다 — 근사가 아니라 항등이다.
// 이 항등이 실제로 성립하는지는 R8이 매 샘플에서 실측 생존과 대조해 검사한다(어긋나면 분해
// 분석 전체가 무효다).
//
// **readCategoryLines가 아니라 collectConceptLines를 쓴다.** 전자는 하위 디렉토리를 펼치지 않아
// `decisions/partner-settlement/emitter-wiring.md` 같은 중첩 concept의 rank를 통째로 놓친다
// (동결 질문 20개 중 다수가 중첩이다).
const QUESTION_DIRS = QUESTIONS.map((q) => q.answerConcept.split('/')[0]);
const LINK_OF_LINE = (l) => LINK_RE.exec(l)?.[1] ?? null;

// ---------------------------------------------------------------------------
// **비순환 순서 검사.** R8 하나만으로는 "rank가 title 정렬 순위다"를 검증할 수 없다 —
// measureSlots가 buildInjectedIndex와 **같은 collectConceptLines**를 부르므로
// `A.indexOf(x) < k ⟺ A.slice(0,k).includes(x)`는 중복 없는 배열에서 정의상 참이고,
// 그 함수가 어떤 순서를 내든 R8은 통과한다(독립 검증이 실제로 이 결함을 실행으로 보였다:
// collectConceptLines를 줄 길이 내림차순으로 바꿔도 R8은 불일치 0을 보고했다).
//
// 그래서 순서의 **의미**는 다른 출처에서 확인한다: index.md 줄이 아니라 **concept 파일의
// frontmatter를 직접 읽어** title/type/status를 얻고, 관측된 순서가 index-gen이 문서화한 규칙
// (같은 섹션 안에서 은퇴는 뒤로, 나머지는 `title.toLowerCase()` 오름차순)을 지키는지 본다.
//
// **비교 단위는 "같은 디렉토리 × 같은 type × 같은 은퇴 상태"다.** 이보다 넓게 잡으면 안 된다 —
// collectConceptLines가 하위 디렉토리를 **그 자리에 펼치므로** 서로 다른 index.md가 렌더한 같은
// type 항목이 인접하게 되고, 그 둘 사이에는 title 순서가 성립할 이유가 없다. 실제로 처음에
// (type, 은퇴)만으로 묶었더니 **변이 없는 기준선에서 전 샘플이 발화**했다(거짓 양성).
// 한 index.md 안에서는 같은 type 항목이 연속이고 title 오름차순이라는 것이 index-gen의 규범이다.
//
// **이 검사가 고정하지 않는 것**: 섹션 경계(어느 type 섹션이 먼저인지)와 하위 디렉토리가 펼쳐지는
// 위치. 그래도 정렬 키를 title이 아닌 것으로 바꾸는 변이는 디렉토리 안 순서를 함께 흐트러뜨리므로
// 여기서 잡힌다(아래 M2 변이 실측).
function readFrontmatter(abs) {
  let md;
  try { md = fs.readFileSync(abs, 'utf8'); } catch { return null; }
  const end = md.indexOf('\n---', 3);
  const fm = md.startsWith('---') && end > 0 ? md.slice(4, end) : '';
  const field = (k) => {
    const m = new RegExp(`^${k}:[ \\t]*(.*)$`, 'm').exec(fm);
    if (!m) return null;
    const raw = m[1].trim();
    // 이중 인용 스칼라는 JSON.parse로 푼다(filler는 JSON.stringify로 쓴다).
    if (raw.startsWith('"')) { try { return JSON.parse(raw); } catch { return raw; } }
    return raw;
  };
  return { title: field('title'), type: field('type'), status: field('status') };
}

function verifyTitleOrdering(home, stats) {
  const violations = [];
  for (const c of stats.cats ?? []) {
    const links = collectConceptLines(home, c.dir).map(LINK_OF_LINE);
    // 관측 순서를 (디렉토리, type, 은퇴)로 묶는다. 각 묶음 안에서 title이 오름차순이어야 한다.
    const groups = new Map();
    links.forEach((rel, i) => {
      if (!rel) return;
      const fm = readFrontmatter(path.join(home, rel.slice(1)));
      if (!fm || fm.title == null) return;
      const key = `${rel.slice(0, rel.lastIndexOf('/'))} ${fm.type} ${fm.status === 'deprecated'}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ i, title: fm.title.toLowerCase(), type: fm.type });
    });
    for (const [key, items] of groups) {
      for (let k = 1; k < items.length; k++) {
        if (items[k].title < items[k - 1].title) {
          violations.push({ dir: c.dir, group: key.split(' ')[0], at: items[k].i, type: items[k].type });
        }
      }
    }
  }
  return violations;
}

function measureSlots(home, stats, survivors) {
  const takenByDir = {};
  const totalByDir = {};
  for (const c of stats.cats ?? []) { takenByDir[c.dir] = c.taken; totalByDir[c.dir] = c.total; }
  const cache = new Map();
  const ranks = [];
  const modelMismatches = [];
  QUESTIONS.forEach((q, i) => {
    const dir = QUESTION_DIRS[i];
    if (!cache.has(dir)) cache.set(dir, collectConceptLines(home, dir).map(LINK_OF_LINE));
    const rank = cache.get(dir).indexOf(`/${q.answerConcept}`);
    ranks.push(rank);
    const predicted = rank >= 0 && rank < (takenByDir[dir] ?? 0);
    if (predicted !== survivors.has(`/${q.answerConcept}`)) {
      modelMismatches.push({ id: q.id, dir, rank, taken: takenByDir[dir] ?? 0, predicted, observed: survivors.has(`/${q.answerConcept}`) });
    }
  });
  // 실린 줄들의 평균 바이트.
  //
  // **이 값으로 인과를 말하면 안 된다.** 예산이 고정이므로 `taken × 평균 ≈ 예산`은 **항등식**이고,
  // 실제로 E3 15개 셀 전부에서 곱이 6,205~6,375B에 갇혀 있다(index 예산 6,967B). 즉 "줄이 짧아져서
  // taken이 늘었다"와 "taken이 늘어서 평균이 짧아졌다"를 이 값은 구별하지 못한다 — 같은 나눗셈이다.
  // 진단용으로만 기록한다.
  const allTakenLineBytes = (stats.cats ?? []).flatMap((c) => c.lineBytes);
  return {
    ranks, takenByDir, totalByDir, modelMismatches,
    rankMissing: ranks.filter((r) => r < 0).length,
    takenLineBytesMean: allTakenLineBytes.length ? allTakenLineBytes.reduce((s, x) => s + x, 0) / allTakenLineBytes.length : null,
    titleOrderViolations: verifyTitleOrdering(home, stats),
  };
}

// 반사실 recall. 어느 rank 벡터와 어느 taken 벡터를 짝지어도 계산된다 — 그래서 성분 분해가 된다.
function recallFrom(ranks, takenByDir) {
  let hit = 0;
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] >= 0 && ranks[i] < (takenByDir[QUESTION_DIRS[i]] ?? 0)) hit += 1;
  }
  return hit / ranks.length;
}

// ---------------------------------------------------------------------------
// 부호검정과 분포무관 중앙값 신뢰구간. 외부 의존 0(CI에 npm install이 없다).
//
// **왜 이걸로 바꾸는가**: E2의 P3는 "|평균Δ| ≤ 0.05면 평탄"이었는데, 그 정의는 20개 시드 전부에서
// 같은 방향으로 0.0125씩 움직이는 것(= 명백한 상승)과 방향 없이 흔들리는 것(= 진짜 평탄)을
// 구별하지 못한다. 방향은 **부호의 일관성**이 정하고, 크기는 **구간추정**이 정한다. 두 질문을
// 한 임계에 욱여넣은 것이 E2 결함의 정체다.
function choose(n, k) {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}
// P(X <= k), X ~ Bin(n, 0.5). n=20이면 2^20이라 배정도에서 정확하다.
function binomCdfHalf(k, n) {
  if (k < 0) return 0;
  if (k >= n) return 1;
  let s = 0;
  for (let i = 0; i <= k; i++) s += choose(n, i);
  return s / 2 ** n;
}

// **측정 격자에 맞춘 양자화.** recall은 항상 `맞은문항수 / QUESTIONS.length`이므로 두 recall의
// 차이는 1/N의 **정확한 배수**다. 그런데 배정도에서 `0.25 - 0.20 = 0.04999999999999999`이고
// `0.20 - 0.15 = 0.05000000000000002`다 — 같은 크기(문항 1개 이동)가 표현 오차만으로 등가한계
// 0.05의 반대편에 떨어진다. 실제로 이 하니스에서 200→400의 `none`과 `back`이 **동일한 CI인데
// 판정이 갈렸다**(flat vs indeterminate). 임계를 느슨하게 하는 것이 아니라, 측정이 애초에
// 이산이라는 사실을 산술에 반영하는 것이다.
const RECALL_QUANTUM = 1 / QUESTIONS.length;
function quantize(d) { return Math.round(d / RECALL_QUANTUM) * RECALL_QUANTUM; }

function signTest(deltas) {
  const nPlus = deltas.filter((d) => d > 0).length;
  const nMinus = deltas.filter((d) => d < 0).length;
  const m = nPlus + nMinus;
  // 양측 정확검정. 동점(Δ=0)은 관례대로 제외한다 — 방향에 대한 정보가 없기 때문이다.
  const p = m === 0 ? 1 : Math.min(1, 2 * binomCdfHalf(Math.min(nPlus, nMinus), m));
  return { nPlus, nMinus, nTies: deltas.length - m, p };
}

// 부호검정을 뒤집어 얻는 중앙값 신뢰구간. 순서통계량 [d_(k), d_(n+1-k)]이고, k는
// P(X <= k-1) <= alpha/2 를 만족하는 최대값이다. 정규근사도 t분포표도 필요 없다.
function medianCI(deltas, alpha) {
  const n = deltas.length;
  const s = [...deltas].sort((a, b) => a - b);
  let k = 0;
  for (let cand = 1; cand <= Math.floor(n / 2); cand++) {
    if (binomCdfHalf(cand - 1, n) <= alpha / 2) k = cand; else break;
  }
  if (k === 0) return { low: s[0], high: s[n - 1], coverage: null, orderStat: null, exact: false };
  return { low: s[k - 1], high: s[n - k], coverage: 1 - 2 * binomCdfHalf(k - 1, n), orderStat: k, exact: true };
}

// 방향과 크기를 **두 값으로 나눠** 낸다. 네 방향 판정은 상호배타적이고 전수적이다.
// legacy 필드는 E2의 옛 기준을 같은 데이터에 그대로 적용한 결과다 — 새 기준이 무엇을 바꾸는지
// 리포트가 주장이 아니라 나란한 두 값으로 보이게 하려고 남긴다.
function trendVerdict(deltas, eq, alpha) {
  const st = signTest(deltas);
  const ci = medianCI(deltas, alpha);
  const m = mean(deltas);
  let direction;
  if (st.p < alpha && st.nPlus > st.nMinus) direction = 'rising';
  else if (st.p < alpha && st.nMinus > st.nPlus) direction = 'falling';
  else if (ci.low >= -eq && ci.high <= eq) direction = 'flat';
  else direction = 'indeterminate';
  return {
    ...st,
    meanDelta: m,
    medianCI: ci,
    direction,
    // 방향과 별개의 질문: 그 움직임이 등가한계를 **완전히** 벗어나는가.
    substantive: ci.low > eq || ci.high < -eq,
    legacyP3: {
      rule: '|meanDelta| <= equivalenceBound → flat (E2 §3이 결함으로 기록한 기준)',
      verdict: Math.abs(m) <= eq ? 'flat' : 'not-flat',
    },
  };
}

function runSample(root, level, seed, perturb = { id: 'none', prefix: '' }) {
  const built = buildBundle(root, level, seed, perturb);
  const { text, stats, probe, latestLog, injectMaxBytes, injectMaxLines } = measure(built.home);
  const survivors = extractSurvivors(text, LINK_RE);
  const planSurvivors = extractSurvivors(text, PLAN_LINK_RE);
  const hit = QUESTIONS.filter((q) => survivors.has(`/${q.answerConcept}`)).map((q) => q.id);
  const maxFillerTitleDuplicate = Math.max(0, ...Object.values(built.fillerTitleStats).map((s) => s.maxDuplicate));
  // **번들을 지우기 전에** 잰다 — runSample의 소비자가 측정 직후 home을 rmSync한다.
  const slots = measureSlots(built.home, stats, survivors);
  return {
    home: built.home,
    planted: built.planted,
    survivors,
    text,
    latestLog,
    sample: {
      level,
      seed,
      perturb: perturb.id,
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
      fillerTitleStats: built.fillerTitleStats,
      maxFillerTitleDuplicate,
      // E3 계측. 배열 순서는 QUESTIONS 순서다(질문 dir은 픽스처에서 유도되므로 중복 저장하지 않는다).
      slots,
    },
  };
}

function determinismCheck(root, perturb) {
  // E2는 filler가 실제로 깔리는 레벨에서 잰다. 레벨 24는 정답 20 + 시드 4라 filler가 0개이고,
  // 그러면 이번 회차가 새로 넣은 filler title 접미 로직이 검사 대상에서 통째로 빠진다.
  // E1 경로의 (24, 7)은 발행된 값이므로 그대로 둔다.
  const LEVEL = ARGS.e2 ? 100 : 24, SEED = 7, RUNS = 10;
  const digests = [];
  const survivorSigs = [];
  for (let i = 0; i < RUNS; i++) {
    const r = runSample(root, LEVEL, SEED, perturb);
    digests.push(crypto.createHash('sha256').update(indexSection(r.text)).digest('hex'));
    survivorSigs.push(JSON.stringify([...r.survivors].sort()));
    fs.rmSync(r.home, { recursive: true, force: true });
  }
  const identical = digests.every((d) => d === digests[0]);
  const survivorsIdentical = survivorSigs.every((s) => s === survivorSigs[0]);
  return {
    level: LEVEL, seed: SEED, perturb: perturb.id, runs: RUNS,
    identicalDigests: `${digests.filter((d) => d === digests[0]).length}/${RUNS}`,
    identicalSurvivorSets: `${survivorSigs.filter((s) => s === survivorSigs[0]).length}/${RUNS}`,
    digest: digests[0],
    pass: identical && survivorsIdentical,
  };
}

// ---------------------------------------------------------------------------
function main() {
  const args = ARGS;
  const levels = args.levels ?? QUESTIONS_FILE.levels;
  const perturbations = resolvePerturbations(args.perturb);
  const startedAt = new Date();

  // 루트 tmp는 **한 번만** 만든다. 접두 `okf-bench-`는 필수 — lib/paths.mjs의
  // OKF_TEST_FIXTURE가 `bench`를 이미 sweep 제외로 잡는다(임시 경로 AND 픽스처명).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-bench-recall-'));
  const trap = plantPathTrap(root);

  try {
    if (args.determinismCheck) {
      const result = determinismCheck(root, perturbations[0]);
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.pass ? 0 : 1;
      return;
    }

    const calibration = calibrate(root);
    const samples = [];
    const crossChecks = [];

    for (const perturb of perturbations) {
      for (const level of levels) {
        for (let seed = 1; seed <= args.seeds; seed++) {
          const r = runSample(root, level, seed, perturb);
          if (seed === 1) {
            crossChecks.push({ level, seed, perturb: perturb.id, ...crossCheckWithHook(r.home, r.survivors, r.latestLog) });
          }
          samples.push(r.sample);
          // **측정 직후 삭제.** 스모크의 sandbox 미정리 관례에 대한 의도적 예외다 —
          // 200 concept × 20 시드 × 4 레벨이면 홈 80개에 concept 파일 ~9,000개와 그만큼의
          // git 오브젝트가 tmpdir에 남는다. 재현은 (level, seed)로 언제든 다시 조립된다.
          fs.rmSync(r.home, { recursive: true, force: true });
        }
      }
    }

    // 집계 단위는 (섭동 조건, 레벨)이다. 조건이 하나뿐이면(=E1 경로) 배열의 길이·순서·값이
    // E1과 같고 `perturb: "none"` 필드만 늘어난다.
    const cwdIds = new Set(QUESTIONS.filter((q) => q.cwdIndependent).map((q) => q.id));
    const byLevel = [];
    for (const perturb of perturbations) {
      for (const level of levels) {
        const rows = samples.filter((s) => s.perturb === perturb.id && s.level === level);
        const rs = rows.map((s) => s.recall);
        const cwdRs = rows.map((s) => s.hitIds.filter((id) => cwdIds.has(id)).length / cwdIds.size);
        // E3 해석용 중간변수. recall = f(rank, taken)이므로 이 둘의 레벨별 이동이 곧 설명이다.
        const answerRanks = rows.flatMap((s) => s.slots.ranks.filter((r) => r >= 0));
        byLevel.push({
          perturb: perturb.id,
          level,
          n: rs.length,
          recallMean: mean(rs),
          recallStdev: stdev(rs),
          recallMin: Math.min(...rs),
          recallMax: Math.max(...rs),
          cwdIndependentRecallMean: mean(cwdRs),
          cwdIndependentRecallStdev: stdev(cwdRs),
          cwdIndependentN: cwdIds.size,
          gateTakenMean: mean(rows.map((s) => s.taken)),
          gateTotalMean: mean(rows.map((s) => s.total)),
          takenLineBytesMean: mean(rows.map((s) => s.slots.takenLineBytesMean)),
          // 카테고리가 통째로 소진되면 생략 마커 비용이 환급된다(lib/gate.mjs:127-129).
          // N=24처럼 후보가 적을 때 taken이 커지는 이유를 이 값이 직접 보인다.
          fullyExhaustedCategoriesMean: mean(rows.map((s) => Object.keys(s.slots.takenByDir).filter((d) => s.slots.takenByDir[d] === s.slots.totalByDir[d]).length)),
          answerRankMean: answerRanks.length ? mean(answerRanks) : null,
        });
      }
    }

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

    // R1·R2·R4는 **첫 조건**(기본 none)에서 판정한다 — E1이 그 조건에서 발행한 임계이기 때문이다.
    const primary = byLevel.filter((b) => b.perturb === perturbations[0].id);
    const at = (level) => primary.find((b) => b.level === level)?.recallMean ?? null;
    // 단조성은 **조건 안에서** 본다. 조건 경계를 넘어 비교하면 섭동 차이가 레벨 차이로 둔갑한다.
    const monotonicViolations = [];
    for (const perturb of perturbations) {
      const seq = byLevel.filter((b) => b.perturb === perturb.id);
      for (let i = 1; i < seq.length; i++) {
        if (seq[i].recallMean > seq[i - 1].recallMean) {
          monotonicViolations.push({
            perturb: perturb.id,
            from: seq[i - 1].level, to: seq[i].level,
            means: [seq[i - 1].recallMean, seq[i].recallMean],
            delta: seq[i].recallMean - seq[i - 1].recallMean,
            stdevAtTo: seq[i].recallStdev,
          });
        }
      }
    }
    const worstStdev = primary.reduce((a, b) => (b.recallStdev > a.recallStdev ? b : a), primary[0]);

    // R6 — title 섭동 민감도. E1 §4의 진단("슬롯을 title 정렬이 정한다")의 순수 검정이다.
    // 같은 레벨에서 섭동 3조건의 recall이 **모든 레벨에서** 0.05 미만으로만 갈리면 그 진단은
    // 반증된다. 조건이 하나뿐인 실행은 이 값을 계산할 수 없으므로 fired를 null로 남긴다 —
    // false(=반증 안 됨)로 적으면 재지 않은 것을 잰 것처럼 보이게 된다.
    const R6_THRESHOLD = 0.05;
    const spreads = levels.map((level) => {
      const ms = byLevel.filter((b) => b.level === level).map((b) => b.recallMean);
      return { level, recallByPerturb: Object.fromEntries(byLevel.filter((b) => b.level === level).map((b) => [b.perturb, b.recallMean])), spread: Math.max(...ms) - Math.min(...ms) };
    });
    const r6Computable = perturbations.length >= 2;

    // R7 — filler title 중복. 어느 샘플의 어느 카테고리에서든 maxDuplicate > 1이면 발화한다.
    const dupSamples = samples.filter((s) => s.maxFillerTitleDuplicate > 1);
    const worstDup = dupSamples.reduce((a, s) => (a === null || s.maxFillerTitleDuplicate > a.maxFillerTitleDuplicate ? s : a), null);

    // -----------------------------------------------------------------------
    // E3 — 추세 판정 + (rank, taken) 정확 분해.
    //
    // 임계는 **픽스처가 정한다**(사전등록 커밋에 데이터로 박혀 있다). E1/E2 픽스처에는 이 블록이
    // 없으므로 그 경로에서는 analysis가 통째로 null이 되고 R3a/R3b/R8/R9는 계산하지 않는다 —
    // 재지 않은 것을 false로 적으면 잰 것처럼 보인다.
    const ANALYSIS = QUESTIONS_FILE.analysis ?? null;
    const byKey = new Map(samples.map((s) => [`${s.perturb}|${s.level}|${s.seed}`, s]));
    const adjacentPairs = levels.slice(1).map((lv, i) => [levels[i], lv]);

    let trends = null;
    let decomposition = null;
    let modelCheck = null;
    let integrity = null;
    if (ANALYSIS) {
      const EQ = ANALYSIS.equivalenceBound;
      const ALPHA = ANALYSIS.signTestAlpha;
      trends = [];
      decomposition = [];
      for (const perturb of perturbations) {
        for (const [n1, n2] of adjacentPairs) {
          const deltas = [];
          const rankEffects = [];
          const takenEffects = [];
          const interactions = [];
          for (let seed = 1; seed <= args.seeds; seed++) {
            const s1 = byKey.get(`${perturb.id}|${n1}|${seed}`);
            const s2 = byKey.get(`${perturb.id}|${n2}|${seed}`);
            if (!s1 || !s2) continue;
            deltas.push(quantize(s2.recall - s1.recall));
            // 반사실 두 개. recall이 (rank, taken)의 완전한 함수라서 이 분해에 잔차가 없다 —
            // 남는 것은 상호작용항뿐이고 그것도 항등식으로 정확히 떨어진다.
            const a1 = recallFrom(s1.slots.ranks, s1.slots.takenByDir);
            const a2 = recallFrom(s2.slots.ranks, s2.slots.takenByDir);
            const rankOnly = recallFrom(s2.slots.ranks, s1.slots.takenByDir);
            const takenOnly = recallFrom(s1.slots.ranks, s2.slots.takenByDir);
            // 반사실 recall도 같은 격자 위의 값이므로 같은 양자화를 건다.
            const re = quantize(rankOnly - a1);
            const te = quantize(takenOnly - a1);
            rankEffects.push(re);
            takenEffects.push(te);
            interactions.push(quantize(quantize(a2 - a1) - re - te));
          }
          trends.push({ perturb: perturb.id, from: n1, to: n2, n: deltas.length, ...trendVerdict(deltas, EQ, ALPHA) });
          decomposition.push({
            perturb: perturb.id, from: n1, to: n2, n: rankEffects.length,
            observedDelta: mean(deltas),
            rankEffect: mean(rankEffects),
            takenEffect: mean(takenEffects),
            interaction: mean(interactions),
            // 항등식 검증: 세 성분의 합이 관측 Δ와 같아야 한다. 어긋나면 분해 코드가 틀린 것이다.
            residual: mean(deltas) - (mean(rankEffects) + mean(takenEffects) + mean(interactions)),
          });
        }
      }

      // R8 — 분해 모형(`rank < taken`)이 실제 생존과 일치하는가. 매 샘플 × 20문항 실측이다.
      const mismatchSamples = samples.filter((s) => s.slots.modelMismatches.length > 0);
      const recallMismatch = samples.filter((s) => Math.abs(recallFrom(s.slots.ranks, s.slots.takenByDir) - s.recall) > 1e-12);
      const residualMax = Math.max(0, ...decomposition.map((d) => Math.abs(d.residual)));
      const orderViolationSamples = samples.filter((s) => s.slots.titleOrderViolations.length > 0);
      modelCheck = {
        samplesWithMismatch: mismatchSamples.length,
        totalSamples: samples.length,
        totalQuestionChecks: samples.length * QUESTIONS.length,
        mismatchExamples: mismatchSamples.slice(0, 5).map((s) => ({ level: s.level, seed: s.seed, perturb: s.perturb, mismatches: s.slots.modelMismatches })),
        recallReconstructionMismatches: recallMismatch.length,
        // **비순환 절.** 위 두 값은 measureSlots와 buildInjectedIndex가 같은 함수를 쓰므로
        // 산술 자기일관성만 본다. 이 값은 concept 파일 frontmatter를 직접 읽어 순서의 **의미**를
        // 확인한다 — 정렬 키를 title 아닌 것으로 바꾸는 변이는 여기서만 잡힌다.
        samplesWithTitleOrderViolation: orderViolationSamples.length,
        titleOrderViolationExamples: orderViolationSamples.slice(0, 3).map((s) => ({ level: s.level, seed: s.seed, perturb: s.perturb, violations: s.slots.titleOrderViolations.slice(0, 5) })),
        // **이 값은 R8의 발화 조건이 아니다.** interaction을 잔차로 **정의**하므로
        // (`interaction = Δ − rankEffect − takenEffect`) 이 값은 구조적으로 0이고, 랭크·taken을
        // 난수로 갈아치워도 0으로 남는다(독립 검증이 실행으로 확인). 진단용으로만 기록한다.
        decompositionResidualMax: residualMax,
        decompositionResidualIsStructural: true,
      };

      // R3a — 원래 R3이 잡으려던 것("하니스 결함") 자체를 직접 검사한다. 단조 감소는 하니스
      // 결함의 지표가 아니었다(E1·E2 연속 발화가 그 증거다) — 무결성은 무결성으로 잰다.
      const unplanted = samples.filter((s) => !s.survivorsAllPlanted);
      const rankMissing = samples.filter((s) => s.slots.rankMissing > 0);
      const wrongComposition = samples.filter((s) => QUESTIONS.length + s.seedCount + s.fillerCount !== s.level);
      const totalRegressions = [];
      for (const perturb of perturbations) {
        const seq = byLevel.filter((b) => b.perturb === perturb.id);
        for (let i = 1; i < seq.length; i++) {
          if (seq[i].gateTotalMean < seq[i - 1].gateTotalMean) {
            totalRegressions.push({ perturb: perturb.id, from: seq[i - 1].level, to: seq[i].level, means: [seq[i - 1].gateTotalMean, seq[i].gateTotalMean] });
          }
        }
      }
      integrity = {
        samplesWithUnplantedSurvivor: unplanted.length,
        samplesWithMissingAnswerRank: rankMissing.length,
        samplesWithWrongComposition: wrongComposition.length,
        indexCandidateCountRegressions: totalRegressions,
      };
    }

    const risingPairs = (trends ?? []).filter((t) => t.direction === 'rising');
    const risingWithoutTakenEffect = risingPairs
      .map((t) => ({ t, d: decomposition.find((x) => x.perturb === t.perturb && x.from === t.from && x.to === t.to) }))
      .filter(({ d }) => d && d.takenEffect <= 0)
      .map(({ t, d }) => ({ perturb: t.perturb, from: t.from, to: t.to, takenEffect: d.takenEffect, rankEffect: d.rankEffect }));

    const refutation = {
      R1: { fired: at(50) !== null && at(50) >= 0.90, basis: { 'recall(50)': at(50), threshold: 0.90 }, meaning: '라우팅은 병목이 아니다 → I2를 v0.3에서도 착수하지 않는다' },
      R2: { fired: at(24) !== null && at(24) < 0.60, basis: { 'recall(24)': at(24), threshold: 0.60 }, meaning: '실사용 규모에서 이미 실패 중' },
      R3: { fired: monotonicViolations.length > 0, basis: { violations: monotonicViolations }, meaning: '단조 감소 위반 → 하니스 결함, 전 결과 폐기' },
      R4: {
        fired: worstStdev ? worstStdev.recallStdev > 0.25 : false,
        retired: true,
        basis: {
          worstLevel: worstStdev?.level ?? null,
          stdev: worstStdev?.recallStdev ?? null,
          threshold: 0.25,
          retiredBecause: '시드 분산은 정답 title rank가 시드마다 고정이라 이 실패 모드를 탐지할 수 없다 — R6이 대체한다',
        },
        meaning: 'filler 명명에 지배됨, 정책 결론 금지 (은퇴 — 판정을 정책 근거로 쓰지 않는다)',
      },
      R5: { fired: calibration.mismatches.length > 0, basis: { mismatches: calibration.mismatches }, meaning: '캘리브레이션 불일치 → 전 결과 무효' },
      R6: {
        fired: r6Computable ? spreads.every((s) => s.spread < R6_THRESHOLD) : null,
        computable: r6Computable,
        basis: {
          conditions: perturbations.map((p) => p.id),
          threshold: R6_THRESHOLD,
          spreadByLevel: spreads,
          ...(r6Computable ? {} : { notComputableBecause: `섭동 조건이 ${perturbations.length}개뿐이다 — R6은 같은 레벨에서 3조건을 비교한다(--perturb all)` }),
        },
        meaning: '모든 레벨에서 섭동 간 recall 차이가 0.05 미만 → E1 §4의 "슬롯을 title 정렬이 정한다"가 반증된다',
      },
      R7: {
        fired: dupSamples.length > 0,
        basis: {
          samplesWithDuplicate: dupSamples.length,
          totalSamples: samples.length,
          worst: worstDup ? { level: worstDup.level, seed: worstDup.seed, perturb: worstDup.perturb, maxDuplicate: worstDup.maxFillerTitleDuplicate, fillerTitleStats: worstDup.fillerTitleStats } : null,
        },
        meaning: 'filler title이 중복 생성됐다 — 중복은 정렬상 인접해 한 카테고리의 두 슬롯을 같은 title 두 벌이 먹는다(실번들에 없는 인공물)',
      },
      // --- E3 신규. E1/E2 픽스처에는 analysis 블록이 없으므로 그 경로에서는 전부 null이다. ---
      R3a: {
        fired: integrity
          ? integrity.samplesWithUnplantedSurvivor > 0 || integrity.samplesWithMissingAnswerRank > 0
            || integrity.samplesWithWrongComposition > 0 || integrity.indexCandidateCountRegressions.length > 0
          : null,
        computable: integrity !== null,
        basis: integrity ?? { notComputableBecause: '이 픽스처에는 analysis 블록이 없다(E1·E2 경로)' },
        meaning: '하니스 무결성 위반 — 심지 않은 concept가 생존하거나, 정답이 카테고리 목록에서 사라지거나, 레벨 구성이 어긋나거나, 후보 concept 수가 레벨과 함께 줄었다. 이것이 옛 R3이 잡으려던 것이다',
      },
      R3b: {
        fired: trends ? risingPairs.some((t) => t.substantive) : null,
        computable: trends !== null,
        basis: {
          rule: '인접 레벨 쌍의 방향이 rising이고 동시에 substantive(중앙값 CI가 등가한계 밖에 완전히 놓임)일 때만 발화',
          equivalenceBound: ANALYSIS?.equivalenceBound ?? null,
          risingPairs: risingPairs.map((t) => ({ perturb: t.perturb, from: t.from, to: t.to, meanDelta: t.meanDelta, medianCI: t.medianCI, substantive: t.substantive })),
        },
        meaning: '설명 불가능한 크기의 상승 — N을 늘렸는데 recall이 등가한계를 넘어 오르면 그건 게이트의 성질이 아니라 하니스 결함이다',
      },
      R8: {
        // 잔차 절을 뺐다 — interaction을 잔차로 정의하므로 구조적으로 발화할 수 없다.
        // 대신 비순환 절(samplesWithTitleOrderViolation)을 넣는다.
        fired: modelCheck
          ? modelCheck.samplesWithMismatch > 0 || modelCheck.recallReconstructionMismatches > 0
            || modelCheck.samplesWithTitleOrderViolation > 0
          : null,
        computable: modelCheck !== null,
        basis: modelCheck ?? { notComputableBecause: '이 픽스처에는 analysis 블록이 없다(E1·E2 경로)' },
        meaning: '생존 조건 `rank < taken`이 실측과 어긋나거나(산술 자기일관성), 그 rank가 title 정렬 순위가 아니다(frontmatter 직접 대조). 어느 쪽이든 (rank, taken) 분해가 무효다',
      },
      R9: {
        fired: trends ? (risingPairs.length > 0 ? risingWithoutTakenEffect.length > 0 : null) : null,
        computable: trends !== null && risingPairs.length > 0,
        basis: {
          risingPairCount: risingPairs.length,
          offenders: risingWithoutTakenEffect,
          ...(trends && risingPairs.length === 0 ? { notComputableBecause: 'rising으로 판정된 인접 쌍이 없다 — 설명할 상승 자체가 없으므로 H3은 검정 대상이 아니다' } : {}),
        },
        meaning: 'H3(상승은 taken 성분이 만든다) 반증 — 오르는 구간인데 taken 성분이 0 이하라면 상승의 원인은 다른 데 있다',
      },
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
        round: ROUND,
        perturbations: perturbations.map((p) => ({ id: p.id, prefix: p.prefix })),
        quoteSafePerturb: ARGS.quoteSafePerturb,
        questionSet: QUESTIONS_REL,
        questionSetFrozenAt: QUESTIONS_FILE.frozenAt,
        shapeFixture: SHAPE_REL,
        distractorSet: `test/fixtures/bench/gate-recall/${DISTRACTORS_REL}`,
        fillerTitleUniquenessStrategy: TITLE_SUFFIX_STRATEGY,
        // PATH 트랩이 **깔려 있었는가**, 그리고 **발동했는가**. 둘 다 상수 선언이 아니라
        // 파일시스템 실측이다 — 스텁이 없으면 tripped=false는 아무것도 증명하지 않으므로
        // 소비자(test/smoke.mjs 단언 8)는 installed=true를 AND로 요구한다. 실행이 다 끝난
        // 뒤에 재는 값이라 "중간에 스텁이 사라졌다"도 함께 잡는다.
        paidCallTrapInstalled: fs.existsSync(trap.stub),
        paidCallTrapTripped: fs.existsSync(trap.tripped),
        actualHeadBytes: samples[0]?.headBytes ?? null,
        actualTailBytes: samples[0]?.tailBytes ?? null,
        frozenHeadBytes: SHAPE.frozenHeadBytes,
        indexBudgetBytes: SHAPE.indexBudgetBytes,
        indexBudgetLines: SHAPE.indexBudgetLines,
        // 계획서 I6-5의 `- [` 정규식으로 센 생존 수(전 샘플 합). 0이면 사양이 신 포맷(`* `)과
        // 어긋난다는 증거다.
        planRegexSurvivorTotal: samples.reduce((s, x) => s + x.planRegexSurvivorCount, 0),
      },
      calibration,
      refutation,
      byLevel,
      // E3. analysis 블록이 없는 픽스처(E1·E2)에서는 null이다 — 빈 배열로 적으면 "쟀는데 없었다"로
      // 읽히지만 실제로는 재지 않은 것이다.
      analysisConfig: ANALYSIS
        ? {
          ...ANALYSIS,
          adjacentPairsRun: adjacentPairs,
          adjacentPairsMatchPreregistered: JSON.stringify(adjacentPairs) === JSON.stringify(ANALYSIS.adjacentPairs),
          recallQuantum: RECALL_QUANTUM,
          quantizationNote: 'recall = 맞은문항수/문항수 이므로 delta는 1/문항수의 정확한 배수다. 배정도 표현 오차(0.25-0.20=0.04999…, 0.20-0.15=0.05000…2)가 등가한계 판정을 가르는 것을 막으려고 델타와 반사실 효과를 이 격자에 맞춰 반올림한다.',
          equivalenceBoundInclusive: true,
        }
        : null,
      trends,
      decomposition,
      perQuestion,
      crossChecks,
      samples,
    };

    const iso = startedAt.toISOString().replace(/[:.]/g, '-');
    const outPath = args.outPath ?? path.join(PLUGIN_ROOT, 'docs', 'benchmarks', 'raw', `gate-recall-${ROUND === 'E1' ? '' : `${ROUND.toLowerCase()}-`}${iso}.json`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);

    for (const b of byLevel) {
      const tag = perturbations.length > 1 ? `[${b.perturb}] ` : '';
      console.log(`${tag}N=${b.level}  recall ${b.recallMean.toFixed(3)} ± ${b.recallStdev.toFixed(3)}  (n=${b.n}, ${b.recallMin.toFixed(2)}–${b.recallMax.toFixed(2)})  cwdIndep ${b.cwdIndependentRecallMean.toFixed(3)}`);
    }
    if (trends) {
      console.log('--- 추세 판정 (부호검정 + 중앙값 CI) ---');
      for (const t of trends) {
        console.log(`[${t.perturb}] ${t.from}→${t.to}  ${t.direction}${t.substantive ? ' (substantive)' : ''}  meanΔ=${t.meanDelta.toFixed(4)}  n+/n-=${t.nPlus}/${t.nMinus}  p=${t.p.toFixed(4)}  CI=[${t.medianCI.low.toFixed(3)}, ${t.medianCI.high.toFixed(3)}]  구기준=${t.legacyP3.verdict}`);
      }
      console.log('--- (rank, taken) 분해 ---');
      for (const d of decomposition) {
        console.log(`[${d.perturb}] ${d.from}→${d.to}  관측Δ=${d.observedDelta.toFixed(4)} = rank ${d.rankEffect.toFixed(4)} + taken ${d.takenEffect.toFixed(4)} + 상호작용 ${d.interaction.toFixed(4)}  (잔차 ${d.residual.toExponential(1)})`);
      }
      console.log(`모형 일치(rank<taken): 불일치 샘플 ${modelCheck.samplesWithMismatch}/${modelCheck.totalSamples}, 문항검사 ${modelCheck.totalQuestionChecks}건, recall 재구성 불일치 ${modelCheck.recallReconstructionMismatches}`);
    }
    console.log(`calibration mismatches: ${calibration.mismatches.length}`);
    console.log(`R1..R7 fired: ${Object.entries(refutation).filter(([, v]) => v.fired === true).map(([k]) => k).join(',') || 'none'}${refutation.R6.fired === null ? '  (R6 계산 불가 — 조건 1개)' : ''}`);
    console.log(`filler title maxDuplicate across samples: ${Math.max(0, ...samples.map((s) => s.maxFillerTitleDuplicate))}`);
    console.log(`paidCallTrap: installed=${out.meta.paidCallTrapInstalled} tripped=${out.meta.paidCallTrapTripped}`);
    console.log(`hook cross-check byte-identical at hook config: ${crossChecks.filter((c) => c.byteIdenticalAtHookConfig).length}/${crossChecks.length}`);
    console.log(`plan-regex (\`- [\`) survivors across all samples: ${out.meta.planRegexSurvivorTotal}`);
    console.log(`out: ${outPath}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
