---
type: reference
title: 쿠버네티스 스케줄러 default 프로필의 PodTopologySpread Score 플러그인 구조
description: Score 확장점에서 실행되는 구체 구조체는 podtopologyspread.PodTopologySpread(k8s.io/kubernetes/pkg/scheduler/framework/plugins/podtopologyspread)이며, framework.ScorePlugin(및 PreFilterPlugin/FilterPlugin/PreScorePlugin/EnqueueExtensions)을 만족하고, NewInTreeRegistry(pkg/scheduler/framework/plugins/registry.go)에 이름 podtopologyspread.Name(=names.PodTopologySpread="PodTopologySpread")을 키로 runtime.FactoryAdapter(fts, podtopologyspread.New)를 팩토리로 등록해 프레임워크가 이 이름으로 조회한다
tags: [kubernetes, scheduler, framework, podtopologyspread]
timestamp: 2026-07-16
---
# 쿠버네티스 스케줄러 default 프로필의 PodTopologySpread Score 플러그인 구조

## 결론

기본(default) 스케줄러 프로필의 Score 확장점에서 실행되는 구체 구조체는
`podtopologyspread.PodTopologySpread`(패키지 `k8s.io/kubernetes/pkg/scheduler/framework/plugins/podtopologyspread`)다.

이 구조체는 `framework.ScorePlugin` 인터페이스(Score, ScoreExtensions 메서드)를 만족하며,
동시에 `framework.PreFilterPlugin`, `framework.FilterPlugin`, `framework.PreScorePlugin`,
`framework.EnqueueExtensions`도 함께 구현한다 — 즉 여러 확장점에 동일 인스턴스가 등록된다.

인메모리 레지스트리 `NewInTreeRegistry`(`pkg/scheduler/framework/plugins/registry.go`)에는
`podtopologyspread.Name`(= 상수 `names.PodTopologySpread` = 문자열 `"PodTopologySpread"`)을 키로,
`runtime.FactoryAdapter(fts, podtopologyspread.New)`를 팩토리 함수 값으로 등록한다.
프레임워크는 이 이름(`"PodTopologySpread"`)으로 registry 맵을 조회해 팩토리를 호출하고,
`podtopologyspread.New()`가 반환한 `*PodTopologySpread` 인스턴스를 각 확장점
(PreFilter/Filter/PreScore/Score)에 연결한다.

## 근거

- `pkg/scheduler/framework/plugins/podtopologyspread/plugin.go:60-78` — `type PodTopologySpread struct{...}`; `var _ framework.ScorePlugin = &PodTopologySpread{}` 등 인터페이스 만족 선언
- `pkg/scheduler/framework/plugins/podtopologyspread/plugin.go:81` — `const Name = names.PodTopologySpread`
- `pkg/scheduler/framework/plugins/names/names.go:37` — `PodTopologySpread = "PodTopologySpread"`
- `pkg/scheduler/framework/plugins/podtopologyspread/scoring.go:191` — `func (pl *PodTopologySpread) Score(...)`
- `pkg/scheduler/framework/plugins/podtopologyspread/scoring.go:269` — `func (pl *PodTopologySpread) ScoreExtensions() framework.ScoreExtensions`
- `pkg/scheduler/framework/plugins/registry.go:65` — `podtopologyspread.Name: runtime.FactoryAdapter(fts, podtopologyspread.New)` (`NewInTreeRegistry` 맵 항목)

## 관련

[/references/k8s-scheduler-noderesourcesfit.md](/references/k8s-scheduler-noderesourcesfit.md) —
같은 default 프로필의 NodeResourcesFit은 이 플러그인과 달리 scorer 함수를 설정에 따라
런타임 주입하는 전략 패턴 구조라 Score 로직이 고정돼 있지 않다.
