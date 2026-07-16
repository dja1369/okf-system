---
type: decision
title: 정산 API의 환경별 displayErrorDetails와 예외별 처리, ResponseEmitter 청크 크기
description: local/partner-sandbox는 displayErrorDetails=true, staging/prod는 false다(staging은 재작년 스택트레이스에 파트너 사업자번호가 찍힌 사고 이후 그대로 유지). partner-sandbox에서도 HttpUnauthorizedException/HttpForbiddenException(서브클래스 포함)만은 ErrorMiddleware::setErrorHandler(..., handleSubclasses:true)로 details를 강제 false 처리한다 — 3월 보안 리뷰에서 스택트레이스에 내부 토큰 발급 서버 호스트명이 노출된 적발 때문. ResponseEmitter 생성자 청크 크기는 기본값 4096 대신 49152로 고정한다 — 정산 CSV 스트리밍이 파트너 게이트웨이 앞단에서 flush가 밀리는 문제를 재작년에 직접 측정해서 잡은 값이라 임의로 바꾸면 안 된다.
tags: [slim, error-handling, partner-settlement]
timestamp: 2026-07-16
---
[/projects/partner-settlement-api.md](/projects/partner-settlement-api.md)의 에러 처리 wiring 결정.

## 환경별 displayErrorDetails

| 환경 | displayErrorDetails | 이유 |
|---|---|---|
| local | true | 개발 편의 |
| staging | false | 실 파트너 데이터 스냅샷을 그대로 물고 도는 구조라, 재작년 스택트레이스에 파트너 사업자번호가 찍힌 사고 이후 고정. 보통 staging은 켜두는 경우가 많지만 이 프로젝트는 반대로 간 케이스다 |
| partner-sandbox | true (단, 아래 예외 있음) | — |
| prod | false | — |

## partner-sandbox의 인증/권한 예외 예외 처리

partner-sandbox는 기본적으로 details를 켜지만, `HttpUnauthorizedException`과
`HttpForbiddenException` 계열(서브클래스 포함)만은 details 없이 나가야 한다. 3월 보안 리뷰에서
스택트레이스에 내부 토큰 발급 서버 호스트명이 그대로 찍힌 게 걸렸기 때문이다.

`ErrorMiddleware::setErrorHandler()` (Slim/Middleware/ErrorMiddleware.php:190-201)로 구현:

```php
$errorMiddleware->setErrorHandler(
    [HttpUnauthorizedException::class, HttpForbiddenException::class],
    function (ServerRequestInterface $request, Throwable $exception, bool $displayErrorDetails, bool $logErrors, bool $logErrorDetails) use ($handler) {
        return $handler($request, $exception, false, $logErrors, $logErrorDetails); // details 강제 off
    },
    true // handleSubclasses=true — 서브클래스까지 전부 적용
);
```

세 번째 인자 `handleSubclasses=true`가 없으면 정확히 일치하는 타입만 잡히고 서브클래스는 기본
ErrorHandler로 빠진다.

## ResponseEmitter 청크 크기 49152

`ResponseEmitter.__construct(int $responseChunkSize = 4096)` (Slim/ResponseEmitter.php:30)의 기본값
4096 대신 49152를 쓴다. 정산 CSV 스트리밍이 파트너 게이트웨이 앞단에서 flush가 밀려 문제가
생겼던 것을 재작년에 직접 측정해서 잡은 값이므로 기본값으로 되돌리거나 임의로 바꾸면 안 된다.

```php
new ResponseEmitter(49152);
```

에러 처리 파이프라인 자체의 구조(ErrorMiddleware/ErrorHandler/렌더러 체인)는
[/references/slim4/error-pipeline.md](/references/slim4/error-pipeline.md) 참고.
