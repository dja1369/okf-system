import { parseFrontmatter } from './frontmatter.mjs';
import { isPlainObject, toIsoDateTime } from './trust.mjs';

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
const SELF_BLOCK_RE = /^[ \t]*(?:"generated"|'generated'|generated)[ \t]*:[ \t]*\r?\n[ \t]+by: "[^"\r\n]*"[ \t]*\r?\n[ \t]+at: "[^"\r\n]*"[ \t]*$/m;
// 컬럼 0의 키 한 줄 + 뒤따르는 들여쓴 줄 전체를 한 항목으로 잡는다(block/flow/scalar 공통).
const GENERATED_ENTRY_RE = /^[ \t]*(?:"generated"|'generated'|generated)[ \t]*:(?:[^\n]*)(?:\n[ \t]+[^\n]*)*$/m;
const SAFE_BY_RE = /^okf-system\/[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const SAFE_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// 실패 이유를 구분해 돌려준다. 호출자는 **'존중'(RESPECTED) 이외의 실패를 fail-closed로**
// 다뤄야 한다 — 정규식이 모든 유효 YAML 표기(`"generated" :`, 선행 공백, flow 형태 …)를
// 커버한다고 가정하면 그 가정이 깨지는 순간 위조된 출처가 조용히 번들에 실린다.
// 정규식 완전성에 안전을 걸지 마라. 못 찍었으면 그 파일을 반영하지 않는 쪽이 옳다.
export const STAMP_RESPECTED = 'respected';       // 번들에 이미 있던 남의 generated — 정상 스킵
export const STAMP_NOT_APPLICABLE = 'n/a';       // 프론트매터가 없거나 파손 — lint가 다룰 일이다
export const STAMP_UNSTAMPABLE = 'unstampable';  // **generated가 있는데 우리가 못 고친다** — 위조 벡터

export function stampGenerated(text, { by, at }, { trustExisting = true, onSkip } = {}) {
  const skip = (reason) => { if (typeof onSkip === 'function') onSkip(reason); return null; };
  if (!SAFE_BY_RE.test(String(by ?? '')) || !SAFE_AT_RE.test(String(at ?? ''))) return skip(STAMP_UNSTAMPABLE);
  // 모양만 맞는 값(2026-99-99T99:99:99Z)을 스탬핑하면 우리가 직접 거짓 시각을 만든다.
  if (toIsoDateTime(String(at)) !== String(at)) return skip(STAMP_UNSTAMPABLE);
  const parsed = parseFrontmatter(text);
  // 프론트매터가 없거나 파손된 파일은 **차단하지 않는다.** 그건 lint E1의 일이고, 차단하면
  // repair가 그 파일을 고칠 기회 자체를 잃는다(실측: badoutput 회차가 통째로 실패했다).
  // generated 위조 벡터가 아니므로 스탬프만 건너뛴다.
  if (!parsed.hasFrontmatter || parsed.parseError || !isPlainObject(parsed.data)) return skip(STAMP_NOT_APPLICABLE);
  const m = FM_SPLIT_RE.exec(text);
  if (!m) return skip(STAMP_NOT_APPLICABLE);

  const fmStart = m[1].length;
  const yamlText = m[2];
  const eol = m[1].endsWith('\r\n') ? '\r\n' : '\n';
  const block = `generated:${eol}  by: "${by}"${eol}  at: "${at}"`;

  let nextYaml;
  if (Object.hasOwn(parsed.data, 'generated')) {
    if (SELF_BLOCK_RE.test(yamlText)) {
      nextYaml = yamlText.replace(SELF_BLOCK_RE, () => block); // 우리 블록 갱신(중복 생성 금지)
    } else if (trustExisting) {
      return skip(STAMP_RESPECTED); // 번들에 이미 있던 남의 generated — 존중한다
    } else {
      // 이번 회차에 분석기가 **새로 만든** 파일이다. 여기 있는 generated는 사람이 붙인 것일
      // 수 없다 — 코드가 찍는다는 계약에 따라 통째로 대체한다.
      // 여기 도달했는데 정규식이 못 찾는다 = 우리가 모르는 표기다. **차단**이 정답이다.
      if (!GENERATED_ENTRY_RE.test(yamlText)) return skip(STAMP_UNSTAMPABLE);
      nextYaml = yamlText.replace(GENERATED_ENTRY_RE, () => block);
    }
  } else {
    nextYaml = yamlText === '' ? block : `${yamlText}${eol}${block}`;
  }

  if (nextYaml === yamlText) return skip(STAMP_NOT_APPLICABLE);
  return text.slice(0, fmStart) + nextYaml + text.slice(fmStart + yamlText.length);
}
