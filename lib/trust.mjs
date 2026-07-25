// OKF v0.2 §5.2/§5.3/§5.5의 신뢰·신선도 필드를 "읽는" 쪽 정규화 계층. 생산은 하지 않는다.
//
// 존재 이유는 하나다: 벤더드 js-yaml(DEFAULT_SCHEMA)이 따옴표 없는 YAML 날짜를 **Date 객체**로
// 만든다. 그래서 같은 필드가 파일마다 string/Date로 갈리고, 문자열 비교가 NaN 비교가 되어
// 어떤 날짜에도 false가 된다 — 실측: '2027-01-05' >= <Date 2026-12-31>도 false다.
// 판정자가 둘 이상이면 `status: Deprecated `(끝 공백)이나 미지 값에서 index.md와 그래프가
// 서로 다른 답을 낸다. 그래서 이 파일이 단일 소유자다.
//
// verified/stale 정규화(normalizeVerified·isStale)와 날짜-only 축약(toIsoDate)은 그것을
// **읽는 코드가 생기는 커밋**에서 함께 추가한다 — "읽는 첫 코드를 쓰기 전에"라는 순서 제약은
// 같은 커밋으로도 만족되고, 지금 넣으면 소비자 0인 코드를 테스트가 살려두는 상태가 된다.
// (toIsoDate는 실제로 그 상태였다: 독립 검증이 자기충족 단언을 걷어내자 즉시 드러났다.)
//
// 의존성 0: 다른 lib을 import하지 않는다.

const ISO_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)(Z|[+-]\d{2}:?\d{2})?$/;

// lib/config.mjs의 관용구 + Date 제외. Date를 빼지 않으면 `verified: 2026-07-25`(무따옴표라
// Date가 된다)가 1원소 리스트로 통과한다.
export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

// 달력상 존재하지 않는 날짜·시각을 **거부**한다. JS Date는 2026-02-30을 3월 2일로, 24:00을
// 다음날 00:00으로 조용히 보정하는데, 그건 정규화가 아니라 조작이다 — 이 모듈의 존재 이유가
// "같은 값이 파일마다 다르게 읽히는 것을 막는 것"인데 없는 날짜를 그럴듯한 날짜로 바꿔주면
// 그 목적을 정면으로 배반한다. 모르면 null이 정답이다.
function isRealDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function toIsoDateTime(v) {
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : `${v.toISOString().slice(0, 19)}Z`;
  }
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s === '') return null;
  if (ISO_DATE_ONLY_RE.test(s)) {
    const [y0, mo0, d0] = s.split('-').map(Number);
    return isRealDate(y0, mo0, d0) ? `${s}T00:00:00Z` : null;
  }
  const m = ISO_DATETIME_RE.exec(s);
  if (!m) return null;
  const [y, mo, d] = m[1].split('-').map(Number);
  if (!isRealDate(y, mo, d)) return null;
  const [hh, mm, ss = '0'] = m[2].split(':');
  // 24:00과 23:59:60(윤초)은 ISO 8601이 허용하지만 JS Date는 각각 다음날/다음분으로 보정한다.
  // 여기서는 둘 다 거부한다 — 보정된 값을 원본인 척 돌려주지 않는 것이 이 계층의 계약이다.
  if (Number(hh) > 23 || Number(mm) > 59 || Number.parseFloat(ss) >= 60) return null;
  // **무오프셋 문자열에 Z를 붙이는 이 줄을 빼지 마라.** YAML 1.1 규약상 오프셋이 없으면 UTC인데,
  // 안 붙이면 new Date('2026-07-25T10:30:00')이 로컬로 해석돼 따옴표 유무만으로 같은 값이
  // KST 기준 9시간 갈라진다.
  const time = m[2].length === 5 ? `${m[2]}:00` : m[2];
  const parsed = new Date(`${m[1]}T${time}${m[3] ?? 'Z'}`);
  return Number.isNaN(parsed.getTime()) ? null : `${parsed.toISOString().slice(0, 19)}Z`;
}

export function generatedAt(fm) {
  // `fm.generated?.at`을 그냥 쓰면 안 된다 — generated가 문자열이면 `.at`이 String.prototype.at
  // (함수)으로 잡혀 truthy가 되고, 배열이어도 Array.prototype.at이 잡힌다(실측).
  // 옵셔널 체이닝만으로는 잘못 통과한다.
  if (!isPlainObject(fm)) return null;
  const g = fm.generated;
  if (!isPlainObject(g)) return null;
  return toIsoDateTime(g.at);
}

const CONCEPT_STATUSES = new Set(['draft', 'stable', 'deprecated']);

// §5.4: status 부재 시 stable. §11: 미지 값을 이유로 문서를 거부하지 않는다 -> stable로 흡수한다.
// 판정자를 여기 하나로 두지 않으면 `status: Deprecated `(끝 공백)이나 미지 값에서 index.md와
// 그래프가 서로 다른 답을 낸다. lib/frontmatter.mjs에는 **쓰기 전용** setFrontmatterStatus만 둔다.
export function conceptStatus(fm) {
  if (!isPlainObject(fm)) return 'stable';
  const raw = fm.status;
  if (typeof raw !== 'string') return 'stable';
  const v = raw.trim().toLowerCase();
  return CONCEPT_STATUSES.has(v) ? v : 'stable';
}
