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

## Benchmark OKF

<!-- okf-benchmark: 2026-07-16-v3 -->

**OKF ne vous dispense pas d’explorer. Il stocke ce que l’exploration ne pourra jamais trouver.**

Les deux moitiés de cette phrase sont mesurées ci-dessous, sur de vrais dépôts open source, à n=15 par
cellule de comparaison. La moitié qui est peu flatteuse pour OKF est publiée en premier.

### Comment la mesure a été faite

Deux dépôts publics épinglés — aucune fixture synthétique, donc l’exploration coûte ce que
l’exploration coûte réellement et la baseline sans mémoire peut réellement gagner :

| Rôle | Dépôt | Commit |
|---|---|---|
| Codebase | [slimphp/Slim](https://github.com/slimphp/Slim) | `80900fb3` (125 fichiers PHP) |
| Pile de documents | [rust-lang/rfcs](https://github.com/rust-lang/rfcs) | `f635361c` (651 fichiers Markdown) |

Chaque concept de chaque bundle a été produit par le vrai pipeline — une vraie session `claude -p`
explorant le dépôt épinglé, son vrai transcript Claude Code, un vrai batch ingest, un vrai gate.
**Aucun concept n’a été écrit à la main.** Les bundles sont commités dans ce dépôt
([docs/benchmarks/bundles/](docs/benchmarks/bundles/)), ce qui vous permet de lire le texte exact du
gate et le corps des concepts sur lesquels repose chaque chiffre ci-dessous, et de réfuter ce run
comme v2 l’a été — depuis le dépôt, sans faire confiance à l’auteur.

Cinq conditions. Toutes reçoivent des tools identiques (`Read`, `Glob`, `Grep`, `Bash(git log/show/diff/blame/grep)`)
et une instruction identique, neutre vis-à-vis de la condition — aucune condition ne se voit dire de consulter le gate. Le
gate est délivré via le **vrai hook `SessionStart`** (`additionalContext`), et non préfixé au prompt ;
les octets livrés sont vérifiés à chaque run.

- **zero-base** — rien. Ce qu’OKF prétend remplacer.
- **answer key** — la réponse collée dans le prompt. Produire cette chaîne exige de déjà connaître la
  réponse, donc aucun utilisateur ne peut occuper cette condition. C’est un plancher, pas un concurrent.
- **OKF** — le vrai texte du gate.
- **wrong knowledge** — un gate de taille équivalente fait de vrais concepts portant sur l’*autre*
  dépôt. Sépare « la connaissance a aidé » de « un gate a aidé ».
- **CLAUDE.md** — la même connaissance accumulée collée dans un fichier plat. Le vrai titulaire en place.

`total_cost_usd` est le chiffre principal ; le coût sonnet-seul est publié à côté du coût total, de
sorte que le `claude-haiku` que le CLI résout pour le travail interne (2.3% de la dépense) peut être
déduit et ne peut masquer aucune conclusion. L’efficacité est comparée uniquement sur les runs
corrects. Chaque réponse est notée par **atome** — la vérité terrain est découpée en faits vérifiables
indépendamment, gelés avant la mesure — et le score binaire façon v2 (tous les atomes corrects) est
publié à côté. Un nonce par run neutralise le prompt caching. **Aucun chiffre n’est moyenné entre
scénarios.**

Design, prédictions et critères de réfutation R1–R5 ont été
[pré-enregistrés](docs/benchmarks/pre-registration-2026-07-16-v3.md) et commités **avant le premier
appel payant**. Ce document consigne aussi, en détail, les six affirmations fausses ou non étayées
qu’a faites la publication précédente (v2) de ce benchmark, et comment chacune a été détectée depuis
ses propres données brutes.

### Là où OKF perd : tout ce que le code peut répondre

Cinq scénarios dont les réponses sont dans le source, dans l’historique git ou dans le bundle,
chacune vérifiée depuis le checkout épinglé. Le coût est la médiane des runs corrects, avec sa
dispersion.

| Scénario | zero-base | OKF | verdict |
|---|---:|---:|---|
| `rfcs_cheap` — un grep | **$0.062** · 13/15 | $0.077 · 14/15 | OKF 1.2× plus cher |
| `slim_cheap` — un grep | **$0.067** · 14/15 | $0.114 · 15/15 | OKF 1.7× plus cher |
| `rfcs_buried` — trouver la justification parmi 651 documents | **$0.097** · 12/15 | $0.112 · 13/15 | OKF 1.2× plus cher |
| `slim_buried` — suivre une chaîne d’appels sur cinq fichiers | $0.277 · 13/15 · **10 tools** | **$0.232** · 9/15 · **8 tools** | OKF moins cher, moins de tools |
| `slim_stale` — connaissance du bundle périmée par un commit ultérieur | critiques **15/15** | critiques **15/15** | égalité — voir ci-dessous |

**Sur les greps bon marché, OKF est du pur overhead** — 1.2–1.7× plus cher pour la même réponse, parce
que le gate est un coût fixe dont un `grep` n’a pas besoin. Il ne devient rentable que là où
l’exploration est réellement coûteuse : `slim_buried` suit une chaîne d’appels sur cinq fichiers, et là
OKF est moins cher avec moins de tool calls. Ce n’est pas un défaut, c’est de l’arithmétique — si un
grep répond à votre question, ne payez pas pour un gate.

`slim_stale` est là où la notation par atome a prouvé son utilité. Le bundle portait une affirmation
rendue périmée par un commit ultérieur, et le score binaire affiche **0/15 pour chaque condition** — ce
qui ressemble à une déroute totale. Ce n’en est pas une. Les atomes *critiques* (ce que la question
demande réellement — que le renderer HTML échappe, avec quelle fonction et quels flags) sont à
**15/15** : le modèle a lu le code et a répondu correctement au fait central. Les seuls atomes manqués
concernent la provenance, que la question ne demandait pas (le SHA du commit qui a introduit
l’échappement). La connaissance périmée ne l’a **pas** rendu confiant à tort — la prédiction
pré-enregistrée qui l’annonçait était fausse, et le score binaire seul l’aurait masqué.

### Là où l’exploration ne peut pas aider : la connaissance que le code ne contient pas

Politique d’équipe décidée en conversation, jamais écrite dans le dépôt. La pile de RFC contient même
un piège : cherchez-y une politique MSRV et les documents proposent `N-2` — la vraie règle de l’équipe
est différente.

| Scénario | zero-base | OKF | wrong knowledge | CLAUDE.md |
|---|---:|---:|---:|---:|
| `rfcs_policy` — la « thaw rule » de l’équipe : délai d’attente, cadence MSRV, deux exceptions | **0/15** | **11/15** · $0.075 | — | 15/15 · $0.144 |

**Zero-base a fait 0 sur 15.** Il a dépensé l’argent et n’a rien obtenu, parce que la réponse n’est pas
dans le dépôt — vérifié par un adversaire qui a fouillé l’arbre de travail, l’historique git, les
messages de commit, les docs et la config, et n’a trouvé aucun résultat. Le piège ne l’a pas attrapé
non plus ; il n’a tout simplement pas pu répondre.

OKF a répondu à **11 sur 15**, pour environ la moitié du coût de CLAUDE.md portant les mêmes faits.
C’est la seule chose que l’exploration ne peut pas faire et qu’une décision stockée peut faire.
**CLAUDE.md y répond aussi** (15/15) — OKF n’est pas unique ici, c’est une forme moins chère et à
injection bornée du même titulaire en place. Le contrôle `wrong knowledge` pour ce scénario est exclu :
un bug de contamination de mesure (ci-dessous) lui a permis de lire la réponse, il ne peut donc pas
servir de contrôle « un gate seul n’aide pas » dans ce run.

C’est un seul scénario de politique propre, pas trois. Deux autres (`slim_policy`, `slim_domain`) ont
été mesurés puis **exclus** — voir ci-dessous.

### Ce que ce run ne peut pas vous dire

- **Deux scénarios de politique ont été exclus pour cause de contamination.** Claude Code injecte
  automatiquement la mémoire de projet par répertoire (`~/.claude/projects/<cwd>/memory/`) dans chaque
  session. Pendant la construction de la connaissance, une session `claude -p` explorant le dépôt cible
  a enregistré les décisions d’équipe dans cette mémoire, et comme la mesure tournait dans le même
  répertoire de travail, la mémoire a atteint jusqu’à la condition **zero-base** — qui ne devrait avoir
  aucune connaissance. Sur `slim_domain`, zero-base a alors « répondu » une décision d’équipe qui
  n’existe nulle part dans le code, 15/15. Tout scénario dont les runs zero-base lisent la mémoire de
  projet est retiré de la publication (`slim_domain`, `slim_policy`) ; le harness efface désormais cette
  mémoire avant de mesurer, et le rapport détecte et exclut ces scénarios mécaniquement. Les scénarios
  propres ci-dessus ont eu zéro lecture de mémoire.
- **n=15 sur les conditions de contraste, n=5 sur les contrôles.** C’est peu. Seule une séparation
  complète entre distributions est décrite comme une victoire.
- **Deux dépôts, deux écosystèmes (PHP + Markdown).** Aucune prétention à la généralité sur d’autres
  tailles ou langages. Un troisième dépôt a été conçu, puis rejeté sur le coût-par-crédibilité avant
  toute dépense.
- **Sessions à une seule question.** Le coût fixe du gate d’OKF est payé une fois par question plutôt
  qu’amorti sur une vraie session à plusieurs questions, donc ce run *sous-estime* OKF.
- **Le juge est une seule famille de LLM**, notant par atome contre une vérité terrain vérifiée depuis
  le source.

Les critères de réfutation **R1–R5 ont tous été évalués mécaniquement et aucun ne s’est déclenché**
(après exclusion des cellules contaminées) — ce run ne réfute pas l’affirmation. Ce n’est pas la même
chose qu’une confirmation forte à n=15 ; c’est l’absence de réfutation.

### Un suivi en chaîne : la véritable accumulation aide-t-elle ? (v4, réfuté)

<!-- okf-benchmark-chain: 2026-07-16-v4 -->

Un run séparé et pré-enregistré a testé directement le mécanisme d’OKF : une chaîne de 4 questions
liées mais différentes à propos du `pkg/scheduler` de `kubernetes/kubernetes` (v1.30.0, 178 fichiers
Go), où la conclusion de chaque session passe par un **vrai batch** avant le démarrage de la session
suivante, comparée aux mêmes 4 questions posées sans jamais aucune accumulation. C’est exactement la
forme que le pré-enregistrement de v3 avait signalée comme « favorise OKF et est ajustable pour le
flatter » et avait refusé de lancer. v4 l’a lancée malgré tout, cette fois avec des garde-fous : les
4 questions ont été figées et vérifiées depuis le source avant toute dépense, le garde-fou de
contamination efface la mémoire de projet de Claude Code avant **chaque** session (pas une seule
fois), et les critères de réfutation ont été fixés avant la mesure — voir le
[pré-enregistrement](docs/benchmarks/pre-registration-2026-07-16-v4.md).

Une véritable accumulation a bien eu lieu : les octets du gate ont crû de façon monotone au fil des
étapes (1835 → 2613 → 3675 → 4950, n=15 chaînes), soutenus par une dépense de batch réelle et mesurée
($25.81 au total). **La prédiction centrale — que le coût baisse au long de la chaîne — a été
réfutée.** Le coût d’OKF est passé de $0.231 → $0.216 → $0.258 → **$0.447** sur les quatre questions ;
le contrôle sans mémoire a évolué de la même manière ($0.255 → $0.256 → $0.272 → $0.411).
L’explication la plus probable est que la quatrième question était simplement plus difficile pour les
deux bras — elle interroge deux mécanismes à la fois — et non que l’accumulation ait aidé ou nui. La
précision au niveau des atomes d’OKF n’a dépassé celle de la baseline à aucune étape, et lui était
inférieure à la fois pour la première et la dernière question. La notation binaire (tous les atomes
corrects) était de 0/106 pour les deux bras — ce jeu de questions est assez difficile pour que seul
le score au niveau des atomes soit exploitable. [Rapport complet](docs/benchmarks/okf-benchmark-chain-2026-07-16-v4.md).

### Overhead local (pas le résultat d’efficacité)

Mesuré le 2026-07-16, macOS arm64, Node `v26.4.0`, médiane avec min/max.

| Opération locale | Médiane | Plage |
|---|---:|---:|
| Processus SessionStart gate | 57.3 ms | 56.1–60.0 ms |
| Processus trigger batch SessionEnd | 40.1 ms | 39.3–40.8 ms |
| Processus statusline | 35.8 ms | 34.6–36.3 ms |

Reproduire avec `node test/bench.mjs [dépôt]`. Coût de process local uniquement ; cela ne prouve rien
sur les tokens ni sur la latence du modèle.

### Coût, reproduction et liens

Les 440 runs mesurés ont coûté **$66.26** plus **$14.74** de notation ; la construction de la
connaissance et des bundles a ajouté ~$3.2. Total pour ce run ≈ **$84**. Payant, authentifié, et exclu
des smoke tests et de la CI, volontairement.

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-knowledge.mjs --target slim --dir <repo>   # vraies sessions → transcripts
OKF_RUN_LIVE_BENCH=1 node test/bench-bundles.mjs --target slim --levels 20      # vrai batch → bundle
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                                    # mesure
```

Le run en chaîne v4 (120 sessions, vrais batches entre les étapes) a coûté **$31.95** de mesure +
**$9.20** de notation + **$25.81** d’ingestion réelle ≈ **$67** :

```sh
OKF_RUN_LIVE_BENCH=1 OKF_BENCH_CHAINS=15 node test/bench-chain.mjs   # sessions chaînées, vrai batch, mesure
```

[Rapport complet](docs/benchmarks/okf-benchmark-2026-07-16-v3.md) ·
[rapport de suivi en chaîne](docs/benchmarks/okf-benchmark-chain-2026-07-16-v4.md) ·
[raw JSON](docs/benchmarks/raw/) ·
[bundles commités](docs/benchmarks/bundles/) ·
[pré-enregistrement](docs/benchmarks/pre-registration-2026-07-16-v3.md) ·
[pré-enregistrement de la chaîne](docs/benchmarks/pre-registration-2026-07-16-v4.md) ·
[guide d’utilisation](docs/USAGE.md).

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
