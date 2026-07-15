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

export function regenerateIndex(okfHome) {
  const paths = okfPaths(okfHome);
  const summaries = [];

  for (const dir of discoverConceptDirs(okfHome)) {
    const dirPath = path.join(okfHome, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;

    const files = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'index.md')
      .map((e) => e.name)
      .sort();

    const lines = files.map((name) => {
      const { title, description } = extractEntry(path.join(dirPath, name), name);
      const link = `/${dir}/${name}`;
      return description ? `- [${title}](${link}): ${description}` : `- [${title}](${link})`;
    });

    writeAtomic(path.join(dirPath, 'index.md'), lines.length > 0 ? `${lines.join('\n')}\n` : '');
    summaries.push({ dir, count: files.length });
  }

  writeAtomic(paths.rootIndex, buildRootIndex(paths.rootIndex, summaries));
}

function main() {
  regenerateIndex(resolveOkfHome());
}

if (import.meta.url === `file://${process.argv[1]}`) main();
