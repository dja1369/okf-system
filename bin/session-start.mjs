import fs from 'node:fs';
import path from 'node:path';
import { resolveOkfHome, okfPaths } from '../lib/paths.mjs';
import { readConfig, DEFAULT_CONFIG } from '../lib/config.mjs';
import { ensureBootstrap } from '../lib/bootstrap.mjs';
import { maybeSpawnBatch } from '../lib/batch-gate.mjs';
import { truncateUtf8Bytes, capLines } from '../lib/text.mjs';
import { discoverConceptDirs, DIR_DESCRIPTIONS } from '../lib/index-gen.mjs';

// 게이트의 목적은 "관련 concept를 실제로 Read 하게 만드는 것"인데, 루트 index.md는 카테고리별
// 개수만 담는다("references — 3개"). 개수만으로는 관련성을 판단할 수 없어 게이트가 지시를 해도
// 읽을 대상을 고를 수 없다(AGENDA.md:52의 미결 안건 — "MEMORY.md 방식 참고"가 가리키던 지점).
// 각 카테고리 index.md에는 이미 `- [제목](/dir/file.md): 설명` 한 줄씩 들어 있으므로, 주입
// 시점에 그걸 병합한다. 번들 파일 포맷과 index-gen은 그대로 두고 표현만 바꾼다.
function readCategoryLines(okfHome, dir) {
  try {
    return fs.readFileSync(path.join(okfHome, dir, 'index.md'), 'utf8').trim().split('\n').filter(Boolean);
  } catch {
    return []; // 카테고리 index.md 부재(부트스트랩 직후 등) — 빈 카테고리로 취급한다.
  }
}

// 예산 안에서 카테고리를 번갈아 한 줄씩 채운다(round-robin). 사전순으로 앞에서부터 채우면
// 큰 카테고리 하나가 예산을 통째로 먹고 뒤 카테고리는 index에서 완전히 사라진다 — 축출 순서가
// 관련성도 최신성도 아닌 파일명 사전순이 된다. 실제 한국어 concept 줄은 ~200바이트라 바이트
// 캡이 40개 근처에서 물리므로, decisions 200개짜리 번들에서는 troubleshooting이 통째로 증발했다.
// 잘릴 때는 카테고리마다 몇 개가 빠졌는지 남긴다: 모델이 "이 index는 일부"라는 걸 알아야
// 없는 것을 없다고 단정하지 않는다.
function buildInjectedIndex(okfHome, budgetLines, budgetBytes) {
  const cats = discoverConceptDirs(okfHome).map((dir) => ({
    dir, label: DIR_DESCRIPTIONS[dir] || dir, lines: readCategoryLines(okfHome, dir), taken: 0,
  }));
  if (!cats.length) return '';

  const headingFor = (c, count) => `## ${c.dir} (${c.label}) — ${count}`;
  // heading은 카테고리 수만큼 고정 비용이다 — 항목보다 먼저 예약해야 카테고리 자체가 사라지지 않는다.
  let lines = budgetLines - cats.length * 2;
  let bytes = budgetBytes - cats.reduce((sum, c) => sum + Buffer.byteLength(`${headingFor(c, `${c.lines.length}개`)}\n\n`, 'utf8'), 0);

  for (let progress = true; progress && lines > 0 && bytes > 0; ) {
    progress = false;
    for (const c of cats) {
      if (c.taken >= c.lines.length) continue;
      const cost = Buffer.byteLength(`${c.lines[c.taken]}\n`, 'utf8');
      if (lines < 1 || bytes < cost) { lines = 0; break; }
      c.taken += 1; lines -= 1; bytes -= cost; progress = true;
    }
  }

  return cats.map((c) => {
    const total = c.lines.length;
    const omitted = total - c.taken;
    const heading = headingFor(c, omitted > 0 ? `${c.taken}/${total}개` : `${total}개`);
    const body = c.lines.slice(0, c.taken).join('\n');
    const marker = omitted > 0 ? `\n...(${omitted}개 생략 — 이 카테고리는 일부만 표시됨)` : '';
    return `${heading}${body ? `\n${body}` : ''}${marker}`;
  }).join('\n\n');
}

function extractLatestLogSection(logContent, maxLines = 15) {
  const match = /^## \d{4}-\d{2}-\d{2}.*$/m.exec(logContent);
  if (!match) return '(최근 변경 없음)';
  const rest = logContent.slice(match.index);
  const afterHeading = rest.slice(match[0].length);
  const nextHeadingOffset = afterHeading.search(/^## /m);
  const section = nextHeadingOffset === -1 ? rest : rest.slice(0, match[0].length + nextHeadingOffset);
  return capLines(section.trimEnd(), maxLines);
}

function buildContext({ okfHome, latestLog, injectMaxLines, injectMaxBytes }) {
  // 규칙 1의 Read는 조건부다. 라이브 벤치(docs/benchmarks/okf-live-2026-07-15T15-03-01-343Z)에서
  // 게이트를 켠 조건은 수동 재설명 대비 토큰 13,787을 더 썼는데, 그중 91%(12,508)가 강제 Read
  // 왕복이었고 그 Read들이 가져온 새 사실은 0개였다 — 답 8/8이 이미 아래 index 줄에 있었다.
  // index가 제목+설명을 싣는 이상 "반드시 Read"는 이미 건넨 것을 다시 사오라는 명령이다.
  // 관련 concept를 "찾는" 의무는 그대로 두고, 줄로 충분할 때의 왕복만 없앤다.
  const head = `=== OKF KNOWLEDGE GATE (필수) ===
전역 지식 번들: ${okfHome} (OKF v0.1)
규칙:
1. 과거 결정/프로젝트/선호/트러블슈팅 관련 작업 전, 아래 인덱스에서 관련 concept를 반드시 찾아라.
   제목·설명이 답을 담고 있으면 Read 없이 그 줄을 그대로 근거로 쓰라.
   줄만으로 불충분하거나(요약이 답을 자름) 결정의 근거·맥락·예외가 필요하면 그때 파일을 Read 하라.
2. concept ID = 번들 루트 기준 경로. 링크는 /decisions/... 절대경로 형식.
3. 번들은 배치가 관리한다. 세션 중 직접 수정 금지(사용자 명시 요청 시 예외).
--- index.md ---
`;
  const tail = `--- 최근 변경 (log.md) ---
${latestLog}
`;
  // 예산은 index를 만들기 전에 계산해 넘긴다. 전체를 뒤에서 자르면 번들이 커질수록 log.md
  // 섹션이 통째로 밀려나 조용히 사라지고("지난 세션 이후 번들이 움직였다"는 신호는 index만큼
  // 중요하다), 잘라내는 위치도 카테고리 경계를 무시해 한 카테고리가 나머지를 굶긴다.
  const idx = buildInjectedIndex(
    okfHome,
    Math.max(1, injectMaxLines - head.split('\n').length - tail.split('\n').length),
    Math.max(0, injectMaxBytes - Buffer.byteLength(head + tail, 'utf8'))
  ) || '(index.md 없음)';
  // implement.md §5-3: 줄 캡 + 바이트 캡(UTF-8 경계 절단) 이중 적용 — 여기서는 안전망이다.
  return truncateUtf8Bytes(capLines(`${head}${idx}\n${tail}`, injectMaxLines), injectMaxBytes);
}

function main() {
  if (process.env.OKF_BATCH === '1') {
    process.stdout.write('{}');
    return;
  }

  const okfHome = resolveOkfHome();
  ensureBootstrap(okfHome, (msg) => console.error(`[okf bootstrap] ${msg}`));

  let config;
  const configWarnings = [];
  try {
    config = readConfig(okfHome, (warning) => configWarnings.push(warning));
  } catch {
    config = DEFAULT_CONFIG;
  }
  for (const warning of configWarnings) {
    console.error(`[okf config] ${warning.key}: ${warning.code} — 기본값 사용`);
  }

  // "enabled: false"는 게이트 주입까지 포함한 전역 kill switch로 취급한다 — 캡처만 끄고
  // 게이트는 계속 주입되면 사용자가 끈 의도와 어긋난다. bootstrap은 그와 무관하게 항상
  // 실행한다(다시 켤 때 편집할 config.md 자체가 있어야 하므로).
  if (!config.enabled) {
    process.stdout.write('{}');
    return;
  }

  const paths = okfPaths(okfHome);
  let logContent = '';
  try {
    logContent = fs.readFileSync(paths.log, 'utf8');
  } catch {
    // no-op
  }
  const latestLog = extractLatestLogSection(logContent);

  const ctx = buildContext({
    okfHome,
    latestLog,
    injectMaxLines: config.inject_max_lines,
    injectMaxBytes: config.inject_max_bytes,
  });

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: ctx,
      },
      suppressOutput: true,
    })
  );

  try {
    maybeSpawnBatch(okfHome, config); // 캐치업: 직전 세션 크래시로 밀린 raw 처리
  } catch {
    // no-op — 배치 기동 실패가 세션 시작을 막으면 안 된다.
  }
}

try {
  main();
} catch (err) {
  console.error(`[okf session-start] fatal: ${err.message}`);
  process.stdout.write('{}'); // 절대 세션 시작을 막지 않는다 — 최소 출력이라도 내보낸다.
}
process.exit(0);
