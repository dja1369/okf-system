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

<!-- okf-benchmark: 2026-07-16 -->

> **Widerruf (2026-07-16).** Drei ursprünglich in diesem Abschnitt veröffentlichte Behauptungen wurden
> nach einem Audit der Rohdaten dieses Laufs zurückgezogen: die Falle-Erklärung zu `rfcs_policy`
> (erfunden — die Falle hat nie ausgelöst), die Schlagzeile zum Akkumulationstrend (von ihrer
> Stichprobe nicht gedeckt) und der ursprüngliche Titel dieses Abschnitts, „Wo OKF das Einzige ist,
> was funktioniert“ (von der eigenen Tabelle widerlegt). Jeder Widerruf ist dort vermerkt, wo die
> Behauptung stand. Was zurückgezogen wurde und wie jeder Punkt aufgefallen ist, steht in der
> [v3-Vorregistrierung](docs/benchmarks/pre-registration-2026-07-16-v3.md). Alle übrigen Befunde
> dieses Abschnitts bleiben unverändert.

**OKF erspart Ihnen das Explorieren nicht. Es speichert, was Exploration niemals finden kann.**

Beide Hälften dieses Satzes werden unten gemessen, an echten Open-Source-Repositories, und die
Hälfte, die wenig schmeichelhaft ist, wird zuerst veröffentlicht.

### Wie gemessen wurde

Zwei fixierte öffentliche Repositories — kein synthetisches Fixture, damit Exploration das kostet,
was Exploration tatsächlich kostet, und die Baseline ohne Gedächtnis wirklich gewinnen kann:

| Rolle | Repository | Commit |
|---|---|---|
| Codebase | [slimphp/Slim](https://github.com/slimphp/Slim) | `80900fb3` (125 PHP-Dateien) |
| Dokumentenhaufen | [rust-lang/rfcs](https://github.com/rust-lang/rfcs) | `f635361c` (651 Markdown-Dateien) |

Jedes Concept in jedem Bundle wurde von der echten Pipeline erzeugt — eine echte `claude -p`-Sitzung,
die das fixierte Repo exploriert, ihr echtes Claude-Code-Transcript, echter Batch-Ingest, echtes
Gate. **Kein Concept wurde von Hand geschrieben**, auch nicht der Füllstoff, der Volumen erzeugt.

Fünf Bedingungen. Alle erhalten identische Tools (`Read`, `Glob`, `Grep`, `Bash(git log/show/diff/blame/grep)`)
und eine identische, bedingungsneutrale Anweisung — keiner Bedingung wird gesagt, sie solle das Gate
konsultieren.

- **zero-base** — nichts. Das, was OKF zu ersetzen behauptet.
- **answer key** — die eingefügte Antwort. Diesen String zu erzeugen setzt voraus, die Antwort bereits
  zu kennen, deshalb kann kein Nutzer diese Bedingung einnehmen. Sie ist eine Untergrenze, kein
  Konkurrent.
- **OKF** — der echte Gate-Text.
- **wrong knowledge** — ein größengleiches Gate aus echten Concepts über das *andere* Repository.
  Trennt „das Wissen half“ von „ein Gate half“.
- **CLAUDE.md** — dasselbe angesammelte Wissen, in eine flache Datei eingefügt. Der reale
  Platzhirsch.

`total_cost_usd` ist die Schlagzeile; die Token-Aktivität steht daneben, nie an ihrer Stelle, denn
`cache_read` dominiert diese Summe und rechnet ~50× günstiger ab — die beiden Spalten widersprechen
sich in der Richtung. Effizienz wird nur an korrekten Läufen verglichen. Eine Nonce pro Lauf hebelt
Prompt-Caching aus. Bewertet wird von einem bedingungsblinden Judge gegen aus dem Quelltext
verifizierte Ground Truth. **Keine Zahl wird über Szenarien gemittelt**: ein grep und eine
Aufrufkette über fünf Dateien sind verschiedene Phänomene, und sie zu mischen würde die
Szenarienauswahl die Schlagzeile bestimmen lassen.

Design, Vorhersagen und Widerlegungskriterien wurden [vorregistriert](docs/benchmarks/pre-registration-2026-07-16.md)
und **vor dem ersten bezahlten Call** committet.

### Wo OKF verliert: alles, was der Code beantworten kann

Fünf Szenarien, deren Antworten im Quelltext oder in der git-Historie stehen, verifiziert am
fixierten Checkout, und jedes hat einen unabhängigen Widerlegungsversuch überstanden.

| Szenario | zero-base | OKF | Fazit |
|---|---:|---:|---|
| `rfcs_cheap` — ein grep | **$0.0256** · 4/5 | $0.0505 · 3/5 | OKF 2.0× teurer |
| `slim_cheap` — ein grep | **$0.0198** · 4/5 | $0.0386 · 5/5 | OKF 1.9× teurer |
| `slim_stale` — Bundle-Wissen durch einen späteren Commit veraltet | **$0.0345** · 5/5 | $0.0632 · 4/5 | OKF 1.8× teurer |
| `rfcs_buried` — die Begründung unter 651 Dokumenten finden | **$0.0326** · 4/5 | $0.0910 · 3/5 | OKF 2.8× teurer |
| `slim_buried` — einer Aufrufkette über fünf Dateien folgen | $0.1669 · 2/5 · **10 Tools** | **$0.0701** · 2/5 · **3 Tools** | **OKF 2.4× günstiger** |

**OKF verliert vier von fünf.** Es gewinnt nur dort, wo Exploration wirklich teuer ist, und dort
senkt es die Tool-Calls von 10 auf 3. Wenn ein grep Ihre Frage beantwortet, ist das Gate reiner
Overhead — das ist kein Defekt, das ist Arithmetik.

`slim_stale` verdient eine Erwähnung: Das Bundle trug eine veraltete Behauptung (der HTML-Error-Renderer
escaped nicht — wahr vor Commit `f897118b`, falsch am fixierten Commit) und das Modell **prüfte den
Code und korrigierte sie trotzdem**, 4/5. Veraltetes Wissen machte es nicht selbstbewusst falsch. Die
vorregistrierte Vorhersage, dass es das täte, war falsch.

### Wo Exploration nicht helfen kann: Wissen, das der Code nicht enthält

Team-Policy und Domänenvokabular — im Gespräch entschieden, nie ins Repo geschrieben. Jedes Szenario
wurde von einem unabhängigen Angreifer attackiert, der den Working Tree, ~300 Revisionen
git-Historie, Commit-Messages, Docs, Config, Stashes und dangling objects durchsuchte (null Treffer)
und der **vor dem Nachsehen eine Vermutung aus der Konvention notierte**. Diese Vermutungen erreichten
0/3, 0/3 und 1/5.

Jedes Repo enthält außerdem eine Falle: grep nach „emitter“ und man findet `ResponseEmitter`; sucht
man eine Chunk-Größe, findet man `4096`; durchsucht man den RFC-Haufen nach einer MSRV-Policy,
schlagen die Dokumente `N-2` vor.

| Szenario | zero-base | OKF | wrong knowledge | CLAUDE.md |
|---|---:|---:|---:|---:|
| `slim_policy` — welches env Fehlerdetails aktiviert, und die Ausnahme | **0/5** ($0.0509 ausgegeben) | **5/5** · $0.0840 | 0/5 | 5/5 · $0.1314 |
| `slim_domain` — was das Team mit „에미터“ meint | **0/5** · **selbstbewusst falsch 5/5** | **4/5** · $0.0624 | 0/5 | 5/5 · $0.1198 |
| `rfcs_policy` — die Wartezeit der „thaw rule“ des Teams | **0/5** | 2/5 · $0.0749 | 0/5 | 0/5 |

**Zero-base stand 0 von 15.** Es gab das Geld aus und bekam nichts, weil die Antwort nicht da ist. Bei
`slim_domain` war es **in 5 von 5 Läufen selbstbewusst falsch**: Es explorierte, fand
`ResponseEmitter` und antwortete mit hoher Zuversicht — während das „에미터“ des Teams
`OutputBufferingMiddleware` ist, weil sie im FrankenPHP-Worker-Mode laufen, wo `ResponseEmitter` toter
Code ist. Exploration scheitert hier nicht bloß; sie fabriziert aus der Falle eine selbstbewusste
falsche Antwort.

**Wrong knowledge stand ebenfalls 0 von 15.** Ein Gate voller echter, aber irrelevanter Concepts
holt nichts zurück. Der Gewinn kommt aus dem Wissen, nicht daraus, ein Gate zu haben.

OKF beantwortete 11 von 15, zu 1.6–1.9× weniger als CLAUDE.md mit denselben Fakten. Bei `slim_domain`
las es **überhaupt keine Concept-Datei** (0/5) — die Indexzeile allein genügte, bei 2 Tool-Calls
gegen 7 von zero-base.

**CLAUDE.md funktioniert hier ebenfalls**, und die Tabelle sagt das auch: 5/5 bei `slim_policy` und
5/5 bei `slim_domain`, womit es OKFs 4/5 schlägt. Was diese Tabelle stützt, ist Gleichstand mit dem
Platzhirsch bei 1.6–1.9× geringeren Kosten und begrenzter Injektion — nicht Einzigartigkeit. Dieser
Abschnitt erschien zuerst als „Wo OKF das Einzige ist, was funktioniert“, was seine eigene Tabelle
widerlegt; **dieser Titel wird zurückgezogen.**

`rfcs_policy` ist das ehrliche Scheitern: OKF schaffte nur 2/5. **Die hier veröffentlichte Erklärung
— der `N-2`-Vorschlag im Dokumentenhaufen sei eine starke genug Falle, um das Modell von einer
korrekten Indexzeile wegzuziehen — war falsch und wird zurückgezogen.** Alle 5 OKF-Läufe lasen
ausschließlich Bundle-Dateien; keiner öffnete ein RFC-Dokument; keiner antwortete `N-2`. Alle fünf
antworteten „4 Releases“. Die Falle hat nie ausgelöst. Die Ursache der 2/5 wurde vor der
Veröffentlichung nicht untersucht, und hier wird keine Ersatzerklärung angeboten; eine Neumessung
läuft. CLAUDE.md erreichte in diesem Szenario 0/5, OKF schlägt den Platzhirsch hier also weiterhin.

### Akkumulation: die Trendbehauptung wird zurückgezogen

Dieser Abschnitt veröffentlichte zunächst eine Kostenkurve über die Bundle-Größe (1 → 35 Concepts)
und die Schlagzeile **„Von 1 auf 35 Concepts wurde OKF günstiger ($0.1291 → $0.0908), während
CLAUDE.md 2.2× teurer wurde ($0.1279 → $0.2828). Die Kurven laufen auseinander."** **Diese
Trendbehauptung wird als von ihrer Stichprobe nicht gedeckt zurückgezogen.**

Die Zahlen waren nicht erfunden — es sind Mediane über ausschließlich korrekte Läufe, so wie
vorregistriert. Aber es sind Mediane aus **3, 2, 5, 3, 2 und 4** Läufen, und der Tiefpunkt $0.0701
ist *der Median aus zwei Läufen*. Über alle Läufe hinweg überlappen die Verteilungen der Level
vollständig (das Level mit 1 Concept reicht von $0.0774–$0.2214, das mit 35 Concepts von
$0.0836–$0.1606), und die Mediane über alle Läufe sind überhaupt nicht monoton: $0.1237, $0.1884,
$0.1425, $0.0852, $0.1142, $0.1135. Derselbe Abschnitt schrieb zwei Absätze weiter „Bei n=5 trennt
hier nichts" — dieser Satz war richtig und die Schlagzeile darüber nicht. Die Kurve wird hier nicht
erneut abgedruckt, denn ein Median aus zwei Läufen ist kein Punkt auf einer Kurve.

Auch das Plateau des Gates wurde falsch erklärt. Es wurde darauf zurückgeführt, dass der Batch 14
Concepts zu einer einzigen Indexzeile zusammenfasse — dargestellt als emergente Eigenschaft dessen,
wie OKF Wissen organisiert. **Es ist die Obergrenze `inject_max_lines: 120` in `lib/config.mjs`** —
eine Konfigurationskonstante. `bench-bundles.mjs` erfasst `gateTruncated`, und das ist genau auf dem
Level wahr, auf dem das Plateau beginnt: Indexeinträge wurden **aus Budgetgründen verworfen**, nicht
elegant verschachtelt.

Eine Hälfte der alten Behauptung überlebt, und nur für sich allein gestellt: CLAUDE.md trägt jeden
Concept-Body in jedem Prompt mit, sein Prompt wächst also linear mit der Zahl der Concepts. Das folgt
mechanisch aus dem Format. Ein Vergleich zur OKF-Seite wird daraus hier nicht gezogen.

Die Genauigkeit verbesserte sich nicht mit dem Volumen und blieb verrauscht (2/5–5/5). **Die
Level-Achse wird in v3 stillgelegt**: Sie misst eine Konfigurationskonstante, ein erneuter Lauf würde
also nur eine präzisere Lesung einer Zahl erkaufen, die in einer Config-Datei nachschlagbar ist.

### Lokaler Overhead (nicht das Wirksamkeitsergebnis)

Gemessen am 2026-07-16, macOS arm64, Node `v26.4.0`, Median mit min/max.

| Lokale Operation | Median | Bereich |
|---|---:|---:|
| SessionStart-Gate-Prozess | 57.3 ms | 56.1–60.0 ms |
| SessionEnd-Batch-Trigger-Prozess | 40.1 ms | 39.3–40.8 ms |
| Statusline-Prozess | 35.8 ms | 34.6–36.3 ms |

Reproduzierbar mit `node test/bench.mjs [Repository]`. Nur lokale Prozesskosten; das beweist nichts
über Tokens oder Modell-Latenz.

### Kosten, und was dieser Lauf Ihnen nicht sagen kann

Der Aufbau des Wissens kostete **$3.59** in echten Sitzungen und **$4.92** im Batch-Ingest. Die 250
gemessenen Läufe kosteten **$28.16** plus **$9.44** für die Bewertung.

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-knowledge.mjs --target slim --dir <repo>   # real sessions → transcripts
OKF_RUN_LIVE_BENCH=1 node test/bench-bundles.mjs --target slim --levels 1,5,20  # real batch → level bundles
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                                    # measure
```

Bezahlt, authentifiziert und absichtlich von Smoke-Tests und CI ausgenommen.
[Vollständiger Bericht](docs/benchmarks/okf-benchmark-2026-07-16.md) ·
[Raw JSON](docs/benchmarks/raw/) ·
[Vorregistrierung](docs/benchmarks/pre-registration-2026-07-16.md) ·
[Nutzungsleitfaden](docs/USAGE.md).

Grenzen, klar benannt:

- **n=5 je Zelle.** Klein. Nur vollständige Trennung zwischen Verteilungen wird hier als Gewinn
  beschrieben.
- **Der Modell-Mix ist nicht fixiert.** Angefordert wurde `claude-sonnet-5`; die CLI zog für interne
  Arbeit zusätzlich `claude-haiku-4-5` heran. Kostenvergleiche zwischen Bedingungen tragen dieses
  Artefakt mit.
- **Zwei Repositories, je eine Sprache.** Kein Anspruch auf Allgemeingültigkeit über Größen oder
  Ökosysteme hinweg.
- **Wall-Clock wird nicht veröffentlicht.** Die Messung lief mit Nebenläufigkeit 5; Kosten, Tokens
  und Tool-Calls sind davon unberührt, die Antwortlatenz nicht. Aussagen zur Geschwindigkeit
  bräuchten einen sequenziellen Wiederholungslauf.
- Der Gate-Text wird dem Prompt vorangestellt statt über den produktiven
  `SessionStart`-`additionalContext`-Pfad geliefert. Gleicher Text, andere Zustellung.
- Policy-Szenarien beruhen darauf, dass ein Mensch die Policy verfasst. Genau das ist Policy. Die
  Verteidigung ist, dass die Antwort nachweislich nicht im Repo steht und dass ein Angreifer sie
  nicht erraten konnte.

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
