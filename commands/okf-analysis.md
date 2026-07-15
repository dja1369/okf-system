---
description: OKF 번들 지식을 기준으로 지정한 경로(코드·문서)를 분석해, 번들과 연결된 지식 + 분석 결과만 그래프로 시각화한다.
argument-hint: "[분석할 경로 — 생략 시 현재 디렉토리]"
---

**대상 코드베이스가 주인공이고 OKF 번들은 그걸 설명하는 렌즈다.** 지정한 경로를 분석하고,
그 코드와 실제로 연결된 concept만 함께 그린다.

번들 전체를 보고 싶으면 `/okf:okf-visualize`를 써라 — 이 커맨드는 의도적으로 **무관한 지식을
그리지 않는다**. 다른 프로젝트 결정이나 OKF 시스템 자체에 대한 문서가 이 저장소 그래프에 떠 있으면
그건 정보가 아니라 노이즈다.

## 대상 경로

사용자가 준 인자: `$ARGUMENTS`

- **인자가 있으면** 그 경로를 분석한다. `~`는 홈으로 펼치고 상대경로는 현재 디렉토리 기준.
- **인자가 없으면** 세션이 실행된 현재 디렉토리를 쓴다.
- 경로가 없거나 디렉토리가 아니면 **거기서 멈추고** 알려라. 비슷한 경로를 추측해 대신 분석하지 마라.

번들(`OKF_HOME`)은 어느 경로를 분석하든 항상 같은 전역 번들이다 — 지식은 프로젝트별로 나뉘지 않는다.

## 실행

```bash
TARGET="${ARGUMENTS:-$(pwd)}"
node -e "
import('\${CLAUDE_PLUGIN_ROOT}/lib/viz.mjs').then(async (viz) => {
  const { resolveOkfHome } = await import('\${CLAUDE_PLUGIN_ROOT}/lib/paths.mjs');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const os = await import('node:os');

  let target = process.argv[1] || process.cwd();
  if (target.startsWith('~')) target = path.join(os.homedir(), target.slice(1));
  target = path.resolve(target);
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    console.error('ERROR: 경로가 없거나 디렉토리가 아님: ' + target);
    process.exit(1);
  }

  const okfHome = resolveOkfHome();
  // 저장소마다 다른 파일로 쓴다 — 고정 파일명이면 다른 경로를 볼 때마다 이전 결과가 사라진다.
  const slug = path.basename(target).replace(/[^\w.-]/g, '_');
  const out = path.join(okfHome, '.okf', 'analysis-' + slug + '.html');
  const r = viz.generateViz(okfHome, target, out);
  console.log(JSON.stringify({ target, ...r.meta }, null, 2));
  console.log('WROTE: ' + r.outPath);
});
" "$TARGET"
```

생성 후 출력된 `WROTE:` 경로를 열어라 — macOS `open`, Linux `xdg-open`, Windows `start`.

## 보고

출력된 JSON 기준으로 요약하라:

- **분석한 경로**(`target`) — 인자로 받은 것인지 현재 디렉토리인지 명시
- 코드 노드 수 / 함께 그린 concept 수 / **교차 연결 수**(`crossCount`)
- `okfFiltered`가 0보다 크면 **번들에 있지만 이 코드와 무관해서 제외된 concept 수**를 밝혀라
- 코드 분석 출처(`codeSource`): `understand-anything (...)`이면 이미 있는 UA 그래프 재사용,
  `okf static analysis`면 이 플러그인의 정적 분석기가 만든 것
- `truncated`가 true면 **파일 수 상한에 걸려 그래프가 일부만 담겼다는 사실을 반드시 알려라**
- `languageStats`의 언어별 파일 수 / 선언 수 / 내부 edge 수. 파일은 있지만 선언과 edge가 모두
  0이면 구조 추출 공백일 수 있으므로 분석 성공이라고 표현하지 마라.
- `primaryLanguages`와 실제 대상의 주 언어가 어긋나면 vendored/generated/보조 언어가 구조를
  왜곡했는지 확인하고 그 한계를 보고하라.
- 그래프의 "Start here"(아무도 import하지 않는 진입점)와 "Most depended on"(다들 import하는 허브)이
  무엇인지 짚어주면 사용자가 어디부터 읽어야 할지 바로 안다

`crossCount`가 0이면 그대로 알리고 이유를 설명하라 — 보통 (a) 번들이 비었거나 (b) 번들 지식이
이 코드에 관한 게 아니어서다. **무관한 저장소를 분석하면 0이 정상이다.** 억지로 연결을 만들지 마라.

## 참고

- 자체완결 HTML(외부 CDN·네트워크 요청 없음). 오프라인에서도 열린다.
- 경로별로 `analysis-<이름>.html`로 저장돼 서로 덮어쓰지 않는다.
- 대상 경로에 `.understand-anything/knowledge-graph.json` 또는 `.ua/knowledge-graph.json`이 있으면
  그 분석(LLM 요약 포함)을 우선 사용한다. 없으면 정적 분석기가 파일/함수/클래스와 의존 관계를 추출한다.
- 언어별로 각자의 해석 규칙을 따른다. Go·C#은 파일이 아니라 패키지·네임스페이스를 의존 단위로
  잇는다. 외부 의존성(표준 라이브러리·서드파티)은 엣지를 만들지 않는다.
