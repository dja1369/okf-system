import fs from 'node:fs';
import { resolveOkfHome, okfPaths } from '../lib/paths.mjs';
import { readConfig, DEFAULT_CONFIG } from '../lib/config.mjs';
import { ensureBootstrap } from '../lib/bootstrap.mjs';
import { maybeSpawnBatch } from '../lib/batch-gate.mjs';
import { buildContext, extractLatestLogSection } from '../lib/gate.mjs';
import { safeErrorCode } from '../lib/status.mjs';

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
  // err.message 금지 — js-yaml 파싱 오류는 위반한 YAML **원문**을 그대로 담고, 그 원문은
  // 전사에서 파생된 concept 본문이다. 진단에 필요한 것은 코드뿐이다(bin/batch.mjs와 동일 계약).
  console.error(`[okf session-start] fatal: code=${safeErrorCode(err)}`);
  process.stdout.write('{}'); // 절대 세션 시작을 막지 않는다 — 최소 출력이라도 내보낸다.
}
// process.exit()를 쓰면 안 된다. 훅의 stdout은 항상 pipe이고, pipe write는 비동기다 — 게이트가
// pipe 버퍼보다 크면 일부만 나간 채 프로세스가 죽어서 Claude Code는 잘린 JSON을 받는다. 그러면
// 게이트가 통째로 유실되는데, 조용히 유실된다. CI(macOS)가 실제로 4,554바이트에서 잘린 출력을
// 잡았다: `SyntaxError: Unterminated string in JSON`. concept가 쌓여 index가 커질수록 확률이
// 오르므로, 정확히 게이트가 가장 필요한 사용자에게 먼저 터진다.
// exitCode만 정하고 자연 종료를 기다린다 — 배치 자식은 detached+unref이라 부모를 붙잡지 않는다.
process.exitCode = 0;
