---
enabled: true
batch_interval_hours: 1
batch_max_sessions: 50          # 안전 천장 — 실제 비용 조절은 batch_max_digest_kb
batch_model: "claude-sonnet-5"  # 비우면 CLI 기본 모델
batch_effort: "medium"          # low/medium/high/xhigh/max, 비우면 CLI 기본값
batch_max_digest_kb: 600        # 실행당 digest 총량 예산(KB) — 실제 비용 상한. 초과분은 다음 회차로
seed_language: "en"             # 최초 부트스트랩 시드 concept 언어 (en, ko)
capture_exclude_cwd: []         # glob. 해당 cwd의 세션은 수집(sweep)에서 제외
sweep_min_idle_minutes: 60      # 마지막 활동 후 이 시간(분)이 지난 세션만 수집. 0=즉시(수동 flush용)
batch_digest_cap_kb: 150        # 배치 digest(LLM 입력용 임시 축약본) 파일당 상한 — raw 원본에는 미적용
remove_candidate_ttl_days: 30
inject_max_lines: 120           # 게이트 주입 줄 캡
inject_max_bytes: 9000          # 훅 10,000자 한도 안에 inline 유지하는 안전 바이트 캡
claude_bin: ""                  # 비면 PATH의 'claude'. GUI 런치 PATH 문제 시 절대경로
node_bin: ""
---
# OKF 설정

이 파일의 frontmatter만 읽힌다. 값을 바꾸고 저장하면 다음 세션/배치부터 반영된다.
