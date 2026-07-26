// Minimal glob matcher for config.capture_exclude_cwd — no npm dep (implement.md §2).
// Supports `*` (any run of non-separator chars), `**` (any run including separators), `?` (one char).
// Both the pattern and the tested string are normalized to `/` separators so the same
// user-authored pattern works identically on macOS/Linux/Windows.
function globToRegExp(glob) {
  const normalized = glob.replace(/\\/g, '/');
  let re = '';
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    // `<p>/**`는 "<p> 자신과 그 하위 전체"다. 기존 변환은 `/`를 리터럴로 남겨 cwd가 정확히
    // 제외 루트인 세션(=가장 흔한 경우)이 통과했다 — 유일한 옵트아웃이 가장 흔한 경우를
    // 못 막았다는 뜻이다(실행 확인: matchGlob('/Users/me/secret', ['/Users/me/secret/**'])가
    // false였고, 스모크는 하위 경로만 봐서 못 잡았다). 패턴 **끝**의 `/**`만 바꾼다 —
    // 중간의 `/**/`는 기존 의미를 그대로 둔다.
    if (c === '/' && normalized.startsWith('/**', i) && i + 3 === normalized.length) {
      re += '(?:/.*)?';
      i += 2;
      continue;
    }
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
