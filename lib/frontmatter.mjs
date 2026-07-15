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
