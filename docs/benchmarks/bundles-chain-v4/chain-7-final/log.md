# Log

## 2026-07-16
- k8s-chain digest 반영: `/references/k8s-scheduler-podtopologyspread.md` 신규 작성 — 쿠버네티스 스케줄러 default 프로필의 PodTopologySpread Score 플러그인 구조체·인터페이스·레지스트리 등록 방식 조사 결과
- k8s-chain digest 반영: `/references/k8s-scheduler-noderesourcesfit.md` 신규 작성 — NodeResourcesFit Score 플러그인의 구체 구조체, 전략 패턴(scorer 함수 런타임 주입)으로 인해 Score 로직이 설정에 따라 달라지는 이유, 기본 weight=1·기본 ScoringStrategy.Type=LeastAllocated 조사 결과. PodTopologySpread 문서와 상호 링크
- k8s-chain digest 반영: `/references/k8s-scheduler-score-weight-precedence.md` 신규 작성 — profiles[].plugins.score.enabled에 MultiPoint 기본 플러그인(NodeAffinity 등)을 재나열해 커스텀 weight를 지정하면 getScoreWeights(framework.go:349,428-459)의 first-write-wins 스킵 로직으로 조용히 override되는 이유와 코드 위치 조사 결과. noderesourcesfit 문서와 상호 링크
- k8s-chain digest 반영: `/references/k8s-scheduler-multipoint-disable.md` 신규 작성 — plugins.multiPoint.disabled에 넣은 플러그인(예: ImageLocality)은 런타임 프레임워크가 아니라 config 디폴팅 단계 mergePluginSet(default_plugins.go:110-159)에서 이미 MultiPoint.Enabled 목록에서 제거되어, NewFramework의 pluginsNeeded/factory 루프가 이를 건너뛰므로 factory 자체가 호출되지 않는 조사 결과. score-weight-precedence 문서와 상호 링크(override 재정렬 로직은 그 문서 참조)
