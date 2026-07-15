import fs from 'node:fs';
import path from 'node:path';
import { SCAN_EXCLUDE_DIRS } from './paths.mjs';

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
  const walk = (dir, relDir = '') => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const rel = relDir ? path.join(relDir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (!SCAN_EXCLUDE_DIRS.has(entry.name)) walk(path.join(dir, entry.name), rel);
      } else if (entry.isFile() && entry.name.endsWith('.md')
        && !['index.md', 'log.md', 'SCHEMA.md', 'README.md'].includes(entry.name)) {
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
