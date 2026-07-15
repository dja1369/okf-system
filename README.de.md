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

<!-- okf-live-benchmark: valid-2026-07-15T15-03-01Z -->

Live-Lauf am 2026-07-15: Claude Code `2.1.210`, `sonnet`/medium (Sonnet 5 + Haiku 4.5), macOS arm64, Node `v26.4.0`, Commit `c00d3fc`, fünf Wiederholungen je Bedingung. Vor dem Follow-up enthielt C 8/8 Zielfakten und routete 8/8 über das Gate; D enthielt 0/8.

| Bedingung | Kontinuität | token activity p50 / p95 | wall p50 / p95 | Kosten p50 |
|---|---:|---:|---:|---:|
| A — no memory | 0/5 | 27,320 / 27,574 | 16.40 / 18.17 s | $0.024037 |
| B — manual restatement | 5/5 | 9,070 / 9,093 | 6.07 / 7.42 s | $0.008410 |
| C — OKF enabled | 5/5 | 22,857 / 22,883 | 11.33 / 12.80 s | $0.033189 |
| D — irrelevant OKF | 0/5 | 21,507 / 22,261 | 16.92 / 18.88 s | $0.030332 |

C fand alle Fakten, benötigte aber median 13,787 token activity und 5.26 s mehr als B. Eine Effizienzverbesserung ist nicht belegt. Der Batch kostete 111,381 token activity/$0.164360; B−C war negativ, daher kein Break-even.

Jede Bedingung wird mindestens fünfmal wiederholt. Gemessen werden Erfolg, Einhaltung, falsche Annahmen, Rückfragen, Tool Calls, erste gültige Antwort, API/Wall-Zeit, `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` und CLI-Kosten. Tokenkategorien bleiben im Raw-JSON getrennt; Batch- und Repair-Kosten fließen in Break-even ein. Nicht separat gelieferte User-only/Gate-only-Tokens bleiben ohne Schätzung `null`.

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs
```

Bezahlter Opt-in-Lauf außerhalb von CI. Siehe [gültigen Bericht](docs/benchmarks/okf-live-2026-07-15T15-03-01-343Z.md), [Raw JSON](docs/benchmarks/raw/okf-live-2026-07-15T15-03-01-343Z.json) und [docs/USAGE.md](docs/USAGE.md).

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
Ersparnis je Sitzung = Median Manual-Restatement - Median OKF
Break-even-Sitzungen = ceil(initiale Kosten / positive Ersparnis je Sitzung)
```

Die gemessene B−C-Ersparnis ist negativ; dieser Lauf hat keinen Token- oder Kosten-Break-even.

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
