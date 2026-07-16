---
type: troubleshooting
title: OutputBufferingMiddleware를 PREPEND로 쓰면 body 스트림 소진 시 응답이 통째로 사라질 수 있다
description: Slim/Middleware/OutputBufferingMiddleware.php:66의 `$body->write($output . $response->getBody())`는 PSR-7 스트림을 `__toString()`으로 캐스팅하는데, 이는 현재 포인터부터 끝까지만 읽는다. 이전 미들웨어/핸들러가 이미 body를 읽었거나 스트림이 seekable하지 않으면 빈 문자열이 반환되어 원본 응답이 통째로 사라진다. APPEND 경로(68행)엔 isWritable() 체크가 있지만 PREPEND에는 아무 검증도 없다 — 아직 미수정, 분석만 완료된 상태다.
tags: [slim, php, partner-settlement, output-buffering]
timestamp: 2026-07-16
---
[/decisions/partner-settlement/emitter-wiring.md](/decisions/partner-settlement/emitter-wiring.md)에서
OutputBufferingMiddleware를 PREPEND 스타일로 쓰기로 한 결정에 대한 위험 분석.

## 증상 (우려)

워커 모드(FrankenPHP)에서 OutputBufferingMiddleware를 PREPEND로 등록해 쓸 때, 특정 상황에서
응답 본문이 사라지거나 다음 요청에 잔여 출력이 섞일 수 있는지 분석했다.

## 원인

1. **body 스트림 재구성의 결함**: `OutputBufferingMiddleware.php:66`의
   `$body->write($output . $response->getBody())`는 `$response->getBody()`를 문자열로 캐스팅하는데,
   PSR-7 스트림의 `__toString()`은 **현재 포인터부터 끝까지만** 읽는다.
   - 이전 미들웨어/핸들러가 이미 body를 읽었다면 포인터가 끝에 있어 빈 문자열이 반환되고,
     원래 응답 내용이 완전히 손실된다.
   - 스트림이 seekable하지 않으면(예: 파이프, 네트워크 스트림) rewind가 불가능해 마찬가지로
     빈 문자열이 나온다.
   - readable하지 않으면 예외가 발생할 수도 있다.
   - **APPEND 경로(68행)에는 `isWritable()` 체크가 있지만 PREPEND에는 아무 검증도 없다** — 이
     비대칭이 위험 신호다.
2. **워커 환경의 출력 버퍼 중첩**: 정상 경로는 `ob_start()` → 핸들러 → `ob_get_clean()`, 예외
   경로는 `ob_start()` → 핸들러(예외) → `ob_end_clean()`으로 버퍼가 정리되는 것처럼 보이지만,
   핸들러 내부에서 추가로 `ob_start()`를 중첩하고 예외가 나면 미들웨어의 `ob_end_clean()`은 내부
   레벨만 제거하고, 그다음 `ob_get_clean()`이 바깥 레벨에서 이전 핸들러의 잔여 출력을 함께 끌고
   올 수 있다. 워커는 프로세스가 계속 살아있으므로 이 잔여물이 다음 요청에 영향을 줄 수 있다.

## 해결 상태

**미수정.** 이 조사는 분석 단계로만 진행되었고 코드 수정은 아직 하지 않았다. 사용자가 append에서
겪은 "leftover 출력" 증상은 이 PREPEND 결함과는 다른 원인(핸들러 내부 추가 echo 타이밍 문제
등)일 가능성이 있다는 지적도 있었다 — 즉 PREPEND로 바꾼 것이 근본 해결이 아닐 수 있다.
