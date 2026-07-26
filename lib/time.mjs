// 리뷰 지적(사후 반영): capture.mjs는 로컬 날짜(toLocaleDateString('en-CA'))를 쓰는데
// batch.mjs는 toISOString(UTC)을 섞어 써서, UTC+ 시간대의 이른 새벽 시간대에 라벨이 하루
// 어긋났다(§5-2/§5-5/§6 안건5가 명시하는 "로컬 날짜" 요구와 불일치). 한 곳으로 통일한다 —
// 소비자가 둘 이상이 됐으므로 정의를 여기 둔다.
export function localDateString(date = new Date()) {
  return date.toLocaleDateString('en-CA');
}
