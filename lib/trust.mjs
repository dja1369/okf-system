// OKF v0.2 §5.2/§5.3/§5.5의 신뢰·신선도 필드를 "읽는" 쪽 정규화 계층. 생산은 하지 않는다.
//
// 존재 이유는 하나다: 벤더드 js-yaml(DEFAULT_SCHEMA)이 따옴표 없는 YAML 날짜를 **Date 객체**로
// 만든다. 그래서 같은 필드가 파일마다 string/Date로 갈리고, 문자열 비교가 NaN 비교가 되어
// 어떤 날짜에도 false가 된다 — 실측: '2027-01-05' >= <Date 2026-12-31>도 false다.
// 판정자가 둘 이상이면 `status: Deprecated `(끝 공백)이나 미지 값에서 index.md와 그래프가
// 서로 다른 답을 낸다. 그래서 이 파일이 단일 소유자다.
//
// verified/stale 정규화는 그것을 **읽는 코드가 생기는 커밋**에서 함께 추가한다 —
// "읽는 첫 코드를 쓰기 전에"라는 순서 제약은 같은 커밋으로도 만족되고, 지금 넣으면 소비자
// 0인 코드를 테스트가 살려두는 상태가 된다.
//
// 의존성 0: 다른 lib을 import하지 않는다.

const ISO_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)(Z|[+-]\d{2}:?\d{2})?$/;

// lib/config.mjs의 관용구 + Date 제외. Date를 빼지 않으면 `verified: 2026-07-25`(무따옴표라
// Date가 된다)가 1원소 리스트로 통과한다.
export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

export function toIsoDateTime(v) {
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : `${v.toISOString().slice(0, 19)}Z`;
  }
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s === '') return null;
  if (ISO_DATE_ONLY_RE.test(s)) return `${s}T00:00:00Z`;
  const m = ISO_DATETIME_RE.exec(s);
  if (!m) return null;
  // **무오프셋 문자열에 Z를 붙이는 이 줄을 빼지 마라.** YAML 1.1 규약상 오프셋이 없으면 UTC인데,
  // 안 붙이면 new Date('2026-07-25T10:30:00')이 로컬로 해석돼 따옴표 유무만으로 같은 값이
  // KST 기준 9시간 갈라진다.
  const time = m[2].length === 5 ? `${m[2]}:00` : m[2];
  const parsed = new Date(`${m[1]}T${time}${m[3] ?? 'Z'}`);
  return Number.isNaN(parsed.getTime()) ? null : `${parsed.toISOString().slice(0, 19)}Z`;
}

export function toIsoDate(v) {
  const dt = toIsoDateTime(v);
  return dt ? dt.slice(0, 10) : null;
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
