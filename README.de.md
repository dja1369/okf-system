# OKF for Claude Code

**Macht Entscheidungen aus früheren Claude-Code-Sitzungen zu lokalem, prüfbarem Wissen, das spätere Sitzungen tatsächlich nutzen können.**

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [Français](README.fr.md) · **Deutsch** · [Português](README.pt-BR.md)

OKF erfasst die Unterhaltung beim Sitzungsende, extrahiert wiederverwendbare Entscheidungen und Fehlerlösungen als Markdown und injiziert in die nächste Sitzung einen kompakten Index. Das Bundle ist ein lokales git-Repository zum Lesen, Diffen, Sichern oder Löschen.

## Schnellstart in einer Minute

Benötigt werden Claude Code mit Plugin-Support, Node.js und git. Kein `npm install`.

```sh
claude plugin marketplace add dja1369/okf-system
claude plugin install okf@okf-marketplace
```

Claude Code neu starten, eine normale Sitzung beenden und prüfen:

```text
/okf:okf-status
/okf:okf-index
```

Der erste `SessionStart` erstellt `~/.claude/okf` (oder `$CLAUDE_CONFIG_DIR/okf`). Capture und opportunistischer Batch laufen danach automatisch.

## Kontinuitätsablauf

```text
Entscheidung in Sitzung 1 -> verlustfreie raw-Kopie bei SessionEnd -> Batch erzeugt OKF-Markdown -> Index in Sitzung 2 -> relevanten Concept lesen
```

Eine Regel wie „10 % → 50 % → 100 % ausrollen, über 0,5 % Fehlern zurückrollen“ kann so ohne erneute Eingabe gefunden werden. Der Index routet nur; Claude muss vor einer Handlung das relevante Concept per `Read` öffnen.

## Befehle

| Befehl | Zweck |
|---|---|
| `/okf:okf-status` | Letzter Capture/Batch, wartende Sitzungen und Lock |
| `/okf:okf-batch` | Sofortiger Ingest unter Beachtung des Locks |
| `/okf:okf-config` | Validierte Konfiguration anzeigen/bearbeiten |
| `/okf:okf-index` | Kategorien, Concept-Titel und letzte Änderungen |
| `/okf:okf-visualize` | Nur OKF-Concepts und Beziehungen untereinander |
| `/okf:okf-analysis [Pfad]` | Repository plus ausschließlich relevante OKF-Concepts |

`visualize` scannt kein Repository. `analysis` lehnt fehlende/Nicht-Verzeichnis-Pfade ab und meldet Truncation, ausgeblendete irrelevante Concepts sowie Statistiken je Sprache. Beide erzeugen eigenständiges HTML ohne CDN oder Laufzeit-Netzwerk.

## Optionale Statusline

`bin/statusline.mjs` gibt ohne Netzwerk oder Graphanalyse eine Zeile wie `OKF 12 · +3 · 2h ago` aus. Claude Code erlaubt nur eine `statusLine`; OKF installiert oder überschreibt sie nicht. Die Ausgabe von `node /path/to/okf/bin/statusline.mjs` kann an ein bestehendes Skript angehängt werden.

## Benchmark der OKF-Wirkung

<!-- okf-live-benchmark: valid-2026-07-15T16-06-28Z -->

**OKF spart keine Tokens. Es stellt wieder her, was eine frische Sitzung bereits verloren hat.**

Abgefragt werden acht Fakten einer früheren Sitzung — Architektur (SQLite / repository pattern), Coding-Regel (named export only), Incident-Fix (`busy_timeout=5000`), Antwortpräferenz (Koreanisch / knapp), Datei- und Deploy-Policy (`src/config.mjs` / `npm run deploy:canary`) — plus eine Kontrollfrage ohne Gedächtnisbezug (7 × 8 = 56).

- **A — no memory.** Status quo: frische Sitzung, nichts wiederholt.
- **B_oracle — Lösungsschlüssel.** Fügt exakt die 8 erwarteten Werte ein; wer den String schreibt, kennt bereits jeden Fakt, den OKF wiederherstellen soll. **Kein Nutzer kann diese Bedingung einnehmen** — Obergrenze, keine Baseline, menschliche Arbeit mit null bepreist.
- **B_realistic — was Menschen tatsächlich tun.** Wiederholt alles möglicherweise Relevante, weil man vorher nicht weiß, was die nächste Sitzung braucht (CLAUDE.md-Gewohnheit). Der reale Vergleich.
- **C — OKF enabled.**
- **D — irrelevant OKF.** Gate ohne relevanten Inhalt, trennt „das Gate half“ von „ein Gate kostet etwas“.

Live-Lauf am 2026-07-15: Claude Code `2.1.210`, `sonnet`/medium (Sonnet 5 + Haiku 4.5), macOS arm64, Node `v26.4.0`, fünf Läufe je Bedingung in gekreuzter Reihenfolge. Cs Bundle entsteht aus echtem SessionEnd-Capture → isoliertem Batch-Ingest → SessionStart-Gate; Preflight: C 8/8 vorhanden und 8/8 gate-geroutet, D 0/8.

| Bedingung | Kontinuität | token activity p50 | wall p50 | Kosten p50 | Reads | Turns |
|---|---:|---:|---:|---:|---:|---:|
| A — no memory | **0/5** | 27,246 | 13.82 s | $0.022218 | 2 | 4 |
| B_oracle (Lösungsschlüssel) | 5/5 | 9,069 | 4.86 s | $0.008410 | 0 | 1 |
| B_realistic | 5/5 | 9,069 | 5.96 s | $0.008410 | 0 | 1 |
| **C — OKF enabled** | **5/5** | **10,395** | 6.46 s | $0.011329 | **0** | **1** |
| D — irrelevant OKF | 0/5 | 20,602 | 14.50 s | $0.025879 | 1 | 2 |

**Zuerst Zeile A lesen.** Ohne Gedächtnis verbrennt die Sitzung 27,246 Tokens, liest zwei Dateien, braucht vier Turns — und liefert trotzdem **0/8**. Genau das ersetzt OKF, und C schlägt es: 2.6× weniger Tokens, 8/8, in einem Turn ohne Reads.

**C schlägt B nicht und wird es nie** — B hat die Antworten schon im Prompt. Bei dieser Bundle-Größe ist B_realistic gleich B_oracle (beide 9,069); C kostet 1,326 Tokens und $0.0029 je Sitzung mehr. Der Bundle-Aufbau kostete **133,364** token activity und **$0.176758**. **Einen Token- oder Kosten-Break-even gibt es nicht**; `perSessionTokenSaving` ist negativ, daher meldet die Harness `null`, statt einen zu erfinden.

Geändert hat sich das Gate: C kostete zuvor **22,857** Tokens über 7 Turns mit 5 Reads, jetzt 10,395 in 1 Turn mit 0 Reads bei identischer 5/5-Recall. 91 % des alten Overheads war ein verordneter `Read`-Round-Trip, der Fakten erneut holte, die der Index längst geliefert hatte.

### Die Akkumulationsgrenze — gemessen, nicht projiziert

„OKF wird billiger, je mehr Wissen sich ansammelt“ hält der Messung nicht stand. Mit 50 unbeteiligten Filler-Concepts **scheitert der Preflight**: 8/8 Fakten vorhanden, aber nur 6/8 gate-geroutet — die Filler sortierten sich alphabetisch vor `decisions/tech-stack.md`, das damit aus dem injizierten Index fiel. Der Index ist hart gedeckelt (10,000-Zeichen-Grenze für Hooks):

| Concepts im Bundle | Im Gate-Index gezeigt |
|---:|---:|
| 20 | 20 |
| 40 | 40 |
| **55** | **43** (gekürzt) |
| 100 | 43 (gekürzt) |

**Ab ca. 43 Concepts kürzt der Index**, und was überlebt, entscheidet der Dateiname — nicht Relevanz, nicht Aktualität. Gekürzte Kategorien verweisen auf ihre `index.md`, der Rest bleibt per Abstieg erreichbar; Abstieg ist aber ein Tool-Round-Trip — exakt die Kosten, die der Fix gerade entfernt hat. Mit Skalierung wird OKFs Ökonomie also *schlechter*, nicht besser.

Gemessen werden Erfolg, Einhaltung, falsche Annahmen, Rückfragen, Tool Calls, erste gültige Antwort, API/Wall-Zeit, `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` und CLI-Kosten; Tokenkategorien bleiben im Raw-JSON getrennt. `tokenActivity` addiert Cache-Reads 1:1 mit Output-Tokens, obwohl sie ~50× günstiger abrechnen — **belastbar ist die Kostenspalte**. p95 entfällt: bei n=5 ist er arithmetisch immer das Maximum, also der Cold Run. User-only/Gate-only-Tokens bleiben ohne Schätzung `null`.

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                      # wie oben veröffentlicht
OKF_RUN_LIVE_BENCH=1 OKF_BENCH_FILLER=50 node test/bench-okf.mjs  # Akkumulationsachse
```

Bezahlter Opt-in-Lauf außerhalb von CI. Siehe [gültigen Bericht](docs/benchmarks/okf-live-2026-07-15T16-06-28-592Z.md), [Raw JSON](docs/benchmarks/raw/okf-live-2026-07-15T16-06-28-592Z.json) und [docs/USAGE.md](docs/USAGE.md). Der frühere Lauf vor dem Fix bleibt als Audit-Trail erhalten.

### Lokaler Overhead — nicht das Wirksamkeitsergebnis

Frische Messung vom 2026-07-15, macOS arm64, Node `v26.4.0`:

| Operation | Median | Bereich |
|---|---:|---:|
| SessionStart-Gate-Prozess | 57.4 ms | 56.7–58.2 ms |
| SessionEnd-Capture-Prozess | 43.4 ms | 41.8–43.9 ms |
| Statusline-Prozess | 36.7 ms | 34.8–36.8 ms |

Reproduzierbar mit `node test/bench.mjs [Repository]`. Dies misst lokalen Prozessaufwand, nicht Token- oder Modellverbesserungen.

### Batch-Kosten und Break-even

```text
initiale OKF-Kosten = Batch-Ingest + Repair + gemessener irrelevanter Gate-Overhead
Ersparnis je Sitzung = Median B_realistic - Median OKF
Break-even-Sitzungen = ceil(initiale Kosten / positive Ersparnis je Sitzung)
```

Verglichen wird gegen **B_realistic**, nicht gegen B_oracle: dessen String enthält die Antworten selbst und bepreist damit genau die Arbeit mit null, für die OKF existiert. Die gemessene Ersparnis ist negativ (−1,326 Tokens, −$0.0029); dieser Lauf hat keinen Token- oder Kosten-Break-even. Das ist das Ergebnis, keine Lücke der Harness.

## Sprachunterstützung

Der Fallback-Analyzer ist deterministisch, ohne Abhängigkeiten und konservativ; „Datei gefunden“ und „Struktur analysiert“ werden getrennt gemeldet.

| Sprache | Beziehungen und Deklarationen | Wichtige Grenzen |
|---|---|---|
| JS / TS | relative import/export/require, function/class | Bare Packages extern |
| Python | dotted modules, function/class | dynamische Imports ausgelassen |
| Go | interne Package-Nodes aus `go.mod`, function/struct | keine erfundenen File-Edges |
| Rust | `mod`/`use`, function/struct/enum/trait | Macro-Struktur ausgelassen |
| Java / Kotlin | Package/Class-Pfade, Types/Kotlin function | Reflection ausgelassen |
| Ruby | `require_relative`, class/method | Gems extern |
| PHP | namespace/use/alias/grouped use, require/include, Types/function | dynamischer Autoload ausgelassen |
| C / C++ | quoted include, eindeutiger lokaler Angle-Include mit explizitem Pfad, Types/namespace/function definition | Regex kann Macros/komplexe Mehrzeiler verpassen |
| C# | deklarierte Namespace-Nodes, Haupttypen | externe Namespaces bleiben extern |
| Swift | explizite inheritance/conformance/extension, Types/function | nested Cross-file-Targets gegen Namenskollisionen ausgelassen |

Bei 2.000 Dateien wird `truncated` gesetzt; Dateien über 512 KiB bleiben sichtbar, aber unanalysiert.

## Validierung an echten Open-Source-Projekten

Fixierte Commits wurden geklont und repräsentative Edges mit dem Quelltext geprüft. Zeiten dienen nur der Betriebssicherheit.

| Repository | Commit | Sprachdateien | Deklarationen | Internal edges | Truncated |
|---|---|---:|---:|---:|---:|
| [Slim](https://github.com/slimphp/Slim) | `80900fb` | 125 | 127 | 305 | nein |
| [Redis](https://github.com/redis/redis) | `f76dff7` | 784 | 5,796 | 990 | nein |
| [fmt](https://github.com/fmtlib/fmt) | `a79df45` | 46 | 283 | 121 | nein |
| [Alamofire](https://github.com/Alamofire/Alamofire) | `903c53c` | 98 | 2,052 | 215 | nein |

Dabei wurden ein Swift-Standard-`Error`, das fälschlich auf einen gleichnamigen nested Type zeigte, und C-Standardheader, die auf vendored Kompatibilitätsheader zeigten, behoben. Details im [Bericht](docs/benchmarks/oss-analysis-2026-07-15.md).

## Daten und Privatsphäre

- `SessionEnd` kopiert den vollständigen Transcript verlustfrei nach `raw/`.
- Batch erstellt einen begrenzten Digest und sendet ihn per separatem `claude -p` an Anthropic; dies ist die einzige zusätzliche Modell/API-Übertragung.
- Ausführung mit `--safe-mode`, begrenzten Tools, Prompt über stdin, Lint/Rollback und ohne Bash.
- Raw ist git-ignored; nur extrahiertes Markdown wird lokal committed. Kein Push oder Remote.
- POSIX-Verzeichnisse `0700`, raw/state/log `0600`. Permanente Logs enthalten keinen Transcript, Claude stdout/stderr, Credentials oder vollständige Raw-Pfade.
- Das Live-Fixture ist synthetisch und ohne persönliche Daten/Credentials.

## Konfiguration und Entfernung

`~/.claude/okf/.okf/config.md` oder `/okf:okf-config`. Hauptwerte: `enabled: true`, `batch_interval_hours: 1`, `batch_max_digest_kb: 600`, `batch_digest_cap_kb: 150`, `remove_candidate_ttl_days: 30`, `inject_max_lines` / `inject_max_bytes`: `120` / `9000`. Ungültige Werte fallen auf sichere Defaults zurück.

```sh
claude plugin uninstall okf
```

Das Bundle bleibt unter `~/.claude/okf` zur Prüfung, Sicherung oder manuellen Löschung.

## Entwicklungsprüfung

```sh
node test/smoke.mjs
node test/bench.mjs
for file in $(rg --files -g '*.mjs'); do node --check "$file"; done
claude plugin validate .claude-plugin/plugin.json
claude plugin validate .claude-plugin/marketplace.json
git diff --check
```

Live: `OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs`.

## Referenzen und Lizenz

Die Struktur orientiert sich an der knappen, reproduzierbaren Darstellung von [uv](https://github.com/astral-sh/uv), [Ruff](https://github.com/astral-sh/ruff), [Playwright](https://github.com/microsoft/playwright), [fmt](https://github.com/fmtlib/fmt) und [Slim](https://github.com/slimphp/Slim), ohne Text oder Claims zu kopieren. [OKF-Spezifikation](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md). Lizenz: [MIT](LICENSE).
