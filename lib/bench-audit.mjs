import fs from 'node:fs';
import path from 'node:path';
import { SCAN_EXCLUDE_DIRS, NON_CONCEPT_BASENAMES } from './paths.mjs';

export const BENCH_TARGET_FACTS = [
  { key: 'architecture_database', pattern: /\bsqlite\b/i },
  { key: 'architecture_pattern', pattern: /repository\s+pattern/i },
  { key: 'export_style', pattern: /named\s+exports?\s+(?:only|required)|default\s+exports?\s+(?:are\s+)?(?:forbidden|prohibited|not\s+allowed)|default\s+export[^\n]{0,24}금지/i },
  { key: 'failure_solution', pattern: /busy_timeout\s*=\s*5000/i },
  { key: 'response_language', pattern: /\bkorean\b|한국어/i },
  { key: 'response_style', pattern: /\bconcise\b|간결/i },
  { key: 'policy_file', pattern: /src\/config\.mjs/i },
  { key: 'policy_command', pattern: /npm\s+run\s+deploy:canary/i },
];

function normalizeAnswer(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

export function matchesBenchmarkAnswer(key, actual, expected) {
  const normalizedActual = normalizeAnswer(actual);
  const normalizedExpected = normalizeAnswer(expected);
  if (normalizedActual === normalizedExpected) return true;
  if (key === 'export_style') return /named exports?/.test(normalizedActual)
    && (/\bonly\b/.test(normalizedActual) || /만\s*사용/.test(normalizedActual)
      || /default exports?[^\n]{0,32}(?:금지|forbidden|prohibited)/.test(normalizedActual));
  if (key === 'response_language') return ['korean', '한국어'].includes(normalizedActual);
  if (key === 'response_style') return normalizedActual === 'concise' || normalizedActual.startsWith('간결');
  return normalizedActual.includes(normalizedExpected);
}

function conceptFiles(okfHome) {
  const found = [];
  // **예약 디렉토리 이름은 루트 자식일 때만 예약이다.** `lib/lint.mjs`(walkMdFiles)와
  // `lib/index-gen.mjs`(regenerateDir)는 각각 `isRoot` / `relParts.length === 0` 가드를 갖는데
  // 여기만 깊이 무관하게 걸렀다 — `projects/raw/x.md`가 감사에서 통째로 빠진다.
  // 이 파일은 recall@cap 측정 경로이고 **릴리스 3의 착수 조건이 그 측정치**라, 왜곡되면
  // 잘못된 판단을 게이트한다.
  const walk = (dir, relDir = '') => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const isRoot = relDir === '';
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const rel = relDir ? path.join(relDir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (!(isRoot && SCAN_EXCLUDE_DIRS.has(entry.name))) walk(path.join(dir, entry.name), rel);
      } else if (entry.isFile() && entry.name.endsWith('.md') && !NON_CONCEPT_BASENAMES.has(entry.name)) {
        found.push(rel);
      }
    }
  };
  walk(okfHome);
  return found.sort();
}

export function auditBenchmarkBundle(okfHome, gateContext = '') {
  const documents = conceptFiles(okfHome).map((relativePath) => {
    let text = '';
    try { text = fs.readFileSync(path.join(okfHome, relativePath), 'utf8'); } catch { /* missing */ }
    return { relativePath: relativePath.split(path.sep).join('/'), text };
  });
  const facts = {};
  for (const fact of BENCH_TARGET_FACTS) {
    const matchingFiles = documents.filter((doc) => fact.pattern.test(doc.text)).map((doc) => doc.relativePath);
    const routedFiles = matchingFiles.filter((rel) => gateContext.includes(`/${rel}`));
    facts[fact.key] = {
      present: matchingFiles.length > 0,
      routed: routedFiles.length > 0,
      matchingFiles,
    };
  }
  const values = Object.values(facts);
  return {
    checkedFacts: values.length,
    presentFacts: values.filter((fact) => fact.present).length,
    routedFacts: values.filter((fact) => fact.routed).length,
    ready: values.every((fact) => fact.present && fact.routed),
    anyTargetFactPresent: values.some((fact) => fact.present),
    facts,
  };
}
