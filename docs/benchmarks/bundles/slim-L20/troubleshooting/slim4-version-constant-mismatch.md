---
type: troubleshooting
title: Slim App::VERSION 상수가 CHANGELOG.md 최신 항목보다 뒤처져 있었다
description: 어느 체크아웃 시점에 Slim/App.php:46의 VERSION 상수는 "4.15.1"인데 CHANGELOG.md 최신 항목은 "4.15.2"(2026-05-22)로 이미 릴리스 기록이 앞서 있었다 — 릴리스 시 코드 상수를 갱신하지 않아서다. composer.json에는 버전 필드가 없어 git 태그로만 버전을 관리한다.
tags: [slim, php, release]
timestamp: 2026-07-16
---
## 증상

릴리스 자동화를 만들려고 버전 번호가 코드 안 어디에 있는지 대조하다가 불일치를 발견했다.

## 원인

- `Slim/App.php:46`의 `VERSION` 상수: `4.15.1`
- `CHANGELOG.md` 최신 항목: `4.15.2` (2026-05-22)
- `composer.json`에는 버전 필드가 없음 — git 태그로만 관리됨

릴리스 시 CHANGELOG는 갱신했지만 코드 상수는 갱신하지 않아 어긋난 것으로 보인다.

## 해결/권장

- `Slim/App.php`의 `VERSION`을 CHANGELOG와 일치하도록 갱신
- 버전은 단일 출처(source of truth)에서만 관리하고, 빌드/릴리스 스크립트가 다른 위치에
  자동 동기화하도록 만들 것을 권장 (아직 자동화는 구현 전, 조사 단계)
