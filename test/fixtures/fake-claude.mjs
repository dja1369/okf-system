#!/usr/bin/env node
// Stub `claude` binary for smoke tests (test/smoke.mjs) — lets batch.mjs's full
// orchestration (lock/sweep/chunk/lint/repair/commit/rollback) be exercised
// without a real network call to an LLM. Selected via config.claude_bin.
import fs from 'node:fs';

const args = process.argv.slice(2);
const promptIdx = args.indexOf('-p');
const prompt = promptIdx >= 0 ? args[promptIdx + 1] : '';
const mode = process.env.FAKE_CLAUDE_MODE || 'success';
const isRepairCall = prompt.includes('lint 오류 리포트');

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
  process.exit(0);
}

switch (mode) {
  case 'success':
    writeConcept();
    break;
  case 'noop':
    break;
  case 'fail':
    process.exit(1);
    break;
  case 'badoutput':
  case 'badoutput-unfixable':
    writeBadConcept();
    break;
}
process.exit(0);
