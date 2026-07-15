# 실제 오픈소스 분석 검증 — 2026-07-15

이 결과는 고정 commit을 shallow clone한 뒤 현재 dirty worktree의 분석기로 측정했다. 시간과 RSS는
운영 안전성 확인용 단일 실행값이며, OKF 토큰 효율이나 사용자 응답 속도 근거로 사용하지 않는다.
원시 수치는 [oss-analysis-2026-07-15.json](oss-analysis-2026-07-15.json)에 있다.

| 저장소 | commit | 전체 파일 | 언어 파일 | 선언 | 내부 edge | truncated |
|---|---|---:|---:|---:|---:|---:|
| Slim (PHP) | `80900fb` | 145 | 125 | 127 | 305 | false |
| Redis (C) | `f76dff7` | 1,838 | 784 | 5,796 | 990 | false |
| fmt (C++) | `a79df45` | 142 | 46 | 283 | 121 | false |
| Alamofire (Swift) | `903c53c` | 568 | 98 | 2,052 | 215 | false |

## 원본 대조

- Slim `App.php`의 `use` 선언이 `ServerRequestCreatorFactory`, `CallableResolverInterface`,
  `RoutingMiddleware`의 실제 선언 파일로 연결되는 것을 원본 20, 21, 27행에서 확인했다.
- Redis `fpconv_dtoa.c`와 `hdr_histogram.c`의 quoted include 5개를 실제 header와 대조했다.
- fmt `fmt-c.cc`, `fmt.cc`의 quoted/angle include 5개를 실제 `include/fmt/` header와 대조했다.
- Alamofire의 `DataRequest: Request`, `DataStreamRequest: Request`,
  `PassthroughStreamSerializer: DataStreamSerializer`를 원본 선언과 대조했다.

## 검증 중 발견해 수정한 false-positive

- Swift 표준 `Error` conformance가 다른 파일의 중첩 `Error` 타입으로 연결됐다. cross-file target을
  top-level 선언으로 제한했다.
- Redis의 `<stdint.h>`, `<stdbool.h>`가 저장소의 MSVC 호환 header로 연결됐다. angle include는
  명시적인 디렉터리 경로가 있는 유일한 후보만 내부 연결한다.

## 남은 분석 공백

- 정규식 기반이라 C/C++ 매크로·조건부 컴파일·여러 줄 함수 선언을 완전하게 해석하지 않는다.
- PHP 동적 class name과 실행 시점 autoload 관계는 연결하지 않는다.
- Swift 중첩 타입의 cross-file 관계는 false-positive 억제를 위해 보수적으로 생략한다.
- 선언 수는 의미적 public API 수가 아니라 추출된 선언 노드 수다. 중첩 선언도 포함한다.
