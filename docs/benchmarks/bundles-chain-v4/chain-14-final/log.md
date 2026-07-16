# Log

## 2026-07-16
- [/references/kubernetes-scheduler-podtopologyspread.md](/references/kubernetes-scheduler-podtopologyspread.md) 신규 작성: k8s 스케줄러 기본 프로필에서 PodTopologySpread 플러그인의 Score 실행 구조체·인터페이스·NewInTreeRegistry 등록 방식 조사 결과.
- [/references/kubernetes-scheduler-noderesourcesfit.md](/references/kubernetes-scheduler-noderesourcesfit.md) 신규 작성: NodeResourcesFit 플러그인의 Score 구체 구조체(Fit), scorer 함수 포인터를 통한 전략 패턴 구조(LeastAllocated/MostAllocated/RequestedToCapacityRatio), 기본 weight=1 조사 결과. PodTopologySpread 문서와 상호 링크 추가.
- [/references/kubernetes-scheduler-score-weight-merge.md](/references/kubernetes-scheduler-score-weight-merge.md) 신규 작성: profiles[].plugins.score.enabled에 재나열한 weight가 MultiPoint의 weight보다 우선하는 이유(framework.go:349 append 순서 + getScoreWeights의 442-444행 skip 로직)와 expandMultiPointPlugins의 중복 등록 방지 로직(534-542행, PR #99582) 조사 결과. NodeResourcesFit·PodTopologySpread 문서와 상호 링크 추가.
- [/references/kubernetes-scheduler-multipoint-disable-and-score-order.md](/references/kubernetes-scheduler-multipoint-disable-and-score-order.md) 신규 작성: plugins.multiPoint.disabled가 config 디폴팅 단계의 mergePluginSet(default_plugins.go:136-139)에서 이미 적용되어 factory 호출(framework.go:308) 자체가 스킵되는 흐름과, plugins.score.enabled 재나열이 expandMultiPointPlugins의 3단계 재배열(framework.go:554-577)에서 실행 순서를 앞당기는 메커니즘 조사 결과. score-weight-merge.md와 상호 링크 추가(같은 override 판정이 weight와 순서 둘 다에 관여).
