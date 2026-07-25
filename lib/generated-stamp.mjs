import { parseFrontmatter } from './frontmatter.mjs';
import { isPlainObject } from './trust.mjs';

// OKF v0.2 §5.2의 `generated: {by, at}`를 프론트매터 **텍스트 블록만** 인덱스 산술로 건드린다.
//
// 설계 결정 3개와 근거:
// (1) 값은 반드시 **큰따옴표**다. 무따옴표 ISO 날짜는 벤더드 js-yaml이 Date 객체로 파싱해
//     같은 필드가 파일마다 string/Date로 갈리고, 문자열 비교가 NaN 비교가 되어 어떤 날짜에도
//     false가 된다(실행 확인: '2027-01-05' >= <Date 2026-12-31>도 false).
// (2) 블록은 **프론트매터 맨 끝**에 붙인다. 앞 키가 블록 스칼라(`description: |`)여도 컬럼 0의
//     새 키가 그것을 정상 종료시키고, SCHEMA의 권장 키 순서를 흔들지 않는다.
// (3) `replace`는 반드시 **함수 폼**이다. 문자열 폼이면 값 안의 `$&`/`$'`가 치환 패턴으로
//     해석돼 프론트매터가 스플라이스된다(bin/batch.mjs의 프롬프트 치환과 같은 함정).
//
// yaml.dump 재직렬화를 절대 쓰지 마라 — 키 순서·따옴표·미지 키가 통째로 재작성되어
// SPEC §4.1의 round-trip 보존(SHOULD)을 깬다.

const FM_SPLIT_RE = /^(---\r?\n)([\s\S]*?)(\r?\n---[ \t]*\r?\n?)/;
// 우리가 찍은 canonical 3줄만 매치한다 — 남의 generated 형태에는 걸리지 않는다.
const SELF_BLOCK_RE = /^generated[ \t]*:[ \t]*\r?\n[ \t]+by: "[^"\r\n]*"[ \t]*\r?\n[ \t]+at: "[^"\r\n]*"[ \t]*$/m;
// 컬럼 0의 키 한 줄 + 뒤따르는 들여쓴 줄 전체를 한 항목으로 잡는다(block/flow/scalar 공통).
const GENERATED_ENTRY_RE = /^generated[ \t]*:(?:[^\n]*)(?:\n[ \t]+[^\n]*)*$/m;
const SAFE_BY_RE = /^okf-system\/[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const SAFE_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export function stampGenerated(text, { by, at }, { trustExisting = true } = {}) {
  if (!SAFE_BY_RE.test(String(by ?? '')) || !SAFE_AT_RE.test(String(at ?? ''))) return null;
  const parsed = parseFrontmatter(text);
  if (!parsed.hasFrontmatter || parsed.parseError || !isPlainObject(parsed.data)) return null;
  const m = FM_SPLIT_RE.exec(text);
  if (!m) return null;

  const fmStart = m[1].length;
  const yamlText = m[2];
  const eol = m[1].endsWith('\r\n') ? '\r\n' : '\n';
  const block = `generated:${eol}  by: "${by}"${eol}  at: "${at}"`;

  let nextYaml;
  if (Object.hasOwn(parsed.data, 'generated')) {
    if (SELF_BLOCK_RE.test(yamlText)) {
      nextYaml = yamlText.replace(SELF_BLOCK_RE, () => block); // 우리 블록 갱신(중복 생성 금지)
    } else if (trustExisting) {
      return null; // 번들에 이미 있던 남의 generated — 존중한다
    } else {
      // 이번 회차에 분석기가 **새로 만든** 파일이다. 여기 있는 generated는 사람이 붙인 것일
      // 수 없다 — 코드가 찍는다는 계약에 따라 통째로 대체한다.
      if (!GENERATED_ENTRY_RE.test(yamlText)) return null;
      nextYaml = yamlText.replace(GENERATED_ENTRY_RE, () => block);
    }
  } else {
    nextYaml = yamlText === '' ? block : `${yamlText}${eol}${block}`;
  }

  if (nextYaml === yamlText) return null;
  return text.slice(0, fmStart) + nextYaml + text.slice(fmStart + yamlText.length);
}
