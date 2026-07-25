import * as yaml from './vendor/js-yaml.mjs';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/;

// implement.md §2: vendored js-yaml instead of a hand-rolled subset parser —
// a subset parser false-positives on ordinary LLM-written YAML (quoted strings
// with colons, multiline text) and rolls back an otherwise-valid batch commit.
export function parseFrontmatter(content) {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) {
    return { hasFrontmatter: false, data: null, body: content, parseError: null };
  }
  const [, yamlText, body] = match;
  try {
    const data = yaml.load(yamlText);
    return { hasFrontmatter: true, data: data ?? {}, body, parseError: null };
  } catch (err) {
    return { hasFrontmatter: true, data: null, body, parseError: err };
  }
}

// lint 전용. 원본 YAML 블록을 그대로 돌려준다 — 파싱된 값과 디스크 원문을 비교해
// "js-yaml이 조용히 잘라낸 값"을 찾기 위한 것이다. FRONTMATTER_RE를 단일 원천으로
// 재사용한다(`g` 플래그가 없어 재호출해도 lastIndex가 남지 않는다).
// **lint 밖에서 쓰지 마라** — 원문 줄로 값을 읽기 시작하면 YAML 해석이 두 벌이 된다.
export function frontmatterRaw(content) {
  const match = FRONTMATTER_RE.exec(content);
  return match ? match[1] : null;
}
