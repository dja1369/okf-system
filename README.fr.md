# OKF for Claude Code

**Transforme les décisions de sessions Claude Code passées en connaissances locales et vérifiables qu’une session future peut réellement utiliser.**

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · **Français** · [Deutsch](README.de.md) · [Português](README.pt-BR.md)

OKF capture la conversation à la fin d’une session, extrait décisions et solutions réutilisables en Markdown, puis injecte un index compact à la session suivante. Le bundle est un dépôt git local que vous pouvez lire, comparer, sauvegarder ou supprimer.

## Démarrage en une minute

Prérequis : Claude Code avec plugins, Node.js et git. Aucun `npm install`.

```sh
claude plugin marketplace add dja1369/okf-system
claude plugin install okf@okf-marketplace
```

Redémarrez Claude Code, terminez une session normale, puis exécutez :

```text
/okf:okf-status
/okf:okf-index
```

Le premier `SessionStart` crée `~/.claude/okf` (ou `$CLAUDE_CONFIG_DIR/okf`). Collecte et batch opportuniste sont automatiques, et une conversation est collectée environ une heure après sa dernière activité, donc il n’est pas nécessaire de terminer une session explicitement.

## Boucle de continuité

```text
Session 1               ~1h idle                Batch en arrière-plan       Session 2
décision            -> sweep collecte raw ->    Markdown OKF réutilisable -> index compact injecté
(pas de fin              (copie sans perte ;         |                              |
 explicite requise)       la croissance re-collecte) +-- historique git local       +-- Read du concept pertinent
```

Ainsi, « déployer 10 % → 50 % → 100 %, rollback au-dessus de 0,5 % d’erreurs » peut être retrouvé sans nouvelle saisie. L’index sert de routage ; Claude doit `Read` le concept avant d’agir.

Pourquoi une base sur l’idle ? Les sessions se terminent rarement de façon explicite — les agents en arrière-plan ne le font jamais — et un instantané de fin de session pris au moment du `resume` figeait autrefois une conversation en plein vol comme « traitée », perdant tout ce qui suivait. Le sweep collecte donc un transcript une fois qu’il est resté silencieux pendant `sweep_min_idle_minutes` (60 par défaut), le batch patiente jusqu’à ce que les conversations en attente atteignent l’inactivité (sondage toutes les ~5 minutes, jusqu’à 8 heures), une session déjà collectée n’est **re**-collectée que si elle a grandi depuis, et une session inchangée n’est jamais recollectée. Les hooks de session ne font que réveiller le batch.

## Commandes

| Commande | Rôle |
|---|---|
| `/okf:okf-status` | Dernier batch, sessions en attente et verrou |
| `/okf:okf-batch` | Ingest immédiat en respectant le verrou |
| `/okf:okf-config` | Afficher ou modifier la configuration validée |
| `/okf:okf-index` | Catégories, titres et changements récents |
| `/okf:okf-visualize` | Concepts OKF et liens entre concepts uniquement |
| `/okf:okf-analysis [chemin]` | Dépôt analysé avec seulement les concepts OKF liés |

`visualize` ne scanne aucun dépôt. `analysis` refuse les chemins absents/non-répertoires et signale analyse tronquée, concepts sans rapport masqués et statistiques par langage. Les deux produisent un HTML autonome, sans CDN ni réseau à l’exécution.

## Statusline optionnelle

`bin/statusline.mjs` affiche une ligne telle que `OKF 12 · +3 · 2h ago`, sans réseau ni analyse globale. Claude Code n’accepte qu’un `statusLine`; OKF ne l’installe ni ne l’écrase. Ajoutez la sortie de `node /path/to/okf/bin/statusline.mjs` à votre script existant.

## Benchmark de l’effet OKF

<!-- okf-live-benchmark: valid-2026-07-15T16-06-28Z -->

**OKF ne fait pas économiser de tokens. Il récupère ce qu’une session neuve a déjà perdu.** Ces chiffres sont publiés parce qu’ils le disent sans détour.

Une session de suivi doit restituer huit faits établis par une session précédente : architecture (SQLite / repository pattern), règle de code (named export uniquement), correctif d’un incident passé (`busy_timeout=5000`), préférence de réponse (coréen / concis), fichier et politique de déploiement (`src/config.mjs` / `npm run deploy:canary`) — plus un contrôle arithmétique sans rapport (7 × 8 = 56). Le bundle de C vient d’une vraie collecte dans `raw/` → batch isolé → gate SessionStart ; un preflight refuse de dépenser tant que C ne contient et ne route pas chaque fait, et que D n’en contient aucun.

Run live du 2026-07-15 : Claude Code `2.1.210`, `sonnet`/medium (Sonnet 5 + Haiku 4.5), macOS arm64, Node `v26.4.0`, cinq répétitions croisées par condition. Preflight C : 8/8 faits présents, 8/8 routés ; D : 0/8.

| Condition | Continuité | Conformité p50 | token activity p50/p95 | wall p50/p95 | coût p50 |
|---|---:|---:|---:|---:|---:|
| A — no memory | **0/5** | 12% | 27,246/27,518 | 13.82/18.17 s | $0.022218 |
| B_oracle (le corrigé) | 5/5 | 100% | 9,069/9,069 | 4.86/6.46 s | $0.008410 |
| B_realistic | 5/5 | 100% | 9,069/9,069 | 5.96/6.27 s | $0.008410 |
| **C — OKF enabled** | **5/5** | 100% | **10,395**/10,459 | 6.46/7.15 s | $0.011329 |
| D — irrelevant OKF | 0/5 | 0% | 20,602/21,662 | 14.50/21.15 s | $0.025879 |

Les tool calls derrière ces lignes, parce qu’ils expliquent les chiffres : A lit 2 fichiers sur 4 tours et échoue quand même ; B répond en 1 tour avec 0 lecture, les réponses étant déjà dans son prompt ; **C répond en 1 tour avec 0 lecture** — l’index du gate a suffi ; D lit 1 fichier sur 2 tours en cherchant ce que son gate n’a jamais contenu.

Lisez le `p95` avec prudence : à n=5, `ceil(0.95×5)−1` est le dernier index, donc le p95 **est** le max — un unique run à cache froid, pas une statistique de queue. Il est rapporté parce que le format demandé l’exige, pas parce qu’il en est une.

**Lisez d’abord la ligne A.** Sans mémoire, la session brûle 27,246 tokens, lit deux fichiers en cherchant une réponse, prend quatre tours — et répond quand même **0/8**. C’est la condition qu’OKF remplace réellement, et C la bat : 2.6× moins de tokens, 8/8 en un seul tour, sans aucune lecture.

**C ne bat pas B, et ne le battra jamais.** La chaîne de restitution de B_oracle contient les réponses elles-mêmes : la produire exige de déjà connaître chaque fait qu’OKF existe pour récupérer. **Aucun utilisateur ne peut occuper cette condition** — c’est une borne supérieure, dont le travail humain est facturé zéro. B_realistic (tout restituer, faute de savoir d’avance ce qui servira : l’habitude CLAUDE.md) est la vraie comparaison, et le break-even se calcule contre elle. À cette taille de bundle les deux valent 9,069 ; C coûte 1,326 tokens et $0.0029 de plus par session. Construire le bundle a coûté un batch de **133,364** token activity et **$0.176758**. **Aucun break-even token ou coût n’existe** — `perSessionTokenSaving` est négatif, donc le harness renvoie `null` au lieu d’en inventer un.

Ce qui a changé depuis le run précédent, c’est le gate lui-même. C coûtait **22,857** tokens sur 7 tours avec 5 lectures ; il coûte maintenant 10,395 en 1 tour, 0 lecture, à rappel identique 5/5. L’ancien gate imposait un `Read` inconditionnel, et 91% de son overhead était cet aller-retour qui re-récupérait des faits déjà livrés par l’index. Voir [le correctif](https://github.com/dja1369/okf-system/pull/7).

### La limite d’accumulation — mesurée, pas projetée

**« OKF devient moins cher à mesure que la connaissance s’accumule » est faux.** Il devient plus cher, et plus vite que l’alternative. Même benchmark, même bundle, avec 20 concepts sans rapport ajoutés — tout tient encore dans l’index (21 lignes, 5,548 octets sur 9,000, rien de tronqué) :

| Condition | Continuité | Conformité p50 | token activity p50/p95 | wall p50/p95 | coût p50 |
|---|---:|---:|---:|---:|---:|
| A — no memory | 0/5 | 0% | 27,316/27,717 | 13.79/18.05 s | $0.022838 |
| B_oracle (le corrigé) | 5/5 | 100% | 9,070/9,085 | 5.33/6.78 s | $0.008410 |
| B_realistic | 5/5 | 100% | 10,406/10,406 | 5.72/9.62 s | $0.010134 |
| **C — OKF enabled** | **5/5** | 100% | **25,384**/25,773 | 11.75/13.15 s | $0.030721 |
| D — irrelevant OKF | 0/5 | 0% | 22,265/22,334 | 14.91/19.59 s | $0.037354 |

Face au run à 0 filler : B_realistic a grandi de **+1,337** (9,069 → 10,406) tandis que C a grandi de **+14,989** (10,395 → 25,384). **C se dégrade ~11× plus vite** — 749 tokens par concept ajouté contre 67. Les deux répondent toujours 5/5 : c’est une régression de coût pure, pas de précision.

La cause n’est pas la troncature, c’est la confiance :

```text
0 filler  :  C reads=0  turns=1    répond directement depuis la ligne d’index
20 filler :  C reads=3  turns=4    retourne ouvrir les fichiers
```

Vingt concepts sans rapport ont suffi à ce que le modèle cesse de croire la ligne d’index et aille vérifier dans le fichier — ressuscitant exactement l’aller-retour que le correctif du gate avait supprimé. L’index dit qu’une ligne existe ; il ne dit pas qu’elle est la réponse *complète*, donc à mesure que le bruit environnant grandit, vérifier devient le choix rationnel. **C’est le vrai plafond, et il arrive vers ~21 concepts — bien avant que le moindre plafond technique ne morde.**

La troncature est le second mur, plus loin. L’index du gate est plafonné sous le seuil de 10,000 caractères des hooks, et une ligne de concept coréenne réelle pèse ~214 octets :

| Concepts dans le bundle | Affichés dans l’index |
|---:|---:|
| 20 | 20 |
| 40 | 40 |
| **55** | **43** (tronqué) |
| 100 | 43 (tronqué) |

Au-delà d’environ 43 concepts l’index tronque, et les survivants sont choisis par nom de fichier — ni pertinence, ni récence. Un run avec 50 concepts de remplissage **échoue au preflight** pour exactement cette raison (`presentFacts: 8, routedFacts: 6, ready: false`) : `decisions/tech-stack.md` s’est trié derrière le filler et a été coupé, emportant deux faits. Les catégories sont distribuées à tour de rôle pour qu’aucune ne soit privée, et chaque catégorie tronquée pointe vers son propre `index.md` — mais descendre est un aller-retour d’outil, le même coût à nouveau.

Aucun des deux murs n’est un réglage. Corriger le premier exige que l’index signale *quelles lignes sont des réponses complètes*, pour que le modèle s’y fie sans ouvrir le fichier ; ce travail n’est pas fait, et tant qu’il ne l’est pas, l’économie d’OKF empire avec chaque concept ajouté.

Run d’accumulation : [raw JSON](docs/benchmarks/raw/okf-live-2026-07-15T16-30-11-404Z.json). L’échec au preflight à 50 filler est conservé dans l’[audit preflight](docs/benchmarks/raw/okf-live-preflight-failed-2026-07-15T16-11-37-402Z.json) — un résultat négatif gardé volontairement.

Sont aussi mesurés : conformité aux décisions, hypothèses fausses, questions, tool calls, première réponse valide, temps API/wall, `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` et coût CLI. Les catégories restent séparées dans le JSON. `tokenActivity` somme les cache reads 1:1 avec les tokens de sortie alors qu’ils sont facturés ~50× moins cher : **le coût est la colonne défendable**. Les tokens user-only/gate-only non exposés séparément restent `null`, sans estimation.

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                      # tel que publié ci-dessus
OKF_RUN_LIVE_BENCH=1 OKF_BENCH_FILLER=50 node test/bench-okf.mjs  # axe d’accumulation
```

Exécution payante et opt-in, exclue de CI. Voir le [rapport valide](docs/benchmarks/okf-live-2026-07-15T16-06-28-592Z.md), le [raw JSON](docs/benchmarks/raw/okf-live-2026-07-15T16-06-28-592Z.json) et [docs/USAGE.md](docs/USAGE.md). Le run précédent, avant correctif, est conservé comme piste d’audit.

### Overhead local — pas le résultat d’efficacité

Mesure fraîche du 2026-07-16, macOS arm64, Node `v26.4.0` :

| Opération | Médiane | Plage |
|---|---:|---:|
| Processus SessionStart gate | 57.2 ms | 56.9–58.1 ms |
| Processus trigger SessionEnd | 41.4 ms | 39.0–42.1 ms |
| Processus statusline | 35.0 ms | 35.0–35.2 ms |

Reproduire avec `node test/bench.mjs [dépôt]`. Cela mesure le coût local, pas une économie de tokens ni la vitesse du modèle.

### Coût batch et break-even

```text
coût OKF initial = batch ingest + repair + overhead mesuré du gate non pertinent
économie nette/session = médiane B_realistic - médiane OKF
sessions break-even = ceil(coût initial / économie positive par session)
```

La comparaison se fait contre **B_realistic**, pas B_oracle : la chaîne de B_oracle contient les réponses, elle facture donc à zéro exactement le travail qu’OKF existe pour faire, et un break-even contre elle n’aurait aucun sens. Sur le run mesuré l’économie est négative dans les deux cas (−1,326 tokens, −$0.0029) : les deux champs break-even renvoient `null`. C’est le résultat, pas une lacune du harness.

## Langages pris en charge

L’analyseur fallback est déterministe, sans dépendance et conservateur ; il distingue fichier découvert et structure analysée.

| Langage | Relations et déclarations | Limites principales |
|---|---|---|
| JS / TS | import/export/require relatif, function/class | packages bare externes |
| Python | modules dotted, function/class | imports dynamiques omis |
| Go | package nodes internes via `go.mod`, function/struct | pas de faux file edges |
| Rust | `mod`/`use`, function/struct/enum/trait | macros omises |
| Java / Kotlin | package/class paths, types et Kotlin function | réflexion omise |
| Ruby | `require_relative`, class/method | gems externes |
| PHP | namespace/use/alias/grouped use, require/include, types/function | autoload dynamique omis |
| C / C++ | quoted include, angle local unique avec chemin explicite, types/namespace/function definition | regex : macros et syntaxe multilignes complexe parfois manquées |
| C# | namespace nodes déclarés, types principaux | namespaces externes non liés |
| Swift | inheritance/conformance/extension explicites, types/function | targets nested inter-fichiers omis contre les collisions |

À 2 000 fichiers, `truncated` est signalé ; les fichiers de plus de 512 Kio restent visibles mais non analysés.

## Validation open source réelle

Des commits fixes ont été clonés et des edges représentatifs vérifiés dans le source. Les temps servent uniquement à la sécurité opérationnelle.

| Dépôt | Commit | Fichiers langage | Déclarations | Internal edges | Truncated |
|---|---|---:|---:|---:|---:|
| [Slim](https://github.com/slimphp/Slim) | `80900fb` | 125 | 127 | 305 | non |
| [Redis](https://github.com/redis/redis) | `f76dff7` | 784 | 5,796 | 990 | non |
| [fmt](https://github.com/fmtlib/fmt) | `a79df45` | 46 | 283 | 121 | non |
| [Alamofire](https://github.com/Alamofire/Alamofire) | `903c53c` | 98 | 2,052 | 215 | non |

La validation a corrigé un `Error` standard Swift relié à un type nested homonyme et des headers standard C reliés à des copies vendored. Voir le [rapport](docs/benchmarks/oss-analysis-2026-07-15.md).

## Données et confidentialité

- Le sweep sur inactivité copie le transcript complet dans `raw/` ; aucun parsing ni troncature pendant la collecte. Les hooks de session ne font que réveiller le batch.
- Batch crée un digest plafonné et l’envoie à Anthropic via un `claude -p` séparé : seule transmission modèle/API ajoutée.
- Il utilise `--safe-mode`, des tools limités, le prompt via stdin, lint/rollback et aucun Bash.
- L’analyseur travaille sur une copie jetable des fichiers de connaissance dans un workspace temporaire et ne peut physiquement pas accéder à `raw/`, `.okf/` ou `.git` ; le driver ne réintègre que les fichiers `.md` réguliers (scripts et symlinks n’atteignent jamais le bundle).
- Raw est ignoré par git ; seul le Markdown extrait est commit localement. Aucun push ni remote ajouté.
- Répertoires POSIX `0700`, raw/state/log `0600`. Les logs persistants excluent transcript, stdout/stderr Claude, credentials et chemins raw complets.
- Le fixture live est synthétique, sans donnée personnelle ni credential.

## Configuration et suppression

Utilisez `~/.claude/okf/.okf/config.md` ou `/okf:okf-config`. Valeurs principales : `enabled: true` (interrupteur maître pour collecte, gate et batch), `batch_interval_hours: 1`, `batch_max_digest_kb: 600`, `capture_exclude_cwd` (globs d’exclusion de la collecte, évalués contre le cwd de la session), `sweep_min_idle_minutes: 60` (délai en minutes après la dernière activité avant collecte ; `0` collecte immédiatement), `batch_digest_cap_kb: 150`, `remove_candidate_ttl_days: 30`, `inject_max_lines` / `inject_max_bytes` : `120` / `9000`. Les valeurs invalides reviennent à des defaults sûrs.

```sh
claude plugin uninstall okf
```

Le bundle reste dans `~/.claude/okf` pour inspection, sauvegarde ou suppression manuelle.

## Vérification du développement

```sh
node test/smoke.mjs
node test/bench.mjs
for file in $(rg --files -g '*.mjs'); do node --check "$file"; done
claude plugin validate .claude-plugin/plugin.json
claude plugin validate .claude-plugin/marketplace.json
git diff --check
```

Live : `OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs`.

## Références et licence

La structure s’inspire des présentations concises et reproductibles de [uv](https://github.com/astral-sh/uv), [Ruff](https://github.com/astral-sh/ruff), [Playwright](https://github.com/microsoft/playwright), [fmt](https://github.com/fmtlib/fmt) et [Slim](https://github.com/slimphp/Slim), sans copier leur texte ni leurs affirmations. [Spécification OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md). Licence : [MIT](LICENSE).
