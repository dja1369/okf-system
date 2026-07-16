---
type: reference
title: 쿠버네티스 스케줄러 NodeResourcesFit 플러그인의 Score 로직이 설정에 따라 달라지는 구조
description: 기본 프로필의 Score 확장점은 noderesources 패키지의 Fit 구체 구조체가 실행하며(fit.go:504 Score → resource_allocation.go:48 resourceAllocationScorer.score), Fit이 임베드한 resourceAllocationScorer의 scorer 함수 포인터 필드가 NewFit(fit.go:151-177)에서 ScoringStrategy.Type(LeastAllocated/MostAllocated/RequestedToCapacityRatio)에 따라 nodeResourceStrategyTypeMap(fit.go:58-83)에서 골라 주입되는 전략 패턴이라 PodTopologySpread(고정 알고리즘 하나)와 달리 설정마다 계산 로직이 바뀐다. 기본 weight는 1(default_plugins.go:41)
resource: pkg/scheduler/framework/plugins/noderesources (kubernetes 소스 트리, 로컬 작업 트리 기준)
tags: [kubernetes, scheduler, scheduling-framework, go]
timestamp: 2026-07-16
---
# 질문

같은 기본 프로필에서 NodeResourcesFit 플러그인이 Score 확장점에서 실행하는 구체 구조체는
무엇이며, [/references/kubernetes-scheduler-podtopologyspread.md](/references/kubernetes-scheduler-podtopologyspread.md)의
PodTopologySpread와 달리 그 Score 로직이 왜 '고정된 하나의 알고리즘'이 아니라 설정에 따라
달라지는가? 또한 기본 weight는 얼마인가?

# 답

Score 확장점을 실행하는 구체 구조체는 `noderesources.Fit`(pkg/scheduler/framework/plugins/noderesources/fit.go)이다.
`Fit`은 `resourceAllocationScorer`를 임베드하고 있으며, `Fit.Score()`(fit.go:504)는 실제 계산을
`f.score(...)` → 임베드된 `resourceAllocationScorer.score()`(resource_allocation.go:48)에 위임한다.

## 왜 '고정된 하나의 알고리즘'이 아닌가

`resourceAllocationScorer` 구조체(resource_allocation.go:38-45)는
`scorer func(requested, allocable []int64) int64`라는 함수 포인터 필드를 갖는다. 이 함수는
플러그인 생성 시점(`NewFit`, fit.go:151-178)에 `NodeResourcesFitArgs.ScoringStrategy.Type`
설정값에 따라 `nodeResourceStrategyTypeMap`(fit.go:58-83)에서 골라 주입된다. 이 맵은
`LeastAllocated`/`MostAllocated`/`RequestedToCapacityRatio` 세 전략에 각각 다른 `scorer`
클로저(`leastResourceScorer`, `mostResourceScorer`, `requestedToCapacityRatioScorer`)를
매핑한다.

즉 `resourceAllocationScorer.score()` 자체의 흐름(가용/요청량 계산 순서)은 고정이지만, 최종
점수를 만드는 핵심 계산 함수는 설정(ScoringStrategy)에 따라 런타임에 교체되는 전략 패턴이다.
반면 [PodTopologySpread](/references/kubernetes-scheduler-podtopologyspread.md)는 이런
교체형 scorer 없이 자체 스프레드 계산 로직 하나로 고정되어 있다 — 같은 Score 확장점이라도
플러그인마다 설정 가능성의 구조가 다르다.

## 기본 weight

`pkg/scheduler/apis/config/v1/default_plugins.go:41`:
```
{Name: names.NodeResourcesFit, Weight: ptr.To[int32](1)}
```
기본 weight는 1이다.

# 근거

- `fit.go:39-43` Fit이 framework.ScorePlugin 등 인터페이스를 만족
- `fit.go:85-93` Fit 구조체가 resourceAllocationScorer를 임베드
- `fit.go:504-518` Fit.Score()가 f.score()를 호출
- `resource_allocation.go:38-45` resourceAllocationScorer에 scorer 함수 포인터 필드 존재
- `resource_allocation.go:48` score() 메서드가 r.scorer 사용
- `fit.go:58-83` nodeResourceStrategyTypeMap이 LeastAllocated/MostAllocated/RequestedToCapacityRatio별로 다른 scorer 주입
- `fit.go:151-177` NewFit이 args.ScoringStrategy.Type에 따라 scorePlugin(args) 선택
- `pkg/scheduler/apis/config/v1/default_plugins.go:41` 기본 weight=1

# 관련

profiles[].plugins.score.enabled에서 이름을 재나열해 지정한 weight가 MultiPoint의 weight를
어떻게 덮어쓰는지는 [/references/kubernetes-scheduler-score-weight-merge.md](/references/kubernetes-scheduler-score-weight-merge.md)
참고.
