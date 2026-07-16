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

Der erste `SessionStart` erstellt `~/.claude/okf` (oder `$CLAUDE_CONFIG_DIR/okf`). Erfassung und opportunistischer Batch laufen automatisch — eine Unterhaltung wird etwa eine Stunde nach ihrer letzten Aktivität erfasst, niemand muss eine Sitzung dafür explizit beenden.

## Kontinuitätsablauf

```text
Sitzung 1              ~1h Leerlauf              Background-Batch           Sitzung 2
Entscheidung treffen -> Sweep sammelt raw    ->   wiederverwendbares     -> kompakter Index
(kein explizites        (verlustfreie Kopie;      OKF-Markdown              injiziert
 Ende nötig)             Wachstum triggert           |                         |
                         erneute Erfassung)         +-- lokale git-Historie   +-- relevanten Concept lesen
```

Eine Regel wie „10 % → 50 % → 100 % ausrollen, über 0,5 % Fehlern zurückrollen“ kann so ohne erneute Eingabe gefunden werden. Der Index routet nur; Claude muss vor einer Handlung das relevante Concept per `Read` öffnen.

Warum idle-basiert? Sitzungen enden selten explizit — Background-Agenten tun es nie —, und ein Endsnapshot beim `resume` markierte eine Unterhaltung mitten im Fluss fälschlich als „verarbeitet“ und verlor damit alles, was danach kam. Deshalb erfasst der Sweep ein Transcript erst, nachdem es seit `sweep_min_idle_minutes` (Standard 60) ruhig war, der Batch-Prozess wartet, bis ausstehende Unterhaltungen Leerlauf erreichen (Prüfung alle ~5 Minuten, bis zu 8 Stunden), eine bereits erfasste Sitzung wird **nur bei erneutem Wachstum** wieder erfasst, und eine unveränderte Sitzung nie erneut. Session-Hooks wecken lediglich den Batch.

## Befehle

| Befehl | Zweck |
|---|---|
| `/okf:okf-status` | Letzter Batch, wartende Sitzungen und Lock |
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

Live-Lauf am 2026-07-15: Claude Code `2.1.210`, `sonnet`/medium (Sonnet 5 + Haiku 4.5), macOS arm64, Node `v26.4.0`, fünf Läufe je Bedingung in gekreuzter Reihenfolge. Cs Bundle entsteht aus echter Erfassung in `raw/` → isoliertem Batch-Ingest → SessionStart-Gate; Preflight: C 8/8 vorhanden und 8/8 gate-geroutet, D 0/8.

| Bedingung | Kontinuität | Einhaltung p50 | token activity p50/p95 | wall p50/p95 | Kosten p50 |
|---|---:|---:|---:|---:|---:|
| A — no memory | **0/5** | 12% | 27,246/27,518 | 13.82/18.17 s | $0.022218 |
| B_oracle (Lösungsschlüssel) | 5/5 | 100% | 9,069/9,069 | 4.86/6.46 s | $0.008410 |
| B_realistic | 5/5 | 100% | 9,069/9,069 | 5.96/6.27 s | $0.008410 |
| **C — OKF enabled** | **5/5** | 100% | **10,395**/10,459 | 6.46/7.15 s | $0.011329 |
| D — irrelevant OKF | 0/5 | 0% | 20,602/21,662 | 14.50/21.15 s | $0.025879 |

Die Tool-Calls dahinter erklären die Zahlen: A liest 2 Dateien über 4 Turns und scheitert trotzdem; B antwortet in 1 Turn mit 0 Reads, weil die Antworten schon im Prompt stehen; **C antwortet in 1 Turn mit 0 Reads** — der Gate-Index allein genügte; D liest 1 Datei über 2 Turns und sucht, was sein Gate nie enthielt.

`p95` mit Vorsicht lesen: bei n=5 ist `ceil(0.95×5)−1` der letzte Index, p95 **ist** also das Maximum — ein einzelner Cold-Cache-Lauf, keine Tail-Statistik. Er steht hier, weil das geforderte Format ihn verlangt, nicht weil er eine ist.

**Zuerst Zeile A lesen.** Ohne Gedächtnis verbrennt die Sitzung 27,246 Tokens, liest zwei Dateien, braucht vier Turns — und liefert trotzdem **0/8**. Genau das ersetzt OKF, und C schlägt es: 2.6× weniger Tokens, 8/8, in einem Turn ohne Reads.

**C schlägt B nicht und wird es nie** — B hat die Antworten schon im Prompt. Bei dieser Bundle-Größe ist B_realistic gleich B_oracle (beide 9,069); C kostet 1,326 Tokens und $0.0029 je Sitzung mehr. Der Bundle-Aufbau kostete **133,364** token activity und **$0.176758**. **Einen Token- oder Kosten-Break-even gibt es nicht**; `perSessionTokenSaving` ist negativ, daher meldet die Harness `null`, statt einen zu erfinden.

Geändert hat sich das Gate: C kostete zuvor **22,857** Tokens über 7 Turns mit 5 Reads, jetzt 10,395 in 1 Turn mit 0 Reads bei identischer 5/5-Recall. 91 % des alten Overheads war ein verordneter `Read`-Round-Trip, der Fakten erneut holte, die der Index längst geliefert hatte.

### Die Akkumulationsgrenze — gemessen, nicht projiziert

**„OKF wird billiger, je mehr Wissen sich ansammelt“ ist falsch.** Es wird teurer — und zwar schneller als die Alternative. Gleicher Benchmark, gleiches Bundle, 20 unbeteiligte Concepts ergänzt; alles passt weiterhin in den Index (21 Zeilen, 5,548 von 9,000 Bytes, nichts gekürzt):

| Bedingung | Kontinuität | Einhaltung p50 | token activity p50/p95 | wall p50/p95 | Kosten p50 |
|---|---:|---:|---:|---:|---:|
| A — no memory | 0/5 | 0% | 27,316/27,717 | 13.79/18.05 s | $0.022838 |
| B_oracle (Lösungsschlüssel) | 5/5 | 100% | 9,070/9,085 | 5.33/6.78 s | $0.008410 |
| B_realistic | 5/5 | 100% | 10,406/10,406 | 5.72/9.62 s | $0.010134 |
| **C — OKF enabled** | **5/5** | 100% | **25,384**/25,773 | 11.75/13.15 s | $0.030721 |
| D — irrelevant OKF | 0/5 | 0% | 22,265/22,334 | 14.91/19.59 s | $0.037354 |

Gegenüber dem 0-Filler-Lauf wuchs B_realistic um **+1,337** (9,069 → 10,406), C dagegen um **+14,989** (10,395 → 25,384). **C verschlechtert sich ~11× schneller** — 749 Tokens je zusätzlichem Concept gegen 67. Beide antworten weiterhin 5/5: eine reine Kostenregression, kein Genauigkeitsproblem.

Die Ursache ist nicht Kürzung, sondern Vertrauen:

```
0 Filler:   C reads=0  turns=1    antwortet direkt aus der Indexzeile
20 Filler:  C reads=3  turns=4    öffnet wieder Dateien
```

Zwanzig irrelevante Concepts genügten, damit das Modell der Indexzeile nicht mehr glaubt und gegen die Datei prüft — exakt der Round-Trip, den der Gate-Fix entfernt hatte. Der Index sagt, dass eine Zeile existiert; er sagt nicht, dass sie die *vollständige* Antwort ist — mit wachsendem Rauschen ist Nachprüfen die rationale Wahl. **Das ist die eigentliche Decke, und sie kommt bei ~21 Concepts — lange bevor irgendein Cap greift.**

Kürzung ist die zweite, weiter entfernte Wand. Der Index ist hart gedeckelt (10,000-Zeichen-Grenze für Hooks), echte koreanische Concept-Zeilen laufen bei ~214 Bytes:

| Concepts im Bundle | Im Gate-Index gezeigt |
|---:|---:|
| 20 | 20 |
| 40 | 40 |
| **55** | **43** (gekürzt) |
| 100 | 43 (gekürzt) |

**Ab ca. 43 Concepts kürzt der Index**, und was überlebt, entscheidet der Dateiname — nicht Relevanz, nicht Aktualität. Genau daran **scheitert der Preflight** mit 50 Filler-Concepts (`presentFacts: 8, routedFacts: 6`): `decisions/tech-stack.md` sortierte hinter die Filler und fiel heraus. Kategorien werden Round-Robin verteilt, damit keine verhungert, und gekürzte Kategorien verweisen auf ihre eigene `index.md` — Abstieg ist aber ein Tool-Round-Trip, dieselben Kosten noch einmal.

Keine der beiden Wände ist ein Tuning-Knopf. Die erste zu beheben verlangt, dass der Index signalisiert, *welche Zeilen vollständige Antworten sind*, damit das Modell ihnen ohne Dateiöffnen vertrauen kann; diese Arbeit ist nicht getan — bis dahin wird OKFs Ökonomie mit jedem weiteren Concept schlechter.

Akkumulationslauf: [Raw JSON](docs/benchmarks/raw/okf-live-2026-07-15T16-30-11-404Z.json). Der 50-Filler-Preflight-Fehler bleibt als [Preflight-Audit](docs/benchmarks/raw/okf-live-preflight-failed-2026-07-15T16-11-37-402Z.json) erhalten — ein bewusst aufbewahrtes Negativergebnis.

Gemessen werden Erfolg, Einhaltung, falsche Annahmen, Rückfragen, Tool Calls, erste gültige Antwort, API/Wall-Zeit, `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` und CLI-Kosten; Tokenkategorien bleiben im Raw-JSON getrennt. `tokenActivity` addiert Cache-Reads 1:1 mit Output-Tokens, obwohl sie ~50× günstiger abrechnen — **belastbar ist die Kostenspalte**. User-only/Gate-only-Tokens bleiben ohne Schätzung `null`.

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                      # wie oben veröffentlicht
OKF_RUN_LIVE_BENCH=1 OKF_BENCH_FILLER=50 node test/bench-okf.mjs  # Akkumulationsachse
```

Bezahlter Opt-in-Lauf außerhalb von CI. Siehe [gültigen Bericht](docs/benchmarks/okf-live-2026-07-15T16-06-28-592Z.md), [Raw JSON](docs/benchmarks/raw/okf-live-2026-07-15T16-06-28-592Z.json) und [docs/USAGE.md](docs/USAGE.md). Der frühere Lauf vor dem Fix bleibt als Audit-Trail erhalten.

### Lokaler Overhead — nicht das Wirksamkeitsergebnis

Frische Messung vom 2026-07-16, macOS arm64, Node `v26.4.0`:

| Operation | Median | Bereich |
|---|---:|---:|
| SessionStart-Gate-Prozess | 57.2 ms | 56.9–58.1 ms |
| SessionEnd-Trigger-Prozess | 41.4 ms | 39.0–42.1 ms |
| Statusline-Prozess | 35.0 ms | 35.0–35.2 ms |

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

- Der Idle-Sweep kopiert den vollständigen Transcript nach `raw/`; dabei wird während der Erfassung nicht geparst oder gekürzt. Session-Hooks wecken nur den Batch.
- Batch erstellt einen begrenzten Digest und sendet ihn per separatem `claude -p` an Anthropic; dies ist die einzige zusätzliche Modell/API-Übertragung.
- Ausführung mit `--safe-mode`, begrenzten Tools, Prompt über stdin, Lint/Rollback und ohne Bash.
- Der Analyzer arbeitet in einer Wegwerfkopie der Wissensdateien in einem temporären Workspace und kann physisch nicht auf `raw/`, `.okf/` oder `.git` zugreifen; der Driver kopiert nur reguläre `.md`-Dateien zurück (Skripte und Symlinks erreichen das Bundle nie).
- Raw ist git-ignored; nur extrahiertes Markdown wird lokal committed. Kein Push oder Remote.
- POSIX-Verzeichnisse `0700`, raw/state/log `0600`. Permanente Logs enthalten keinen Transcript, Claude stdout/stderr, Credentials oder vollständige Raw-Pfade.
- Das Live-Fixture ist synthetisch und ohne persönliche Daten/Credentials.

## Konfiguration und Entfernung

`~/.claude/okf/.okf/config.md` bearbeiten oder `/okf:okf-config` verwenden. Unbekannte oder ungültige Werte werden ignoriert und fallen auf sichere Defaults zurück.

| Schlüssel | Standard | Bedeutung |
|---|---:|---|
| `enabled` | `true` | Hauptschalter für Erfassung, Gate und Batch |
| `batch_interval_hours` | `1` | Mindestabstand zwischen opportunistischen Batches |
| `batch_max_digest_kb` | `600` | Gesamtes Digest-Budget pro Batch |
| `batch_max_sessions` | `50` | Obergrenze gegen Ausreißer; das Byte-Budget ist die eigentliche Kostenkontrolle |
| `batch_model` / `batch_effort` | `claude-sonnet-5` / `medium` | Batch-Modell-Einstellungen; leer nutzt CLI-Defaults |
| `capture_exclude_cwd` | `[]` | Ausschluss-Globs für die Erfassung, geprüft gegen das cwd jeder Sitzung |
| `sweep_min_idle_minutes` | `60` | Leerlaufzeit nach der letzten Aktivität, bevor eine Sitzung erfasst wird; `0` erfasst sofort |
| `batch_digest_cap_kb` | `150` | Digest-Obergrenze pro Sitzung für das LLM; raw bleibt vollständig |
| `remove_candidate_ttl_days` | `30` | Aufbewahrungsdauer vor Löschung verarbeiteter raw-Daten |
| `inject_max_lines` / `inject_max_bytes` | `120` / `9000` | Inline-Gate-Grenzen unterhalb von Claude Codes 10.000-Zeichen-Schwelle |

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
