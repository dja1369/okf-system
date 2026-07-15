import fs from 'node:fs';
import path from 'node:path';
import { resolveOkfHome, SCAN_EXCLUDE_DIRS } from './paths.mjs';
import { parseFrontmatter } from './frontmatter.mjs';

// implement.md §5-6: type -> taxonomy directory. Explicit map instead of a
// pluralization rule because 'troubleshooting' doesn't pluralize like the rest.
const TYPE_TO_DIR = {
  project: 'projects',
  decision: 'decisions',
  preference: 'preferences',
  pattern: 'patterns',
  reference: 'references',
  troubleshooting: 'troubleshooting',
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOG_HEADING_RE = /^##[ \t]+(.*)$/gm;
const LINK_RE = /\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

// implement.md §5-6 탐색 범위: SCAN_EXCLUDE_DIRS는 루트 자식일 때만 제외 —
// 이름이 우연히 같은 중첩 디렉토리(예: projects/raw/)는 정상 스캔 대상이다.
function walkMdFiles(root) {
  const out = [];
  function walk(dir, isRoot) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (isRoot && entry.isDirectory() && SCAN_EXCLUDE_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, false);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        out.push(path.relative(root, abs).split(path.sep).join('/'));
      }
    }
  }
  walk(root, true);
  return out;
}

function linkTargetExists(okfHome, link) {
  try {
    return fs.statSync(path.join(okfHome, link)).isFile();
  } catch {
    return false;
  }
}

function checkLinks(text, relPath, okfHome, warnings) {
  LINK_RE.lastIndex = 0;
  let m;
  while ((m = LINK_RE.exec(text))) {
    let link = m[1];
    if (!link.startsWith('/')) continue;
    link = link.split('#')[0];
    if (!link || linkTargetExists(okfHome, link)) continue;
    warnings.push({ file: relPath, rule: 'W1', message: `broken link: ${link}` });
  }
}

function checkLogHeadings(content, relPath, errors, warnings) {
  LOG_HEADING_RE.lastIndex = 0;
  const dates = [];
  let m;
  while ((m = LOG_HEADING_RE.exec(content))) {
    const text = m[1].trim();
    if (!ISO_DATE_RE.test(text)) {
      errors.push({ file: relPath, rule: 'E3b', message: `non-ISO log heading: "${text}"` });
    } else {
      dates.push(text);
    }
  }
  for (let i = 1; i < dates.length; i++) {
    if (dates[i] > dates[i - 1]) {
      errors.push({
        file: relPath,
        rule: 'E3b',
        message: `log dates not descending: "${dates[i - 1]}" followed by "${dates[i]}"`,
      });
      break; // one violation is enough to fail the file; avoid flooding the report
    }
  }
  const seen = new Set();
  const dup = new Set();
  for (const d of dates) {
    if (seen.has(d)) dup.add(d);
    seen.add(d);
  }
  for (const d of dup) {
    warnings.push({ file: relPath, rule: 'W4', message: `duplicate log date heading: "${d}"` });
  }
}

function checkRootIndexFrontmatter(hasFrontmatter, data, parseError, relPath, errors, warnings) {
  if (!hasFrontmatter) return;
  if (parseError) {
    errors.push({ file: relPath, rule: 'E3a', message: `root index.md frontmatter parse error: ${parseError.message}` });
    return;
  }
  const keys = Object.keys(data || {});
  if (keys.includes('okf_version') && !isNonEmptyString(String(data.okf_version ?? ''))) {
    errors.push({ file: relPath, rule: 'E3a', message: 'okf_version key present but empty' });
  }
  const extra = keys.filter((k) => k !== 'okf_version');
  if (extra.length > 0) {
    warnings.push({ file: relPath, rule: 'W4', message: `root index.md frontmatter has extra keys: ${extra.join(', ')}` });
  }
}

function checkNonReserved(relPath, hasFrontmatter, data, parseError, errors, warnings) {
  if (!hasFrontmatter) {
    errors.push({ file: relPath, rule: 'E1', message: 'missing frontmatter' });
    return;
  }
  if (parseError) {
    errors.push({ file: relPath, rule: 'E1', message: `frontmatter parse error: ${parseError.message}` });
    return;
  }
  const type = data && data.type;
  if (type == null || (typeof type === 'string' && type.trim() === '')) {
    errors.push({ file: relPath, rule: 'E2', message: 'type field missing or empty' });
    return;
  }

  const missing = ['title', 'description', 'timestamp'].filter((f) => !isNonEmptyString(String(data[f] ?? '')));
  if (missing.length > 0) {
    warnings.push({ file: relPath, rule: 'W2', message: `missing recommended field(s): ${missing.join(', ')}` });
  }

  const typeStr = String(type);
  const expectedDir = TYPE_TO_DIR[typeStr];
  const dirName = relPath.includes('/') ? relPath.split('/')[0] : '';
  if (!expectedDir) {
    warnings.push({ file: relPath, rule: 'W3', message: `type "${typeStr}" is outside the known taxonomy` });
  } else if (dirName !== expectedDir) {
    warnings.push({ file: relPath, rule: 'W3', message: `type "${typeStr}" expects /${expectedDir}/ but file is in /${dirName || '.'}/` });
  }
}

export function runLint(okfHome) {
  const errors = [];
  const warnings = [];

  for (const relPath of walkMdFiles(okfHome)) {
    const abs = path.join(okfHome, relPath);
    let content;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch (err) {
      errors.push({ file: relPath, rule: 'E1', message: `unable to read file: ${err.message}` });
      continue;
    }

    const basename = path.basename(relPath);
    const isIndex = basename === 'index.md';
    const isLog = relPath === 'log.md';
    const reserved = isIndex || basename === 'log.md';

    const { hasFrontmatter, data, body, parseError } = parseFrontmatter(content);

    if (!reserved) {
      checkNonReserved(relPath, hasFrontmatter, data, parseError, errors, warnings);
    }

    if (isIndex) {
      if (relPath === 'index.md') {
        checkRootIndexFrontmatter(hasFrontmatter, data, parseError, relPath, errors, warnings);
      } else if (hasFrontmatter) {
        errors.push({ file: relPath, rule: 'E3a', message: 'non-root index.md must not have frontmatter' });
      }
    }

    if (isLog) {
      checkLogHeadings(content, relPath, errors, warnings);
    }

    checkLinks(hasFrontmatter ? body : content, relPath, okfHome, warnings);
  }

  return { errors, warnings };
}

export function formatReport(report) {
  const lines = [
    ...report.errors.map((e) => `${e.file}: ${e.rule}: ${e.message}`),
    ...report.warnings.map((w) => `${w.file}: ${w.rule}: ${w.message}`),
  ];
  return lines.length > 0 ? lines.join('\n') : 'OK: 0 errors, 0 warnings';
}

function main() {
  const okfHome = process.argv[2] || resolveOkfHome();
  const report = runLint(okfHome);
  console.log(formatReport(report));
  if (report.errors.length > 0) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
