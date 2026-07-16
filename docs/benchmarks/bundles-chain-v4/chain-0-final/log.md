# Log

## 2026-07-16
- `/references/kubernetes-scheduler-score-plugins.md` 신규 작성: k8s v1.30.0 기본 스케줄러 프로필에서
  PodTopologySpread/NodeResourcesFit 플러그인의 Score 확장점 구조체·인터페이스·레지스트리 등록 방식,
  NodeResourcesFit의 전략 패턴 기반 스코어링과 기본 weight=1 정리 (원본: k8s-chain 두 세션).
- `/references/kubernetes-scheduler-multipoint-override.md` 신규 작성: 동일 Score 플러그인이
  MultiPoint와 profile.Score.Enabled에 동시 등록될 때 병합이 아니라 오버라이드가 일어나는 이유 —
  `expandMultiPointPlugins`의 override 판정과 `getScoreWeights`의 weight 우선순위 반영 로직 정리,
  기존 score-plugins 문서와 상호 링크 (원본: k8s-chain 세션).
- `/references/kubernetes-scheduler-multipoint-override.md` 확장: `plugins.multiPoint.disabled`가
  실제로 적용되는 지점(expandMultiPointPlugins가 아니라 그보다 앞선 default_plugins.go의
  mergePluginSet, 135~139행)과 factory 호출 자체를 막는 게이트(framework.go의 pluginsNeeded +
  308행 pg.Has 체크) 정리, expandMultiPointPlugins가 재조립하는 실행 순서 3단계
  (overridePlugins → multiPointEnabled → 나머지)를 새 섹션으로 추가, description도 이 내용을
  반영해 갱신 (원본: k8s-chain 세션).
