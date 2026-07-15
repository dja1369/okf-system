---
description: OKF 번들과 코드베이스를 하나의 인터랙티브 그래프(HTML)로 시각화하고 연다. 인자로 분석할 저장소 경로 지정 가능.
argument-hint: "[분석할 저장소 경로 — 생략 시 현재 디렉토리]"
---

OKF 지식 번들과 코드 분석 결과를 **하나의 그래프로 연결해** 시각화한다.
concept(무엇을 알고 있는가)와 코드(무엇이 실제로 있는가)를 잇는 노란 점선이 이 그래프의 핵심이다 —
"이 결정이 어느 파일에 관한 것인가"를 보여준다.

## 대상 저장소

사용자가 인자로 준 경로: `$ARGUMENTS`

- **인자가 있으면** 그 경로를 분석 대상으로 쓴다. `~`는 홈 디렉토리로 펼치고, 상대경로는 현재
  디렉토리 기준으로 해석한다.
- **인자가 비어 있으면** 현재 작업 디렉토리를 쓴다.
- 지정한 경로가 없거나 디렉토리가 아니면 **거기서 멈추고** 사용자에게 알려라. 비슷한 경로를
  추측해서 대신 분석하지 마라.

번들(`OKF_HOME`)은 어느 저장소를 분석하든 항상 같은 것을 쓴다 — 번들은 전역이고 프로젝트별로
나뉘지 않는다.

## 실행

Bash로 아래를 실행하라. `TARGET`에 위에서 정한 경로를 넣는다(인자가 없으면 `$(pwd)`).

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
  // 저장소마다 다른 파일로 쓴다 — 고정 파일명이면 다른 저장소를 볼 때마다 이전 결과가 사라진다.
  const slug = path.basename(target).replace(/[^\w.-]/g, '_');
  const out = path.join(okfHome, '.okf', 'viz-' + slug + '.html');
  const r = viz.generateViz(okfHome, target, out);
  console.log(JSON.stringify({ target, ...r.meta }, null, 2));
  console.log('WROTE: ' + r.outPath);
});
" "$TARGET"
```

생성이 끝나면 출력된 `WROTE:` 경로를 열어라:
- macOS: `open <경로>`
- Linux: `xdg-open <경로>`
- Windows: `start <경로>`

## 보고

실행 후 사용자에게 다음을 요약해 보고하라(출력된 JSON 기준):

- **분석한 저장소 경로**(`target`) — 인자로 받은 것인지 현재 디렉토리인지 명시
- concept 수 / 코드 노드 수 / **교차 연결 수**
- 코드 분석 출처(`codeSource`): `understand-anything (...)`이면 이미 있는 UA 그래프를 재사용한 것,
  `okf static analysis`면 이 플러그인의 정적 분석기가 직접 만든 것
- `truncated`가 true면 **파일 수 상한에 걸려 그래프가 일부만 담겼다는 사실을 반드시 알려라**
- 생성된 HTML 경로와, 브라우저에서 열었는지 여부

교차 연결(`crossCount`)이 0이면 그 사실을 그대로 알리고 이유를 설명하라 — 보통은 (a) 번들에
concept이 아직 없거나, (b) concept 본문이 **그 저장소의** 파일 경로를 언급하지 않아서다. 다른
저장소를 분석하면 교차 연결이 0인 게 오히려 정상일 수 있다(번들의 지식이 그 코드에 관한 게
아니므로). 억지로 연결을 만들어내지 마라.

## 참고

- 생성물은 자체완결 HTML이다(외부 CDN·네트워크 요청 없음). 오프라인에서도 열린다.
- 저장소별로 `viz-<이름>.html`로 저장되므로 여러 저장소를 번갈아 봐도 서로 덮어쓰지 않는다.
- `.understand-anything/knowledge-graph.json` 또는 `.ua/knowledge-graph.json`이 **대상 저장소에**
  있으면 그 분석을 우선 사용한다(LLM 요약이 있어 더 풍부하다). 없으면 이 플러그인의 정적
  분석기가 파일/함수/클래스와 import 관계를 직접 추출한다.
- 큰 저장소에서는 분석에 몇 초 걸릴 수 있다. 분석 파일 수에는 상한이 있고, 걸리면 `truncated`로
  알려준다.
