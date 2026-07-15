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

// Resolve the plugin repo root from this module's own location (lib/ -> ..),
// independent of CLAUDE_PLUGIN_ROOT so lib code also works under plain `node` for manual testing.
export function pluginRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..');
}
