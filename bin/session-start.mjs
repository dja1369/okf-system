import fs from 'node:fs';
import { resolveOkfHome, okfPaths } from '../lib/paths.mjs';
import { readConfig, DEFAULT_CONFIG } from '../lib/config.mjs';
import { ensureBootstrap } from '../lib/bootstrap.mjs';
import { maybeSpawnBatch } from '../lib/batch-gate.mjs';
import { truncateUtf8Bytes, capLines } from '../lib/text.mjs';

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
  const raw = `=== OKF KNOWLEDGE GATE (필수) ===
전역 지식 번들: ${okfHome} (OKF v0.1)
규칙:
1. 과거 결정/프로젝트/선호/트러블슈팅 관련 작업 전, 아래 인덱스에서 관련 concept를
   찾아 해당 파일을 반드시 Read 하라.
2. concept ID = 번들 루트 기준 경로. 링크는 /decisions/... 절대경로 형식.
3. 번들은 배치가 관리한다. 세션 중 직접 수정 금지(사용자 명시 요청 시 예외).
--- index.md ---
${idx}
--- 최근 변경 (log.md) ---
${latestLog}
`;
  // implement.md §5-3: 줄 캡 + 바이트 캡(UTF-8 경계 절단) 이중 적용.
  return truncateUtf8Bytes(capLines(raw, injectMaxLines), injectMaxBytes);
}

function main() {
  if (process.env.OKF_BATCH === '1') {
    process.stdout.write('{}');
    return;
  }

  const okfHome = resolveOkfHome();
  ensureBootstrap(okfHome, (msg) => console.error(`[okf bootstrap] ${msg}`));

  let config;
  try {
    config = readConfig(okfHome);
  } catch {
    config = DEFAULT_CONFIG;
  }

  // "enabled: false"는 게이트 주입까지 포함한 전역 kill switch로 취급한다 — 캡처만 끄고
  // 게이트는 계속 주입되면 사용자가 끈 의도와 어긋난다. bootstrap은 그와 무관하게 항상
  // 실행한다(다시 켤 때 편집할 config.md 자체가 있어야 하므로).
  if (!config.enabled) {
    process.stdout.write('{}');
    return;
  }

  const paths = okfPaths(okfHome);
  let idx = '(index.md 없음)';
  try {
    idx = fs.readFileSync(paths.rootIndex, 'utf8');
  } catch {
    // 부트스트랩 직후라 아직 없을 수 있음 — 폴백 텍스트로 계속 진행.
  }
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
