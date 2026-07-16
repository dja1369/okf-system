#!/usr/bin/env node
// OKF '점진적 체인' 벤치마크. 유료다 — smoke/CI에서 의도적으로 제외한다.
//
// 재는 것: 세션k가 질문 Qk를 조사하면 그 결론이 실제 배치로 즉시 지식 번들에 적재되고,
// 세션k+1은 그 번들을 SessionStart 게이트로 받아 변형 질문 Q(k+1)에 답한다(okf_chain).
// zero_base_chain은 같은 M개 질문을 매 스텝 완전히 독립적으로(축적 없이) 받는 컨트롤이다.
// "누적된 지식이 실제로 다음(변형) 조사를 싸게/정확하게 만드는가"를 잰다.
//
// 이 실험은 v2에서 철회된 "지식이 쌓일수록 싸진다"는 주장과 형태가 같다. v2는 그 주장을
// 정답런 2~5개 중앙값으로, 그리고 실제로는 lib/config.mjs의 inject_max_lines:120 상한을
// 측정한 것으로 만들어냈다가 철회했다(docs/benchmarks/pre-registration-2026-07-16-v3.md).
// 이번엔 같은 함정에 빠지지 않도록:
//   (a) 매 스텝 실제 배치로 진짜 축적이 일어났는지 게이트 바이트 추이(gateBytesBefore/After)로
//       검증한다 — 재현이 아니라 사실이어야 한다.
//   (b) 체인마다 독립된 git worktree(cwd)+OKF_HOME으로 교차 오염을 차단한다.
//   (c) Claude Code 자체의 cwd별 프로젝트 메모리가 우리 모르게 축적하지 못하도록 스텝마다
//       (한 번이 아니라) 지운다 — 이 체인의 "학습"은 오직 우리가 트리거한 배치를 통해서만
//       일어나야 한다.
//   (d) n(체인 수)을 v3 대조군 수준으로 확보한다.
//   (e) 결과를 번들 크기가 아니라 M(스텝 수, 내용 고정) 축으로만 그린다 — 절대 "concept
//       개수가 늘수록"으로 다시 그리지 않는다.
// 설계는 docs/benchmarks/pre-registration-2026-07-16-v4.md 에 지출 전 커밋.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ensureBootstrap } from '../lib/bootstrap.mjs';
import { okfPaths } from '../lib/paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.env.OKF_RUN_LIVE_BENCH !== '1') {
  console.error('유료 라이브 실행입니다. 명시적으로 OKF_RUN_LIVE_BENCH=1을 설정하세요.');
  process.exit(2);
}
const chains = Number(process.env.OKF_BENCH_CHAINS || 15);
if (!Number.isInteger(chains) || chains < 1) {
  console.error('OKF_BENCH_CHAINS는 1 이상의 정수여야 합니다(스모크=1, 본 측정=5 이상 권장).');
  process.exit(2);
}
const model = process.env.OKF_BENCH_MODEL || 'claude-sonnet-5';
const effort = process.env.OKF_BENCH_EFFORT || 'medium';
// 이 시나리오는 slim_buried(파일 5개)보다 깊은 추적(파일 10개+)을 요구한다. 앵커
// 외삽(턴 28~38, $0.65~1.05)에 맞춰 v3 기본값(25턴/$0.60)보다 상한을 올린다.
const maxTurns = Number(process.env.OKF_BENCH_MAX_TURNS || 40);
const perCallBudgetUsd = process.env.OKF_BENCH_MAX_BUDGET_USD || '1.25';
const judgeModel = process.env.OKF_BENCH_JUDGE_MODEL || 'claude-sonnet-5';
const batchModel = process.env.OKF_BENCH_BATCH_MODEL || 'sonnet';
const concurrency = Number(process.env.OKF_BENCH_CONCURRENCY || 6);
const k8sRepoDir = path.resolve(process.env.OKF_BENCH_K8S_DIR || path.join(ROOT, '.bench-targets', 'k8s'));
const sparsePath = 'pkg/scheduler';
const workRoot = path.resolve(process.env.OKF_BENCH_CHAIN_OUT || path.join(ROOT, '.bench-chain'));

if (!fs.existsSync(k8sRepoDir)) {
  console.error(`k8s 저장소가 없습니다: ${k8sRepoDir}`);
  process.exit(2);
}

const chainFixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'bench', 'chain-steps.json'), 'utf8'));
const STEPS = [...chainFixture.steps].sort((a, b) => a.order - b.order);
const ARMS = ['okf_chain', 'zero_base_chain'];

// 모든 조건이 같은 문구를 받는다(v3와 같은 원칙). 어떤 arm에도 "제공된 지식을 읽어라" 같은
// 힌트를 주지 않는다.
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

// 게이트를 진짜 SessionStart 훅으로 전달한다(v3와 같은 계약). SessionEnd는 등록하지 않는다 —
// 등록하면 세션 종료마다 진짜(원치 않는) 배치가 뜬다. 축적은 우리가 명시적으로 트리거한다.
const chainSettingsPath = path.join(ROOT, 'test', '.bench-chain-settings.json');
fs.writeFileSync(chainSettingsPath, `${JSON.stringify({
  hooks: {
    SessionStart: [{
      matcher: 'startup|resume|clear|compact',
      hooks: [{ type: 'command', command: `node ${JSON.stringify(path.join(ROOT, 'bin', 'session-start.mjs'))}`, timeout: 15 }],
    }],
  },
}, null, 2)}\n`);

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
    return [[workRoot, '<CHAINWORK>'], [k8sRepoDir, '<K8S_REPO>'], [ROOT, '<PLUGIN_ROOT>'], [os.homedir(), '<HOME>']]
      .filter(([f]) => f).sort((a, b) => b[0].length - a[0].length)
      .reduce((t, [f, to]) => t.split(f).join(to), value);
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v)]));
  return value;
}

// 측정 오염 차단(v3에서 발견, v4에서 강화). v3는 측정 시작 전 1회만 지웠다 — 체인은 같은
// cwd에서 여러 세션이 의도적으로 이어지므로, Claude Code의 cwd별 프로젝트 메모리가 우리 배치와
// 무관하게 스텝 사이에 저절로 지식을 누적할 위험이 v3보다 크다(okf_chain 뿐 아니라 zero_base_chain
// 도 4스텝이 같은 cwd를 쓰므로 같은 위험이 있다 — 안 지우면 "축적 없음" 컨트롤이 거짓이 된다).
// 그래서 스텝(런)마다 지운다.
function projectMemoryDir(cwd) {
  // Claude Code의 실제 슬러그 규칙은 '/'만이 아니라 영숫자가 아닌 모든 문자('.', '_' 포함)를
  // '-'로 바꾼다(실측으로 확인 — path.resolve().replace(/\//g,'-')만으로는 '.claude',
  // 'side_project'처럼 점/언더스코어가 든 경로에서 실제 슬러그와 어긋난다. v3의
  // bench-okf.mjs도 같은 패턴을 쓰지만 v3의 대상 경로엔 점/언더스코어가 없어 우연히 맞았다).
  const slug = path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', slug, 'memory');
}
function clearProjectMemory(cwd) {
  const mem = projectMemoryDir(cwd);
  if (fs.existsSync(mem)) fs.rmSync(mem, { recursive: true, force: true });
}

// 원자 채점(v3와 동일 스키마·로직 — 원자 단위 독립 판정 + 이진 검증을 나란히 발행).
const ATOM_SCHEMA = {
  type: 'object',
  properties: {
    atoms: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['correct', 'absent', 'contradicted'] },
          reason: { type: 'string' },
        },
        required: ['id', 'status', 'reason'],
        additionalProperties: false,
      },
    },
    admitted_unknown: { type: 'boolean' },
  },
  required: ['atoms', 'admitted_unknown'],
  additionalProperties: false,
};

function runJudge(prompt, jsonSchema) {
  const args = ['-p', '--output-format', 'json', '--safe-mode', '--no-session-persistence',
    '--model', judgeModel, '--max-turns', '1', '--permission-mode', 'dontAsk', '--tools', '',
    '--json-schema', JSON.stringify(jsonSchema)];
  return new Promise((resolve) => {
    const child = spawn('claude', args, { env: { ...process.env, OKF_BATCH: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', () => {});
    child.stdin.end(prompt);
    child.on('close', () => {
      let r = null; try { r = JSON.parse(out); } catch { /* 아래에서 null 처리 */ }
      if (Array.isArray(r)) r = r.reverse().find((e) => e.type === 'result') || null;
      let v = r?.structured_output;
      if (!v && typeof r?.result === 'string') { try { v = JSON.parse(r.result); } catch { v = null; } }
      resolve({ value: v || null, costUsd: Number(r?.total_cost_usd) || 0 });
    });
  });
}

async function judge(step, answerText) {
  const atomList = step.ground_truth_atoms || [];
  if (!atomList.length) throw new Error(`스텝 ${step.key}에 ground_truth_atoms가 없습니다 — 원자 분해는 측정 전에 고정되어야 합니다.`);
  const prompt = `당신은 채점자입니다. 아래 응답이 정답의 각 항목을 담고 있는지 항목별로 독립 판정하세요.
표현이 다르거나 더 자세한 것은 상관없습니다. 각 항목의 핵심 사실이 맞는지만 봅니다.

각 항목의 status:
- "correct": 응답이 그 사실을 담고 있고 정답과 일치한다.
- "absent": 응답이 그 사실을 언급하지 않았거나, 모른다/기록되어 있지 않다고 했다.
- "contradicted": 응답이 그 사실과 어긋나는 주장을 했다.

주의: 어떤 사실을 "모르겠다"고 말한 것은 absent 이지 correct 가 아닙니다. 그 사실을 언급은
했으나 내용이 틀리면 contradicted 입니다.

[질문]
${step.question_ko}

[정답 — 핀 고정된 소스에서 직접 검증됨]
${step.ground_truth}

[채점할 항목]
${atomList.map((a) => `- ${a.id}: ${a.fact}`).join('\n')}

[채점할 응답]
${answerText}

admitted_unknown 은 응답이 전체적으로 "모른다/못 찾았다"고 인정한 경우에만 true 입니다.`;
  const { value, costUsd } = await runJudge(prompt, ATOM_SCHEMA);
  const byId = Object.fromEntries((value?.atoms || []).map((a) => [a.id, a]));
  const atoms = atomList.map((a) => ({
    id: a.id, critical: a.critical === true,
    status: byId[a.id]?.status ?? 'absent',
    reason: byId[a.id]?.reason ?? '(채점자가 이 항목을 판정하지 않음 — absent로 처리)',
  }));
  const correctAtoms = atoms.filter((a) => a.status === 'correct').length;
  const criticalAtoms = atoms.filter((a) => a.critical);
  return {
    atoms: {
      total: atoms.length, correct: correctAtoms,
      criticalTotal: criticalAtoms.length,
      criticalCorrect: criticalAtoms.filter((a) => a.status === 'correct').length,
      contradicted: atoms.filter((a) => a.status === 'contradicted').length,
      detail: atoms,
    },
    verdict: {
      correct: correctAtoms === atoms.length,
      admitted_unknown: value?.admitted_unknown === true,
      reason: atoms.filter((a) => a.status !== 'correct').map((a) => `${a.id}=${a.status}: ${a.reason}`).join(' | ') || '모든 항목 정답',
    },
    costUsd,
  };
}

// 게이트 텍스트(스텝 실행 "전/후"에 재서, 축적이 실제로 일어났는지 스텝 자체와 분리해 기록).
function gateTextOf(okfHome) {
  fs.writeFileSync(okfPaths(okfHome).lock, JSON.stringify({ pid: process.pid, startedEpochMs: Date.now() }));
  try {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'session-start.mjs')], {
      env: { ...process.env, OKF_HOME: okfHome }, input: '{}', cwd: ROOT, encoding: 'utf8',
    });
    return JSON.parse(r.stdout).hookSpecificOutput?.additionalContext || '';
  } finally {
    fs.rmSync(okfPaths(okfHome).lock, { force: true });
  }
}

// 세션 실행. v3의 runClaude와 같은 계약이되, session_id도 회수한다(체인 전달을 위해 transcript를
// 찾아야 하므로 — v3의 bench-okf.mjs는 transcript를 쓰지 않아 필요 없었다).
async function runClaude({ prompt, cwd, addDir, okfHome }) {
  // '--no-session-persistence'를 안 쓴다(v3의 bench-okf.mjs와의 유일한 차이) — 이 세션의
  // transcript가 실제로 ~/.claude/projects/<cwd슬러그>/<sessionId>.jsonl 에 남아야 배치가
  // 그걸 씹어 다음 스텝의 지식으로 만들 수 있다. zero_base_chain도 같은 인자를 쓰지만
  // transcript를 회수하지 않으므로 무해하다.
  const args = ['-p', '--output-format', 'stream-json', '--verbose',
    '--setting-sources', '',
    '--model', model, '--effort', effort, '--max-turns', String(maxTurns), '--max-budget-usd', perCallBudgetUsd,
    '--permission-mode', 'dontAsk',
    '--tools', 'Read,Glob,Grep,Bash',
    '--allowedTools', 'Read,Glob,Grep,Bash(git log:*),Bash(git show:*),Bash(git diff:*),Bash(git blame:*),Bash(git grep:*)',
    '--json-schema', JSON.stringify(schema)];
  const debugFile = okfHome ? path.join(os.tmpdir(), `okf-bench-chain-dbg-${crypto.randomUUID()}.log`) : null;
  if (okfHome) args.push('--settings', chainSettingsPath, '--debug-file', debugFile);
  if (addDir) args.push('--add-dir', addDir);
  const lockPath = okfHome ? okfPaths(okfHome).lock : null;
  if (lockPath) fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedEpochMs: Date.now() }));
  const started = process.hrtime.bigint();
  let firstValidMs = null;
  let pending = '';
  const events = [];
  const toolIds = new Set();
  const toolCounts = {};
  const readPaths = [];
  let sessionIdFromEvents = null;
  const env = { ...process.env };
  delete env.OKF_BATCH;
  if (okfHome) env.OKF_HOME = okfHome;
  const child = spawn('claude', args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(prompt);
  child.stderr.on('data', () => {});
  child.stdout.on('data', (chunk) => {
    pending += chunk;
    const lines = pending.split('\n'); pending = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let event; try { event = JSON.parse(line); } catch { continue; }
      events.push(event);
      if (event.session_id && !sessionIdFromEvents) sessionIdFromEvents = event.session_id;
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
  const exitCode = await new Promise((res, rej) => { child.on('error', rej); child.on('close', res); })
    .finally(() => { if (lockPath) fs.rmSync(lockPath, { force: true }); });
  if (pending.trim()) { try { events.push(JSON.parse(pending)); } catch { /* stderr 로 갈음 */ } }
  let gateDeliveredChars = null;
  if (debugFile) {
    try {
      const m = /provided additionalContext \((\d+) chars\)/.exec(fs.readFileSync(debugFile, 'utf8'));
      gateDeliveredChars = m ? Number(m[1]) : 0;
    } catch { gateDeliveredChars = null; }
    fs.rmSync(debugFile, { force: true });
  }
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
    censored: result?.subtype === 'error_max_turns' || result?.num_turns >= maxTurns,
    firstValidMs, wallMs,
    apiMs: Number.isFinite(result?.duration_api_ms) ? result.duration_api_ms : null,
    totalCostUsd: Number.isFinite(result?.total_cost_usd) ? result.total_cost_usd : null,
    models: Object.keys(result?.modelUsage || {}),
    modelUsage: result?.modelUsage && typeof result.modelUsage === 'object' ? result.modelUsage : {},
    costByModel: Object.fromEntries(Object.entries(result?.modelUsage || {})
      .map(([m, u]) => [m, Number(u?.costUSD) || 0])),
    primaryModelCostUsd: Number(result?.modelUsage?.[model]?.costUSD) || null,
    gateDeliveredChars,
    numTurns: Number.isFinite(result?.num_turns) ? result.num_turns : null,
    usage, tokenActivity: tokenActivity(usage),
    tokenActivityExCacheRead: tokenActivity(usage) - (Number(usage.cache_read_input_tokens) || 0),
    toolCalls: toolIds.size, toolCounts, readPaths, answer,
    sessionId: result?.session_id || sessionIdFromEvents || null,
  };
}

// git worktree 준비. 동시성 워커가 아니라 설정 단계에서 순차로 만든다 — 같은 저장소의 .git
// 메타데이터에 여러 worktree add가 동시에 쓰면 경합할 수 있다.
function makeWorktree(wtDir) {
  fs.rmSync(wtDir, { recursive: true, force: true });
  const add = spawnSync('git', ['worktree', 'add', '--detach', wtDir, 'HEAD'], { cwd: k8sRepoDir, encoding: 'utf8' });
  if (add.status !== 0) throw new Error(`worktree add 실패(${wtDir}): ${add.stderr}`);
  spawnSync('git', ['sparse-checkout', 'init', '--cone'], { cwd: wtDir, encoding: 'utf8' });
  const sc = spawnSync('git', ['sparse-checkout', 'set', sparsePath], { cwd: wtDir, encoding: 'utf8' });
  if (sc.status !== 0) throw new Error(`sparse-checkout 실패(${wtDir}): ${sc.stderr}`);
}
function removeWorktree(wtDir) {
  spawnSync('git', ['worktree', 'remove', '--force', wtDir], { cwd: k8sRepoDir, encoding: 'utf8' });
}

// 배치 즉시 트리거(bench-bundles.mjs와 같은 경로 — sweep 건너뛰고 raw에 직접 심어 batch.mjs를
// 서브프로세스로 호출). bin/batch.mjs는 export가 없어(top-level await) import로 재사용 불가하다.
function plantAndBatch(okfHome, transcriptPath, usageFile) {
  const paths = okfPaths(okfHome);
  fs.mkdirSync(paths.raw, { recursive: true });
  fs.copyFileSync(transcriptPath, path.join(paths.raw, `2026-07-16--k8s-chain--${crypto.randomUUID()}.jsonl`));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'batch.mjs')], {
    env: { ...process.env, OKF_HOME: okfHome, OKF_BENCH_USAGE_FILE: usageFile, OKF_BENCH_SKIP_SWEEP: '1' },
    cwd: okfHome, encoding: 'utf8', timeout: 20 * 60_000,
  });
  if (r.status !== 0) throw new Error(`batch 실패: ${String(r.stderr).slice(0, 500)}`);
}

// 실제 transcript 회수(bench-knowledge.mjs와 같은 경로 — 복사가 아니라 이동해 사용자의 진짜
// 번들 sweep이 이 벤치 세션을 지식으로 오인하는 오염을 원천 차단한다).
function claimTranscript(sessionId, cwd, outPath) {
  const projects = path.join(os.homedir(), '.claude', 'projects');
  // Claude Code의 실제 슬러그 규칙은 '/'만이 아니라 영숫자가 아닌 모든 문자('.', '_' 포함)를
  // '-'로 바꾼다(실측으로 확인 — path.resolve().replace(/\//g,'-')만으로는 '.claude',
  // 'side_project'처럼 점/언더스코어가 든 경로에서 실제 슬러그와 어긋난다. v3의
  // bench-okf.mjs도 같은 패턴을 쓰지만 v3의 대상 경로엔 점/언더스코어가 없어 우연히 맞았다).
  const slug = path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-');
  const p = path.join(projects, slug, `${sessionId}.jsonl`);
  if (!fs.existsSync(p)) return null;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.renameSync(p, outPath);
  return outPath;
}

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

const records = [];
const startedAt = new Date().toISOString();
const partialPath = path.join(ROOT, 'docs', 'benchmarks', 'raw', `chain-partial-${startedAt.replace(/[:.]/g, '-')}.jsonl`);
fs.mkdirSync(path.dirname(partialPath), { recursive: true });
let judgeCost = 0;

// 1) 설정 단계: 체인×arm마다 격리된 cwd(worktree)를 순차로 준비한다. okf_chain은 별도
// OKF_HOME도 함께 준비한다(체인마다 완전히 분리 — 교차 체인 오염 차단).
fs.mkdirSync(workRoot, { recursive: true });
const units = [];
for (let c = 0; c < chains; c++) {
  for (const arm of ARMS) {
    const wtDir = path.join(workRoot, `wt-${arm}-${c}`);
    const okfHome = arm === 'okf_chain' ? path.join(workRoot, `home-${arm}-${c}`) : null;
    const usageFile = arm === 'okf_chain' ? path.join(workRoot, `usage-${arm}-${c}.jsonl`) : null;
    units.push({ chainIdx: c, arm, cwd: wtDir, okfHome, usageFile });
  }
}
process.stderr.write(`워크트리 준비 중 (${units.length}개)...\n`);
for (const u of units) {
  makeWorktree(u.cwd);
  if (u.okfHome) {
    fs.rmSync(u.okfHome, { recursive: true, force: true });
    ensureBootstrap(u.okfHome);
    fs.writeFileSync(okfPaths(u.okfHome).config, `---\nenabled: true\nbatch_interval_hours: 8760\nbatch_model: ${JSON.stringify(batchModel)}\nbatch_effort: "medium"\n---\n`);
    fs.rmSync(u.usageFile, { force: true });
  }
}
process.stderr.write('워크트리 준비 완료. 측정 시작.\n');

// 2) 측정 단계: 체인×arm 단위를 워커 풀로 병렬 실행한다. 체인 "내부"의 스텝은 반드시 순차다 —
// 배치가 끝나야 다음 스텝의 게이트가 갱신된 지식을 반영하기 때문이다. 체인 사이는 서로
// 독립이므로(각자 격리된 cwd/OKF_HOME) 병렬로 돌려도 안전하다.
let gateFlakeRetries = 0;
let done = 0;
const total = units.length * STEPS.length;

async function runOneChain(u) {
  for (const step of STEPS) {
    // 이 실험의 핵심 가드: 세션 전에 무조건 지운다. 지우지 않으면 Claude Code 자체의
    // cwd별 프로젝트 메모리가 우리 배치와 무관하게 스텝 사이에 지식을 누적할 수 있고,
    // 그러면 okf_chain의 개선이 우리가 통제한 배치 때문인지 이 메모리 때문인지 구분할 수
    // 없다. zero_base_chain도 같은 cwd를 스텝마다 재사용하므로 똑같이 지운다 — 안 지우면
    // "축적 없음" 컨트롤 자체가 거짓이 된다.
    clearProjectMemory(u.cwd);
    const gateBefore = u.okfHome ? gateTextOf(u.okfHome) : '';
    const nonce = crypto.randomUUID();
    const prompt = `[run ${nonce}]\n${INSTRUCTION}\n\n[질문]\n${step.question_ko}\n`;
    let m = await runClaude({ prompt, cwd: u.cwd, addDir: u.okfHome, okfHome: u.okfHome });
    if (u.okfHome && m.gateDeliveredChars === 0) {
      gateFlakeRetries++;
      process.stderr.write(`  ⚠ 게이트 미전달(0바이트) — 재시도: chain=${u.chainIdx} arm=${u.arm} step=${step.key}\n`);
      const retryNonce = crypto.randomUUID();
      m = await runClaude({ prompt: `[run ${retryNonce}]\n${INSTRUCTION}\n\n[질문]\n${step.question_ko}\n`, cwd: u.cwd, addDir: u.okfHome, okfHome: u.okfHome });
    }
    const answerText = m.answer ? `${m.answer.answer}\n근거: ${(m.answer.evidence || []).join(' | ')}` : '(응답 없음)';
    const { verdict, atoms, costUsd } = await judge(step, answerText);
    judgeCost += costUsd;

    let batchCostUsd = null;
    let conceptsAfterBatch = null;
    let transcriptClaimed = false;
    if (u.okfHome) {
      const sessionId = m.sessionId;
      if (sessionId) {
        const tPath = path.join(workRoot, `transcript-${u.arm}-${u.chainIdx}-${step.key}.jsonl`);
        const claimed = claimTranscript(sessionId, u.cwd, tPath);
        if (claimed) {
          transcriptClaimed = true;
          const before = fs.existsSync(u.usageFile) ? fs.readFileSync(u.usageFile, 'utf8').trim().split('\n').filter(Boolean).length : 0;
          plantAndBatch(u.okfHome, claimed, u.usageFile);
          const rows = fs.existsSync(u.usageFile) ? fs.readFileSync(u.usageFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
          batchCostUsd = Number(rows.slice(before).reduce((s, x) => s + (Number(x.total_cost_usd) || 0), 0).toFixed(4));
          conceptsAfterBatch = conceptFiles(u.okfHome).length;
          fs.rmSync(tPath, { force: true });
        } else {
          process.stderr.write(`  ⚠ transcript 회수 실패: chain=${u.chainIdx} step=${step.key} sessionId=${sessionId}\n`);
        }
      } else {
        process.stderr.write(`  ⚠ session_id 없음(배치 못 함): chain=${u.chainIdx} step=${step.key}\n`);
      }
    }
    const gateAfter = u.okfHome ? gateTextOf(u.okfHome) : '';

    const row = sanitize({
      chainIdx: u.chainIdx, arm: u.arm, step: step.key, order: step.order, nonce,
      gateBytesBefore: Buffer.byteLength(gateBefore),
      gateBytesAfter: Buffer.byteLength(gateAfter),
      gateChangedThisStep: gateBefore !== gateAfter,
      transcriptClaimed,
      batchCostUsd, conceptsAfterBatch,
      measurement: m,
      grade: {
        correct: verdict?.correct ?? null, admittedUnknown: verdict?.admitted_unknown ?? null,
        reason: verdict?.reason ?? null, atoms,
      },
    });
    records.push(row);
    done++;
    try { fs.appendFileSync(partialPath, `${JSON.stringify(row)}\n`); } catch { /* 진행 방해 안 함 */ }
    process.stderr.write(`[${done}/${total}] chain${u.chainIdx}/${u.arm}/${step.key} correct=${row.grade.correct} 원자=${atoms?.correct}/${atoms?.total} $${(m.totalCostUsd || 0).toFixed(4)} gateBefore=${row.gateBytesBefore}B\n`);
  }
}

const queue = [...units];
let idx = 0;
async function worker() {
  while (idx < queue.length) {
    const u = queue[idx++];
    await runOneChain(u);
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));

// 3) 정리: worktree는 제거한다. OKF_HOME(체인 지식 상태)은 남긴다 — .bench-chain/은
// gitignore됐고, 리포트 단계에서 감사용으로 일부를 docs/benchmarks/에 선별 커밋한다.
for (const u of units) removeWorktree(u.cwd);

// 모델 믹스 가드(v3와 동일 로직 — haiku가 내부 작업에 붙는 건 정상, 조건별 비주모델 비중이
// 임계값을 넘을 때만 중단한다).
const MODEL_MIX_THRESHOLD = Number(process.env.OKF_BENCH_MIX_THRESHOLD || 0.15);
function assertNoModelMixConfound() {
  const byArm = {};
  for (const r of records) {
    const acc = (byArm[r.arm] ||= { primary: 0, other: 0 });
    for (const [mdl, cst] of Object.entries(r.measurement.costByModel || {})) {
      if (mdl === model) acc.primary += cst; else acc.other += cst;
    }
  }
  const offenders = Object.entries(byArm)
    .map(([a, v]) => [a, v.other / (v.primary + v.other || 1)])
    .filter(([, share]) => share > MODEL_MIX_THRESHOLD);
  if (!offenders.length) return null;
  return `비주(non-primary) 모델이 어느 arm 비용의 ${(MODEL_MIX_THRESHOLD * 100).toFixed(0)}%를 넘었다 — `
    + `그 arm의 비용 비교가 모델 단가 아티팩트를 포함한다:\n${offenders.map(([a, s]) => `  ${a}: 비주모델 ${(s * 100).toFixed(1)}%`).join('\n')}`;
}
const modelMixConfound = assertNoModelMixConfound();

// 스텝별 요약(arm × step). 헤드라인은 이 표다 — okf_chain의 비용/도구호출이 step1→step4에서
// 실제로 내려가는지, zero_base_chain은 평평한지.
const byArmStep = {};
for (const r of records) {
  const key = `${r.arm}|${r.step}`;
  (byArmStep[key] ||= { arm: r.arm, step: r.step, order: r.order, rows: [] }).rows.push(r);
}
const summary = Object.fromEntries(Object.entries(byArmStep).map(([k, c]) => {
  const correct = c.rows.filter((r) => r.grade.correct === true);
  return [k, {
    arm: c.arm, step: c.step, order: c.order, runs: c.rows.length,
    correct: correct.length,
    censored: c.rows.filter((r) => r.measurement.censored).length,
    atomsCorrect: c.rows.reduce((s, r) => s + (r.grade.atoms?.correct || 0), 0),
    atomsTotal: c.rows.reduce((s, r) => s + (r.grade.atoms?.total || 0), 0),
    atomsContradicted: c.rows.reduce((s, r) => s + (r.grade.atoms?.contradicted || 0), 0),
    costUsdCorrectOnly: distribution(correct.map((r) => r.measurement.totalCostUsd)),
    costUsdAll: distribution(c.rows.map((r) => r.measurement.totalCostUsd)),
    primaryModelCostUsdCorrectOnly: distribution(correct.map((r) => r.measurement.primaryModelCostUsd)),
    toolCalls: distribution(c.rows.map((r) => r.measurement.toolCalls)),
    turns: distribution(c.rows.map((r) => r.measurement.numTurns)),
    gateBytesBefore: c.arm === 'okf_chain' ? distribution(c.rows.map((r) => r.gateBytesBefore)) : null,
    gateChangedThisStep: c.arm === 'okf_chain' ? c.rows.filter((r) => r.gateChangedThisStep).length : null,
    batchCostUsd: c.arm === 'okf_chain' ? distribution(c.rows.map((r) => r.batchCostUsd)) : null,
    transcriptClaimed: c.arm === 'okf_chain' ? c.rows.filter((r) => r.transcriptClaimed).length : null,
  }];
}));

// 축적이 "진짜" 일어났다는 사실 검증(서사가 아니라 측정치로). step k+1의 gateBytesBefore
// 분포 중앙값이 step k보다 커야(또는 최소한 줄지 않아야) 실제 배치가 게이트에 반영된 것이다.
// 이게 깨지면(중앙값이 안 늘거나 줄면) "체인이 학습했다"는 이 실험의 전제 자체가 무너진다 —
// 조용히 넘기지 않고 meta에 기계적으로 남긴다.
const okfStepsOrdered = [...new Set(records.filter((r) => r.arm === 'okf_chain').map((r) => r.order))].sort((a, b) => a - b);
const gateGrowthTrend = okfStepsOrdered.map((o) => summary[`okf_chain|${STEPS.find((s) => s.order === o).key}`]?.gateBytesBefore?.p50 ?? null);
const gateGrewMonotonically = gateGrowthTrend.every((v, i) => i === 0 || v == null || gateGrowthTrend[i - 1] == null || v >= gateGrowthTrend[i - 1]);

// 손익분기 일반화(사전등록 v4): R*(총 세션) = M · C_ingest / Σ s_i, s_i = zero_base_chain
// step i 정답런 비용 p50 - okf_chain step i 정답런 비용 p50(스텝별로 페어링). 절감이 음수인
// 스텝은 그대로 음수로 합산한다 — 좋아 보이게 자르지 않는다.
const cIngest = summary['okf_chain|' + STEPS[STEPS.length - 1].key]
  ? STEPS.reduce((s, st) => s + (summary[`okf_chain|${st.key}`]?.batchCostUsd?.p50 ?? 0), 0)
  : null;
const perStepSaving = STEPS.map((st) => {
  const z = summary[`zero_base_chain|${st.key}`]?.costUsdCorrectOnly?.p50 ?? null;
  const o = summary[`okf_chain|${st.key}`]?.costUsdCorrectOnly?.p50 ?? null;
  return { step: st.key, order: st.order, zeroBaseCostUsd: z, okfCostUsd: o, savingUsd: z != null && o != null ? Number((z - o).toFixed(4)) : null };
});
const totalSaving = perStepSaving.reduce((s, x) => s + (x.savingUsd ?? 0), 0);
const chainBreakEven = {
  perStep: perStepSaving,
  totalSavingAcrossSteps: Number(totalSaving.toFixed(4)),
  cIngestUsd: cIngest != null ? Number(cIngest.toFixed(4)) : null,
  sessionsToBreakEven: cIngest != null && totalSaving > 0 ? Math.ceil(cIngest / totalSaving) : null,
  reason: totalSaving <= 0 ? 'okf_chain이 스텝 합산으로 더 비싸거나 같다 — 손익분기가 존재하지 않는다' : null,
  retractionGuard: '이 값을 번들 크기/concept 개수 축으로 다시 그리지 않는다 — 오직 M(스텝 수, 내용 고정) 축과 실제 재사용(세션) 축으로만 서술한다. v2가 철회된 이유가 바로 그 축 혼동이었다.',
  formula: 'ceil(체인 전체 실제 배치비용 합 / (스텝별 zero_base 정답런 p50 - okf_chain 정답런 p50)의 합)',
};

const out = {
  meta: {
    startedAt, finishedAt: new Date().toISOString(), model, effort, maxTurns,
    chains, arms: ARMS, steps: STEPS.map((s) => s.key),
    judgeModel, batchModel, concurrency,
    design: 'k8s_scheduler_progressive_chain',
    pins: chainFixture.pins,
    modelMixConfound, modelMixThreshold: MODEL_MIX_THRESHOLD,
    gateFlakeRetries,
    gateGrowthTrend, gateGrewMonotonically,
    gateGrowthNote: 'okf_chain 스텝별 gateBytesBefore 중앙값 추이(step1..stepN). 단조 증가(또는 최소 비감소)가 아니면 "체인이 실제로 학습했다"는 전제가 깨진 것 — 서사가 아니라 이 배열로 확인한다.',
    contaminationGuard: 'Claude Code cwd별 프로젝트 메모리를 매 스텝(런)마다 지운다 — 세션 사이의 유일한 지식 경로는 우리가 명시적으로 트리거한 OKF 배치뿐이어야 한다.',
    pretrainingLeakageCaveat: 'zero_base_chain의 각 스텝이 탐색(도구 호출) 거의 없이 정답을 맞히면 사전학습 암기 가능성을 의심해야 한다 — 이 raw의 toolCalls/turns 분포를 함께 봐야 한다(별도 사전학습 확률 프로브는 이번 라운드에 포함하지 않았다).',
    cachePrefixCaveat: 'okf_chain 세션들은 시스템 프롬프트 접두사가 매 스텝 동일하다 — provider-side prompt cache가 비용을 깎을 수 있고, 이는 "지식이 탐색을 줄여서"와는 다른 메커니즘이다. 이번 측정은 이 둘을 분리하지 않았다(향후 과제로 남긴다).',
    claudeVersion: spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout.trim(),
    node: process.version, platform: `${os.platform()} ${os.arch()}`,
    repoCommit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim(),
    judgeCostUsd: Number(judgeCost.toFixed(4)),
    measurementCostUsd: Number(records.reduce((s, r) => s + (r.measurement.totalCostUsd || 0), 0).toFixed(4)),
    batchCostTotalUsd: Number(records.reduce((s, r) => s + (r.batchCostUsd || 0), 0).toFixed(4)),
  },
  summary, chainBreakEven, records,
};

const rawDir = path.join(ROOT, 'docs', 'benchmarks', 'raw');
fs.mkdirSync(rawDir, { recursive: true });
const slug = startedAt.replace(/[:.]/g, '-');
const outPath = path.join(rawDir, `okf-chain-live-${slug}.json`);
fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(outPath);

if (modelMixConfound) {
  console.error(`\n중단: ${modelMixConfound}\n결과는 ${outPath}에 남겼습니다. arm 간 비용 비교로 쓰지 마십시오.`);
  process.exit(3);
}
if (!gateGrewMonotonically) {
  console.error(`\n경고: 게이트 바이트가 스텝을 거치며 단조 증가하지 않았습니다(${JSON.stringify(gateGrowthTrend)}). "체인이 실제로 학습했다"는 전제를 재검토하십시오.`);
}
if (gateFlakeRetries) {
  process.stderr.write(`\n주의: 게이트 미전달로 재시도한 셀이 ${gateFlakeRetries}건 있습니다(meta.gateFlakeRetries에 발행됨).\n`);
}
