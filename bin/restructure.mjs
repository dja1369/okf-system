#!/usr/bin/env node
// concept 파일을 번들 안에서 **옮기고 링크를 따라 고친다.**
//
// 왜 별도 도구인가: 파일 경로가 곧 concept ID다(SCHEMA 규칙 4). 옮기면 이 번들 안의 모든
// 상호참조가 깨지고, 그건 게이트가 제시하는 링크가 죽는다는 뜻이다 — 되돌리기 어려운 손상이라
// `mv` 한 줄로 할 일이 아니다. 이 파일이 하는 것은 **기계적 부분 전부**다:
// 락 획득 · 경계 검증 · git mv · 전 파일 링크 재작성 · index 재생성 · lint · 단일 커밋.
//
// **어디로 옮길지는 이 파일이 정하지 않는다.** 그건 "무엇이 비슷한가"라는 판단이고 코드가 하면
// 추측이 된다(Rule 5). 호출자가 매핑을 준다.
//
// 사용법:
//   node bin/restructure.mjs <mapping.json> [--dry-run]
//   mapping.json = { "옛 상대경로.md": "새 상대경로.md", ... }
//
// 종료 코드: 0 성공 · 1 내부 오류 · 2 락 · 3 대상 없음(무변경) · 4 매핑 부적합 · 5 lint 실패로 원복
import fs from 'node:fs';
import path from 'node:path';
import { resolveOkfHome, okfPaths, SCAN_EXCLUDE_DIRS, UNSAFE_NAME_RE, NON_CONCEPT_BASENAMES } from '../lib/paths.mjs';
import { acquireLock, releaseLock } from '../lib/lock.mjs';
import { isDirty, commitAll, rollback } from '../lib/git.mjs';
import { regenerateIndex } from '../lib/index-gen.mjs';
import { runLint, formatReport } from '../lib/lint.mjs';
import { safeErrorCode } from '../lib/status.mjs';

function fail(code, message) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

// 링크 재작성은 **정확한 경로 토큰**만 바꾼다. `/patterns/git.md`가 `/patterns/git.md.bak`이나
// `/patterns/github-x.md`의 접두가 되는 사고를 막으려면 뒤에 경로 문자가 이어지면 안 된다.
// 치환값은 함수 폼으로 넘긴다 — 경로에 `$&`가 있어도 치환 패턴으로 해석되지 않는다.
function rewriteLinks(text, moves) {
  let out = text;
  for (const [from, to] of moves) {
    const re = new RegExp(`(?<![\\w/.-])${from.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}(?![\\w.-])`, 'g');
    out = out.replace(re, () => to);
  }
  return out;
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

  const okfHome = path.resolve(resolveOkfHome());
  const paths = okfPaths(okfHome);
  if (!fs.existsSync(paths.git)) return fail(3, '번들이 아직 부트스트랩되지 않았다');

  // 경계 검증. **하나라도 부적합하면 아무것도 옮기지 않는다** — 부분 이동이 제일 나쁘다.
  const moves = [];
  const destSeen = new Set();
  for (const [rawFrom, rawTo] of Object.entries(mapping)) {
    const from = String(rawFrom).replace(/^\/+/, '');
    const to = String(rawTo).replace(/^\/+/, '');
    const absFrom = path.resolve(okfHome, from);
    const absTo = path.resolve(okfHome, to);
    if (!absFrom.startsWith(okfHome + path.sep) || !absTo.startsWith(okfHome + path.sep)) {
      return fail(4, `번들 밖 경로: ${from} → ${to}`);
    }
    if (!from.endsWith('.md') || !to.endsWith('.md')) return fail(4, `.md만 옮길 수 있다: ${from}`);
    if (NON_CONCEPT_BASENAMES.has(path.basename(absFrom)) || NON_CONCEPT_BASENAMES.has(path.basename(absTo))) {
      return fail(4, `예약 파일은 대상이 아니다: ${from}`);
    }
    if (to.split('/').some((seg) => UNSAFE_NAME_RE.test(seg))) return fail(4, `새 경로 이름이 부적합: ${to}`);
    // **첫 경로 조각(택소노미 디렉토리)은 바꾸지 않는다.** lint W3가 `type`에 대응하는
    // 디렉토리를 첫 조각으로 요구한다 — 바꾸면 옮긴 파일마다 경고가 뜨고, 그 경고는
    // repair 프롬프트로 흘러 분석기가 파일을 되돌리려 들 수 있다.
    if (from.split('/')[0] !== to.split('/')[0]) {
      return fail(4, `택소노미 디렉토리는 바꿀 수 없다(lint W3): ${from} → ${to}`);
    }
    if (!fs.existsSync(absFrom)) return fail(4, `원본이 없다: ${from}`);
    if (fs.existsSync(absTo)) return fail(4, `대상이 이미 있다: ${to}`);
    if (destSeen.has(to)) return fail(4, `대상이 중복된다: ${to}`);
    destSeen.add(to);
    moves.push([`/${from}`, `/${to}`, absFrom, absTo]);
  }
  if (moves.length === 0) return fail(3, '옮길 것이 없다');

  if (dryRun) {
    for (const [from, to] of moves) process.stdout.write(`${from} → ${to}\n`);
    process.stdout.write(`\n${moves.length}건. --dry-run이라 아무것도 바꾸지 않았다.\n`);
    return;
  }

  if (isDirty(okfHome)) return fail(4, '번들 작업트리가 깨끗하지 않다 — 먼저 정리하라');

  const lock = acquireLock(okfHome, 'restructure', { onLog: (m) => process.stderr.write(`${m}\n`) });
  if (!lock.acquired) return fail(2, '다른 프로세스가 번들을 쓰고 있다 — 나중에 다시 시도하라');

  // **`fail()`은 `process.exit()`이라 `finally`를 건너뛴다.** 락을 반드시 놓기 위해 이 블록
  // 안에서는 종료하지 않고 결과만 모아 두고, 락을 놓은 뒤에 종료한다.
  let outcome = { code: 0, message: '' };
  try {
    // `git mv`가 아니라 그냥 rename이다. `git mv`는 rename을 인덱스에 올려서
    // `rollback()`(checkout + clean)으로 되돌아가지 않는다 — 옛 경로가 삭제된 채로 남는다.
    // 평범한 rename이면 옛 파일은 인덱스에서 복원되고 새 파일은 untracked라 clean이 지운다.
    // 커밋 시 `add -A`가 어차피 rename으로 인식한다.
    for (const [, , absFrom, absTo] of moves) {
      fs.mkdirSync(path.dirname(absTo), { recursive: true });
      fs.renameSync(absFrom, absTo);
    }
    // 링크 재작성은 **이동 뒤**다. 옮기기 전에 고치면 lint가 중간 상태에서 깨진 링크를 본다.
    const linkPairs = moves.map(([from, to]) => [from, to]);
    for (const file of allBundleMd(okfHome)) {
      const before = fs.readFileSync(file, 'utf8');
      const after = rewriteLinks(before, linkPairs);
      if (after !== before) fs.writeFileSync(file, after);
    }
    regenerateIndex(okfHome);

    const report = runLint(okfHome);
    if (report.errors.length > 0) {
      rollback(okfHome);
      outcome = { code: 5, message: `${formatReport(report)}\n재배치 후 lint 실패 — 원복했다` };
    } else if (!isDirty(okfHome)) {
      outcome = { code: 3, message: '결과적으로 바뀐 것이 없다' };
    } else {
      commitAll(okfHome, `okf: restructure ${moves.length} concepts`);
      process.stdout.write(`재배치 완료: ${moves.length}건, 링크 재작성 포함. 커밋 1개.\n`);
    }
  } catch (err) {
    try { rollback(okfHome); } catch { /* 원복 실패는 종료 코드로 드러난다 */ }
    outcome = { code: 1, message: `재배치 실패: code=${safeErrorCode(err)} — 원복 시도함` };
  } finally {
    releaseLock(okfHome, lock.token);
  }
  if (outcome.code !== 0) return fail(outcome.code, outcome.message);
}

main();
