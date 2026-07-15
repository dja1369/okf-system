import fs from 'node:fs';
import path from 'node:path';

// 로컬 코드 분석기 — 순수 Node, 네이티브 의존성 0.
//
// 출력 스키마는 Understand-Anything(MIT, Egonex-AI)의 knowledge-graph.json과 **의도적으로
// 호환**시킨다. 그래서 시각화(lib/viz.mjs)는 "우리가 분석한 그래프"와 "UA가 이미 만들어둔
// 그래프"를 구분 없이 같은 코드로 먹을 수 있다. UA가 설치돼 있으면 그쪽이 LLM 요약까지 있어
// 더 풍부하므로 우선 쓰고, 없으면 우리 결정적 분석으로 대체한다(loadOrAnalyze).
//
// tree-sitter를 쓰지 않는 이유(의도적 트레이드오프): native 빌드(node-gyp)는 이 플러그인의
// "npm install 단계 없음 + 크로스플랫폼" 제약을 깨고, WASM 문법 파일은 언어당 수 MB라 저장소가
// 비대해진다. 대신 언어별 정규식 추출기를 쓴다 — 정확도는 낮지만(주석/문자열 안의 import 문을
// 오인할 수 있음) 의존성 0이고 어떤 환경에서도 돈다. 의미 요약은 애초에 코드가 아니라 배치
// LLM이 담당하므로(Rule 5), 여기서 필요한 건 "구조"뿐이고 정규식으로 충분하다.

const DEFAULT_EXCLUDE_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'target', 'vendor', 'coverage',
  '.next', '.nuxt', '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache',
  '.gradle', '.idea', '.vscode', '.okf', 'raw', '_remove_candidate',
  '.ua', '.understand-anything',
]);

const MAX_FILES = 2000;         // 그래프가 사람이 볼 수 있는 규모를 넘지 않게 하는 상한
const MAX_FILE_BYTES = 512 * 1024; // 이보다 큰 파일은 import 추출을 건너뛴다(대개 생성물/번들)

// 확장자 -> 언어. 여기 없는 확장자는 파일 노드는 만들되 import 추출은 하지 않는다.
const LANG_BY_EXT = {
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin',
  '.rb': 'ruby',
  '.php': 'php',
  '.c': 'c', '.h': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.hpp': 'cpp', '.cxx': 'cpp',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
  '.md': 'markdown',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
};

// 언어별 import 추출 정규식. 캡처그룹 1 = 가져오는 대상.
//
// `mode`가 이 표의 핵심이다 — 그 문법이 **파일 경로**를 가리키는지 **이름**을 가리키는지.
//   'rel'  : 파일 기준 상대 경로 (C의 따옴표 include, require_relative, rust mod)
//   'root' : 저장소 루트 기준 경로 (rust의 use crate::)
//   'js'   : ./ 또는 / 로 시작할 때만 경로, 그 외는 패키지 이름 (Node 해석 규칙 그대로)
//   'py'   : 점 표기 모듈 경로 (파이썬 전용 해석)
//   'pkgpath': 점 표기 패키지 경로 (java/kotlin/C#) — 파일 경로의 접미사로만 일치시킨다
//   'name' : 항상 이름 — 절대 파일로 해석하지 않는다
//
// 'name'이 반드시 필요한 이유(실제 오픈소스로 테스트하다 발견): 예전엔 무엇이든 경로로
// 해석을 시도해서, Go의 `import "errors"`(표준 라이브러리)가 gin 저장소 루트의 `errors.go`로
// **없는 의존성을 만들어냈다**(errors.go에 가짜 in-degree 22). Go/Java/C#의 import는 언제나
// 패키지 이름이지 파일 경로가 아니므로, 같은 이름의 로컬 파일이 있어도 무관하다.
const IMPORT_PATTERNS = {
  javascript: [
    { re: /^\s*import\s+(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"]+)['"]/, mode: 'js' },
    { re: /^\s*export\s+(?:[\w*{}\s,$]+\s+)?from\s+['"]([^'"]+)['"]/, mode: 'js' },
    { re: /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/, mode: 'js' },
    { re: /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/, mode: 'js' },
  ],
  python: [
    { re: /^\s*import\s+([\w.]+)/, mode: 'py' },
    { re: /^\s*from\s+((?:\.+)?[\w.]*)\s+import\s+/, mode: 'py' },
  ],
  go: [
    // Go의 import는 전부 패키지 경로(표준 라이브러리 또는 모듈 경로)다 — 파일이 아니다.
    { re: /^\s*import\s+"([^"]+)"/, mode: 'name' },
    { re: /^\s*_?\s*"([^"]+)"\s*$/, mode: 'name' }, // import ( ... ) 블록 안의 한 줄
  ],
  rust: [
    { re: /^\s*use\s+crate::([\w:]+)/, mode: 'root' }, // 크레이트 루트 기준
    { re: /^\s*use\s+(?:self|super)::([\w:]+)/, mode: 'rel' },
    { re: /^\s*use\s+([\w:]+)/, mode: 'name' },        // std::, 외부 크레이트
    { re: /^\s*(?:pub\s+)?mod\s+(\w+)\s*;/, mode: 'rel' }, // 같은 디렉토리의 파일
  ],
  java: [{ re: /^\s*import\s+(?:static\s+)?([\w.]+)\s*;/, mode: 'pkgpath' }],
  ruby: [
    { re: /^\s*require_relative\s+['"]([^'"]+)['"]/, mode: 'rel' },
    { re: /^\s*require\s+['"]([^'"]+)['"]/, mode: 'name' }, // gem/표준 라이브러리
  ],
  php: [
    { re: /^\s*use\s+([\w\\]+)/, mode: 'name' }, // 네임스페이스
    { re: /^\s*(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/, mode: 'rel' },
  ],
  c: [
    { re: /^\s*#\s*include\s+"([^"]+)"/, mode: 'rel' },  // 따옴표 = 정의상 상대 경로
    { re: /^\s*#\s*include\s+<([^>]+)>/, mode: 'name' }, // 꺾쇠 = 시스템 헤더
  ],
  // C#의 using은 **네임스페이스**를 가리킨다 — 파일이 아니다. 실측(polly): `using Polly.RateLimiting`의
  // 실제 디렉토리는 `src/Polly.RateLimiting/`(점이 구분자가 아니라 디렉토리 이름의 일부)이고,
  // 그 안의 파일은 `namespace Polly;`를 선언한다. 즉 네임스페이스와 파일 경로는 대응 관계가 아니다.
  // 그래서 Go 패키지와 똑같이 네임스페이스 노드로 잇는다(아래 csUsings).
  csharp: [{ re: /^\s*using\s+(?:static\s+)?([\w.]+)\s*;/, mode: 'name' }],
  csharpNs: [{ re: /^\s*namespace\s+([\w.]+)/, mode: 'name' }],
  swift: [{ re: /^\s*import\s+(\w+)/, mode: 'name' }],
};
IMPORT_PATTERNS.typescript = IMPORT_PATTERNS.javascript;
IMPORT_PATTERNS.kotlin = [{ re: /^\s*import\s+([\w.]+)/, mode: 'pkgpath' }]; // 코틀린은 세미콜론이 없다
IMPORT_PATTERNS.cpp = IMPORT_PATTERNS.c;

// 최상위 선언 추출(대략). 정확한 파싱이 아니라 "이 파일에 뭐가 있나" 수준의 목차용이다.
const DECL_PATTERNS = {
  javascript: [
    { type: 'function', re: /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)/ },
    { type: 'function', re: /^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/ },
    { type: 'class', re: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/ },
  ],
  python: [
    { type: 'function', re: /^\s*(?:async\s+)?def\s+(\w+)/ },
    { type: 'class', re: /^\s*class\s+(\w+)/ },
  ],
  go: [
    { type: 'function', re: /^\s*func\s+(?:\([^)]*\)\s*)?(\w+)/ },
    { type: 'class', re: /^\s*type\s+(\w+)\s+struct/ },
  ],
  rust: [
    { type: 'function', re: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/ },
    { type: 'class', re: /^\s*(?:pub\s+)?(?:struct|enum|trait)\s+(\w+)/ },
  ],
  java: [
    { type: 'class', re: /^\s*(?:public|private|protected)?\s*(?:final\s+|abstract\s+)?(?:class|interface|enum|record)\s+(\w+)/ },
  ],
  ruby: [
    { type: 'function', re: /^\s*def\s+(\w+)/ },
    { type: 'class', re: /^\s*class\s+(\w+)/ },
  ],
};
// C# 선언 패턴이 아예 없어서 polly(1003파일) 그래프에 class 노드가 0개였다(실측).
DECL_PATTERNS.csharp = [
  { type: 'class', re: /^\s*(?:public|internal|private|protected)?\s*(?:static\s+|sealed\s+|abstract\s+|partial\s+|readonly\s+)*(?:class|interface|struct|record|enum)\s+(\w+)/ },
];
DECL_PATTERNS.kotlin = [
  { type: 'class', re: /^\s*(?:public\s+|internal\s+|private\s+)?(?:open\s+|abstract\s+|sealed\s+|data\s+|value\s+)*(?:class|interface|object|enum\s+class)\s+(\w+)/ },
  { type: 'function', re: /^\s*(?:public\s+|internal\s+|private\s+)?(?:suspend\s+|inline\s+)*fun\s+(?:<[^>]*>\s*)?(\w+)/ },
];
DECL_PATTERNS.typescript = DECL_PATTERNS.javascript;

function isCommentLine(line, lang) {
  const t = line.trim();
  if (!t) return true;
  if (lang === 'python' || lang === 'ruby' || lang === 'shell') return t.startsWith('#');
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function walkFiles(root, excludeDirs) {
  const out = [];
  let truncated = false;
  const stack = [root];
  while (stack.length > 0) {
    if (out.length >= MAX_FILES) { truncated = true; break; }
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (out.length >= MAX_FILES) { truncated = true; break; }
      // 숨김 항목은 디렉토리·파일 모두 제외한다 — 설정 노이즈가 그래프를 뒤덮는 걸 막는다.
      // (이전엔 디렉토리만 걸러서 주석과 실제 동작이 어긋나 있었다 — 리뷰 지적)
      if (e.name.startsWith('.') && e.name !== '.github') continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!excludeDirs.has(e.name)) stack.push(abs);
      } else if (e.isFile()) {
        out.push(abs);
      }
    }
  }
  // 상한에 걸려 잘렸는지를 호출자에게 알린다 — 부분 그래프를 완전한 그래프로 오인하면
  // "이 저장소엔 이게 전부"라는 틀린 결론을 내리게 된다(리뷰 지적).
  return { files: out.sort(), truncated };
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

// Go는 파일이 아니라 **패키지(디렉토리)** 를 import한다. 그래서 파일 단위로만 엣지를 그리면
// Go 저장소는 엣지가 하나도 없는 점들의 나열이 된다(gin 실측: 127파일 0엣지 — 정직하지만 쓸모없다).
// go.mod의 모듈 경로를 읽어 "내 모듈 안의 패키지" import를 식별하면 실제 구조를 그릴 수 있다.
// 표준 라이브러리나 외부 모듈은 여전히 외부로 남는다.
function readGoModulePath(projectRoot) {
  try {
    const m = /^module\s+(\S+)/m.exec(fs.readFileSync(path.join(projectRoot, 'go.mod'), 'utf8'));
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// TypeScript의 NodeNext/ESM 관행: 소스는 `./schemas.ts`인데 import는 `./schemas.js`라고 쓴다
// (컴파일 후 경로를 기준으로 쓰기 때문). 이걸 처리하지 않으면 최신 TS 프로젝트의 내부 import가
// 통째로 해석 실패한다 — zod 실측에서 559파일 중 엣지가 3개(1%)뿐이었던 원인이 이것이다.
const JS_TO_TS = { '.js': ['.ts', '.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'], '.jsx': ['.tsx'] };

function tryCandidates(joined, fileSet) {
  const candidates = [joined];

  // 확장자를 명시한 import가 TS 소스를 가리키는 경우
  const ext = path.posix.extname(joined);
  if (JS_TO_TS[ext]) {
    const stem = joined.slice(0, -ext.length);
    for (const tsExt of JS_TO_TS[ext]) candidates.push(stem + tsExt);
  }

  for (const e of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.rb']) candidates.push(joined + e);
  for (const f of ['index.ts', 'index.tsx', 'index.js', 'index.mjs', '__init__.py']) candidates.push(path.posix.join(joined, f));

  for (const c of candidates) {
    if (fileSet.has(c)) return c;
  }
  return null;
}

// 상대 import를 실제 파일로 해석한다. 확장자 생략/index 파일 관행을 흉내낸다.
function resolveRelativeImport(fromFileRel, spec, fileSet) {
  const baseDir = path.posix.dirname(fromFileRel);
  return tryCandidates(path.posix.normalize(path.posix.join(baseDir, spec)), fileSet);
}

// 파이썬은 상대경로가 아니라 점 표기 모듈 경로를 쓴다("from src.helper import x" ->
// src/helper.py). 이걸 처리하지 않으면 파이썬 프로젝트의 내부 import가 전부 "외부 패키지"로
// 오분류되어 그래프에 엣지가 하나도 안 생긴다(실측으로 확인된 결함).
//   from .helper import x   -> 같은 패키지
//   from ..pkg.mod import x -> 상위 패키지
//   from src.helper import x-> 루트 기준
function resolvePythonImport(fromFileRel, spec, fileSet) {
  const leadingDots = /^\.+/.exec(spec);
  if (leadingDots) {
    const depth = leadingDots[0].length;
    const rest = spec.slice(depth).replace(/\./g, '/');
    // 점 1개 = 현재 패키지, 2개 = 한 단계 위 ...
    let base = path.posix.dirname(fromFileRel);
    for (let i = 1; i < depth; i++) base = path.posix.dirname(base);
    return tryCandidates(path.posix.normalize(path.posix.join(base, rest)), fileSet);
  }
  // 절대 모듈 경로: 루트 기준으로 먼저, 안 되면 src 레이아웃으로 한 번 더
  // ("from mypkg.x import y"가 src/mypkg/x.py인 경우가 흔하다).
  //
  const asPath = spec.replace(/\./g, '/');

  // 점이 없는 단일 이름(`import os`, `import flask`)은 조심해서 다룬다. 대부분 표준 라이브러리나
  // 설치된 패키지인데, 저장소에 우연히 `os.py`가 있으면 가짜 엣지가 생긴다(Go의 `import "errors"`가
  // gin의 errors.go로 연결됐던 것과 같은 부류의 오류).
  //
  // 다만 무조건 막으면 반대 손실이 생긴다 — flask 저장소 안의 `from flask import x`는 진짜로
  // 로컬 패키지를 가리키는데 이것까지 외부로 분류됐다(실측: 연결률 31%->21%).
  // 그래서 **패키지 디렉토리(`<name>/__init__.py`)로 해석될 때만** 인정한다. 저장소가 stdlib과
  // 동명의 유틸 파일(`os.py`)을 갖는 건 흔하지만, 동명의 패키지 디렉토리를 갖는 건 드물다.
  if (!spec.includes('.')) {
    for (const base of ['', 'src']) {
      const initPy = path.posix.join(base, asPath, '__init__.py');
      if (fileSet.has(initPy)) return initPy;
    }
    return null;
  }

  return tryCandidates(asPath, fileSet)
    || tryCandidates(path.posix.join('src', asPath), fileSet);
}

// 언어별 표기를 경로처럼 만든 뒤 파일로 해석한다.
//
// 이전에는 "./" 나 "/" 로 시작할 때만 해석을 시도했는데, 그건 JS/TS 관행일 뿐이다. 그 결과
// C(`#include "util.h"`)·Ruby(`require_relative 'helper'`)·Rust(`mod helper;`)처럼 **정의상
// 상대 참조인** 것들까지 전부 "외부 패키지"로 오분류돼 해당 언어 프로젝트의 엣지가 0개였다
// (적대적 리뷰에서 실측 지적). 이제 어떤 언어든 파일로 해석되면 엣지를 만들고, 해석 실패한
// 것만 외부로 본다.
//
// Go의 `myapp/pkg/db`나 Java의 `com.foo.Bar`처럼 **파일이 아니라 패키지**를 가리키는 표기는
// 여전히 외부로 남는다 — 패키지는 디렉토리라 어느 파일에 이을지 단정할 수 없고, 아무 파일이나
// 골라 잇는 건 틀린 정보를 만드는 것이다.
// java/kotlin/C#은 파일 경로가 아니라 패키지·네임스페이스를 import하지만, 관행상 그 경로가
// 파일 경로의 **접미사**로 나타난다:
//   import com.google.gson.internal.Excluder
//     -> gson/src/main/java/com/google/gson/internal/Excluder.java
// 이걸 안 하면 Java/Kotlin/C# 저장소는 엣지가 0개다(실측: gson 307파일 0엣지, okhttp 791파일
// 0엣지, polly 1003파일 0엣지 — Go에서 겪은 것과 똑같이 그래프가 점들의 나열이 된다).
//
// Go의 `import "errors"`가 errors.go로 잘못 붙었던 사고를 되풀이하지 않기 위한 안전장치:
//   (1) **2세그먼트 이상**만 시도한다. 한 조각짜리 이름은 우연히 일치할 뿐이다.
//   (2) 접미사가 **디렉토리 경계**에서 정확히 끝나야 한다. `java.util.List`는 저장소에
//       `java/util/List.java`가 실제로 없으면 아무 엣지도 만들지 않는다 — 표준 라이브러리와
//       외부 의존성이 자동으로 걸러지는 이유다.
function resolvePackagePath(spec, ext, byBaseName) {
  const parts = spec.split('.').filter(Boolean);
  if (parts.length < 2) return null;

  // `import okhttp3.Protocol.HTTP_1_1`(멤버 import)이나 static import는 마지막 조각이 파일이
  // 아니므로, 뒤에서부터 한 조각씩 떼며 파일을 찾는다.
  for (let end = parts.length; end >= 2; end--) {
    const segs = parts.slice(0, end);
    const cls = segs[segs.length - 1];
    const candidates = byBaseName.get(`${cls}${ext}`);
    if (!candidates) continue;
    const suffix = `${segs.join('/')}${ext}`;
    const hit = candidates.find((p) => p === suffix || p.endsWith(`/${suffix}`));
    if (hit) return hit;
  }
  return null;
}

function resolveImport(mode, lang, fromFileRel, spec, fileSet, ctx = {}) {
  if (mode === 'pkgpath') {
    const exts = lang === 'kotlin' ? ['.kt', '.java'] : lang === 'csharp' ? ['.cs'] : ['.java', '.kt'];
    for (const ext of exts) {
      const hit = resolvePackagePath(spec, ext, ctx.byBaseName || new Map());
      if (hit) return hit;
    }
    return null;
  }
  // Go: 내 모듈 안의 패키지 import는 실제 의존성이다. 패키지는 디렉토리이므로 파일이 아니라
  // 패키지 노드로 잇는다(어느 파일인지 단정할 수 없으니 아무 파일이나 고르면 거짓 정보가 된다).
  if (mode === 'name' && lang === 'go' && ctx.goModule && spec.startsWith(ctx.goModule + '/')) {
    const pkgDir = spec.slice(ctx.goModule.length + 1);
    if (ctx.dirs && ctx.dirs.has(pkgDir)) return { pkg: pkgDir };
  }
  // 'name' = 언어 문법상 패키지/모듈 이름. 같은 이름의 로컬 파일이 있어도 그건 우연이지
  // 의존성이 아니다. 여기서 경로 해석을 시도하면 없는 엣지를 지어내게 된다.
  if (mode === 'name') return null;

  if (mode === 'py') return resolvePythonImport(fromFileRel, spec, fileSet);

  if (mode === 'js') {
    // Node의 실제 해석 규칙: bare specifier는 패키지, ./ 와 / 만 경로다.
    if (!spec.startsWith('.') && !spec.startsWith('/')) return null;
    return resolveRelativeImport(fromFileRel, spec, fileSet);
  }

  let p = spec;
  if (lang === 'rust') p = spec.replace(/::/g, '/');
  else if (lang === 'php') p = spec.replace(/\\/g, '/');

  if (mode === 'root') {
    // rust의 use crate::a::b — 크레이트 루트(src/) 기준. 워크스페이스면 crates/*/src/ 아래일 수도 있다.
    const fromCrateSrc = /^(.*?src)\//.exec(fromFileRel);
    return (fromCrateSrc && tryCandidates(path.posix.join(fromCrateSrc[1], p), fileSet))
      || tryCandidates(path.posix.join('src', p), fileSet)
      || tryCandidates(p, fileSet);
  }

  // mode === 'rel': 이 파일이 있는 디렉토리 기준. rust의 mod는 같은 디렉토리의 x.rs 또는 x/mod.rs다.
  const baseDir = path.posix.dirname(fromFileRel);
  return tryCandidates(path.posix.normalize(path.posix.join(baseDir, p)), fileSet)
    || (lang === 'rust' && tryCandidates(path.posix.normalize(path.posix.join(baseDir, p, 'mod')), fileSet));
}

function extractFromFile(absPath, relPath, lang, fileSet, ctx) {
  const imports = [];
  const decls = [];
  let namespace = null; // C# 전용: 이 파일이 선언한 네임스페이스
  let content;
  try {
    // 상한을 넘거나 읽을 수 없는 파일은 "분석 안 함"이지 "내용이 없음"이 아니다. loc: 0을
    // 돌려주면 summary가 "0줄, import 0개"라는 **사실이 아닌 문장**을 만들어낸다(이 파일이
    // 스스로 금지한 것). skipped를 명시해 호출자가 구분하게 한다(적대적 리뷰 지적).
    if (fs.statSync(absPath).size > MAX_FILE_BYTES) {
      return { imports, decls, loc: -1, skipped: 'too-large', namespace: null };
    }
    content = fs.readFileSync(absPath, 'utf8');
  } catch {
    return { imports, decls, loc: -1, skipped: 'unreadable', namespace: null };
  }
  const lines = content.split('\n');
  const importPatterns = IMPORT_PATTERNS[lang] || [];
  const declPatterns = DECL_PATTERNS[lang] || [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (isCommentLine(raw, lang)) continue;

    // 여러 줄에 걸친 import를 한 논리 구문으로 잇는다. Prettier/ESLint 기본 설정이 import
    // 목록을 줄바꿈하므로, 줄 단위로만 보면 일반적인 JS/TS 저장소의 import가 통째로 사라진다
    // (적대적 리뷰에서 critical로 실측 — Go의 import 블록은 이미 처리하고 있었는데 JS/TS만 빠져
    // 있었다). 여는 구문에 종결 따옴표가 없으면 뒤 몇 줄을 합쳐서 매칭한다.
    let line = raw;
    if (/^\s*(import|export)\b/.test(raw) && !/['"]/.test(raw)) {
      for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
        line += ' ' + lines[j].trim();
        if (/['"]/.test(lines[j])) break;
      }
    }

    for (const { re, mode } of importPatterns) {
      const m = re.exec(line);
      if (m && m[1]) {
        const spec = m[1];
        const resolved = resolveImport(mode, lang, relPath, spec, fileSet, ctx);
        imports.push({ spec, resolved, external: !resolved });
        break; // 한 줄에서 첫 매치만 — 중복 카운트 방지. 순서가 중요하다(구체적인 패턴이 먼저)
      }
    }
    if (lang === 'csharp' && !namespace) {
      const nsm = /^\s*namespace\s+([\w.]+)/.exec(raw);
      if (nsm) namespace = nsm[1];
    }
    for (const { type, re } of declPatterns) {
      const m = re.exec(raw);
      if (m && m[1]) {
        decls.push({ type, name: m[1], line: i + 1 });
        break;
      }
    }
  }
  return { imports, decls, loc: lines.length, skipped: null, namespace };
}

function fileSizeOf(abs) {
  try {
    return fs.statSync(abs).size;
  } catch {
    return 0;
  }
}

function complexityOf(loc) {
  if (loc > 400) return 'complex';
  if (loc > 120) return 'moderate';
  return 'simple';
}

// UA 호환 KnowledgeGraph를 만든다(version/project/nodes/edges/layers/tour).
// summary는 결정적으로 채울 수 있는 사실만 넣는다 — 의미 요약은 LLM 몫이고, 여기서
// 지어내면 그게 곧 거짓 정보가 된다. 그래서 "무엇인지"가 아니라 "무엇으로 이루어졌는지"만 쓴다.
export function analyzeProject(projectRoot, opts = {}) {
  const excludeDirs = new Set([...DEFAULT_EXCLUDE_DIRS, ...(opts.excludeDirs || [])]);
  const { files: absFiles, truncated } = walkFiles(projectRoot, excludeDirs);
  const goModule = readGoModulePath(projectRoot);
  const relFiles = absFiles.map((a) => toPosix(path.relative(projectRoot, a)));
  const fileSet = new Set(relFiles);
  // Go 패키지 판정용 디렉토리 집합(.go 파일을 담고 있는 디렉토리만)
  const dirs = new Set(relFiles.filter((f) => f.endsWith('.go')).map((f) => path.posix.dirname(f)));
  // basename -> 경로들. java/kotlin/C#의 패키지 경로를 접미사로 맞출 때 후보를 좁히는 색인.
  const byBaseName = new Map();
  for (const f of relFiles) {
    const b = path.posix.basename(f);
    if (!byBaseName.has(b)) byBaseName.set(b, []);
    byBaseName.get(b).push(f);
  }
  const ctx = { goModule, dirs, byBaseName };

  const nodes = [];
  const edges = [];
  const languages = new Set();
  const seenEdge = new Set();
  const goPkgDeps = []; // [파일ID, 패키지디렉토리] — 패키지 노드는 순회가 끝난 뒤 한 번에 만든다
  const csUsings = [];  // [파일ID, 네임스페이스] — 어떤 네임스페이스가 이 저장소 것인지는 전부 훑어야 안다
  const csNamespaceFiles = new Map(); // 네임스페이스 -> 그걸 선언한 파일들

  function addEdge(source, target, type, weight) {
    const key = `${source}|${target}|${type}`;
    if (seenEdge.has(key)) return;
    seenEdge.add(key);
    edges.push({ source, target, type, direction: 'forward', weight });
  }

  for (let i = 0; i < absFiles.length; i++) {
    const abs = absFiles[i];
    const rel = relFiles[i];
    const ext = path.extname(rel).toLowerCase();
    const lang = LANG_BY_EXT[ext];
    if (lang) languages.add(lang);

    const { imports, decls, loc, skipped, namespace } = lang
      ? extractFromFile(abs, rel, lang, fileSet, ctx)
      : { imports: [], decls: [], loc: -1, skipped: 'unsupported-language', namespace: null };
    const fileId = `file:${rel}`;
    let summary;
    if (skipped === 'too-large') summary = `${lang} 파일 — 분석 생략(${Math.round(fileSizeOf(abs) / 1024)}KB, 상한 ${MAX_FILE_BYTES / 1024}KB 초과)`;
    else if (skipped === 'unreadable') summary = `${lang} 파일 — 읽을 수 없어 분석 생략`;
    else if (skipped === 'unsupported-language') summary = `${ext || '확장자 없음'} 파일 (구조 추출 미지원)`;
    else summary = `${lang} 파일, ${loc}줄, 선언 ${decls.length}개, import ${imports.length}개 (정적 분석)`;
    const fileNode = {
      id: fileId,
      type: 'file',
      name: path.basename(rel),
      filePath: rel,
      summary,
      tags: [lang, path.posix.dirname(rel)].filter((t) => t && t !== '.'),
      // 분석하지 않은 파일에 복잡도를 매기면 그것도 지어낸 사실이다.
      complexity: skipped ? 'moderate' : complexityOf(loc),
    };
    nodes.push(fileNode);

    for (const d of decls.slice(0, 50)) { // 파일당 선언 상한 — 거대 파일이 그래프를 뒤덮는 것 방지
      const declId = `${d.type}:${rel}:${d.name}`;
      nodes.push({
        id: declId,
        type: d.type,
        name: d.name,
        filePath: rel,
        lineRange: [d.line, d.line],
        summary: `${path.basename(rel)}의 ${d.type} \`${d.name}\` (정적 분석)`,
        tags: [lang].filter(Boolean),
        complexity: 'simple',
      });
      addEdge(fileId, declId, 'contains', 0.9);
    }

    if (lang === 'csharp' && namespace) {
      if (!csNamespaceFiles.has(namespace)) csNamespaceFiles.set(namespace, []);
      csNamespaceFiles.get(namespace).push(rel);
    }

    for (const imp of imports) {
      if (lang === 'csharp' && !imp.resolved) {
        csUsings.push([fileId, imp.spec]); // 저장소 네임스페이스인지는 아래에서 판정
        continue;
      }
      if (imp.resolved && typeof imp.resolved === 'object' && imp.resolved.pkg) {
        // Go 패키지 의존. 패키지 노드는 아래에서 한 번만 만든다.
        goPkgDeps.push([fileId, imp.resolved.pkg]);
      } else if (imp.resolved) {
        addEdge(fileId, `file:${imp.resolved}`, 'imports', 0.7);
      } else if (imp.external) {
        // 외부 패키지는 노드로 만들면 node_modules 전체가 그래프에 번지므로, 파일 노드의
        // 태그로만 남기고 엣지는 만들지 않는다(관심사는 "내 코드의 구조"이지 의존성 트리가 아니다).
        const tag = `dep:${imp.spec}`;
        if (!fileNode.tags.includes(tag) && fileNode.tags.length < 12) fileNode.tags.push(tag);
      }
    }
  }

  // Go 패키지를 module 노드로 만든다(UA 스키마의 'module' 타입). 파일 -> 패키지가 Go의 실제
  // 의존 단위이고, 패키지 -> 그 안의 파일은 contains로 잇는다. 이렇게 해야 "어느 파일인지"를
  // 지어내지 않으면서도 구조가 드러난다.
  if (goPkgDeps.length > 0) {
    const pkgFiles = new Map();
    for (let i = 0; i < relFiles.length; i++) {
      if (!relFiles[i].endsWith('.go')) continue;
      const d = path.posix.dirname(relFiles[i]);
      if (!pkgFiles.has(d)) pkgFiles.set(d, []);
      pkgFiles.get(d).push(relFiles[i]);
    }
    const madePkg = new Set();
    for (const [fileId, pkgDir] of goPkgDeps) {
      const pkgId = `module:${pkgDir}`;
      if (!madePkg.has(pkgId)) {
        madePkg.add(pkgId);
        const members = pkgFiles.get(pkgDir) || [];
        nodes.push({
          id: pkgId,
          type: 'module',
          name: path.posix.basename(pkgDir),
          filePath: pkgDir,
          summary: `Go 패키지 ${pkgDir} — 파일 ${members.length}개 (정적 분석)`,
          tags: ['go', 'package'],
          complexity: members.length > 8 ? 'complex' : 'moderate',
        });
        for (const f of members) addEdge(pkgId, `file:${f}`, 'contains', 0.9);
      }
      addEdge(fileId, pkgId, 'imports', 0.7);
    }
  }

  // C# 네임스페이스 노드. 이 저장소가 실제로 선언한 네임스페이스만 만든다 — System.* 나 외부
  // 패키지는 여기 없으므로 자동으로 걸러진다(Go에서 stdlib이 걸러지는 것과 같은 원리).
  if (csUsings.length > 0) {
    const madeNs = new Set();
    for (const [fileId, ns] of csUsings) {
      const members = csNamespaceFiles.get(ns);
      if (!members) continue; // 이 저장소 것이 아님 = 외부 의존성
      const nsId = `module:${ns}`;
      if (!madeNs.has(nsId)) {
        madeNs.add(nsId);
        nodes.push({
          id: nsId,
          type: 'module',
          name: ns,
          filePath: '',
          summary: `C# 네임스페이스 ${ns} — 파일 ${members.length}개 (정적 분석)`,
          tags: ['csharp', 'namespace'],
          complexity: members.length > 8 ? 'complex' : 'moderate',
        });
        for (const f of members) addEdge(nsId, `file:${f}`, 'contains', 0.9);
      }
      addEdge(fileId, nsId, 'imports', 0.7);
    }
  }

  // dangling edge 제거 — 해석 실패한 import가 존재하지 않는 노드를 가리킬 수 있다.
  const nodeIds = new Set(nodes.map((n) => n.id));
  const cleanEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

  return {
    version: '1.0.0',
    kind: 'codebase',
    project: {
      name: path.basename(projectRoot),
      languages: [...languages].sort(),
      frameworks: [],
      description: truncated
        ? `${path.basename(projectRoot)} — OKF 정적 분석(파일 ${MAX_FILES}개 상한에 걸려 일부만 분석됨)`
        : `${path.basename(projectRoot)} — OKF 정적 분석(결정적, LLM 미사용)`,
      analyzedAt: new Date().toISOString(),
      gitCommitHash: '',
    },
    nodes,
    edges: cleanEdges,
    layers: [],
    tour: [],
    truncated, // UA 스키마 밖의 필드지만 노드/그래프 모두 passthrough라 안전하고, 이걸 숨기면
               // 사용자가 부분 그래프를 전체로 오인한다
  };
}

// UA가 이미 만들어둔 그래프를 읽는다. UA의 persistence는 `.understand-anything/`가 있으면
// 그쪽을 쓰고 없을 때만 `.ua/`를 쓰므로(legacy 우선), 감지 순서를 그대로 맞춘다.
export function loadUaGraph(projectRoot) {
  for (const dir of ['.understand-anything', '.ua']) {
    const p = path.join(projectRoot, dir, 'knowledge-graph.json');
    if (!fs.existsSync(p)) continue;
    try {
      const g = JSON.parse(fs.readFileSync(p, 'utf8'));
      // 이 파일은 LLM이 생성하고 자동교정을 거치며, 그 파이프라인을 안 거친 채 커밋됐을 수도
      // 있다 — 필수 필드를 직접 확인한다(그쪽 zod에 기대지 않는다).
      if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) return null;
      const nodeIds = new Set(g.nodes.map((n) => n && n.id).filter(Boolean));
      return {
        version: typeof g.version === 'string' ? g.version : '1.0.0',
        kind: typeof g.kind === 'string' ? g.kind : 'codebase', // loadGraph가 흘리는 필드 — 직접 읽으면 살아있다
        project: g.project && typeof g.project === 'object' ? g.project : { name: path.basename(projectRoot) },
        nodes: g.nodes.filter((n) => n && typeof n.id === 'string'),
        edges: g.edges.filter((e) => e && nodeIds.has(e.source) && nodeIds.has(e.target)),
        layers: Array.isArray(g.layers) ? g.layers : [],
        tour: Array.isArray(g.tour) ? g.tour : [],
        source: dir,
      };
    } catch {
      return null; // 손상된 파일 때문에 시각화 전체가 죽으면 안 된다
    }
  }
  return null;
}

// UA 그래프가 있으면 그걸(LLM 요약이 있어 더 풍부하다), 없으면 우리 정적 분석을 쓴다.
export function loadOrAnalyze(projectRoot, opts = {}) {
  const ua = loadUaGraph(projectRoot);
  if (ua) return { graph: ua, source: `understand-anything (${ua.source})` };
  return { graph: analyzeProject(projectRoot, opts), source: 'okf static analysis' };
}
