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


// **쓰기 전용**. `status:` 한 줄만 텍스트로 교체/삽입한다 — YAML 재직렬화는 키 순서·따옴표·
// 미지 키를 통째로 재작성해 SPEC §4.1 round-trip을 깬다. 판정(읽기)은 lib/trust.mjs가 소유한다.
// `.*`가 아니라 `[^\r\n]*`인 이유: `.`은 `\r`을 먹어 CRLF 파일에서 개행이 섞인다.
// YAML은 `key : value`처럼 **콜론 앞 공백**을 허용한다. 파서는 그걸 정상 인식하는데 정규식이
// 못 잡으면 "읽기는 되고 쓰기는 안 되는" 비대칭이 생긴다 — 실측: `status : deprecated`인 파일에
// --restore를 걸면 아무것도 안 바뀌었는데 커맨드는 성공을 보고하고 커밋까지 남겼다.
// 프론트매터 키를 정규식으로 다루는 곳은 전부 이 헬퍼를 써라(lib/index-gen.mjs, lib/bootstrap.mjs,
// bin/batch.mjs의 okf_seed 게이트도 같은 결함을 공유했다).
export function frontmatterKeyLineRe(key, { flags = 'm' } = {}) {
  // key를 그대로 보간하면 정규식 메타문자가 코드로 파싱된다 — `a(b`는 즉시 throw하고,
  // `a|b`는 **조용히 다른 정규식**이 되어 엉뚱한 줄을 잡는다(조용한 쪽이 더 나쁘다).
  // 현재 호출부는 전부 리터럴이지만 이건 exported API다: 계약을 코드로 지킨다.
  // YAML 키로 유효한 문자만 허용하고, 그래도 남는 것은 이스케이프한다.
  if (typeof key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) {
    throw new TypeError(`frontmatterKeyLineRe: unsafe key ${JSON.stringify(key)}`);
  }
  return new RegExp(`^${key}[ \\t]*:[^\\r\\n]*`, flags);
}

const STATUS_LINE_RE = frontmatterKeyLineRe('status');
const TYPE_LINE_RE = frontmatterKeyLineRe('type');

export function setFrontmatterStatus(content, value) {
  const match = FRONTMATTER_RE.exec(content);
  // 프론트매터 앞에 빈 줄이 있으면 매치하지 않는다 — 그건 lint E1 대상이므로 호출자가
  // 거부해야 정상이다. 여기서 조용히 고치면 그 파일이 규정 위반인 채로 살아남는다.
  if (!match) return null;
  const yamlText = match[1];
  const fmStart = /^---\r?\n/.exec(content)[0].length;
  const eol = content.slice(0, fmStart).endsWith('\r\n') ? '\r\n' : '\n';
  const line = `status: ${value}`;

  let nextYaml;
  if (STATUS_LINE_RE.test(yamlText)) {
    nextYaml = value === null
      ? yamlText.replace(new RegExp(`^status[ \\t]*:[^\r\n]*(\r?\n)?`, 'm'), () => '').replace(/(\r?\n)$/, '')
      : yamlText.replace(STATUS_LINE_RE, () => line);
  } else if (value === null) {
    return content; // 지울 것이 없다 — 멱등
  } else if (TYPE_LINE_RE.test(yamlText)) {
    // type: 줄 바로 뒤에 넣어 삽입 위치를 결정적으로 만든다.
    nextYaml = yamlText.replace(TYPE_LINE_RE, (m) => `${m}${eol}${line}`);
  } else {
    nextYaml = yamlText === '' ? line : `${yamlText}${eol}${line}`;
  }
  if (nextYaml === yamlText) return content;
  return content.slice(0, fmStart) + nextYaml + content.slice(fmStart + yamlText.length);
}
