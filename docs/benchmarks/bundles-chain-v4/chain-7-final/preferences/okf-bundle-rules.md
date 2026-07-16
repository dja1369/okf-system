---
type: preference
title: Rules for writing knowledge into this bundle
description: The six taxonomy types, frontmatter format, and merge/link rules — standing rules that apply to both sessions and the batch
okf_seed: true
tags: [okf, rules, preference]
timestamp: 2026-07-16
---
# Who writes

The bundle is **maintained by the batch**. Sessions do not write to it as a rule — the
conversation is captured into `raw/` in full anyway, and the batch distills it later. The only
exception is when you explicitly ask for something to be recorded right now.

`index.md` is never written by hand, by anyone — a deterministic generator regenerates it in full.

# The six types (directory = type, 1:1)

The OKF spec itself defines no fixed taxonomy (that's an explicit non-goal). These six are **this
bundle's choice**, matched to the kinds of question conversational knowledge actually answers.

| type | Directory | When it applies |
|---|---|---|
| project | /projects/ | Answers "what was project X again?" |
| decision | /decisions/ | A choice that costs something to reverse, with rationale and rejected alternatives |
| preference | /preferences/ | A user rule that outlives the session |
| pattern | /patterns/ | A workflow, mistake, or piece of feedback that has recurred at least twice |
| reference | /references/ | Researched knowledge whose source is an external document |
| troubleshooting | /troubleshooting/ | Symptom → cause → fix |

A type outside these six is **not rejected** — the spec forbids rejecting unknown types.
Reclassify it to the nearest fit; if that's not possible, leave it and the linter will only warn.

# Frontmatter

```yaml
---
type: decision            # Required. Must not be empty
title: Short, searchable
description: One line     # This drives search quality — it's what the index and gate expose
resource:                 # Omit the field entirely if not applicable
tags: [area, keyword]
timestamp: 2026-01-01     # ISO 8601
---
```

Recommended order: title → description → resource → tags → timestamp.

# How to write

- **If it overlaps an existing concept, edit that file — don't create a new one.** Grep for
  duplicates before writing
- A file's path is its concept ID — **never move or rename it**. To supersede content, write a
  new file and leave a "superseded by /..." line in the old one
- Link with bundle-root-absolute paths (`/decisions/foo.md`)
- On finding a contradiction, prefer the newer information and record the replacement and its
  reason in `log.md`
- `log.md` takes a `## YYYY-MM-DD` section at the top. If today's section already exists, add to
  it rather than creating a second one
- One concept per file. Split past 300 lines
- Don't write chatter that has no lasting value — writing nothing is the default
- **Never record credentials, tokens, or personal data**

# Why this is spelled out

The linter checks this structure on every batch and refuses the commit if anything is off
(fail-closed), so the bundle's HEAD is always OKF-conformant. A batch result that breaks the
rules is rolled back wholesale.

For the format's own rules see [/references/okf-format.md](/references/okf-format.md); for how
this system runs see [/references/okf-system-architecture.md](/references/okf-system-architecture.md).
