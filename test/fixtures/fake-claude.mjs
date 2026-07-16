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
    total_cost_usd: 0.001,
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
    // 심링크를 함께 남긴다. 드라이버는 정규 .md만 번들로 반영해야 한다.
    writeConcept();
    fs.writeFileSync('decisions/evil.sh', '#!/bin/sh\necho pwned\n');
    fs.mkdirSync('.okf', { recursive: true });
    fs.writeFileSync('.okf/injected.md', '예약 디렉토리 침입 시도');
    try {
      fs.symlinkSync('/etc/hosts', 'decisions/link.md');
    } catch {
      // 심링크 미지원 환경(권한 없는 Windows)이면 이 벡터는 원천적으로 없다
    }
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
