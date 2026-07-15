import { execFileSync } from 'node:child_process';

// Fixed identity for OKF's own automated commits so bootstrap/batch never fail
// in environments without a configured global git user.name/user.email
// (implement.md §9 flags this as empirically unverified; this sidesteps it by
// never depending on the ambient identity for commits this system makes itself).
const IDENTITY = ['-c', 'user.name=OKF Batch', '-c', 'user.email=okf-batch@localhost'];

export function git(args, cwd, opts = {}) {
  return execFileSync('git', [...IDENTITY, ...args], { cwd, encoding: 'utf8', ...opts });
}

export function isDirty(cwd) {
  return git(['status', '--porcelain'], cwd).trim().length > 0;
}

export function commitAll(cwd, message) {
  git(['add', '-A'], cwd, { stdio: 'ignore' });
  git(['commit', '-m', message], cwd, { stdio: 'ignore' });
}

// implement.md §5-5 6e / §7-4: repo-root-scoped rollback. raw/, _remove_candidate/,
// .okf/ are untouched because .gitignore excludes them from both checkout and clean.
export function rollback(cwd) {
  git(['checkout', '--', '.'], cwd, { stdio: 'ignore' });
  git(['clean', '-fd'], cwd, { stdio: 'ignore' });
}
