#!/usr/bin/env node
// Stub `claude` binary for smoke tests (test/smoke.mjs) — lets batch.mjs's full
// orchestration (lock/sweep/chunk/lint/repair/commit/rollback) be exercised
// without a real network call to an LLM. Selected via config.claude_bin.
import fs from 'node:fs';

const args = process.argv.slice(2);
const promptIdx = args.indexOf('-p');
const positionalPrompt = promptIdx >= 0 && args[promptIdx + 1] && !args[promptIdx + 1].startsWith('--')
  ? args[promptIdx + 1]
  : '';
const prompt = positionalPrompt || fs.readFileSync(0, 'utf8');
const mode = process.env.FAKE_CLAUDE_MODE || 'success';
const isRepairCall = prompt.includes('lint 오류 리포트');

// 청크마다 새 프로세스로 뜨므로 프로세스 내 변수로는 셀 수 없다. 파일 카운터로
// '이 경로에서 유료 호출이 몇 번 났는가'를 무과금으로 단언한다.
if (process.env.FAKE_CLAUDE_CALL_COUNTER) {
  try {
    fs.appendFileSync(process.env.FAKE_CLAUDE_CALL_COUNTER, `${isRepairCall ? 'repair' : 'ingest'}\n`);
  } catch { /* 텔레메트리가 스텁을 막지 않는다 */ }
}

// 비용 회귀 테스트를 무과금으로 돌리기 위한 주입 지점. Number('')는 0이므로 빈 문자열은
// 주입으로 치지 않는다 — 그러면 '비용을 0으로 주입했다'와 '주입하지 않았다'가 구분되지 않는다.
const injectedCost = Number(process.env.FAKE_CLAUDE_COST_USD);
const COST_USD = Number.isFinite(injectedCost) && process.env.FAKE_CLAUDE_COST_USD ? injectedCost : 0.001;

function emitResult(subtype = 'success', isError = false, resultText = 'done') {
  process.stdout.write(JSON.stringify({
    type: 'result',
    subtype,
    is_error: isError,
    result: subtype === 'success' ? resultText : undefined,
    errors: subtype === 'success' ? undefined : [subtype],
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 25,
    },
    duration_ms: 250,
    duration_api_ms: 200,
    total_cost_usd: COST_USD,
    num_turns: 1,
    modelUsage: {
      'claude-sonnet-5': { inputTokens: 100, outputTokens: 20, costUSD: 0.001 },
    },
    session_id: process.env.FAKE_CLAUDE_SESSION_ID || 'f6f6f6f6-1111-2222-3333-444444444444',
  }));
}

function writeConcept() {
  fs.mkdirSync('decisions', { recursive: true });
  fs.writeFileSync(
    'decisions/fake-test-concept.md',
    `---
type: decision
title: 테스트 결정
description: fake-claude가 생성한 스모크 테스트용 concept
timestamp: 2026-07-15
---
스모크 테스트 본문.
`
  );
  const today = new Date().toISOString().slice(0, 10);
  const log = fs.existsSync('log.md') ? fs.readFileSync('log.md', 'utf8') : '# Log\n';
  if (log.includes(`## ${today}`)) {
    fs.writeFileSync('log.md', log.replace(`## ${today}`, `## ${today}\n- fake-claude 테스트 반영`));
  } else {
    fs.writeFileSync('log.md', log.replace('# Log\n', `# Log\n\n## ${today}\n- fake-claude 테스트 반영\n`));
  }
}

function writeBadConcept() {
  fs.mkdirSync('decisions', { recursive: true });
  fs.writeFileSync('decisions/bad-concept.md', '이 파일은 frontmatter가 없다.\n');
}

function repairBadConcept() {
  fs.writeFileSync(
    'decisions/bad-concept.md',
    `---
type: decision
title: 수리된 결정
description: repair 프롬프트로 수리됨
timestamp: 2026-07-15
---
수리된 본문.
`
  );
}

if (process.env.FAKE_CLAUDE_DUMP_PROMPT_TO) {
  fs.writeFileSync(process.env.FAKE_CLAUDE_DUMP_PROMPT_TO, prompt);
}
if (process.env.FAKE_CLAUDE_DUMP_SETTINGS_TO) {
  const settingsIdx = args.indexOf('--settings');
  const value = settingsIdx >= 0 ? args[settingsIdx + 1] || '' : '';
  try {
    fs.copyFileSync(value, process.env.FAKE_CLAUDE_DUMP_SETTINGS_TO); // 파일 경로로 전달된 경우
  } catch {
    fs.writeFileSync(process.env.FAKE_CLAUDE_DUMP_SETTINGS_TO, value); // (회귀 감지용) 인라인 문자열
  }
}
if (process.env.FAKE_CLAUDE_DUMP_ARGV_TO) {
  fs.writeFileSync(process.env.FAKE_CLAUDE_DUMP_ARGV_TO, JSON.stringify(args));
}

if (isRepairCall) {
  if (mode !== 'badoutput-unfixable') repairBadConcept();
  emitResult();
  process.exit(0);
}

let resultText = 'done';
switch (mode) {
  case 'success':
    writeConcept();
    break;
  case 'noop':
    resultText = 'NO-OP'; // 실제 프로토콜(ingest.md): 반영할 게 없으면 정확히 NO-OP 한 줄
    break;
  case 'blocked':
    // 실측(E3) 재현: 쓰기 권한이 차단되면 분석기는 성공 종료하되 아무것도 못 쓰고
    // NO-OP도 선언하지 않는다 — 차단 사정만 설명한다.
    resultText = '파일 쓰기가 sensitive file 권한으로 차단되어 반영하지 못했습니다';
    break;
  case 'hostile-workspace':
    // 오염된 digest에 넘어간 분석기를 재현: 정상 concept 외에 스크립트·예약 디렉토리 침입·
    // 심링크·규칙서(SCHEMA)/시드 변조를 함께 남긴다. 드라이버는 정규 .md만, 그리고
    // SCHEMA/okf_seed가 아닌 파일만 번들로 반영해야 한다.
    writeConcept();
    fs.writeFileSync('decisions/evil.sh', '#!/bin/sh\necho pwned\n');
    fs.mkdirSync('.okf', { recursive: true });
    fs.writeFileSync('.okf/injected.md', '예약 디렉토리 침입 시도');
    try {
      fs.appendFileSync('SCHEMA.md', '\n<!-- 변조된 규칙 -->\n');
    } catch {
      // SCHEMA가 없는 워크스페이스면 이 벡터는 없다
    }
    try {
      fs.appendFileSync('preferences/okf-bundle-rules.md', '\n변조된 시드\n');
    } catch {
      // 시드 없는 배포본이면 이 벡터는 없다
    }
    try {
      fs.symlinkSync('/etc/hosts', 'decisions/link.md');
    } catch {
      // 심링크 미지원 환경(권한 없는 Windows)이면 이 벡터는 원천적으로 없다
    }
    break;
  case 'noop-marker':
    // 마커만 쓰고 출력 텍스트는 프로토콜과 다르게 낸다 — 판정이 텍스트가 아니라 마커임을 고정한다.
    fs.writeFileSync('.okf-noop', '');
    resultText = '재사용할 만한 지식이 없어 아무 파일도 쓰지 않았습니다';
    break;
  case 'noop-marker-with-write':
    // 마커 프로토콜이 여는 **새 유실 경로**: concept를 쓰고도 마커를 남기면 NO-OP이 아니라 실패다.
    writeConcept();
    fs.writeFileSync('.okf-noop', '');
    break;
  case 'blocked-with-marker':
    // blocked>0 / applied===0 + 마커. 마커만 믿으면 차단된 지식이 조용히 archive된다.
    try {
      fs.appendFileSync('SCHEMA.md', '\n<!-- 변조된 규칙 -->\n');
    } catch {
      // SCHEMA가 없는 워크스페이스면 이 벡터는 없다
    }
    fs.writeFileSync('.okf-noop', '');
    break;
  case 'first-chunk-blocked': {
    // 첫 청크만 차단을 재현하고 두 번째부터는 정상 — 청크가 독립 트랜잭션인지 검증한다.
    // 청크마다 새 프로세스라 프로세스 내 변수로는 셀 수 없다.
    const chunkCounter = process.env.FAKE_CLAUDE_CHUNK_COUNTER || '';
    let seenChunks = 0;
    try {
      seenChunks = fs.readFileSync(chunkCounter, 'utf8').split('\n').filter(Boolean).length;
    } catch {
      seenChunks = 0;
    }
    try {
      fs.appendFileSync(chunkCounter, 'chunk\n');
    } catch { /* 카운터 실패가 스텁을 막지 않는다 */ }
    if (seenChunks === 0) {
      resultText = '파일 쓰기가 sensitive file 권한으로 차단되어 반영하지 못했습니다';
    } else {
      writeConcept();
    }
    break;
  }
  case 'badjson':
    // stdout이 JSON이 아니다 → CLAUDE_INVALID_JSON 경로. 호출은 났고 금액만 모르는 상태다.
    process.stdout.write('this is not json at all\n');
    process.exit(0);
    break;
  case 'blocked-mentions-noop':
    // 리뷰 확정(minor) 재현: 실패 설명문이 NO-OP이라는 단어를 "언급"만 해도 substring 판정은
    // 이를 선언으로 오인해 archive했다 — 선언은 정확히 'NO-OP' 한 줄이어야 한다.
    resultText = '반영할 내용이 있었으나 쓰기가 차단되어 NO-OP을 선언하지 않습니다';
    break;
  case 'fail':
    process.exit(1);
    break;
  case 'leak-fail':
    process.stderr.write(`${process.env.FAKE_CLAUDE_SECRET || 'secret'}\n`);
    process.exit(1);
    break;
  case 'maxturns':
    emitResult('error_max_turns', true);
    process.exit(0);
    break;
  case 'badoutput':
  case 'badoutput-unfixable':
    writeBadConcept();
    break;
  case 'secret-lint':
    fs.appendFileSync('log.md', `\n## ${process.env.FAKE_CLAUDE_SECRET || 'secret'}\n- invalid heading\n`);
    break;
}
emitResult('success', false, resultText);
process.exit(0);
