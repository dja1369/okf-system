---
type: project
title: 파트너 정산 API (Slim 4 기반)
description: Slim 4 위에서 동작하는 파트너 정산 API. local/staging/partner-sandbox/prod 네 환경을 운영하며, 에러 처리 wiring(환경별 displayErrorDetails, 예외별 예외 처리, 응답 emitter 배선)을 재정비하는 중이다.
tags: [slim, php, partner-settlement]
timestamp: 2026-07-16
---
Slim 4 프레임워크를 사용하는 파트너 정산 API. 서비스는 이 Slim을 포크해서 FrankenPHP 워커 모드로
운영하며, 그래서 `App::run()`을 호출하지 않고 컨테이너에서 `handle()`만 직접 부른다.

## 환경
- local — displayErrorDetails=true
- staging — displayErrorDetails=false (재작년 스택트레이스에 파트너 사업자번호가 찍힌 사고 이후 고정)
- partner-sandbox — displayErrorDetails=true, 단 인증/권한 예외 계열만 예외
- prod — displayErrorDetails=false

세부 결정과 근거는 [/decisions/partner-settlement/error-handling.md](/decisions/partner-settlement/error-handling.md)와
[/decisions/partner-settlement/emitter-wiring.md](/decisions/partner-settlement/emitter-wiring.md)에 있다.

## 알려진 미해결 리스크
OutputBufferingMiddleware를 PREPEND 스타일로 쓸 때 body 스트림이 이미 소진된 경우 응답이 사라질
수 있는 위험이 분석 단계에서 발견되었고 아직 코드 수정은 하지 않았다 — 자세한 내용은
[/troubleshooting/output-buffering-prepend-body-loss.md](/troubleshooting/output-buffering-prepend-body-loss.md).

## 참고
이 프로젝트가 기반한 Slim 4 프레임워크 자체의 에러 처리/라우팅/예외 구조 조사는
[/references/slim4/error-pipeline.md](/references/slim4/error-pipeline.md),
[/references/slim4/http-exceptions.md](/references/slim4/http-exceptions.md),
[/references/slim4/routing-app.md](/references/slim4/routing-app.md)에 정리되어 있다.
