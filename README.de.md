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
| `/okf:okf-deprecate <Ziel>` | Concept stilllegen — Datei und Links bleiben, das Gate injiziert es nicht mehr |

`visualize` scannt kein Repository. `analysis` lehnt fehlende/Nicht-Verzeichnis-Pfade ab und meldet Truncation, ausgeblendete irrelevante Concepts sowie Statistiken je Sprache. Beide erzeugen eigenständiges HTML ohne CDN oder Laufzeit-Netzwerk.

## Optionale Statusline

`bin/statusline.mjs` gibt ohne Netzwerk oder Graphanalyse eine Zeile wie `OKF 12 · +3 · 2h ago` aus. Claude Code erlaubt nur eine `statusLine`; OKF installiert oder überschreibt sie nicht. Die Ausgabe von `node /path/to/okf/bin/statusline.mjs` kann an ein bestehendes Skript angehängt werden.

## OKF-Benchmark

<!-- okf-benchmark: 2026-07-26-e3 -->

### Gate recall@cap — drei präregistrierte Runden, E1 → E3 (2026-07-26)

Alle drei Runden kosteten **$0,00**, und das wird durch den Lauf bewiesen statt behauptet: Der
Prüfstand legt einen Stub `claude` an den Anfang von `PATH`, misst nach, dass dieser Stub existiert,
und der Stub wird nie ausgeführt (`paidCallTrapInstalled: true`, `paidCallTrapTripped: false`).

Gemessen wird `recall(N)` — bei N Concepts im Bundle der Anteil der 20 eingefrorenen Fragen, deren
Antwort-Concept in den Index überlebt, den das Gate tatsächlich injiziert.

> **recall ist keine Trefferquote.** Es beantwortet nur, ob das Gate die relevante Zeile geladen hat.
> Ob das Modell diese Zeile **benutzt** hat, lässt sich ohne kostenpflichtige Aufrufe nicht prüfen.
> Synthetische Distraktoren liefern nur eine **Obergrenze**, der reale recall liegt also darunter.

**Bedingungen** — 3 Perturbationen × 5 Stufen × 20 Seeds = 300 Stichproben, 28 s. Dem Frontmatter-
**`title`** des Antwort-Concepts werden vier Zeichen vorangestellt; Text, Dateiname und Pfad bleiben
unverändert.

| N | `none` | `front` (`!!! `) **wie publiziert** | `front` **quote-sicher** | `back` (`힣힣 `) |
|---|---|---|---|---|
| 24 | 0,400 ± 0,000 | 1,000 ± 0,000 | **0,400** | 0,400 ± 0,000 |
| 50 | 0,277 ± 0,038 | 0,560 ± 0,064 | **0,400** | 0,182 ± 0,044 |
| 100 | 0,247 ± 0,034 | 0,523 ± 0,030 | **0,400** | 0,170 ± 0,025 |
| 200 | 0,250 ± 0,040 | 0,528 ± 0,030 | **0,400** | 0,175 ± 0,026 |
| 400 | 0,262 ± 0,039 | 0,533 ± 0,024 | **0,400** | 0,185 ± 0,024 |

n=20 pro Zelle. E1 lief nur mit `none` bei einem um 11 B kleineren Budget und ergab
0,400 / 0,277 / 0,245 / 0,248 — eine **andere Bedingung**, weder besser noch schlechter als oben.

**Die publizierte `front`-Spalte ist kontaminiert, und gefunden hat das ihr eigener Guard.** `!!!` ist
ein YAML-**Tag-Indikator**. Vor einen *nicht gequoteten* `title:` gesetzt, zerstört er das Frontmatter
vollständig: Der Typ geht verloren, der Linktext fällt auf den Dateinamen zurück, und **die
Description verschwindet**, wodurch die Zeile von ~700 B auf ~30 B kollabiert. **14 der 20
eingefrorenen Fragen haben nicht gequotete Titel.** Für diese 14 maß das Experiment also nicht die
Sortierposition, sondern das **Parsing-Versagen** — kurze Zeilen lassen weit mehr Zeilen ins gleiche
Budget, genau das sind die bei N=24 beobachteten `taken` = 24 und 263 B mittlere Zeilenlänge. Mit
quote-sicherem Präfix neu gemessen, kollabiert `front` auf konstante **0,400**. `none` und `back`
bewegen sich um keine einzige Stelle, was die Korrektur als neutral bestätigt und zugleich zeigt, dass
`힣힣 ` nie etwas zerstört hat.

**Was bleibt und was fällt.** Dass die Sortierung über das Überleben entscheidet, bleibt bestehen: Bei
N=400 beträgt der quote-sichere Spread 0,400 − 0,185 = **0,215**, immer noch das **4,3-Fache** der
Widerlegungsschwelle von 0,05, und dass `back` den recall von 0,262 auf 0,185 drückt, ist ein reiner
Ordnungseffekt. **In einem System ohne jedes Relevanzsignal ist das das erwartete Ergebnis und keine
Bug-Entdeckung** — neu ist die Größenordnung. Drei publizierte Größenordnungen überleben jedoch nicht:
„vier Zeichen verdoppeln den recall" ist 2,03× → **1,53×**; „N=24 geht von 0,400 auf 1,000" wird zu
**keiner Änderung**; und E1s `cwdIndependent`-Sprung von 0,000 → 0,967 wird zu **0,000 → 0,333**. An
ihre Stelle tritt eine neue Tatsache: **Sortieren Concepts nach vorn, hängt der recall überhaupt nicht
mehr von N ab** (konstant 0,400 über einen 17-fachen Bereich der Bundle-Größe), weil dann `taken` und
nicht N das Überleben begrenzt.

**Die Überlebensbedingung ist exakt `rank < taken`** — ein Concept überlebt genau dann, wenn sein
Titel-Sortierrang innerhalb seiner Kategorie kleiner ist als die Zahl der Zeilen, die diese Kategorie
bekommen hat. recall ist damit eine **vollständige** Funktion der Vektoren rank und `taken` und
zerlegt sich ohne Näherung. Bei N=24→50 dominiert die rank-Komponente (−0,15 bis −0,41); ab N≥100
stirbt sie auf ~0 — ein Bodeneffekt: Der mittlere Antwortrang (26,9) liegt weit jenseits von `taken`
(10,5), mehr Füllmaterial ändert an bereits ausgeschlossenen Concepts nichts. Mitpubliziertes Caveat:
Die Zerlegung ist **Buchhaltung, keine Kausalität**, und ihre Komponenten hängen von der Basislinie ab.

**Zwei Korrekturen von E3 an E2 und eine an sich selbst.** E2 berichtete, der recall steige von N=100
bis 400 „monoton", und übergab die Erklärung an E3. Beim präregistrierten n=20 lässt sich dieser
Anstieg **gar nicht belegen** — 0 von 12 benachbarten Paaren sind `rising`. E3s erste publizierte
Überschrift schloss daraus, der Anstieg „existiere nicht"; **das war falsch**, und eine adversariale
Trennschärfe-Prüfung fand es: Bei n=60 sind drei Paare `rising` (p bis hinunter zu 0,00027), und in
allen dreien trägt die `taken`-Komponente 100 % der Bewegung, während die rank-Komponente exakt 0 ist.
Der Anstieg ist real, aber **nicht substanziell** (Median-KI = [0,000, 0,000]). E3 ersetzte außerdem
E2s Regel `|Δ| ≤ 0,05` — die „flach" mit „klein, aber konsistent" vermengt — durch einen exakten
gepaarten Vorzeichentest plus ein verteilungsfreies Median-Konfidenzintervall und gibt Richtung und
Größe als zwei getrennte Werte aus.

**Das alte R3 feuerte auf Rauschen.** Sein Wortlaut war „monotone Abnahme verletzt → *Prüfstandsdefekt*
→ alles verwerfen", implementiert war aber ein Mittelwertvergleich ohne jede Unsicherheitsbehandlung,
sodass ±0,005 Seed-Rauschen es in E1 wie in E2 auslöste — beide Runden erschienen im selbstwidersprüch-
lichen Zustand „gefeuert, aber nichts verworfen". E3 lockerte die Schwelle nicht, sondern richtete das
Kriterium wieder auf das, was sein Wortlaut sagt, und maß Integrität direkt. Auf denselben 300
Stichproben feuert das alte R3 und das neue R3a nicht.

**Im Live-Bundle lässt sich die Sortierverzerrung noch nicht belegen.** Nur lesend gemessen, es werden
ausschließlich Zählungen ausgegeben — Titel, Beschreibungen, Dateinamen und Links verlassen die Messung
nicht, und `raw/` wird nie geöffnet. Sortiert wird per `<` über `title.toLowerCase()`, also
**UTF-16-Codeunit-Reihenfolge, keine Locale-Kollation**; ein Titel mit ASCII-Anfang steht damit immer
vor einem mit Hangul-Anfang. ASCII-beginnende Concepts machen 65,4 % des Bundles aus und belegen 70,6 %
der Gate-Plätze — bei 26 Concepts liefert der exakte hypergeometrische Test gegen eine stratifizierte
Nullhypothese jedoch **p = 0,667**. Das ist kein Ergebnis. Ein kleiner Lift darf auch nicht als
„Sortierung ist harmlos" gelesen werden: Das Gate lädt derzeit **65,4 %** aller Kandidaten, und wo
alles geladen wird, entscheidet die Sortierung nichts (2 von 6 Kategorien haben null Freiheitsgrade).
Pro Kategorie spaltet sich die Laderate bereits auf — `decisions`/`projects` 1,000, `patterns` 0,500,
`references` **0,429**. Ein früherer Entwurf behauptete, eine sinkende Laderate verstärke den Effekt;
**die eigenen Daten des Benchmarks widerlegen das**, deshalb wurde die Behauptung zurückgezogen.

**Wer einen Platz bekommt, entscheiden Reihenfolge und Zeilenlänge, nicht Relevanz.** Fünf Faktoren
sind im Code bestätigt: Groß-/Kleinschreibung-sensitive Sortierung der Typ-Sektionsnamen, sodass
`# Subdirectories` immer vor `# reference` steht (`lib/index-gen.mjs:242`) und verschachtelte Concepts
an den Anfang ihrer Kategorie zieht; innerhalb einer Sektion die alphabetische Reihenfolge des
Frontmatter-**`title`** — nicht des Dateinamens, der nur ein Fallback bei Parsing-Fehlern ist
(`:315`); `status: deprecated` wird nach hinten gesetzt (`:245`); die Kategorie-Reihenfolge nach
Verzeichnisnamen (`:227`); und die **Zeilenlänge in Bytes**, denn eine nächste Zeile über dem
Restbudget stoppt diese Kategorie (`lib/gate.mjs:122`). Das Gate enthält keinerlei Bezug auf cwd,
Aktualität oder die Anfrage.

**Der Befund ist die Form, nicht das Niveau.** Von den 20 Fragen überleben 9 auf jeder Stufe mit 0 und
3 mit 1,0; die übrigen 8 liegen dazwischen — recall ist nicht binär. Das Gate füllt im Round-Robin,
bis das Budget erschöpft ist; eine Kategorie endet nur deshalb bei 1–3 Zeilen, weil eine einzelne Zeile
groß ist (200–1.030 B gegen ein Index-Budget von ~6.960 B), sodass die Gesamtaufnahme bei 8–11 Zeilen
erschöpft ist. `references` bekommt auf jeder Stufe genau eine Zeile, von den 8 dort konzentrierten
Antworten kann also höchstens eine überleben.

**Verschachtelungstiefe (Achse A-2).** 25 Concepts fixiert, Inhalte identisch, nur die Pfade tiefer:

| Bedingung | injizierte Concept-Zeilen | Subdomain-Links |
|---|---:|---:|
| flach | 28 | 0 |
| 2 Ebenen | 27 | 0 |
| 3 Ebenen | 26 | 0 |
| 4 Ebenen | 25 | 0 |

Jede Bedingung wurde **einmal** gemessen (n=1, keine Seed-Wiederholung), und in dieser einen Messung
ging pro Tiefenebene eine Zeile verloren. Vier Punkte können nicht zeigen, ob der Rückgang linear ist,
und Tiefen jenseits von 4 wurden nicht gemessen. Gegen die gepflanzten Concepts gerechnet sind 3 Ebenen
25 → 23, **−8,0 %**. Die Ursache ist Byte-Druck, kein fehlgeschlagener Kettendurchlauf: Jedes weitere
Pfadsegment verlängert jede Zeile, bis eine aus dem Budget gedrängt wird.

**R2 feuert in jeder Runde** (`recall(24)` = 0,400 < 0,60). Nach der präregistrierten Handhabungsregel
**entscheiden die absoluten recall-Werte nichts** — die Tabellen werden publiziert und steuern keine
Politik.

**Messdisziplin und wo sie besser wurde.** In E1 kamen die Fixtures erst im **Report**-Commit ins Git —
die Schwellen standen vorab fest, das Material, das die Zahlen tatsächlich bestimmte, jedoch nicht. Ab
E2 liegen die Fixtures im Präregistrierungs-Commit, und der Smoke-Test erzwingt über
`git log --diff-filter=A` eine **strikte** Ungleichung; auf E1s Dateimenge gerichtet erzeugt sie 3
Verstöße, fängt den realen Unfall also ab, statt ihn zu billigen. Jede Runde publiziert die zum
Zeitpunkt ihrer Präregistrierung bereits bekannten Werte sowie jede nach der Messung geänderte
Arithmetik — E3 quantisierte die recall-Deltas auf das 1/20-Raster, weil `0,25 − 0,20 = 0,04999…`
gegenüber `0,20 − 0,15 = 0,05000…2` dieselbe Ein-Frage-Bewegung auf entgegengesetzte Seiten der
Äquivalenzgrenze legte; diese Korrektur beseitigte das einzige `indeterminate`-Urteil der Runde, wirkte
also **gegen** das eigene Argument des Reports, und wird als solche offengelegt. Anschließend zeigte
die adversariale Prüfung, dass der Guard für die Überlebensidentität nahezu tautologisch war (er rief
genau die Funktion erneut auf, die er prüfte); der nicht-zirkuläre Ersatz feuerte **beim ersten Lauf** —
so wurde die obige `front`-Kontamination gefunden. Ein offener Defekt wird getragen statt geraten:
Derselbe Guard feuert auch bei 8 von 100 unperturbierten Stichproben, die Ursache ist noch nicht
identifiziert.

```sh
node test/gate-recall.mjs --e3 --perturb all   # 3 Bedingungen × 5 Stufen × 20 Seeds, ~28 s
node test/gate-recall.mjs --e3 --perturb all --quote-safe-perturb   # das korrigierte Präfix
node test/gate-title-distribution.mjs          # Titelverteilung im Live-Bundle (nur lesend)
node test/gate-recall.mjs --e2 --perturb all   # E2
node test/gate-recall.mjs                      # E1
node test/bench-nesting.mjs                    # Achse Verschachtelungstiefe
node test/smoke.mjs                            # Regressions-Guards
```

[E3-Report](docs/benchmarks/gate-recall-2026-07-26-e3.md) ·
[E3-Präregistrierung](docs/benchmarks/pre-registration-2026-07-26-e3.md) ·
[E2-Report](docs/benchmarks/gate-recall-2026-07-26-e2.md) ·
[E2-Präregistrierung](docs/benchmarks/pre-registration-2026-07-26-e2.md) ·
[E1-Report](docs/benchmarks/gate-recall-2026-07-26-e1.md) ·
[E1-Präregistrierung](docs/benchmarks/pre-registration-2026-07-26-e1.md)

<!-- okf-benchmark: 2026-07-27-efficiency -->

### Gate-Effizienz — verdient das Indexformat seine Bytes? (Achse E, 2026-07-27)

E1–E3 haben ausschließlich OKFs eigene Eingaben variiert, deshalb ließ sich „verdient das Format
seine Bytes?" gar nicht stellen — es gab keinen Vergleichsmaßstab. Achse E stellt einen auf:
**dasselbe Bundle, dasselbe Byte-Budget, sechs ausgetauschte Indexstrategien.** Kosten: **$0,00**,
erneut nicht behauptet, sondern zur Laufzeit über die PATH-Falle bewiesen.

Die Fragen sind nicht mehr handgeschrieben. Zu jedem der 20 Antwort-Concepts wird die Anfrage
maschinell aus den acht stärksten tf-idf-Termen seines eigenen **Fließtexts** gebildet — also genau
aus dem Teil, den der Index nie transportiert. Der Retriever ist BM25 mit vor der Messung
festgelegten Standardparametern; seine Längennormalisierung bestraft lange Zeilen, die Wahl ist
also **gegen** OKF geneigt. Die Zahl der Seeds (40) stammt aus einer Trennschärfeberechnung vor dem
Lauf, nicht aus einer früheren Runde.

**Von fünf präregistrierten Hypothesen halten zwei stand, drei sind widerlegt.**

| Hypothese | Urteil | Beleg |
|---|---|---|
| Titel+Beschreibung schlägt reine Kategorielinks | **gestützt** | okf gewinnt 12/12 Zellen, alle p<1e-4 |
| Beschreibungen verdienen ihre Bytes | **widerlegt** | ohne sie gewinnt der Index 12/12 Zellen bei gleicher Reihenfolge |
| Round-Robin verdient seinen Overhead | **bedingt widerlegt** | −0,050 bei Cap 2048; +0,017…+0,218 bei Cap 9000 |
| ein sortierter Index schlägt einen zufälligen | knapp gestützt | okf gewinnt 7/12 — verliert aber alle drei Zellen bei N=26 |
| Pfade allein genügen nicht | **widerlegt** | der reine Pfadindex gewinnt 8/12 Zellen |

Die erste Zeile schließt etwas ab, das nie gemessen worden war. Die Architekturnotiz des Live-Bundles
begründet den Wechsel vom 2026-07-17 („nur Kategoriezahlen" → „Titel + Beschreibung") mit einer
**einzigen Anekdote** und beziffert die Kosten mit **n=3**. Jetzt gibt es eine Zahl.

**Das Format kauft Präzision und verkauft Kapazität.** Eine OKF-Zeile wird, einmal eingespielt, fast
immer auf Platz 1 gerankt (Präzision 0,93–1,00); der Engpass ist, dass in die voreingestellten
9.000 Bytes nur etwa 12–14 Concept-Zeilen passen. Nur-Titel-Zeilen fassen bei N=26 alle 26
(Präzision 0,649), Nur-Pfad-Zeilen ebenfalls alle 26 (Präzision 0,350). **Beschreibungen machen rund
82 %** der Zeilenbytes aus — 733 B pro Zeile, ohne sie 133 B.

**Das Vorzeichen von Round-Robin kippt mit dem Budget.** Sechs Kategorien belasten je eine
Überschrift und einen Auslassungsmarker vorab, deshalb frisst dieser Fixkostenblock bei Cap 2048 den
Nutzen auf allen vier Bundle-Größen auf (−0,050); beim ausgelieferten Standard von 9.000 zahlt er
sich aus, und der Gewinn wächst mit dem Bundle (+0,218 bei N=200). **Der ausgelieferte Standard ist
an seinem eigenen Arbeitspunkt richtig** — und der Code wendet Round-Robin unabhängig vom Budget an.

> **Das heißt nicht „Beschreibungen weglassen".** Diese Runde misst das **Finden**, nicht das
> **Antworten**. Gate-Regel 1 verspricht: „Wenn Titel und Beschreibung die Antwort enthalten, zitiere
> die Zeile ohne Read" — und genau dieser Weg stirbt ohne sie. Ob Beschreibungen ihre 82 %
> zurückzahlen, ist die **kostenpflichtige Achse, die nie gelaufen ist.** Diese Runde liefert ein
> Preisschild, kein Urteil.

**Live-Bundle, nur lesend, ausschließlich Anzahlen und Bytes.** 26 Concepts / 108.431 B. Das Gate
verbraucht **8.885 B — 98,7 % seines Budgets — um 14 von 26 Concepts (53,8 %) zu zeigen.** Die
Kompression beträgt 12,2×; 71,6 % der eingespielten Bytes sind Wissen, 28,4 % Struktur, davon allein
1.341 B der `log.md`-Tail (15,1 % der Injektion, das 2,6-Fache von Überschriften plus
Auslassungsmarkern). Das synthetische Bundle sagte diese Abdeckung von 53,8 % auf **2,3 Punkte genau**
voraus — eine externe Kontrolle der Synthese.

**Die Runde hat vor der Veröffentlichung einen eigenen Defekt gefunden.** Im ersten registrierten Lauf
lag die Trefferquote der Nur-Pfad-Strategie in allen 12 Zellen bei 0,000. Das liest sich wie ein
Befund und war ein Bug: Der Scorer extrahierte Pfade nur aus Markdown-Linksyntax. Nach der Korrektur
kippte jene Hypothese von gestützt zu widerlegt. Alle neun neuen Smoke-Assertions wurden einzeln
mutationsgetestet; alle sechs Mutationen töteten ihren Guard.

**Nicht gemessen — und genau so veröffentlicht**: BM25 ist lexikalische Überlappung, kein
Modellurteil; das Bundle ist synthetisch, also ist dies eine Obergrenze; die Liste der
Antwort-Concepts ist weiterhin von mir ausgewählt (maschinell sind nur die Anfragen); die
`paths`-Werte hängen daran, dass dieses Bundle koreanischer Fließtext mit englischen Slugs ist;
n=40 erkennt einen über 80 % der Seeds konsistenten Effekt mit Trennschärfe 0,981, bei 70 % aber nur
0,703 — „kein Unterschied" heißt hier also „nicht nachgewiesen"; die Live-Stichprobe ist das Bundle
eines einzigen Autors; Tokenzahlen wurden mangels Offline-Tokenizer nicht gemessen; und es lief keine
unabhängige adversariale Prüfung — die Verifikation erfolgte durch mich selbst.

```sh
node test/gate-efficiency.mjs                    # 4 Größen × 3 Budgets × 40 Seeds, ~30 s
node test/gate-efficiency.mjs --determinism-check
node test/gate-live-efficiency.mjs               # Live-Bundle, nur lesend
```

[Bericht Achse E](docs/benchmarks/gate-efficiency-2026-07-27.md) ·
[Präregistrierung Achse E](docs/benchmarks/pre-registration-2026-07-27-efficiency.md)

### Bezahlter Ende-zu-Ende-Lauf (v3, 2026-07-16)

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
| `sweep_backfill_days` | `0` | Tage **vor** dem Installationsmarker, bis zu denen der Sweep zurückgreifen darf; `0` (Standard) = nur Konversationen nach der Installation. Das harte 7-Tage-Fenster begrenzt es weiterhin. |
| `batch_max_usd_per_day` | `0` | Tägliche LLM-Ausgabenobergrenze in USD; `0` = unbegrenzt (Standard). Die Kosten werden ohnehin erfasst und angezeigt. Nur Best-Effort — der Zähler liegt in `.okf/last-batch.json`. |

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
