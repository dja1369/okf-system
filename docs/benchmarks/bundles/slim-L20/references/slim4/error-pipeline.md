---
type: reference
title: Slim 4 에러 처리 파이프라인 (ErrorMiddleware → ErrorHandler → Renderer)
description: ErrorMiddleware가 예외를 잡아 ErrorMiddleware::setErrorHandler($type, $handler, $handleSubclasses)로 등록된 타입별 핸들러를 조회하고(세 번째 인자 true면 서브클래스까지 잡힘) 없으면 기본 ErrorHandler로 위임한다. ErrorHandler는 Accept 헤더로 Html/Json/PlainText/Xml 렌더러를 골라 displayErrorDetails 플래그를 넘긴다. HtmlErrorRenderer는 예외 message/trace만 htmlentities로 이스케이프하고(HtmlErrorRenderer.php:45,52) title/description은 이스케이프하지 않아(65,73행) HttpException::setTitle/setDescription에 신뢰 못 할 입력을 넣으면 반사형 XSS가 된다.
resource:
tags: [slim, php, error-handling, reference]
timestamp: 2026-07-16
---
[/decisions/partner-settlement/error-handling.md](/decisions/partner-settlement/error-handling.md)에서
실제로 이 API를 사용해 환경별/예외별 에러 노출을 제어했다.

## 핵심 API 체인

```
ErrorMiddleware (displayErrorDetails 플래그 보유)
  ↓ 예외 타입별 핸들러 조회
ErrorMiddleware::getErrorHandler(string $type)
  ├─→ handlers[$type] (정확한 타입)
  ├─→ subClassHandlers[$type] (서브클래스까지 처리하도록 등록된 타입)
  └─→ getDefaultErrorHandler() → ErrorHandler 반환

ErrorHandler (응답 생성)
  ├─ __invoke(request, exception, displayErrorDetails, logErrors, logErrorDetails)
  └─ respond() → 선택된 렌더러 호출 시 displayErrorDetails 전달

ResponseEmitter (chunk size 설정)
  └─ __construct(int $responseChunkSize = 4096)
```

## 특정 예외 타입만 다르게 처리하기

`ErrorMiddleware::setErrorHandler()` (Slim/Middleware/ErrorMiddleware.php:190-201):

```php
public function setErrorHandler($typeOrTypes, $handler, bool $handleSubclasses = false): self
```

`$handleSubclasses=true`면 등록한 타입의 서브클래스까지 전부 같은 핸들러로 잡힌다.

## 렌더러별 이스케이프 여부

ErrorHandler는 Accept 헤더 기반 콘텐츠 협상(ErrorHandler.php:169-206)으로 렌더러를 고른다.
text/html이 기본(ErrorHandler.php:69). 4개 구현체 전부 `AbstractErrorRenderer`
(Slim/Error/AbstractErrorRenderer.php)를 상속하며, `HttpException`이면 `getTitle()`/`getDescription()`을
쓰고 아니면 기본값을 쓴다(29-45행).

| 렌더러 | Message/Trace | Title/Description | 비고 |
|---|---|---|---|
| HtmlErrorRenderer | `htmlentities()`로 이스케이프 (45, 52행) | **이스케이프 안 됨** — `<title>%s</title>`(65행), `<h1>%s</h1>`(73행)에 그대로 삽입 | XSS 위험 지점, 아래 참고 |
| JsonErrorRenderer | `json_encode()`가 자동 처리 | 동일 | `displayErrorDetails=true`면 파일 경로/라인 등 노출(29-36행), 예외 체인 전부 배열에 포함(33-35행) |
| PlainTextErrorRenderer | 이스케이프 불필요(평문) | 동일 | htmlentities import했지만 미사용 |
| XmlErrorRenderer | (조사 안 함) | — | — |

## XSS 취약점 상세

- Slim **코어만 사용하는 기본 흐름은 안전하다**. 사용자 입력이 실제로 반영될 수 있는 유일한
  지점인 예외 `message`/`trace`는 `htmlentities()`로 이스케이프되고, 내장 예외들(`HttpNotFoundException`
  등)의 `title`/`description`은 전부 하드코딩된 고정 문자열이며 `RoutingMiddleware.php:76,79`에서도
  사용자 입력을 인자로 넘기지 않는다.
- **그러나 렌더러 자체는 title/description을 이스케이프하지 않는다.** 애플리케이션 코드가
  `HttpException::setTitle()`/`setDescription()`(HttpException.php:49,60)에 쿼리 파라미터 등 사용자
  입력을 직접 넣어 커스텀 예외를 던지면 `<title>`/`<h1>` 태그에 그대로 삽입되어 반사형 XSS가
  발생한다.
- 근본 원인은 프레임워크 결함이 아니라 message/trace만 방어되고 title/description/code/file/line은
  렌더러 레벨에서 방어되지 않는 **불완전한 이스케이프 정책**이다. 프레임워크 차원에서 안전하게
  만들려면 `renderHtmlBody()`와 `getErrorDescription()` 반환값에도 `htmlentities()`를 적용해야 한다.

## ResponseEmitter 청크 크기

`ResponseEmitter.__construct(int $responseChunkSize = 4096)` (Slim/ResponseEmitter.php:30). 기본값을
바꾸는 이유와 실제 적용값은 [/decisions/partner-settlement/error-handling.md](/decisions/partner-settlement/error-handling.md) 참고.
