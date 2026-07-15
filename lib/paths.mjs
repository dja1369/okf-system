import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// implement.md §4(B): OKF_HOME = env override, else <CLAUDE_CONFIG_DIR or ~/.claude>/okf.
// Works identically on macOS/Linux (~/.claude/okf) and Windows (C:\Users\<u>\.claude\okf)
// because it's built entirely from os.homedir() + path.join(), never a hardcoded separator.
// 리뷰 지적(사후 반영): sweep(bin/batch.mjs)이 세션 원본을 찾는 `.claude/projects/`도
// 이 루트 밑에 있으므로, OKF_HOME뿐 아니라 sweep도 이 함수를 공유해야 CLAUDE_CONFIG_DIR을
// 설정한 사용자에게서 둘이 서로 다른 위치를 보는 불일치가 생기지 않는다.
export function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

export function resolveOkfHome() {
  if (process.env.OKF_HOME) return process.env.OKF_HOME;
  return path.join(claudeConfigDir(), 'okf');
}

export function okfPaths(okfHome = resolveOkfHome()) {
  const state = path.join(okfHome, '.okf');
  return {
    home: okfHome,
    git: path.join(okfHome, '.git'),
    gitignore: path.join(okfHome, '.gitignore'),
    rootIndex: path.join(okfHome, 'index.md'),
    log: path.join(okfHome, 'log.md'),
    schema: path.join(okfHome, 'SCHEMA.md'),
    raw: path.join(okfHome, 'raw'),
    removeCandidate: path.join(okfHome, '_remove_candidate'),
    state,
    config: path.join(state, 'config.md'),
    captureStatus: path.join(state, 'capture-status.json'),
    batchSessions: path.join(state, 'batch-sessions.json'),
    lastBatch: path.join(state, 'last-batch.json'),
    lock: path.join(state, 'batch.lock'),
    staging: path.join(state, 'staging'),
    logs: path.join(state, 'logs'),
  };
}

// implement.md §6 안건4: 6종 택소노미, 디렉토리=type 1:1.
export const TAXONOMY_DIRS = ['projects', 'decisions', 'preferences', 'patterns', 'references', 'troubleshooting'];

// implement.md §5-6/§5-7: 운영 상태 디렉토리는 conformance 스캔(lint/index-gen) 대상이 아니다.
export const SCAN_EXCLUDE_DIRS = new Set(['.git', '.okf', 'raw', '_remove_candidate']);

// OKF 자신의 테스트·벤치가 임시 디렉토리에서 만든 세션. 사용자 지식이 아니므로 sweep이 주워서는
// 안 된다. 실측: 과거에 격리 없이 돈 스모크가 실제 ~/.claude/projects에 241개 디렉토리(295개
// transcript)를 남겼고, sweep에는 이를 걸러낼 조건이 없어 그대로 유료 배치에 실려 번들을 오염시켰다.
// 두 조건을 AND로 건다 — 임시 경로에서 돌았고(사용자의 진짜 작업은 여기 살지 않는다), 이름이
// OKF 테스트 픽스처다. 그래야 ~/.claude/okf(번들 자체)나 side_project/okf-system(진짜 작업)이
// 걸리지 않는다. projects/ 디렉토리명은 cwd의 '/'를 '-'로 바꾼 형태다.
const TEMP_CWD = /(?:^|-)(?:private-)?tmp-|var-folders-.+?-T-/;
const OKF_TEST_FIXTURE = /okf-(?:smoke|gate-exp|index-test|security-test|e2e|verify\d*|live-bench|bench)/;
export function isOkfTestSessionDir(projectDirName) {
  return TEMP_CWD.test(projectDirName) && OKF_TEST_FIXTURE.test(projectDirName);
}

// Resolve the plugin repo root from this module's own location (lib/ -> ..),
// independent of CLAUDE_PLUGIN_ROOT so lib code also works under plain `node` for manual testing.
export function pluginRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..');
}
