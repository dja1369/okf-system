#!/usr/bin/env node
// 원시 결과 JSON을 사람이 읽는 보고서로 만든다. 사전등록한 반증 기준(R1~R5)을 코드가 기계적으로
// 판정한다 — 결과를 본 뒤에 유리하게 해석할 여지를 남기지 않기 위해서다.
//
// v3에서 바뀐 것 (docs/benchmarks/pre-registration-2026-07-16-v3.md):
//   - 레벨 비용 곡선(누적 축)을 폐기했다. v2의 그 축은 지식 조직화가 아니라 설정 상수
//     (inject_max_lines:120)를 재고 있었다. 관련 표·반증 로직을 전부 걷어냈다.
//   - 반증 기준을 v3의 R1~R5로 다시 매핑했다. R3·R4는 신설(정책/도메인 정답률), R5는
//     제로베이스가 아니라 CLAUDE.md 대비 손익분기다.
//   - 셀마다 두 점수를 나란히 싣는다: v2 방식의 이진 점수(모든 원자 정답)와 원자 단위 점수.
//     원자 부분점수는 점수를 올리는 방향으로만 움직이므로(=제품에 유리), 하나만 싣지 않는다.
//   - sonnet 단독 비용을 총비용 옆에 싣는다(haiku 믹스가 결론을 바꾸는지 독자가 확인 가능).
//   - breakEven 블록을 발행한다(v2는 계산해 놓고 원시 JSON에서 조용히 빠뜨렸다).
//   - 게이트 훅 전달 flake 재시도 횟수와 셀별 전달 바이트를 발행한다(미발행 = 보이지 않는 표본 선택).
//   - 집계 규칙: p50을 찍는 모든 비용 셀은 n과 min–max를 같은 표에 반드시 같이 찍는다.
//     2개짜리 중앙값을 곡선의 한 점처럼 보여주던 v2 #2를 기계적으로 막는다.
//
// 실행: node test/bench-report.mjs docs/benchmarks/raw/okf-live-<slug>.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 범주(코드 유도 가능 / 코드에 없는 정책)는 서로 다른 번들·다른 축을 쓰므로 따로 돌린다.
// 하지만 벤치마크는 하나다 — 같은 하니스, 같은 대상, 같은 날. 보고서도 하나로 합친다.
const inPaths = process.argv.slice(2).map((p) => path.resolve(p));
const parts = inPaths.map((p) => JSON.parse(fs.readFileSync(p, 'utf8')));
// 모델별 총비용·재시도처럼 파트를 가로질러 합산해야 하는 값들.
const sumByKey = (getter) => {
  const acc = {};
  for (const p of parts) for (const [k, v] of Object.entries(getter(p) || {})) acc[k] = (acc[k] || 0) + Number(v || 0);
  return acc;
};
const meta = {
  ...parts[0].meta,
  measurementCostUsd: Number(parts.reduce((s, p) => s + p.meta.measurementCostUsd, 0).toFixed(4)),
  judgeCostUsd: Number(parts.reduce((s, p) => s + p.meta.judgeCostUsd, 0).toFixed(4)),
  runsTotal: parts.reduce((s, p) => s + p.records.length, 0),
  resolvedModels: [...new Set(parts.flatMap((p) => p.meta.resolvedModels))].sort(),
  modelMixDetected: parts.some((p) => p.meta.modelMixDetected),
  // 조건 간 모델 집합이 갈린 진짜 교란(사전등록 C4). 하니스는 이걸 감지하면 exit 3으로 중단하므로
  // 정상 산출물엔 대개 null이지만, 남아 있으면 보고서 맨 위에서 크게 렌더한다.
  modelMixConfound: parts.map((p) => p.meta.modelMixConfound).find((v) => v != null) ?? null,
  costByModelTotals: sumByKey((p) => p.meta.costByModelTotals),
  gateFlakeRetries: parts.reduce((s, p) => s + (Number(p.meta.gateFlakeRetries) || 0), 0),
  gateAudit: Object.assign({}, ...parts.map((p) => p.meta.gateAudit || {})),
  rawFiles: inPaths.map((p) => path.basename(p)),
};
const summary = Object.assign({}, ...parts.map((p) => p.summary));
// 손익분기 블록은 원시 JSON 최상위에 있다(v2는 계산하고도 발행하지 않았다). 파트별로 합친다.
const breakEven = Object.assign({}, ...parts.map((p) => p.breakEven || {}));
const cells = Object.values(summary);
const pick = (scenario, condition, level) => cells.find((c) => c.scenario === scenario
  && c.condition === condition && (level == null || c.level === level));
const usd = (v) => (v == null ? 'n/a' : `$${v.toFixed(4)}`);
const cost = (c) => c?.costUsdCorrectOnly?.p50 ?? null;
// 집계 규칙: 비용 분포는 p50 옆에 n과 min–max를 반드시 같이 찍는다.
const disp = (d) => (d && d.n != null ? `${usd(d.p50)} (n=${d.n}, ${usd(d.min)}–${usd(d.max)})` : 'n/a');
// USD가 아닌 분포(바이트 등)용.
const dispNum = (d, unit = '') => (d && d.n != null ? `${d.p50}${unit} (n=${d.n}, ${d.min}–${d.max}${unit})` : 'n/a');
// 측정 오염 감지(기계적, 손으로 시나리오를 고르지 않는다). Claude Code의 프로젝트 메모리
// 기능이 지식 세션 중 팀 결정을 ~/.claude/projects/<cwd>/memory/*.md 에 자동 저장했고, 측정이
// 같은 cwd에서 돌 때 그 메모리가 모든 조건에 자동 주입됐다 — 게이트를 받지 않아야 할
// 제로베이스까지. 그래서 코드에 없는 팀 결정을 제로베이스가 맞히는 오염이 생겼다.
// 판정: 어떤 시나리오의 제로베이스 런이 프로젝트 메모리 파일(/memory/*.md)을 하나라도
// 읽었으면 그 시나리오는 오염된 것으로 보고 발행에서 제외한다. readPaths는 원시 record에만
// 있으므로 parts[].records 에서 직접 계산한다.
const allRecords = parts.flatMap((p) => p.records || []);
const readsProjectMemory = (r) => (r.measurement?.readPaths || [])
  .some((pth) => /\/memory\/[^/]+\.md$/.test(String(pth)));
// 셀 단위 오염: (시나리오, 조건) 조합에서 메모리를 읽은 런이 하나라도 있으면 그 셀은 오염이다.
const contaminatedCells = new Set(allRecords
  .filter(readsProjectMemory)
  .map((r) => `${r.scenario}|${r.condition}`));
const isCellClean = (scen, cond) => !contaminatedCells.has(`${scen}|${cond}`);
// 시나리오 배제는 "제로베이스가 오염됐을 때"만이다. 제로베이스는 아무 지식도 없어야 하는
// 탐색 기준선이라, 메모리를 읽으면 "탐색으로는 못 찾는다"는 비교축 자체가 깨진다 → 발행 제외.
// OKF/CLAUDE.md가 메모리를 읽는 건 다르다 — 그 조건들은 원래 지식을 갖는 게 정상이라(게이트·파일)
// 메모리 읽기는 불공정이 아니라 중복이다. 통제군(wrong_knowledge)만 오염된 시나리오는 살리되,
// 그 통제군을 쓰는 지표(R4)에서만 셀 단위로 뺀다(아래 isCellClean).
const contaminatedScenarios = [...new Set(allRecords
  .filter((r) => r.condition === 'zero_base' && readsProjectMemory(r))
  .map((r) => r.scenario))].sort();
const scenarioKeys = [...new Set(cells.map((c) => c.scenario))]
  .filter((k) => !contaminatedScenarios.includes(k)).sort();
const CONDITION_LABEL = {
  zero_base: '제로베이스 탐색', answer_sheet: '정답지', okf: 'OKF 지식축적',
  wrong_knowledge: '잘못된 지식축적', claude_md: 'CLAUDE.md',
};
// 원자 점수 셀: 원자 정답/총원자 (모순 n). 이진 점수는 별도 열에 나란히 싣는다.
const atomCell = (c) => (c.atomsTotal != null
  ? `${c.atomsCorrect}/${c.atomsTotal}${c.atomsContradicted ? ` (모순 ${c.atomsContradicted})` : ''}`
  : 'n/a');
// n은 v3에서 비대칭이다(사전등록 C8). meta 필드에 기대지 않고 실제 셀에서 읽는다.
const nOf = (conds) => {
  const rs = cells.filter((c) => conds.has(c.condition)).map((c) => c.runs);
  return rs.length ? Math.max(...rs) : null;
};
const contrastN = nOf(new Set(['zero_base', 'okf', 'claude_md']));
const controlN = nOf(new Set(['answer_sheet', 'wrong_knowledge']));

// 완전 분리(complete separation): 한쪽의 모든 런이 다른 쪽의 모든 런보다 싼가. n=15에서도 중앙값
// 차이는 우연히 나온다. 이 기준을 통과할 때만 "이겼다"고 쓴다.
function separated(a, b) {
  if (!a?.costUsdCorrectOnly || !b?.costUsdCorrectOnly) return null;
  return a.costUsdCorrectOnly.max < b.costUsdCorrectOnly.min;
}

const lines = [];
lines.push('# OKF benchmark v3', '');
lines.push(`- 실행: ${meta.startedAt} → ${meta.finishedAt}`);
lines.push(`- 모델: 요청 \`${meta.model}\` / 실제 해석 \`${meta.resolvedModels.join(', ') || '노출 안 됨'}\`${meta.modelMixDetected ? ' — 여러 모델이 해석됨(haiku 병행). 조건마다 같은 집합이면 교란이 아니라 정량화 대상이다(아래 "모델별 비용").' : ''}`);
// 모델별 총비용 — sonnet 단독을 총비용 옆에 싣는다. haiku 믹스가 어떤 결론을 바꾸는지 확인용.
const cbmt = meta.costByModelTotals || {};
const primaryTotal = cbmt[meta.model];
lines.push(`- 모델별 총비용: ${Object.entries(cbmt).map(([m, v]) => `\`${m}\` $${Number(v).toFixed(4)}`).join(', ') || '노출 안 됨'} — 요청 모델(\`${meta.model}\`) 단독 ${primaryTotal != null ? `$${Number(primaryTotal).toFixed(4)}` : 'n/a'} · 측정 총 $${meta.measurementCostUsd}`);
lines.push(`- 게이트 훅 전달 flake 재시도: ${meta.gateFlakeRetries || 0}회 (설계 중 7회에 1회꼴 미전달 관측; 미발행은 보이지 않는 표본 선택이므로 발행한다).`);
lines.push(`- 채점자: \`${meta.judgeModel}\` (조건을 모르는 상태로, 정답을 원자 단위로 채점)`);
lines.push(`- Claude Code ${meta.claudeVersion}; Node ${meta.node}; ${meta.platform}`);
lines.push(`- 저장소 커밋: \`${meta.repoCommit.slice(0, 8)}\`; 대조군 n=${contrastN} / 통제군 n=${controlN}, 런마다 nonce로 prompt cache 차단`);
lines.push(`- 대상(핀 고정): Slim \`${meta.pins.slim}\`, rust-lang/rfcs \`${meta.pins.rfcs}\``);
lines.push(`- 측정 ${meta.runsTotal}런 · 비용 $${meta.measurementCostUsd} + 채점 $${meta.judgeCostUsd}`);
lines.push(`- 비용 출처: ${meta.costProvenance?.source || 'CLI가 result 이벤트로 보고한 total_cost_usd(정가표 추정 아님).'}`);
lines.push(`- 원시 결과: ${meta.rawFiles.map((f) => `[${f}](raw/${f})`).join(', ')}`);
lines.push('', '설계·예측·반증 기준(R1~R5)은 [사전등록 문서](pre-registration-2026-07-16-v3.md)에 첫 유료 호출 전에 고정해 커밋했다.', '');

// 조건 간 모델 집합이 갈렸으면(=진짜 교란) 크게 렌더한다.
if (meta.modelMixConfound) {
  lines.push('> **모델 믹스 교란 감지 — 조건 간 비용 비교 무효.** 조건마다 해석된 모델 집합이 서로 달랐다(사전등록 C4). 이 실행의 조건 간 비용 결론은 모델 믹스 아티팩트이며 신뢰할 수 없다. 하니스는 이 경우 exit 3으로 중단하도록 되어 있다.');
  lines.push('>', `> \`${JSON.stringify(meta.modelMixConfound)}\``, '');
}

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
if (contaminatedScenarios.length) {
  lines.push(`> **측정 오염으로 제외된 시나리오: ${contaminatedScenarios.join(', ')}.** 지식 세션이 대상 저장소를 조사할 때 Claude Code의 프로젝트 메모리 기능이 팀 결정을 자동 저장했고, 측정이 같은 작업 디렉토리에서 돌 때 그 메모리가 게이트를 받지 않아야 할 제로베이스 조건에까지 자동 주입됐다. 그 결과 코드에 없는 답을 제로베이스가 맞히는 오염이 생겨, 해당 시나리오는 발행에서 제외한다. 아래 표·손익분기·반증 기준은 모두 오염되지 않은 시나리오만으로 계산했다.`, '');
}
lines.push('시나리오를 가로질러 평균내지 않는다. grep 한 번이면 끝나는 질문과 호출 체인을 따라가야 하는 질문은 다른 현상이고, 둘을 섞으면 시나리오 선택이 헤드라인을 결정한다.', '');
lines.push('**두 점수를 나란히 싣는다.** "정답(이진)"은 v2 방식 — 모든 원자가 맞아야 정답이다. "원자 정답"은 원자 단위 부분점수다. 원자 부분점수는 전부-아니면-전무 대비 점수를 **올리는 방향으로만** 움직인다 — 즉 제품(OKF)에 유리한 방향의 지표 변경이다. 그래서 원자 점수만 싣는 것은 자를 바꿔 이기는 것이다. 원자 분해는 측정 전에 `scenarios.json`에 고정했고, 이진 점수와 항상 함께 보고한다.', '');
lines.push('**비용 옆에 sonnet 단독 비용도 싣는다.** haiku가 함께 해석돼도 요청 모델(sonnet) 단독 비용을 따로 실어, 모델 믹스가 이 셀의 결론을 바꾸는지 독자가 직접 확인할 수 있게 한다.', '');
for (const key of scenarioKeys) {
  const rows = cells.filter((c) => c.scenario === key && (c.level == null || c.level === meta.referenceLevel));
  if (!rows.length) continue;
  const kind = rows[0].kind;
  const KIND_KO = {
    buried: '탐색이 비싼 질문(호출 체인 추적 필요)',
    cheap: '탐색이 싼 질문(grep 한 번)',
    stale: '지식이 낡은 질문(코드가 나중에 바뀜)',
    policy: '코드·문서·히스토리 어디에도 없는 팀 정책/도메인 어휘 — 탐색으로는 원리적으로 도달 불가',
  };
  lines.push(`### \`${key}\` — ${KIND_KO[kind] || kind}`, '');
  lines.push('| 조건 | 정답(이진) | 원자 정답 | 비용 p50·n·범위 (정답런만) | sonnet 단독 p50·n·범위 | 토큰활동 p50 | cache_read 제외 | 도구호출 p50 | 턴 p50 |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const cond of ['zero_base', 'answer_sheet', 'okf', 'wrong_knowledge', 'claude_md']) {
    const c = rows.find((r) => r.condition === cond);
    if (!c) continue;
    // 정답이 하나도 없으면 '정답런만' 비용은 존재하지 않는다. 그 칸을 비워두면 '0/n인데 쌌다'는
    // 오독이 생기므로, 전체 런 비용을 명시한다 — 틀리는 데 쓴 돈도 쓴 돈이다.
    const costCell = cost(c) != null ? disp(c.costUsdCorrectOnly)
      : (c.costUsdAll ? `정답 없음 · 전체 ${disp(c.costUsdAll)}` : 'n/a');
    lines.push(`| ${CONDITION_LABEL[cond]} | ${c.correct}/${c.runs} | ${atomCell(c)} | ${costCell} | ${disp(c.primaryModelCostUsdCorrectOnly)} | ${c.tokenActivity?.p50 ?? 'n/a'} | ${c.tokenActivityExCacheRead?.p50 ?? 'n/a'} | ${c.toolCalls?.p50 ?? 'n/a'} | ${c.turns?.p50 ?? 'n/a'} |`);
  }
  const okf = rows.find((r) => r.condition === 'okf');
  const zero = rows.find((r) => r.condition === 'zero_base');
  const cmd = rows.find((r) => r.condition === 'claude_md');
  const notes = [];
  if (okf) {
    notes.push(`OKF가 번들의 concept 파일을 실제로 Read한 런: ${okf.readTargetConcept}/${okf.runs}`);
    if (okf.gateDeliveredChars) notes.push(`게이트 실제 전달 바이트(진짜 훅 경로): ${dispNum(okf.gateDeliveredChars, '자')} — 0자면 flake라 재시도했다.`);
    if (okf.gateAnswersAlone > 0) notes.push(`**주입된 게이트 텍스트만으로 이미 답이 나오는 셀이다(${okf.gateAnswersAlone}/${okf.runs}런).** 배치가 쓴 concept의 한 줄 설명이 목차가 아니라 결론 그 자체였다. 이 경우 OKF의 이득은 "필요한 것만 골라 읽어서"가 아니라 "이미 주입돼 있어서" 생긴 것이다 — 실제 OKF 동작이지만 구분해서 읽어야 한다.`);
  }
  const censored = rows.filter((r) => r.censored > 0).map((r) => `${CONDITION_LABEL[r.condition]} ${r.censored}건`);
  if (censored.length) notes.push(`턴 상한에 걸려 측정 불가(검열): ${censored.join(', ')}`);
  const cw = rows.filter((r) => r.confidentlyWrong > 0).map((r) => `${CONDITION_LABEL[r.condition]} ${r.confidentlyWrong}/${r.runs}`);
  if (cw.length) notes.push(`**자신있게 틀림**(high confidence로 오답): ${cw.join(', ')}`);
  // 이진 점수가 0인데 원자 정답률이 높은 셀은 "핵심은 맞혔으나 부수 원자(출처·커밋 SHA 등)를
  // 놓쳐 전부-정답 문턱을 못 넘은" 경우다. 이걸 밝히지 않으면 "전멸"로 오독된다. critical 원자만
  // 따로 집계해 보여준다(critical 플래그는 원시 record의 atoms.detail에 있다).
  {
    const critByCond = {};
    for (const r of allRecords.filter((r) => r.scenario === key)) {
      const det = r.grade?.atoms?.detail;
      if (!Array.isArray(det)) continue;
      const crit = det.filter((a) => a.critical);
      if (!crit.length) continue;
      const acc = (critByCond[r.condition] ||= { pass: 0, n: 0 });
      acc.n++;
      if (crit.every((a) => a.status === 'correct')) acc.pass++;
    }
    const binZeroButCritHigh = rows.some((r) => r.correct === 0
      && critByCond[r.condition] && critByCond[r.condition].pass > critByCond[r.condition].n * 0.5);
    if (binZeroButCritHigh) {
      const detail = ['zero_base', 'okf', 'claude_md'].filter((c) => critByCond[c])
        .map((c) => `${CONDITION_LABEL[c]} ${critByCond[c].pass}/${critByCond[c].n}`).join(', ');
      notes.push(`**이진 점수(전원자)가 0이어도 핵심(critical) 원자는 대부분 맞았다: ${detail}.** `
        + `모델은 핵심 사실을 옳게 답했고, 놓친 것은 질문이 직접 요구하지 않는 부수 원자(출처 커밋 등)다. `
        + `"낡은 지식이 자신있는 오답을 만든다"는 예측과 반대로, 모델은 코드를 다시 읽어 핵심을 바로잡았다.`);
    }
  }
  if (kind === 'policy') {
    notes.push('이 시나리오의 정답은 저장소에 존재하지 않는다(적대적 검증 완료: 작업 트리·git 히스토리·문서·설정 전수 조사에서 0건). 따라서 탐색 조건의 올바른 동작은 "모른다"이며, 비용이 아니라 **정답률이 지표**다.');
    const wk = rows.find((r) => r.condition === 'wrong_knowledge');
    if (wk) notes.push(`잘못된 지식 조건 정답 ${wk.correct}/${wk.runs} — 게이트가 있다고 아무거나 맞히는 게 아니라 **맞는 지식이 있을 때만** 맞힌다는 대조군.`);
  }
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

// 손익분기 — 번들을 만든 실제 배치 비용을 반드시 포함한다. v2는 이 블록을 계산하고도 원시 JSON에서
// 조용히 빠뜨렸다(사전등록 v2 #6). 여기서 발행한다. p50 옆에 분산(n, min–max)을 같이 싣는다.
lines.push('## 손익분기 (번들 인제스트 비용 포함)', '');
if (!Object.keys(breakEven).length) {
  lines.push('> 이 원시 결과에는 `breakEven` 블록이 없다(v2 형식). v3 하니스는 최상위에 이 블록을 싣는다.', '');
} else {
  lines.push('세션당 절감(제로베이스 정답런 비용 − OKF 정답런 비용)으로 번들을 만든 실제 배치 비용을 회수하려면 몇 세션이 필요한가. 절감이 음수거나 제로베이스가 애초에 못 맞히는 시나리오에서는 숫자를 짓지 않고 null과 이유를 남긴다.', '');
  lines.push('| 시나리오 | 제로베이스 p50·n·범위 | OKF p50·n·범위 | 세션당 절감 | 번들 배치비용(인제스트) | 손익분기 세션 | 비고 |');
  lines.push('|---|---:|---:|---:|---:|---:|---|');
  for (const scen of Object.keys(breakEven).filter((k) => !contaminatedScenarios.includes(k)).sort()) {
    const be = breakEven[scen];
    const z = pick(scen, 'zero_base', null);
    const o = pick(scen, 'okf', meta.referenceLevel);
    lines.push(`| ${scen} | ${disp(z?.costUsdCorrectOnly)} | ${disp(o?.costUsdCorrectOnly)} | ${usd(be.perSessionSavingUsd)} | ${usd(be.bundleBatchCostUsd)} | ${be.sessions ?? '—'} | ${be.reason || ''} |`);
  }
  lines.push('', `계산식: \`${(Object.values(breakEven)[0] || {}).formula || 'ceil(번들 배치 비용 / 세션당 절감)'}\``, '');
  lines.push('CLAUDE.md 대비 손익분기(사전등록 R5)는 아래 반증 기준 표에서 판정한다 — 손익분기 블록은 제로베이스 기준이고, R5는 진짜 경쟁자인 CLAUDE.md 기준이다.', '');
}

// 누적(레벨) 축은 v3에서 폐기했다(사전등록 C9). 표를 그리지 않는다 — 재지도 않은 축을 쟀다고 읽힌다.
lines.push('## 누적(레벨) 축은 폐기됨', '');
lines.push(meta.levelAxisRetired || 'v3는 레벨 비용 곡선을 재지 않는다(사전등록 C9). v2의 그 축은 설정 상수(inject_max_lines:120)를 재고 있었다.');
lines.push('');

// 사전등록한 반증 기준을 코드가 판정한다. v3의 R1~R5로 다시 매핑했다(사전등록 "반증 기준").
// 집계 규칙에 따라 각 판정이 근거로 삼은 분포(n, min–max)를 같은 표에 싣는다.
lines.push('## 사전등록 반증 기준 판정 (R1~R5)', '');
const kindOf = (k) => cells.find((c) => c.scenario === k)?.kind;
const buried = scenarioKeys.filter((k) => kindOf(k) === 'buried');
const policyKeys = scenarioKeys.filter((k) => kindOf(k) === 'policy');
const effKeys = scenarioKeys.filter((k) => kindOf(k) && kindOf(k) !== 'policy');
const verdicts = [];
{
  // R1: 탐색이 비싼(buried) 시나리오 전부에서 OKF 비용 ≥ 제로베이스 비용(정답런만)이면 반증.
  const cmp = buried.map((k) => ({ k, o: pick(k, 'okf', meta.referenceLevel), z: pick(k, 'zero_base', null) }))
    .filter((x) => cost(x.o) != null && cost(x.z) != null);
  const fired = cmp.length > 0 && cmp.every((x) => cost(x.o) >= cost(x.z));
  const ev = cmp.map((x) => `${x.k}: OKF ${disp(x.o.costUsdCorrectOnly)} vs 제로 ${disp(x.z.costUsdCorrectOnly)}`).join('; ') || '비교 가능한 정답런 없음';
  verdicts.push(['R1', 'OKF 비용 ≥ 제로베이스 비용 — 탐색이 비싼 시나리오 전부(정답런만)', fired, ev]);
}
{
  // R2: 효율(비정책) 시나리오 전부에서 OKF 비용 ≥ CLAUDE.md 비용이면 반증. 정책 시나리오는
  // 제로/CLAUDE.md 비용 비교가 정의되지 않으므로 제외한다.
  const cmp = effKeys.map((k) => ({ k, o: pick(k, 'okf', meta.referenceLevel), c: pick(k, 'claude_md', meta.referenceLevel) }))
    .filter((x) => cost(x.o) != null && cost(x.c) != null);
  const fired = cmp.length > 0 && cmp.every((x) => cost(x.o) >= cost(x.c));
  const ev = cmp.map((x) => `${x.k}: OKF ${disp(x.o.costUsdCorrectOnly)} vs CLAUDE.md ${disp(x.c.costUsdCorrectOnly)}`).join('; ') || '비교 가능한 정답런 없음';
  verdicts.push(['R2', 'OKF 비용 ≥ CLAUDE.md 비용 — 효율 시나리오 전부(정답런만)', fired, ev]);
}
{
  // R3(신설): 정책/도메인에서 OKF 이진 정답률 < 제로베이스 정답률이면 반증. 지식을 넣었는데
  // 아무 지식 없는 것보다 못하면 파이프라인이 망가진 것이다. 원자가 아니라 이진 점수로 본다.
  const cmp = policyKeys.map((k) => ({ k, o: pick(k, 'okf', meta.referenceLevel), z: pick(k, 'zero_base', null) }))
    .filter((x) => x.o && x.z);
  const fired = cmp.some((x) => (x.o.correct / x.o.runs) < (x.z.correct / x.z.runs));
  const ev = cmp.map((x) => `${x.k}: OKF ${x.o.correct}/${x.o.runs} vs 제로 ${x.z.correct}/${x.z.runs}`).join('; ') || '정책 시나리오 없음';
  verdicts.push(['R3', '정책/도메인에서 OKF 정답률 < 제로베이스 정답률(이진 점수)', fired, ev]);
}
{
  // R4(신설): 정책/도메인에서 잘못된 지식이 0보다 유의미하게 높으면(게이트만으로 맞으면) 반증 —
  // 이득이 지식이 아니라 게이트 자체라는 뜻. n=15에서 1건은 우연일 수 있으므로 2건 이상을 유의미로 본다.
  const MATERIAL = 2;
  // wrong_knowledge 셀이 오염된 시나리오는 R4에서 뺀다 — 그 정답은 게이트가 아니라 오염된
  // 프로젝트 메모리에서 나왔으므로 "게이트만으로 맞았다"는 R4의 전제가 성립하지 않는다.
  const cmp = policyKeys.map((k) => ({ k, w: pick(k, 'wrong_knowledge', meta.referenceLevel) }))
    .filter((x) => x.w && isCellClean(x.k, 'wrong_knowledge'));
  const fired = cmp.some((x) => x.w.correct >= MATERIAL);
  const dropped = policyKeys.filter((k) => !isCellClean(k, 'wrong_knowledge'));
  const ev = (cmp.map((x) => `${x.k}: 잘못된지식 ${x.w.correct}/${x.w.runs}`).join('; ') || '오염되지 않은 정책 시나리오 없음')
    + (dropped.length ? ` (오염으로 제외: ${dropped.join(', ')})` : '');
  verdicts.push(['R4', `잘못된 지식이 정책/도메인에서 유의미(정답 ≥${MATERIAL}건) — 게이트만으로 맞음`, fired, ev]);
}
{
  // R5(신설, 제로베이스가 아니라 CLAUDE.md 기준): 진짜 경쟁자인 CLAUDE.md 대비 손익분기가
  // 200세션을 넘으면(인제스트 비용 포함) 반증 — 그만큼이면 번들 인제스트 값을 못 한다.
  // 손익분기 블록은 제로베이스 기준이라 여기서 CLAUDE.md 기준으로 직접 계산한다(인제스트 비용은
  // 블록의 bundleBatchCostUsd 재사용).
  const THRESH = 200;
  const cmp = buried.map((k) => {
    const o = pick(k, 'okf', meta.referenceLevel);
    const c = pick(k, 'claude_md', meta.referenceLevel);
    const ingest = breakEven[k]?.bundleBatchCostUsd ?? null;
    const oc = cost(o); const cc = cost(c);
    const saving = (oc != null && cc != null) ? cc - oc : null;
    const sessions = saving == null ? null
      : saving <= 0 ? Infinity
        : ingest != null ? Math.ceil(ingest / saving) : null;
    return { k, o, c, ingest, sessions };
  }).filter((x) => x.sessions != null);
  const best = cmp.length ? Math.min(...cmp.map((x) => x.sessions)) : null;
  const fired = cmp.length > 0 && (best === Infinity || best > THRESH);
  const ev = cmp.map((x) => `${x.k}: OKF ${disp(x.o.costUsdCorrectOnly)} vs CLAUDE.md ${disp(x.c.costUsdCorrectOnly)} · 인제스트 ${usd(x.ingest)} · 손익분기 ${x.sessions === Infinity ? '없음(OKF가 더 비쌈)' : `${x.sessions}세션`}`).join('; ') || '비교 가능한 정답런 없음';
  verdicts.push(['R5', `CLAUDE.md 대비 손익분기 > ${THRESH}세션(인제스트 비용 포함)`, fired, ev]);
}
lines.push('| 기준 | 내용 | 근거(분산 포함) | 발동? |');
lines.push('|---|---|---|:--:|');
for (const [id, text, fired, ev] of verdicts) lines.push(`| ${id} | ${text} | ${ev} | ${fired ? '**예 — 주장 반증됨**' : '아니오'} |`);
const anyFired = verdicts.some(([, , f]) => f);
lines.push('', anyFired
  ? '> 사전등록 기준 중 하나 이상이 발동했다. 이 실행은 주장을 지지하지 않는다.'
  : '> 사전등록한 반증 기준이 하나도 발동하지 않았다.', '');
lines.push('범위 좁히기는 승리가 아니다. OKF의 유일한 잔여 이점이 "동률에서의 비용"뿐이라면, 이 보고서는 "OKF는 더 저렴한 CLAUDE.md일 뿐 더 유능한 것은 아니다"라고 적는다(사전등록 그대로).', '');

lines.push('## 알려진 한계', '');
lines.push('- 저장소 2개, 언어 1개씩. 저장소 크기·언어 전반에 대한 일반화 주장이 아니다.');
lines.push('- 게이트는 진짜 `SessionStart` 훅으로 전달했다(`--setting-sources \'\' --settings`). 설계 중 7회에 1회꼴 미전달 flake를 관측해 셀마다 전달 바이트를 검증·재시도하고, 재시도 횟수를 발행한다(위 헤더).');
lines.push(`- n은 비대칭이다: 대조군(zero_base/okf/claude_md) n=${contrastN}, 통제군(answer_sheet/wrong_knowledge) n=${controlN}(사전등록 C8). 작은 차이는 분해하지 못한다. 분포가 완전히 분리될 때만 "이겼다"고 썼다.`);
lines.push('- 모델 믹스는 제거가 아니라 정량화했다. haiku가 sonnet과 함께 해석되면 그 비용을 모델별로 따로 실어(위 "모델별 총비용", 셀별 "sonnet 단독"), 믹스가 결론을 바꾸는지 독자가 확인할 수 있게 했다.');
lines.push(`- 벽시계 시간은 싣지 않는다. 측정을 동시성 ${meta.concurrency}로 돌렸다 — 비용·토큰·도구호출은 동시성과 무관하지만 응답 속도는 아니다.`);
lines.push(`- 게이트 캡에 도달한 레벨: ${Object.values(meta.bundles).flat().filter((b) => b.gateTruncated).length ? '있음' : '없음 — 인덱스 잘림 구간은 이번 실행에서 측정되지 않았다'}.`);
lines.push('- 손익분기는 정적 코퍼스를 가정한다. 실제 번들은 계속 자라고 재인제스트된다.');
lines.push('');

const outPath = path.join(ROOT, 'docs', 'benchmarks', 'okf-benchmark-2026-07-16-v3.md');
fs.writeFileSync(outPath, `${lines.join('\n')}\n`);
console.log(outPath);
