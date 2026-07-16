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
//   - 답이 게이트 인덱스에 이미 있는지, concept 파일을 실제로 Read 했는지 런마다 기록한다.
//
// v3에서 고친 것 (docs/benchmarks/pre-registration-2026-07-16-v3.md):
//   - 이 자리에 "모델 ID를 고정하고 조건별로 갈리면 중단한다"고 적혀 있었다. 중단 코드는
//     존재한 적이 없다. 발행된 meta.modelMixDetected 는 두 실행 모두 true 였고 둘 다 완주했다.
//     주석이 독자에게 막았다고 말하는 동안 코드는 기록만 하고 지나갔다. 게다가 그 약속은
//     애초에 틀린 검사였다 — haiku 는 모든 조건에서 내부 작업용으로 함께 해석되므로 그대로
//     구현했다면 모든 실행이 중단됐을 것이다. 진짜 교란은 "조건마다 다른 모델"이다. v3는
//     조건별 모델 집합이 갈릴 때만 중단하고(assertNoModelMixConfound), 모델별 비용을
//     따로 발행한다(modelUsage.costUSD 는 늘 result 이벤트에 있었는데 v2가 키만 남기고 버렸다).
//   - 게이트를 프롬프트에 prepend 하지 않고 진짜 SessionStart 훅으로 전달한다.
//   - 정답을 원자 단위로 채점한다. v2는 5개 사실을 이진값 하나로 뭉갰다.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { okfPaths } from '../lib/paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.env.OKF_RUN_LIVE_BENCH !== '1') {
  console.error('유료 라이브 실행입니다. 명시적으로 OKF_RUN_LIVE_BENCH=1을 설정하세요.');
  process.exit(2);
}
// n은 조건에 따라 비대칭이다. 이건 손잡이가 아니라 설계다(사전등록 C8):
//   - 대조군(zero_base/okf/claude_md)이 모든 주장을 짊어진다 → n=15.
//   - 통제군(answer_sheet/wrong_knowledge)은 상·하한을 못박는 역할이라 검정력이 필요없다 → n=5.
// v2는 전부 n=5였고, v2의 README가 스스로 "n=5에서는 아무것도 분리되지 않는다"고 인정했다.
const contrastRuns = Number(process.env.OKF_BENCH_RUNS || 15);
const controlRuns = Number(process.env.OKF_BENCH_CONTROL_RUNS || 5);
if (!Number.isInteger(contrastRuns) || contrastRuns < 5 || !Number.isInteger(controlRuns) || controlRuns < 5) {
  console.error('OKF_BENCH_RUNS / OKF_BENCH_CONTROL_RUNS는 통계 왜곡을 막기 위해 5 이상의 정수여야 합니다.');
  process.exit(2);
}
const CONTRAST_CONDITIONS = new Set(['zero_base', 'okf', 'claude_md']);
const runsFor = (condition) => (CONTRAST_CONDITIONS.has(condition) ? contrastRuns : controlRuns);
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
// 전체 유료 실행 전에 한 시나리오만 돌려 하니스가 크래시 없이 도는지 확인할 때 쓴다.
const onlyKey = process.env.OKF_BENCH_ONLY_KEY || '';
if (onlyKey) scenarios.scenarios = scenarios.scenarios.filter((s) => s.key === onlyKey);
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

// 게이트를 진짜 프로덕션 경로로 전달하기 위한 settings. hooks/hooks.json과 같은 계약이되
// SessionStart만 등록한다 — SessionEnd를 등록하면 배치가 돈다.
// ${CLAUDE_PLUGIN_ROOT}는 플러그인 로더가 채우는 값이라 --settings 경로에선 안 뜬다. 절대경로로 박는다.
const benchSettingsPath = path.join(ROOT, 'test', '.bench-settings.json');
fs.writeFileSync(benchSettingsPath, `${JSON.stringify({
  hooks: {
    SessionStart: [{
      matcher: 'startup|resume|clear|compact',
      hooks: [{ type: 'command', command: `node ${JSON.stringify(path.join(ROOT, 'bin', 'session-start.mjs'))}`, timeout: 15 }],
    }],
  },
}, null, 2)}\n`);

async function runClaude({ prompt, cwd, addDir, okfHome }) {
  // v2는 --safe-mode로 사용자의 실제 OKF 플러그인을 차단하고, 게이트 텍스트는 프롬프트에
  // prepend 했다. 그래서 "게이트가 프로덕션 경로로 전달됐을 때도 같은가"를 영영 못 쟀다.
  // --setting-sources '' 는 user/project/local 설정을 안 읽어 사용자 플러그인을 배제하면서도
  // --settings 로 명시한 훅은 실행한다 — 격리와 실전달을 동시에 얻는다(설계 중 라이브 검증).
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
    '--setting-sources', '',
    '--model', model, '--effort', effort, '--max-turns', String(maxTurns), '--max-budget-usd', perCallBudgetUsd,
    '--permission-mode', 'dontAsk',
    // 도구 제한은 하니스가 강제한다. 프롬프트로 부탁하면 A가 거부당한 호출로 턴을 태워
    // 인위적으로 비싸진다.
    '--tools', 'Read,Glob,Grep,Bash',
    '--allowedTools', 'Read,Glob,Grep,Bash(git log:*),Bash(git show:*),Bash(git diff:*),Bash(git blame:*),Bash(git grep:*)',
    '--json-schema', JSON.stringify(schema)];
  // 게이트를 받는 조건에서만 훅을 건다. 나머지 조건은 훅 없이 돈다.
  const debugFile = okfHome ? path.join(os.tmpdir(), `okf-bench-dbg-${crypto.randomUUID()}.log`) : null;
  if (okfHome) args.push('--settings', benchSettingsPath, '--debug-file', debugFile);
  if (addDir) args.push('--add-dir', addDir);
  // 배치 억제: 스냅샷 config의 batch_interval_hours=8760이 1차 방어이고, 살아있는 pid를 가진
  // batch.lock이 2차다(lib/batch-gate.mjs의 isLockAlive). 둘 중 하나만 어긋나도 측정 도중
  // 진짜 배치가 떠서 예정에 없던 모델 비용이 나가고 번들이 변형된다 — 그래서 finally로 감싼다.
  const lockPath = okfHome ? okfPaths(okfHome).lock : null;
  if (lockPath) fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedEpochMs: Date.now() }));
  const started = process.hrtime.bigint();
  let firstValidMs = null;
  let pending = '';
  const events = [];
  const toolIds = new Set();
  const toolCounts = {};
  const readPaths = [];
  // OKF_BATCH=1은 넘기지 않는다. bin/session-start.mjs:105는 그 값을 보면 {}만 뱉고 리턴하므로,
  // 훅 경로로 바꾼 뒤에도 그대로 뒀다면 게이트가 0바이트로 전달되고 조용히 실패했을 것이다
  // (에러도 안 난다). 배치 억제는 위의 interval+lock이 맡는다.
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
  // 게이트가 실제로 모델까지 갔는지 센다. prepend 시절엔 자명해서 없던 계측이지만, 훅 경로에선
  // 필수다 — 설계 중 7번에 1번꼴로 additionalContext가 도착하지 않는 flake를 관측했고, 그때
  // 에러가 나지 않았다. 검증하지 않으면 flake 난 셀이 "OKF 오답"으로 집계된다.
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
    // 턴 상한에 걸린 런은 "틀림"이 아니라 "검열됨"이다. 따로 세어 보고한다.
    censored: result?.subtype === 'error_max_turns' || result?.num_turns >= maxTurns,
    firstValidMs, wallMs,
    apiMs: Number.isFinite(result?.duration_api_ms) ? result.duration_api_ms : null,
    totalCostUsd: Number.isFinite(result?.total_cost_usd) ? result.total_cost_usd : null,
    models: Object.keys(result?.modelUsage || {}),
    // v2는 여기서 Object.keys()만 남기고 값을 버렸다. 그래서 "모델 믹스는 고정할 수 없다"가
    // 한계로 남았고, 사후에 정산할 방법도 사라졌다. modelUsage[m].costUSD 는 처음부터
    // result 이벤트에 있었다. 이제 통째로 보존해서 sonnet 단독 비용을 총비용 옆에 싣는다.
    modelUsage: result?.modelUsage && typeof result.modelUsage === 'object' ? result.modelUsage : {},
    costByModel: Object.fromEntries(Object.entries(result?.modelUsage || {})
      .map(([m, u]) => [m, Number(u?.costUSD) || 0])),
    primaryModelCostUsd: Number(result?.modelUsage?.[model]?.costUSD) || null,
    gateDeliveredChars,
    numTurns: Number.isFinite(result?.num_turns) ? result.num_turns : null,
    usage, tokenActivity: tokenActivity(usage),
    tokenActivityExCacheRead: tokenActivity(usage) - (Number(usage.cache_read_input_tokens) || 0),
    toolCalls: toolIds.size, toolCounts, readPaths, answer,
  };
}

// 채점자는 조건을 모른다. 어떤 조건의 답인지 알면 무의식적으로 봐준다.
//
// v3에서 바뀐 것: 정답을 원자 단위로 나눠 각각 독립 판정한다. v2는 5개 사실을 이진값 하나로
// 뭉개고 "부분적으로만 맞으면 틀린 것"이라고 지시했다. 그래서 rfcs_policy에서 원자 1~4를
// 맞히고 5만 틀린 런이 0개 맞힌 런과 똑같이 집계됐고, 그 2/5가 "OKF의 정직한 실패"로 발행됐다.
//
// 주의: 부분점수는 전부-아니면-전무 대비 점수를 올리는 방향으로만 움직인다 — 즉 제품에
// 유리한 방향의 지표 변경이다. 그래서 원자 분해는 측정 전에 scenarios.json에 고정했고,
// v2 방식의 이진 점수(=모든 원자 정답)도 나란히 발행한다. 둘 중 하나만 싣지 않는다.
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

async function judge(scenario, answerText) {
  const atomList = scenario.ground_truth_atoms || [];
  if (!atomList.length) throw new Error(`시나리오 ${scenario.key}에 ground_truth_atoms가 없습니다 — 원자 분해는 측정 전에 고정되어야 합니다.`);
  const prompt = `당신은 채점자입니다. 아래 응답이 정답의 각 항목을 담고 있는지 항목별로 독립 판정하세요.
표현이 다르거나 더 자세한 것은 상관없습니다. 각 항목의 핵심 사실이 맞는지만 봅니다.

각 항목의 status:
- "correct": 응답이 그 사실을 담고 있고 정답과 일치한다.
- "absent": 응답이 그 사실을 언급하지 않았거나, 모른다/기록되어 있지 않다고 했다.
- "contradicted": 응답이 그 사실과 어긋나는 주장을 했다.

주의: 어떤 사실을 "모르겠다"고 말한 것은 absent 이지 correct 가 아닙니다. 그 사실을 언급은
했으나 내용이 틀리면 contradicted 입니다.

[질문]
${scenario.question_ko}

[정답 — 핀 고정된 소스에서 직접 검증됨]
${scenario.ground_truth}

[채점할 항목]
${atomList.map((a) => `- ${a.id}: ${a.fact}`).join('\n')}

[채점할 응답]
${answerText}

admitted_unknown 은 응답이 전체적으로 "모른다/못 찾았다"고 인정한 경우에만 true 입니다.`;
  const { value, costUsd } = await runJudge(prompt, ATOM_SCHEMA);
  const byId = Object.fromEntries((value?.atoms || []).map((a) => [a.id, a]));
  // 채점자가 항목을 빠뜨리면 absent로 둔다 — 빠뜨린 항목을 정답으로 세면 점수가 공짜로 오른다.
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
    // v2 방식의 이진 점수. 지표 변경으로 결과가 좋아진 게 아님을 보이려면 이게 같이 있어야 한다.
    verdict: {
      correct: correctAtoms === atoms.length,
      admitted_unknown: value?.admitted_unknown === true,
      reason: atoms.filter((a) => a.status !== 'correct').map((a) => `${a.id}=${a.status}: ${a.reason}`).join(' | ') || '모든 항목 정답',
    },
    costUsd,
  };
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
// LEVEL_AXIS 는 v3에서 없앴다. meta에 남겨두면 재지도 않은 축을 쟀다고 읽힌다.
const cells = [];
for (const s of scenarios.scenarios) {
  for (const condition of ['zero_base', 'answer_sheet', 'okf', 'wrong_knowledge', 'claude_md']) {
    cells.push({ scenario: s, condition, level: condition === 'zero_base' || condition === 'answer_sheet' ? null : REFERENCE_LEVEL });
  }
}
// 레벨 축(비용 곡선)은 v3에서 폐기했다(사전등록 C9).
//
// v2는 이 축으로 "1→35 concept에서 OKF는 싸지고 CLAUDE.md는 2.2배 비싸진다. 곡선이 갈라진다"를
// 발행했다. 그 곡선은 정답런 3·2·5·3·2·4개의 중앙값이었고 최저점은 2개의 중앙값이었다.
// 전 구간 분포가 겹쳤고, 같은 README가 두 문단 뒤에 "n=5에서는 아무것도 분리되지 않는다"고 적었다.
//
// 그리고 이 축이 실제로 재던 것은 지식 조직화가 아니라 lib/config.mjs:27 의 inject_max_lines:120
// 이다. v2는 게이트가 "1바이트만 늘었다"를 배치가 concept 14개를 한 줄로 접은 결과라고 설명했지만,
// bench-bundles.mjs 가 기록한 gateTruncated 는 정체가 시작되는 바로 그 지점에서 true다 —
// 예산 때문에 잘려나간 것이다.
//
// n을 올려 다시 재면 설정 파일에서 읽을 수 있는 숫자를 더 정밀하게 재는 데 돈을 쓰게 된다.
// 상한은 상한이라고 적고, 돈은 실제로 불확실한 주장에 쓴다.

// 셀이 어느 번들을 보는지 한 곳에서만 정한다. v2는 이 계산을 buildPrompt와 measureWorker에
// 각각 복제해뒀는데, 둘이 어긋나면 게이트와 --add-dir이 서로 다른 번들을 가리키게 된다.
function bundleDirOf(cell) {
  const s = cell.scenario;
  if (cell.condition === 'okf' || cell.condition === 'claude_md') return snapOf(s.target, cell.level).dir;
  if (cell.condition === 'wrong_knowledge') {
    // 크기를 맞춘, 전부 무관한 진짜 지식(다른 대상 저장소를 실제로 조사해 쌓인 concept).
    const other = s.target === 'slim' ? 'rfcs' : 'slim';
    return (snapOf(other, cell.level) || levelData[other].snapshots.at(-1)).dir;
  }
  return null;
}

function buildPrompt(cell, nonce) {
  const s = cell.scenario;
  const dir = bundleDirOf(cell);
  let context = '';
  let addDir = null;
  let okfHome = null;
  if (cell.condition === 'answer_sheet') {
    context = `이전 세션에서 확인한 사실:\n${s.ground_truth}\n\n`;
  } else if (cell.condition === 'okf' || cell.condition === 'wrong_knowledge') {
    // 게이트는 프롬프트에 붙이지 않는다 — 진짜 SessionStart 훅이 additionalContext로 넣는다.
    // OKF_HOME만 지정하면 훅이 그 번들을 읽는다.
    okfHome = path.join(bundleRoot, dir);
    addDir = okfHome;
  } else if (cell.condition === 'claude_md') {
    context = `${claudeMdTextOf(dir)}\n\n`;
  }
  // nonce 는 맨 앞에 둔다. prompt cache 는 접두사 기준이라 앞에 있어야 재사용을 끊는다.
  return {
    prompt: `[run ${nonce}]\n${context}${INSTRUCTION}\n\n[질문]\n${s.question_ko}\n`,
    addDir, okfHome,
  };
}

const records = [];
const startedAt = new Date().toISOString();
// 런마다 여기에 append 한다. 측정이 끝까지 못 돌아도(세션 타임아웃) 부분 결과를 건진다.
const partialPath = path.join(ROOT, 'docs', 'benchmarks', 'raw', `partial-${startedAt.replace(/[:.]/g, '-')}.jsonl`);
fs.mkdirSync(path.dirname(partialPath), { recursive: true });
let judgeCost = 0;
let done = 0;
const total = cells.reduce((s, c) => s + runsFor(c.condition), 0);

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
for (const cell of cells) for (let rep = 0; rep < runsFor(cell.condition); rep++) queue.push({ rep, cell });
let qi = 0;
let gateFlakeRetries = 0;

async function measureWorker() {
  while (qi < queue.length) {
    const { rep, cell } = queue[qi++];
    const nonce = crypto.randomUUID();
    const { prompt, addDir, okfHome } = buildPrompt(cell, nonce);
    let m = await runClaude({ prompt, cwd: targets[cell.scenario.target], addDir, okfHome });
    // 게이트를 받아야 하는 셀인데 0바이트로 도착했으면 그건 모델의 실패가 아니라 하니스의
    // 실패다. 그대로 집계하면 flake가 "OKF 오답"으로 둔갑한다. 재시도하되 횟수를 발행한다 —
    // 세어서 밝히지 않는 재시도는 보이지 않는 표본 선택이다.
    if (okfHome && m.gateDeliveredChars === 0) {
      gateFlakeRetries++;
      process.stderr.write(`  ⚠ 게이트 미전달(0바이트) — 재시도: ${cell.scenario.key}/${cell.condition}\n`);
      m = await runClaude({ prompt: buildPrompt(cell, crypto.randomUUID()).prompt, cwd: targets[cell.scenario.target], addDir, okfHome });
    }
    const answerText = m.answer ? `${m.answer.answer}\n근거: ${(m.answer.evidence || []).join(' | ')}` : '(응답 없음)';
    const { verdict, atoms, costUsd } = await judge(cell.scenario, answerText);
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
        atoms,
      },
    }));
    done++;
    const r = records.at(-1);
    // 런마다 JSONL로 append 한다. 측정이 중간에 죽어도(세션 타임아웃 등) 여기까지의 결과를
    // 건질 수 있다 — 유료 런을 통째로 날리지 않기 위한 안전장치다.
    try { fs.appendFileSync(partialPath, `${JSON.stringify(r)}\n`); } catch { /* 진행 방해 안 함 */ }
    process.stderr.write(`[${done}/${total}] ${cell.scenario.key}/${cell.condition}${cell.level ? `@L${cell.level}` : ''} correct=${r.grade.correct} 원자=${atoms?.correct}/${atoms?.total} $${(m.totalCostUsd || 0).toFixed(4)} tools=${m.toolCalls}\n`);
  }
}
await Promise.all(Array.from({ length: concurrency }, measureWorker));

const resolvedModels = [...new Set(records.flatMap((r) => r.measurement.models))].sort();

// v2는 여기서 기록만 하고 지나갔다. 파일 머리에는 "조건별로 갈리면 중단한다"고 적어놓고서.
//
// 다만 "조건별 모델 집합이 정확히 일치할 것"을 요구하면 안 된다 — 그건 v2가 약속한 그 틀린
// 검사다. haiku는 CLI가 내부 작업(탐색 많은 조건일수록 더)에 쓰므로 어느 조건엔 붙고 어느
// 조건엔 안 붙는 게 정상이고, 집합 일치를 요구하면 모든 실행이 중단된다("그대로 구현했다면
// 모두 중단").
//
// 진짜 교란은 haiku가 어느 조건에서 비용의 "유의미한" 비중을 차지해, 그 조건이 싸 보이는 게
// 지식이 아니라 haiku 단가 때문일 때다. 실측(slim_domain 스모크)에서 haiku 비중은 최대 4.7%였다.
// 그래서 임계값(기본 15%)을 넘는 조건이 있을 때만 중단한다. 그 미만이면 sonnet 단독 비용
// (primaryModelCostUsdCorrectOnly)으로 비교하면 되고, 그건 이미 발행한다.
const MODEL_MIX_THRESHOLD = Number(process.env.OKF_BENCH_MIX_THRESHOLD || 0.15);
function assertNoModelMixConfound() {
  const byCondition = {};
  for (const r of records) {
    const acc = (byCondition[r.condition] ||= { primary: 0, other: 0 });
    for (const [mdl, cst] of Object.entries(r.measurement.costByModel || {})) {
      if (mdl === model) acc.primary += cst; else acc.other += cst;
    }
  }
  const offenders = Object.entries(byCondition)
    .map(([c, v]) => [c, v.other / (v.primary + v.other || 1)])
    .filter(([, share]) => share > MODEL_MIX_THRESHOLD);
  if (!offenders.length) return null;
  return `비주(non-primary) 모델이 어느 조건 비용의 ${(MODEL_MIX_THRESHOLD * 100).toFixed(0)}%를 넘었다 — `
    + `그 조건의 비용 비교가 모델 단가 아티팩트를 포함한다:\n${
      offenders.map(([c, s]) => `  ${c}: 비주모델 ${(s * 100).toFixed(1)}%`).join('\n')}`;
}
const modelMixConfound = assertNoModelMixConfound();
// 임계값 미만이어도 조건별 비주모델 비중은 발행한다 — 독자가 직접 판단할 수 있어야 한다.
const nonPrimaryShareByCondition = Object.fromEntries(
  [...new Set(records.map((r) => r.condition))].map((c) => {
    const rows = records.filter((r) => r.condition === c);
    let primary = 0; let other = 0;
    for (const r of rows) for (const [mdl, cst] of Object.entries(r.measurement.costByModel || {})) {
      if (mdl === model) primary += cst; else other += cst;
    }
    return [c, Number((other / (primary + other || 1)).toFixed(4))];
  }),
);
const costByModelTotals = records.reduce((acc, r) => {
  for (const [mdl, cst] of Object.entries(r.measurement.costByModel || {})) acc[mdl] = Number(((acc[mdl] || 0) + cst).toFixed(4));
  return acc;
}, {});
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
    // 원자별 점수. v2의 이진 점수(correct)와 나란히 싣는다 — 부분점수는 제품에 유리한
    // 방향으로만 움직이는 지표 변경이므로, 둘 중 하나만 실으면 지표를 갈아서 이긴 게 된다.
    atomsCorrect: c.rows.reduce((s, r) => s + (r.grade.atoms?.correct || 0), 0),
    atomsTotal: c.rows.reduce((s, r) => s + (r.grade.atoms?.total || 0), 0),
    atomsContradicted: c.rows.reduce((s, r) => s + (r.grade.atoms?.contradicted || 0), 0),
    // 게이트를 훅으로 전달할 때 실제로 도착한 바이트. 0이면 재시도된 셀이다.
    gateDeliveredChars: distribution(c.rows.map((r) => r.measurement.gateDeliveredChars)),
    // 효율 비교는 정답인 런만으로 한다. 틀린 채 빨리 끝난 런을 "쌌다"고 세면 안 된다.
    costUsdCorrectOnly: distribution(correct.map((r) => r.measurement.totalCostUsd)),
    // sonnet 단독 비용. haiku가 섞인 만큼을 빼고 봐도 결론이 같은지 독자가 확인할 수 있다.
    primaryModelCostUsdCorrectOnly: distribution(correct.map((r) => r.measurement.primaryModelCostUsd)),
    costUsdAll: distribution(c.rows.map((r) => r.measurement.totalCostUsd)),
    tokenActivity: distribution(c.rows.map((r) => r.measurement.tokenActivity)),
    tokenActivityExCacheRead: distribution(c.rows.map((r) => r.measurement.tokenActivityExCacheRead)),
    cacheReadTokens: distribution(c.rows.map((r) => r.measurement.usage.cache_read_input_tokens)),
    wallMs: distribution(c.rows.map((r) => r.measurement.wallMs)),
    toolCalls: distribution(c.rows.map((r) => r.measurement.toolCalls)),
    turns: distribution(c.rows.map((r) => r.measurement.numTurns)),
  }];
}));

// 손익분기. 절감이 양수인 시나리오에서만 계산한다 — 그리고 번들을 만드는 데 실제로 든 배치
// 비용을 반드시 포함한다. 그걸 빼면 "세션당 $0.09 아낍니다"가 공짜처럼 들린다.
// 정책 시나리오는 제로베이스가 애초에 못 맞히므로 '절감'이 정의되지 않는다 — null로 둔다.
const breakEven = {};
for (const scen of [...new Set(cells.map((c) => c.scenario.key))]) {
  const z = summary[`${scen}|zero_base|-`];
  const o = summary[`${scen}|okf|${REFERENCE_LEVEL}`];
  const target = scenarios.scenarios.find((x) => x.key === scen)?.target;
  const bundleBatchUsd = levelData[target]?.snapshots.find((x) => x.requestedLevel === REFERENCE_LEVEL)?.cumulativeBatchCostUsd ?? null;
  const zc = z?.costUsdCorrectOnly?.p50 ?? null;
  const oc = o?.costUsdCorrectOnly?.p50 ?? null;
  const saving = zc != null && oc != null ? zc - oc : null;
  breakEven[scen] = {
    zeroBaseCostUsd: zc, okfCostUsd: oc, perSessionSavingUsd: saving,
    bundleBatchCostUsd: bundleBatchUsd,
    sessions: saving != null && saving > 0 && bundleBatchUsd != null ? Math.ceil(bundleBatchUsd / saving) : null,
    reason: saving == null
      ? (z && z.correct === 0
        ? '제로베이스가 한 번도 맞히지 못했다 — 아낄 비용 자체가 없다. 이 시나리오의 지표는 절감이 아니라 능력이다.'
        : '정답런이 없어 비교 불가')
      : saving <= 0 ? 'OKF가 더 비싸다 — 손익분기가 존재하지 않는다' : null,
    formula: 'ceil(번들을 만든 실제 배치 비용 / (제로베이스 정답런 비용 p50 - OKF 정답런 비용 p50))',
  };
}

const out = {
  meta: {
    startedAt, finishedAt: new Date().toISOString(), model, resolvedModels, effort, maxTurns,
    contrastRuns, controlRuns, contrastConditions: [...CONTRAST_CONDITIONS],
    judgeModel, referenceLevel: REFERENCE_LEVEL, concurrency,
    levelAxisRetired: 'v3는 레벨 비용 곡선을 재지 않는다(사전등록 C9). v2의 그 축은 lib/config.mjs:27 inject_max_lines:120 상한을 재고 있었다 — 설정 상수다.',
    modelMixDetected: resolvedModels.length > 1,
    modelMixConfound,
    modelMixThreshold: MODEL_MIX_THRESHOLD,
    nonPrimaryShareByCondition,
    costByModelTotals,
    // 게이트를 훅으로 전달하다 0바이트로 도착해 재시도한 횟수. 세지 않은 재시도는 보이지 않는
    // 표본 선택이므로 반드시 발행한다.
    gateFlakeRetries,
    gateDelivery: '진짜 SessionStart 훅(--setting-sources "" + --settings)이 additionalContext로 주입. v2는 프롬프트에 prepend 했다.',
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
    // 비용 숫자가 어디서 왔는지 밝힌다. 정가표로 재구성한 추정이 아니라 CLI가 보고한 값이다.
    costProvenance: {
      source: 'Claude CLI가 result 이벤트로 보고한 total_cost_usd. 정가표 기반 추정이 아니다.',
      modelMixCaveat: resolvedModels.length > 1
        ? `요청 모델은 ${model} 하나였으나 CLI가 ${resolvedModels.join(', ')}를 함께 해석했다. 조건 간 비용 비교에 이 아티팩트가 섞인다.`
        : '단일 모델로 해석됨',
      officialPricing: {
        checkedAt: '2026-07-16',
        urls: ['https://www.anthropic.com/news/claude-sonnet-5', 'https://www.anthropic.com/claude/haiku'],
        note: '참고용. 이 벤치마크의 비용은 CLI 보고값이며 이 정가표로 재계산하지 않는다.',
      },
    },
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
  summary, breakEven, records,
};
const rawDir = path.join(ROOT, 'docs', 'benchmarks', 'raw');
fs.mkdirSync(rawDir, { recursive: true });
const slug = startedAt.replace(/[:.]/g, '-');
const outPath = path.join(rawDir, `okf-live-${slug}.json`);
fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(outPath);

// 데이터를 먼저 쓰고 나서 실패한다. 교란이 있다고 이미 지불한 측정을 버리면 손해만 크고,
// 조용히 넘어가면 v2를 반복한다 — 파일에 남기고, 소리 내서 죽는다.
if (modelMixConfound) {
  console.error(`\n중단: ${modelMixConfound}\n결과는 ${outPath}에 남겼습니다. 조건 간 비용 비교로 쓰지 마십시오.`);
  process.exit(3);
}
if (gateFlakeRetries) {
  process.stderr.write(`\n주의: 게이트 미전달로 재시도한 셀이 ${gateFlakeRetries}건 있습니다(meta.gateFlakeRetries에 발행됨).\n`);
}
