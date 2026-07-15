---
description: OKF 번들에 쌓인 지식만을 인터랙티브 그래프(자체완결 HTML)로 시각화한다. 코드는 포함하지 않는다.
---

**번들에 무엇이 쌓여 있는가**를 그래프로 본다. 코드는 보지 않는다 — 코드와 엮어서 보려면
`/okf:okf-analysis`를 써라.

concept 노드와, concept끼리의 링크(`/decisions/foo.md` 형식의 상호 참조)만 그린다. 번들 전체가
대상이며 관련성 필터를 걸지 않는다 — 여기선 "내가 아는 것 전부"를 보는 게 목적이다.

## 실행

```bash
node -e "
import('\${CLAUDE_PLUGIN_ROOT}/lib/viz.mjs').then(async (viz) => {
  const { resolveOkfHome } = await import('\${CLAUDE_PLUGIN_ROOT}/lib/paths.mjs');
  const path = await import('node:path');
  const okfHome = resolveOkfHome();
  const out = path.join(okfHome, '.okf', 'viz-bundle.html');
  // projectRoot=null -> 번들만. 코드 분석을 아예 돌리지 않으므로 큰 저장소에서도 즉시 끝난다.
  const r = viz.generateViz(okfHome, null, out);
  console.log(JSON.stringify(r.meta, null, 2));
  console.log('WROTE: ' + r.outPath);
});
"
```

생성 후 출력된 `WROTE:` 경로를 열어라 — macOS `open`, Linux `xdg-open`, Windows `start`.

## 보고

출력된 meta 기준으로 요약하라:

- concept 수(`okfCount`)와 카테고리 분포
- 서로 링크된 concept이 있는지(고립된 점들만 있으면 그 사실을 말하라 — 지식이 아직 서로
  연결되지 않았다는 뜻이다)
- 생성 경로, 브라우저에서 열었는지

`okfCount`가 0이면 번들이 비어 있는 것이다. 배치가 아직 안 돌았을 수 있으니 `/okf:okf-status`로
확인하라고 안내하고, 없는 내용을 지어내지 마라.

## 참고

- 자체완결 HTML이다(외부 CDN·네트워크 요청 없음).
- 코드 분석을 하지 않으므로 저장소 크기와 무관하게 빠르다.
- 개별 concept의 제목·요약을 텍스트로 훑고 싶으면 `/okf:okf-index`가 더 적합하다.
