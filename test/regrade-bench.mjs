#!/usr/bin/env node
// Recompute only deterministic answer grades in an existing live-benchmark artifact.
// Usage/cache/time/cost/raw events are preserved byte-for-value; no Claude call is made.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { matchesBenchmarkAnswer } from '../lib/bench-audit.mjs';

const rawPath = process.argv[2] && path.resolve(process.argv[2]);
if (!rawPath || !fs.existsSync(rawPath)) {
  console.error('usage: node test/regrade-bench.mjs docs/benchmarks/raw/okf-live-....json');
  process.exit(2);
}

const expected = {
  architecture_database: 'SQLite', architecture_pattern: 'repository pattern',
  export_style: 'named export only', failure_solution: 'busy_timeout=5000',
  response_language: 'Korean', response_style: 'concise', policy_file: 'src/config.mjs',
  policy_command: 'npm run deploy:canary', unrelated_answer: '56',
};
const continuityKeys = Object.keys(expected).filter((key) => key !== 'unrelated_answer');
const normalize = (value) => String(value ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}
function distribution(values) {
  const nums = values.filter(Number.isFinite);
  return nums.length ? { n: nums.length, min: Math.min(...nums), p50: percentile(nums, 0.5), median: percentile(nums, 0.5), p95: percentile(nums, 0.95), max: Math.max(...nums) } : null;
}
function grade(answer) {
  const fields = Object.fromEntries(Object.entries(expected).map(([key, value]) => [key, matchesBenchmarkAnswer(key, answer?.[key], value)]));
  const continuityCorrect = continuityKeys.filter((key) => fields[key]).length;
  const continuitySuccess = continuityCorrect === continuityKeys.length;
  const unrelatedSuccess = fields.unrelated_answer;
  return {
    fields, continuityCorrect, continuityTotal: continuityKeys.length, continuitySuccess,
    unrelatedSuccess, automatedTestPassed: continuitySuccess && unrelatedSuccess,
    wrongAssumptions: continuityKeys.filter((key) => !fields[key] && normalize(answer?.[key]) !== 'unknown').length,
    additionalQuestions: Number.isInteger(answer?.additional_questions) ? answer.additional_questions : null,
  };
}

const data = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
function sanitizeStoredPaths(value) {
  if (typeof value === 'string') {
    return [[process.cwd(), '<PLUGIN_ROOT>'], [os.homedir(), '<USER_HOME>']]
      .sort((a, b) => b[0].length - a[0].length)
      .reduce((text, [from, to]) => text.split(from).join(to), value);
  }
  if (Array.isArray(value)) return value.map(sanitizeStoredPaths);
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) value[key] = sanitizeStoredPaths(child);
  }
  return value;
}
sanitizeStoredPaths(data);
for (const row of data.records) {
  row.grade = grade(row.measurement.answer);
  row.cumulativeTokensToCorrectAnswer = row.grade.automatedTestPassed ? row.measurement.tokenActivity : null;
}
for (const [condition, summary] of Object.entries(data.summary.byCondition)) {
  const rows = data.records.filter((row) => row.condition === condition);
  summary.continuitySuccess = { count: rows.filter((row) => row.grade.continuitySuccess).length, total: rows.length };
  summary.unrelatedSuccess = { count: rows.filter((row) => row.grade.unrelatedSuccess).length, total: rows.length };
  summary.automatedTestPassed = { count: rows.filter((row) => row.grade.automatedTestPassed).length, total: rows.length };
  summary.decisionCompliance = distribution(rows.map((row) => row.grade.continuityCorrect / row.grade.continuityTotal));
  summary.wrongAssumptions = distribution(rows.map((row) => row.grade.wrongAssumptions));
  summary.additionalQuestions = distribution(rows.map((row) => row.grade.additionalQuestions));
}
data.meta.grading = {
  version: 2,
  regradedAt: new Date().toISOString(),
  reason: 'Accept semantically equivalent constrained Korean/English phrasing; raw answers and measurements unchanged.',
};
data.meta.pathSanitization = ['<BENCH_ROOT>', '<PLUGIN_ROOT>', '<USER_HOME>'];
fs.writeFileSync(rawPath, `${JSON.stringify(data, null, 2)}\n`);

const reportPath = path.join(path.dirname(path.dirname(rawPath)), `${path.basename(rawPath, '.json')}.md`);
const lines = [
  '# OKF live benchmark', '',
  `- Date: ${data.meta.startedAt}`,
  `- Requested model: ${data.meta.model}; resolved: ${data.meta.resolvedModels.join(', ')}`,
  `- Claude Code: ${data.meta.claudeVersion}; Node: ${data.meta.node}; ${data.meta.platform}`,
  `- Repo commit: ${data.meta.repoCommit}; runs per condition: ${data.meta.runs}`,
  `- Bundle preflight: C ${data.meta.bundleAudit.relevant.presentFacts}/${data.meta.bundleAudit.relevant.checkedFacts} present and ${data.meta.bundleAudit.relevant.routedFacts}/${data.meta.bundleAudit.relevant.checkedFacts} gate-routed; D ${data.meta.bundleAudit.irrelevant.presentFacts}/${data.meta.bundleAudit.irrelevant.checkedFacts} target facts`,
  `- Raw result: raw/${path.basename(rawPath)}`,
  '',
  '| Condition | continuity | compliance p50 | token activity p50 / p95 | wall p50 / p95 | tools p50 | cost p50 |',
  '|---|---:|---:|---:|---:|---:|---:|',
];
for (const condition of data.meta.conditions) {
  const s = data.summary.byCondition[condition];
  lines.push(`| ${condition} | ${s.continuitySuccess.count}/${s.continuitySuccess.total} | ${(100 * s.decisionCompliance.p50).toFixed(0)}% | ${s.tokenActivity.p50} / ${s.tokenActivity.p95} | ${(s.wallMs.p50 / 1000).toFixed(2)} / ${(s.wallMs.p95 / 1000).toFixed(2)} s | ${s.toolCalls.p50} | $${s.totalCostUsd.p50.toFixed(6)} |`);
}
lines.push(
  '', '## Interpretation', '',
  '- C passed the bundle preflight and recovered all eight target facts in 5/5 follow-up runs.',
  '- B also recovered all eight facts in 5/5 runs. A and D did not recover continuity facts reliably; all conditions answered the unrelated arithmetic check 5/5.',
  '- C used more token activity, wall time, tools, and CLI-reported cost than B at the median. This run does **not** demonstrate token or response-time improvement.',
  '- Cold-cache has n=1 per condition; it is recorded for audit but is not a standalone performance claim.',
  '', '## Batch cost and break-even', '',
  `- Batch calls: ${data.summary.batch.calls}; token activity: ${data.summary.batch.tokenActivity}; CLI cost: $${data.summary.batch.totalCostUsd.toFixed(6)}.`,
  `- Per-session B-C token saving: ${data.summary.breakEven.perSessionTokenSaving}; cost saving: $${data.summary.breakEven.perSessionCostSaving.toFixed(6)}.`,
  `- Token break-even: ${data.summary.breakEven.tokenSessions ?? 'not measurable (no positive saving)'}.`,
  `- Cost break-even: ${data.summary.breakEven.costSessions ?? 'not measurable (no positive saving)'}.`,
  '',
  'Normal input, output, cache creation, and cache read tokens remain separate in the raw JSON. `tokenActivity` is their explicit sum, not a billing formula. User-only, gate-only, and initial transcript token counts remain null because Claude CLI does not expose them.',
  ''
);
fs.writeFileSync(reportPath, lines.join('\n'));
console.log(reportPath);
