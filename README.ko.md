# OKF for Claude Code

**지난 Claude Code 세션의 결정을 로컬의 검토 가능한 지식 번들로 만들고, 다음 세션이 실제로 찾아 쓰게 합니다.**

![MIT license](https://img.shields.io/badge/license-MIT-blue) ![OKF v0.2](https://img.shields.io/badge/OKF-v0.2-4ecdc4) ![Node only](https://img.shields.io/badge/runtime-Node%20only-5c6bc0) ![no npm install](https://img.shields.io/badge/dependencies-vendored-66bb6a)

[English](README.md) · **한국어** · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português](README.pt-BR.md)

OKF는 끝난 세션을 캡처하고, 재사용할 결정과 장애 해결법을 일반 Markdown으로 추출한 뒤, 다음 세션에 작은 인덱스를 주입합니다. 번들은 직접 열고 diff·백업·삭제할 수 있는 로컬 git 저장소입니다.

## 1분 빠른 시작

Claude Code 플러그인 지원, Node.js, git이 필요합니다. `npm install`은 없습니다.

```sh
claude plugin marketplace add dja1369/okf-system
claude plugin install okf@okf-marketplace
```

Claude Code를 다시 시작하고 평소처럼 세션을 끝낸 뒤 확인합니다.

```text
/okf:okf-status
/okf:okf-index
```

첫 `SessionStart`가 `~/.claude/okf`(또는 `$CLAUDE_CONFIG_DIR/okf`)를 만듭니다. 수집과 기회주의적 배치는 자동입니다 — 대화는 마지막 활동 후 약 1시간이 지나면 수집되므로, 세션을 명시적으로 끝낼 필요가 없습니다.

## 세션 연속성 흐름

```text
세션 1 결정        ~1시간 유휴            백그라운드 배치             세션 2
정책 확정     ->   sweep이 raw 수집  ->   재사용할 OKF Markdown  ->  작은 인덱스 주입
(명시적 종료       (무손실 복사,              |                          |
 불필요)            성장 시 재수집)           +-- 로컬 git 이력          +-- 관련 concept Read
```

예를 들어 “10% → 50% → 100% 배포, 오류율 0.5% 초과 시 원복”을 한 세션에서 정합니다. 수집과 ingest가 끝나면 다음 세션은 사용자가 정책을 다시 붙여넣지 않아도 인덱스에서 이 결정을 찾을 수 있습니다. 인덱스는 전체 기억이 아니라 탐색 경로이므로 Claude는 행동 전에 관련 concept 본문을 `Read`해야 합니다.

왜 유휴 기준인가: 세션은 명시적으로 끝나는 일이 드뭅니다 — 백그라운드 에이전트는 아예 끝내지 않고, `resume` 시점의 종료 스냅샷은 진행 중인 대화를 “처리됨”으로 못박아 이후 내용을 전부 잃게 했습니다. 그래서 sweep은 `sweep_min_idle_minutes`(기본 60분) 동안 조용해진 transcript만 수집하고, 배치 프로세스는 대기 중인 대화가 유휴에 도달할 때까지 남아서 기다리며(약 5분 간격 확인, 최대 8시간), 이미 수집된 세션은 **그 뒤에 더 커졌을 때만** 다시 수집하고, 변화 없는 세션은 절대 재수집하지 않습니다. 세션 훅은 배치를 깨우는 역할만 합니다.

## 명령

플러그인 명령에는 항상 `okf:` namespace가 필요합니다.

| 명령 | 용도 |
|---|---|
| `/okf:okf-status` | 마지막 배치, 대기 세션, 잠금 상태 |
| `/okf:okf-batch` | 잠금을 존중하며 즉시 ingest 실행 |
| `/okf:okf-config` | 검증된 설정 조회·편집 |
| `/okf:okf-index` | 카테고리, concept 제목, 최근 변경 조회 |
| `/okf:okf-visualize` | OKF concept와 concept 간 링크만 시각화 |
| `/okf:okf-analysis [경로]` | 저장소와 관련 있는 OKF concept만 함께 분석 |
| `/okf:okf-deprecate <대상>` | concept 은퇴 — 파일과 링크는 그대로 두고 게이트 주입에서만 뺀다 |

`visualize`는 “번들이 무엇을 아는가?”에 답하며 저장소를 스캔하지 않습니다. `analysis`는 “번들이 아는 내용을 기준으로 이 코드는 무엇인가?”에 답합니다. 없는 경로나 파일 경로는 거부하고, 분석 잘림·제외된 무관 concept·언어별 파일/선언/internal edge 수를 표시합니다.

두 명령의 HTML은 외부 CDN이나 실행 중 네트워크 요청이 없는 자체완결 파일입니다.

## 선택형 상태줄

`bin/statusline.mjs`는 네트워크나 전체 그래프 분석 없이 로컬 상태 한 줄을 출력합니다.

```text
OKF 12 · +3 · 2h ago
OKF 12 · batch running
OKF 12 · last: partial: 1/3 chunks
```

Claude Code의 `statusLine`은 하나뿐입니다. OKF는 이를 자동 설치하거나 덮어쓰지 않습니다. 기존 스크립트에서 `node /path/to/okf/bin/statusline.mjs` 출력을 결합하거나, 기존 상태줄이 없을 때만 직접 설정하세요.

## OKF 벤치마크

<!-- okf-benchmark: 2026-07-26-e3 -->

### 게이트 recall@cap — 사전등록 3회차, E1 → E3 (2026-07-26)

세 회차 모두 비용은 **$0.00**이고, 선언이 아니라 실행으로 증명한다. 하니스가 `PATH` 맨 앞에
스텁 `claude`를 깔고 그 스텁의 존재를 실측한 뒤, 스텁은 한 번도 실행되지 않는다
(`paidCallTrapInstalled: true`, `paidCallTrapTripped: false`).

재는 값은 `recall(N)`이다 — 번들에 concept가 N개 있을 때, 동결된 질문 20개 중 정답 concept의
줄이 게이트가 실제로 주입하는 index까지 살아남는 비율.

> **recall은 정답률이 아니다.** "게이트가 관련 줄을 실었는가"까지만 답한다. 모델이 그 줄을
> **썼는지**는 유료 호출 없이 확인할 수 없다. 합성 distractor는 **상한만** 주므로 실사용
> recall은 이보다 낮다.

**조건** — 3섭동 × 5레벨 × 20시드 = 300샘플, 28초. 정답 concept의 frontmatter **`title`** 앞에
4글자를 붙일 뿐 본문·파일명·경로는 바꾸지 않는다.

| N | `none` | `front` (`!!! `) **발행본** | `front` **인용 안전** | `back` (`힣힣 `) |
|---|---|---|---|---|
| 24 | 0.400 ± 0.000 | 1.000 ± 0.000 | **0.400** | 0.400 ± 0.000 |
| 50 | 0.277 ± 0.038 | 0.560 ± 0.064 | **0.400** | 0.182 ± 0.044 |
| 100 | 0.247 ± 0.034 | 0.523 ± 0.030 | **0.400** | 0.170 ± 0.025 |
| 200 | 0.250 ± 0.040 | 0.528 ± 0.030 | **0.400** | 0.175 ± 0.026 |
| 400 | 0.262 ± 0.039 | 0.533 ± 0.024 | **0.400** | 0.185 ± 0.024 |

셀당 n=20. E1은 `none`만 11B 작은 예산에서 돌려 0.400 / 0.277 / 0.245 / 0.248을 냈다 —
**다른 조건**이지 위 표보다 낫거나 못한 것이 아니다.

**발행본의 `front` 열은 오염돼 있고, 그것을 잡아낸 것은 그 열 자신의 가드다.** `!!!`는 YAML
태그 지시자다. 인용 없는 `title:`에 붙이면 frontmatter가 통째로 깨진다 — type이 사라지고, 링크
텍스트가 파일명으로 떨어지며, **description이 소실돼** 줄이 ~700B에서 ~30B로 붕괴한다.
**동결 질문 20개 중 14개가 인용 없는 title이다.** 즉 그 14개에서 이 실험은 정렬 위치가 아니라
파싱 실패를 쟀다 — 줄이 짧으면 같은 예산에 훨씬 많은 줄이 들어가고, N=24에서 관측된 `taken` 24와
줄 평균 263B가 정확히 그것이다. 인용 안전 접두로 다시 재면 `front`는 **0.400 평탄**으로 무너진다.
`none`과 `back`은 한 자리도 움직이지 않는데, 이는 수정이 중립임을 확인해 주는 동시에
`힣힣 `는 아무것도 깨뜨린 적이 없음을 보인다.

**살아남는 것과 무너지는 것.** 정렬이 생존을 정한다는 것은 그대로다. N=400에서 인용 안전 spread는
0.400 − 0.185 = **0.215**로 반증 임계 0.05의 **4.3배**이고, `back`이 recall을 0.262에서 0.185로
끌어내리는 것은 순수한 순서 효과다. **관련성 신호가 0건인 시스템에서 이것은 예상되는 결과이지
버그의 발견이 아니다** — 새로운 것은 그 크기다. 그러나 발행된 크기 셋은 살아남지 못한다.
"4글자로 recall이 두 배"는 2.03배 → **1.53배**, "N=24에서 0.400 → 1.000"은 **변화 없음**,
E1의 `cwdIndependent` 0.000 → 0.967은 **0.000 → 0.333**이 된다. 그 자리에 새 사실이 들어선다.
**정렬 앞으로 가면 recall이 N에 아예 의존하지 않는다**(번들 크기 17배 범위에서 0.400 평탄) —
그때 생존을 정하는 것은 N이 아니라 `taken`이기 때문이다.

**생존 조건은 정확히 `rank < taken`이다** — 카테고리 안 title 정렬 순위가 그 카테고리가 실제로
실은 줄 수보다 작을 때만 살아남는다. 그래서 recall은 rank·taken 두 벡터의 **완전한** 함수이고
근사 없이 분해된다. N=24→50에서는 rank 성분이 지배하고(−0.15 ~ −0.41), N≥100에서는 ~0으로
죽는다 — 바닥 효과다. 정답 rank 평균(26.9)이 `taken`(10.5)을 한참 넘어서면 filler를 더 깔아도
이미 밖에 있는 concept는 바뀌지 않는다. 함께 발행한 단서: 이 분해는 **인과가 아니라 회계**이며
성분값은 기준선에 의존한다.

**E3가 E2에 가한 정정 둘, 자기 자신에 가한 정정 하나.** E2는 recall이 N=100에서 400까지 "단조로
오른다"고 적고 그 원인을 E3에 넘겼다. 사전등록한 n=20에서는 그 상승이 **세워지지 않는다** —
12개 인접 쌍 중 `rising`이 0개다. E3의 초판 헤드라인은 그래서 상승이 "없다"고 적었는데,
**그것이 틀렸고** 적대적 검정력 검사가 잡아냈다. n=60에서는 3쌍이 `rising`이고(p 최저 0.00027),
그 셋 전부에서 `taken` 성분이 움직임의 100%를 가져가며 rank 성분은 정확히 0이다. 상승은
실재하지만 **실질적이지 않다**(중앙값 CI = [0.000, 0.000]). E3는 또한 "평탄"과 "작지만 일관된
움직임"을 뭉개던 E2의 `|Δ| ≤ 0.05` 규칙을 정확 부호검정 + 분포무관 중앙값 신뢰구간으로 갈아
방향과 크기를 두 값으로 나눠 낸다.

**옛 R3은 잡음에 발화하고 있었다.** 문언은 "단조 감소 위반 → **하니스 결함** → 전 결과 폐기"인데
구현은 불확실성 처리 없는 평균 비교였다. 그래서 ±0.005의 시드 잡음이 E1·E2 양쪽에서 발화를
일으켰고, 두 회차 모두 "발화했지만 아무것도 폐기하지 않는다"는 자기모순 상태로 발행됐다. E3는
임계를 완화하지 않고 탐지 대상을 원래 문언대로 되돌려 무결성을 직접 쟀다. 같은 300샘플에서
옛 R3은 발화하고 새 R3a는 발화하지 않는다.

**라이브 번들에서 정렬 편향은 아직 세울 수 없다.** 읽기 전용으로 재고 개수만 낸다 —
title·설명·파일명·링크는 측정 밖으로 나가지 않고 `raw/`는 열지 않는다. 정렬은
`title.toLowerCase()`를 `<`로 비교하므로 **로케일 정렬이 아니라 UTF-16 코드유닛 순서**이고,
ASCII 선두 title은 한글 선두보다 **항상** 앞선다. ASCII 선두가 번들의 65.4%이고 게이트 슬롯의
70.6%를 가져가지만, concept 26개로 층화 귀무모형에 대한 초기하 정확검정은 **p = 0.667**이다.
결과라고 할 수 없다. 작은 리프트를 "정렬은 무해하다"로 읽어서도 안 된다 — 게이트가 지금 후보의
**65.4%**를 싣고, 다 실리는 곳에서 정렬은 아무것도 정하지 않는다(6개 카테고리 중 2개가 자유도 0).
카테고리별로는 이미 갈린다: `decisions`·`projects` 1.000, `patterns` 0.500, `references` **0.429**.
초안은 적재율이 떨어지면 효과가 커진다고 적었으나 **벤치마크 자신의 데이터가 그것을 반증**해
그 주장은 철회했다.

**슬롯을 가져가는 것은 관련성이 아니라 순서와 줄 길이다.** 코드에서 확인된 요인이 다섯이다.
type 섹션 이름의 대소문자 구분 정렬이라 `# Subdirectories`가 `# reference`보다 항상 앞서고
(`lib/index-gen.mjs:242`) 그래서 중첩 concept가 카테고리 앞으로 끌려온다. 섹션 안에서는
frontmatter **`title`**의 사전순이며 파일명이 아니다 — 파일명은 파싱 실패 시의 fallback일 뿐이다
(`:315`). `status: deprecated`는 뒤로 밀린다(`:245`). 카테고리 순회는 디렉토리 이름 순이다
(`:227`). 그리고 **줄 바이트 길이** — 다음 줄이 남은 예산을 넘으면 그 카테고리는 거기서 멈춘다
(`lib/gate.mjs:122`). 게이트에는 cwd·최신성·질의에 대한 참조가 하나도 없다.

**수준이 아니라 모양이 발견이다.** 질문 20개 중 9개는 모든 레벨에서 0으로 살아남고 3개는 1.0으로
살아남으며, 나머지 8개가 그 사이에 있다 — recall은 이진이 아니다. 게이트는 예산이 마를 때까지
round-robin으로 채운다. 카테고리가 1~3줄로 끝나는 것은 한 줄이 크기 때문이다(줄당 200~1,030B,
index 예산 약 6,960B). 그래서 전체 적재가 8~11줄에서 소진된다. `references`는 모든 레벨에서
정확히 한 줄만 얻으므로, 거기 몰린 정답 8개 중 최대 하나만 살아남을 수 있다.

**중첩 깊이 (축 A-2).** concept 25개 고정, 내용 동일, 경로만 깊게:

| 조건 | 주입된 concept 줄 | 하위 도메인 링크 |
|---|---:|---:|
| 평평 | 28 | 0 |
| 2단계 | 27 | 0 |
| 3단계 | 26 | 0 |
| 4단계 | 25 | 0 |

조건마다 **한 번씩** 쟀고(n=1, 시드 반복 없음) 그 한 번의 측정에서 깊이 한 단계마다 한 줄씩
잃었다. 네 점으로는 이 감소가 선형인지 알 수 없고 4단계 너머는 재지 않았다. 심은 concept 기준으로
3단계는 25 → 23, **−8.0%**다. 원인은 사슬 순회 실패가 아니라 바이트 압력이다 — 경로 조각이
하나 늘 때마다 모든 줄이 길어져 결국 하나가 예산 밖으로 밀린다.

**R2는 모든 회차에서 발화한다**(`recall(24)` = 0.400 < 0.60). 사전등록한 처리 규칙에 따라
**recall 절대값은 아무것도 결정하지 않는다** — 표는 발행하되 정책을 움직이지 않는다.

**측정 규율, 그리고 나아진 지점.** E1에서는 픽스처가 **리포트** 커밋에서 처음 git에 들어왔다 —
임계는 미리 고정됐지만 숫자를 실제로 결정한 재료는 그렇지 않았다. E2부터 픽스처는 사전등록
커밋에 함께 들어가고 스모크가 `git log --diff-filter=A`로 **엄격** 부등호를 강제한다. E1 파일
세트로 겨누면 위반 3건이 나오므로, 이 단언은 실제 사고를 승인하는 대신 잡아낸다. 각 회차는
사전등록서를 쓰는 시점에 이미 알고 있던 값과 측정 뒤에 고친 산술을 함께 공개한다 — E3는
`0.25 − 0.20 = 0.04999…`인데 `0.20 − 0.15 = 0.05000…2`라 같은 크기의 문항 1개 이동이 등가한계의
반대편에 떨어지는 것을 보고 델타를 1/20 격자에 양자화했다. 그 수정은 이 회차의 유일한
`indeterminate` 판정을 없애 **리포트 자신의 논거에 불리했고**, 그 사실까지 공개했다. 이어서
적대적 검토가 생존 항등식 가드가 거의 항진명제임을 보였고(검사 대상 함수를 그대로 다시 불렀다),
비순환 대체 가드는 **첫 실행에서 발화해** 위의 `front` 오염을 찾아냈다. 추정으로 메우지 않고
안고 가는 결함이 하나 있다: 같은 가드가 섭동 없는 샘플 100개 중 8개에서도 발화하는데 원인은
아직 특정하지 못했다.

```sh
node test/gate-recall.mjs --e3 --perturb all   # 3조건 × 5레벨 × 20시드, 약 28초
node test/gate-recall.mjs --e3 --perturb all --quote-safe-perturb   # 정정된 접두
node test/gate-title-distribution.mjs          # 라이브 번들 title 분포 (읽기 전용)
node test/gate-recall.mjs --e2 --perturb all   # E2
node test/gate-recall.mjs                      # E1
node test/bench-nesting.mjs                    # 중첩 깊이 축
node test/smoke.mjs                            # 회귀 가드
```

[E3 리포트](docs/benchmarks/gate-recall-2026-07-26-e3.md) ·
[E3 사전등록서](docs/benchmarks/pre-registration-2026-07-26-e3.md) ·
[E2 리포트](docs/benchmarks/gate-recall-2026-07-26-e2.md) ·
[E2 사전등록서](docs/benchmarks/pre-registration-2026-07-26-e2.md) ·
[E1 리포트](docs/benchmarks/gate-recall-2026-07-26-e1.md) ·
[E1 사전등록서](docs/benchmarks/pre-registration-2026-07-26-e1.md)

<!-- okf-benchmark: 2026-07-27-efficiency -->

### 게이트 효율 — 인덱스 형식은 자기 바이트값을 하는가 (축 E, 2026-07-27)

E1~E3는 전부 OKF 자신의 입력만 흔들었다. 그래서 "이 형식이 값을 하는가"는 물을 수 없었다 —
비교 대상이 없었기 때문이다. 축 E가 그것을 세운다: **같은 번들, 같은 바이트 예산, 인덱스
전략만 6종으로 갈아끼운다.** 비용은 **$0.00**이고, 이번에도 선언이 아니라 PATH 트랩으로 증명한다.

질문은 더 이상 손으로 쓰지 않는다. 정답 concept 20개마다 그 **본문**의 tf-idf 상위 8항으로
쿼리를 기계 생성했다 — 본문은 인덱스가 절대 싣지 않는 부분이다. 검색기는 표준 파라미터를 측정
전에 고정한 BM25이고, 그 길이 정규화는 긴 줄에 벌점을 준다. 즉 이 선택은 OKF에 **불리한** 쪽이다.
시드 수 40은 앞 회차에서 승계한 것이 아니라 실행 전 검정력 계산으로 정했다.

**사전등록한 가설 5개 중 2개가 지지되고 3개가 반증됐다.**

| 가설 | 판정 | 근거 |
|---|---|---|
| 제목+설명이 카테고리 링크만보다 낫다 | **지지** | 12/12 셀에서 okf 우세, 전부 p<1e-4 |
| 설명은 자기 바이트값을 한다 | **반증** | 순서를 맞추면 설명을 뗀 쪽이 12/12 셀에서 우세 |
| round-robin이 오버헤드값을 한다 | **조건부 반증** | 예산 2048에서 −0.050, 예산 9000에서 +0.017~+0.218 |
| 정렬된 인덱스가 무작위보다 낫다 | 좁게 지지 | okf 7/12 우세 — 다만 N=26 세 셀은 전부 패배 |
| 경로만으로는 부족하다 | **반증** | 경로만 싣는 쪽이 8/12 셀에서 우세 |

첫 줄은 한 번도 측정된 적 없던 것을 닫는다. 라이브 번들의 아키텍처 문서는 2026-07-17에
"카테고리 개수만" → "제목+설명"으로 바꾼 근거를 **사례 1건**으로 적고 비용을 **n=3**으로
적어뒀다. 이제 수치가 생겼다.

**이 형식은 정밀도를 사고 용량을 판다.** OKF 줄은 일단 실리면 거의 반드시 1위로 뽑힌다
(정밀도 0.93~1.00). 병목은 기본 예산 9,000바이트에 concept 줄이 12~14개밖에 안 들어간다는
것이다. 제목만 싣는 형식은 N=26에서 26개를 전부 싣고(정밀도 0.649), 경로만 싣는 형식도 26개를
전부 싣는다(정밀도 0.350). **설명이 줄 바이트의 약 82%다** — 줄당 733 B, 설명을 떼면 133 B.

**round-robin의 부호는 예산에 따라 뒤집힌다.** 카테고리 6개가 각각 heading과 생략 마커를
선차감하므로, 예산 2048에서는 그 고정비가 네 레벨 전부에서 이득을 잡아먹는다(−0.050). 출하
기본값 9,000에서는 값을 하고, 그 이득은 번들이 클수록 커진다(N=200에서 +0.218).
**출하 기본값은 자기 운영점에서 옳다** — 그리고 코드는 예산과 무관하게 항상 round-robin을 쓴다.

> **이것은 "설명을 떼라"는 말이 아니다.** 이 회차는 **찾기**를 쟀고 **답하기**를 재지 않았다.
> 게이트 규칙 1은 "제목·설명이 답을 담고 있으면 Read 없이 그 줄을 근거로 쓰라"고 약속하는데,
> 설명을 떼면 그 경로가 통째로 죽는다. 설명이 그 82%를 되갚는지는 **유료 축이고 한 번도 돌린
> 적이 없다.** 이 회차가 낸 것은 가격표이지 판결이 아니다.

**라이브 번들, 읽기 전용, 개수·바이트만.** concept 26개 / 108,431 B. 게이트는 **8,885 B —
예산의 98.7% — 를 써서 26개 중 14개(53.8%)를 보여준다.** 압축비는 12.2×이고, 주입 바이트의
71.6%가 지식, 28.4%가 구조다. 그 구조 중 `log.md` tail 하나가 1,341 B로 주입의 15.1%이며
heading과 생략 마커를 합친 것의 2.6배다. 합성 번들은 이 53.8% 커버리지를 **2.3%p 이내**로
예측했다 — 합성 설계에 대한 외부 확인이다.

**이 회차는 발행 전에 자기 결함을 하나 잡았다.** 첫 등록 실행에서 경로만 싣는 전략의 도달률이
12셀 전부 0.000이었다. 그대로 읽으면 발견이지만 실은 버그였다 — 채점기가 마크다운 링크 문법에서만
경로를 뽑고 있었다. 고치자 그 가설이 지지에서 반증으로 뒤집혔다. 새로 넣은 스모크 단언 9개는
각각 돌연변이 검사를 거쳤고, 돌연변이 6종이 전부 자기 가드를 죽였다.

**재지 못한 것, 그대로 발행한다**: BM25는 어휘 중첩이지 모델의 판단이 아니다. 번들은 합성이라
이 값은 상한이다. 정답 concept 목록은 여전히 내가 고른 것이다(기계 생성된 것은 쿼리뿐). `paths`
성적은 이 번들이 한국어 본문 + 영문 slug이라는 사실에 의존한다. n=40은 시드 80%에 일관된 효과를
0.981로 잡지만 70%면 0.703이라, 여기서 "차이 없음"은 "세우지 못했다"는 뜻이다. 라이브 표본은
저자 한 명의 번들 하나다. 토큰 수는 오프라인 토크나이저가 없어 재지 않았다. 그리고 독립적인
적대적 렌즈는 돌지 않았다 — 검증은 자기검증이다.

```sh
node test/gate-efficiency.mjs                    # 4 레벨 × 3 예산 × 40 시드, 약 30초
node test/gate-efficiency.mjs --determinism-check
node test/gate-live-efficiency.mjs               # 라이브 번들, 읽기 전용
```

[축 E 리포트](docs/benchmarks/gate-efficiency-2026-07-27.md) ·
[축 E 사전등록](docs/benchmarks/pre-registration-2026-07-27-efficiency.md)

### 전 구간 유료 실행 (v3, 2026-07-16)

<!-- okf-benchmark: 2026-07-16-v3 -->

**OKF는 코드가 답할 수 있는 거의 모든 것에 대해 오버헤드이고, 코드가 아예 답을 내놓지 못하는 영역에서도 평범한 CLAUDE.md가 OKF를 이깁니다 — OKF의 유일한 강점은 그 일을 더 싸게 해낸다는 것뿐입니다. 핵심 약속(축적된 지식이 시간이 지날수록 값어치를 한다)을 직접 시험한 결과, 반박되었습니다.**

이 문단의 모든 주장을 아래에서, 실제 오픈소스 저장소에 대고, 비교 셀마다 n=15로 측정했습니다.
그중 OKF에 불리한 부분을 먼저 공개합니다.

### 측정 방법

고정(pinned)된 공개 저장소 두 개 — 합성 fixture가 아니므로 탐색에는 탐색이 실제로 치르는 비용이
그대로 들고, 기억 없는 baseline이 진짜로 이길 수 있습니다:

| 역할 | 저장소 | 커밋 |
|---|---|---|
| 코드베이스 | [slimphp/Slim](https://github.com/slimphp/Slim) | `80900fb3` (PHP 파일 125개) |
| 문서 더미 | [rust-lang/rfcs](https://github.com/rust-lang/rfcs) | `f635361c` (Markdown 파일 651개) |

모든 번들의 모든 concept은 실제 파이프라인이 만들었습니다 — 고정된 저장소를 탐색하는 실제
`claude -p` 세션, 실제 Claude Code 트랜스크립트, 실제 batch ingest, 실제 gate. **손으로 쓴
concept은 하나도 없습니다.** 번들은 이 저장소에 커밋되어 있으므로
([docs/benchmarks/bundles/](docs/benchmarks/bundles/)), 아래 모든 숫자가 딛고 선 정확한 gate 텍스트와
concept 본문을 직접 읽을 수 있고, v2가 반박된 방식 그대로 — 저자를 믿지 않고 저장소에서 — 이번
실행도 반박할 수 있습니다.

조건 5개. 모두 동일한 도구(`Read`, `Glob`, `Grep`, `Bash(git log/show/diff/blame/grep)`)와, 조건에
중립적인 동일한 지시문을 받습니다 — 어떤 조건에도 gate를 참고하라고 말하지 않습니다. gate는 프롬프트
앞에 붙이는 것이 아니라 **실제 `SessionStart` 훅**(`additionalContext`)으로 전달하며, 전달된 바이트를
실행마다 검증합니다.

- **zero-base** — 아무것도 없음. OKF가 대체한다고 주장하는 대상입니다.
- **answer key(정답지)** — 정답을 그대로 붙여 넣습니다. 그 문자열을 만들려면 이미 답을 알고 있어야
  하므로 어떤 사용자도 이 조건을 점유할 수 없습니다. 경쟁자가 아니라 하한선입니다.
- **OKF** — 실제 gate 텍스트.
- **wrong knowledge(무관한 지식)** — *다른* 저장소에 대한 실제 concept으로 크기를 맞춘 gate.
  "지식이 도왔다"와 "gate가 도왔다"를 분리합니다.
- **CLAUDE.md** — 똑같이 축적된 지식을 평평한 파일 하나에 붙여 넣은 것. 진짜 기존 강자입니다.

`total_cost_usd`가 헤드라인이고, sonnet 전용 비용을 총비용 옆에 함께 공개합니다. 그러면 CLI가 내부
작업용으로 해석해 쓰는 `claude-haiku`(지출의 2.3%)를 빼낼 수 있어 결론을 숨길 수 없습니다. 효율은
정답을 맞힌 실행끼리만 비교합니다. 각 답은 **atom** 단위로 채점합니다 — ground truth를 독립적으로
확인 가능한 사실들로 쪼개 측정 전에 동결했습니다 — 그리고 v2식 이진 점수(모든 atom 정답)를 그 옆에
함께 공개합니다. 실행마다 nonce를 넣어 prompt caching을 무력화합니다. **어떤 숫자도 시나리오 간에
평균 내지 않습니다.**

설계, 예측, 반증 기준 R1–R5는 **첫 유료 호출 전에**
[사전 등록](docs/benchmarks/pre-registration-2026-07-16-v3.md)하고 커밋했습니다. 그 문서에는 이
벤치마크의 이전(v2) 공개가 냈던 거짓되거나 뒷받침되지 않는 진술 여섯 건과, 각각을 그 자체의 원본
데이터로부터 어떻게 잡아냈는지도 상세히 기록되어 있습니다.

### OKF가 지는 곳: 코드가 답할 수 있는 모든 것

답이 소스나 git 히스토리, 또는 번들에 있는 시나리오 5개. 각각 고정된 체크아웃에서 검증했습니다.
비용은 정답을 맞힌 실행의 중앙값이며, 그 편차를 함께 싣습니다.

| 시나리오 | zero-base | OKF | 판정 |
|---|---:|---:|---|
| `rfcs_cheap` — grep 한 번 | **$0.062** · 13/15 | $0.077 · 14/15 | OKF가 1.2배 비쌈 |
| `slim_cheap` — grep 한 번 | **$0.067** · 14/15 | $0.114 · 15/15 | OKF가 1.7배 비쌈 |
| `rfcs_buried` — 문서 651개 속에서 근거 찾기 | **$0.097** · 12/15 | $0.112 · 13/15 | OKF가 1.2배 비쌈 |
| `slim_buried` — 파일 다섯 개짜리 호출 체인 추적 | $0.277 · 13/15 · **tool 10회** | **$0.232** · 9/15 · **tool 8회** | OKF가 더 싸고 tool 더 적음 |
| `slim_stale` — 이후 커밋으로 번들 지식이 낡음 | critical **15/15** | critical **15/15** | 무승부 — 아래 참조 |

**싼 grep에서 OKF는 순수한 오버헤드입니다** — 같은 답에 1.2~1.7배 비쌉니다. gate는 `grep`에게는
필요 없는 고정 비용이기 때문입니다. OKF는 탐색이 진짜로 비쌀 때만 본전을 뽑습니다: `slim_buried`는
파일 다섯 개짜리 호출 체인을 추적하는데, 거기서 OKF는 더 싸고 tool call도 더 적습니다. 이것은 결함이
아니라 산수입니다 — grep 한 번이 질문에 답한다면 gate에 돈을 쓰지 마세요.

`slim_stale`은 atom 단위 채점이 값을 한 곳입니다. 번들은 이후 커밋으로 낡아 버린 주장을 담고
있었고, 이진 점수는 **모든 조건에서 0/15**로 읽힙니다 — 완전한 전멸처럼 보입니다. 아닙니다.
*critical* atom(질문이 실제로 묻는 것 — HTML 렌더러가 이스케이프하는지, 어떤 함수와 플래그로
하는지)은 **15/15**입니다: 모델은 코드를 읽고 핵심 사실을 올바르게 답했습니다. 놓친 atom은 질문이
한 번도 요구하지 않은 출처(이스케이프를 도입한 커밋 SHA)뿐입니다. 낡은 지식은 모델을 자신 있게
틀리게 만들지 **않았습니다** — 그러리라던 사전 등록 예측은 틀렸고, 이진 점수만으로는 그 사실이
가려졌을 것입니다.

### 탐색이 도울 수 없는 곳: 코드가 담고 있지 않은 지식

대화에서 정해졌고 저장소에는 한 번도 기록되지 않은 팀 정책. RFC 더미에는 함정까지 있습니다: MSRV
정책을 검색하면 문서들은 `N-2`를 제안하지만 — 팀의 실제 규칙은 다릅니다.

| 시나리오 | zero-base | OKF | 무관한 지식 | CLAUDE.md |
|---|---:|---:|---:|---:|
| `rfcs_policy` — 팀의 "thaw rule": 대기 기간, MSRV 주기, 예외 조항 둘 | **0/15** | **11/15** · $0.075 | — | 15/15 · $0.144 |

**zero-base는 15전 0승입니다.** 돈은 썼는데 아무것도 얻지 못했습니다. 답이 저장소에 없기
때문입니다 — 작업 트리, git 히스토리, 커밋 메시지, 문서, 설정을 뒤진 적대자가 적중 0건으로
확인했습니다. 함정도 zero-base를 잡지 못했습니다; 그저 답할 수 없었을 뿐입니다.

OKF는 **15개 중 11개**를 맞혔고, 같은 사실을 담은 CLAUDE.md의 대략 절반 비용으로 그렇게 했습니다.
이것이 탐색은 할 수 없고 저장된 결정은 할 수 있는 단 하나입니다. **CLAUDE.md도 답합니다**(15/15) —
OKF는 여기서 유일하지 않으며, 같은 기존 강자를 더 싸고 주입량이 제한된 형태로 구현한 것입니다. 이
시나리오의 `wrong knowledge` 대조군은 제외합니다: 측정 오염 버그(아래)가 그것이 답을 읽게 했으므로,
이번 실행에서 "gate 하나만으로는 도움이 안 된다"는 대조군 역할을 할 수 없습니다.

이것은 깨끗한 정책 시나리오 하나이지 셋이 아닙니다. 다른 둘(`slim_policy`, `slim_domain`)은
측정했다가 **제외**했습니다 — 아래 참조.

### 이번 실행이 말해 줄 수 없는 것

- **정책 시나리오 두 개는 오염으로 제외했습니다.** Claude Code는 디렉터리별 프로젝트
  메모리(`~/.claude/projects/<cwd>/memory/`)를 모든 세션에 자동 주입합니다. 지식을 구축하는 동안
  대상 저장소를 탐색하던 `claude -p` 세션이 팀 결정을 그 메모리에 저장했고, 측정이 같은 작업
  디렉터리에서 돌아간 탓에 그 메모리가 아무 지식도 없어야 할 **zero-base** 조건에까지 닿았습니다.
  `slim_domain`에서는 그 결과 zero-base가 코드 어디에도 없는 팀 결정을 15/15로 "답해" 버렸습니다.
  zero-base 실행이 프로젝트 메모리를 읽은 시나리오는 모두 공개에서 뺍니다(`slim_domain`,
  `slim_policy`); 하니스는 이제 측정 전에 그 메모리를 비우고, 보고서는 그런 시나리오를 기계적으로
  탐지해 제외합니다. 위의 깨끗한 시나리오들은 메모리 읽기가 0건이었습니다.
- **비교 조건은 n=15, 대조군은 n=5.** 작습니다. 분포가 완전히 분리될 때만 승리라고 말합니다.
- **저장소 두 개, 생태계 두 개(PHP + Markdown).** 규모나 언어 전반에 걸친 일반성은 주장하지
  않습니다. 세 번째 저장소를 설계했다가, 돈을 쓰기 전에 신뢰도 대비 비용을 이유로 접었습니다.
- **단일 질문 세션.** OKF의 고정 gate 비용은 실제 다중 질문 세션에 걸쳐 분산되지 않고 질문 하나당
  한 번씩 치러지므로, 이번 실행은 OKF를 *과소평가*합니다.
- **심판은 단일 LLM 계열**이며, 소스로 검증한 ground truth에 대고 atom 단위로 채점합니다.

반증 기준 **R1–R5는 모두 기계적으로 평가했고 어느 것도 발동하지 않았습니다**(오염된 셀을 제외한
뒤) — 이번 실행은 그 주장을 반박하지 않습니다. 이는 n=15에서의 강한 확증과 같지 않으며, 반박의
부재일 뿐입니다.

### 체인 후속 실험: 실제 누적은 도움이 되는가? (v4, 반증됨)

<!-- okf-benchmark-chain: 2026-07-16-v4 -->

별도의 사전 등록 실행이 OKF의 메커니즘을 직접 검증했습니다: `kubernetes/kubernetes`의
`pkg/scheduler`(v1.30.0, 178개 Go 파일)에 관한, 서로 관련되지만 다른 질문 4개를 이어 붙인
체인으로, 각 세션의 결론을 다음 세션이 시작되기 전에 **실제 batch**에 통과시키고, 이를 누적을
전혀 하지 않은 채 던진 같은 질문 4개와 비교합니다. 이것은 v3의 사전 등록이 "OKF에 유리하고
OKF를 돋보이게 하도록 조정할 수 있다"고 지적하며 실행을 거부했던 바로 그 형태입니다. v4는 이번에는
가드를 두고 그것을 실행했습니다: 질문 4개는 돈을 쓰기 전에 고정하고 소스로 검증했으며, 오염
가드는 **매** 세션 전에 Claude Code의 프로젝트 메모리를 비우고(한 번만이 아니라), 반증 기준은
측정 전에 고정했습니다 — [사전 등록](docs/benchmarks/pre-registration-2026-07-16-v4.md)을
보십시오.

실제 누적은 일어났습니다: gate byte는 스텝을 거치며 단조 증가했고(1835 → 2613 → 3675 → 4950,
n=15 체인), 실제로 측정된 batch 지출($25.81 총액)이 이를 뒷받침합니다. **핵심 예측 — 비용이
체인을 거치며 감소한다 — 은 반증되었습니다.** OKF의 비용은 질문 4개에 걸쳐 $0.231 → $0.216 →
$0.258 → **$0.447**로 움직였고, 기억 없는 대조군도 같은 방향으로 움직였습니다($0.255 → $0.256 →
$0.272 → $0.411). 가장 그럴듯한 설명은 네 번째 질문이 두 arm 모두에게 그저 더 어려웠다는
것입니다 — 이 질문은 메커니즘 두 개를 한꺼번에 묻습니다 — 누적이 도움이 되거나 해가 됐다는 것이
아닙니다. OKF의 atom 단위 정확도는 어느 스텝에서도 baseline을 넘지 못했고, 첫 질문과 마지막 질문
모두에서 baseline보다 낮았습니다. 이진(모든 atom 정답) 채점은 두 arm 모두 0/106이었습니다 — 이
질문 세트는 atom 단위 점수만이 그나마 쓸 만할 만큼 어렵습니다.
[전체 보고서](docs/benchmarks/okf-benchmark-chain-2026-07-16-v4.md).

### 로컬 오버헤드 (효과 결과가 아님)

2026-07-16 측정, macOS arm64, Node `v26.4.0`, 중앙값과 최소/최대.

| 로컬 작업 | 중앙값 | 범위 |
|---|---:|---:|
| SessionStart gate 프로세스 | 57.3 ms | 56.1–60.0 ms |
| SessionEnd batch 트리거 프로세스 | 40.1 ms | 39.3–40.8 ms |
| 상태줄 프로세스 | 35.8 ms | 34.6–36.3 ms |

`node test/bench.mjs [저장소]`로 재현합니다. 로컬 프로세스 비용일 뿐이며, 토큰이나 모델 지연에
대해서는 아무것도 증명하지 않습니다.

### 비용, 재현, 링크

측정한 440회 실행에 **$66.26**, 채점에 **$14.74**가 들었습니다; 지식과 번들 구축에 ~$3.2가 더
들었습니다. 이번 실행 총액 ≈ **$84**. 유료·인증 실행이며, 일부러 smoke 테스트와 CI에서
제외했습니다.

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-knowledge.mjs --target slim --dir <repo>   # 실제 세션 → 트랜스크립트
OKF_RUN_LIVE_BENCH=1 node test/bench-bundles.mjs --target slim --levels 20      # 실제 batch → 번들
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                                    # 측정
```

v4 체인 실행(120 세션, 스텝 사이에 실제 batch)에는 측정 **$31.95** + 채점 **$9.20** + 실제
ingest **$25.81** ≈ **$67**이 들었습니다:

```sh
OKF_RUN_LIVE_BENCH=1 OKF_BENCH_CHAINS=15 node test/bench-chain.mjs   # 체인 세션, 실제 batch, 측정
```

[전체 보고서](docs/benchmarks/okf-benchmark-2026-07-16-v3.md) ·
[체인 후속 보고서](docs/benchmarks/okf-benchmark-chain-2026-07-16-v4.md) ·
[raw JSON](docs/benchmarks/raw/) ·
[커밋된 번들](docs/benchmarks/bundles/) ·
[사전 등록](docs/benchmarks/pre-registration-2026-07-16-v3.md) ·
[체인 사전 등록](docs/benchmarks/pre-registration-2026-07-16-v4.md) ·
[사용 가이드](docs/USAGE.md).

## 언어 지원

fallback 분석기는 결정적이고 의존성이 없으며 보수적으로 연결합니다. “파일 발견”과 “구조 분석”을 구분해 `/okf:okf-analysis`에 표시합니다.

| 언어 | 내부 관계 | 선언 | 주요 한계 |
|---|---|---|---|
| JavaScript / TypeScript | 상대 import/export/require, NodeNext `.js` → TS | function, class | bare package는 외부 |
| Python | 절대/상대 dotted module | function, class | dynamic import 미지원 |
| Go | `go.mod` 기반 저장소 내부 package node | function, struct | 거짓 file-to-file edge를 만들지 않음 |
| Rust | `mod`, `use crate/self/super` | function, struct/enum/trait | macro 생성 구조 생략 |
| Java / Kotlin | 저장소에 선언된 package/class path | class/interface/enum, Kotlin function | reflection 생략 |
| Ruby | `require_relative` | class, method | gem은 외부 |
| PHP | namespace/use/alias/grouped use, require/include | class/interface/trait/enum/function | 동적 autoload/call target 생략 |
| C / C++ | quoted include, 명시 경로를 가진 유일한 local angle include | class/struct/enum/union/typedef/namespace/function definition | regex 기반, macro·복잡한 여러 줄 문법 누락 가능 |
| C# | 저장소가 선언한 namespace node | class/interface/struct/record/enum | 외부 namespace는 외부 |
| Swift | 명시적 상속·conformance·extension target | class/struct/enum/protocol/actor/extension/typealias/function | 이름 충돌 방지를 위해 중첩 cross-file target 생략 |

2,000개 파일 상한에 닿으면 `truncated`를 표시합니다. 512 KiB 초과 파일은 노드는 유지하되 미분석으로 표시합니다. vendor/generated 디렉터리를 보수적으로 제외하지만 특이한 레이아웃은 수동 해석이 필요할 수 있습니다.

## 실제 오픈소스 검증

고정 commit을 clone하고 대표 edge를 원본과 대조했습니다. 시간은 운영 안전성 단일 실행값이며 모델 속도 benchmark가 아닙니다.

| 저장소 | commit | 언어 파일 | 선언 | 내부 edge | 잘림 |
|---|---|---:|---:|---:|---:|
| [Slim](https://github.com/slimphp/Slim) | `80900fb` | 125 | 127 | 305 | 아니요 |
| [Redis](https://github.com/redis/redis) | `f76dff7` | 784 | 5,796 | 990 | 아니요 |
| [fmt](https://github.com/fmtlib/fmt) | `a79df45` | 46 | 283 | 121 | 아니요 |
| [Alamofire](https://github.com/Alamofire/Alamofire) | `903c53c` | 98 | 2,052 | 215 | 아니요 |

검증 중 Swift 표준 `Error`가 무관한 중첩 `Error`에 연결되는 문제와 C 표준 header가 vendored 호환 header에 연결되는 문제를 발견해 수정했습니다. 원본 행 대조와 남은 공백은 [검증 보고서](docs/benchmarks/oss-analysis-2026-07-15.md)에 있습니다.

## 데이터 흐름과 개인정보

- 유휴 sweep이 전체 transcript를 `raw/`에 복사하며 수집 중 파싱하거나 자르지 않습니다. 세션 훅은 배치를 깨울 뿐입니다.
- 배치는 상한이 있는 digest를 만들고 별도 `claude -p` 호출로 Anthropic에 전송합니다. 이것이 OKF가 추가하는 유일한 모델/API 전송입니다.
- 배치는 `--safe-mode`, 제한된 도구, stdin prompt, lint/rollback, Bash 없음으로 실행합니다.
- 분석기는 임시 워크스페이스의 지식 파일 사본에서 작업하며 `raw/`·`.okf/`·`.git`에 물리적으로 접근할 수 없습니다. 드라이버는 정규 `.md` 파일만 번들로 반영합니다(스크립트·심링크는 번들에 닿지 않음).
- raw와 처리 대기 transcript는 git-ignore되며 추출된 Markdown 지식만 로컬 commit합니다.
- plugin은 push나 remote 추가를 하지 않습니다. POSIX 디렉터리는 `0700`, raw/state/log 파일은 `0600`이며 Windows는 계정 ACL을 사용합니다.
- 영구 진단 로그에는 transcript, Claude stdout/stderr, credential, 전체 raw 경로를 남기지 않습니다.
- 라이브 benchmark fixture는 합성 데이터이며 개인정보와 credential이 없습니다.

## 설정

`~/.claude/okf/.okf/config.md`를 편집하거나 `/okf:okf-config`를 사용합니다. 알 수 없거나 잘못된 값은 무시하고 안전한 기본값을 씁니다.

| 키 | 기본값 | 의미 |
|---|---:|---|
| `enabled` | `true` | 수집·gate·배치 전체 스위치 |
| `batch_interval_hours` | `1` | 기회주의적 배치 최소 간격 |
| `batch_max_digest_kb` | `600` | 배치 전체 digest 예산 |
| `batch_max_sessions` | `50` | 폭주 방지 상한, 비용 제어는 byte 예산 |
| `batch_model` / `batch_effort` | `claude-sonnet-5` / `medium` | 배치 모델 설정, 빈 값은 CLI 기본값 |
| `capture_exclude_cwd` | `[]` | 수집 제외 glob — 세션 cwd에 대해 판정 |
| `sweep_min_idle_minutes` | `60` | 마지막 활동 후 이 시간이 지나야 완결된 대화로 보고 수집. `0`은 즉시 수집 |
| `batch_digest_cap_kb` | `150` | 세션별 LLM digest 상한, raw는 무손실 |
| `remove_candidate_ttl_days` | `30` | 처리된 raw 삭제 전 보존일 |
| `inject_max_lines` / `inject_max_bytes` | `120` / `9000` | Claude Code 10,000자 기준 아래 inline gate 상한 |
| `sweep_backfill_days` | `0` | 설치 시각 **이전**으로 며칠까지 소급 수집할지. `0`(기본)=설치 이후 대화만. 하드 7일 창이 여전히 상한이다. |
| `batch_max_usd_per_day` | `0` | 하루 LLM 지출 상한(USD). `0`=무제한(기본). 상한과 무관하게 비용은 항상 기록·표시된다. best-effort 가드이며 누계는 `.okf/last-batch.json`에 산다. |

## 제거

```sh
claude plugin uninstall okf
```

데이터는 `~/.claude/okf`에 남습니다. 검토·백업 후 원할 때 직접 삭제하세요.

## 개발 검증

```sh
node test/smoke.mjs
node test/bench.mjs
for file in $(rg --files -g '*.mjs'); do node --check "$file"; done
claude plugin validate .claude-plugin/plugin.json
claude plugin validate .claude-plugin/marketplace.json
git diff --check
```

라이브 benchmark는 별도 opt-in입니다: `OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs`.

## 참고와 라이선스

README 구조는 [uv](https://github.com/astral-sh/uv), [Ruff](https://github.com/astral-sh/ruff), [Playwright](https://github.com/microsoft/playwright), [fmt](https://github.com/fmtlib/fmt), [Slim](https://github.com/slimphp/Slim)의 짧은 설치·재현 구조를 참고했으며 문구나 benchmark 주장을 복사하지 않았습니다.

OKF 배경: [Open Knowledge Format specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md). 이 plugin은 [MIT](LICENSE) 라이선스입니다.
