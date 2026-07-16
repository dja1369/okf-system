---
type: reference
title: Kubernetes 스케줄러 Score 플러그인이 MultiPoint와 profile에 동시 등록될 때의 우선순위 (v1.30.0)
description: profiles[].plugins.score.enabled에 플러그인을 이름 그대로 재등록하면 병합이 아니라 오버라이드가 일어나 그 값(weight 포함)이 MultiPoint 기본값을 무조건 이긴다 — pkg/scheduler/framework/runtime/framework.go의 expandMultiPointPlugins(492행경, 534~542행)가 override 판정을, getScoreWeights(428행, 440~444행)가 weight 반영 순서를 결정한다. plugins.multiPoint.disabled로 넣은 플러그인은 그보다 훨씬 앞선 default_plugins.go의 mergePluginSet(135~139행)에서 병합 시점에 걸러져 profile.Plugins.MultiPoint.Enabled에서 아예 빠지고, expandMultiPointPlugins가 재조립하는 최종 실행 순서는 overridePlugins(Score.Enabled 재등록분) → multiPointEnabled(MultiPoint 원래 순서) → 나머지 Score.Enabled 순의 3단계다
tags: [kubernetes, scheduler, go, source-reading]
timestamp: 2026-07-16
---
# Score 플러그인이 MultiPoint와 profile에 동시 등록될 때의 우선순위

Kubernetes v1.30.0 소스 기준 조사 결과. 기본 프로필에서 `NodeAffinity`는 `MultiPoint`를 통해
weight 2로 이미 활성화되어 있다. 사용자가 `profiles[].plugins.score.enabled`에 `NodeAffinity`를
이름 그대로 다시 나열하고 custom weight(예: 5)를 지정하면, 두 값은 병합되지 않고 사용자 값이
오버라이드로 최종 적용된다.

## 왜 충돌 검사 없이 오버라이드가 되는가

1. **`pkg/scheduler/apis/config/v1/default_plugins.go:110` `mergePluginSet`** — 사용자가 지정한
   커스텀 항목은 확장점별 PluginSet(Score는 기본 비어있음)에 그대로 append된다. 이 단계에서는
   아직 MultiPoint 쪽 NodeAffinity(weight 2)와의 크로스 체크가 일어나지 않는다.

2. **`pkg/scheduler/framework/runtime/framework.go:492` `expandMultiPointPlugins`** — 실제
   오버라이드 판정이 일어나는 지점. `enabledSet`(524~538행 부근)에 이미 `Score.Enabled`에 등록된
   플러그인 이름들을 먼저 넣어두고, `MultiPoint.Enabled`를 순회하면서 같은 이름이 `enabledSet`에
   있으면(538행 `enabledSet.has(ep.Name)`) `overridePlugins.insert` 후 `continue`로 MultiPoint 값을
   버린다. 536~542행 주석: "the user intent is to override the default plugin... discard the
   MultiPoint value". 즉 Score 확장점에 명시적으로 재등록된 `NodeAffinity`(weight 5)가 최종
   `f.scorePlugins`에 살아남고 MultiPoint의 weight 2는 무시된다.

3. **`pkg/scheduler/framework/runtime/framework.go:349, 428` `getScoreWeights`** — weight 값
   자체가 반영되는 지점. `plugins` 인자가 `append(profile.Plugins.Score.Enabled,
   profile.Plugins.MultiPoint.Enabled...)`(349행)로 만들어져 **Score.Enabled가 먼저** 순회된다.
   440~444행의 `if _, ok := f.scorePluginWeight[e.Name]; ok { continue }` 때문에 먼저 처리된
   Score.Enabled의 `NodeAffinity`(weight 5)가 `f.scorePluginWeight["NodeAffinity"]`에 먼저
   기록되고, 이후 MultiPoint에서 다시 나오는 `NodeAffinity`(weight 2)는 이미 map에 있으므로
   건너뛴다(주석: "let the individual Score weight take precedence").

같은 코드베이스에서 Score 플러그인 자체의 등록/전략 구조를 다룬 조사는
[/references/kubernetes-scheduler-score-plugins.md](/references/kubernetes-scheduler-score-plugins.md)
참고.

## plugins.multiPoint.disabled는 어디서 적용되어 factory 호출 자체를 막는가

`plugins.multiPoint.disabled`에 넣은 플러그인 이름(예: `ImageLocality`)은 위의 override 판정
(`expandMultiPointPlugins`)보다 훨씬 이전, **프로필 디폴트 병합 단계**에서 이미 걸러진다.

1. `pkg/scheduler/apis/config/v1/defaults.go:71` `prof.Plugins = mergePlugins(logger,
   getDefaultPlugins(), prof.Plugins)` 가 프로필 디폴팅 시 호출된다.
2. `pkg/scheduler/apis/config/v1/default_plugins.go:89`
   `defaultPlugins.MultiPoint = mergePluginSet(logger, defaultPlugins.MultiPoint,
   customPlugins.MultiPoint)` 가 MultiPoint 확장점 전용으로 `mergePluginSet`을 호출한다.
3. `mergePluginSet`(default_plugins.go:110-159) 내부에서 116~122행이 사용자가 지정한
   `customPluginSet.Disabled`를 `disabledPlugins` 셋으로 만들고, 135~149행 루프가
   `defaultPluginSet.Enabled`(기본 MultiPoint 목록)를 순회하며 `disabledPlugins.Has(name)`이면
   그 이름을 건너뛴다(137~139행). 즉 이 시점에 `profile.Plugins.MultiPoint.Enabled`에서
   `ImageLocality`가 완전히 제거된다 — `expandMultiPointPlugins`가 실행되는 시점엔 이미 존재하지
   않는 이름이라 그 함수는 이 케이스를 다룰 일이 없다.
4. `NewFramework`(framework.go:242)가 받는 `profile.Plugins`는 이미 이 상태이고, 288행
   `pg := f.pluginsNeeded(profile.Plugins)`가 각 확장점의 `Enabled`/`MultiPoint.Enabled`만
   순회해 필요한 플러그인 이름 셋을 만든다(`pluginsNeeded`, 1601~1621행 — `Disabled`는 아예
   참조하지 않음, 이미 병합 단계에서 걸러졌으므로 볼 필요가 없다).
5. 팩토리 호출 루프(305~326행)의 308행 `if !pg.Has(name) { continue }` 때문에 `ImageLocality`는
   `pg`에 없으므로 319행 `factory(ctx, args, f)`가 아예 호출되지 않는다.

## Score 확장점 안 나머지 플러그인 실행 순서는 어떻게 재조립되는가

`expandMultiPointPlugins`(framework.go:492-577)가 확장점별로 다음 3단계로 최종 순서를
재조립한다(554~574행):

1. **overridePlugins** — `Score.Enabled`에 이름이 재등록된 플러그인들, `Score.Enabled`에 나열된
   순서 그대로. MultiPoint 쪽 값은 버려진다(위 override 판정 참고).
2. **multiPointEnabled** — override되지 않고 남은 `MultiPoint.Enabled` 플러그인들, MultiPoint에
   등록된 원래 순서.
3. **나머지** — `Score.Enabled`에만 있고 MultiPoint와 무관한 플러그인들.

따라서 `NodeResourcesBalancedAllocation`을 `plugins.score.enabled`에 재나열하면, 그 플러그인은
원래 MultiPoint 순서상의 위치에서 빠져나와 overridePlugins로 분류되어 **part1로 승격** —
같은 Score 확장점 실행 순서의 맨 앞으로 이동하고, 나머지 MultiPoint 기반 Score 플러그인들은
서로의 순서를 유지한 채 그 뒤를 잇는다.

## 근거

- `pkg/scheduler/apis/config/v1/default_plugins.go:30-56` 기본 MultiPoint에 NodeAffinity weight 2로 등록
- `pkg/scheduler/apis/config/v1/default_plugins.go:110-160` `mergePluginSet`
- `pkg/scheduler/framework/runtime/framework.go:492-577` `expandMultiPointPlugins`, 특히 534~542행
- `pkg/scheduler/framework/runtime/framework.go:349` Score.Enabled를 MultiPoint.Enabled보다 앞에 append
- `pkg/scheduler/framework/runtime/framework.go:428-459` `getScoreWeights`, 특히 440~444행
- `pkg/scheduler/apis/config/v1/defaults.go:71` `mergePlugins` 호출
- `pkg/scheduler/apis/config/v1/default_plugins.go:110-159` `mergePluginSet`, 특히 116~122, 135~149행 disabled 필터링
- `pkg/scheduler/framework/runtime/framework.go:242-333` `NewFramework`, 특히 288행 `pluginsNeeded` 호출과 305~326행 factory 호출 루프(308행 게이트)
- `pkg/scheduler/framework/runtime/framework.go:1601-1621` `pluginsNeeded`
