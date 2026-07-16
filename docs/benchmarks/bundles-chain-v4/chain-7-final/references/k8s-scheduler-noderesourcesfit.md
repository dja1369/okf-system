---
type: reference
title: 쿠버네티스 스케줄러 default 프로필의 NodeResourcesFit Score 플러그인 구조
description: Score 확장점에서 실행되는 구체 구조체는 noderesources.Fit(pkg/scheduler/framework/plugins/noderesources)이며, resourceAllocationScorer가 갖는 scorer func(requested, allocable []int64) int64 필드가 NodeResourcesFitArgs.ScoringStrategy.Type(LeastAllocated/MostAllocated/RequestedToCapacityRatio)에 따라 nodeResourceStrategyTypeMap에서 런타임에 주입되는 전략 패턴이라 점수 산식이 설정에 따라 달라진다. 기본 profile weight=1(default_plugins.go:41), 기본 ScoringStrategy.Type=LeastAllocated(defaults.go:228-231)
tags: [kubernetes, scheduler, framework, noderesourcesfit]
timestamp: 2026-07-16
---
# 쿠버네티스 스케줄러 default 프로필의 NodeResourcesFit Score 플러그인 구조

## 결론

기본(default) 스케줄러 프로필의 Score 확장점에서 실행되는 구체 구조체는
`noderesources.Fit`(패키지 `pkg/scheduler/framework/plugins/noderesources`)이다.
`framework.ScorePlugin`(및 PreFilter/Filter/PreScore/EnqueueExtensions)을 만족하며,
`Fit.Score()`는 자신에게 임베드된 `resourceAllocationScorer.score()`를 호출해 점수를 계산한다.

[/references/k8s-scheduler-podtopologyspread.md](/references/k8s-scheduler-podtopologyspread.md)의
`PodTopologySpread`와 달리, `Fit`의 Score 로직은 고정된 하나의 알고리즘이 아니다:
`resourceAllocationScorer` 구조체(`resource_allocation.go:38-45`)는
`scorer func(requested, allocable []int64) int64`라는 함수 필드를 갖고, 이 함수는 `NewFit()`이
플러그인을 생성할 때 `NodeResourcesFitArgs.ScoringStrategy.Type` 값
(`LeastAllocated` / `MostAllocated` / `RequestedToCapacityRatio`)에 따라
`nodeResourceStrategyTypeMap`(`fit.go:58-83`)에서 골라 런타임에 주입된다. 즉 `Fit` 구조체
자체는 "점수를 계산한다"는 뼈대만 고정돼 있고, 실제 점수 산식(적게 쓴 노드 선호 /
많이 쓴 노드 선호 / 커스텀 shape 비율)은 `KubeSchedulerConfiguration`의 pluginConfig args에
따라 결정되는 전략 패턴(strategy pattern) 구조다. 반면 `PodTopologySpread`는 이런 교체
가능한 scorer 함수 슬롯 없이 스프레드 제약을 계산하는 고정된 하나의 알고리즘만 가진다.

기본 profile에서 `NodeResourcesFit`의 기본 weight는 1이고(`default_plugins.go:41`),
기본 `ScoringStrategy.Type`은 `LeastAllocated`다(`defaults.go:228-231`).

## 근거

- `pkg/scheduler/framework/plugins/noderesources/fit.go:39-43` — Fit이 구현하는 인터페이스들
- `pkg/scheduler/framework/plugins/noderesources/fit.go:57-83` — `nodeResourceStrategyTypeMap`: 전략별 scorer 주입
- `pkg/scheduler/framework/plugins/noderesources/fit.go:86-93` — `type Fit struct`, `resourceAllocationScorer` 임베드
- `pkg/scheduler/framework/plugins/noderesources/fit.go:150-178` — `NewFit`: `args.ScoringStrategy.Type`으로 scorer 선택
- `pkg/scheduler/framework/plugins/noderesources/fit.go:503-518` — `Fit.Score` → `f.score` 호출
- `pkg/scheduler/framework/plugins/noderesources/resource_allocation.go:34-45` — `scorer` 타입, `resourceAllocationScorer` 구조체, scorer 함수 필드
- `pkg/scheduler/apis/config/v1/default_plugins.go:41` — `NodeResourcesFit` 기본 weight=1
- `pkg/scheduler/apis/config/v1/defaults.go:228-231` — 기본 `ScoringStrategy.Type`=`LeastAllocated`

관련: 사용자가 `profiles[].plugins.score.enabled`에서 weight를 재정의할 때의 우선순위 규칙은
[/references/k8s-scheduler-score-weight-precedence.md](/references/k8s-scheduler-score-weight-precedence.md) 참고.
