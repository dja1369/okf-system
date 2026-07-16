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
  // 수집(sweep) 기준: 마지막 활동 후 이 시간(분)이 지나야 "완결된 대화"로 보고 수집한다.
  // SessionEnd는 수집 기준이 될 수 없다 — 사용자·에이전트 대부분이 세션을 명시적으로 끝내지
  // 않고, resume발 SessionEnd는 대화 중간 스냅샷을 남겨 이후 대화를 잃게 했다(실측).
  // 0 = 즉시 수집(수동 flush·테스트용).
  sweep_min_idle_minutes: 60,
  remove_candidate_ttl_days: 30,
  inject_max_lines: 120,
  // Claude Code stores hook output above 10,000 characters out-of-band. A byte cap below
  // that ceiling guarantees the mandatory gate remains inline even for all-ASCII content.
  inject_max_bytes: 9000,
  claude_bin: '',
  node_bin: '',
};

const EFFORTS = new Set(['', 'low', 'medium', 'high', 'xhigh', 'max']);
const SEED_LANGUAGES = new Set(['en', 'ko']);
const SAFE_MODEL = /^(?:[A-Za-z0-9][A-Za-z0-9._:/-]{0,199})?$/;
const SAFE_COMMAND_PATH = /^[^"&|<>^%!\r\n]{0,4096}$/;

function finiteNumber(min, max, integer = false) {
  return (value) => typeof value === 'number'
    && Number.isFinite(value)
    && value >= min
    && value <= max
    && (!integer || Number.isInteger(value));
}

const VALIDATORS = {
  enabled: (v) => typeof v === 'boolean',
  batch_interval_hours: finiteNumber(0, 8760),
  batch_max_digest_kb: finiteNumber(1, 102400, true),
  batch_max_sessions: finiteNumber(1, 1000, true),
  batch_model: (v) => typeof v === 'string' && SAFE_MODEL.test(v),
  batch_effort: (v) => typeof v === 'string' && EFFORTS.has(v),
  seed_language: (v) => typeof v === 'string' && SEED_LANGUAGES.has(v),
  capture_exclude_cwd: (v) => Array.isArray(v)
    && v.length <= 100
    && v.every((p) => typeof p === 'string' && p.length > 0 && p.length <= 4096),
  batch_digest_cap_kb: finiteNumber(1, 10240, true),
  sweep_min_idle_minutes: finiteNumber(0, 10080),
  remove_candidate_ttl_days: finiteNumber(1, 3650, true),
  inject_max_lines: finiteNumber(20, 1000, true),
  inject_max_bytes: finiteNumber(1024, 9000, true),
  claude_bin: (v) => typeof v === 'string' && SAFE_COMMAND_PATH.test(v),
  node_bin: (v) => typeof v === 'string' && SAFE_COMMAND_PATH.test(v),
};

function normalizeConfig(overrides, onWarning) {
  const config = { ...DEFAULT_CONFIG };
  for (const [key, value] of Object.entries(overrides)) {
    const validate = VALIDATORS[key];
    if (!validate) {
      onWarning({ key, code: 'unknown_key' });
      continue;
    }
    if (!validate(value)) {
      onWarning({ key, code: 'invalid_value' });
      continue;
    }
    config[key] = value;
  }
  return config;
}

export function readConfig(okfHome, onWarning = () => {}) {
  const paths = okfPaths(okfHome);
  let overrides = {};
  try {
    const raw = fs.readFileSync(paths.config, 'utf8');
    const { data, parseError } = parseFrontmatter(raw);
    if (parseError) {
      onWarning({ key: 'config', code: 'parse_error' });
    } else if (data && typeof data === 'object' && !Array.isArray(data)) {
      overrides = data;
    } else if (data != null) {
      onWarning({ key: 'config', code: 'invalid_document' });
    }
  } catch {
    // config.md missing/unreadable before bootstrap has run yet -> defaults only.
  }
  return normalizeConfig(overrides, onWarning);
}
