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

// 하네스/플러그인 boilerplate를 사용자 발화에서 걷어낸다.
//
// 실측 근거(실제 세션 transcript 1건 분석): user 타입 턴 18개 중 진짜 사용자가 친 말은
// 1개뿐이었고, 나머지 17개는 전부 도구 결과(8) · isMeta(4) · 슬래시 커맨드 에코(4) ·
// 로컬 커맨드 출력(1)이었다. 이걸 그대로 digest에 넣으면 LLM은 커맨드 정의문과 도구
// 로그를 "대화"로 읽게 되고, 실제 신호가 그 밑에 묻힌다 — 배치가 매번 NO-OP을 뱉던 원인이다.
// 부수 효과로 digest 크기가 줄어 LLM 비용도 함께 내려간다.
//
// 통짜로 버리지 않고 "태그 블록만 제거 → 남은 게 없으면 그 턴을 버림" 순서로 처리한다.
// 사용자가 커맨드와 함께 진짜 문장을 같이 쓴 경우 그 문장까지 잃지 않기 위해서다.
const BOILERPLATE_BLOCKS = [
  /<command-name>[\s\S]*?<\/command-name>/g,
  /<command-message>[\s\S]*?<\/command-message>/g,
  /<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g,
  /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g,
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
];

// `<command-args>`만 삭제가 아니라 **언랩**이다. 나머지 5개는 하네스가 만든 텍스트지만
// 커맨드 인자는 **사용자가 직접 타이핑한 본문**이다(`/plan 이러이러하게 해줘`의 뒷부분).
// 삭제하면 위 주석이 약속한 "커맨드와 함께 쓴 진짜 문장까지 잃지 않는다"를 코드가 정면으로
// 위반한다. 독립 감사 실측(이 저장소 transcript 74개): 비어있지 않은 `<command-args>`를 담은
// 턴 6개 중 **6개 전부**가 제거 후 남은 게 없어 턴 통째로 폐기됐고, 그중 4개는 인자가
// 40바이트를 넘는 진짜 문장이었다(최대 364B). 애초에 지식이 될 기회를 못 얻던 경로다.
const COMMAND_ARGS_RE = /<command-args>([\s\S]*?)<\/command-args>/g;

export function stripBoilerplate(text) {
  let out = String(text || '');
  // 함수 폼 — 인자에 `$&`·`$'` 같은 치환 패턴이 있어도 해석되지 않는다.
  out = out.replace(COMMAND_ARGS_RE, (_, inner) => inner);
  for (const re of BOILERPLATE_BLOCKS) out = out.replace(re, '');
  return out.trim();
}

// 이 턴이 사용자의 실제 발화가 아니라 하네스가 만든 것인지 판정한다.
function isHarnessNoise(entry) {
  if (entry?.isMeta === true) return true;              // 커맨드 본문 확장, 하네스 caveat
  if (entry && 'toolUseResult' in entry) return true;   // 도구 결과가 user 턴으로 들어온 것
  return false;
}

export function digestFile(inputJsonlPath, outputDigestPath, capKb) {
  const capBytes = capKb * 1024;
  const raw = fs.readFileSync(inputJsonlPath, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);

  const sections = [];
  let parsedLines = 0;
  let skippedLines = 0;
  let keptTurns = 0;
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      // 예전엔 한 줄만 깨져도 break + **원본 전체 폴백**이었다. 그 폴백은 필터를 하나도 거치지
      // 않은 원문 앞부분을 그대로 LLM에 보냈다 — tool_result 원문 유출 경로다(실측 재현:
      // AWS 자격증명 문자열이 digest에 그대로 실렸다). 이제는 그 줄만 버리고 계속 읽는다.
      // 동시 기록 중인 transcript의 잘린 마지막 줄도 같은 경로로 안전하게 처리된다.
      skippedLines++;
      continue;
    }
    parsedLines++;
    if (entry?.isSidechain === true) continue;
    if (entry?.type !== 'user' && entry?.type !== 'assistant') continue;
    if (isHarnessNoise(entry)) continue;
    const role = entry.message?.role ?? entry.type;
    const text = stripBoilerplate(extractContent(entry.message?.content));
    if (!text) continue; // boilerplate만 있던 턴 — 남은 내용이 없으면 대화가 아니다
    sections.push(`## ${role}\n${text}\n`);
    keptTurns++;
  }

  const body = sections.join('');
  const beforeBytes = Buffer.byteLength(body, 'utf8');
  const digest = truncateHeadTail(body, capBytes);
  const afterBytes = Buffer.byteLength(digest, 'utf8');
  // 캡 절단은 가운데를 버린다 — 그 손실이 로그 한 줄도 없이 일어났다(실측 242.6KB->150KB, 38%).
  const droppedBytes = Math.max(0, beforeBytes - afterBytes);

  fs.mkdirSync(path.dirname(outputDigestPath), { recursive: true });
  fs.writeFileSync(outputDigestPath, digest, 'utf8');
  return {
    totalLines: lines.length,
    parsedLines,
    skippedLines,
    keptTurns,
    beforeBytes,
    afterBytes,
    droppedBytes,
    droppedPct: beforeBytes > 0 ? Math.round((droppedBytes / beforeBytes) * 100) : 0,
  };
}
