import fs from 'node:fs';
import path from 'node:path';
import { resolveOkfHome, okfPaths, SCAN_EXCLUDE_DIRS } from './paths.mjs';
import { parseFrontmatter } from './frontmatter.mjs';

// implement.md §5-7: fallback labels for the root category summary; unknown
// directories (not in this map) still get a heading, just using their own name.
export const DIR_DESCRIPTIONS = {
  projects: '프로젝트',
  decisions: '결정',
  preferences: '선호',
  patterns: '패턴',
  references: '참고자료',
  troubleshooting: '트러블슈팅',
};

function writeAtomic(filePath, content) {
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

// frontmatter 파싱 실패/부재/title 누락 시 파일명으로 폴백 — index 재생성은
// 절대 크래시하면 안 된다(§5-7): 배치 청크 성공 여부가 여기 달려 있다.
function extractEntry(absPath, filename) {
  const fallbackTitle = filename.replace(/\.md$/, '');
  try {
    const content = fs.readFileSync(absPath, 'utf8');
    const { hasFrontmatter, data, parseError } = parseFrontmatter(content);
    if (!hasFrontmatter || parseError || !data) return { title: fallbackTitle, description: undefined };
    const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : fallbackTitle;
    const description = typeof data.description === 'string' && data.description.trim() ? data.description.trim() : undefined;
    return { title, description };
  } catch {
    return { title: fallbackTitle, description: undefined };
  }
}

function readExistingOkfVersion(rootIndexPath) {
  try {
    const existing = fs.readFileSync(rootIndexPath, 'utf8');
    const { hasFrontmatter, data } = parseFrontmatter(existing);
    if (hasFrontmatter && data && data.okf_version != null && String(data.okf_version).trim() !== '') {
      return String(data.okf_version).trim();
    }
  } catch {
    // no root index.md yet (pre-bootstrap) -> default below
  }
  return '0.1';
}

function buildRootIndex(rootIndexPath, summaries) {
  const okfVersion = readExistingOkfVersion(rootIndexPath);
  const sections = summaries.map(({ dir, count }) => {
    const desc = DIR_DESCRIPTIONS[dir] || dir;
    return `## ${dir} (${desc})\n[/${dir}/index.md](/${dir}/index.md) — ${count}개\n`;
  });
  return `---\nokf_version: "${okfVersion}"\n---\n# OKF Knowledge Bundle\n\n${sections.join('\n')}`;
}

// 리뷰 지적(사후 반영): 예전엔 고정된 TAXONOMY_DIRS(6개)만 순회해서, LLM이 §5-8 SCHEMA.md의
// "미지 type: 부득이하면 유지(WARN)" 규정에 따라 6종 밖의 새 디렉토리에 concept를 커밋하면
// (lint는 W3 경고만 내고 막지 않는다) 그 개념이 index.md에 영원히 안 나타나고, 게이트는
// index.md 기반이므로 세션에서도 영구히 발견 불가능해졌다. lint.mjs와 동일하게 SCAN_EXCLUDE_DIRS만
// 제외한 루트 전체를 동적으로 스캔해 이 비대칭을 없앤다(§5-6/§5-7이 원래 요구하던 대로).
export function discoverConceptDirs(okfHome) {
  let entries;
  try {
    entries = fs.readdirSync(okfHome, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !SCAN_EXCLUDE_DIRS.has(e.name))
    .map((e) => e.name)
    .sort();
}

// OKF 스펙: index.md는 번들 루트를 포함해 어느 디렉토리에든 놓일 수 있고, 그 디렉토리의 내용물을
// 열거해 점진적 공개를 지원한다. 즉 도메인 안에 도메인이 있을 수 있다(decisions/sales/tables/...).
// 예전엔 카테고리 바로 아래 *파일만* 훑어서, decisions/sales/orders.md는 어떤 index.md에도
// 나타나지 않았고 게이트는 index 기반이므로 세션에서 영구히 발견 불가능했다 — 아래
// discoverConceptDirs 주석이 고쳤다는 그 버그와 같은 것의, 한 단계 아래 버전이다.
// relParts는 번들 루트 기준 상대 경로 조각이다. 파일 접근은 path.join(플랫폼), 링크는 '/'
// (번들 루트 기준 절대경로 — 게이트 규칙 2의 약속)로 각각 만든다.
// 반환값은 이 디렉토리가 품은 concept 총수(하위 도메인 포함)다.
function regenerateDir(okfHome, relParts) {
  const dirPath = path.join(okfHome, ...relParts);
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return 0;
  }
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'index.md')
    .map((e) => e.name)
    .sort();
  const subdirs = entries
    .filter((e) => e.isDirectory() && !SCAN_EXCLUDE_DIRS.has(e.name))
    .map((e) => e.name)
    .sort();

  // 하위를 먼저 재생성해야 링크에 실을 개수를 알 수 있다.
  const subCounts = new Map();
  for (const sub of subdirs) subCounts.set(sub, regenerateDir(okfHome, [...relParts, sub]));

  const lines = files.map((name) => {
    const { title, description } = extractEntry(path.join(dirPath, name), name);
    const link = `/${[...relParts, name].join('/')}`;
    return description ? `- [${title}](${link}): ${description}` : `- [${title}](${link})`;
  });
  // 하위 도메인은 자기 index.md로 내려가는 링크로 싣는다 — 이게 점진적 공개다. 하위 concept를
  // 부모 index에 펼치면 깊은 번들에서 index 하나가 번들 전체 크기로 자란다.
  for (const sub of subdirs) {
    const link = `/${[...relParts, sub, 'index.md'].join('/')}`;
    lines.push(`- [${sub}](${link}): 하위 도메인 — concept ${subCounts.get(sub)}개`);
  }

  writeAtomic(path.join(dirPath, 'index.md'), lines.length > 0 ? `${lines.join('\n')}\n` : '');
  return files.length + [...subCounts.values()].reduce((sum, n) => sum + n, 0);
}

export function regenerateIndex(okfHome) {
  const paths = okfPaths(okfHome);
  const summaries = [];

  for (const dir of discoverConceptDirs(okfHome)) {
    const dirPath = path.join(okfHome, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    summaries.push({ dir, count: regenerateDir(okfHome, [dir]) });
  }

  writeAtomic(paths.rootIndex, buildRootIndex(paths.rootIndex, summaries));
}

function main() {
  regenerateIndex(resolveOkfHome());
}

if (import.meta.url === `file://${process.argv[1]}`) main();
