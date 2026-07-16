---
type: reference
title: Kubernetes 기본 스케줄러 프로필의 Score 플러그인 내부 구조 (v1.30.0)
description: PodTopologySpread는 고정 알고리즘의 PodTopologySpread 구조체가 ScorePlugin을 구현해 NewInTreeRegistry에 "PodTopologySpread" 키로 등록되고, NodeResourcesFit은 Fit 구조체가 resourceAllocationScorer.scorer 함수 필드를 ScoringStrategy.Type(LeastAllocated/MostAllocated/RequestedToCapacityRatio) 설정에 따라 런타임 주입하는 전략 패턴이며 기본 weight는 1이다
tags: [kubernetes, scheduler, go, source-reading]
timestamp: 2026-07-16
---
# Kubernetes 기본 스케줄러 프로필의 Score 플러그인 내부 구조

Kubernetes v1.30.0 소스 기준 조사 결과. `pkg/scheduler/framework/plugins/registry.go`의
`NewInTreeRegistry()`가 기본 프로필에 포함되는 인트리 플러그인을 등록하는 지점이다.

## PodTopologySpread

- Score 확장점에서 실행되는 구체 구조체는 `pkg/scheduler/framework/plugins/podtopologyspread`
  패키지의 `PodTopologySpread` 구조체 (plugin.go:61).
- `Score` 메서드(scoring.go:191)와 정규화용 `ScoreExtensions`(scoring.go:269)를 구현.
- `framework.ScorePlugin` 인터페이스를 만족 (plugin.go:74-78, 컴파일 타임
  `var _ framework.ScorePlugin = &PodTopologySpread{}` assertion). 부수적으로
  `PreFilterPlugin`, `FilterPlugin`, `PreScorePlugin`, `EnqueueExtensions`도 만족.
- 등록 방식: `registry.go:65`에서 이름 `names.PodTopologySpread`(= "PodTopologySpread",
  names.go:37)로 `runtime.FactoryAdapter(fts, podtopologyspread.New)`를 값으로 등록.
  팩토리 함수 `podtopologyspread.New`(plugin.go:89, `feature.Features`를 받는 시그니처)를
  `FactoryAdapter`로 감싸 표준 `PluginFactory` 시그니처에 맞춘 뒤
  `map[string]runtime.PluginFactory`에 저장. 프레임워크는 프로필 설정의 plugin 이름으로
  이 팩토리를 찾아 `New`를 호출해 인스턴스를 생성한다.
- Score 계산 알고리즘 자체는 고정되어 있다(설정에 따라 스코어링 함수가 바뀌지 않음) — 아래
  NodeResourcesFit과의 대조점.

## NodeResourcesFit

- Score 확장점에서 실행되는 구체 구조체는 `Fit`(pkg/scheduler/framework/plugins/noderesources/fit.go:85-93),
  내부에 `resourceAllocationScorer`를 embed. `Fit.Score()`(fit.go:503-518)가 내부적으로
  `resourceAllocationScorer.score()`를 호출.
- PodTopologySpread와 달리 Score 로직이 고정된 하나의 알고리즘이 아닌 이유: `resourceAllocationScorer`가
  `scorer func(requested, allocable []int64) int64` 함수 필드를 가지며, 이 함수가
  `NodeResourcesFitArgs.ScoringStrategy.Type` 설정값(`LeastAllocated` / `MostAllocated` /
  `RequestedToCapacityRatio`)에 따라 `nodeResourceStrategyTypeMap`(fit.go:57-83)에서 서로 다른
  구현(leastResourceScorer / mostResourceScorer / requestedToCapacityRatioScorer)으로
  런타임에 주입되는 전략 패턴이기 때문 — 즉 점수 계산식이 컴파일 타임이 아니라 설정으로 결정된다.
  (resource_allocation.go:34-83)
- 기본 weight는 1: `{Name: names.NodeResourcesFit, Weight: ptr.To[int32](1)}`
  (pkg/scheduler/apis/config/v1/default_plugins.go:41).

같은 코드베이스에서 동일 플러그인이 MultiPoint와 profile.Score.Enabled에 동시 등록될 때의
오버라이드/weight 우선순위는
[/references/kubernetes-scheduler-multipoint-override.md](/references/kubernetes-scheduler-multipoint-override.md)
참고.

## 근거

- `pkg/scheduler/framework/plugins/podtopologyspread/plugin.go:60-61, 74-89`
- `pkg/scheduler/framework/plugins/podtopologyspread/scoring.go:191, 269`
- `pkg/scheduler/framework/plugins/names/names.go:37`
- `pkg/scheduler/framework/plugins/registry.go:47, 65`
- `pkg/scheduler/framework/plugins/noderesources/fit.go:57-93, 503-518`
- `pkg/scheduler/framework/plugins/noderesources/resource_allocation.go:34-83`
- `pkg/scheduler/apis/config/v1/default_plugins.go:41`
