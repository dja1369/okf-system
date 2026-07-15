import fs from 'node:fs';
import path from 'node:path';
import { okfPaths, SCAN_EXCLUDE_DIRS } from './paths.mjs';
import { parseFrontmatter } from './frontmatter.mjs';
import { loadOrAnalyze } from './analyze.mjs';

// OKF 번들(무엇을 알고 있나)과 로컬 코드 분석(무엇이 실제로 있나)을 하나의 그래프로 합쳐
// 자체완결 HTML로 렌더한다. 이 둘을 잇는 게 핵심 — "이 결정이 어느 코드에 관한 것인가"를
// 보여주는 게 목적이고, 각각 따로 보는 것보다 그 연결선에 정보가 있다.
//
// 산출 HTML은 CDN을 쓰지 않는다(오프라인/사내망/CSP 환경에서도 열려야 하고, 지식 번들을
// 여는 것만으로 외부에 요청이 나가면 안 된다). 그래서 레이아웃/렌더/인터랙션 전부 인라인
// 바닐라 JS + canvas다.

const TYPE_COLORS = {
  // OKF 택소노미
  project: '#4f9dff', decision: '#ff6b6b', preference: '#ffd93d',
  pattern: '#a78bfa', reference: '#4ecdc4', troubleshooting: '#ff9f43',
  schema: '#8892b0',
  // 코드(UA 호환 타입)
  file: '#5c6bc0', function: '#66bb6a', class: '#26a69a', module: '#7e57c2',
};
const DEFAULT_COLOR = '#8892b0';

function collectOkfNodes(okfHome) {
  const nodes = [];
  const edges = [];
  let entries;
  try {
    entries = fs.readdirSync(okfHome, { withFileTypes: true });
  } catch {
    return { nodes, edges };
  }
  for (const dirent of entries) {
    if (!dirent.isDirectory() || SCAN_EXCLUDE_DIRS.has(dirent.name)) continue;
    const dir = path.join(okfHome, dirent.name);
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of files) {
      if (!name.endsWith('.md') || name === 'index.md') continue;
      let content;
      try {
        content = fs.readFileSync(path.join(dir, name), 'utf8');
      } catch {
        continue;
      }
      const { data, body } = parseFrontmatter(content);
      const fm = data && typeof data === 'object' ? data : {};
      const id = `/${dirent.name}/${name}`;
      nodes.push({
        id,
        kind: 'okf',
        type: typeof fm.type === 'string' ? fm.type : dirent.name,
        name: typeof fm.title === 'string' ? fm.title : name.replace(/\.md$/, ''),
        summary: typeof fm.description === 'string' ? fm.description : '',
        tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
        body: String(body || '').slice(0, 4000), // 상세 패널용. 통째로 넣으면 HTML이 비대해진다
        filePath: id,
      });
      // concept 간 링크: 번들 루트 절대경로 형식(/decisions/foo.md)이 OKF 규약이다.
      const linkRe = /\]\((\/[^)#\s]+\.md)/g;
      let m;
      while ((m = linkRe.exec(body || ''))) {
        edges.push({ source: id, target: m[1], type: 'links_to', weight: 0.8 });
      }
    }
  }
  return { nodes, edges };
}

// concept 본문이 언급하는 코드 파일을 찾아 교차 엣지를 만든다. 이게 이 시각화의 존재 이유다.
// 경로처럼 생긴 토큰만 뽑아서 코드 파일 집합과 대조한다(전문 검색이 아니라 정확 일치).
function crossLink(okfNodes, codeNodes) {
  const byPath = new Map();
  for (const n of codeNodes) {
    if (n.type === 'file' && n.filePath) byPath.set(n.filePath, n.id);
  }
  if (byPath.size === 0) return [];

  // basename -> 후보들. 본문이 "batch.mjs"처럼 파일명만 언급하는 경우가 흔한데, 이름이
  // 유일할 때만 연결한다(중복되면 어느 쪽인지 알 수 없으므로 연결하지 않는 게 맞다).
  const byBase = new Map();
  for (const [p, id] of byPath) {
    const b = p.split('/').pop();
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(id);
  }

  const edges = [];
  const seen = new Set();
  for (const concept of okfNodes) {
    const text = `${concept.name}\n${concept.summary}\n${concept.body}`;
    const tokens = new Set(text.match(/[\w./-]+\.[a-zA-Z0-9]{1,5}\b/g) || []);
    for (const raw of tokens) {
      const token = raw.replace(/^[./]+/, '');
      let targetId = byPath.get(token);
      if (!targetId) {
        const base = token.split('/').pop();
        const cands = byBase.get(base);
        if (cands && cands.length === 1) targetId = cands[0];
      }
      if (!targetId) continue;
      const key = `${concept.id}|${targetId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: concept.id, target: targetId, type: 'describes', weight: 1 });
    }
  }
  return edges;
}

export function buildGraph(okfHome, projectRoot) {
  const okf = collectOkfNodes(okfHome);
  const { graph: code, source } = projectRoot
    ? loadOrAnalyze(projectRoot)
    : { graph: { nodes: [], edges: [] }, source: 'none' };

  const codeNodes = (code.nodes || []).map((n) => ({
    id: n.id,
    kind: 'code',
    type: n.type,
    name: n.name,
    summary: n.summary || '',
    tags: Array.isArray(n.tags) ? n.tags : [],
    body: '',
    filePath: n.filePath || '',
  }));

  const nodes = [...okf.nodes, ...codeNodes];
  const ids = new Set(nodes.map((n) => n.id));
  const cross = crossLink(okf.nodes, codeNodes);
  const edges = [...okf.edges, ...(code.edges || []), ...cross]
    .filter((e) => ids.has(e.source) && ids.has(e.target)); // 깨진 링크(존재하지 않는 concept 등)는 렌더에서 제외

  return {
    nodes,
    edges,
    meta: {
      okfHome,
      projectRoot: projectRoot || '',
      codeSource: source,
      okfCount: okf.nodes.length,
      codeCount: codeNodes.length,
      crossCount: cross.length,
      generatedAt: new Date().toISOString(),
    },
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function renderHtml(graph) {
  // 데이터는 </script>로 HTML을 깨뜨릴 수 있으므로 이스케이프해서 임베드한다.
  const json = JSON.stringify(graph).replace(/</g, '\\u003c');
  const colors = JSON.stringify(TYPE_COLORS);
  const m = graph.meta;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>OKF Knowledge Graph — ${escapeHtml(path.basename(m.projectRoot || m.okfHome))}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
         background:#0f1419; color:#e6e6e6; overflow:hidden; }
  #wrap { display:flex; height:100vh; }
  #main { flex:1; position:relative; }
  canvas { display:block; cursor:grab; }
  canvas.dragging { cursor:grabbing; }
  #side { width:340px; border-left:1px solid #26303d; background:#141b23; overflow-y:auto; padding:14px; }
  h1 { font-size:14px; margin:0 0 4px; }
  .sub { color:#8892b0; font-size:11px; margin-bottom:12px; }
  .stat { display:flex; gap:10px; margin-bottom:12px; flex-wrap:wrap; }
  .stat div { background:#1c2530; border-radius:5px; padding:5px 8px; font-size:11px; }
  .stat b { color:#4f9dff; }
  #search { width:100%; padding:7px 9px; background:#1c2530; border:1px solid #2d3846;
            border-radius:5px; color:#e6e6e6; margin-bottom:10px; font-size:12px; }
  #search:focus { outline:none; border-color:#4f9dff; }
  .legend { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:12px; }
  .legend button { background:#1c2530; border:1px solid #2d3846; border-radius:4px; cursor:pointer;
                   padding:3px 7px; font-size:11px; color:#e6e6e6; display:flex; align-items:center; gap:4px; }
  .legend button.off { opacity:.35; }
  .dot { width:8px; height:8px; border-radius:50%; }
  #detail { border-top:1px solid #26303d; padding-top:12px; }
  #detail h2 { font-size:13px; margin:0 0 3px; }
  #detail .path { color:#8892b0; font-size:11px; word-break:break-all; margin-bottom:8px; }
  #detail pre { white-space:pre-wrap; word-break:break-word; background:#0f1419; padding:9px;
                border-radius:5px; font-size:11px; max-height:280px; overflow-y:auto; color:#c8d0da; }
  .rel { margin-top:9px; }
  .rel h3 { font-size:11px; color:#8892b0; margin:0 0 4px; text-transform:uppercase; letter-spacing:.5px; }
  .rel a { display:block; color:#4f9dff; text-decoration:none; padding:2px 0; font-size:11px; cursor:pointer; }
  .rel a:hover { text-decoration:underline; }
  .hint { color:#5a6678; font-size:11px; }
</style>
</head>
<body>
<div id="wrap">
  <div id="main"><canvas id="cv"></canvas></div>
  <div id="side">
    <h1>OKF Knowledge Graph</h1>
    <div class="sub">${escapeHtml(m.okfHome)}<br>code: ${escapeHtml(m.codeSource)}</div>
    <div class="stat">
      <div>concepts <b>${m.okfCount}</b></div>
      <div>code <b>${m.codeCount}</b></div>
      <div>links <b>${m.crossCount}</b></div>
    </div>
    <input id="search" placeholder="Search name, path, tag…">
    <div class="legend" id="legend"></div>
    <div id="detail"><div class="hint">Click a node for details. Drag to pan, scroll to zoom.<br>Dashed yellow = a concept describing code.</div></div>
  </div>
</div>
<script>
const DATA = ${json};
const COLORS = ${colors};
const DEFAULT_COLOR = ${JSON.stringify(DEFAULT_COLOR)};

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const nodes = DATA.nodes.map((n, i) => ({
  ...n,
  // 초기 배치를 원형으로 흩뿌린다. 전부 (0,0)에서 시작하면 힘이 0으로 나눠져 폭발한다.
  x: Math.cos(i * 2.399) * (80 + i % 240),
  y: Math.sin(i * 2.399) * (80 + i % 240),
  vx: 0, vy: 0,
  deg: 0,
}));
const byId = new Map(nodes.map(n => [n.id, n]));
const links = DATA.edges.map(e => ({ ...e, s: byId.get(e.source), t: byId.get(e.target) })).filter(l => l.s && l.t);
for (const l of links) { l.s.deg++; l.t.deg++; }

const types = [...new Set(nodes.map(n => n.type))].sort();
// function/class 노드는 중간 규모 저장소만 돼도 수백 개라, 켜두면 개념과 교차 연결이 그 속에
// 파묻혀 개요로서 쓸모가 없어진다(실측: concept 10개 vs function 124개). 기본은 끄고 범례에서
// 켜게 한다 — 개요에서 보고 싶은 건 "무엇을 아는가 ↔ 어느 파일인가"이지 함수 목록이 아니다.
const NOISY_TYPES = ['function', 'class'];
const hidden = new Set(NOISY_TYPES.filter(t => types.includes(t) && nodes.filter(n => n.type === t).length > 40));
let view = { x: 0, y: 0, k: 1 };
let selected = null, hoverNode = null, query = '';

// concept는 이 그래프의 주인공이라 연결 수와 무관하게 최소 크기를 보장한다 — 코드 파일 하나만
// 언급한 개념이 허브 파일보다 작게 그려지면 무엇이 중요한지가 반대로 읽힌다.
function radius(n) {
  const base = Math.min(4 + Math.sqrt(n.deg) * 2.2, 16);
  return n.kind === 'okf' ? Math.max(base, 8) : base;
}
function colorOf(n) { return COLORS[n.type] || DEFAULT_COLOR; }
function visible(n) {
  if (hidden.has(n.type)) return false;
  if (!query) return true;
  const q = query.toLowerCase();
  return (n.name || '').toLowerCase().includes(q)
      || (n.filePath || '').toLowerCase().includes(q)
      || (n.tags || []).join(' ').toLowerCase().includes(q);
}

// --- 레이아웃: 간단한 force-directed (반발 + 스프링 + 중심 인력) ---
// 라이브러리 없이 돌려야 해서 Barnes-Hut 없이 O(n^2) 반발을 쓴다. 노드 수 상한(분석기의
// MAX_FILES)이 있어서 이 정도 규모에선 충분히 돈다.
let alpha = 1;
function step() {
  if (alpha < 0.005) return;
  const vis = nodes.filter(visible);
  for (let i = 0; i < vis.length; i++) {
    const a = vis[i];
    for (let j = i + 1; j < vis.length; j++) {
      const b = vis[j];
      let dx = b.x - a.x, dy = b.y - a.y;
      let d2 = dx*dx + dy*dy;
      if (d2 < 1) { d2 = 1; dx = (Math.random()-0.5); dy = (Math.random()-0.5); }
      if (d2 > 90000) continue; // 멀리 있는 쌍은 무시 — 반발력이 어차피 무의미하고 O(n^2)를 줄여준다
      // concept는 라벨을 항상 달기 때문에 서로 겹치면 글자가 뭉개져 읽을 수 없다 — 개념끼리는
      // 더 세게 밀어내서 라벨이 놓일 자리를 확보한다.
      const bothOkf = a.kind === 'okf' && b.kind === 'okf';
      const f = (bothOkf ? 6000 : 900) / d2;
      const d = Math.sqrt(d2);
      const fx = (dx/d)*f, fy = (dy/d)*f;
      a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
    }
  }
  for (const l of links) {
    if (!visible(l.s) || !visible(l.t)) continue;
    const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y;
    const d = Math.sqrt(dx*dx + dy*dy) || 1;
    const target = l.type === 'describes' ? 70 : 45;
    const f = (d - target) * 0.012 * (l.weight || 0.5);
    const fx = (dx/d)*f, fy = (dy/d)*f;
    l.s.vx += fx; l.s.vy += fy; l.t.vx -= fx; l.t.vy -= fy;
  }
  for (const n of vis) {
    n.vx -= n.x * 0.002; n.vy -= n.y * 0.002; // 중심으로 약하게 당겨 화면 밖 이탈 방지
    n.vx *= 0.82; n.vy *= 0.82;
    n.x += n.vx * alpha; n.y += n.vy * alpha;
  }
  alpha *= 0.995;
}

function draw() {
  const w = cv.width = cv.parentElement.clientWidth * devicePixelRatio;
  const h = cv.height = cv.parentElement.clientHeight * devicePixelRatio;
  cv.style.width = cv.parentElement.clientWidth + 'px';
  cv.style.height = cv.parentElement.clientHeight + 'px';
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,w,h);
  ctx.translate(w/2 + view.x*devicePixelRatio, h/2 + view.y*devicePixelRatio);
  ctx.scale(view.k*devicePixelRatio, view.k*devicePixelRatio);

  for (const l of links) {
    if (!visible(l.s) || !visible(l.t)) continue;
    const hot = selected && (l.s === selected || l.t === selected);
    // 교차 엣지(concept -> 코드)는 이 그래프의 핵심 정보라 다른 엣지와 확실히 구분되게 그린다.
    if (l.type === 'describes') {
      ctx.strokeStyle = hot ? '#ffd93d' : 'rgba(255,217,61,.45)';
      ctx.lineWidth = hot ? 2 : 1.2;
      ctx.setLineDash([4,3]);
    } else {
      ctx.strokeStyle = hot ? '#4f9dff' : 'rgba(120,140,170,.16)';
      ctx.lineWidth = hot ? 1.6 : 0.7;
      ctx.setLineDash([]);
    }
    ctx.beginPath(); ctx.moveTo(l.s.x, l.s.y); ctx.lineTo(l.t.x, l.t.y); ctx.stroke();
  }
  ctx.setLineDash([]);

  for (const n of nodes) {
    if (!visible(n)) continue;
    const r = radius(n);
    ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 6.284);
    ctx.fillStyle = colorOf(n);
    ctx.globalAlpha = (selected && selected !== n && !links.some(l => (l.s===selected&&l.t===n)||(l.t===selected&&l.s===n))) ? 0.3 : 1;
    ctx.fill();
    if (n.kind === 'okf') { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4; ctx.stroke(); }
    if (n === selected || n === hoverNode) { ctx.strokeStyle = '#ffd93d'; ctx.lineWidth = 2.4; ctx.stroke(); }
    ctx.globalAlpha = 1;
    // concept와 허브 노드만 라벨을 단다 — 전부 달면 읽을 수 없게 뭉갠다.
    if (view.k > 0.55 && (n.kind === 'okf' || n.deg > 4 || n === selected)) {
      const label = (n.name || '').slice(0, 34);
      const size = Math.max(9, 10 / view.k);
      ctx.font = (n.kind === 'okf' ? '600 ' : '') + size + 'px sans-serif';
      // concept 라벨 뒤에 배경을 깔아 엣지·노드 위에 겹쳐도 읽히게 한다. 라벨이 선에 묻히면
      // 그래프가 예쁘기만 하고 정보를 못 준다.
      if (n.kind === 'okf') {
        const w = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(15,20,25,.82)';
        ctx.fillRect(n.x + r + 2, n.y - size * 0.8, w + 5, size * 1.35);
      }
      ctx.fillStyle = n.kind === 'okf' ? '#fff' : '#c8d0da';
      ctx.fillText(label, n.x + r + 4, n.y + 3);
    }
  }
}

// 레이아웃이 안정되면 보이는 노드 전체가 화면에 들어오도록 한 번 맞춘다. 이게 없으면 그래프가
// 화면 밖이나 구석에 자리잡아 사용자가 직접 찾아 헤매야 한다(빈 화면을 보고 "안 된다"고 오해).
// 사용자가 이미 조작을 시작했으면 건드리지 않는다 — 조작 중에 시점을 뺏는 게 더 나쁘다.
let userTouchedView = false;
let didAutoFit = false;
function autoFit() {
  const vis = nodes.filter(visible);
  if (vis.length === 0) return;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of vis) {
    minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
  }
  const w = cv.parentElement.clientWidth, h = cv.parentElement.clientHeight;
  const pad = 90; // 라벨이 노드 오른쪽으로 뻗으므로 여유를 둔다
  const k = Math.min((w - pad * 2) / Math.max(maxX - minX, 1), (h - pad * 2) / Math.max(maxY - minY, 1));
  view.k = Math.max(0.15, Math.min(1.6, k));
  view.x = -((minX + maxX) / 2) * view.k;
  view.y = -((minY + maxY) / 2) * view.k;
}

function loop() {
  step();
  if (!didAutoFit && !userTouchedView && alpha < 0.06) { autoFit(); didAutoFit = true; }
  draw();
  requestAnimationFrame(loop);
}

function screenToWorld(px, py) {
  const rect = cv.getBoundingClientRect();
  return {
    x: (px - rect.left - rect.width/2 - view.x) / view.k,
    y: (py - rect.top - rect.height/2 - view.y) / view.k,
  };
}
function nodeAt(px, py) {
  const p = screenToWorld(px, py);
  let best = null, bd = Infinity;
  for (const n of nodes) {
    if (!visible(n)) continue;
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d < radius(n) + 4 && d < bd) { bd = d; best = n; }
  }
  return best;
}

function select(n) {
  selected = n;
  const d = document.getElementById('detail');
  if (!n) { d.innerHTML = '<div class="hint">노드를 클릭하면 상세가 보입니다.</div>'; return; }
  const ins = links.filter(l => l.t === n), outs = links.filter(l => l.s === n);
  const relHtml = (title, arr, pick) => arr.length ? '<div class="rel"><h3>' + title + '</h3>' +
    arr.slice(0, 24).map(l => { const o = pick(l);
      return '<a data-id="' + esc(o.id) + '">' + esc(o.name || o.id) + (l.type==='describes'?' ★':'') + '</a>'; }).join('') + '</div>' : '';
  d.innerHTML =
    '<h2>' + esc(n.name || n.id) + '</h2>' +
    '<div class="path">' + esc(n.type) + ' · ' + esc(n.filePath || n.id) + '</div>' +
    (n.summary ? '<pre>' + esc(n.summary) + '</pre>' : '') +
    (n.body ? '<pre>' + esc(n.body.slice(0, 1500)) + '</pre>' : '') +
    relHtml('나가는 연결', outs, l => l.t) +
    relHtml('들어오는 연결', ins, l => l.s);
  d.querySelectorAll('a[data-id]').forEach(a => a.onclick = () => {
    const t = byId.get(a.dataset.id);
    if (t) { select(t); view.x = -t.x * view.k; view.y = -t.y * view.k; alpha = Math.max(alpha, 0.15); }
  });
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

let drag = null, dragNode = null;
cv.addEventListener('mousedown', e => {
  const n = nodeAt(e.clientX, e.clientY);
  if (n) { dragNode = n; } else { drag = { x: e.clientX - view.x, y: e.clientY - view.y }; cv.classList.add('dragging'); }
});
window.addEventListener('mousemove', e => {
  if (dragNode) {
    const p = screenToWorld(e.clientX, e.clientY);
    dragNode.x = p.x; dragNode.y = p.y; dragNode.vx = 0; dragNode.vy = 0;
    alpha = Math.max(alpha, 0.12);
  } else if (drag) {
    userTouchedView = true;
    view.x = e.clientX - drag.x; view.y = e.clientY - drag.y;
  } else {
    hoverNode = nodeAt(e.clientX, e.clientY);
    cv.style.cursor = hoverNode ? 'pointer' : 'grab';
  }
});
window.addEventListener('mouseup', e => {
  if (dragNode && Math.abs(e.movementX) < 2) select(dragNode);
  dragNode = null; drag = null; cv.classList.remove('dragging');
});
cv.addEventListener('click', e => { const n = nodeAt(e.clientX, e.clientY); if (!n) select(null); else select(n); });
cv.addEventListener('wheel', e => {
  e.preventDefault();
  userTouchedView = true;
  const k = view.k * (e.deltaY < 0 ? 1.12 : 0.89);
  view.k = Math.max(0.1, Math.min(5, k));
}, { passive: false });

document.getElementById('search').addEventListener('input', e => { query = e.target.value; alpha = Math.max(alpha, 0.2); });

const legend = document.getElementById('legend');
for (const t of types) {
  const b = document.createElement('button');
  b.innerHTML = '<span class="dot" style="background:' + (COLORS[t]||DEFAULT_COLOR) + '"></span>' + esc(t)
              + ' <span style="color:#5a6678">' + nodes.filter(n=>n.type===t).length + '</span>';
  if (hidden.has(t)) b.classList.add('off'); // 기본 숨김 타입은 범례에도 꺼진 상태로 보여야 한다
  b.onclick = () => { hidden.has(t) ? hidden.delete(t) : hidden.add(t); b.classList.toggle('off'); alpha = Math.max(alpha, 0.35); if (!userTouchedView) didAutoFit = false; };
  legend.appendChild(b);
}

window.addEventListener('resize', draw);
loop();
</script>
</body>
</html>`;
}

export function generateViz(okfHome, projectRoot, outPath) {
  const graph = buildGraph(okfHome, projectRoot);
  const html = renderHtml(graph);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, 'utf8');
  return { outPath, meta: graph.meta };
}
