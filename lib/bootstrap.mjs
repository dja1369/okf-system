import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { okfPaths, TAXONOMY_DIRS, pluginRoot } from './paths.mjs';
import { git, isDirty, commitAll } from './git.mjs';
import { regenerateIndex } from './index-gen.mjs';
import { readConfig } from './config.mjs';
import { isBundleLocked } from './lock.mjs';
import { ensureInstalledAt } from './installed-at.mjs';
import { ensurePrivateDir, securePrivateFile, writePrivateFile } from './permissions.mjs';

function writeIfMissing(filePath, content) {
  if (fs.existsSync(filePath)) return false;
  writePrivateFile(filePath, content);
  return true;
}

function readTemplate(name) {
  return fs.readFileSync(path.join(pluginRoot(), 'templates', name), 'utf8');
}

// 버전은 YAML 파서가 아니라 정규식으로 읽는다 — 시드 템플릿이 {{INSTALL_DATE}} 같은
// 플레이스홀더를 쓸 수 있고, 사용자 SCHEMA.md는 손편집으로 언제든 파싱 불가가 될 수 있는데
// 그때 부트스트랩이 죽으면 안 된다. 필드 부재 = v0 (버전 도입 이전 스냅샷).
// 값은 반드시 **따옴표 없는 정수 한 줄**이어야 한다 — `"2"`로 쓰면 0으로 읽혀 매
// SessionStart마다 템플릿이 재배포된다.
// 콜론 앞 공백 허용 — 사용자가 손으로 `schema_version : 2`로 고쳐두면 0으로 읽혀 매
// SessionStart마다 템플릿이 재배포된다(사용자 로컬 편집을 반복 파괴).
const SCHEMA_VERSION_RE = /^[ \t]*(?:"schema_version"|'schema_version'|schema_version)[ \t]*:\s*(\d+)\s*$/m;
function schemaVersionOf(text) {
  const m = SCHEMA_VERSION_RE.exec(text || '');
  return m ? Number(m[1]) : 0;
}

// 설치 직후 번들이 텅 비어 있으면 게이트가 "읽을 게 없다"는 인덱스를 주입하게 되고, 사용자
// 입장에선 시스템이 아무것도 안 하는 것처럼 보인다(실제로 그런 오해가 있었다). 그래서 OKF
// 자체에 대한 지식 — 포맷이 무엇인지, 이 플러그인이 어떻게 도는지, 번들 작성 규칙 —
// 을 시드로 넣어 첫 세션부터 게이트가 실제로 가리킬 대상이 있게 한다. 번들이 자기 자신을
// 설명하는 셈이라, "OKF가 뭐야?"를 물으면 번들에서 답이 나온다.
//
// 파일 단위로 없을 때만 쓴다 — 사용자가 시드를 고쳤거나 지웠으면 그 의사를 존중한다
// (재설치할 때마다 사용자 편집을 되돌리면 그게 더 나쁘다).
function seedConcepts(okfHome, installDate, lang = 'en') {
  const base = path.join(pluginRoot(), 'templates', 'seed');
  // 요청한 언어가 없으면 영어로 폴백 — 언어 하나 없다고 번들이 비는 것보다 낫다.
  const seedRoot = fs.existsSync(path.join(base, lang)) ? path.join(base, lang) : path.join(base, 'en');
  let wrote = 0;
  let dirs;
  try {
    dirs = fs.readdirSync(seedRoot, { withFileTypes: true });
  } catch {
    return 0; // 시드가 없는 배포본이어도 부트스트랩 자체는 성공해야 한다
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    for (const name of fs.readdirSync(path.join(seedRoot, d.name))) {
      if (!name.endsWith('.md')) continue;
      const body = fs.readFileSync(path.join(seedRoot, d.name, name), 'utf8')
        .replace(/\{\{INSTALL_DATE\}\}/g, installDate);
      if (writeIfMissing(path.join(okfHome, d.name, name), body)) wrote++;
    }
  }
  return wrote;
}

// implement.md §5-3 ensureBootstrap: idempotent, per-artifact — never gated on
// ".git existing" as a single all-or-nothing check, so a prior partial failure
// (e.g. git missing, identity unset) is completed by the next call instead of
// silently staying half-initialized forever.
export function ensureBootstrap(okfHome, log = () => {}) {
  const paths = okfPaths(okfHome);

  ensurePrivateDir(paths.home);
  for (const dir of TAXONOMY_DIRS) ensurePrivateDir(path.join(paths.home, dir));
  ensurePrivateDir(paths.raw);
  ensurePrivateDir(paths.removeCandidate);
  ensurePrivateDir(paths.state);
  ensurePrivateDir(paths.staging);
  ensurePrivateDir(paths.logs);

  // 배치가 도는 중이면 여기서 멈춘다. 아래로 내려가면 git init·writeIfMissing이 seeded를
  // 세워놓고 커밋에는 도달하지 못해, 배치의 유실 백스톱(bin/batch.mjs의 Buffer.compare 동일성
  // 검사)이 막으려던 바로 그 dirty 트리를 우리가 만든다. 디렉토리 보장만 하고 되돌아간다
  // (디렉토리는 git이 추적하지 않는다). 마이그레이션은 멱등이라 다음 세션이 한다.
  // 판정은 lib/lock.mjs 하나로 통일한다.
  //
  // 위치가 요점이다 — git init **뒤**에 두면 커밋 없는 dirty 트리를 남긴다.
  if (isBundleLocked(okfHome)) {
    log('배치 실행 중 — 번들 마이그레이션을 다음 세션으로 미룬다');
    return;
  }

  let seeded = false;
  // 마커 소급 판정의 기준점이다 — git init **전**에 재야 한다. 뒤에서 재면 신규 번들도
  // "이미 있던 번들"로 보여 루트 커밋(= 방금 만든 것) 소급 경로를 타게 된다.
  const bundleExisted = fs.existsSync(paths.git);
  if (!bundleExisted) {
    try {
      execFileSync('git', ['init'], { cwd: paths.home, stdio: 'ignore' });
      seeded = true;
    } catch (err) {
      log(`git init failed: ${err.message}`);
      return; // nothing below can proceed without a repo; next SessionStart retries.
    }
  }
  // .okf/는 gitignored라 커밋할 것이 없다 — seeded를 세우지 않는다.
  ensureInstalledAt(okfHome, bundleExisted);
  const installDate = new Date().toLocaleDateString('en-CA'); // 로컬 날짜 — 파일명·타임스탬프 규약과 일치
  if (writeIfMissing(paths.gitignore, readTemplate('gitignore'))) seeded = true;
  if (writeIfMissing(paths.log, '# Log\n')) seeded = true;
  if (writeIfMissing(paths.schema, readTemplate('SCHEMA.md').replace('{{INSTALL_DATE}}', installDate))) seeded = true;
  // 템플릿 개선(예: "description은 답이다" 규정)은 기존 번들에도 닿아야 한다 — writeIfMissing만으로는
  // 설치 시점 스냅샷이 영구 동결된다(실번들이 정확히 그 상태였다). schema_version이 낮을 때만
  // 교체하므로 같은 버전에서의 로컬 편집은 보존되고, 교체된 옛 내용은 직후 커밋으로 git 이력에 남는다.
  try {
    const currentSchema = fs.readFileSync(paths.schema, 'utf8');
    const schemaTemplate = readTemplate('SCHEMA.md');
    if (schemaVersionOf(currentSchema) < schemaVersionOf(schemaTemplate)) {
      writePrivateFile(paths.schema, schemaTemplate.replace('{{INSTALL_DATE}}', installDate));
      log(`SCHEMA.md를 템플릿 v${schemaVersionOf(schemaTemplate)}로 갱신 (이전 내용은 git 이력에 보존)`);
      seeded = true;
    }
  } catch {
    // 스키마를 읽을 수 없으면 writeIfMissing 경로가 방금 만들었거나 다음 SessionStart가 재시도한다.
  }
  if (writeIfMissing(paths.config, readTemplate('config.md'))) seeded = true;
  securePrivateFile(paths.config); // migrate existing installations too
  // config.md를 먼저 쓴 뒤에 읽어야 사용자가 지정한 seed_language가 첫 부트스트랩에도 반영된다.
  if (seedConcepts(paths.home, installDate, readConfig(okfHome).seed_language) > 0) seeded = true;

  // index.md는 손으로 쓴 시드 템플릿을 두지 않는다 — index-gen.mjs가 만드는 결정적 포맷과
  // 조금이라도 다르면, 배치가 아무것도 안 한(NO-OP) 첫 실행에서도 "시드 포맷 -> 생성 포맷"
  // 전환 자체가 dirty로 잡혀 불필요한 커밋이 생긴다. 생성기를 유일한 소스로 삼아 원천 차단.
  // 시드 concept를 넣은 뒤에 생성해야 인덱스가 그것들을 담는다.
  let indexResult = null;
  if (seeded || !fs.existsSync(paths.rootIndex)) indexResult = regenerateIndex(okfHome);

  if (!seeded) return;
  try {
    // 승격 전파 경로는 둘이다: (a) 여기(schema 범프 등으로 seeded가 설 때),
    // (b) bin/batch.mjs가 **청크마다** 부르는 regenerateIndex — 배치가 한 번 성공하기만 하면
    // 승격된다. "schema 범프가 유일한 트리거"는 거짓이다.
    // 화살표는 U+2192다(테스트가 완전일치로 단언한다 — ASCII '->'로 바꾸면 깨진다).
    const message = indexResult?.promoted
      ? `okf: bootstrap (OKF v0.1 → v${indexResult.okfVersion})`
      : 'okf: bootstrap';
    if (isDirty(paths.home)) commitAll(paths.home, message);
  } catch (err) {
    // Never throw out of bootstrap — the calling hook must always exit 0 (§7-6).
    // Most likely cause: git user.name/user.email unset and IDENTITY override itself
    // failed for some other reason, or git missing entirely (already handled above).
    log(`bootstrap commit failed (git identity may need configuring): ${err.message}`);
  }
}
