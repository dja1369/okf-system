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
function buildInjectedIndex(okfHome) {
  const sections = [];
  for (const dir of discoverConceptDirs(okfHome)) {
    let entries = '';
    try {
      entries = fs.readFileSync(path.join(okfHome, dir, 'index.md'), 'utf8').trim();
    } catch {
      // 카테고리 index.md 부재(부트스트랩 직후 등) — 빈 카테고리로 취급한다.
    }
    const count = entries ? entries.split('\n').length : 0;
    const heading = `## ${dir} (${DIR_DESCRIPTIONS[dir] || dir}) — ${count}개`;
    sections.push(entries ? `${heading}\n${entries}` : heading);
  }
  return sections.join('\n\n');
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

function buildContext({ okfHome, idx, latestLog, injectMaxLines, injectMaxBytes }) {
  const head = `=== OKF KNOWLEDGE GATE (필수) ===
전역 지식 번들: ${okfHome} (OKF v0.1)
규칙:
1. 과거 결정/프로젝트/선호/트러블슈팅 관련 작업 전, 아래 인덱스에서 관련 concept를
   찾아 해당 파일을 반드시 Read 하라.
2. concept ID = 번들 루트 기준 경로. 링크는 /decisions/... 절대경로 형식.
3. 번들은 배치가 관리한다. 세션 중 직접 수정 금지(사용자 명시 요청 시 예외).
--- index.md ---
`;
  const tail = `--- 최근 변경 (log.md) ---
${latestLog}
`;
  // 캡은 index에 먼저 물린다. 이제 index가 번들 크기를 따라 자라므로, 전체를 뒤에서 자르면
  // 번들이 커질수록 log.md 섹션이 통째로 밀려나 조용히 사라진다 — "지난 세션 이후 번들이
  // 움직였다"는 신호는 index만큼 중요하고, 잘린다면 눈에 보이게 잘려야 한다.
  const cappedIdx = truncateUtf8Bytes(
    capLines(idx, Math.max(1, injectMaxLines - head.split('\n').length - tail.split('\n').length)),
    Math.max(0, injectMaxBytes - Buffer.byteLength(head + tail, 'utf8'))
  );
  // implement.md §5-3: 줄 캡 + 바이트 캡(UTF-8 경계 절단) 이중 적용 — 여기서는 안전망이다.
  return truncateUtf8Bytes(capLines(`${head}${cappedIdx}\n${tail}`, injectMaxLines), injectMaxBytes);
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
  // 부트스트랩 직후로 카테고리 디렉토리조차 없으면 빈 문자열 — 폴백 텍스트로 계속 진행한다.
  const idx = buildInjectedIndex(okfHome) || '(index.md 없음)';
  let logContent = '';
  try {
    logContent = fs.readFileSync(paths.log, 'utf8');
  } catch {
    // no-op
  }
  const latestLog = extractLatestLogSection(logContent);

  const ctx = buildContext({
    okfHome,
    idx,
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
