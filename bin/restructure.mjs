#!/usr/bin/env node
// concept 파일을 번들 안에서 **옮기고 링크를 따라 고친다.**
//
// 왜 별도 도구인가: 파일 경로가 곧 concept ID다(SCHEMA 규칙 4). 옮기면 이 번들 안의 모든
// 상호참조가 깨지고, 그건 게이트가 제시하는 링크가 죽는다는 뜻이다 — 되돌리기 어려운 손상이라
// `mv` 한 줄로 할 일이 아니다. 이 파일이 하는 것은 **기계적 부분 전부**다:
// 락 획득 · 경계 검증 · rename · 전 파일 링크 재작성 · index 재생성 · lint · 단일 커밋.
//
// **어디로 옮길지는 이 파일이 정하지 않는다.** 그건 "무엇이 비슷한가"라는 판단이고 코드가 하면
// 추측이 된다(Rule 5). 호출자가 매핑을 준다. 매핑은 사람이나 모델이 쓰므로 **적대적 입력으로
// 취급한다** — 검증은 전부 아래 canonicalize를 통과한 값에 대해서만 한다.
//
// 사용법:
//   node bin/restructure.mjs <mapping.json> [--dry-run]
//   mapping.json = { "옛 상대경로.md": "새 상대경로.md", ... }
//
// 종료 코드: 0 성공 · 1 내부 오류 · 2 락 · 3 대상 없음(무변경) · 4 매핑 부적합 · 5 검증 실패로 원복
import fs from 'node:fs';
import path from 'node:path';
import { resolveOkfHome, okfPaths, SCAN_EXCLUDE_DIRS, UNSAFE_NAME_RE, NON_CONCEPT_BASENAMES } from '../lib/paths.mjs';
import { acquireLock, releaseLock } from '../lib/lock.mjs';
import { isDirty, commitAll, rollback } from '../lib/git.mjs';
import { backupDirtyTree } from '../lib/backup.mjs';
import { regenerateIndex, DIR_DESCRIPTIONS } from '../lib/index-gen.mjs';
import { runLint, formatReport } from '../lib/lint.mjs';
import { safeErrorCode } from '../lib/status.mjs';

// 택소노미 디렉토리 6종. 이 목록 **밖의 첫 조각은 거부한다** — 안 그러면 `.okf/`·`raw/` 같은
// gitignore된 디렉토리로 concept를 옮길 수 있고, 그건 rollback(`clean -fd`, `-x` 없음)이
// 절대 되돌리지 못하는 유일한 종류의 손상이다.
const TAXONOMY_DIRS = new Set(Object.keys(DIR_DESCRIPTIONS));

function fail(code, message) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 링크 재작성은 **한 번의 패스**로 끝낸다. 매핑을 하나씩 순차 치환하면 뒤 항목의 패턴이 앞
// 항목이 방금 써넣은 텍스트에 다시 걸려(연쇄 재작성) 경로가 겹쳐 망가진다.
// 경계 단언은 정확한 경로 토큰만 잡기 위한 것이다 — `docs/patterns/x.md` 같은 **남의 저장소
// 경로**가 같은 꼬리를 가졌다고 함께 바뀌면 안 된다.
function rewriteLinks(text, moves) {
  if (moves.length === 0) return text;
  const byFrom = new Map(moves);
  const alternation = [...byFrom.keys()]
    .sort((a, b) => b.length - a.length) // 긴 것 먼저 — 짧은 경로가 긴 경로를 가로채지 않게
    .map(escapeRegExp)
    .join('|');
  const re = new RegExp(`(?<![\\w/.-])(?:${alternation})(?![\\w.-])`, 'g');
  return text.replace(re, (matched) => byFrom.get(matched) ?? matched);
}

// 번들 규범은 루트 기준 절대경로 링크(`/dir/file.md`)다. 상대 링크는 파일이 옮겨지면 가리키는
// 대상이 조용히 바뀌고, lint W1도 `/`로 시작하지 않는 링크는 아예 검사하지 않는다(lib/lint.mjs).
// 재작성으로 고칠 수 없으니 **옮기기를 거부한다**(Rule 12: 조용히 깨뜨리느니 시끄럽게 멈춘다).
const RELATIVE_MD_LINK_RE = /\]\((?!\/)(?![a-z][a-z0-9+.-]*:)([^)\s]*\.md(?:#[^)]*)?)\)/gi;

function findRelativeLinks(text) {
  return [...text.matchAll(RELATIVE_MD_LINK_RE)].map((m) => m[1]);
}

function allBundleMd(okfHome) {
  const out = [];
  const walk = (dir, isRoot) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (isRoot && (SCAN_EXCLUDE_DIRS.has(e.name) || e.name === '.git')) continue;
      if (e.name === '.git') continue;
      const abs = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(abs, false);
      else if (e.isFile() && e.name.endsWith('.md')) out.push(abs);
    }
  };
  walk(okfHome, true);
  return out;
}

// 존재하는 가장 깊은 조상까지 realpath로 편다. 심볼릭 링크된 디렉토리를 거쳐 번들 밖으로
// 나가는 경로를 문자열 비교(`startsWith`)만으로는 못 막는다.
// 아직 없는 하위 디렉토리(새로 만들 도메인)는 realpath가 던지므로 위로 올라가며 찾는다. 이때
// **건너뛴 조각을 전부 다시 붙여야 한다** — basename만 붙이면 목적지에서 중간 디렉토리가 통째로
// 사라진다.
function realBase(absPath) {
  const tail = [];
  let dir = absPath;
  for (;;) {
    const parent = path.dirname(dir);
    tail.unshift(path.basename(dir));
    if (parent === dir) return absPath;
    try {
      return path.join(fs.realpathSync(parent), ...tail);
    } catch {
      dir = parent;
    }
  }
}

// 매핑 한 건을 **파일시스템이 실제로 보게 될 경로**로 환원한다. 검증은 전부 이 결과에 대해서만
// 한다 — 문자열을 검사하고 다른 값으로 rename하면 `./`·`..`·심볼릭 링크가 전부 그 틈으로 샌다.
function canonicalize(okfHome, rawPath) {
  const abs = realBase(path.resolve(okfHome, String(rawPath).replace(/^\/+/, '')));
  if (abs !== okfHome && !abs.startsWith(okfHome + path.sep)) return null;
  return { abs, rel: path.relative(okfHome, abs) };
}

function validate(okfHome, mapping) {
  const moves = [];
  const destSeen = new Set();
  const sourceSeen = new Set();
  for (const [rawFrom, rawTo] of Object.entries(mapping)) {
    const from = canonicalize(okfHome, rawFrom);
    const to = canonicalize(okfHome, rawTo);
    if (!from || !to) return { error: `번들 밖으로 나가는 경로: ${rawFrom} → ${rawTo}` };
    const segs = { from: from.rel.split(path.sep), to: to.rel.split(path.sep) };
    if (!from.rel.endsWith('.md') || !to.rel.endsWith('.md')) return { error: `.md만 옮길 수 있다: ${from.rel}` };
    if (NON_CONCEPT_BASENAMES.has(path.basename(from.abs)) || NON_CONCEPT_BASENAMES.has(path.basename(to.abs))) {
      return { error: `예약 파일은 대상이 아니다: ${from.rel}` };
    }
    if (segs.to.some((seg) => UNSAFE_NAME_RE.test(seg)) || segs.from.some((seg) => UNSAFE_NAME_RE.test(seg))) {
      return { error: `경로 이름이 부적합: ${from.rel} → ${to.rel}` };
    }
    if (!TAXONOMY_DIRS.has(segs.to[0]) || segs.to.length < 2) {
      return { error: `택소노미 디렉토리 아래여야 한다(${[...TAXONOMY_DIRS].join('/')}): ${to.rel}` };
    }
    // 첫 조각이 곧 type이다. lint W3가 그 조각만 `type`과 대조하므로, 바꾸면 옮긴 파일마다
    // 경고가 뜨고 그 경고가 유료 repair 프롬프트로 흘러 분석기가 되돌리려 든다.
    if (segs.from[0] !== segs.to[0]) {
      return { error: `택소노미 디렉토리는 바꿀 수 없다(lint W3): ${from.rel} → ${to.rel}` };
    }
    if (!fs.existsSync(from.abs)) return { error: `원본이 없다: ${from.rel}` };
    if (!fs.statSync(from.abs).isFile()) return { error: `파일이 아니다: ${from.rel}` };
    if (fs.existsSync(to.abs)) return { error: `대상이 이미 있다: ${to.rel}` };
    // 대소문자만 다른 두 대상은 macOS(APFS 기본)에서 **같은 파일**이라 뒤엣것이 앞엣것을
    // 덮어쓴다. 소문자 키로 비교해야 그 충돌이 검증 단계에서 잡힌다.
    const destKey = to.rel.toLowerCase();
    if (destSeen.has(destKey)) return { error: `대상이 중복된다(대소문자 무시): ${to.rel}` };
    if (sourceSeen.has(from.rel)) return { error: `원본이 중복된다: ${from.rel}` };
    destSeen.add(destKey);
    sourceSeen.add(from.rel);

    const body = fs.readFileSync(from.abs, 'utf8');
    const relLinks = findRelativeLinks(body);
    if (relLinks.length > 0) {
      return {
        error: `${from.rel}에 상대 링크가 있다(${relLinks.join(', ')}) — 옮기면 가리키는 대상이`
          + ' 조용히 바뀌고 lint도 못 잡는다. 먼저 /루트기준 절대경로로 고쳐라.',
      };
    }
    moves.push({ from: `/${from.rel}`, to: `/${to.rel}`, absFrom: from.abs, absTo: to.abs });
  }
  return { moves };
}

// 비워진 하위 디렉토리는 남겨두면 부모 index가 빈 도메인으로 가는 링크를 계속 광고한다.
// 택소노미 루트 자체는 절대 지우지 않는다.
function pruneEmptyDirs(okfHome, moves) {
  const candidates = [...new Set(moves.map((m) => path.dirname(m.absFrom)))]
    .sort((a, b) => b.length - a.length);
  for (const dir of candidates) {
    const rel = path.relative(okfHome, dir);
    if (rel === '' || rel.split(path.sep).length < 2) continue; // 택소노미 루트
    let entries;
    try { entries = fs.readdirSync(dir); } catch { continue; }
    if (entries.every((e) => e === 'index.md')) fs.rmSync(dir, { recursive: true, force: true });
  }
}

function countBrokenLinks(report) {
  return report.warnings.filter((w) => w.rule === 'W1').length;
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== '');
  const dryRun = args.includes('--dry-run');
  const mappingPath = args.find((a) => !a.startsWith('--'));
  if (!mappingPath) return fail(4, '사용법: node bin/restructure.mjs <mapping.json> [--dry-run]');

  let mapping;
  try {
    mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
  } catch (err) {
    return fail(4, `매핑 파일을 읽을 수 없다: code=${safeErrorCode(err)}`);
  }
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    return fail(4, '매핑은 {"옛 경로": "새 경로"} 객체여야 한다');
  }

  let okfHome = path.resolve(resolveOkfHome());
  if (!fs.existsSync(okfPaths(okfHome).git)) return fail(3, '번들이 아직 부트스트랩되지 않았다');
  okfHome = fs.realpathSync(okfHome); // 번들 자체가 심볼릭 링크일 수 있다

  // 작업트리가 더러우면 그 사실부터 알린다. 개별 항목 검증이 먼저 실패하면(크래시 잔여물 때문에
  // 원본이 이미 없다든가) 조작자가 엉뚱한 진단을 받는다.
  if (!dryRun && isDirty(okfHome)) return fail(4, '번들 작업트리가 깨끗하지 않다 — 먼저 정리하라');

  const { moves, error } = validate(okfHome, mapping);
  if (error) return fail(4, error);
  if (moves.length === 0) return fail(3, '옮길 것이 없다');

  if (dryRun) {
    for (const m of moves) process.stdout.write(`${m.from} → ${m.to}\n`);
    process.stdout.write(`\n${moves.length}건. --dry-run이라 아무것도 바꾸지 않았다.\n`);
    return;
  }

  const lock = acquireLock(okfHome, 'restructure', { onLog: (m) => process.stderr.write(`${m}\n`) });
  if (!lock.acquired) return fail(2, '다른 프로세스가 번들을 쓰고 있다 — 나중에 다시 시도하라');

  // **`fail()`은 `process.exit()`이라 `finally`를 건너뛴다.** 락을 반드시 놓기 위해 이 블록
  // 안에서는 종료하지 않고 결과만 모아 두고, 락을 놓은 뒤에 종료한다.
  let outcome = { code: 0, message: '' };
  const undo = (why) => {
    // 원복은 추적되지 않는 편집을 지운다. 락 획득과 dirty 검사 사이에 사용자가 저장한 메모가
    // 여기서 사라질 수 있으므로, 배치와 같은 방식으로 먼저 복사본을 남긴다.
    backupDirtyTree(okfHome, `restructure-${why}`, { onLog: (m) => process.stderr.write(`${m}\n`) });
    rollback(okfHome);
  };
  try {
    if (isDirty(okfHome)) {
      outcome = { code: 4, message: '락 획득 사이에 작업트리가 더러워졌다 — 먼저 정리하라' };
    } else {
      const before = countBrokenLinks(runLint(okfHome));
      for (const m of moves) {
        fs.mkdirSync(path.dirname(m.absTo), { recursive: true });
        // `git mv`가 아니라 그냥 rename이다. `git mv`는 rename을 인덱스에 올려서
        // `rollback()`(checkout + clean)으로 되돌아가지 않는다 — 옛 경로가 삭제된 채로 남는다.
        // 커밋 시 `add -A`가 어차피 rename으로 인식한다.
        fs.renameSync(m.absFrom, m.absTo);
      }
      pruneEmptyDirs(okfHome, moves);
      // 링크 재작성은 **이동 뒤**다. 옮기기 전에 고치면 lint가 중간 상태에서 깨진 링크를 본다.
      const pairs = moves.map((m) => [m.from, m.to]);
      for (const file of allBundleMd(okfHome)) {
        const text = fs.readFileSync(file, 'utf8');
        const rewritten = rewriteLinks(text, pairs);
        if (rewritten !== text) fs.writeFileSync(file, rewritten);
      }
      regenerateIndex(okfHome);

      const report = runLint(okfHome);
      // **깨진 링크는 lint에서 에러가 아니라 경고(W1)다.** 에러만 보고 원복을 판단하면 이 도구가
      // 방금 만들어낸 죽은 링크를 그대로 커밋한다 — 바로 이 도구가 막으려던 손상이다.
      const after = countBrokenLinks(report);
      if (report.errors.length > 0 || after > before) {
        undo('lint');
        outcome = {
          code: 5,
          message: `${formatReport(report)}\n검증 실패(에러 ${report.errors.length}건, 깨진 링크 ${before}→${after}) — 원복했다`,
        };
      } else if (!isDirty(okfHome)) {
        outcome = { code: 3, message: '결과적으로 바뀐 것이 없다' };
      } else {
        commitAll(okfHome, `okf: restructure ${moves.length} concepts`);
        process.stdout.write(`재배치 완료: ${moves.length}건, 링크 재작성 포함. 커밋 1개.\n`);
      }
    }
  } catch (err) {
    try { undo('error'); } catch { /* 원복 실패는 종료 코드로 드러난다 */ }
    outcome = { code: 1, message: `재배치 실패: code=${safeErrorCode(err)} — 원복 시도함` };
  } finally {
    releaseLock(okfHome, lock.token);
  }
  if (outcome.code !== 0) return fail(outcome.code, outcome.message);
}

main();
