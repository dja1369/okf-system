---
description: OKF 번들과 현재 프로젝트 코드를 하나의 인터랙티브 그래프(HTML)로 시각화하고 연다.
---

OKF 지식 번들과 현재 프로젝트의 로컬 코드 분석 결과를 **하나의 그래프로 연결해** 시각화한다.
concept(무엇을 알고 있는가)와 코드(무엇이 실제로 있는가)를 잇는 노란 점선이 이 그래프의 핵심이다 —
"이 결정이 어느 파일에 관한 것인가"를 보여준다.

## 실행

Bash로 아래를 실행하라. `${CLAUDE_PLUGIN_ROOT}`는 이 플러그인 경로다.

```bash
node -e "
import('\${CLAUDE_PLUGIN_ROOT}/lib/viz.mjs').then(async (viz) => {
  const { resolveOkfHome } = await import('\${CLAUDE_PLUGIN_ROOT}/lib/paths.mjs');
  const path = await import('node:path');
  const okfHome = resolveOkfHome();
  const out = path.join(okfHome, '.okf', 'viz.html');
  const r = viz.generateViz(okfHome, process.cwd(), out);
  console.log(JSON.stringify(r.meta, null, 2));
  console.log('WROTE: ' + r.outPath);
});
"
```

생성이 끝나면 출력된 `WROTE:` 경로를 열어라:
- macOS: `open <경로>`
- Linux: `xdg-open <경로>`
- Windows: `start <경로>`

## 보고

실행 후 사용자에게 다음을 요약해 보고하라(출력된 meta JSON 기준):

- 그래프에 포함된 concept 수 / 코드 노드 수 / **교차 연결 수**
- 코드 분석 출처(`codeSource`): `understand-anything (...)`이면 이미 있는 UA 그래프를 재사용한 것이고,
  `okf static analysis`면 이 플러그인의 정적 분석기가 직접 만든 것이다.
- 생성된 HTML 경로와, 브라우저에서 열었는지 여부

교차 연결(`crossCount`)이 0이면 그 사실을 그대로 알리고 이유를 설명하라 — 보통은 (a) 번들에
concept이 아직 없거나, (b) concept 본문이 이 프로젝트의 파일 경로를 언급하지 않아서다. 억지로
연결을 만들어내지 마라.

## 참고

- 생성물은 자체완결 HTML이다(외부 CDN·네트워크 요청 없음). 오프라인에서도 열린다.
- `.understand-anything/knowledge-graph.json` 또는 `.ua/knowledge-graph.json`이 있으면 그 분석을
  우선 사용한다(LLM 요약이 있어 더 풍부하다). 없으면 이 플러그인의 정적 분석기가 파일/함수/클래스와
  import 관계를 직접 추출한다.
- 큰 저장소에서는 분석에 몇 초 걸릴 수 있다. 분석 대상 파일 수에는 상한이 있다.
