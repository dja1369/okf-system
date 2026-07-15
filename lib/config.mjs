import fs from 'node:fs';
import { okfPaths } from './paths.mjs';
import { parseFrontmatter } from './frontmatter.mjs';

// implement.md §4 설정 스키마.
export const DEFAULT_CONFIG = {
  enabled: true,
  batch_interval_hours: 1,
  batch_max_sessions: 10,
  batch_model: 'claude-sonnet-5',
  batch_effort: 'medium',
  capture_exclude_cwd: [],
  batch_digest_cap_kb: 150,
  remove_candidate_ttl_days: 30,
  inject_max_lines: 120,
  inject_max_bytes: 16384,
  claude_bin: '',
  node_bin: '',
};

export function readConfig(okfHome) {
  const paths = okfPaths(okfHome);
  let overrides = {};
  try {
    const raw = fs.readFileSync(paths.config, 'utf8');
    const { data, parseError } = parseFrontmatter(raw);
    if (!parseError && data && typeof data === 'object') overrides = data;
  } catch {
    // config.md missing/unreadable before bootstrap has run yet -> defaults only.
  }
  return { ...DEFAULT_CONFIG, ...overrides };
}
