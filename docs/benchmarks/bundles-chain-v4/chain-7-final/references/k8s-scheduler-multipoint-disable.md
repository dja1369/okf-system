---
type: reference
title: KubeSchedulerConfiguration의 plugins.multiPoint.disabled가 플러그인 factory 호출을 막는 지점
description: "MultiPoint.disabled에 넣은 플러그인(예: ImageLocality)은 런타임 프레임워크가 아니라 config 디폴팅 단계 mergePluginSet(pkg/scheduler/apis/config/v1/default_plugins.go:110-159, disabledPlugins.Has 체크)에서 이미 profile.Plugins.MultiPoint.Enabled 목록에서 제거되고, NewFramework의 pluginsNeeded(framework.go:1601-1621, MultiPoint.Enabled만 순회)가 만드는 집합에 없으므로 factory 루프(framework.go:306-323)가 continue로 건너뛰어 factory 자체가 호출되지 않는다"
tags: [kubernetes, scheduler, framework, multipoint, plugin-disable]
timestamp: 2026-07-16
---
# KubeSchedulerConfiguration의 plugins.multiPoint.disabled가 플러그인 factory 호출을 막는 지점

## 결론

`profiles[].plugins.multiPoint.disabled`에 이름(예: `ImageLocality`)을 넣으면, 그 제거는
런타임 프레임워크가 아니라 **config 디폴팅 단계**에서 이미 끝난다.

1. `SetDefaults_KubeSchedulerProfile`(`pkg/scheduler/apis/config/v1/defaults.go:71`)이
   `prof.Plugins = mergePlugins(logger, getDefaultPlugins(), prof.Plugins)`를 호출한다 —
   이는 `runtime.NewFramework` 호출보다 훨씬 이전, KubeSchedulerConfiguration을 내부
   타입으로 변환하기 전 시점이다.
2. `mergePluginSet`(`default_plugins.go:110-159`)이 디폴트 MultiPoint 목록(`getDefaultPlugins`,
   30-61행)을 순회하며 136-139행에서:
   ```go
   for _, defaultEnabledPlugin := range defaultPluginSet.Enabled {
       if disabledPlugins.Has(defaultEnabledPlugin.Name) {
           continue   // ImageLocality가 여기서 걸러짐
       }
       ...
   }
   ```
   `ImageLocality`가 `disabledPlugins` set에 있으므로 병합 결과인
   `profile.Plugins.MultiPoint.Enabled`에는 아예 포함되지 않는다.
3. 그 결과 `runtime/framework.go`의 `NewFramework`가 `pluginsNeeded(profile.Plugins)`
   (288행 호출, 정의는 1601-1621행)를 계산할 때 `find(&plugins.MultiPoint)`가
   `MultiPoint.Enabled`만 순회하므로 `ImageLocality`는 필요 플러그인 집합(`pgSet`)에
   들어가지 않는다.
4. 이어지는 factory 루프(306-323행) `for name, factory := range r { if !pg.Has(name) { continue } ... factory(ctx, args, f) }`에서
   `pg.Has("ImageLocality")`가 false이므로 `continue`로 건너뛰어 **factory가 아예
   호출되지 않는다.**

즉 "disable"은 프레임워크의 플러그인 인스턴스화 로직이 아니라, 그보다 앞선 config 병합
단계에서 디폴트 MultiPoint 목록을 짧게 만드는 것으로 구현되어 있다. 프레임워크는 그
결과만 보고 필요한 집합을 계산하므로, 비활성 플러그인은 프레임워크 코드 관점에서는
"애초에 존재한 적 없는" 것처럼 취급된다.

같은 Score 확장점 안에서 남은 플러그인들의 실행 순서(override/재정렬 규칙)는
[/references/k8s-scheduler-score-weight-precedence.md](/references/k8s-scheduler-score-weight-precedence.md)의
`expandMultiPointPlugins` part 1/2/3 규칙이 그대로 적용된다 — `plugins.score.enabled`에
플러그인을 재나열하면 `overridePlugins`로 분류되어 MultiPoint 순서 대신 Score.Enabled에
나열한 순서로 실행 위치가 바뀐다(같은 함수 538-542행).

이 조사는 [/references/k8s-scheduler-noderesourcesfit.md](/references/k8s-scheduler-noderesourcesfit.md),
[/references/k8s-scheduler-podtopologyspread.md](/references/k8s-scheduler-podtopologyspread.md)와
같은 스케줄러 프레임워크 소스 조사 계열이다.

## 근거

- `pkg/scheduler/apis/config/v1/defaults.go:71` — `prof.Plugins = mergePlugins(logger, getDefaultPlugins(), prof.Plugins)`, factory 호출 이전 config 디폴팅 단계에서 실행
- `pkg/scheduler/apis/config/v1/default_plugins.go:110-159` — `mergePluginSet`: `disabledPlugins.Has` 체크로 `defaultPluginSet.Enabled` 순회 중 continue
- `pkg/scheduler/apis/config/v1/default_plugins.go:30-61` — `getDefaultPlugins`: `ImageLocality`가 `MultiPoint.Enabled` 기본 목록에 있음(52행)
- `pkg/scheduler/framework/runtime/framework.go:288,306-326` — `NewFramework`: `pluginsNeeded`/factory 루프, `pg.Has(name)`이 false면 continue
- `pkg/scheduler/framework/runtime/framework.go:1601-1621` — `pluginsNeeded`: `find(&plugins.MultiPoint)`로 `MultiPoint.Enabled`만 집합에 삽입
