# OKF for Claude Code

**Dein Agent vergisst alles, was du ihm gestern gesagt hast. Das behebt dieses
Plugin — und das Gedächtnis, das dabei entsteht, ist ein Ordner voller Markdown, der
dir gehört, keine Datenbank, an die du gebunden bist.**

![MIT license](https://img.shields.io/badge/license-MIT-blue) ![OKF v0.1](https://img.shields.io/badge/OKF-v0.1%20Draft-4ecdc4) ![Node only](https://img.shields.io/badge/runtime-Node%20only-5c6bc0) ![no npm install](https://img.shields.io/badge/dependencies-vendored-66bb6a)

**[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [Français](README.fr.md) · Deutsch · [Português](README.pt-BR.md)**

![OKF-Wissensgraph — Konzepte, verknüpft mit dem Code, den sie beschreiben](docs/okf-graph.png)

<sub>`/okf:okf-visualize` — dein Wissen (umrandete Knoten) und deine Codebasis in einem
Graphen. Um die gestrichelten gelben Kanten geht es: jedes Konzept verknüpft mit den
Quelldateien, um die es tatsächlich geht.</sub>

Jede Session beginnt bei null. Du erklärst dieselbe Architekturentscheidung erneut,
dieselbe Deploy-Policy, dasselbe „das haben wir versucht, und es ist kaputtgegangen" —
und in dem Moment, in dem die Session endet, ist es wieder weg. Währenddessen liegt das
Wissen, das die Frage *beantwortet hätte*, verstreut über Wikis, Code-Kommentare und,
wie Googles OKF-Ankündigung es formuliert, „the heads of a few senior engineers".

Dieses Plugin schließt diesen Kreis automatisch: Es erfasst, worüber tatsächlich
gesprochen wurde, destilliert die wiederverwendbaren Teile in ein strukturiertes
Wissensbündel und legt dieses Wissen zu Beginn jeder Session wieder vor das Modell.

## Das Format

Wissen wird im **[OKF (Open Knowledge Format)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)** gespeichert —
einer offenen Spezifikation, die Google Cloud [im Juni 2026 veröffentlicht hat](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/?hl=en&utm_source=pytorchkr&ref=pytorchkr)
(v0.1 Draft, Apache-2.0). Es ist bewusst unspektakulär, und genau darum geht es:

> "The format is intentionally minimal: a directory of markdown files with YAML
> frontmatter. There is no schema registry, no central authority, and no required
> tooling. **If you can `cat` a file, you can read OKF; if you can `git clone` a
> repo, you can ship it.**"

OKF formalisiert das „LLM-Wiki"-Muster, das [Andrej Karpathy zehn Wochen zuvor skizziert hatte](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) —
Googles Ankündigung sagt das ausdrücklich. Seit der Veröffentlichung hat sich ein
[kleines Ökosystem](https://github.com/search?q=%22open+knowledge+format%22&type=repositories)
aus Generatoren, Lintern, Viewern und MCP-Servern darum herum gebildet, und das Format
taucht auch außerhalb von Google auf (AWS hat ein [Beispiel](https://github.com/aws-samples/sample-okf-llm-wiki),
das Glue-Datenbanken als OKF-Bundles ausliefert). Es ist früh — der Großteil dieses
Ökosystems ist Wochen alt — aber das Format leistet, was es verspricht: lesbar zu sein
ohne die Werkzeuge seines Autors.

**Warum ein Format und kein Memory-Produkt.** Tools wie mem0, Letta, Zep und Cognee
sind Memory-*Runtimes* — du bindest eine Bibliothek ein oder betreibst einen Dienst, und
dein Gedächtnis liegt in deren Vektor- oder Graph-Store. Sie sind eine andere Ebene,
kein Konkurrent; manche davon könnten OKF speichern. Der praktische Unterschied sind die
**Ausstiegskosten**: Wissen, das in einer Graph-DB steckt, ist nur für dieses eine System
lesbar, während ein OKF-Bundle sich in deinem Editor öffnet, auf GitHub gerendert wird,
in einem Pull Request als Diff erscheint und von jedem anderen Agenten ohne
Übersetzungsschritt gelesen wird. Dieses Plugin verlangt nie, dass du ihm die einzige
Kopie anvertraust.

## Was es tut

1. **Erfasst** den vollständigen Gesprächsverlauf jeder Session, verlustfrei, wenn sie
   endet.
2. **Komprimiert** erfasste Sessions im Hintergrund (ein opportunistischer Batch-Job,
   kein Cron- bzw. geplanter Task) mit `claude -p`, um wiederverwendbares Wissen zu
   extrahieren — decisions, project facts, preferences, patterns, references,
   troubleshooting.
3. **Injiziert** einen Index dieses Bundles als verpflichtendes Gate in den Kontext
   jeder neuen Session, damit Claude relevantes früheres Wissen tatsächlich liest,
   bevor es an etwas Verwandtem arbeitet, statt jedes Mal bei null anzufangen.
4. **Visualisiert** das Bundle und deine Codebasis als einen Graphen und verknüpft
   jedes Konzept mit den Dateien, um die es tatsächlich geht (`/okf:okf-visualize`).

Alles liegt in einem lokalen git-Repository unter `~/.claude/okf` (oder
`$CLAUDE_CONFIG_DIR/okf`). Nichts wird irgendwohin gepusht. Die einzigen Netzwerkaufrufe
sind die, die du ohnehin schon an Anthropics API richtest — der Batch-Schritt ist nur ein
weiterer `claude -p`-Aufruf, lokal ausgeführt.

## Voraussetzungen

- Claude Code mit Plugin-Unterstützung
- Node.js (was auch immer `claude` selbst bereits voraussetzt — keine zusätzliche Runtime)
- git

Kein `npm install`-Schritt. Keine externen Dienste. Keine Konfiguration nötig, um
loszulegen.

## Installation

```
claude plugin marketplace add dja1369/okf-system
claude plugin install okf@okf-marketplace
```

(Stattdessen aus einem lokalen Klon installieren: `claude plugin marketplace add /path/to/your/clone`.)

Das war's — starte deine Session neu, und die Gate- und Capture-Hooks sind aktiv. Beim
nächsten Session-Start wird das Bundle automatisch gebootstrappt (unter `~/.claude/okf`
wird ein lokales git-Repo mit der Grundstruktur angelegt).

Zum Deinstallieren: `claude plugin uninstall okf`. Deine Daten in `~/.claude/okf` bleiben
unangetastet — es ist ein ganz normales git-Repo, das du inspizieren, sichern oder von
Hand mit `rm -rf ~/.claude/okf` löschen kannst.

## Verwendung

Im Normalbetrieb erfordert es nichts von dir. Capture und Batch-Komprimierung laufen
automatisch. Für manuelle Einsicht und Steuerung stehen fünf Commands bereit —
**beachte das Präfix `okf:`**, das nötig ist, weil es plugin-scoped Commands sind:

| Command | Was es tut |
|---|---|
| `/okf:okf-status` | Meldet den letzten Batch-Lauf, wartende Sessions und den Lock-Status |
| `/okf:okf-batch` | Erzwingt einen sofortigen Batch-Lauf (ignoriert das Intervall-Gate, respektiert aber weiterhin den Lock) |
| `/okf:okf-config` | Zeigt die aktuelle Konfiguration an und lässt dich sie bearbeiten |
| `/okf:okf-index` | Gibt eine lesbare Übersicht des Bundles aus — jede Kategorie und jeden Konzept-Titel, dazu die jüngsten Änderungen aus `log.md` |
| `/okf:okf-visualize` | Rendert das Bundle + deine Codebasis als einen interaktiven Graphen (eigenständiges HTML) |

Eine frische Installation ist nicht leer: Das Bundle wird mit Konzepten ausgeliefert,
die OKF selbst, die Architektur dieses Plugins und die Schreibregeln des Bundles
beschreiben — so hat das Gate ab der ersten Session etwas Echtes, worauf es zeigen kann,
und das Bundle dokumentiert sich selbst.

## Visualisierung

`/okf:okf-visualize` rendert dein Wissen und deinen Code als einen einzigen Graphen.
Interessant ist keine der beiden Hälften für sich — sondern die gestrichelten
Verbindungen dazwischen, die jedes Konzept mit den Quelldateien verknüpfen, über die es
tatsächlich spricht.

Wenn [Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) das Repo
bereits analysiert hat (`.understand-anything/` oder `.ua/knowledge-graph.json`), wird
dieser reichhaltigere, per LLM zusammengefasste Graph verwendet. Andernfalls baut der
eigene Analyzer dieses Plugins einen — reines Node, keine nativen Module; er extrahiert
Dateien, Funktionen, Klassen und den Import-Graphen über JS/TS, Python, Go, Rust,
Java/Kotlin, Ruby, PHP, C/C++, C# und Swift hinweg.

Die Ausgabe ist eine eigenständige HTML-Datei: kein CDN, keine Netzwerk-Requests, kein
Backend. Sie öffnet sich offline, denn das Öffnen der eigenen Wissensbasis sollte
nirgendwo anrufen.

## Wie es funktioniert

![Architektur: Sessions werden nach raw erfasst, ein Hintergrund-Batch destilliert daraus ein OKF-Bundle, und der Bundle-Index wird in die nächste Session zurückinjiziert](docs/architecture.svg)

- **Capture** ist eine reine Dateikopie — kein Parsen, kein Filtern, keine
  Größenbegrenzung. Bei jedem `SessionEnd` geht das vollständige Transcript nach `raw/`.
  Das ist Absicht: Eine Wissensbasis, die auf einer lückenhaften Erinnerung an das
  Geschehene beruht, ist schlechter als gar keine.
- **Komprimierung** passiert ausschließlich zur Batch-Zeit und auf einer Arbeitskopie —
  das erfasste Original wird nie angefasst. Sie läuft mit einem auf
  `Read/Glob/Grep/Write/Edit` beschränkten Tool-Zugriff (kein `Bash`) und mit allen
  *deinen* übrigen Hooks, Plugins und MCP-Servern für diesen einen Aufruf deaktiviert
  (`--safe-mode`), sodass sie nicht in eine Schleife zurückfallen und sich selbst
  erfassen kann.
- **Das Gate** injiziert einen kompakten Kategorie-Index (nicht den vollständigen
  Konzepttext) plus die jüngsten Änderungen und weist Claude an, die relevante Datei
  tatsächlich mit `Read` zu lesen, bevor es verwandte Arbeit anfasst — der Index allein
  reicht nicht aus, um auf veralteten Annahmen zu handeln.
- Ein struktureller Linter hält das Bundle durchgehend spec-konform: Würde ein Batch-Lauf
  irgendetwas fehlerhaft hinterlassen, wird er vor dem Commit automatisch zurückgerollt.

Hintergrund und Designbegründung des Formats stehen in Google Clouds [Ankündigung des Open Knowledge Format](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/?hl=en&utm_source=pytorchkr&ref=pytorchkr) — es sind einfach Markdown-Dateien
mit YAML-Frontmatter, von jedem Tool lesbar und nicht an dieses Plugin gebunden.

## Konfiguration

Bearbeite `~/.claude/okf/.okf/config.md` direkt (Frontmatter) oder nutze
`/okf:okf-config`.

| Key | Default | Bedeutung |
|---|---|---|
| `enabled` | `true` | Zentraler An/Aus-Schalter (Capture, Gate und Batch richten sich alle danach) |
| `batch_interval_hours` | `1` | Mindestabstand zwischen Batch-Läufen |
| `batch_max_digest_kb` | `600` | Budget pro Lauf für die gesamten Digest-Bytes — die eigentliche Kostenbremse. Sessions über dem Budget wandern in den nächsten Lauf |
| `batch_max_sessions` | `50` | Nur eine Sicherheitsobergrenze; der eigentliche Regler ist `batch_max_digest_kb` |
| `seed_language` | `en` | Sprache der beim ersten Bootstrap eingespielten Konzepte (`en`, `ko`; unbekannte Werte fallen auf `en` zurück) |
| `batch_model` | `claude-sonnet-5` | Modell für die Batch-Ingestion; leer = CLI-Standard |
| `batch_effort` | `medium` | Reasoning-Effort für die Batch-Ingestion (`low`/`medium`/`high`/`xhigh`/`max`); leer = CLI-Standard |
| `capture_exclude_cwd` | `[]` | Glob-Muster für Verzeichnisse, die von der Erfassung ausgenommen werden (nur Opt-out — die Erfassung selbst ist nie unvollständig) |
| `batch_digest_cap_kb` | `150` | Größenlimit pro Session für die ans LLM gehende Zusammenfassung (das erfasste Original wird nie begrenzt) |
| `remove_candidate_ttl_days` | `30` | Wie lange verarbeitete Roh-Transcripts vor dem Löschen aufbewahrt werden |
| `inject_max_lines` / `inject_max_bytes` | `120` / `16384` | Größenlimits für die Gate-Injektion |
| `claude_bin` / `node_bin` | *(leer)* | Absolute Pfade als Override, falls die Auflösung über `PATH` in deiner Umgebung fehlschlägt |

## Daten & Privatsphäre

- Alles bleibt lokal: `~/.claude/okf` ist ein eigenes, ganz normales git-Repository,
  vollständig getrennt von jedem Repository, in dem du gerade zufällig arbeitest.
  **Kein Codepfad in diesem Plugin führt jemals `git push`, `git remote add` oder
  irgendetwas Netzwerkbezogenes darauf aus** — die einzigen überhaupt irgendwo
  verwendeten git-Operationen sind `init`, `commit`, `checkout` und `clean`
  (nachprüfbar: `grep -n "push\|remote" lib/*.mjs bin/*.mjs` — die einzigen Treffer sind
  unzusammenhängende `Array.push()`-Aufrufe). Dein Bundle verlässt deine Maschine nie,
  es sei denn, du machst bewusst selbst ein `git push`.
- Der Batch-Schritt sendet Session-Inhalte an die Anthropic-API, um die
  Zusammenfassung/Extraktion durchzuführen — dieselbe API, mit der deine normale
  Claude-Code-Nutzung ohnehin schon spricht, nur über einen weiteren `claude -p`-Aufruf.
  Kein Drittanbieter-Dienst ist beteiligt.
- `raw/` (die vollständig erfassten Transcripts) und bereits verarbeitete, aber noch zur
  Löschung anstehende Transcripts sind git-ignoriert und werden nicht committet —
  committet wird nur das extrahierte Wissensbündel.

## Portabilität

Kein Pfad ist jemals hartkodiert — alles wird über `os.homedir()` /
`process.env.CLAUDE_CONFIG_DIR` / `process.env.HOME` aufgelöst, sodass eine frische
Installation auf einer anderen Maschine oder unter einem anderen Benutzerkonto ihr
eigenes, unabhängiges Bundle erzeugt. Das wird von der Test-Suite (`test/smoke.mjs`)
in isolierten `HOME`/`CLAUDE_CONFIG_DIR`-Sandboxes abgedeckt, darunter
eine **ganz ohne konfigurierte git-Identität** — das Plugin hängt nie von deinem
`user.name`/`user.email` ab; seine eigenen automatisierten Commits verwenden immer eine
feste synthetische Identität (`OKF Batch <okf-batch@localhost>`). macOS und Linux werden
auf diese Weise direkt abgedeckt; Windows-spezifische Pfade (`shell:true` für
`claude.cmd`, Pfadtrenner) sind gemäß den Anforderungen des Design-Dokuments
implementiert, wurden aber noch nicht auf einer echten Windows-Maschine ausgeführt —
behandle diese Kombination als unverifiziert, bis das jemand bestätigt.

## Lizenz

MIT
