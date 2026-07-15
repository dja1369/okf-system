// implement.md §5-3: gate injection caps must not corrupt multibyte (Korean etc.)
// characters at the cut point.
export function truncateUtf8Bytes(str, maxBytes) {
  const buf = Buffer.from(str, 'utf8');
  if (buf.length <= maxBytes) return str;
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--; // back off over UTF-8 continuation bytes
  return buf.subarray(0, end).toString('utf8');
}

export function capLines(str, maxLines, marker = '...(생략)') {
  const lines = str.split('\n');
  if (lines.length <= maxLines) return str;
  return lines.slice(0, maxLines).join('\n') + '\n' + marker;
}
