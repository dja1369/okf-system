// 실사용 title 정렬 분포 측정 (E3 과제 4). **유료 호출 0, 읽기 전용.**
//
// **왜 필요한가**: E2는 정답 concept의 title 앞에 `!!! `를 붙여 recall이 0.262 → 0.533으로
// 갈리는 것을 보였다. 그러나 그 접두는 **인위적**이다 — 실제 번들에 `!!! `로 시작하는 concept는
// 없다. 그래서 E2는 "정렬 위치가 생존을 정한다"까지만 보였고 **실사용에서 그 편향이 얼마나
// 큰지는 재지 않았다**(E2 리포트 §6-1). 이 스크립트가 그것을 잰다.
//
// **정렬 키는 `title.toLowerCase()`이고 비교는 `<`/`>`다**(lib/index-gen.mjs:242-246, :303).
// 즉 로케일 정렬이 아니라 **UTF-16 코드유닛 순서**다. 그래서 ASCII로 시작하는 title(≤ U+007A)은
// 한글로 시작하는 title(U+AC00~)보다 **항상** 앞선다. 이건 가설이 아니라 코드가 하는 일이고,
// 아래 assertOrderingModel()이 실제 번들에서 그 예측을 실측으로 검사한다.
//
// **프라이버시**: 산출물에 title·설명·파일명·링크를 **한 글자도 싣지 않는다**. 첫 글자의
// 유니코드 분류와 개수만 나간다. `raw/`·`_remove_candidate/`는 discoverConceptDirs가 구조적으로
// 배제한다(lib/paths.mjs SCAN_EXCLUDE_DIRS) — 이 파일은 그 디렉토리들을 열지도 않는다.
//
// CLI:
//   node test/gate-title-distribution.mjs [--home <경로>] [--out <경로>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { collectConceptLines, buildInjectedIndex } from '../lib/gate.mjs';
import { discoverConceptDirs } from '../lib/index-gen.mjs';
import { readConfig } from '../lib/config.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = { home: null, outPath: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--home') out.home = argv[++i];
    else if (argv[i] === '--out') out.outPath = argv[++i];
    else throw new Error(`unknown flag: ${argv[i]}`);
  }
  return out;
}

// 첫 글자의 분류. **정렬 키가 소문자화된 title이므로 소문자화 뒤의 첫 코드포인트**를 본다 —
// 원문 첫 글자를 보면 `A`와 `a`가 다른 칸에 들어가는데 정렬은 둘을 같게 취급한다.
const CLASSES = [
  ['ascii-symbol', (c) => (c >= 0x20 && c <= 0x2f) || (c >= 0x3a && c <= 0x40) || (c >= 0x5b && c <= 0x60) || (c >= 0x7b && c <= 0x7e)],
  ['ascii-digit', (c) => c >= 0x30 && c <= 0x39],
  ['ascii-latin', (c) => c >= 0x61 && c <= 0x7a],
  ['latin-extended', (c) => c >= 0x00c0 && c <= 0x024f],
  ['hangul', (c) => (c >= 0x1100 && c <= 0x11ff) || (c >= 0x3130 && c <= 0x318f) || (c >= 0xac00 && c <= 0xd7a3)],
  ['kana', (c) => c >= 0x3040 && c <= 0x30ff],
  ['cjk-ideograph', (c) => (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0xf900 && c <= 0xfaff)],
];
function classify(ch) {
  const c = ch.codePointAt(0);
  for (const [name, test] of CLASSES) if (test(c)) return name;
  return 'other';
}
const CLASS_NAMES = [...CLASSES.map(([n]) => n), 'other'];

// 주입 줄 `* [제목](/dir/file.md) - 설명`에서 **제목만** 떼어낸다. 이 값은 밖으로 나가지 않고
// 첫 글자 분류에만 쓰인다.
const TITLE_RE = /^\* \[([^\]]*)\]\(/;

function emptyHistogram() {
  return Object.fromEntries(CLASS_NAMES.map((n) => [n, 0]));
}

// 정렬 모형 검사. "코드유닛 순서다"는 주장이므로 실측으로 확인한다 — 실제 카테고리 줄 순서가
// 소문자 title의 `<` 비교와 어긋나는 인접쌍이 있으면 그 개수를 보고한다.
// **은퇴(deprecated) concept는 섹션 안에서 뒤로 밀리므로**(index-gen renderSections) 위반으로
// 잡힐 수 있고, `# Subdirectories` 섹션이 type 섹션보다 앞서므로 섹션 경계에서도 잡힌다.
// 그래서 이 값은 "0이어야 한다"가 아니라 **어디서 깨지는지를 세는 진단값**이다.
function orderingViolations(titles) {
  let v = 0;
  for (let i = 1; i < titles.length; i++) {
    if (titles[i].toLowerCase() < titles[i - 1].toLowerCase()) v += 1;
  }
  return v;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const home = args.home ?? process.env.OKF_HOME ?? path.join(os.homedir(), '.claude', 'okf');
  if (!fs.existsSync(home)) throw new Error(`no bundle at ${home}`);

  const cfg = readConfig(home);
  // **읽기 전용.** buildInjectedIndex는 파일을 쓰지 않는다. index.md를 재생성하지도 않는다 —
  // 번들은 배치가 관리한다(게이트 규칙 3).
  const stats = {};
  buildInjectedIndex(home, cfg.inject_max_lines, cfg.inject_max_bytes, stats);
  const takenByDir = Object.fromEntries((stats.cats ?? []).map((c) => [c.dir, c.taken]));

  const categories = [];
  const allHist = emptyHistogram();
  const takenHist = emptyHistogram();
  let totalConcepts = 0;
  let totalTaken = 0;

  for (const dir of discoverConceptDirs(home)) {
    const lines = collectConceptLines(home, dir);
    const titles = lines.map((l) => TITLE_RE.exec(l)?.[1] ?? '');
    const classes = titles.map((t) => (t ? classify(t.toLowerCase()) : 'other'));
    const taken = takenByDir[dir] ?? 0;

    const hist = emptyHistogram();
    const tHist = emptyHistogram();
    classes.forEach((c, i) => {
      hist[c] += 1;
      allHist[c] += 1;
      if (i < taken) { tHist[c] += 1; takenHist[c] += 1; }
    });

    // ASCII로 시작하는 title은 한글보다 **항상** 앞선다. 그 구조적 이점의 크기를 카테고리마다 잰다.
    const asciiLeading = classes.filter((c) => c.startsWith('ascii')).length;
    const firstNonAsciiRank = classes.findIndex((c) => !c.startsWith('ascii'));

    totalConcepts += lines.length;
    totalTaken += taken;
    categories.push({
      dir,
      concepts: lines.length,
      taken,
      firstCharClass: hist,
      firstCharClassAmongTaken: tHist,
      asciiLeadingConcepts: asciiLeading,
      asciiLeadingTakenSlots: classes.slice(0, taken).filter((c) => c.startsWith('ascii')).length,
      // 첫 번째 비-ASCII concept의 순위. **-1은 "비-ASCII title이 아예 없다"이지 "못 든다"가
      // 아니다** — 두 경우를 한 값으로 적으면 리포트가 거짓말을 한다. 그래서 도달 여부는
      // null(해당 없음)/true/false 세 값으로 따로 낸다.
      firstNonAsciiLeadingRank: firstNonAsciiRank,
      hasNonAsciiLeading: firstNonAsciiRank >= 0,
      nonAsciiReachesGate: firstNonAsciiRank < 0 ? null : firstNonAsciiRank < taken,
      // 이 카테고리에서 게이트가 후보의 몇 %를 싣는가. 정렬 편향이 물리는 정도를 **매개**하는 값이다:
      // 적재율이 1.0이면 정렬은 아무것도 정하지 않는다(다 실리니까).
      loadRate: lines.length ? taken / lines.length : null,
      orderingViolationsVsCodeUnitSort: orderingViolations(titles),
      titlesParsed: titles.filter(Boolean).length,
    });
  }

  // 리프트 = P(분류 | 실린 줄) / P(분류 | 전체). 1보다 크면 그 분류가 게이트 슬롯을
  // 자기 몫보다 많이 가져간다는 뜻이다.
  const lift = {};
  for (const n of CLASS_NAMES) {
    const base = totalConcepts ? allHist[n] / totalConcepts : 0;
    const got = totalTaken ? takenHist[n] / totalTaken : 0;
    lift[n] = base > 0 ? got / base : null;
  }

  const asciiAll = CLASS_NAMES.filter((n) => n.startsWith('ascii')).reduce((s, n) => s + allHist[n], 0);
  const asciiTaken = CLASS_NAMES.filter((n) => n.startsWith('ascii')).reduce((s, n) => s + takenHist[n], 0);

  const out = {
    meta: {
      measuredAt: new Date().toISOString(),
      // 번들 경로 자체는 사적 정보가 아니지만, 산출물이 저장소에 커밋되므로 **다이제스트만** 남긴다.
      homeDigest: crypto.createHash('sha256').update(home).digest('hex').slice(0, 16),
      config: { inject_max_bytes: cfg.inject_max_bytes, inject_max_lines: cfg.inject_max_lines },
      privacy: 'title·설명·파일명·링크는 산출물에 포함되지 않는다. 첫 글자의 유니코드 분류 개수만 나간다. raw/·_remove_candidate/는 discoverConceptDirs가 배제하므로 열리지 않는다.',
      reproducibility: '이 측정은 개인 번들에 의존하므로 제3자가 재현할 수 없다. 재현 가능한 것은 절차뿐이다.',
      sortModel: 'lib/index-gen.mjs:242-246 renderSections — 섹션 heading은 대소문자 구분 오름차순, 섹션 안은 title.toLowerCase()를 `<`/`>`로 비교(UTF-16 코드유닛 순서, 로케일 정렬 아님). 따라서 ASCII 선두 title(≤U+007A)은 한글 선두(U+AC00~)보다 항상 앞선다.',
    },
    totals: {
      concepts: totalConcepts,
      takenByGate: totalTaken,
      firstCharClass: allHist,
      firstCharClassAmongTaken: takenHist,
      lift,
      asciiLeadingConcepts: asciiAll,
      asciiLeadingTakenSlots: asciiTaken,
      asciiShareOfConcepts: totalConcepts ? asciiAll / totalConcepts : null,
      asciiShareOfTakenSlots: totalTaken ? asciiTaken / totalTaken : null,
      // **정렬 편향의 크기를 매개하는 값.** 적재율이 1.0이면 정렬은 무엇도 정하지 않는다 —
      // 다 실리기 때문이다. 실사용 리프트가 작게 나온다면 그건 "정렬이 무해하다"가 아니라
      // "지금 번들이 작아서 아직 물리지 않았다"일 수 있고, 두 해석은 이 값으로 갈린다.
      loadRate: totalConcepts ? totalTaken / totalConcepts : null,
    },
    categories,
  };

  const outPath = args.outPath ?? path.join(PLUGIN_ROOT, 'docs', 'benchmarks', 'raw', `title-distribution-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);

  console.log(`concepts ${totalConcepts}, gate loads ${totalTaken} (적재율 ${(100 * out.totals.loadRate).toFixed(1)}%)`);
  console.log(`ASCII 선두: concept의 ${(100 * out.totals.asciiShareOfConcepts).toFixed(1)}% → 실린 슬롯의 ${(100 * out.totals.asciiShareOfTakenSlots).toFixed(1)}%  (리프트 ${(out.totals.asciiShareOfTakenSlots / out.totals.asciiShareOfConcepts).toFixed(2)}×)`);
  for (const c of categories) {
    const reach = c.hasNonAsciiLeading
      ? `첫 비-ASCII rank ${c.firstNonAsciiLeadingRank}${c.nonAsciiReachesGate ? '' : ' (게이트 도달 못 함)'}`
      : '비-ASCII 선두 없음';
    console.log(`  ${c.dir.padEnd(16)} ${String(c.taken).padStart(2)}/${String(c.concepts).padStart(3)} 실림  ASCII선두 concept ${c.asciiLeadingConcepts} 중 슬롯 ${c.asciiLeadingTakenSlots}  ${reach}  정렬위반 ${c.orderingViolationsVsCodeUnitSort}`);
  }
  console.log(`out: ${outPath}`);
}

main();
