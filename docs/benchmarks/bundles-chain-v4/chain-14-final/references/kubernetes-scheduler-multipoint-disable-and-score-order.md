---
type: reference
title: 쿠버네티스 스케줄러의 plugins.multiPoint.disabled 적용 시점과 Score 확장점 재나열이 실행 순서에 미치는 영향
description: plugins.multiPoint.disabled는 config 디폴팅 단계의 mergePluginSet(default_plugins.go:110-159, 특히 136-139행 continue)에서 이미 적용되어 profile.Plugins.MultiPoint.Enabled에서 이름이 빠지므로, NewFramework의 pluginsNeeded(framework.go:1601-1621)가 만드는 pg 세트에 애초에 없고 팩토리 호출 루프(framework.go:306-326, 308행 if !pg.Has(name) continue)에서 스킵된다 — 즉 팩토리는 아예 호출되지 않는다. Score 확장점 내 순서는 expandMultiPointPlugins(framework.go:492-577, 554-577행)가 part1 override(Score.Enabled에 재나열되어 MultiPoint 등록을 덮어쓴 것, Score.Enabled 순서 유지)/part2 multiPointEnabled(MultiPoint.Enabled에만 있는 것, 그 나열 순서)/part3 Score.Enabled 전용의 3단계로 정하며, plugins.score.enabled에 이름을 재나열하면 그 플러그인은 enabledSet(500-502행)에 걸려 override로 분류되어(538-542행) part1로 이동, 원래 MultiPoint 순서상 위치보다 앞서 실행되도록 순서가 바뀐다.
resource: pkg/scheduler/apis/config/v1/default_plugins.go, pkg/scheduler/framework/runtime/framework.go (kubernetes 소스 트리, 로컬 작업 트리 기준)
tags: [kubernetes, scheduler, scheduling-framework, go]
timestamp: 2026-07-16
---
# 질문

사용자가 프로필에서 plugins.multiPoint.disabled에 ImageLocality를 넣어 기본 Score 플러그인
하나를 비활성화하고, 동시에 plugins.score.enabled에 NodeResourcesBalancedAllocation을
명시적으로 다시 나열했다고 하자. (1) 이 비활성화 목록은 실제 플러그인 인스턴스화보다 앞서
정확히 어디서 적용되어 ImageLocality의 factory가 아예 호출되지 않게 만드는가? (2) 같은 Score
확장점 안에서 남은 플러그인들의 실행 순서는 무엇이 결정하며, NodeResourcesBalancedAllocation을
재나열하면 순서가 어떻게 바뀌는가?

# 답

## (1) disabled 적용 지점: config 디폴팅의 mergePluginSet

`SetDefaults_KubeSchedulerProfile`이 `prof.Plugins = mergePlugins(logger, getDefaultPlugins(),
prof.Plugins)`를 호출하고(defaults.go:71), mergePlugins는 MultiPoint 확장점에 대해
mergePluginSet을 호출한다(default_plugins.go:89). mergePluginSet 내부에서
`plugins.multiPoint.disabled`의 이름들이 `disabledPlugins` 세트로 모이고(110-122행), 기본
MultiPoint.Enabled 목록을 순회하며 `if disabledPlugins.Has(defaultEnabledPlugin.Name) {
continue }`(136-139행)로 ImageLocality를 최종 `enabledPlugins`에서 제외한다.

이 결과가 반영된 profile.Plugins.MultiPoint.Enabled가 NewFramework에 전달되므로,
`f.pluginsNeeded(profile.Plugins)`가 만드는 pg 세트(framework.go:1601-1621, 1618행에서
MultiPoint.Enabled를 순회해 이름을 모음)에 ImageLocality가 애초에 존재하지 않는다. 따라서
NewFramework의 팩토리 호출 루프(framework.go:306-326)의 `if !pg.Has(name) { continue
}`(308행)에 걸려 registry에 등록된 ImageLocality의 factory 자체가 호출되지 않는다.

즉 disabled 적용 지점은 config 디폴팅(mergePluginSet, default_plugins.go:136-139)이고,
factory 호출 스킵(framework.go:308)은 그 결과가 뒤늦게 관측되는 지점일 뿐이다.

## (2) Score 확장점 내 순서 결정: expandMultiPointPlugins의 3단계 재배열

expandMultiPointPlugins(framework.go:492-577)가 명시적 주석(554-557행)대로 3단계로 순서를
정한다:
- part1 overridePlugins — Score.Enabled에 재나열되어 MultiPoint 쪽 등록을 오버라이드한
  것들, Score.Enabled에 나열된 순서 유지(560-565행)
- part2 multiPointEnabled — Score.Enabled에는 없고 MultiPoint.Enabled에만 있는 것들,
  MultiPoint.Enabled 나열 순서(567-569행)
- part3 그 외 Score.Enabled 전용 플러그인(571-573행)

기본 상태에서 NodeResourcesBalancedAllocation은 MultiPoint.Enabled 목록에서
PodTopologySpread/InterPodAffinity/DefaultPreemption 뒤, ImageLocality 앞
위치(default_plugins.go:49-53)라 part2 순서를 그대로 따른다. `plugins.score.enabled`에
NodeResourcesBalancedAllocation을 재나열하면 expandMultiPointPlugins의 enabledSet(500-502행,
Score.Enabled 기반)에 이 이름이 들어가 있어, MultiPoint.Enabled 순회 중 538-542행 `if
enabledSet.has(ep.Name) { overridePlugins.insert(...); continue }`에 걸려 override로
분류된다. 그 결과 part1로 옮겨져 다른 순수 MultiPoint 전용 Score 플러그인들(NodeResourcesFit,
PodTopologySpread, InterPodAffinity 등)보다 앞서 실행되도록 순서가 바뀐다 — 기존의 "뒤쪽"
위치에서 Score.Enabled에 나열한 위치(대개 맨 앞)로 이동한다.

weight 병합 우선순위(같은 override 메커니즘의 자매 로직)는
[/references/kubernetes-scheduler-score-weight-merge.md](/references/kubernetes-scheduler-score-weight-merge.md)에
정리되어 있다 — 그 문서는 expandMultiPointPlugins의 534-542행 override 로직을 weight
관점에서, 이 문서는 실행 순서 관점에서 다룬다. NodeResourcesBalancedAllocation·ImageLocality
자체의 Score 계산 로직은
[/references/kubernetes-scheduler-noderesourcesfit.md](/references/kubernetes-scheduler-noderesourcesfit.md)와
[/references/kubernetes-scheduler-podtopologyspread.md](/references/kubernetes-scheduler-podtopologyspread.md)를
참고.

# 근거

- `pkg/scheduler/apis/config/v1/defaults.go:71` — `prof.Plugins = mergePlugins(logger, getDefaultPlugins(), prof.Plugins)`
- `pkg/scheduler/apis/config/v1/default_plugins.go:110-159` — mergePluginSet: disabledPlugins 세트 구성(110-122)과 136-139행 continue로 disabled 플러그인 제외
- `pkg/scheduler/apis/config/v1/default_plugins.go:49-53` — 기본 MultiPoint.Enabled 목록 내 NodeResourcesBalancedAllocation·ImageLocality 위치
- `pkg/scheduler/framework/runtime/framework.go:1601-1621` — pluginsNeeded가 (이미 디폴팅으로 disabled 제외된) profile.Plugins에서 pg 세트 구성
- `pkg/scheduler/framework/runtime/framework.go:306-326`, 특히 308행 `if !pg.Has(name) { continue }` — factory 호출 스킵 지점
- `pkg/scheduler/framework/runtime/framework.go:492-577` — expandMultiPointPlugins, 517-542행(override 판정)과 554-577행(3단계 재배열)
