#!/usr/bin/env node
// OKF 효과 측정. 유료다 — smoke/CI에서 의도적으로 제외한다.
//
// 재는 것: "지식이 쌓여 있으면 매번 새로 탐색하지 않아도 되는가, 그래서 실제로 싼가."
//
// 설계는 docs/benchmarks/pre-registration-2026-07-16.md 에 돈 쓰기 전에 고정해 커밋했다.
// 이전(v1) 벤치마크의 결함을 그대로 물려받지 않기 위해 여기서 바꾼 것들:
//   - 헤드라인 지표는 CLI가 보고한 total_cost_usd 다. token activity 는 cache_read 가 대부분을
//     차지해 비용과 방향이 갈린다(v1: A 27,320tok/$0.0349 vs C 22,881tok/$0.0530 — 토큰은 16%
//     싸고 비용은 52% 비쌌다). 토큰은 비용 옆에 같이 싣되 대신 싣지 않는다.
//   - 프롬프트는 조건 대칭이다. "게이트가 있으면 읽어라" 같은 힌트를 C에만 주지 않는다.
//   - 런마다 nonce 를 붙여 prompt cache 재사용을 막는다. 실제 SessionStart 는 언제나 cold 이고,
//     warm 캐시는 탐색형(A)보다 결정형(C)을 더 깎아줘서 가설 방향으로 편향된다.
//   - 모델 ID 를 고정하고 조건별로 갈리면 중단한다(v1 은 한 실행에 haiku 와 sonnet 이 섞였다).
//   - 답이 게이트 인덱스에 이미 있는지, concept 파일을 실제로 Read 했는지 런마다 기록한다.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { okfPaths } = await import(`${ROOT}/lib/paths.mjs`);

if (process.env.OKF_RUN_LIVE_BENCH !== '1') {
  console.error('유료 라이브 실행입니다. 명시적으로 OKF_RUN_LIVE_BENCH=1을 설정하세요.');
  process.exit(2);
}
const runs = Number(process.env.OKF_BENCH_RUNS || 5);
if (!Number.isInteger(runs) || runs < 5) {
  console.error('OKF_BENCH_RUNS는 통계 왜곡을 막기 위해 5 이상의 정수여야 합니다.');
  process.exit(2);
}
// 정확한 모델 ID를 고정한다. 별칭('sonnet')은 회차마다 다른 모델로 해석될 수 있고, 그러면
// 조건 간 비용 차이가 모델 믹스 아티팩트가 된다.
const model = process.env.OKF_BENCH_MODEL || 'claude-sonnet-5';
const effort = process.env.OKF_BENCH_EFFORT || 'medium';
const maxTurns = Number(process.env.OKF_BENCH_MAX_TURNS || 25);
const perCallBudgetUsd = process.env.OKF_BENCH_MAX_BUDGET_USD || '0.60';
const judgeModel = process.env.OKF_BENCH_JUDGE_MODEL || 'claude-sonnet-5';
const bundleRoot = path.resolve(process.env.OKF_BENCH_BUNDLES || path.join(ROOT, '.bench-bundles'));
const targetRoot = path.resolve(process.env.OKF_BENCH_TARGETS || '');
// 동시성. wallMs 해석에 영향을 주므로 meta에 반드시 남긴다.
const concurrency = Number(process.env.OKF_BENCH_CONCURRENCY || 4);

const scenarios = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'bench', 'scenarios.json'), 'utf8'));
// 범주를 나눠 돌린다. 코드에서 유도 가능한 질문과 코드에 없는 정책 지식은 서로 다른 현상이고,
// 같은 번들·같은 레벨 축을 공유하지 않는다.
const onlyKind = process.env.OKF_BENCH_ONLY_KIND || '';
if (onlyKind) scenarios.scenarios = scenarios.scenarios.filter((s) => s.kind === onlyKind);
const levelsOf = (t) => JSON.parse(fs.readFileSync(path.join(bundleRoot, `${t}-levels.json`), 'utf8'));

// 모든 조건이 같은 문구를 받는다. 어떤 조건에도 "제공된 지식을 읽어라" 같은 힌트를 주지 않는다.
const INSTRUCTION = `답은 작업 트리, git 히스토리, 또는 제공된 컨텍스트에서 복구할 수 있을 수 있습니다.
"unknown"이라고 답하기 전에 찾아보세요. 근거 없이 추측하지는 마세요.
answer 에는 결론을, evidence 에는 그 근거(파일:라인 또는 출처)를 넣으세요.`;
const schema = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['answer', 'evidence', 'confidence'],
  additionalProperties: false,
};

function gateTextOf(bundleDir) {
  const home = path.join(bundleRoot, bundleDir);
  fs.writeFileSync(okfPaths(home).lock, JSON.stringify({ pid: process.pid, startedEpochMs: Date.now() }));
  try {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'session-start.mjs')], {
      env: { ...process.env, OKF_HOME: home }, input: '{}', cwd: ROOT, encoding: 'utf8',
    });
    return JSON.parse(r.stdout).hookSpecificOutput?.additionalContext || '';
  } finally {
    fs.rmSync(okfPaths(home).lock, { force: true });
  }
}
// claude_md 조건: 쌓인 지식을 전부 CLAUDE.md 에 붙여넣는, 사람들이 실제로 하는 그 방식.
// Claude Code 는 CLAUDE.md 를 컨텍스트에 자동 주입하므로 텍스트를 프롬프트에 싣는 것과 같다.
function claudeMdTextOf(bundleDir) {
  const home = path.join(bundleRoot, bundleDir);
  const parts = [];
  const walk = (dir, rel = '') => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.') || e.name === 'raw') continue;
      const rp = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), rp);
      else if (e.name.endsWith('.md') && !['index.md', 'log.md', 'SCHEMA.md'].includes(e.name)) {
        parts.push(fs.readFileSync(path.join(dir, e.name), 'utf8').trim());
      }
    }
  };
  walk(home);
  return `# CLAUDE.md\n\n다음은 이 저장소에서 지금까지 확인한 사실들입니다.\n\n${parts.join('\n\n---\n\n')}\n`;
}

function tokenActivity(u = {}) {
  return ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']
    .reduce((s, k) => s + (Number.isFinite(u[k]) ? u[k] : 0), 0);
}
function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
}
function distribution(values) {
  const n = values.filter(Number.isFinite);
  return n.length ? { n: n.length, min: Math.min(...n), p50: percentile(n, 0.5), p95: percentile(n, 0.95), max: Math.max(...n) } : null;
}
function sanitize(value) {
  if (typeof value === 'string') {
    return [[bundleRoot, '<BUNDLES>'], [targetRoot, '<TARGETS>'], [ROOT, '<PLUGIN_ROOT>'], [os.homedir(), '<HOME>']]
      .filter(([f]) => f).sort((a, b) => b[0].length - a[0].length)
      .reduce((t, [f, to]) => t.split(f).join(to), value);
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v)]));
  return value;
}

async function runClaude({ prompt, cwd, addDir }) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--safe-mode', '--no-session-persistence',
    '--model', model, '--effort', effort, '--max-turns', String(maxTurns), '--max-budget-usd', perCallBudgetUsd,
    '--permission-mode', 'dontAsk',
    // 도구 제한은 하니스가 강제한다. 프롬프트로 부탁하면 A가 거부당한 호출로 턴을 태워
    // 인위적으로 비싸진다.
    '--tools', 'Read,Glob,Grep,Bash',
    '--allowedTools', 'Read,Glob,Grep,Bash(git log:*),Bash(git show:*),Bash(git diff:*),Bash(git blame:*),Bash(git grep:*)',
    '--json-schema', JSON.stringify(schema)];
  if (addDir) args.push('--add-dir', addDir);
  const started = process.hrtime.bigint();
  let firstValidMs = null;
  let pending = '';
  const events = [];
  const toolIds = new Set();
  const toolCounts = {};
  const readPaths = [];
  const child = spawn('claude', args, { cwd, env: { ...process.env, OKF_BATCH: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(prompt);
  child.stderr.on('data', () => {});
  child.stdout.on('data', (chunk) => {
    pending += chunk;
    const lines = pending.split('\n'); pending = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let event; try { event = JSON.parse(line); } catch { continue; }
      events.push(event);
      if (event.type !== 'assistant') continue;
      for (const b of event.message?.content || []) {
        if (firstValidMs == null && (b.type === 'text' || b.type === 'tool_use')) firstValidMs = Number(process.hrtime.bigint() - started) / 1e6;
        if (b.type !== 'tool_use' || toolIds.has(b.id)) continue;
        toolIds.add(b.id);
        toolCounts[b.name] = (toolCounts[b.name] || 0) + 1;
        if (b.name === 'Read' && typeof b.input?.file_path === 'string') readPaths.push(b.input.file_path);
      }
    }
  });
  const exitCode = await new Promise((res, rej) => { child.on('error', rej); child.on('close', res); });
  if (pending.trim()) { try { events.push(JSON.parse(pending)); } catch { /* stderr 로 갈음 */ } }
  const wallMs = Number(process.hrtime.bigint() - started) / 1e6;
  const result = [...events].reverse().find((e) => e.type === 'result') || null;
  const usage = result?.usage && typeof result.usage === 'object' ? result.usage : {};
  let answer = result?.structured_output && typeof result.structured_output === 'object' ? result.structured_output : null;
  if (!answer && typeof result?.result === 'string') {
    try { answer = JSON.parse(result.result); } catch {
      const m = /\{[\s\S]*\}/.exec(result.result);
      try { answer = m ? JSON.parse(m[0]) : null; } catch { answer = null; }
    }
  }
  return {
    exitCode, subtype: result?.subtype ?? null, isError: result?.is_error ?? null,
    // 턴 상한에 걸린 런은 "틀림"이 아니라 "검열됨"이다. 따로 세어 보고한다.
    censored: result?.subtype === 'error_max_turns' || result?.num_turns >= maxTurns,
    firstValidMs, wallMs,
    apiMs: Number.isFinite(result?.duration_api_ms) ? result.duration_api_ms : null,
    totalCostUsd: Number.isFinite(result?.total_cost_usd) ? result.total_cost_usd : null,
    models: Object.keys(result?.modelUsage || {}),
    numTurns: Number.isFinite(result?.num_turns) ? result.num_turns : null,
    usage, tokenActivity: tokenActivity(usage),
    tokenActivityExCacheRead: tokenActivity(usage) - (Number(usage.cache_read_input_tokens) || 0),
    toolCalls: toolIds.size, toolCounts, readPaths, answer,
  };
}

// 채점자는 조건을 모른다. 어떤 조건의 답인지 알면 무의식적으로 봐준다.
async function judge(scenario, answerText) {
  const prompt = `당신은 채점자입니다. 아래 질문에 대한 응답이 정답과 사실적으로 일치하는지만 판정하세요.
표현이 다르거나 더 자세한 것은 상관없습니다. 핵심 사실이 맞는지만 봅니다. 부분적으로만 맞으면 틀린 것입니다.

[질문]
${scenario.question_ko}

[정답 — 핀 고정된 소스에서 직접 검증됨]
${scenario.ground_truth}

[채점할 응답]
${answerText}

correct 는 핵심 사실이 정답과 일치할 때만 true 입니다. 응답이 "unknown"이거나 답을 못 찾았다고 하면 correct=false, admitted_unknown=true 입니다.`;
  const args = ['-p', '--output-format', 'json', '--safe-mode', '--no-session-persistence',
    '--model', judgeModel, '--max-turns', '1', '--permission-mode', 'dontAsk', '--tools', '',
    '--json-schema', JSON.stringify({
      type: 'object',
      properties: { correct: { type: 'boolean' }, admitted_unknown: { type: 'boolean' }, reason: { type: 'string' } },
      required: ['correct', 'admitted_unknown', 'reason'], additionalProperties: false,
    })];
  return new Promise((resolve) => {
    const child = spawn('claude', args, { env: { ...process.env, OKF_BATCH: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', () => {});
    child.stdin.end(prompt);
    child.on('close', () => {
      let r = null; try { r = JSON.parse(out); } catch { /* 아래에서 null 처리 */ }
      if (Array.isArray(r)) r = r.reverse().find((e) => e.type === 'result') || null;
      let v = r?.structured_output;
      if (!v && typeof r?.result === 'string') { try { v = JSON.parse(r.result); } catch { v = null; } }
      resolve({ verdict: v || null, costUsd: Number(r?.total_cost_usd) || 0 });
    });
  });
}

// 게이트 인덱스 한 줄만으로 이미 답이 되는가?
//
// 이게 이 벤치마크에서 제일 중요한 감사다. 배치가 쓰는 concept의 description은 목차 한 줄이 아니라
// 결론 그 자체일 때가 있다("...플래그가 기본 false라서 getAttribute('id')가 null이 된다"). 그러면
// OKF의 이득은 "필요한 것만 골라 읽어서"가 아니라 "주입된 텍스트에 이미 답이 있어서" 생긴 것이다.
// 둘 다 실제 OKF 동작이지만 의미가 완전히 다르고, 숨기면 독자를 속이는 것이다.
// 키워드 매칭으로는 못 잡는다(표현이 달라도 의미는 같으므로) — 채점자에게 묻는다.
async function auditGateAnswersAlone(scenario, gateText) {
  const prompt = `아래 [주입된 텍스트]만 주어졌을 때, 코드베이스를 전혀 열어보지 않고도 [질문]에 정답을 말할 수 있습니까?
텍스트에 결론이 이미 적혀 있으면 true, 관련 항목이 있다는 단서만 있고 실제 답은 다른 곳을 봐야 알 수 있으면 false 입니다.

[질문]
${scenario.question_ko}

[정답]
${scenario.ground_truth}

[주입된 텍스트]
${gateText}`;
  const args = ['-p', '--output-format', 'json', '--safe-mode', '--no-session-persistence',
    '--model', judgeModel, '--max-turns', '1', '--permission-mode', 'dontAsk', '--tools', '',
    '--json-schema', JSON.stringify({
      type: 'object',
      properties: { answers_alone: { type: 'boolean' }, reason: { type: 'string' } },
      required: ['answers_alone', 'reason'], additionalProperties: false,
    })];
  return new Promise((resolve) => {
    const child = spawn('claude', args, { env: { ...process.env, OKF_BATCH: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', () => {});
    child.stdin.end(prompt);
    child.on('close', () => {
      let r = null; try { r = JSON.parse(out); } catch { /* null 처리 */ }
      if (Array.isArray(r)) r = r.reverse().find((e) => e.type === 'result') || null;
      let v = r?.structured_output;
      if (!v && typeof r?.result === 'string') { try { v = JSON.parse(r.result); } catch { v = null; } }
      resolve({ answersAlone: v?.answers_alone ?? null, reason: v?.reason ?? null, costUsd: Number(r?.total_cost_usd) || 0 });
    });
  });
}

// 정규식은 2차 확인용이다. 산문 답을 정규식으로만 채점하면 표현 차이를 오답으로 만든다.
function regexHit(scenario, text) {
  const t = String(text || '').toLowerCase();
  const hits = scenario.answer_keywords.filter((k) => t.includes(String(k).toLowerCase()));
  return { hits: hits.length, total: scenario.answer_keywords.length };
}

const targets = { slim: path.join(targetRoot, 'slim'), rfcs: path.join(targetRoot, 'rfcs') };
const levelData = { slim: levelsOf('slim'), rfcs: levelsOf('rfcs') };
const snapOf = (t, level) => levelData[t].snapshots.find((s) => s.requestedLevel === level);

// 측정 셀을 만든다. 시나리오별로 따로 보고한다 — 시나리오를 가로질러 평균내면 시나리오 선택이
// 헤드라인을 결정하게 된다(싼 grep 질문과 비싼 탐색 질문은 다른 현상이다).
const REFERENCE_LEVEL = Number(process.env.OKF_BENCH_REF_LEVEL || 20);
const LEVEL_AXIS = (process.env.OKF_BENCH_LEVELS || '1,5,10,15,20,40').split(',').filter(Boolean).map(Number);
const cells = [];
for (const s of scenarios.scenarios) {
  for (const condition of ['zero_base', 'answer_sheet', 'okf', 'wrong_knowledge', 'claude_md']) {
    cells.push({ scenario: s, condition, level: condition === 'zero_base' || condition === 'answer_sheet' ? null : REFERENCE_LEVEL });
  }
  // 레벨 축은 buried 시나리오에서만 잰다 — 축의 목적은 "지식이 쌓일수록 어떻게 되는가"이고,
  // 이는 탐색이 비싼 질문에서만 의미가 있다.
  if (s.kind !== 'buried' || s.target !== 'slim') continue;
  for (const level of LEVEL_AXIS) {
    if (level === REFERENCE_LEVEL) continue;
    for (const condition of ['okf', 'claude_md']) cells.push({ scenario: s, condition, level });
  }
}

function buildPrompt(cell, nonce) {
  const s = cell.scenario;
  let context = '';
  let addDir = null;
  if (cell.condition === 'answer_sheet') {
    context = `이전 세션에서 확인한 사실:\n${s.ground_truth}\n\n`;
  } else if (cell.condition === 'okf') {
    const snap = snapOf(s.target, cell.level);
    context = `${gateTextOf(snap.dir)}\n\n`;
    addDir = path.join(bundleRoot, snap.dir);
  } else if (cell.condition === 'wrong_knowledge') {
    // 크기를 맞춘, 전부 무관한 진짜 지식(다른 대상 저장소를 실제로 조사해 쌓인 concept).
    const other = s.target === 'slim' ? 'rfcs' : 'slim';
    const snap = snapOf(other, cell.level) || levelData[other].snapshots.at(-1);
    context = `${gateTextOf(snap.dir)}\n\n`;
    addDir = path.join(bundleRoot, snap.dir);
  } else if (cell.condition === 'claude_md') {
    const snap = snapOf(s.target, cell.level);
    context = `${claudeMdTextOf(snap.dir)}\n\n`;
  }
  // nonce 는 맨 앞에 둔다. prompt cache 는 접두사 기준이라 앞에 있어야 재사용을 끊는다.
  return `[run ${nonce}]\n${context}${INSTRUCTION}\n\n[질문]\n${s.question_ko}\n`;
}

const records = [];
const startedAt = new Date().toISOString();
let judgeCost = 0;
let done = 0;
const total = cells.length * runs;

// 측정 전에 감사부터 한다: 각 (시나리오, 레벨)의 게이트 텍스트만으로 이미 답이 나오는가.
// 셀마다 5번씩 물을 이유는 없다 — 게이트 텍스트는 런과 무관하게 고정이다.
const gateAudit = {};
for (const cell of cells.filter((c) => c.condition === 'okf')) {
  const key = `${cell.scenario.key}|L${cell.level}`;
  if (gateAudit[key]) continue;
  const gate = gateTextOf(snapOf(cell.scenario.target, cell.level).dir);
  const a = await auditGateAnswersAlone(cell.scenario, gate);
  judgeCost += a.costUsd;
  gateAudit[key] = { answersAlone: a.answersAlone, reason: a.reason, gateBytes: Buffer.byteLength(gate) };
  process.stderr.write(`감사 ${key}: 게이트만으로 답 가능=${a.answersAlone}\n`);
}
// 셀을 평평하게 펼쳐 워커 풀로 돌린다. 순차로 돌리면 175셀 × ~110초 = 5시간이 넘는데, 그
// 시간은 측정 품질을 사지 못한다. 비용·토큰·도구호출은 동시성과 무관하다. 영향을 받는 건
// 벽시계 시간뿐이고, 그건 헤드라인 지표가 아니다 — 대신 concurrency를 meta에 남겨서 wallMs를
// 성능 주장으로 읽지 못하게 한다.
const queue = [];
for (let rep = 0; rep < runs; rep++) for (const cell of cells) queue.push({ rep, cell });
let qi = 0;

async function measureWorker() {
  while (qi < queue.length) {
    const { rep, cell } = queue[qi++];
    const nonce = crypto.randomUUID();
    const prompt = buildPrompt(cell, nonce);
    const addDir = cell.condition === 'okf' || cell.condition === 'wrong_knowledge'
      ? path.join(bundleRoot, (cell.condition === 'okf' ? snapOf(cell.scenario.target, cell.level) : (snapOf(cell.scenario.target === 'slim' ? 'rfcs' : 'slim', cell.level) || levelData[cell.scenario.target === 'slim' ? 'rfcs' : 'slim'].snapshots.at(-1))).dir)
      : null;
    const m = await runClaude({ prompt, cwd: targets[cell.scenario.target], addDir });
    const answerText = m.answer ? `${m.answer.answer}\n근거: ${(m.answer.evidence || []).join(' | ')}` : '(응답 없음)';
    const { verdict, costUsd } = await judge(cell.scenario, answerText);
    judgeCost += costUsd;
    const gate = cell.condition === 'okf' ? gateTextOf(snapOf(cell.scenario.target, cell.level).dir) : '';
    records.push(sanitize({
      repetition: rep, condition: cell.condition, scenario: cell.scenario.key,
      target: cell.scenario.target, kind: cell.scenario.kind, level: cell.level, nonce,
      promptBytes: Buffer.byteLength(prompt),
      readTargetConcept: addDir ? m.readPaths.some((p) => p.startsWith(addDir)) : null,
      gateAnswersAlone: cell.condition === 'okf' ? gateAudit[`${cell.scenario.key}|L${cell.level}`]?.answersAlone ?? null : null,
      answerKeywordsInGate: cell.condition === 'okf' ? regexHit(cell.scenario, gate) : null,
      measurement: m,
      grade: {
        correct: verdict?.correct ?? null, admittedUnknown: verdict?.admitted_unknown ?? null,
        reason: verdict?.reason ?? null,
        confidentlyWrong: verdict?.correct === false && verdict?.admitted_unknown === false && m.answer?.confidence === 'high',
        regex: regexHit(cell.scenario, answerText),
      },
    }));
    done++;
    const r = records.at(-1);
    process.stderr.write(`[${done}/${total}] ${cell.scenario.key}/${cell.condition}${cell.level ? `@L${cell.level}` : ''} correct=${r.grade.correct} $${(m.totalCostUsd || 0).toFixed(4)} tools=${m.toolCalls}\n`);
  }
}
await Promise.all(Array.from({ length: concurrency }, measureWorker));

// 모델이 조건별로 갈리면 비용 비교가 모델 믹스 아티팩트가 된다. 사후에 알면 늦으므로 남긴다.
const resolvedModels = [...new Set(records.flatMap((r) => r.measurement.models))].sort();
const cellKey = (r) => `${r.scenario}|${r.condition}|${r.level ?? '-'}`;
const byCell = {};
for (const r of records) {
  (byCell[cellKey(r)] ||= { scenario: r.scenario, condition: r.condition, level: r.level, kind: r.kind, rows: [] }).rows.push(r);
}
const summary = Object.fromEntries(Object.entries(byCell).map(([k, c]) => {
  const correct = c.rows.filter((r) => r.grade.correct === true);
  return [k, {
    scenario: c.scenario, condition: c.condition, level: c.level, kind: c.kind, runs: c.rows.length,
    correct: correct.length,
    censored: c.rows.filter((r) => r.measurement.censored).length,
    confidentlyWrong: c.rows.filter((r) => r.grade.confidentlyWrong).length,
    readTargetConcept: c.rows.filter((r) => r.readTargetConcept === true).length,
    gateAnswersAlone: c.rows.filter((r) => r.gateAnswersAlone === true).length,
    // 효율 비교는 정답인 런만으로 한다. 틀린 채 빨리 끝난 런을 "쌌다"고 세면 안 된다.
    costUsdCorrectOnly: distribution(correct.map((r) => r.measurement.totalCostUsd)),
    costUsdAll: distribution(c.rows.map((r) => r.measurement.totalCostUsd)),
    tokenActivity: distribution(c.rows.map((r) => r.measurement.tokenActivity)),
    tokenActivityExCacheRead: distribution(c.rows.map((r) => r.measurement.tokenActivityExCacheRead)),
    cacheReadTokens: distribution(c.rows.map((r) => r.measurement.usage.cache_read_input_tokens)),
    wallMs: distribution(c.rows.map((r) => r.measurement.wallMs)),
    toolCalls: distribution(c.rows.map((r) => r.measurement.toolCalls)),
    turns: distribution(c.rows.map((r) => r.measurement.numTurns)),
  }];
}));

const out = {
  meta: {
    startedAt, finishedAt: new Date().toISOString(), model, resolvedModels, effort, maxTurns, runs,
    judgeModel, referenceLevel: REFERENCE_LEVEL, levelAxis: LEVEL_AXIS, concurrency,
    modelMixDetected: resolvedModels.length > 1,
    claudeVersion: spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout.trim(),
    node: process.version, platform: `${os.platform()} ${os.arch()}`,
    repoCommit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim(),
    pins: scenarios.pins,
    bundles: Object.fromEntries(Object.entries(levelData).map(([t, d]) => [t, d.snapshots.map((s) => ({
      level: s.requestedLevel, concepts: s.conceptsReal, seeds: s.conceptsSeed,
      gateBytes: s.gateBytes, gateTruncated: s.gateTruncated, batchCostUsd: s.cumulativeBatchCostUsd,
    }))])),
    judgeCostUsd: Number(judgeCost.toFixed(4)),
    gateAudit,
    measurementCostUsd: Number(records.reduce((s, r) => s + (r.measurement.totalCostUsd || 0), 0).toFixed(4)),
  },
  metricDefinitions: {
    totalCostUsd: 'CLI가 보고한 total_cost_usd. 헤드라인 지표.',
    tokenActivity: 'input+output+cache_creation+cache_read 의 명시적 합. 비용과 방향이 갈릴 수 있어 비용 옆에만 싣는다.',
    costUsdCorrectOnly: '정답인 런만의 비용 분포. 효율 비교는 이것으로만 한다.',
    confidentlyWrong: 'correct=false, unknown 인정 안 함, confidence=high 인 런.',
    censored: 'max-turns 상한에 걸린 런. 오답이 아니라 측정 불가로 따로 센다.',
    wallMs: `프로세스 시작부터 CLI 종료까지. 측정은 동시성 ${'${concurrency}'}로 돌렸으므로 응답 속도 주장으로 읽으면 안 된다 — 비용·토큰·도구호출은 동시성과 무관하다.`,
    gateAnswersAlone: '주입된 게이트 텍스트만으로 정답을 말할 수 있다고 채점자가 판정한 셀. 그런 셀에서 OKF의 이득은 "골라 읽어서"가 아니라 "이미 주입돼서" 생긴 것이다 — 둘 다 실제 OKF 동작이지만 의미가 다르므로 구분해 보고한다.',
  },
  summary, records,
};
const rawDir = path.join(ROOT, 'docs', 'benchmarks', 'raw');
fs.mkdirSync(rawDir, { recursive: true });
const slug = startedAt.replace(/[:.]/g, '-');
const outPath = path.join(rawDir, `okf-live-${slug}.json`);
fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(outPath);
