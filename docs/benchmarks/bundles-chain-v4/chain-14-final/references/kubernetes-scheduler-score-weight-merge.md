---
type: reference
title: 쿠버네티스 스케줄러가 profiles[].plugins.score.enabled와 MultiPoint의 중복 weight를 병합하는 방식
description: Score.Enabled에 이름을 재나열해 지정한 weight가 MultiPoint의 weight보다 항상 우선 적용된다. framework.go:349에서 append(Score.Enabled, MultiPoint.Enabled...) 순서로 getScoreWeights(framework.go:428-456)에 넘기고, 442-444행의 "이미 f.scorePluginWeight[e.Name]에 있으면 skip" 로직 때문에 먼저 오는 Score.Enabled 쪽 값이 유지된다. 플러그인 등록 자체의 중복 방지는 expandMultiPointPlugins(framework.go:492-577, 534-542행 override 로직, PR #99582)가 담당한다.
resource: pkg/scheduler/framework/runtime/framework.go (kubernetes 소스 트리, 로컬 작업 트리 기준)
tags: [kubernetes, scheduler, scheduling-framework, go]
timestamp: 2026-07-16
---
# 질문

KubeSchedulerConfiguration에서 profiles[].plugins.score.enabled에 NodeAffinity를 이름
그대로 다시 나열하며 커스텀 weight(예: 5)를 지정했을 때, 기본 프로필에서 MultiPoint를 통해
이미 weight 2로 활성화된 NodeAffinity와 충돌하지 않고 사용자의 5가 최종 적용되는 이유는
무엇이며, 그 병합/우선순위 결정은 정확히 어느 함수/코드에서 일어나는가?

# 답

개별 확장점(Score.Enabled)에 명시된 weight가 MultiPoint의 weight보다 항상 먼저 등록되고,
이미 등록된 이름은 덮어쓰지 않기 때문에 사용자가 지정한 값이 최종 적용된다.

## weight 병합: getScoreWeights (framework.go:428-456)

프로필 생성 로직 349행에서
```go
getScoreWeights(f, append(profile.Plugins.Score.Enabled, profile.Plugins.MultiPoint.Enabled...))
```
로 호출한다. append 순서상 `profile.Plugins.Score.Enabled`(사용자가 이름을 재나열하며
weight=5로 지정한 항목)가 먼저 오고 `profile.Plugins.MultiPoint.Enabled`(NodeAffinity
weight=2)가 뒤에 온다.

`getScoreWeights` 내부 루프(434-450행)는 각 plugin `e`에 대해:
- 442-444행: `if _, ok := f.scorePluginWeight[e.Name]; ok { continue }` — 이미
  `f.scorePluginWeight` 맵에 이름이 등록되어 있으면 건너뜀.
- 447행: 처음 등록될 때만 `f.scorePluginWeight[e.Name] = int(e.Weight)`로 값을 채움.

따라서 NodeAffinity는 Score.Enabled 쪽에서 먼저 처리되어 weight=5로
`f.scorePluginWeight["NodeAffinity"]`에 기록되고, 뒤이어 MultiPoint 쪽의 NodeAffinity(weight=2)가
나와도 이미 맵에 존재하므로 스킵되어 2로 덮어써지지 않는다. 428-429행 주석에 "individual Score
plugin weight take precedence"라고 명시되어 있다.

## 플러그인 등록 자체의 중복 방지: expandMultiPointPlugins (framework.go:492-577)

weight와 별개로 플러그인 인스턴스 자체의 이중 등록 문제는 `expandMultiPointPlugins`가 처리한다.
534-542행에 "이미 특정 확장점(Score.Enabled)에 명시적으로 등록된 플러그인은 MultiPoint 쪽 등록을
버리고 override로 표시한다"는 로직이 있다(kubernetes/kubernetes PR #99582). 이 덕분에 이름을
그대로 재나열해도 이중 등록 에러가 나지 않고, 사용자의 명시적 설정이 우선한다는 동일한 원칙을
따른다.

이 우선순위 로직은 [/references/kubernetes-scheduler-noderesourcesfit.md](/references/kubernetes-scheduler-noderesourcesfit.md)와
[/references/kubernetes-scheduler-podtopologyspread.md](/references/kubernetes-scheduler-podtopologyspread.md)가
다루는 개별 플러그인의 Score 계산 로직과는 별개 단계다 — weight 병합은 그 계산 결과에 곱해질
가중치를 프로필 빌드 시점에 결정하는 상위 레이어다.

같은 override 판정(538-542행)이 weight뿐 아니라 **실행 순서**도 결정한다 — Score.Enabled에
재나열된 플러그인은 expandMultiPointPlugins의 3단계 재배열에서 다른 MultiPoint 전용
플러그인들보다 앞선 순서로 옮겨진다. 자세한 내용과 plugins.multiPoint.disabled의 적용 시점은
[/references/kubernetes-scheduler-multipoint-disable-and-score-order.md](/references/kubernetes-scheduler-multipoint-disable-and-score-order.md)
참고.

# 근거

- `pkg/scheduler/framework/runtime/framework.go:349` - `getScoreWeights(f, append(profile.Plugins.Score.Enabled, profile.Plugins.MultiPoint.Enabled...))`
- `pkg/scheduler/framework/runtime/framework.go:428-456` - getScoreWeights 함수, 440-444행에 "let the individual Score weight take precedence" 주석
- `pkg/scheduler/framework/runtime/framework.go:442-444` - `if _, ok := f.scorePluginWeight[e.Name]; ok { continue }`
- `pkg/scheduler/framework/runtime/framework.go:492-577` - expandMultiPointPlugins, 534-542행 override 로직, kubernetes/kubernetes PR #99582 참조
