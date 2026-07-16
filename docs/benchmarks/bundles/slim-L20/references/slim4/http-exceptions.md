---
type: reference
title: Slim 4 HTTP 예외 클래스 계층과 공통 규칙
description: 모든 HTTP 예외는 HttpException(RuntimeException 상속, Slim/Exception/HttpException.php:21) → HttpSpecializedException(Slim/Exception/HttpSpecializedException.php:16) → 구체 클래스 순으로 상속되고, 전부 생성자에 ServerRequestInterface가 필수(HttpSpecializedException.php:23)이며 title/description은 setter로 덮어쓸 수 있다(HttpException.php:44-64). HttpMethodNotAllowedException만 예외로 setAllowedMethods()가 자동으로 Allow 헤더용 메시지를 만들고 ErrorHandler.php:300-302에서 HTTP Allow 헤더로 반영된다.
resource:
tags: [slim, php, exceptions, reference]
timestamp: 2026-07-16
---
## 클래스 계층

```
RuntimeException
  └─ HttpException (Slim/Exception/HttpException.php:21)
       └─ HttpSpecializedException (Slim/Exception/HttpSpecializedException.php:16)
            ├─ HttpForbiddenException (403)
            ├─ HttpNotFoundException (404)
            ├─ HttpMethodNotAllowedException (405) — Allow 헤더 자동 생성 (아래 참고)
            ├─ HttpInternalServerErrorException (500)
            ├─ HttpNotImplementedException (501)
            ├─ HttpTooManyRequestsException (429, 4.13.0에서 추가 — CHANGELOG.md:84)
            └─ HttpUnauthorizedException (401, 별도 조사 안 했으나 동일 패턴)
```

## 공통 규칙

- 생성자 시그니처: `__construct(ServerRequestInterface $request, ?string $message = null, ?Throwable $previous = null)`
  (HttpSpecializedException.php:23) — `ServerRequestInterface`는 모든 서브클래스에서 필수.
- 두 번째 인자로 기본 메시지를 오버라이드할 수 있다.
- `title`/`description`은 생성 후에도 `HttpException`의 setter(HttpException.php:49-64)로 변경 가능.
- `@api` 마크가 있는 것들은 애플리케이션 개발자가 명시적으로 throw하도록 만들어진 공개
  인터페이스이며, 프레임워크 내부에서 자동으로 던져지지 않는다(예: HttpForbiddenException,
  HttpTooManyRequestsException — 레이트 리밋 등은 직접 구현해야 함).
- `ErrorHandler.determineStatusCode()`(ErrorHandler.php:155-157)가 `HttpException`의 `getCode()`로
  HTTP 상태 코드를 자동 결정한다.

## HttpMethodNotAllowedException은 다르다

라우팅 실패(METHOD_NOT_ALLOWED) 시 프레임워크가 직접 생성한다(RoutingMiddleware.php:78-80).
생성자가 아니라 `setAllowedMethods()`(HttpMethodNotAllowedException.php:46-51)로 허용 메서드를
설정하면 `"Method not allowed. Must be one of: GET, POST, ..."` 메시지가 자동 생성되고,
`ErrorHandler.php:300-302`가 `instanceof HttpMethodNotAllowedException`을 감지해 `getAllowedMethods()`
값을 HTTP `Allow` 헤더에 자동으로 실어 보낸다.

## 사용 예

```php
throw new HttpForbiddenException($request);
throw new HttpTooManyRequestsException($request, 'Rate limit exceeded');
```

에러 렌더링 파이프라인과 이 예외들의 title/description이 어떻게 출력되는지는
[/references/slim4/error-pipeline.md](/references/slim4/error-pipeline.md) 참고. 실제 예외별 처리 wiring
결정은 [/decisions/partner-settlement/error-handling.md](/decisions/partner-settlement/error-handling.md) 참고.
