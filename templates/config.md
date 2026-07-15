---
enabled: true
batch_interval_hours: 1
batch_max_sessions: 10          # 실행당 처리 raw 상한 (비용 상한)
batch_model: "claude-sonnet-5"  # 비우면 CLI 기본 모델
batch_effort: "medium"          # low/medium/high/xhigh/max, 비우면 CLI 기본값
capture_exclude_cwd: []         # glob. 해당 경로 세션은 캡처 skip (캡처 자체는 항상 무손실 — 크기/내용 캡 없음)
batch_digest_cap_kb: 150        # 배치 digest(LLM 입력용 임시 축약본) 파일당 상한 — raw 원본에는 미적용
remove_candidate_ttl_days: 30
inject_max_lines: 120           # 게이트 주입 줄 캡
inject_max_bytes: 16384         # 게이트 주입 바이트 캡 (줄 캡과 이중)
claude_bin: ""                  # 비면 PATH의 'claude'. GUI 런치 PATH 문제 시 절대경로
node_bin: ""
---
# OKF 설정

이 파일의 frontmatter만 읽힌다. 값을 바꾸고 저장하면 다음 세션/배치부터 반영된다.
