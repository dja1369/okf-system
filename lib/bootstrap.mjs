import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { okfPaths, TAXONOMY_DIRS, pluginRoot } from './paths.mjs';
import { git, isDirty, commitAll } from './git.mjs';
import { regenerateIndex } from './index-gen.mjs';
import { readConfig } from './config.mjs';

function writeIfMissing(filePath, content) {
  if (fs.existsSync(filePath)) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return true;
}

function readTemplate(name) {
  return fs.readFileSync(path.join(pluginRoot(), 'templates', name), 'utf8');
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

  fs.mkdirSync(paths.home, { recursive: true });
  for (const dir of TAXONOMY_DIRS) fs.mkdirSync(path.join(paths.home, dir), { recursive: true });
  fs.mkdirSync(paths.raw, { recursive: true });
  fs.mkdirSync(paths.removeCandidate, { recursive: true });
  fs.mkdirSync(paths.state, { recursive: true });
  fs.mkdirSync(paths.staging, { recursive: true });
  fs.mkdirSync(paths.logs, { recursive: true });

  let seeded = false;
  if (!fs.existsSync(paths.git)) {
    try {
      execFileSync('git', ['init'], { cwd: paths.home, stdio: 'ignore' });
      seeded = true;
    } catch (err) {
      log(`git init failed: ${err.message}`);
      return; // nothing below can proceed without a repo; next SessionStart retries.
    }
  }
  const installDate = new Date().toLocaleDateString('en-CA'); // 로컬 날짜 — 파일명·타임스탬프 규약과 일치
  if (writeIfMissing(paths.gitignore, readTemplate('gitignore'))) seeded = true;
  if (writeIfMissing(paths.log, '# Log\n')) seeded = true;
  if (writeIfMissing(paths.schema, readTemplate('SCHEMA.md').replace('{{INSTALL_DATE}}', installDate))) seeded = true;
  if (writeIfMissing(paths.config, readTemplate('config.md'))) seeded = true;
  // config.md를 먼저 쓴 뒤에 읽어야 사용자가 지정한 seed_language가 첫 부트스트랩에도 반영된다.
  if (seedConcepts(paths.home, installDate, readConfig(okfHome).seed_language) > 0) seeded = true;

  // index.md는 손으로 쓴 시드 템플릿을 두지 않는다 — index-gen.mjs가 만드는 결정적 포맷과
  // 조금이라도 다르면, 배치가 아무것도 안 한(NO-OP) 첫 실행에서도 "시드 포맷 -> 생성 포맷"
  // 전환 자체가 dirty로 잡혀 불필요한 커밋이 생긴다. 생성기를 유일한 소스로 삼아 원천 차단.
  // 시드 concept를 넣은 뒤에 생성해야 인덱스가 그것들을 담는다.
  if (seeded || !fs.existsSync(paths.rootIndex)) regenerateIndex(okfHome);

  if (!seeded) return;
  try {
    if (isDirty(paths.home)) commitAll(paths.home, 'okf: bootstrap');
  } catch (err) {
    // Never throw out of bootstrap — the calling hook must always exit 0 (§7-6).
    // Most likely cause: git user.name/user.email unset and IDENTITY override itself
    // failed for some other reason, or git missing entirely (already handled above).
    log(`bootstrap commit failed (git identity may need configuring): ${err.message}`);
  }
}
