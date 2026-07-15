---
type: reference
title: OKF formalizes Karpathy's LLM-wiki pattern
description: Where this system's three layers (raw/wiki/schema) and three operations (ingest/query/lint) come from
resource: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
okf_seed: true
tags: [okf, background, reference]
timestamp: {{INSTALL_DATE}}
---
# Lineage

Andrej Karpathy published the "LLM wiki" gist on 2026-04-04. About ten weeks later Google Cloud
announced OKF, describing it as an explicit formalization of that pattern. This isn't inference —
it's what Google said:

> "Introducing the Open Knowledge Format (OKF), an open specification that **formalizes the
> LLM-wiki pattern** into a portable, interoperable format."
> — Google Cloud Tech

Spec §10 also lists "LLM 'wiki' repositories" first among adjacent patterns.

# The pattern

LLM-wiki has three layers and three operations:

| Layer | Nature |
|---|---|
| raw sources | Immutable. The original record. Never edited |
| wiki | Written by the LLM. Knowledge distilled from raw |
| schema | The rules governing how the wiki is written |

| Operation | What it does |
|---|---|
| ingest | Distills raw into the wiki |
| query | Finds and uses knowledge from the wiki |
| lint | Checks the wiki against the rules |

# How this system maps onto it

This plugin implements that structure directly:

| Karpathy | This system |
|---|---|
| raw sources | `raw/` — lossless full copies of session transcripts; only the batch moves them |
| wiki | The bundle's concept files — only the batch's `claude -p` writes; sessions only read |
| schema | `SCHEMA.md` + the batch ingest prompt |
| ingest | SessionEnd capture + batch compression |
| query | SessionStart gate injection + Read/Grep during sessions |
| lint | Structural linter (every batch, fail-closed) |

For how it actually runs, see
[/references/okf-system-architecture.md](/references/okf-system-architecture.md).

# Sources

- Karpathy's gist: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
- OKF spec: [/references/okf-format.md](/references/okf-format.md)
