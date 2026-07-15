import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { okfPaths, TAXONOMY_DIRS, pluginRoot } from './paths.mjs';
import { git, isDirty, commitAll } from './git.mjs';
import { regenerateIndex } from './index-gen.mjs';

function writeIfMissing(filePath, content) {
  if (fs.existsSync(filePath)) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return true;
}

function readTemplate(name) {
  return fs.readFileSync(path.join(pluginRoot(), 'templates', name), 'utf8');
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
  if (writeIfMissing(paths.gitignore, readTemplate('gitignore'))) seeded = true;
  if (writeIfMissing(paths.log, '# Log\n')) seeded = true;
  if (writeIfMissing(paths.schema, readTemplate('SCHEMA.md').replace('{{INSTALL_DATE}}', new Date().toISOString().slice(0, 10)))) seeded = true;
  if (writeIfMissing(paths.config, readTemplate('config.md'))) seeded = true;

  // index.md는 손으로 쓴 시드 템플릿을 두지 않는다 — index-gen.mjs가 만드는 결정적 포맷과
  // 조금이라도 다르면, 배치가 아무것도 안 한(NO-OP) 첫 실행에서도 "시드 포맷 -> 생성 포맷"
  // 전환 자체가 dirty로 잡혀 불필요한 커밋이 생긴다. 생성기를 유일한 소스로 삼아 원천 차단.
  if (!fs.existsSync(paths.rootIndex)) {
    regenerateIndex(okfHome);
    seeded = true;
  }

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
