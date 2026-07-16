---
type: decision
title: 팀 용어 "에미터"는 OutputBufferingMiddleware를 가리키며 /legacy 그룹에만 PREPEND로 배선한다
description: "이 팀에서 \"에미터\"라고 하면 100% Slim의 OutputBufferingMiddleware를 뜻하고 ResponseEmitter를 뜻하는 경우는 없다 — 워커 배포에서는 App::run()을 안 부르므로 ResponseEmitter는 죽은 경로이고(유일하게 온프렘 apache-cgi 배포만 진짜 ResponseEmitter를 타지만 거기엔 OutputBufferingMiddleware를 안 붙인다), 옛 사내 프레임워크 때부터 응답 바이트를 만지는 계층을 \"에미터\"라 불러온 이름이 Slim 전환 후 OutputBufferingMiddleware에 그대로 붙었다. 등록 규칙: 전역이 아니라 echo를 뱉는 옛날 액션이 있는 /legacy 라우트 그룹에만 붙이고, 스타일은 Slim 기본값 append 대신 PREPEND로 통일한다 — append로 붙였을 때 JSON 응답 꼬리에 leftover 출력이 붙어 클라이언트 파싱이 깨진 적이 있었기 때문."
tags: [slim, php, partner-settlement, terminology]
timestamp: 2026-07-16
---
[/projects/partner-settlement-api.md](/projects/partner-settlement-api.md)의 응답 emitter 배선 결정.

## 용어: "에미터" = OutputBufferingMiddleware

- 서비스는 Slim을 포크해 FrankenPHP 워커 모드로 운영하며, `App::run()`을 호출하지 않고
  컨테이너에서 `handle()`만 직접 호출한다. 따라서 Slim의 `ResponseEmitter`는 이 배포에서
  한 번도 타지 않는 죽은 경로다.
- 예전 사내 프레임워크 때부터 응답 바이트에 손대는 계층을 "에미터"라고 불러왔고, Slim으로
  넘어오면서 그 이름이 `OutputBufferingMiddleware`한테 그대로 붙었다.
- 예외는 온프렘 apache-cgi 배포 한 군데뿐: 거기서만 진짜 `ResponseEmitter`를 타고, 반대로
  거기엔 `OutputBufferingMiddleware`를 안 붙인다.
- 결론: 이 팀 컨텍스트에서 "에미터"는 항상 `OutputBufferingMiddleware`를 가리킨다.

## 등록 규칙

1. **범위**: 전역 미들웨어로 붙이지 않고 `/legacy` 라우트 그룹에만 붙인다. echo를 뱉는 옛날
   액션이 거기밖에 없기 때문.
2. **스타일**: Slim 기본값은 append이지만 이 프로젝트는 PREPEND로 통일한다. 워커에서 append로
   붙였다가 JSON 응답 꼬리에 leftover 출력이 붙어 클라 파싱이 깨진 적이 있었기 때문.

## PREPEND의 알려진 위험

PREPEND가 append보다 안전하다는 보장은 없다 — body 스트림이 이미 소진된 경우 응답이 통째로
사라질 수 있는 위험이 분석 단계에서 발견되었다. 근본 원인은 사용자가 겪은 leftover 문제와 다를
수 있다는 지적도 있었다. 자세한 내용과 미해결 상태는
[/troubleshooting/output-buffering-prepend-body-loss.md](/troubleshooting/output-buffering-prepend-body-loss.md) 참고.
