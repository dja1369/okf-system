import fs from 'node:fs';
import path from 'node:path';

const TRUNCATION_MARKER = '\n...(중략)...\n';

// UTF-8 continuation bytes are 10xxxxxx; walking to the nearest lead-byte
// boundary keeps a byte-offset cut from splitting a multibyte char (e.g. 한글).
function snapBack(buf, idx) {
  let i = Math.min(idx, buf.length);
  while (i > 0 && (buf[i] & 0xc0) === 0x80) i--;
  return i;
}
function snapForward(buf, idx) {
  let i = Math.max(idx, 0);
  while (i < buf.length && (buf[i] & 0xc0) === 0x80) i++;
  return i;
}

function truncateHead(text, capBytes) {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= capBytes) return text;
  return buf.subarray(0, snapBack(buf, capBytes)).toString('utf8');
}

function truncateHeadTail(text, capBytes) {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= capBytes) return text;
  const sepBytes = Buffer.byteLength(TRUNCATION_MARKER, 'utf8');
  const headBytes = Math.max(0, Math.floor((capBytes - sepBytes) / 2));
  const tailBytes = Math.max(0, capBytes - sepBytes - headBytes);
  const head = buf.subarray(0, snapBack(buf, headBytes)).toString('utf8');
  const tail = buf.subarray(snapForward(buf, buf.length - tailBytes)).toString('utf8');
  return head + TRUNCATION_MARKER + tail;
}

// implement.md §5-5 5단계: text 블록은 그대로, tool_use는 한 줄 요약, tool_result/기타는 버림.
function extractContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (block?.type === 'text') return block.text ?? '';
      if (block?.type === 'tool_use') return `[tool: ${block.name}]`;
      return null;
    })
    .filter((v) => v !== null)
    .join('\n');
}

export function digestFile(inputJsonlPath, outputDigestPath, capKb) {
  const capBytes = capKb * 1024;
  const raw = fs.readFileSync(inputJsonlPath, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);

  const sections = [];
  let fallback = false;
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      // implement.md §7-7: schema drift/parse failure -> whole-file fallback, raw stays untouched.
      fallback = true;
      break;
    }
    if (entry?.isSidechain === true) continue;
    if (entry?.type !== 'user' && entry?.type !== 'assistant') continue;
    const role = entry.message?.role ?? entry.type;
    const text = extractContent(entry.message?.content);
    sections.push(`## ${role}\n${text}\n`);
  }

  const digest = fallback
    ? truncateHead(raw, capBytes)
    : truncateHeadTail(sections.join(''), capBytes);

  fs.mkdirSync(path.dirname(outputDigestPath), { recursive: true });
  fs.writeFileSync(outputDigestPath, digest, 'utf8');
}
