#!/usr/bin/env node
// Opt-in live benchmark for continuity quality and token/time cost. This is deliberately not
// imported by smoke tests or CI: it makes paid Claude calls and requires the user's auth.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ensureBootstrap } from '../lib/bootstrap.mjs';
import { regenerateIndex } from '../lib/index-gen.mjs';
import { okfPaths } from '../lib/paths.mjs';
import { auditBenchmarkBundle, matchesBenchmarkAnswer } from '../lib/bench-audit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'bench', 'session-one.jsonl');
const LIVE = process.env.OKF_RUN_LIVE_BENCH === '1';
if (!LIVE) {
  console.error('유료 라이브 실행입니다. 명시적으로 OKF_RUN_LIVE_BENCH=1을 설정하세요.');
  process.exit(2);
}

const runs = Number(process.env.OKF_BENCH_RUNS || 5);
if (!Number.isInteger(runs) || runs < 5) {
  console.error('OKF_BENCH_RUNS는 통계 왜곡을 막기 위해 5 이상의 정수여야 합니다.');
  process.exit(2);
}

const model = process.env.OKF_BENCH_MODEL || 'sonnet';
const effort = process.env.OKF_BENCH_EFFORT || 'medium';
const maxTurns = Number(process.env.OKF_BENCH_MAX_TURNS || 8);
const perCallBudgetUsd = process.env.OKF_BENCH_MAX_BUDGET_USD || '0.50';
// 번들에 쌓인, 이번 질문과 무관한 지식의 개수. 실제 프로젝트에서 3개월이면 이런 결정이 수십 개
// 쌓인다. 이 축이 없으면 "지식이 누적될수록 OKF가 유리해진다"는 주장은 측정 자체가 불가능하다.
const fillerCount = Number(process.env.OKF_BENCH_FILLER || 0);
if (!Number.isInteger(fillerCount) || fillerCount < 0) {
  console.error('OKF_BENCH_FILLER는 0 이상의 정수여야 합니다.');
  process.exit(2);
}

// B_oracle: 기존 B. 정답 8개만 정확히 재설명한다 — 그 문자열을 쓰려면 이미 답을 알아야 하므로
//   사용자가 실제로 점유할 수 없는 조건이다. 상한선(upper bound)으로만 의미가 있어 이름을 바꿨다.
// B_realistic: 사용자는 다음 세션에 무엇을 물을지 모르므로 관련 있을 법한 지식을 전부 붙인다
//   (사람들이 CLAUDE.md에 하는 그것). 이것이 실제로 점유 가능한 비교군이다.
const conditions = ['A_no_memory', 'B_oracle', 'B_realistic', 'C_okf_enabled', 'D_irrelevant_okf'];
const expected = {
  architecture_database: 'SQLite',
  architecture_pattern: 'repository pattern',
  export_style: 'named export only',
  failure_solution: 'busy_timeout=5000',
  response_language: 'Korean',
  response_style: 'concise',
  policy_file: 'src/config.mjs',
  policy_command: 'npm run deploy:canary',
  unrelated_answer: '56',
};
const manualRestatement = `이전 세션에서 확정한 사실은 다음과 같습니다.
- database: SQLite
- architecture: repository pattern
- module export: named export only (default export 금지)
- SQLITE_BUSY 해결책: busy_timeout=5000
- 응답 언어와 스타일: Korean, concise
- 설정 변경 파일: src/config.mjs
- 배포 명령: npm run deploy:canary
`;

// 실제 프로젝트에서 몇 달이면 쌓이는, 이번 질문과 무관한 결정들. 이것들이 축이다: 사용자는
// 다음 세션에 무엇이 필요할지 모르므로 B_realistic에서는 전부 재설명해야 하고(선형 증가),
// C는 index에 한 줄씩만 실린 뒤 필요한 것만 읽는다.
const FILLER_TOPICS = [
  ['API 응답 필드는 snake_case로 직렬화한다', '프론트 요청으로 camelCase 대신 snake_case로 확정했다'],
  ['CI의 flaky 테스트는 재시도하지 않고 격리 큐로 보낸다', '재시도는 원인을 숨기므로 격리 후 원인을 남긴다'],
  ['로그 레벨은 운영에서 info, 개발에서 debug로 고정한다', 'warn 이상만 알림으로 승격한다'],
  ['PR은 리뷰어 1명 승인 + CI 통과 후 머지한다', '핫픽스도 예외 없이 같은 절차를 따른다'],
  ['이미지 업로드는 5MB로 제한한다', '초과분은 클라이언트에서 리사이즈 후 재시도한다'],
  ['타임존은 서버에서 항상 UTC로 저장한다', '표시 시점에만 KST로 변환한다'],
  ['외부 API 호출은 3초 타임아웃에 2회 재시도한다', '지수 백오프를 쓰고 5xx만 재시도한다'],
  ['마이그레이션은 롤백 스크립트가 있어야 머지된다', '롤백 불가 마이그레이션은 두 단계로 쪼갠다'],
];
function fillerConcept(i) {
  const [title, desc] = FILLER_TOPICS[i % FILLER_TOPICS.length];
  return { title: `${title} (사례 ${i + 1})`, desc: `${desc} (사례 ${i + 1})` };
}
const fillerList = Array.from({ length: fillerCount }, (_, i) => fillerConcept(i));
// B_realistic이 붙이는 것: 목표 사실 + 쌓인 무관 지식 전부. 무엇이 필요할지 모르니 다 붙인다.
const realisticRestatement = `${manualRestatement}${fillerList.map((f) => `- ${f.title}: ${f.desc}\n`).join('')}`;
const taskPrompt = `이것은 세션 연속성 벤치마크입니다. 아래 6개 유형을 모두 답하세요.
1. 이전 아키텍처 결정(database와 pattern)
2. 이전 코딩 규칙(export style)
3. 과거 SQLITE_BUSY 해결책
4. 사용자 응답 선호(language와 style)
5. 이전 파일·배포 정책(file과 command)
6. 위 기억과 무관한 산술: 7 * 8

모르는 값은 추측하지 말고 문자열 "unknown"을 쓰세요. 답을 얻기 위해 추가 질문이 필요하면
additional_questions를 그 개수로 기록하세요. 제공된 지식 게이트가 있으면 관련 concept 파일을
Read한 뒤 답하세요. JSON 스키마 외 텍스트는 출력하지 마세요.`;
const schema = {
  type: 'object',
  properties: {
    architecture_database: { type: 'string' }, architecture_pattern: { type: 'string' },
    export_style: { type: 'string' }, failure_solution: { type: 'string' },
    response_language: { type: 'string' }, response_style: { type: 'string' },
    policy_file: { type: 'string' }, policy_command: { type: 'string' },
    unrelated_answer: { type: 'string' }, additional_questions: { type: 'integer', minimum: 0 },
  },
  required: [...Object.keys(expected), 'additional_questions'], additionalProperties: false,
};

function tempDir(label) { return fs.mkdtempSync(path.join(os.tmpdir(), `okf-live-bench-${label}-`)); }
function writeConfig(home) {
  fs.writeFileSync(okfPaths(home).config, `---\nenabled: true\nbatch_interval_hours: 8760\nbatch_model: ${JSON.stringify(model)}\nbatch_effort: ${JSON.stringify(effort)}\n---\n`);
}
function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status}): ${String(result.stderr).slice(0, 500)}`);
  return result.stdout;
}
function gateContext(home) {
  const lock = okfPaths(home).lock;
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, startedEpochMs: Date.now() }));
  try {
    const output = runChecked(process.execPath, [path.join(ROOT, 'bin', 'session-start.mjs')], {
      env: { ...process.env, OKF_HOME: home }, input: '{}', cwd: ROOT,
    });
    return JSON.parse(output).hookSpecificOutput?.additionalContext || '';
  } finally {
    fs.rmSync(lock, { force: true });
  }
}
function tokenActivity(usage = {}) {
  const keys = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];
  return keys.reduce((sum, key) => sum + (Number.isFinite(usage[key]) ? usage[key] : 0), 0);
}
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}
function distribution(values) {
  const nums = values.filter(Number.isFinite);
  return nums.length ? { n: nums.length, min: nums[0] === undefined ? null : Math.min(...nums), p50: percentile(nums, 0.5), median: percentile(nums, 0.5), p95: percentile(nums, 0.95), max: Math.max(...nums) } : null;
}
function normalize(value) { return String(value ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' '); }
function grade(answer) {
  const fields = {};
  for (const [key, value] of Object.entries(expected)) fields[key] = matchesBenchmarkAnswer(key, answer?.[key], value);
  const continuityKeys = Object.keys(expected).filter((key) => key !== 'unrelated_answer');
  const continuitySuccess = continuityKeys.every((key) => fields[key]);
  const unrelatedSuccess = fields.unrelated_answer;
  return {
    fields,
    continuityCorrect: continuityKeys.filter((key) => fields[key]).length,
    continuityTotal: continuityKeys.length,
    continuitySuccess,
    unrelatedSuccess,
    automatedTestPassed: continuitySuccess && unrelatedSuccess,
    wrongAssumptions: continuityKeys.filter((key) => !fields[key] && normalize(answer?.[key]) !== 'unknown').length,
    additionalQuestions: Number.isInteger(answer?.additional_questions) ? answer.additional_questions : null,
  };
}
function extractAnswer(result) {
  if (result?.structured_output && typeof result.structured_output === 'object') return result.structured_output;
  const text = typeof result?.result === 'string' ? result.result : '';
  try { return JSON.parse(text); } catch {
    const match = /\{[\s\S]*\}/.exec(text);
    try { return match ? JSON.parse(match[0]) : null; } catch { return null; }
  }
}
function sanitize(value, benchRoot) {
  if (typeof value === 'string') {
    return [
      [benchRoot, '<BENCH_ROOT>'],
      [ROOT, '<PLUGIN_ROOT>'],
      [os.homedir(), '<USER_HOME>'],
    ].sort((a, b) => b[0].length - a[0].length)
      .reduce((text, [from, to]) => text.split(from).join(to), value);
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item, benchRoot));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, benchRoot)]));
  return value;
}

async function runClaude({ prompt, cwd, addDir, benchRoot }) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--safe-mode', '--no-session-persistence',
    '--model', model, '--effort', effort, '--max-turns', String(maxTurns), '--max-budget-usd', perCallBudgetUsd,
    '--permission-mode', 'dontAsk', '--tools', 'Read,Glob,Grep', '--allowedTools', 'Read,Glob,Grep',
    '--json-schema', JSON.stringify(schema)];
  if (addDir) args.push('--add-dir', addDir);
  const started = process.hrtime.bigint();
  let firstValidMs = null;
  let stderr = '';
  let pending = '';
  const events = [];
  const toolIds = new Set();
  const toolCounts = {};
  const child = spawn('claude', args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(prompt);
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.on('data', (chunk) => {
    pending += chunk;
    const lines = pending.split('\n'); pending = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      events.push(event);
      if (event.type === 'assistant') {
        const blocks = event.message?.content || [];
        if (firstValidMs == null && blocks.some((b) => b.type === 'text' || b.type === 'tool_use')) firstValidMs = Number(process.hrtime.bigint() - started) / 1e6;
        for (const block of blocks) {
          if (block.type !== 'tool_use' || toolIds.has(block.id)) continue;
          toolIds.add(block.id);
          toolCounts[block.name] = (toolCounts[block.name] || 0) + 1;
        }
      }
    }
  });
  const exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  if (pending.trim()) { try { events.push(JSON.parse(pending)); } catch { /* preserve stderr instead */ } }
  const wallMs = Number(process.hrtime.bigint() - started) / 1e6;
  const result = [...events].reverse().find((event) => event.type === 'result') || null;
  const usage = result?.usage && typeof result.usage === 'object' ? result.usage : {};
  return sanitize({
    exitCode, error: exitCode === 0 ? null : stderr.slice(0, 500), firstValidMs, wallMs,
    apiMs: Number.isFinite(result?.duration_api_ms) ? result.duration_api_ms : null,
    claudeDurationMs: Number.isFinite(result?.duration_ms) ? result.duration_ms : null,
    totalCostUsd: Number.isFinite(result?.total_cost_usd) ? result.total_cost_usd : null,
    models: Object.keys(result?.modelUsage || {}),
    numTurns: Number.isFinite(result?.num_turns) ? result.num_turns : null,
    retries: null,
    retriesReason: 'Claude CLI result does not expose transport/model retry counts.',
    usage, tokenActivity: tokenActivity(usage), toolCalls: [...toolIds].length, toolCounts,
    answer: extractAnswer(result), rawEvents: events,
    userInputTokens: null,
    userInputTokensReason: 'Claude CLI usage does not separate user prompt tokens from other non-cached input.',
    injectedContextTokens: null,
    injectedContextTokensReason: 'Claude CLI usage does not expose gate-only token counts.',
  }, benchRoot);
}

function setupProject(benchRoot) {
  const project = path.join(benchRoot, 'project');
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src', 'config.mjs'), 'export const placeholder = true;\n');
  fs.writeFileSync(path.join(project, 'README.md'), '# Neutral benchmark project\nNo prior decisions are stored here.\n');
  return project;
}
function setupOkf(benchRoot, project) {
  const cHome = path.join(benchRoot, 'okf-relevant');
  ensureBootstrap(cHome); writeConfig(cHome);
  const cPaths = okfPaths(cHome);
  fs.writeFileSync(cPaths.lock, JSON.stringify({ pid: process.pid, startedEpochMs: Date.now() }));
  runChecked(process.execPath, [path.join(ROOT, 'bin', 'session-end.mjs')], {
    env: { ...process.env, OKF_HOME: cHome }, cwd: project,
    input: JSON.stringify({ session_id: crypto.randomUUID(), transcript_path: FIXTURE, cwd: project }),
  });
  fs.rmSync(cPaths.lock, { force: true });
  const batchUsagePath = path.join(benchRoot, 'batch-usage.jsonl');
  runChecked(process.execPath, [path.join(ROOT, 'bin', 'batch.mjs')], {
    env: {
      ...process.env, OKF_HOME: cHome, OKF_BENCH_USAGE_FILE: batchUsagePath,
      OKF_BENCH_SKIP_SWEEP: '1',
    }, cwd: cHome,
    timeout: 20 * 60_000,
  });
  const dHome = path.join(benchRoot, 'okf-irrelevant');
  ensureBootstrap(dHome); writeConfig(dHome);
  fs.mkdirSync(path.join(dHome, 'preferences'), { recursive: true });
  fs.writeFileSync(path.join(dHome, 'preferences', 'irrelevant.md'), `---\ntype: preference\ntitle: 무관한 테마\ndescription: 이 벤치마크 질문과 관계없는 색상 선호\ntimestamp: 2026-07-15\n---\n대시보드 색상은 ocean blue를 선호한다.\n`);
  regenerateIndex(dHome);
  // 누적 시뮬레이션: batch가 목표 concept를 만든 뒤 무관한 지식을 번들에 쌓는다. 실제로는 여러
  // 세션이 각각 batch를 거치며 쌓이지만, 결과 번들 상태는 동일하고 유료 batch를 N번 돌릴 이유가
  // 없다. C가 읽어야 할 목표 concept는 batch가 만든 그대로다 — filler는 노이즈로만 존재한다.
  if (fillerCount > 0) {
    const fillerDir = path.join(cHome, 'decisions');
    fs.mkdirSync(fillerDir, { recursive: true });
    fillerList.forEach((f, i) => {
      fs.writeFileSync(
        path.join(fillerDir, `filler-${String(i).padStart(3, '0')}.md`),
        `---\ntype: decision\ntitle: ${f.title}\ndescription: ${f.desc}\ntimestamp: 2026-07-15\n---\n${f.desc}\n`
      );
    });
    regenerateIndex(cHome);
  }
  const batchUsage = fs.existsSync(batchUsagePath) ? fs.readFileSync(batchUsagePath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const cGate = gateContext(cHome);
  const dGate = gateContext(dHome);
  return {
    cHome, dHome, cGate, dGate, batchUsage,
    bundleAudit: {
      relevant: auditBenchmarkBundle(cHome, cGate),
      irrelevant: auditBenchmarkBundle(dHome, dGate),
      source: 'real SessionEnd capture -> isolated batch ingest -> SessionStart gate; no manual target concept seeding',
    },
  };
}

function summarize(records, batchUsage) {
  const byCondition = {};
  for (const condition of conditions) {
    const rows = records.filter((row) => row.condition === condition);
    byCondition[condition] = {
      runs: rows.length,
      continuitySuccess: { count: rows.filter((row) => row.grade.continuitySuccess).length, total: rows.length },
      unrelatedSuccess: { count: rows.filter((row) => row.grade.unrelatedSuccess).length, total: rows.length },
      decisionCompliance: distribution(rows.map((row) => row.grade.continuityCorrect / row.grade.continuityTotal)),
      wrongAssumptions: distribution(rows.map((row) => row.grade.wrongAssumptions)),
      additionalQuestions: distribution(rows.map((row) => row.grade.additionalQuestions)),
      tokenActivity: distribution(rows.map((row) => row.measurement.tokenActivity)),
      inputTokens: distribution(rows.map((row) => row.measurement.usage.input_tokens)),
      outputTokens: distribution(rows.map((row) => row.measurement.usage.output_tokens)),
      cacheCreationInputTokens: distribution(rows.map((row) => row.measurement.usage.cache_creation_input_tokens)),
      cacheReadInputTokens: distribution(rows.map((row) => row.measurement.usage.cache_read_input_tokens)),
      firstValidMs: distribution(rows.map((row) => row.measurement.firstValidMs)),
      wallMs: distribution(rows.map((row) => row.measurement.wallMs)),
      apiMs: distribution(rows.map((row) => row.measurement.apiMs)),
      toolCalls: distribution(rows.map((row) => row.measurement.toolCalls)),
      readCalls: distribution(rows.map((row) => row.measurement.toolCounts.Read || 0)),
      globCalls: distribution(rows.map((row) => row.measurement.toolCounts.Glob || 0)),
      grepCalls: distribution(rows.map((row) => row.measurement.toolCounts.Grep || 0)),
      totalCostUsd: distribution(rows.map((row) => row.measurement.totalCostUsd)),
      cacheState: {
        cold: {
          tokenActivity: distribution(rows.filter((row) => row.cacheState === 'cold').map((row) => row.measurement.tokenActivity)),
          wallMs: distribution(rows.filter((row) => row.cacheState === 'cold').map((row) => row.measurement.wallMs)),
        },
        warm: {
          tokenActivity: distribution(rows.filter((row) => row.cacheState === 'warm').map((row) => row.measurement.tokenActivity)),
          wallMs: distribution(rows.filter((row) => row.cacheState === 'warm').map((row) => row.measurement.wallMs)),
        },
      },
    };
  }
  const batchTokenActivity = batchUsage.reduce((sum, row) => sum + tokenActivity(row.usage), 0);
  const batchCostUsd = batchUsage.reduce((sum, row) => sum + (Number.isFinite(row.total_cost_usd) ? row.total_cost_usd : 0), 0);
  // 손익분기의 비교군은 B_realistic이다. B_oracle은 정답 8개만 붙이므로 그 문자열을 만들려면
  // 이미 답을 알아야 하고 — 즉 OKF가 없애려는 그 노동을 0원으로 계상한 조건이라, 사용자가
  // 점유할 수 없는 상한선이다. 상한선 대비 손익분기는 의미가 없다.
  const b = byCondition.B_realistic;
  const c = byCondition.C_okf_enabled;
  const d = byCondition.D_irrelevant_okf;
  const a = byCondition.A_no_memory;
  const perSessionTokenSaving = b.tokenActivity && c.tokenActivity ? b.tokenActivity.median - c.tokenActivity.median : null;
  const gateTokenOverhead = d.tokenActivity && a.tokenActivity ? Math.max(0, d.tokenActivity.median - a.tokenActivity.median) : null;
  const initialTokenCost = gateTokenOverhead == null ? null : batchTokenActivity + gateTokenOverhead;
  const perSessionCostSaving = b.totalCostUsd && c.totalCostUsd ? b.totalCostUsd.median - c.totalCostUsd.median : null;
  const gateCostOverhead = d.totalCostUsd && a.totalCostUsd ? Math.max(0, d.totalCostUsd.median - a.totalCostUsd.median) : null;
  const initialCostUsd = gateCostOverhead == null ? null : batchCostUsd + gateCostOverhead;
  return {
    byCondition,
    batch: { calls: batchUsage.length, tokenActivity: batchTokenActivity, totalCostUsd: batchCostUsd, raw: batchUsage },
    breakEven: {
      tokenFormula: 'ceil((batch token activity + irrelevant-gate median overhead) / (manual-restatement median token activity - OKF median token activity))',
      tokenSessions: initialTokenCost != null && perSessionTokenSaving > 0 ? Math.ceil(initialTokenCost / perSessionTokenSaving) : null,
      perSessionTokenSaving, gateTokenOverhead, initialTokenCost,
      costFormula: 'ceil((batch total_cost_usd + irrelevant-gate median cost overhead) / (manual-restatement median cost - OKF median cost))',
      costSessions: initialCostUsd != null && perSessionCostSaving > 0 ? Math.ceil(initialCostUsd / perSessionCostSaving) : null,
      perSessionCostSaving, gateCostOverhead, initialCostUsd,
    },
    caveats: [
      'tokenActivity is the explicit sum of input_tokens, output_tokens, cache_creation_input_tokens, and cache_read_input_tokens; original components remain separate.',
      'User-prompt-only and gate-only token counts are null because Claude CLI does not expose them separately; no tokenizer estimate is substituted.',
      'Wall time includes network/server variance. Small or high-variance differences must not be presented as improvements.',
    ],
  };
}

function summaryMarkdown(meta, summary, outputPath) {
  const lines = ['# OKF live benchmark', '', `- Date: ${meta.startedAt}`, `- Requested model: ${meta.model}`, `- Resolved model(s): ${meta.resolvedModels.join(', ') || 'not exposed'}`, `- Claude Code: ${meta.claudeVersion}`, `- Runs per condition: ${meta.runs}`, `- Official pricing checked: ${meta.officialPricing.checkedAt} (${meta.officialPricing.urls.join(', ')})`, `- Raw result: ${path.basename(outputPath)}`, '', '| Condition | continuity | token activity p50 / p95 | wall p50 / p95 | cost p50 |', '|---|---:|---:|---:|---:|'];
  for (const condition of conditions) {
    const s = summary.byCondition[condition];
    lines.push(`| ${condition} | ${s.continuitySuccess.count}/${s.continuitySuccess.total} | ${s.tokenActivity?.p50 ?? 'n/a'} / ${s.tokenActivity?.p95 ?? 'n/a'} | ${Math.round(s.wallMs?.p50 ?? 0)} / ${Math.round(s.wallMs?.p95 ?? 0)} ms | ${s.totalCostUsd?.p50 ?? 'n/a'} |`);
  }
  lines.push('', '## Break-even', '', `- Token sessions: ${summary.breakEven.tokenSessions ?? 'not measurable / no positive saving'}`, `- Cost sessions: ${summary.breakEven.costSessions ?? 'not measurable / no positive saving'}`, '', 'Cache creation/read and normal input remain separate in the raw JSON. User-only and gate-only token counts are not estimated.', '');
  return lines.join('\n');
}

const benchRoot = tempDir('run');
const startedAt = new Date().toISOString();
try {
  const claudeVersion = runChecked('claude', ['--version']).trim();
  const project = setupProject(benchRoot);
  const okf = setupOkf(benchRoot, project);
  const preflightReady = okf.bundleAudit.relevant.ready
    && !okf.bundleAudit.irrelevant.anyTargetFactPresent;
  if (!preflightReady) {
    const rawDir = path.join(ROOT, 'docs', 'benchmarks', 'raw');
    fs.mkdirSync(rawDir, { recursive: true });
    const slug = startedAt.replace(/[:.]/g, '-');
    const preflightPath = path.join(rawDir, `okf-live-preflight-failed-${slug}.json`);
    fs.writeFileSync(preflightPath, `${JSON.stringify({
      startedAt, model, effort, claudeVersion, bundleAudit: okf.bundleAudit,
      reason: 'C must contain and gate-route all target facts; D must contain none before follow-up calls.',
    }, null, 2)}\n`);
    throw new Error(`live benchmark preflight failed; audit: ${preflightPath}`);
  }
  const records = [];
  for (let repetition = 0; repetition < runs; repetition++) {
    const order = conditions.map((_, index) => conditions[(index + repetition) % conditions.length]);
    for (const condition of order) {
      const context = condition === 'B_oracle' ? manualRestatement
        : condition === 'B_realistic' ? realisticRestatement
          : condition === 'C_okf_enabled' ? okf.cGate
            : condition === 'D_irrelevant_okf' ? okf.dGate : '';
      const addDir = condition === 'C_okf_enabled' ? okf.cHome : condition === 'D_irrelevant_okf' ? okf.dHome : null;
      const prompt = `${context}\n${taskPrompt}`;
      const measurement = await runClaude({ prompt, cwd: project, addDir, benchRoot });
      const graded = grade(measurement.answer);
      records.push({
        repetition, cacheState: repetition === 0 ? 'cold' : 'warm', order, condition,
        promptUtf8Bytes: Buffer.byteLength(prompt), promptCharacters: [...prompt].length,
        userRestatementTokens: null,
        userRestatementTokensReason: 'Claude CLI does not expose user-only token boundaries.',
        cumulativeTokensToCorrectAnswer: graded.automatedTestPassed ? measurement.tokenActivity : null,
        measurement, grade: graded,
      });
      process.stderr.write(`[${records.length}/${runs * conditions.length}] ${condition}: ${records.at(-1).grade.continuityCorrect}/${records.at(-1).grade.continuityTotal}\n`);
    }
  }
  const summary = summarize(records, okf.batchUsage);
  const resolvedModels = [...new Set([
    ...records.flatMap((row) => row.measurement.models || []),
    ...okf.batchUsage.flatMap((row) => row.models || []),
  ])].sort();
  const meta = {
    startedAt, finishedAt: new Date().toISOString(), model, resolvedModels, effort, maxTurns, runs,
    conditions, claudeVersion, node: process.version, platform: `${os.platform()} ${os.arch()}`,
    bundleAudit: okf.bundleAudit,
    repoCommit: runChecked('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).trim(),
    officialPricing: {
      checkedAt: '2026-07-15',
      urls: [
        'https://www.anthropic.com/news/claude-sonnet-5',
        'https://www.anthropic.com/claude/haiku',
      ],
      note: 'Sonnet 5 introductory API list price through 2026-08-31 is USD 2/MTok input and USD 10/MTok output; Haiku 4.5 is USD 1/MTok input and USD 5/MTok output. Break-even uses CLI total_cost_usd, not a reconstructed list-price estimate.',
    },
    fixtureSha256: crypto.createHash('sha256').update(fs.readFileSync(FIXTURE)).digest('hex'),
    fixtureUtf8Bytes: fs.statSync(FIXTURE).size, fixtureTokens: null,
    fixtureTokensReason: 'Claude CLI does not expose token count for a transcript that is digested locally before batch ingest.',
  };
  const result = { meta, metricDefinitions: {
    tokenActivity: 'input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens',
    cumulativeTokensToCorrectAnswer: 'tokenActivity for a run when automatedTestPassed=true; null otherwise because the harness does not retry failed answers',
    firstValidMs: 'process start to first assistant text or tool_use stream event',
    wallMs: 'process start to CLI exit',
    automatedTestPassed: 'all eight continuity fields and the unrelated arithmetic assertion match expected values',
    userRestatementTokens: 'null; Claude CLI does not expose user-only token boundaries. promptUtf8Bytes and promptCharacters are recorded instead.',
    initialTranscriptTokens: 'null; the CLI does not expose a token count for the local transcript before digest.',
    gateTokens: 'null; the CLI does not expose gate-only token boundaries.',
  }, summary, records };
  const rawDir = path.join(ROOT, 'docs', 'benchmarks', 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  const slug = startedAt.replace(/[:.]/g, '-');
  const outputPath = path.join(rawDir, `okf-live-${slug}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(path.join(ROOT, 'docs', 'benchmarks', `okf-live-${slug}.md`), summaryMarkdown(meta, summary, outputPath));
  console.log(outputPath);
} finally {
  fs.rmSync(benchRoot, { recursive: true, force: true });
}
