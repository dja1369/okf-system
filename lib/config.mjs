import fs from 'node:fs';
import { okfPaths } from './paths.mjs';
import { parseFrontmatter } from './frontmatter.mjs';

// implement.md §4 설정 스키마.
export const DEFAULT_CONFIG = {
  enabled: true,
  batch_interval_hours: 1,
  // 실행당 비용 상한은 "세션 수"가 아니라 "digest 총 바이트"로 잡는다 — 세션 크기가 수십 배씩
  // 차이나기 때문에 개수 상한은 비용을 대변하지 못했고, 작은 세션 10개로 회차를 낭비하면서
  // backlog가 영구히 쌓이는 문제가 있었다. 바이트는 토큰(=비용)에 훨씬 가까운 대리 지표다.
  batch_max_digest_kb: 600,
  batch_max_sessions: 50, // 안전 천장(폭주 방지)일 뿐, 실제 조절 손잡이는 위 예산이다
  batch_model: 'claude-sonnet-5',
  batch_effort: 'medium',
  // 시드 concept 언어. 번들에 들어가는 실제 지식이라 기본은 영어(가장 넓게 읽힌다).
  // 현재 제공: en, ko. 없는 값이면 en으로 폴백한다.
  seed_language: 'en',
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
