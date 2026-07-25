import fs from 'node:fs';
import path from 'node:path';
import { resolveOkfHome, SCAN_EXCLUDE_DIRS } from './paths.mjs';
import { parseFrontmatter } from './frontmatter.mjs';
import { isPlainObject, generatedAt, toIsoDateTime } from './trust.mjs';

// ---------- lint 규칙 코드 레지스트리 ----------
// 코드가 겹치면 summarizeLintForLog(bin/batch.mjs)의 집계와 buildRepairPrompt의 필터가
// 동시에 거짓이 된다. 새 규칙을 추가하기 전에 여기에 먼저 등록하라.
//  E1  frontmatter 부재/파손      E2  필수 필드 누락
//  E3a index 구조 위반            E3b 루트 log.md 헤딩 위반
//  W1  깨진 내부 링크             W2  권장 필드 누락(title/description/시간 신호)
//  W3  택소노미 밖 type           W4  루트 index 여분 키 / log.md 중복 날짜
//  W5  무따옴표 ' #' 값 절단      W6  description > 500자   ← repair 프롬프트에서 필터한다
//  W7  미지 status 값             W8  중첩 log.md 헤딩 위반
//  W9/W10 예약(Part 2: 본문 바이트 / 반복 헤딩)
//  W11 달력에 없는 날짜 값(파싱 전 원문 기준)
//  W12 title/description에 개행·제어문자(게이트 줄 주입 벡터)
// 신규 규칙은 전부 W다. E로 올리면 handleDirtyWorkingTree(bin/batch.mjs)가 기존 사용자
// 번들의 모든 ingest를 영구 정지시킨다.
// 코드는 /^[A-Z][0-9]{1,2}$/를 만족해야 로그에 `W7=1` 형태로 남는다 — `W5a` 같은 접미를
// 붙이면 UNKNOWN으로 뭉개진다.

// implement.md §5-6: type -> taxonomy directory. Explicit map instead of a
// pluralization rule because 'troubleshooting' doesn't pluralize like the rest.
//
// Map인 이유: type은 신뢰할 수 없는 데이터다. 객체 리터럴이면 프로토타입 체인을 타서
// `type: constructor`가 W3 메시지에 `function Object() { [native code] }`를, `__proto__`가
// `[object Object]`를 싣는다(실측). lib/viz.mjs가 같은 클래스를 이미 방어한다.
// 이 상수는 이 파일 안에서만 쓰이고 export되지 않는다 — 외부 파급 0.
const TYPE_TO_DIR = new Map([
  ['project', 'projects'],
  ['decision', 'decisions'],
  ['preference', 'preferences'],
  ['pattern', 'patterns'],
  ['reference', 'references'],
  ['troubleshooting', 'troubleshooting'],
]);

// §5.4: 부재가 곧 stable. §11: 미지 값을 이유로 문서를 거부하지 않는다.
const STATUS_VALUES = new Set(['draft', 'stable', 'deprecated']);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// 따옴표 없는 YAML 플레인 스칼라에서 ` #`은 주석 시작이다 — js-yaml이 거기서 값을 자르고,
// 잘린 값이 그대로 index.md와 매 세션 게이트로 나간다(라이브 2개 파일 3건 실측:
// 324->120자, 214->40자, 56->20자. 디스크 원문은 멀쩡하고 파싱값만 짧다).
// 값 앞이 " ' | > & * [ { 이면 인용/블록/플로우라 이 사고가 나지 않으므로 대상에서 뺀다.
const PLAIN_SCALAR_RE = /^[ \t]*"?'?([A-Za-z_][A-Za-z0-9_-]*)'?"?[ \t]*:[ \t]+(?!["'|>&*[{])(\S.*?)[ \t]*$/;
// 게이트 실측에서 유도: concept 예산 6,736B에 대해 977자 description 1건이 index 줄
// 1,546B로 예산의 23%를 혼자 점유했다. 라이브 22개 중 21개(95.5%)가 이미 500자 이하라
// 성문화이자 이상치 1건만 잡는다.
const DESCRIPTION_MAX_CHARS = 500;
// 날짜처럼 보이는 프론트매터 값(따옴표 유무 무관). 여기서만 원문을 볼 수 있다.
const DATE_VALUE_RE = /^[ \t]*"?'?([A-Za-z_][A-Za-z0-9_-]*)'?"?[ \t]*:[ \t]+["']?(\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?)["']?[ \t]*$/;
const LOG_HEADING_RE = /^##[ \t]+(.*)$/gm;
const LINK_RE = /\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

// implement.md §5-6 탐색 범위: SCAN_EXCLUDE_DIRS는 루트 자식일 때만 제외 —
// 이름이 우연히 같은 중첩 디렉토리(예: projects/raw/)는 정상 스캔 대상이다.
export function walkMdFiles(root) {
  const out = [];
  function walk(dir, isRoot) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (isRoot && entry.isDirectory() && SCAN_EXCLUDE_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, false);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        out.push(path.relative(root, abs).split(path.sep).join('/'));
      }
    }
  }
  walk(root, true);
  return out;
}

function linkTargetExists(okfHome, link) {
  try {
    return fs.statSync(path.join(okfHome, link)).isFile();
  } catch {
    return false;
  }
}

function checkLinks(text, relPath, okfHome, warnings) {
  LINK_RE.lastIndex = 0;
  let m;
  while ((m = LINK_RE.exec(text))) {
    let link = m[1];
    if (!link.startsWith('/')) continue;
    link = link.split('#')[0];
    if (!link || linkTargetExists(okfHome, link)) continue;
    warnings.push({ file: relPath, rule: 'W1', message: `broken link: ${link}` });
  }
}

function checkLogHeadings(content, relPath, isRootLog, errors, warnings) {
  // 심각도 분기: 이 검사는 이번 릴리스에서 중첩 log.md에 **처음** 켜진다. 기존 번들의 중첩
  // log.md가 즉시 E3b가 되면 (1) 트리가 dirty할 때 handleDirtyWorkingTree가 배치 자체를
  // 영구히 시작 못 하게 하고, (2) 청크마다 유료 repair 1회를 태우고, 못 고치면 rollbackChunk로
  // 남은 청크를 전부 버린다. 루트 log.md는 지금도 E3b이므로 그대로 두고(회귀 없음), 비루트만
  // W8로 착지시킨다. W8은 formatReport를 타고 repair 프롬프트에 실리므로 다른 에러로 repair가
  // 돌 때 기회적으로 자동 교정된다 — 조용히 묻히지 않는다.
  //
  // E3b 승격 조건(다음 릴리스 이후 검토): (1) 한 릴리스 주기 동안 W8 실측 발생이 0일 것,
  // (2) 승격 릴리스 노트에 명시적 경고.
  const sink = isRootLog ? errors : warnings;
  const rule = isRootLog ? 'E3b' : 'W8';
  // W8 메시지에 규정 출처를 실어 repair가 근거 없이 움직이지 않게 한다.
  const cite = isRootLog ? '' : ' (SCHEMA.md 규칙 3: 어느 디렉토리의 log.md든 "## YYYY-MM-DD")';
  LOG_HEADING_RE.lastIndex = 0;
  const dates = [];
  let m;
  while ((m = LOG_HEADING_RE.exec(content))) {
    const text = m[1].trim();
    if (!ISO_DATE_RE.test(text)) {
      sink.push({ file: relPath, rule, message: `non-ISO log heading: "${text}"${cite}` });
    } else {
      dates.push(text);
    }
  }
  for (let i = 1; i < dates.length; i++) {
    if (dates[i] > dates[i - 1]) {
      sink.push({
        file: relPath,
        rule,
        message: `log dates not descending: "${dates[i - 1]}" followed by "${dates[i]}"${cite}`,
      });
      break; // one violation is enough to fail the file; avoid flooding the report
    }
  }
  const seen = new Set();
  const dup = new Set();
  for (const d of dates) {
    if (seen.has(d)) dup.add(d);
    seen.add(d);
  }
  for (const d of dup) {
    warnings.push({ file: relPath, rule: 'W4', message: `duplicate log date heading: "${d}"` });
  }
}

function checkRootIndexFrontmatter(hasFrontmatter, data, parseError, relPath, errors, warnings) {
  if (!hasFrontmatter) return;
  if (parseError) {
    errors.push({ file: relPath, rule: 'E3a', message: `root index.md frontmatter parse error: ${parseError.message}` });
    return;
  }
  const keys = Object.keys(data || {});
  if (keys.includes('okf_version') && !isNonEmptyString(String(data.okf_version ?? ''))) {
    errors.push({ file: relPath, rule: 'E3a', message: 'okf_version key present but empty' });
  }
  const extra = keys.filter((k) => k !== 'okf_version');
  if (extra.length > 0) {
    warnings.push({ file: relPath, rule: 'W4', message: `root index.md frontmatter has extra keys: ${extra.join(', ')}` });
  }
}

// checkNonReserved와 분리한 이유: 그쪽은 E1/E2에서 return하므로 type이 빠진 파일은 이 검사를
// 아예 못 받는다. 값 파손은 type 유무와 무관하게 일어난다.
// 메시지에 **값 원문을 싣지 않는다** — 키 이름과 길이 숫자까지가 상한이다(formatReport가
// 이 문자열을 repair 프롬프트로 흘린다).
function checkFrontmatterFidelity(raw, data, relPath, warnings) {
  if (raw === null || !data || typeof data !== 'object' || Array.isArray(data)) return;
  for (const line of raw.split(/\r?\n/)) {
    const m = PLAIN_SCALAR_RE.exec(line);
    if (!m) continue;
    const [, key, rawValue] = m;
    const parsed = data[key];
    if (typeof parsed !== 'string') continue; // Date·숫자·불리언은 이 사고의 대상이 아니다
    if (rawValue.length > parsed.trimEnd().length && / #/.test(rawValue)) {
      warnings.push({
        file: relPath,
        rule: 'W5',
        message: `${key} was cut at an unquoted " #" (${rawValue.length} chars on disk, ${parsed.trimEnd().length} parsed) — wrap the value in double quotes`,
      });
    }
  }
  // **파싱 후에는 복원할 수 없다.** 벤더드 js-yaml은 무따옴표 `at: 2026-02-30`을 파서 단계에서
  // 이미 Date(2026-03-02)로 보정하므로, 그 값을 받는 어떤 소비자도 원래 날짜가 틀렸다는 사실을
  // 알 수 없다(독립 검증이 짚은 우회). 원문을 볼 수 있는 자리는 여기뿐이라 여기서 잡는다.
  // 경고 등급이다 — 기존 번들에 이런 값이 있어도 배치가 멈추면 안 된다.
  for (const line of raw.split(/\r?\n/)) {
    const m = DATE_VALUE_RE.exec(line);
    if (!m) continue;
    const [, key, value] = m;
    if (toIsoDateTime(value) === null) {
      warnings.push({
        file: relPath,
        rule: 'W11',
        message: `${key} is not a real calendar date/time ("${value}"); YAML silently shifts it`,
      });
    }
  }

  // 게이트 줄 주입 벡터. index-gen이 접어서 실어 나르므로 주입 자체는 막히지만, 값에 개행이
  // 들어 있다는 것은 오염된 digest가 한 번 통과했다는 신호다 — 드러내야 사용자가 그 concept를
  // 확인한다. 경고 등급이다(기존 번들이 이걸 갖고 있어도 배치가 멈추면 안 된다).
  for (const field of ['title', 'description']) {
    const v = data[field];
    // eslint-disable-next-line no-control-regex
    if (typeof v === 'string' && /[\u0000-\u001f\u007f\u0085\u2028\u2029]/.test(v)) {
      warnings.push({
        file: relPath,
        rule: 'W12',
        message: `${field} contains a newline or control character; the index folds it to one line`,
      });
    }
  }

  const description = typeof data.description === 'string' ? data.description : null;
  if (description && description.length > DESCRIPTION_MAX_CHARS) {
    // 서술만 한다. `— split the concept instead` 같은 지시를 붙이지 마라 — formatReport가
    // 이 문자열을 repair 프롬프트로 흘리는데 repair는 새 파일을 만들 수 없다.
    warnings.push({
      file: relPath,
      rule: 'W6',
      message: `description is ${description.length} chars (max ${DESCRIPTION_MAX_CHARS})`,
    });
  }
}

function checkNonReserved(relPath, hasFrontmatter, data, parseError, errors, warnings, isSchemaTemplate = false) {
  if (!hasFrontmatter) {
    errors.push({ file: relPath, rule: 'E1', message: 'missing frontmatter' });
    return;
  }
  if (parseError) {
    errors.push({ file: relPath, rule: 'E1', message: `frontmatter parse error: ${parseError.message}` });
    return;
  }
  const type = data && data.type;
  if (type == null || (typeof type === 'string' && type.trim() === '')) {
    errors.push({ file: relPath, rule: 'E2', message: 'type field missing or empty' });
    return;
  }

  const missing = ['title', 'description'].filter((f) => !isNonEmptyString(String(data[f] ?? '')));
  // OKF v0.2 §13.1: 시각 신호의 정본은 generated.at이고 레거시 timestamp는 소비자 폴백이 MAY다.
  // 둘 중 하나만 있으면 통과 — 둘 다 없을 때만 경고한다. timestamp를 계속 강제하면 그 경고가
  // formatReport -> {{LINT_REPORT}} -> prompts/repair.md를 타고 "timestamp를 되살려라"는
  // 지시로 되돌아온다(B3: 폐기된 필드를 매 회차 재생산하는 진동).
  //
  // hasLegacyTimestamp를 toIsoDate로 엄격화하지 마라 — 라이브의 timestamp는 규정이 느슨했던
  // 구 스펙 시절 값이라 형식 강화가 곧 새 경고 폭증이고, §13.1은 레거시를 "지우지도 갱신하지도 말고
  // 그대로 둔다"이다.
  const hasLegacyTimestamp = isPlainObject(data) && isNonEmptyString(String(data.timestamp ?? ''));
  if (!isSchemaTemplate && !generatedAt(data) && !hasLegacyTimestamp) {
    missing.push('generated.at (or legacy timestamp)');
  }
  if (missing.length > 0) {
    warnings.push({ file: relPath, rule: 'W2', message: `missing recommended field(s): ${missing.join(', ')}` });
  }

  // 미지 값으로 문서를 거부하지 않는다(SPEC §11 MUST NOT) — 경고만 내고 stable로 본다.
  // **반드시 warnings다.** errors로 올리면 bin/batch.mjs의 lint 게이트가 참이 되어 유료 repair
  // 1회가 발동하고, 남으면 rollbackChunk(git 원복 + 그 청크 폐기)로 간다 — 미지 값 하나에
  // 청크를 버리는 셈이다.
  if (data.status !== undefined && data.status !== null) {
    const statusStr = typeof data.status === 'string' ? data.status.trim() : String(data.status);
    if (!STATUS_VALUES.has(statusStr.toLowerCase())) {
      warnings.push({
        file: relPath,
        rule: 'W7',
        message: `unknown status "${statusStr}" (expected draft|stable|deprecated); treated as stable`,
      });
    }
  }

  const typeStr = String(type);
  const expectedDir = TYPE_TO_DIR.get(typeStr);
  const dirName = relPath.includes('/') ? relPath.split('/')[0] : '';
  if (!expectedDir) {
    warnings.push({ file: relPath, rule: 'W3', message: `type "${typeStr}" is outside the known taxonomy` });
  } else if (dirName !== expectedDir) {
    warnings.push({ file: relPath, rule: 'W3', message: `type "${typeStr}" expects /${expectedDir}/ but file is in /${dirName || '.'}/` });
  }
}

export function runLint(okfHome) {
  const errors = [];
  const warnings = [];

  for (const relPath of walkMdFiles(okfHome)) {
    const abs = path.join(okfHome, relPath);
    let content;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch (err) {
      errors.push({ file: relPath, rule: 'E1', message: `unable to read file: ${err.message}` });
      continue;
    }

    const basename = path.basename(relPath);
    const isIndex = basename === 'index.md';
    // A3: 예전엔 `relPath === 'log.md'`라 중첩 log.md가 §9 검사를 **통째로** 받지 않았다
    // (실측: references/log.md의 `## July 5 2026` + 오름차순 위반이 lint 출력 0줄로 통과).
    const isLog = basename === 'log.md';
    const isRootLog = relPath === 'log.md';
    const reserved = isIndex || isLog;

    const { hasFrontmatter, data, body, parseError, raw } = parseFrontmatter(content);

    if (!reserved) {
      // 판정은 반드시 **경로**여야 한다 — `data.type === 'schema'`로 하면 concept가
      // type을 자칭해 경고를 회피할 수 있고, 경로 판정은 bin/batch.mjs의 SCHEMA 보호 조건과
      // 정확히 같은 술어라 두 곳이 함께 움직인다. 면제 범위를 넓히지 마라: E1/E2와 W3는 그대로다.
      checkNonReserved(relPath, hasFrontmatter, data, parseError, errors, warnings, relPath === 'SCHEMA.md');
      checkFrontmatterFidelity(raw, data, relPath, warnings);
    }

    if (isIndex) {
      if (relPath === 'index.md') {
        checkRootIndexFrontmatter(hasFrontmatter, data, parseError, relPath, errors, warnings);
      } else if (hasFrontmatter) {
        errors.push({ file: relPath, rule: 'E3a', message: 'non-root index.md must not have frontmatter' });
      }
    }

    if (isLog) {
      checkLogHeadings(content, relPath, isRootLog, errors, warnings);
    }

    checkLinks(hasFrontmatter ? body : content, relPath, okfHome, warnings);
  }

  return { errors, warnings };
}

export function formatReport(report) {
  const lines = [
    ...report.errors.map((e) => `${e.file}: ${e.rule}: ${e.message}`),
    ...report.warnings.map((w) => `${w.file}: ${w.rule}: ${w.message}`),
  ];
  return lines.length > 0 ? lines.join('\n') : 'OK: 0 errors, 0 warnings';
}

function main() {
  const okfHome = process.argv[2] || resolveOkfHome();
  const report = runLint(okfHome);
  console.log(formatReport(report));
  if (report.errors.length > 0) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
