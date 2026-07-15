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

// 언어별 import 추출 정규식. 각 정규식은 캡처그룹 1에 "가져오는 대상"을 담아야 한다.
const IMPORT_PATTERNS = {
  javascript: [
    /^\s*import\s+(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"]+)['"]/,
    /^\s*export\s+(?:[\w*{}\s,$]+\s+)?from\s+['"]([^'"]+)['"]/,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/,
  ],
  python: [
    /^\s*import\s+([\w.]+)/,
    /^\s*from\s+([\w.]+)\s+import\s+/,
  ],
  go: [
    /^\s*import\s+"([^"]+)"/,
    /^\s*_?\s*"([^"]+)"\s*$/, // import ( ... ) 블록 안의 한 줄
  ],
  rust: [
    /^\s*use\s+([\w:]+)/,
    /^\s*mod\s+(\w+)\s*;/,
  ],
  java: [/^\s*import\s+(?:static\s+)?([\w.]+)\s*;/],
  ruby: [
    /^\s*require\s+['"]([^'"]+)['"]/,
    /^\s*require_relative\s+['"]([^'"]+)['"]/,
  ],
  php: [
    /^\s*use\s+([\w\\]+)/,
    /^\s*(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/,
  ],
  c: [/^\s*#\s*include\s+[<"]([^>"]+)[>"]/],
  csharp: [/^\s*using\s+(?:static\s+)?([\w.]+)\s*;/],
  swift: [/^\s*import\s+(\w+)/],
};
IMPORT_PATTERNS.typescript = IMPORT_PATTERNS.javascript;
IMPORT_PATTERNS.kotlin = IMPORT_PATTERNS.java;
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
DECL_PATTERNS.typescript = DECL_PATTERNS.javascript;
DECL_PATTERNS.kotlin = DECL_PATTERNS.java;

function isCommentLine(line, lang) {
  const t = line.trim();
  if (!t) return true;
  if (lang === 'python' || lang === 'ruby' || lang === 'shell') return t.startsWith('#');
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function walkFiles(root, excludeDirs) {
  const out = [];
  const stack = [root];
  while (stack.length > 0 && out.length < MAX_FILES) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (out.length >= MAX_FILES) break;
      if (e.name.startsWith('.') && e.name !== '.github') {
        // 숨김 디렉토리/파일은 기본 제외 — 설정 노이즈가 그래프를 뒤덮는 걸 막는다.
        if (e.isDirectory()) continue;
      }
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!excludeDirs.has(e.name)) stack.push(abs);
      } else if (e.isFile()) {
        out.push(abs);
      }
    }
  }
  return out.sort();
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function tryCandidates(joined, fileSet) {
  const candidates = [
    joined,
    ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.rb'].map((ext) => `${joined}${ext}`),
    ...['index.ts', 'index.tsx', 'index.js', 'index.mjs', '__init__.py'].map((f) => path.posix.join(joined, f)),
  ];
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
  // 절대 모듈 경로: 루트 기준으로 먼저, 안 되면 최상위 패키지 디렉토리를 벗겨서 한 번 더
  // (src 레이아웃에서 "from mypkg.x import y"가 src/mypkg/x.py인 경우가 흔하다).
  const asPath = spec.replace(/\./g, '/');
  return tryCandidates(asPath, fileSet)
    || tryCandidates(path.posix.join('src', asPath), fileSet);
}

function extractFromFile(absPath, relPath, lang, fileSet) {
  const imports = [];
  const decls = [];
  let content;
  try {
    if (fs.statSync(absPath).size > MAX_FILE_BYTES) return { imports, decls, loc: 0 };
    content = fs.readFileSync(absPath, 'utf8');
  } catch {
    return { imports, decls, loc: 0 };
  }
  const lines = content.split('\n');
  const importPatterns = IMPORT_PATTERNS[lang] || [];
  const declPatterns = DECL_PATTERNS[lang] || [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line, lang)) continue;

    for (const re of importPatterns) {
      const m = re.exec(line);
      if (m && m[1]) {
        const spec = m[1];
        const resolved = lang === 'python'
          ? resolvePythonImport(relPath, spec, fileSet)
          : (spec.startsWith('.') || spec.startsWith('/') ? resolveRelativeImport(relPath, spec, fileSet) : null);
        imports.push({ spec, resolved, external: !resolved });
        break; // 한 줄에서 첫 매치만 — 중복 카운트 방지
      }
    }
    for (const { type, re } of declPatterns) {
      const m = re.exec(line);
      if (m && m[1]) {
        decls.push({ type, name: m[1], line: i + 1 });
        break;
      }
    }
  }
  return { imports, decls, loc: lines.length };
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
  const absFiles = walkFiles(projectRoot, excludeDirs);
  const relFiles = absFiles.map((a) => toPosix(path.relative(projectRoot, a)));
  const fileSet = new Set(relFiles);

  const nodes = [];
  const edges = [];
  const languages = new Set();
  const seenEdge = new Set();

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

    const { imports, decls, loc } = lang ? extractFromFile(abs, rel, lang, fileSet) : { imports: [], decls: [], loc: 0 };
    const fileId = `file:${rel}`;
    const fileNode = {
      id: fileId,
      type: 'file',
      name: path.basename(rel),
      filePath: rel,
      summary: lang
        ? `${lang} 파일, ${loc}줄, 선언 ${decls.length}개, import ${imports.length}개 (정적 분석)`
        : `${ext || '확장자 없음'} 파일 (정적 분석: 구조 추출 미지원 언어)`,
      tags: [lang, path.posix.dirname(rel)].filter((t) => t && t !== '.'),
      complexity: complexityOf(loc),
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

    for (const imp of imports) {
      if (imp.resolved) {
        addEdge(fileId, `file:${imp.resolved}`, 'imports', 0.7);
      } else if (imp.external) {
        // 외부 패키지는 노드로 만들면 node_modules 전체가 그래프에 번지므로, 파일 노드의
        // 태그로만 남기고 엣지는 만들지 않는다(관심사는 "내 코드의 구조"이지 의존성 트리가 아니다).
        const tag = `dep:${imp.spec}`;
        if (!fileNode.tags.includes(tag) && fileNode.tags.length < 12) fileNode.tags.push(tag);
      }
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
      description: `${path.basename(projectRoot)} — OKF 정적 분석(결정적, LLM 미사용)`,
      analyzedAt: new Date().toISOString(),
      gitCommitHash: '',
    },
    nodes,
    edges: cleanEdges,
    layers: [],
    tour: [],
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
