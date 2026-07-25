import * as yaml from './vendor/js-yaml.mjs';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/;

// implement.md §2: vendored js-yaml instead of a hand-rolled subset parser —
// a subset parser false-positives on ordinary LLM-written YAML (quoted strings
// with colons, multiline text) and rolls back an otherwise-valid batch commit.
// `raw`는 원본 YAML **라인 블록 그대로**다(순수 추가). 두 소비자가 있다:
// (1) lint가 파싱값과 디스크 원문을 대조해 js-yaml이 조용히 잘라낸 값을 찾는다(W5),
// (2) index-gen이 루트 프론트매터의 미지 키를 라인 단위로 보존한다(SPEC §4.1 SHOULD).
// **raw로 값을 읽지 마라** — 그러면 YAML 해석이 두 벌이 된다. 대조와 보존에만 쓴다.
export function parseFrontmatter(content) {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) {
    return { hasFrontmatter: false, data: null, body: content, parseError: null, raw: null };
  }
  const [, yamlText, body] = match;
  try {
    const data = yaml.load(yamlText);
    return { hasFrontmatter: true, data: data ?? {}, body, parseError: null, raw: yamlText };
  } catch (err) {
    return { hasFrontmatter: true, data: null, body, parseError: err, raw: yamlText };
  }
}

