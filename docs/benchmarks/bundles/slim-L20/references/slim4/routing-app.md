---
type: reference
title: Slim 4 App.php의 역할과 PSR-15 핸들러/클로저의 라우트 인자 전달 차이
description: App(Slim/App.php)은 RouteCollectorProxy를 상속해 라우팅 API를 제공하고 PSR-15 RequestHandlerInterface로 handle()을 구현하며, ErrorMiddleware/RoutingMiddleware/BodyParsingMiddleware 등은 자동 추가되지 않아 전부 명시적으로 add()해야 하고 나중에 add한 미들웨어가 먼저 실행된다(LIFO). 라우트 핸들러를 클로저로 등록하면 RequestResponse 전략이 붙어 경로 변수가 3번째 인자(array $args)와 request attribute 양쪽으로 오지만, PSR-15 RequestHandlerInterface 클래스로 등록하면 CallableResolver가 자동으로 RequestHandler 전략으로 바꾸고 기본값(appendRouteArgumentsToRequestAttributes=false)에서는 경로 변수가 attribute로 실리지 않아 $request->getAttribute()로 못 꺼낸다 — 필요하면 $route->setInvocationStrategy(new RequestHandler(true))로 켜야 한다.
resource:
tags: [slim, php, routing, reference]
timestamp: 2026-07-16
---
## App.php의 역할

`App`은 Slim의 중앙 허브다:

1. **라우팅 API**: `RouteCollectorProxy`(Slim/Routing/RouteCollectorProxy.php:25)를 상속해
   `get()`/`post()`/`put()`/`patch()`/`delete()`/`any()`/`group()`/`redirect()` 제공.
2. **PSR-15 구현**: `handle(ServerRequestInterface)`(App.php:39)가 미들웨어/라우팅 스택을 처리.
3. **미들웨어 스택**: `MiddlewareDispatcher`(App.php:50, 102-115)를 통해 LIFO(후입선출) 순서로
   실행. `add()`/`addMiddleware()`로 등록.
4. **실행 진입점**: `run()`(186-196행)은 `ResponseEmitter`로 응답을 클라이언트에 전송, `handle()`은
   요청 처리 후 응답만 반환.

## 주의할 점

| 항목 | 내용 | 위치 |
|---|---|---|
| HEAD 요청 | RFC 2616 준수 — GET 라우트로 폴백되지만 바디는 명시적으로 비움 | App.php:218-222 |
| 미들웨어 자동 추가 없음 | `RoutingMiddleware`/`ErrorMiddleware`/`BodyParsingMiddleware` 등은 자동으로 안 붙음, 반드시 명시적 `add()` 필요 | App.php:119-175 |
| 미들웨어 순서 | 나중에 add한 게 먼저 실행(스택). 인증은 라우팅 전에, 에러 처리는 맨 위에 배치 필요 | MiddlewareDispatcher.php:78-81 |
| RouteRunner | 미들웨어 스택 최하단에 자동 배치되어, 라우팅이 미들웨어에서 안 되면 여기서 처리 | App.php:71, RouteRunner.php:48-52 |

## 클로저 vs PSR-15 RequestHandlerInterface: 경로 변수 접근 차이

**클로저로 등록** (`$app->get('/users/{id}', function($request, $response, array $args) {...})`):
1. `Route::handle()`(Route.php:342) → `CallableResolver::resolve()`(347행) → 클로저 그대로 반환
2. callable이 배열이 아니므로 기본 `RequestResponse` 전략 사용
3. `RequestResponse::__invoke()`(Strategies/RequestResponse.php:28-40)가 경로 변수를 request
   attribute로 추가하고(34-36행), 클로저에 `($request, $response, $routeArguments)` 3개 인자 전달(39행)
4. 접근: `$args['id']` 또는 `$request->getAttribute('id')` 둘 다 가능

**PSR-15 `RequestHandlerInterface` 클래스로 등록** (`$app->get('/users/{id}', UserHandler::class)`):
1. `CallableResolver::resolveRoute()`(345행)가 `RequestHandlerInterface` 구현을 감지하고
   (`CallableResolver.php:112`) `[$instance, 'handle']` 배열로 변환(94행)
2. `callable[0] instanceof RequestHandlerInterface === true`(Route.php:354-355)이면 자동으로
   `RequestHandler` 전략으로 전환(358행)
3. `RequestHandler::__invoke()`(Strategies/RequestHandler.php:34-48)는 기본값
   `appendRouteArgumentsToRequestAttributes = false`(24행)라서 경로 변수를 attribute로 추가하지
   않고(40-44행), 핸들러에 **`$request` 객체만** 전달(47행)
4. 기본값에서는 `$request->getAttribute('id')`로 **접근 불가**

| 항목 | 클로저 | PSR-15 클래스 |
|---|---|---|
| 전략 | RequestResponse | RequestHandler |
| 경로변수 전달 | 함수 인자 배열 + attribute | attribute 없음(기본값) |
| 접근 | `$args['id']` 또는 `getAttribute('id')` | 기본값: 접근 불가 |
| 핸들러 서명 | `(Request, Response, array)` | `(Request)` |

PSR-15 핸들러에서도 클로저처럼 경로 변수를 attribute로 받으려면:

```php
$route = $app->get('/users/{id}', UserHandler::class);
$route->setInvocationStrategy(new \Slim\Handlers\Strategies\RequestHandler(true));
```
