import fs from 'node:fs';
import path from 'node:path';
import { resolveOkfHome, okfPaths, SCAN_EXCLUDE_DIRS } from '../lib/paths.mjs';
import { acquireLock, releaseLock } from '../lib/lock.mjs';
import { isDirty, commitAll, rollback } from '../lib/git.mjs';
import { runLint, formatReport, walkMdFiles } from '../lib/lint.mjs';
import { regenerateIndex } from '../lib/index-gen.mjs';
import { parseFrontmatter, setFrontmatterStatus } from '../lib/frontmatter.mjs';
import { conceptStatus } from '../lib/trust.mjs';

// 이 시스템에는 "잊기"가 없었다. 무관해진 concept가 게이트 슬롯을 영구 점유하고, 정렬이
// 파일명 사전순 단독이라 실제 문서가 대신 잘린다. SPEC v0.2에는 "delete"라는 단어가 없다 —
// 위생 목적 은퇴의 스펙 정합 형태는 물리 삭제가 아니라 deprecation이다.
//
// 종료 코드가 기계 신호다: 0=성공/무변경, 1=예기치 못한 오류, 2=락 점유, 3=사전 lint 에러,
// 4=대상 부적합, 5=사후 lint 실패(롤백함).
// **출력은 stdout/stderr 전용이다** — .okf/logs/에 쓰지 않는다.

const RESERVED_BASENAMES = new Set(['index.md', 'log.md', 'SCHEMA.md']);

function fail(code, message) {
  console.error(message);
  process.exitCode = code;
  return code;
}

function localDateString(date = new Date()) {
  return date.toLocaleDateString('en-CA'); // UTC를 섞으면 UTC+ 새벽에 헤딩이 하루 어긋나 E3b가 난다
}

function appendLogEntry(okfHome, rel, want) {
  const logPath = okfPaths(okfHome).log;
  const today = localDateString();
  const bullet = `- **Deprecation**: [/${rel}](/${rel}) — status: ${want}`;
  let text = '# Log\n';
  try {
    text = fs.readFileSync(logPath, 'utf8');
  } catch {
    // 없으면 새로 만든다
  }
  // **replace는 반드시 함수 폼이다.** 문자열 폼이면 bullet 안의 `$&`/`$'`/`` $` ``가 치환
  // 패턴으로 해석돼 로그가 스플라이스된다 — bullet에는 사용자가 통제하는 파일 경로가 들어간다
  // (독립 검증 재현: `cost-$&-review.md`가 로그를 `cost-## 2026-07-25-review.md`로 망가뜨렸다).
  // bin/batch.mjs의 프롬프트 치환이 같은 함정을 함수 폼으로 막고 있다.
  if (text.includes(`## ${today}`)) {
    // 같은 날짜 섹션이 있으면 bullet만 추가한다(중복 헤딩 금지 — SCHEMA 규칙 3).
    fs.writeFileSync(logPath, text.replace(`## ${today}`, () => `## ${today}\n${bullet}`));
    return;
  }
  fs.writeFileSync(logPath, text.includes('# Log')
    ? text.replace('# Log\n', () => `# Log\n\n## ${today}\n${bullet}\n`)
    : `# Log\n\n## ${today}\n${bullet}\n${text}`);
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== '');
  const restore = args.includes('--restore');
  const rel = args.find((a) => !a.startsWith('--'));
  if (!rel) return fail(4, '사용법: node bin/deprecate.mjs <번들 상대경로> [--restore]');

  // resolveOkfHome()은 OKF_HOME 환경변수를 **그대로** 돌려준다 — 사용자가 후행 구분자를 붙여
  // 두면(`OKF_HOME=/x/okf/`) 아래 startsWith 경계 검사가 정상 대상을 거부한다(실측: exit 4).
  // 여기서 정규화한다. 다른 모듈은 okfPaths()의 path.join이 대신 정규화해주므로 이 raw 문자열
  // 비교만 취약하다.
  const okfHome = path.resolve(resolveOkfHome());
  const paths = okfPaths(okfHome);
  const abs = path.resolve(okfHome, rel);
  const relNorm = path.relative(okfHome, abs).split(path.sep).join('/');

  // 대상 검증 — 경로 탈출, 확장자, 예약 basename, 운영 디렉토리, 시드 보호.
  if (!abs.startsWith(okfHome + path.sep)) return fail(4, '번들 밖 경로는 대상이 아니다');
  if (!abs.endsWith('.md')) return fail(4, '.md 파일만 은퇴시킬 수 있다');
  if (RESERVED_BASENAMES.has(path.basename(abs))) return fail(4, '예약 파일(index.md/log.md/SCHEMA.md)은 대상이 아니다');
  if (relNorm.split('/').some((seg) => SCAN_EXCLUDE_DIRS.has(seg))) return fail(4, '운영 디렉토리 안의 파일은 대상이 아니다');
  let original;
  try {
    original = fs.readFileSync(abs, 'utf8');
  } catch {
    return fail(4, `대상 파일을 읽을 수 없다: ${relNorm}`);
  }
  // bin/batch.mjs의 SCHEMA/okf_seed 차단과 같은 경계다.
  if (/^[ \t]*(?:"okf_seed"|'okf_seed'|okf_seed)[ \t]*:\s*true\b/m.test(original)) return fail(4, 'okf_seed 시드는 은퇴 대상이 아니다');

  const lock = acquireLock(okfHome, 'deprecate', { onLog: (m) => console.error(m) });
  if (!lock.acquired) {
    return fail(2, '배치가 실행 중이라 은퇴를 적용하지 않았다. /okf:okf-status로 확인 후 다시 시도하라.');
  }
  try {
    // bin/batch.mjs와 같은 정책: stale 락을 회수했다면 남은 dirty 트리는 사용자 편집이 아니라
    // 크래시 잔여물이다. 커밋하면 반쯤 반영된 분석기 산출물이 영구화된다.
    if (lock.recoveredFromStaleLock && isDirty(paths.home)) {
      console.error('stale lock 회수 후 dirty 트리 발견 — 크래시 잔여물로 판단해 원복한다');
      rollback(paths.home);
      original = fs.readFileSync(abs, 'utf8'); // 원복 후 바이트로 다시 읽는다
    }

    const pre = runLint(okfHome);
    if (pre.errors.length > 0) return fail(3, `사전 lint 실패 — 먼저 고쳐라:\n${formatReport(pre)}`);
    if (isDirty(paths.home)) commitAll(paths.home, 'okf: pre-batch: user edits');

    const want = restore ? null : 'deprecated';
    const current = conceptStatus(parseFrontmatter(original).data);
    if ((want === null && current !== 'deprecated') || (want === 'deprecated' && current === 'deprecated')) {
      console.log(`무변경: ${relNorm}는 이미 ${want === null ? '현역' : 'deprecated'}이다`);
      return 0;
    }
    const next = setFrontmatterStatus(original, want);
    if (next === null) return fail(4, 'frontmatter를 안전하게 수정할 수 없다(lint E1 대상일 수 있다)');
    fs.writeFileSync(abs, next);
    appendLogEntry(okfHome, relNorm, want === null ? 'active' : want);
    regenerateIndex(okfHome);

    const post = runLint(okfHome);
    if (post.errors.length > 0) {
      rollback(paths.home);
      return fail(5, `사후 lint 실패 — 원복했다:\n${formatReport(post)}`);
    }
    commitAll(paths.home, `okf: ${want === null ? 'restore' : 'deprecate'} /${relNorm}`);

    // 잔존 참조 스캔에서 **예약 파일을 뺀다** — index.md는 방금 우리가 재생성했고 log.md에는
    // 방금 우리가 항목을 썼다. 둘 다 '잔존 참조'가 아니라 이 명령의 산출물이다(안 빼면 100% 오탐).
    const residual = [];
    for (const other of walkMdFiles(okfHome)) {
      if (other === relNorm) continue;
      if (RESERVED_BASENAMES.has(path.basename(other))) continue;
      try {
        if (fs.readFileSync(path.join(okfHome, other), 'utf8').includes(`/${relNorm}`)) residual.push(other);
      } catch {
        // 읽을 수 없는 파일은 보고 대상이 아니다
      }
    }
    console.log(`${want === null ? '복귀' : '은퇴'} 완료: /${relNorm}`);
    console.log(residual.length === 0 ? '잔존 참조 0건' : `잔존 참조 ${residual.length}건: ${residual.join(', ')}`);
    return 0;
  } catch (err) {
    return fail(1, `예기치 못한 오류: ${err?.code ?? 'UNKNOWN'}`);
  } finally {
    // process.exit()를 쓰지 마라 — 락이 남는다. exitCode만 세우고 자연 종료한다.
    releaseLock(okfHome, lock.token);
  }
}

main();
