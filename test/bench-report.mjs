#!/usr/bin/env node
// 원시 결과 JSON을 사람이 읽는 보고서로 만든다. 사전등록한 반증 기준(R1~R5)을 코드가 기계적으로
// 판정한다 — 결과를 본 뒤에 유리하게 해석할 여지를 남기지 않기 위해서다.
//
// 실행: node test/bench-report.mjs docs/benchmarks/raw/okf-live-<slug>.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inPath = path.resolve(process.argv[2]);
const data = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const { meta, summary } = data;

const cells = Object.values(summary);
const pick = (scenario, condition, level) => cells.find((c) => c.scenario === scenario
  && c.condition === condition && (level == null || c.level === level));
const usd = (v) => (v == null ? 'n/a' : `$${v.toFixed(4)}`);
const cost = (c) => c?.costUsdCorrectOnly?.p50 ?? null;
const scenarioKeys = [...new Set(cells.map((c) => c.scenario))].sort();
const CONDITION_LABEL = {
  zero_base: '제로베이스 탐색', answer_sheet: '정답지', okf: 'OKF 지식축적',
  wrong_knowledge: '잘못된 지식축적', claude_md: 'CLAUDE.md',
};

// 완전 분리(complete separation): 한쪽의 모든 런이 다른 쪽의 모든 런보다 싼가. n=5에서 중앙값
// 차이는 우연히 나온다. 이 기준을 통과할 때만 "이겼다"고 쓴다.
function separated(a, b) {
  if (!a?.costUsdCorrectOnly || !b?.costUsdCorrectOnly) return null;
  return a.costUsdCorrectOnly.max < b.costUsdCorrectOnly.min;
}

const lines = [];
lines.push('# OKF benchmark', '');
lines.push(`- 실행: ${meta.startedAt} → ${meta.finishedAt}`);
lines.push(`- 모델: 요청 \`${meta.model}\` / 실제 해석 \`${meta.resolvedModels.join(', ') || '노출 안 됨'}\`${meta.modelMixDetected ? ' — **모델 믹스 감지됨: 조건 간 비용 비교는 아티팩트일 수 있다**' : ''}`);
lines.push(`- 채점자: \`${meta.judgeModel}\` (조건을 모르는 상태로 채점)`);
lines.push(`- Claude Code ${meta.claudeVersion}; Node ${meta.node}; ${meta.platform}`);
lines.push(`- 저장소 커밋: \`${meta.repoCommit.slice(0, 8)}\`; 조건별 ${meta.runs}회 반복, 런마다 nonce로 prompt cache 차단`);
lines.push(`- 대상(핀 고정): Slim \`${meta.pins.slim}\`, rust-lang/rfcs \`${meta.pins.rfcs}\``);
lines.push(`- 측정 비용 $${meta.measurementCostUsd} + 채점 $${meta.judgeCostUsd}`);
lines.push('', '설계·예측·반증 기준은 [사전등록 문서](pre-registration-2026-07-16.md)에 첫 유료 호출 전에 고정해 커밋했다.', '');

lines.push('## 번들 (실제 배치가 실제 세션에서 만든 지식)', '');
lines.push('| 대상 | 레벨 | concept | 시드 | 게이트 바이트 | 게이트 잘림 | 누적 배치 비용 |');
lines.push('|---|---:|---:|---:|---:|:--:|---:|');
for (const [t, rows] of Object.entries(meta.bundles)) {
  for (const r of rows) {
    lines.push(`| ${t} | L${r.level} | ${r.concepts} | ${r.seeds} | ${r.gateBytes} | ${r.gateTruncated ? '예' : '아니오'} | $${r.batchCostUsd} |`);
  }
}
lines.push('', '지식은 전부 실제 파이프라인이 만들었다: 핀 고정된 공개 저장소를 실제 `claude -p` 세션이 탐색 → 그 세션의 실제 Claude Code transcript → OKF raw → 실제 배치 ingest → concept → 실제 게이트. 손으로 쓴 concept은 없다.', '');

lines.push('## 시나리오별 결과', '');
lines.push('시나리오를 가로질러 평균내지 않는다. grep 한 번이면 끝나는 질문과 호출 체인을 따라가야 하는 질문은 다른 현상이고, 둘을 섞으면 시나리오 선택이 헤드라인을 결정한다.', '');
for (const key of scenarioKeys) {
  const rows = cells.filter((c) => c.scenario === key && (c.level == null || c.level === meta.referenceLevel));
  if (!rows.length) continue;
  const kind = rows[0].kind;
  const KIND_KO = { buried: '탐색이 비싼 질문(호출 체인 추적 필요)', cheap: '탐색이 싼 질문(grep 한 번)', stale: '지식이 낡은 질문(코드가 나중에 바뀜)' };
  lines.push(`### \`${key}\` — ${KIND_KO[kind] || kind}`, '');
  lines.push(`| 조건 | 정답 | 비용 p50 (정답런만) | 토큰활동 p50 | cache_read 제외 | 도구호출 p50 | 턴 p50 | 벽시계 p50 |`);
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const cond of ['zero_base', 'answer_sheet', 'okf', 'wrong_knowledge', 'claude_md']) {
    const c = rows.find((r) => r.condition === cond);
    if (!c) continue;
    lines.push(`| ${CONDITION_LABEL[cond]} | ${c.correct}/${c.runs} | ${usd(cost(c))} | ${c.tokenActivity?.p50 ?? 'n/a'} | ${c.tokenActivityExCacheRead?.p50 ?? 'n/a'} | ${c.toolCalls?.p50 ?? 'n/a'} | ${c.turns?.p50 ?? 'n/a'} | ${((c.wallMs?.p50 ?? 0) / 1000).toFixed(1)}s |`);
  }
  const okf = rows.find((r) => r.condition === 'okf');
  const zero = rows.find((r) => r.condition === 'zero_base');
  const cmd = rows.find((r) => r.condition === 'claude_md');
  const notes = [];
  if (okf) {
    notes.push(`OKF가 번들의 concept 파일을 실제로 Read한 런: ${okf.readTargetConcept}/${okf.runs}`);
    if (okf.gateAnswersAlone > 0) notes.push(`**주입된 게이트 텍스트만으로 이미 답이 나오는 셀이다(${okf.gateAnswersAlone}/${okf.runs}런).** 배치가 쓴 concept의 한 줄 설명이 목차가 아니라 결론 그 자체였다. 이 경우 OKF의 이득은 "필요한 것만 골라 읽어서"가 아니라 "이미 주입돼 있어서" 생긴 것이다 — 실제 OKF 동작이지만 구분해서 읽어야 한다.`);
  }
  const censored = rows.filter((r) => r.censored > 0).map((r) => `${CONDITION_LABEL[r.condition]} ${r.censored}건`);
  if (censored.length) notes.push(`턴 상한에 걸려 측정 불가(검열): ${censored.join(', ')}`);
  const cw = rows.filter((r) => r.confidentlyWrong > 0).map((r) => `${CONDITION_LABEL[r.condition]} ${r.confidentlyWrong}/${r.runs}`);
  if (cw.length) notes.push(`**자신있게 틀림**(high confidence로 오답): ${cw.join(', ')}`);
  if (okf && zero) {
    const sep = separated(okf, zero);
    notes.push(sep === true ? 'OKF의 모든 정답런이 제로베이스의 모든 정답런보다 쌌다(완전 분리).'
      : sep === false ? '분포가 겹친다 — 중앙값 차이만으로는 이겼다고 말하지 않는다.' : '정답런이 없어 비교 불가.');
  }
  if (okf && cmd) {
    const sep = separated(okf, cmd);
    notes.push(`vs CLAUDE.md: ${sep === true ? 'OKF가 완전 분리로 더 쌈' : sep === false ? '분포 겹침(분리 안 됨)' : '비교 불가'}`);
  }
  lines.push('', ...notes.map((n) => `- ${n}`), '');
}

lines.push('## 지식이 쌓일수록 (누적 축)', '');
lines.push(`레벨 = 번들에 쌓인 concept 수. 재는 시나리오는 \`slim_buried\`(탐색이 비싼 질문) 하나다.`);
lines.push('`제로베이스`는 레벨과 무관하므로 수평 기준선으로 같이 싣는다.', '');
const axisLevels = meta.levelAxis;
lines.push('| 레벨 | OKF 비용 p50 | OKF 정답 | CLAUDE.md 비용 p50 | CLAUDE.md 정답 | 제로베이스 비용 p50 (기준선) |');
lines.push('|---:|---:|---:|---:|---:|---:|');
const zeroRef = pick('slim_buried', 'zero_base', null);
for (const L of axisLevels) {
  const o = pick('slim_buried', 'okf', L);
  const c = pick('slim_buried', 'claude_md', L);
  if (!o && !c) continue;
  lines.push(`| L${L} | ${usd(cost(o))} | ${o ? `${o.correct}/${o.runs}` : '—'} | ${usd(cost(c))} | ${c ? `${c.correct}/${c.runs}` : '—'} | ${usd(cost(zeroRef))} |`);
}
lines.push('');

// 사전등록한 반증 기준을 코드가 판정한다.
lines.push('## 사전등록 반증 기준 판정', '');
const buried = scenarioKeys.filter((k) => cells.find((c) => c.scenario === k)?.kind === 'buried');
const verdicts = [];
{
  const fired = buried.every((k) => {
    const o = pick(k, 'okf', meta.referenceLevel); const z = pick(k, 'zero_base', null);
    return cost(o) != null && cost(z) != null && cost(o) >= cost(z);
  });
  verdicts.push(['R1', 'OKF 비용 ≥ 제로베이스 비용 (탐색이 비싼 시나리오 전부)', fired]);
}
{
  const fired = axisLevels.every((L) => {
    const o = pick('slim_buried', 'okf', L); const c = pick('slim_buried', 'claude_md', L);
    return cost(o) != null && cost(c) != null && cost(o) >= cost(c);
  });
  verdicts.push(['R2', 'OKF 비용 ≥ CLAUDE.md 비용 (측정한 모든 레벨에서)', fired]);
}
{
  const pts = axisLevels.map((L) => cost(pick('slim_buried', 'okf', L))).filter((v) => v != null);
  const crossed = axisLevels.some((L) => {
    const o = cost(pick('slim_buried', 'okf', L)); const c = cost(pick('slim_buried', 'claude_md', L));
    return o != null && c != null && o < c;
  });
  const rising = pts.length > 1 && pts.at(-1) >= pts[0];
  verdicts.push(['R3', '누적 곡선이 평탄/상승이고 CLAUDE.md와 교차 없음', rising && !crossed]);
}
{
  const st = scenarioKeys.filter((k) => cells.find((c) => c.scenario === k)?.kind === 'stale');
  const fired = st.some((k) => {
    const o = pick(k, 'okf', meta.referenceLevel); const z = pick(k, 'zero_base', null);
    if (!o || !z) return false;
    return (o.confidentlyWrong / o.runs) - (z.confidentlyWrong / z.runs) >= 0.2;
  });
  verdicts.push(['R4', '낡은 지식에서 OKF의 "자신있게 틀림"이 제로베이스보다 20%p 이상 높음', fired]);
}
lines.push('| 기준 | 내용 | 발동? |');
lines.push('|---|---|:--:|');
for (const [id, text, fired] of verdicts) lines.push(`| ${id} | ${text} | ${fired ? '**예 — 주장 반증됨**' : '아니오'} |`);
const anyFired = verdicts.some(([, , f]) => f);
lines.push('', anyFired
  ? '> 사전등록 기준 중 하나 이상이 발동했다. 이 실행은 주장을 지지하지 않는다.'
  : '> 사전등록한 반증 기준이 하나도 발동하지 않았다.', '');

lines.push('## 알려진 한계', '');
lines.push('- 저장소 2개, 언어 1개씩. 저장소 크기·언어 전반에 대한 일반화 주장이 아니다.');
lines.push('- 게이트 텍스트를 프롬프트 앞에 붙여 측정했다. 텍스트는 production `SessionStart` `additionalContext`와 동일하지만 전달 경로 자체는 측정 대상이 아니다.');
lines.push(`- 조건별 n=${meta.runs}. 작은 차이는 분해하지 못한다. 분포가 완전히 분리될 때만 "이겼다"고 썼다.`);
lines.push('- 벽시계 시간에는 네트워크 변동이 섞인다.');
lines.push(`- 게이트 캡(9,000바이트)에 도달한 레벨: ${Object.values(meta.bundles).flat().filter((b) => b.gateTruncated).length ? '있음' : '없음 — 인덱스 잘림 구간은 이번 실행에서 측정되지 않았다'}.`);
lines.push('');

const outPath = path.join(ROOT, 'docs', 'benchmarks', `${path.basename(inPath, '.json')}.md`);
fs.writeFileSync(outPath, `${lines.join('\n')}\n`);
console.log(outPath);
