---
type: reference
title: KubeSchedulerConfiguration에서 Score 플러그인 weight 재정의(override) 우선순위
description: "profiles[].plugins.score.enabled에 MultiPoint 기본 등록 플러그인(예: NodeAffinity, 기본 weight=2)을 이름 그대로 다시 나열하고 커스텀 weight(예: 5)를 지정하면, 병합 없이 first-write-wins로 조용히 override된다 — 핵심은 pkg/scheduler/framework/runtime/framework.go의 getScoreWeights(349행 호출, 428-459행 정의)가 append(Score.Enabled, MultiPoint.Enabled...) 순서로 순회하며 442-444행에서 이미 scorePluginWeight 맵에 세팅된 이름은 continue로 스킵하기 때문"
tags: [kubernetes, scheduler, framework, score-weight, multipoint]
timestamp: 2026-07-16
---
# KubeSchedulerConfiguration에서 Score 플러그인 weight 재정의(override) 우선순위

## 결론

`profiles[].plugins.score.enabled`에 MultiPoint를 통해 이미 기본 활성화된 플러그인(예:
NodeAffinity, 기본 weight=2)을 이름 그대로 다시 나열하며 커스텀 weight(예: 5)를 지정하면,
두 값은 "병합"되는 게 아니라 **먼저 세팅된 값이 우선하고 이후 값은 스킵되는 first-write-wins**
로직으로 충돌 에러 없이 조용히 override된다.

핵심 코드는 `pkg/scheduler/framework/runtime/framework.go`의 `getScoreWeights` 함수
(428-459행)이며, 호출부는 349행:

```go
getScoreWeights(f, append(profile.Plugins.Score.Enabled, profile.Plugins.MultiPoint.Enabled...))
```

`Score.Enabled`를 먼저, `MultiPoint.Enabled`를 뒤에 이어붙인 슬라이스를 순회한다.
`getScoreWeights` 내부(442-444행):

```go
if _, ok := f.scorePluginWeight[e.Name]; ok {
    continue
}
```

이미 `scorePluginWeight` 맵에 값이 세팅된 이름은 스킵한다. 사용자가 `Score.Enabled`에
NodeAffinity를 weight=5로 다시 나열하면 슬라이스 앞부분에 있으므로 먼저 처리되어
`scorePluginWeight["NodeAffinity"] = 5`로 세팅되고, 뒤이어 나오는 MultiPoint의 weight=2
항목은 위 `continue`에 걸려 무시된다. 함수 주석(428-429행)에도 "individual Score plugin
weights take precedence"라고 명시되어 있다.

실행할 플러그인 인스턴스(순서) 자체를 정하는 `expandMultiPointPlugins`(같은 파일
492-577행)에서도 동일한 우선순위 원칙이 적용된다: 538-542행에서 `enabledSet.has(ep.Name)`
(즉 이미 `Score.Enabled`에 명시된 이름)이면 MultiPoint 쪽 등록을 버리고("overriding")
명시적 Score 항목을 사용한다. 즉 인스턴스 선택과 weight 결정 둘 다 "명시적으로 다시 나열된
항목이 MultiPoint 기본값을 덮어쓴다"는 동일한 규칙을 따른다.

별개로, v1 config → internal config 변환 단계의 `mergePlugins`/`mergePluginSet`
(`pkg/scheduler/apis/config/v1/default_plugins.go:84-160`)은 이 사례와는 무관하다 —
NodeAffinity는 기본 `Score.Enabled` 목록 자체에 없고 오직 `MultiPoint.Enabled`에만
있으므로, 이 병합 단계에서는 사용자의 재나열 항목이 그냥 `Score.Enabled`에 append될 뿐이고
실제 weight 우선순위 결정은 이보다 나중 단계인 `getScoreWeights`에서 일어난다.

이 조사는 [/references/k8s-scheduler-noderesourcesfit.md](/references/k8s-scheduler-noderesourcesfit.md),
[/references/k8s-scheduler-podtopologyspread.md](/references/k8s-scheduler-podtopologyspread.md)와
같은 스케줄러 프레임워크 소스 조사 계열이다.

`multiPoint.disabled`로 플러그인 자체를 비활성화하는 경우(factory가 아예 호출되지 않는
경로)는 이 override/재정렬 로직보다 앞선 config 디폴팅 단계에서 처리된다 — 자세한 내용은
[/references/k8s-scheduler-multipoint-disable.md](/references/k8s-scheduler-multipoint-disable.md) 참고.

## 근거

- `pkg/scheduler/framework/runtime/framework.go:349` — `getScoreWeights(f, append(profile.Plugins.Score.Enabled, profile.Plugins.MultiPoint.Enabled...))`
- `pkg/scheduler/framework/runtime/framework.go:428-459` — `getScoreWeights`: "individual Score plugin weights take precedence" 주석, 442-444행 continue(이미 세팅된 이름 스킵)
- `pkg/scheduler/framework/runtime/framework.go:492-577` — `expandMultiPointPlugins`, 특히 538-542행: `enabledSet.has(ep.Name)`이면 "MultiPoint plugin is explicitly re-configured; overriding" 로깅 후 MultiPoint 값 폐기
- `pkg/scheduler/apis/config/v1/default_plugins.go:32-56` — `getDefaultPlugins()`: NodeAffinity는 `MultiPoint.Enabled`에만 weight=2로 등록, `Score.Enabled` 기본 목록 자체가 없음
- `pkg/scheduler/apis/config/v1/default_plugins.go:84-160` — `mergePlugins`/`mergePluginSet`: v1 config 병합 단계이지만 NodeAffinity가 기본 `Score.Enabled`에 없어 여기서는 단순 append
