import fs from 'node:fs';
import path from 'node:path';
import { resolveOkfHome, okfPaths } from '../lib/paths.mjs';
import { readConfig, DEFAULT_CONFIG } from '../lib/config.mjs';
import { ensureBootstrap } from '../lib/bootstrap.mjs';
import { maybeSpawnBatch } from '../lib/batch-gate.mjs';
import { truncateUtf8Bytes, capLines } from '../lib/text.mjs';
import { discoverConceptDirs, DIR_DESCRIPTIONS, DEPRECATED_PREFIX } from '../lib/index-gen.mjs';
import { safeErrorCode } from '../lib/status.mjs';

// 게이트의 목적은 "관련 concept를 실제로 Read 하게 만드는 것"인데, 루트 index.md는 카테고리별
// 개수만 담는다("references — 3개"). 개수만으로는 관련성을 판단할 수 없어 게이트가 지시를 해도
// 읽을 대상을 고를 수 없다(AGENDA.md:52의 미결 안건 — "MEMORY.md 방식 참고"가 가리키던 지점).
// 각 카테고리 index.md에는 이미 `- [제목](/dir/file.md): 설명` 한 줄씩 들어 있으므로, 주입
// 시점에 그걸 병합한다. 번들 파일 포맷과 index-gen은 그대로 두고 표현만 바꾼다.
function readCategoryLines(okfHome, dir) {
  try {
    return fs.readFileSync(path.join(okfHome, dir, 'index.md'), 'utf8').trim().split('\n')
      // `- `로 시작하는 줄만이 concept다. .filter(Boolean)은 빈 줄만 걸러서, index.md에
      // bullet 아닌 줄이 하나라도 생기면 게이트가 그것을 concept로 세고 주입한다(N/M 카운트까지
      // 거짓이 된다). 은퇴 줄은 index.md에 남기되 여기서만 뺀다 — 링크는 보존하고 예산은 돌려받는다.
      // buildInjectedIndex는 손대지 않는다: c.lines.length가 이미 필터 후 개수라 heading의
      // N/M개와 생략 마커가 자동으로 현역 기준이 된다.
      .filter((l) => l.startsWith('- ') && !l.startsWith(DEPRECATED_PREFIX));
  } catch {
    return []; // 카테고리 index.md 부재(부트스트랩 직후 등) — 빈 카테고리로 취급한다.
  }
}

// 예산 안에서 카테고리를 번갈아 한 줄씩 채운다(round-robin). 사전순으로 앞에서부터 채우면
// 큰 카테고리 하나가 예산을 통째로 먹고 뒤 카테고리는 index에서 완전히 사라진다 — 축출 순서가
// 관련성도 최신성도 아닌 파일명 사전순이 된다. 실제 한국어 concept 줄은 ~200바이트라 바이트
// 캡이 40개 근처에서 물리므로, decisions 200개짜리 번들에서는 troubleshooting이 통째로 증발했다.
// 잘릴 때는 카테고리마다 몇 개가 빠졌는지 남긴다: 모델이 "이 index는 일부"라는 걸 알아야
// 없는 것을 없다고 단정하지 않는다.
function buildInjectedIndex(okfHome, budgetLines, budgetBytes) {
  const cats = discoverConceptDirs(okfHome).map((dir) => ({
    dir, label: DIR_DESCRIPTIONS[dir] || dir, lines: readCategoryLines(okfHome, dir), taken: 0,
  }));
  if (!cats.length) return '';

  const headingFor = (c, count) => `## ${c.dir} (${c.label}) — ${count}`;
  // 예약과 렌더가 같은 문자열을 쓰도록 마커 생성을 한 곳으로 모은다 — 둘이 갈리면 선차감이
  // 실제 비용과 어긋나 다시 캡을 넘는다. 문구는 바꾸지 마라(스모크가 '생략'과
  // '/decisions/index.md'를 단언한다).
  const markerFor = (c, omitted) => `\n...(${omitted}개 생략 — 전체 목록은 /${c.dir}/index.md 를 Read)`;

  // heading과 생략 마커는 카테고리 수만큼 고정 비용이다 — 항목보다 먼저 예약해야 조립 결과가
  // 캡을 넘어 아래 안전망(:truncateUtf8Bytes)에서 뒤로 잘리지 않는다. 잘리는 곳은 문서 끝,
  // 즉 log.md tail이다(라이브 실측 절단 218B 전량이 tail이었다).
  let lines = budgetLines - cats.length * 2;
  // heading은 절단된 카테고리에서 `2/6개`로 길어진다(아래 렌더 참조). 짧은 `6개`로 예약하면
  // 카테고리당 최대 2바이트가 모자라 조립이 캡을 넘는다. 최악값으로 예약해도 주입 concept
  // 총합은 변하지 않는다(4,000~14,000B 201샘플 실측: 2,262로 동일).
  let bytes = budgetBytes - cats.reduce(
    (sum, c) => sum + Buffer.byteLength(`${headingFor(c, `${c.lines.length}/${c.lines.length}개`)}\n\n`, 'utf8'), 0);

  // 마커는 최악값을 그냥 깎으면 손해가 난다(전 카테고리 생략 가정 → 라이브에서 12→11 실측).
  // 환급식으로 간다: 카테고리마다 마커 비용을 미리 깎아두고, 그 카테고리를 끝까지 다 담아
  // 마커가 출력되지 않게 되는 순간 되돌려준다.
  const reservedMarker = new Map();
  for (const c of cats) {
    if (c.lines.length === 0) continue;
    const cost = Buffer.byteLength(markerFor(c, c.lines.length), 'utf8');
    reservedMarker.set(c.dir, cost);
    bytes -= cost;
    lines -= 1;
  }

  for (let progress = true; progress && lines > 0 && bytes > 0; ) {
    progress = false;
    for (const c of cats) {
      if (c.taken >= c.lines.length) continue;
      const cost = Buffer.byteLength(`${c.lines[c.taken]}\n`, 'utf8');
      // 한 카테고리의 다음 줄이 예산을 넘는다고 나머지를 굶기지 않는다. 옛 `lines = 0; break;`는
      // 바깥 루프까지 끝내 남은 예산에 들어갈 짧은 줄을 전부 버렸다(4,000~14,000B 201샘플 중
      // 102건에서 발생, 누적 손실 concept 160개). 종료는 progress 플래그가 보장한다 —
      // 어느 카테고리도 한 줄을 못 담으면 false로 남는다.
      // `lines < 1` 안쪽 검사를 남겨야 한다 — 환급으로 lines가 루프 도중 늘어난다.
      if (lines < 1 || bytes < cost) continue;
      c.taken += 1; lines -= 1; bytes -= cost; progress = true;
      if (c.taken === c.lines.length && reservedMarker.has(c.dir)) {
        bytes += reservedMarker.get(c.dir); lines += 1; reservedMarker.delete(c.dir);
      }
    }
  }

  return cats.map((c) => {
    const total = c.lines.length;
    const omitted = total - c.taken;
    const heading = headingFor(c, omitted > 0 ? `${c.taken}/${total}개` : `${total}개`);
    const body = c.lines.slice(0, c.taken).join('\n');
    // OKF 스펙의 점진적 공개: index.md는 자기 디렉토리의 내용물을 열거하므로, 잘린 카테고리는
    // 자기 index.md를 내려가는 길로 제시해야 한다. "159개 생략"만 알리고 위치를 안 주면 모델은
    // 빠진 게 있다는 것만 알고 도달할 수단이 없다 — 그건 막다른 길이지 점진적 공개가 아니다.
    const marker = omitted > 0 ? markerFor(c, omitted) : '';
    return `${heading}${body ? `\n${body}` : ''}${marker}`;
  }).join('\n\n');
}

function extractLatestLogSection(logContent, maxLines = 15) {
  const match = /^## \d{4}-\d{2}-\d{2}.*$/m.exec(logContent);
  if (!match) return '(최근 변경 없음)';
  const rest = logContent.slice(match.index);
  const afterHeading = rest.slice(match[0].length);
  const nextHeadingOffset = afterHeading.search(/^## /m);
  const section = nextHeadingOffset === -1 ? rest : rest.slice(0, match[0].length + nextHeadingOffset);
  const lines = section.trimEnd().split('\n');
  if (lines.length <= maxLines) return lines.join('\n');

  // 라이브 실측: 최신 log 섹션이 44줄인데 게이트는 15줄만 싣고 29줄(66%)을 버렸다. bullet이
  // 물리적으로 줄바꿈돼 있어 절단이 **문장 한가운데**에 떨어졌고, 모델은 잘린 문장인지 원래
  // 그런 문장인지 구별할 수 없었다.
  //
  // 두 가지를 고친다. 예산은 그대로다.
  // (1) 절단을 컬럼 0의 `- ` bullet 경계로 스냅한다 — 반쪽짜리 문장을 근거로 쓰게 두지 않는다.
  // (2) 마커에 **개수와 도달 경로**를 싣는다. 같은 파일 buildInjectedIndex의 markerFor가
  //     index에 대해 이미 그렇게 하고 그 근거를 "빠진 게 있다는 것만 알고 도달할 수단이 없으면
  //     막다른 길이지 점진적 공개가 아니다"라고 적어놨는데, log 경로에만 적용되지 않았다
  //     (독립 감사 지적). capLines의 기본 마커 `...(생략)`은 개수도 위치도 없다.
  let cut = maxLines;
  while (cut > 1 && !lines[cut].startsWith('- ')) cut--;
  if (cut <= 1) cut = maxLines; // bullet 경계를 못 찾으면 원래 자리에서 자른다(굶기지 않는다)
  const omitted = lines.length - cut;
  return `${lines.slice(0, cut).join('\n')}\n...(${omitted}줄 생략 — 전체는 /log.md 를 Read)`;
}

function buildContext({ okfHome, latestLog, injectMaxLines, injectMaxBytes }) {
  // 규칙 1의 Read는 조건부다. 라이브 벤치(docs/benchmarks/okf-live-2026-07-15T15-03-01-343Z)에서
  // 게이트를 켠 조건은 수동 재설명 대비 토큰 13,787을 더 썼는데, 그중 91%(12,508)가 강제 Read
  // 왕복이었고 그 Read들이 가져온 새 사실은 0개였다 — 답 8/8이 이미 아래 index 줄에 있었다.
  // index가 제목+설명을 싣는 이상 "반드시 Read"는 이미 건넨 것을 다시 사오라는 명령이다.
  // 관련 concept를 "찾는" 의무는 그대로 두고, 줄로 충분할 때의 왕복만 없앤다.
  const head = `=== OKF KNOWLEDGE GATE (필수) ===
전역 지식 번들: ${okfHome}
규칙:
1. 과거 결정/프로젝트/선호/트러블슈팅 관련 작업 전, 아래 인덱스에서 관련 concept를 반드시 찾아라.
   제목·설명이 답을 담고 있으면 Read 없이 그 줄을 그대로 근거로 쓰라.
   줄만으로 불충분하거나(요약이 답을 자름) 결정의 근거·맥락·예외가 필요하면 그때 파일을 Read 하라.
2. concept ID = 번들 루트 기준 경로. 링크는 /decisions/... 절대경로 형식.
3. 번들은 배치가 관리한다. 세션 중 직접 수정 금지(사용자 명시 요청 시 예외).
--- index.md ---
`;
  const tail = `--- 최근 변경 (log.md) ---
${latestLog}
`;
  // 예산은 index를 만들기 전에 계산해 넘긴다. 전체를 뒤에서 자르면 번들이 커질수록 log.md
  // 섹션이 통째로 밀려나 조용히 사라지고("지난 세션 이후 번들이 움직였다"는 신호는 index만큼
  // 중요하다), 잘라내는 위치도 카테고리 경계를 무시해 한 카테고리가 나머지를 굶긴다.
  // 2026-07-25: 이 방지 로직 자신이 생략 마커와 heading 최악값을 선차감하지 않아 정확히 그
  // 현상을 만들고 있었다 — 라이브 실측 절단 218B 전량이 tail이었다. buildInjectedIndex가
  // 조립 시점에 이미 캡 이하가 되게 고쳤고, 아래 truncateUtf8Bytes는 진짜 안전망으로 남는다.
  const idx = buildInjectedIndex(
    okfHome,
    Math.max(1, injectMaxLines - head.split('\n').length - tail.split('\n').length),
    Math.max(0, injectMaxBytes - Buffer.byteLength(head + tail, 'utf8'))
  ) || '(index.md 없음)';
  // implement.md §5-3: 줄 캡 + 바이트 캡(UTF-8 경계 절단) 이중 적용 — 여기서는 안전망이다.
  return truncateUtf8Bytes(capLines(`${head}${idx}\n${tail}`, injectMaxLines), injectMaxBytes);
}

function main() {
  if (process.env.OKF_BATCH === '1') {
    process.stdout.write('{}');
    return;
  }

  const okfHome = resolveOkfHome();
  ensureBootstrap(okfHome, (msg) => console.error(`[okf bootstrap] ${msg}`));

  let config;
  const configWarnings = [];
  try {
    config = readConfig(okfHome, (warning) => configWarnings.push(warning));
  } catch {
    config = DEFAULT_CONFIG;
  }
  for (const warning of configWarnings) {
    console.error(`[okf config] ${warning.key}: ${warning.code} — 기본값 사용`);
  }

  // "enabled: false"는 게이트 주입까지 포함한 전역 kill switch로 취급한다 — 캡처만 끄고
  // 게이트는 계속 주입되면 사용자가 끈 의도와 어긋난다. bootstrap은 그와 무관하게 항상
  // 실행한다(다시 켤 때 편집할 config.md 자체가 있어야 하므로).
  if (!config.enabled) {
    process.stdout.write('{}');
    return;
  }

  const paths = okfPaths(okfHome);
  let logContent = '';
  try {
    logContent = fs.readFileSync(paths.log, 'utf8');
  } catch {
    // no-op
  }
  const latestLog = extractLatestLogSection(logContent);

  const ctx = buildContext({
    okfHome,
    latestLog,
    injectMaxLines: config.inject_max_lines,
    injectMaxBytes: config.inject_max_bytes,
  });

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: ctx,
      },
      suppressOutput: true,
    })
  );

  try {
    maybeSpawnBatch(okfHome, config); // 캐치업: 직전 세션 크래시로 밀린 raw 처리
  } catch {
    // no-op — 배치 기동 실패가 세션 시작을 막으면 안 된다.
  }
}

try {
  main();
} catch (err) {
  // err.message 금지 — js-yaml 파싱 오류는 위반한 YAML **원문**을 그대로 담고, 그 원문은
  // 전사에서 파생된 concept 본문이다. 진단에 필요한 것은 코드뿐이다(bin/batch.mjs와 동일 계약).
  console.error(`[okf session-start] fatal: code=${safeErrorCode(err)}`);
  process.stdout.write('{}'); // 절대 세션 시작을 막지 않는다 — 최소 출력이라도 내보낸다.
}
// process.exit()를 쓰면 안 된다. 훅의 stdout은 항상 pipe이고, pipe write는 비동기다 — 게이트가
// pipe 버퍼보다 크면 일부만 나간 채 프로세스가 죽어서 Claude Code는 잘린 JSON을 받는다. 그러면
// 게이트가 통째로 유실되는데, 조용히 유실된다. CI(macOS)가 실제로 4,554바이트에서 잘린 출력을
// 잡았다: `SyntaxError: Unterminated string in JSON`. concept가 쌓여 index가 커질수록 확률이
// 오르므로, 정확히 게이트가 가장 필요한 사용자에게 먼저 터진다.
// exitCode만 정하고 자연 종료를 기다린다 — 배치 자식은 detached+unref이라 부모를 붙잡지 않는다.
process.exitCode = 0;
