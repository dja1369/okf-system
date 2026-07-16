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

## OKF-Benchmark

<!-- okf-benchmark: 2026-07-16-v3 -->

**OKF ist Overhead bei fast allem, was Code beantworten kann, und dort, wo Code überhaupt keine
Antwort hat, schlägt selbst eine schlichte CLAUDE.md es ebenfalls — OKFs einziger Vorteil besteht
darin, dies günstiger zu tun. Ein direkter Test seines Kernversprechens (angesammeltes Wissen zahlt
sich mit der Zeit aus) wurde durchgeführt und widerlegt.**

Jede Behauptung in diesem Absatz wird unten gemessen, an echten Open-Source-Repositories, mit n=15
je Vergleichszelle. Die für OKF wenig schmeichelhaften Teile werden zuerst veröffentlicht.

### Wie gemessen wurde

Zwei fixierte öffentliche Repositories — kein synthetisches Fixture, damit Exploration das kostet,
was Exploration tatsächlich kostet, und die Baseline ohne Gedächtnis wirklich gewinnen kann:

| Rolle | Repository | Commit |
|---|---|---|
| Codebase | [slimphp/Slim](https://github.com/slimphp/Slim) | `80900fb3` (125 PHP-Dateien) |
| Dokumentenhaufen | [rust-lang/rfcs](https://github.com/rust-lang/rfcs) | `f635361c` (651 Markdown-Dateien) |

Jedes Concept in jedem Bundle wurde von der echten Pipeline erzeugt — eine echte `claude -p`-Sitzung,
die das fixierte Repo exploriert, ihr echtes Claude-Code-Transcript, echter Batch-Ingest, echtes
Gate. **Kein Concept wurde von Hand geschrieben.** Die Bundles sind in dieses Repository committet
([docs/benchmarks/bundles/](docs/benchmarks/bundles/)), sodass Sie den exakten Gate-Text und die
Concept-Bodies lesen können, auf denen jede Zahl unten beruht, und diesen Lauf so widerlegen können,
wie v2 widerlegt wurde — aus dem Repo, ohne dem Autor zu vertrauen.

Fünf Bedingungen. Alle erhalten identische Tools (`Read`, `Glob`, `Grep`, `Bash(git log/show/diff/blame/grep)`)
und eine identische, bedingungsneutrale Anweisung — keiner Bedingung wird gesagt, sie solle das Gate
konsultieren. Das Gate wird über den **echten `SessionStart`-Hook** (`additionalContext`) geliefert,
nicht dem Prompt vorangestellt; die gelieferten Bytes werden pro Lauf verifiziert.

- **zero-base** — nichts. Das, was OKF zu ersetzen behauptet.
- **answer key** — die eingefügte Antwort. Diesen String zu erzeugen setzt voraus, die Antwort bereits
  zu kennen, deshalb kann kein Nutzer diese Bedingung einnehmen. Sie ist eine Untergrenze, kein
  Konkurrent.
- **OKF** — der echte Gate-Text.
- **wrong knowledge** — ein größengleiches Gate aus echten Concepts über das *andere* Repository.
  Trennt „das Wissen half“ von „ein Gate half“.
- **CLAUDE.md** — dasselbe angesammelte Wissen, in eine flache Datei eingefügt. Der reale
  Platzhirsch.

`total_cost_usd` ist die Schlagzeile; die reinen Sonnet-Kosten stehen neben den Gesamtkosten, sodass
das `claude-haiku`, das die CLI für interne Arbeit heranzieht (2.3% der Ausgaben), herausgerechnet
werden kann und keine Schlussfolgerung verbergen kann. Effizienz wird nur an korrekten Läufen
verglichen. Jede Antwort wird pro **Atom** bewertet — die Ground Truth wird in unabhängig prüfbare
Fakten zerlegt, vor der Messung eingefroren — und die v2-artige Binärbewertung (alle Atome korrekt)
steht daneben. Eine Nonce pro Lauf hebelt Prompt-Caching aus. **Keine Zahl wird über Szenarien
gemittelt.**

Design, Vorhersagen und die Widerlegungskriterien R1–R5 wurden
[vorregistriert](docs/benchmarks/pre-registration-2026-07-16-v3.md) und **vor dem ersten bezahlten
Call** committet. Dieses Dokument hält außerdem detailliert die sechs falschen oder unbelegten
Aussagen fest, die die vorige (v2-)Veröffentlichung dieses Benchmarks machte, und wie jede aus ihren
eigenen Rohdaten aufgefallen ist.

### Wo OKF verliert: alles, was der Code beantworten kann

Fünf Szenarien, deren Antworten im Quelltext, in der git-Historie oder im Bundle stehen, jedes
verifiziert am fixierten Checkout. Die Kosten sind der Median der korrekten Läufe, mit ihrer Streuung.

| Szenario | zero-base | OKF | Fazit |
|---|---:|---:|---|
| `rfcs_cheap` — ein grep | **$0.062** · 13/15 | $0.077 · 14/15 | OKF 1.2× teurer |
| `slim_cheap` — ein grep | **$0.067** · 14/15 | $0.114 · 15/15 | OKF 1.7× teurer |
| `rfcs_buried` — die Begründung unter 651 Dokumenten finden | **$0.097** · 12/15 | $0.112 · 13/15 | OKF 1.2× teurer |
| `slim_buried` — einer Aufrufkette über fünf Dateien folgen | $0.277 · 13/15 · **10 Tools** | **$0.232** · 9/15 · **8 Tools** | OKF günstiger, weniger Tools |
| `slim_stale` — Bundle-Wissen durch einen späteren Commit veraltet | kritisch **15/15** | kritisch **15/15** | Gleichstand — siehe unten |

**Bei billigen greps ist OKF reiner Overhead** — 1.2–1.7× teurer für dieselbe Antwort, weil das Gate
ein fixer Kostenblock ist, den ein `grep` nicht braucht. Es zahlt sich nur dort aus, wo Exploration
wirklich teuer ist: `slim_buried` folgt einer Aufrufkette über fünf Dateien, und dort ist OKF
günstiger bei weniger Tool-Calls. Das ist kein Defekt, das ist Arithmetik — wenn ein grep Ihre Frage
beantwortet, zahlen Sie nicht für ein Gate.

`slim_stale` ist der Ort, an dem sich die Bewertung pro Atom bezahlt gemacht hat. Das Bundle trug eine
durch einen späteren Commit veraltete Behauptung, und die Binärbewertung liest sich als **0/15 für
jede Bedingung** — was wie ein totaler Ausfall aussieht. Ist es nicht. Die *kritischen* Atome (was die
Frage tatsächlich verlangt — dass der HTML-Renderer escaped, mit welcher Funktion und welchen Flags)
sind **15/15**: Das Modell las den Code und beantwortete den Kernfakt korrekt. Die einzigen Atome, die
es verfehlte, sind Herkunftsangaben, nach denen die Frage nie fragte (der Commit-SHA, der das Escaping
einführte). Veraltetes Wissen machte es **nicht** selbstbewusst falsch — die vorregistrierte
Vorhersage, dass es das täte, war falsch, und die Binärbewertung allein hätte das verborgen.

### Wo Exploration nicht helfen kann: Wissen, das der Code nicht enthält

Team-Policy, im Gespräch entschieden, nie ins Repo geschrieben. Der RFC-Haufen enthält sogar eine
Falle: Sucht man darin nach einer MSRV-Policy, schlagen die Dokumente `N-2` vor — die tatsächliche
Regel des Teams ist eine andere.

| Szenario | zero-base | OKF | wrong knowledge | CLAUDE.md |
|---|---:|---:|---:|---:|
| `rfcs_policy` — die „thaw rule“ des Teams: Wartezeit, MSRV-Kadenz, zwei Ausnahmen | **0/15** | **11/15** · $0.075 | — | 15/15 · $0.144 |

**Zero-base stand 0 von 15.** Es gab das Geld aus und bekam nichts, weil die Antwort nicht im
Repository steht — verifiziert von einem Angreifer, der den Working Tree, die git-Historie,
Commit-Messages, Docs und Config durchsuchte und null Treffer fand. Auch die Falle fing es nicht; es
konnte schlicht nicht antworten.

OKF beantwortete **11 von 15**, zu ungefähr der Hälfte der Kosten von CLAUDE.md mit denselben Fakten.
Das ist die eine Sache, die Exploration nicht kann und eine gespeicherte Entscheidung schon.
**CLAUDE.md beantwortet sie ebenfalls** (15/15) — OKF ist hier nicht einzigartig, es ist eine
günstigere Form desselben Platzhirschen mit begrenzter Injektion. Die `wrong knowledge`-Kontrolle für
dieses Szenario ist ausgeschlossen: Ein Messkontaminations-Bug (unten) ließ sie die Antwort lesen,
sodass sie in diesem Lauf nicht als Kontrolle für „ein Gate allein hilft nicht“ dienen kann.

Dies ist ein einzelnes sauberes Policy-Szenario, nicht drei. Zwei weitere (`slim_policy`,
`slim_domain`) wurden gemessen und dann **ausgeschlossen** — siehe unten.

### Was dieser Lauf Ihnen nicht sagen kann

- **Zwei Policy-Szenarien wurden wegen Kontamination ausgeschlossen.** Claude Code injiziert
  automatisch verzeichnisbezogenes Projekt-Memory (`~/.claude/projects/<cwd>/memory/`) in jede
  Sitzung. Beim Aufbau des Wissens speicherte eine `claude -p`-Sitzung, die das Ziel-Repo explorierte,
  die Team-Entscheidungen in dieses Memory, und weil die Messung im selben Arbeitsverzeichnis lief,
  erreichte das Memory sogar die **zero-base**-Bedingung — die überhaupt kein Wissen haben sollte. Bei
  `slim_domain` „beantwortete“ zero-base daraufhin eine Team-Entscheidung, die nirgends im Code
  existiert, 15/15. Jedes Szenario, dessen zero-base-Läufe Projekt-Memory lasen, wird von der
  Veröffentlichung ausgeschlossen (`slim_domain`, `slim_policy`); die Harness löscht dieses Memory nun
  vor der Messung, und der Bericht erkennt und schließt solche Szenarien mechanisch aus. Die sauberen
  Szenarien oben hatten null Memory-Lesevorgänge.
- **n=15 bei Kontrastbedingungen, n=5 bei Kontrollen.** Klein. Nur vollständige Trennung zwischen
  Verteilungen wird als Gewinn beschrieben.
- **Zwei Repositories, zwei Ökosysteme (PHP + Markdown).** Kein Anspruch auf Allgemeingültigkeit über
  Größen oder Sprachen hinweg. Ein drittes Repository wurde entworfen und dann vor dem Ausgeben nach
  Kosten-pro-Glaubwürdigkeit verworfen.
- **Sitzungen mit einer einzigen Frage.** OKFs fixe Gate-Kosten werden einmal pro Frage bezahlt statt
  über eine echte Sitzung mit mehreren Fragen amortisiert, sodass dieser Lauf OKF *unterschätzt*.
- **Der Judge ist eine einzige LLM-Familie**, bewertet pro Atom gegen aus dem Quelltext verifizierte
  Ground Truth.

Die Widerlegungskriterien **R1–R5 wurden alle mechanisch ausgewertet und keines hat ausgelöst** (nach
Ausschluss der kontaminierten Zellen) — dieser Lauf widerlegt die Behauptung nicht. Das ist nicht
dasselbe wie eine starke Bestätigung bei n=15; es ist das Fehlen einer Widerlegung.

### Ein Chain-Follow-up: Hilft echte Akkumulation? (v4, widerlegt)

<!-- okf-benchmark-chain: 2026-07-16-v4 -->

Ein separater, vorregistrierter Lauf testete OKFs Mechanismus direkt: eine Chain aus 4 verwandten, aber
verschiedenen Fragen zu `pkg/scheduler` von `kubernetes/kubernetes` (v1.30.0, 178 Go-Dateien), bei der
die Schlussfolgerung jeder Sitzung durch einen **echten Batch** läuft, bevor die nächste Sitzung startet —
verglichen mit denselben 4 Fragen, ganz ohne jegliche Akkumulation. Das ist genau die Form, die die
Vorregistrierung von v3 als „begünstigt OKF und lässt sich so justieren, dass sie ihm schmeichelt"
markierte und auszuführen ablehnte. v4 führte sie trotzdem aus, diesmal mit Schutzmaßnahmen: Die 4 Fragen
wurden vor dem Ausgeben eingefroren und gegen den Quelltext verifiziert, der Kontaminations-Schutz löscht
Claude Codes Projekt-Memory vor **jeder** Sitzung (nicht nur einmal), und die Widerlegungskriterien wurden
vor der Messung festgelegt — siehe die [Vorregistrierung](docs/benchmarks/pre-registration-2026-07-16-v4.md).

Echte Akkumulation fand statt: Die Gate-Bytes wuchsen über die Schritte hinweg monoton (1835 → 2613 →
3675 → 4950, n=15 Chains), gestützt auf echte, gemessene Batch-Ausgaben ($25.81 gesamt). **Die
Kernvorhersage — dass die Kosten über die Chain hinweg fallen — wurde widerlegt.** OKFs Kosten
entwickelten sich über die vier Fragen $0.231 → $0.216 → $0.258 → **$0.447**; die Kontrolle ohne Gedächtnis
bewegte sich genauso ($0.255 → $0.256 → $0.272 → $0.411). Die wahrscheinlichste Erklärung ist, dass die
vierte Frage für beide Arme schlicht schwerer war — sie fragt nach zwei Mechanismen gleichzeitig — nicht,
dass Akkumulation half oder schadete. OKFs Genauigkeit auf Atom-Ebene übertraf die der Baseline in keinem
Schritt und lag bei der ersten wie der letzten Frage darunter. Die Binärbewertung (alle Atome korrekt)
stand bei 0/106 für beide Arme — dieses Fragenset ist hart genug, dass überhaupt nur die Bewertung auf
Atom-Ebene brauchbar ist. [Vollständiger Bericht](docs/benchmarks/okf-benchmark-chain-2026-07-16-v4.md).

### Lokaler Overhead (nicht das Wirksamkeitsergebnis)

Gemessen am 2026-07-16, macOS arm64, Node `v26.4.0`, Median mit min/max.

| Lokale Operation | Median | Bereich |
|---|---:|---:|
| SessionStart-Gate-Prozess | 57.3 ms | 56.1–60.0 ms |
| SessionEnd-Batch-Trigger-Prozess | 40.1 ms | 39.3–40.8 ms |
| Statusline-Prozess | 35.8 ms | 34.6–36.3 ms |

Reproduzierbar mit `node test/bench.mjs [Repository]`. Nur lokale Prozesskosten; das beweist nichts
über Tokens oder Modell-Latenz.

### Kosten, Reproduktion und Links

Die 440 gemessenen Läufe kosteten **$66.26** plus **$14.74** für die Bewertung; Wissens- und
Bundle-Aufbau kamen mit ~$3.2 hinzu. Gesamt für diesen Lauf ≈ **$84**. Bezahlt, authentifiziert und
absichtlich von Smoke-Tests und CI ausgenommen.

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-knowledge.mjs --target slim --dir <repo>   # real sessions → transcripts
OKF_RUN_LIVE_BENCH=1 node test/bench-bundles.mjs --target slim --levels 20      # real batch → bundle
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                                    # measure
```

Der v4-Chain-Lauf (120 Sitzungen, echte Batches zwischen den Schritten) kostete **$31.95** Messung +
**$9.20** Bewertung + **$25.81** echten Ingest ≈ **$67**:

```sh
OKF_RUN_LIVE_BENCH=1 OKF_BENCH_CHAINS=15 node test/bench-chain.mjs   # chained sessions, real batch, measure
```

[Vollständiger Bericht](docs/benchmarks/okf-benchmark-2026-07-16-v3.md) ·
[Chain-Follow-up-Bericht](docs/benchmarks/okf-benchmark-chain-2026-07-16-v4.md) ·
[Raw JSON](docs/benchmarks/raw/) ·
[Committete Bundles](docs/benchmarks/bundles/) ·
[Vorregistrierung](docs/benchmarks/pre-registration-2026-07-16-v3.md) ·
[Chain-Vorregistrierung](docs/benchmarks/pre-registration-2026-07-16-v4.md) ·
[Nutzungsleitfaden](docs/USAGE.md).

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
