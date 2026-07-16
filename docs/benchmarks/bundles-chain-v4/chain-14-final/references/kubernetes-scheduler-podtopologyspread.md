---
type: reference
title: 쿠버네티스 스케줄러 PodTopologySpread 플러그인의 Score 실행 구조
description: 기본 프로필의 Score 확장점은 podtopologyspread 패키지의 PodTopologySpread 구체 구조체가 실행하며(scoring.go:191 Score, :227 NormalizeScore, :268 ScoreExtensions), framework.ScorePlugin·PreFilterPlugin·FilterPlugin·PreScorePlugin·EnqueueExtensions를 함께 만족하고(plugin.go:74-78), NewInTreeRegistry()가 registry.go:65에서 names.PodTopologySpread("PodTopologySpread") 키에 runtime.FactoryAdapter(fts, podtopologyspread.New)를 등록해 프레임워크가 프로필의 플러그인 이름으로 이 맵을 조회한다
resource: pkg/scheduler/framework/plugins/podtopologyspread (kubernetes 소스 트리, 로컬 작업 트리 기준)
tags: [kubernetes, scheduler, scheduling-framework, go]
timestamp: 2026-07-16
---
# 질문

쿠버네티스 스케줄러의 기본(default) 프로필에서, PodTopologySpread 플러그인은 Score 확장점에서
어떤 구체 구조체가 실행되며, 어떤 인터페이스를 만족하고, 인메모리 레지스트리(`NewInTreeRegistry`)에는
어떤 이름/방식으로 등록되어 프레임워크가 그것을 찾아내는가.

# 답

Score 확장점은 `pkg/scheduler/framework/plugins/podtopologyspread` 패키지의 `PodTopologySpread`
구체 구조체가 실행한다. 이 구조체는 다음을 구현해 `framework.ScorePlugin` 인터페이스를 만족한다:

- `Score(ctx, cycleState, pod, nodeName) (int64, *framework.Status)` — scoring.go:191
- `NormalizeScore(...)` — scoring.go:227
- `ScoreExtensions()` — scoring.go:268

동시에 `framework.PreFilterPlugin`, `framework.FilterPlugin`, `framework.PreScorePlugin`,
`framework.EnqueueExtensions` 인터페이스도 함께 구현한다(plugin.go:74-78, 컴파일 타임 단언
`var _ framework.ScorePlugin = &PodTopologySpread{}`이 plugin.go:77에 있음).

## 레지스트리 등록 방식

`pkg/scheduler/framework/plugins/registry.go`의 `NewInTreeRegistry()` 함수 내부, `runtime.Registry`
(즉 `map[string]runtime.PluginFactory`) 리터럴에 다음 항목으로 등록된다(registry.go:65):

```
podtopologyspread.Name: runtime.FactoryAdapter(fts, podtopologyspread.New)
```

- 키 `podtopologyspread.Name`은 `names.PodTopologySpread` 상수, 즉 문자열 `"PodTopologySpread"`이다
  (names.go:37).
- 값은 `podtopologyspread.New` 팩토리 함수를 feature-gate 값(`fts`)으로 감싼
  `runtime.FactoryAdapter` 클로저다.

프레임워크는 프로필 설정에 지정된 플러그인 이름(`"PodTopologySpread"`)으로 이 맵을 조회해
팩토리를 호출하고, `New()`(scoring.go:89~)가 반환한 `*PodTopologySpread` 인스턴스를
`framework.ScorePlugin`으로 사용한다.

# 근거

- `pkg/scheduler/framework/plugins/podtopologyspread/plugin.go:60-78` (struct 정의, 인터페이스 단언)
- `pkg/scheduler/framework/plugins/podtopologyspread/scoring.go:188-268` (Score, NormalizeScore, ScoreExtensions)
- `pkg/scheduler/framework/plugins/registry.go:65` (NewInTreeRegistry 내 등록)
- `pkg/scheduler/framework/plugins/names/names.go:37` (`PodTopologySpread = "PodTopologySpread"`)

# 관련

NodeResourcesFit 플러그인은 이와 달리 설정(ScoringStrategy)에 따라 Score 계산 함수 자체가
전략 패턴으로 교체된다:
[/references/kubernetes-scheduler-noderesourcesfit.md](/references/kubernetes-scheduler-noderesourcesfit.md)

profiles[].plugins.score.enabled와 MultiPoint 사이의 weight 병합/우선순위 로직은
[/references/kubernetes-scheduler-score-weight-merge.md](/references/kubernetes-scheduler-score-weight-merge.md)
참고.
