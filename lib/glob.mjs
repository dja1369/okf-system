// Minimal glob matcher for config.capture_exclude_cwd — no npm dep (implement.md §2).
// Supports `*` (any run of non-separator chars), `**` (any run including separators), `?` (one char).
// Both the pattern and the tested string are normalized to `/` separators so the same
// user-authored pattern works identically on macOS/Linux/Windows.
function globToRegExp(glob) {
  const normalized = glob.replace(/\\/g, '/');
  let re = '';
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (c === '*') {
      if (normalized[i + 1] === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

export function matchGlob(str, patterns) {
  if (!patterns || patterns.length === 0) return false;
  const normalized = str.replace(/\\/g, '/');
  return patterns.some((p) => globToRegExp(p).test(normalized));
}
