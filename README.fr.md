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

<!-- okf-benchmark: 2026-07-16 -->

> **Rétractation (2026-07-16).** Trois affirmations publiées à l’origine dans cette section ont été
> retirées après un audit des données brutes de ce run lui-même : l’explication du piège de
> `rfcs_policy` (fabriquée — le piège ne s’est jamais déclenché), le titre de la tendance
> d’accumulation (non étayé par son échantillon) et le titre d’origine de cette section, « Là où OKF
> est la seule chose qui marche » (réfuté par son propre tableau). Chaque rétractation est signalée à
> l’endroit où l’affirmation se trouvait. Ce qui a été retiré, et comment chaque cas a été détecté,
> est consigné dans le [pré-enregistrement v3](docs/benchmarks/pre-registration-2026-07-16-v3.md).
> Tous les autres résultats de cette section sont inchangés.

**OKF ne vous dispense pas d’explorer. Il stocke ce que l’exploration ne pourra jamais trouver.**

Les deux moitiés de cette phrase sont mesurées ci-dessous, sur de vrais dépôts open source, et la
moitié qui est peu flatteuse est publiée en premier.

### Comment la mesure a été faite

Deux dépôts publics épinglés — aucune fixture synthétique, donc l’exploration coûte ce que
l’exploration coûte réellement et la baseline sans mémoire peut réellement gagner :

| Rôle | Dépôt | Commit |
|---|---|---|
| Codebase | [slimphp/Slim](https://github.com/slimphp/Slim) | `80900fb3` (125 fichiers PHP) |
| Pile de documents | [rust-lang/rfcs](https://github.com/rust-lang/rfcs) | `f635361c` (651 fichiers Markdown) |

Chaque concept de chaque bundle a été produit par le vrai pipeline — une vraie session `claude -p`
explorant le dépôt épinglé, son vrai transcript Claude Code, un vrai batch ingest, un vrai gate.
**Aucun concept n’a été écrit à la main**, y compris le remplissage qui crée du volume.

Cinq conditions. Toutes reçoivent des tools identiques (`Read`, `Glob`, `Grep`, `Bash(git log/show/diff/blame/grep)`)
et une instruction identique, neutre vis-à-vis de la condition — aucune condition ne se voit dire de consulter le gate.

- **zero-base** — rien. Ce qu’OKF prétend remplacer.
- **answer key** — la réponse collée dans le prompt. Produire cette chaîne exige de déjà connaître la
  réponse, donc aucun utilisateur ne peut occuper cette condition. C’est un plancher, pas un concurrent.
- **OKF** — le vrai texte du gate.
- **wrong knowledge** — un gate de taille équivalente fait de vrais concepts portant sur l’*autre*
  dépôt. Sépare « la connaissance a aidé » de « un gate a aidé ».
- **CLAUDE.md** — la même connaissance accumulée collée dans un fichier plat. Le vrai titulaire en place.

`total_cost_usd` est le chiffre principal ; l’activité en tokens est montrée à côté, jamais à sa
place, parce que `cache_read` domine cette somme et se facture ~50× moins cher — les deux colonnes
divergent en direction. L’efficacité est comparée uniquement sur les runs corrects. Un nonce par run
neutralise le prompt caching. La notation est faite par un juge aveugle à la condition, contre une
vérité terrain vérifiée depuis le source. **Aucun chiffre n’est moyenné entre scénarios** : un grep
et une chaîne d’appels sur cinq fichiers sont des phénomènes différents, et les mélanger laisserait
le choix des scénarios décider du titre.

Design, prédictions et critères de réfutation ont été [pré-enregistrés](docs/benchmarks/pre-registration-2026-07-16.md)
et commités **avant le premier appel payant**.

### Là où OKF perd : tout ce que le code peut répondre

Cinq scénarios dont les réponses sont dans le source ou dans l’historique git, vérifiées depuis le
checkout épinglé et ayant chacune survécu à une tentative indépendante de réfutation.

| Scénario | zero-base | OKF | verdict |
|---|---:|---:|---|
| `rfcs_cheap` — un grep | **$0.0256** · 4/5 | $0.0505 · 3/5 | OKF 2.0× plus cher |
| `slim_cheap` — un grep | **$0.0198** · 4/5 | $0.0386 · 5/5 | OKF 1.9× plus cher |
| `slim_stale` — connaissance du bundle périmée par un commit ultérieur | **$0.0345** · 5/5 | $0.0632 · 4/5 | OKF 1.8× plus cher |
| `rfcs_buried` — trouver la justification parmi 651 documents | **$0.0326** · 4/5 | $0.0910 · 3/5 | OKF 2.8× plus cher |
| `slim_buried` — suivre une chaîne d’appels sur cinq fichiers | $0.1669 · 2/5 · **10 tools** | **$0.0701** · 2/5 · **3 tools** | **OKF 2.4× moins cher** |

**OKF perd quatre fois sur cinq.** Il ne gagne que là où l’exploration est réellement coûteuse, et là
il fait passer les tool calls de 10 à 3. Si un grep répond à votre question, le gate est pur
overhead — ce n’est pas un défaut, c’est de l’arithmétique.

`slim_stale` mérite d’être nommé : le bundle portait une affirmation périmée (le renderer d’erreur
HTML n’échappe pas — vrai avant le commit `f897118b`, faux au commit épinglé) et le modèle **a
vérifié le code et l’a corrigée quand même**, 4/5. La connaissance périmée ne l’a pas rendu confiant
à tort. La prédiction pré-enregistrée qui annonçait le contraire était fausse.

### Là où l’exploration ne peut pas aider : la connaissance que le code ne contient pas

Politique d’équipe et vocabulaire métier — décidés en conversation, jamais écrits dans le dépôt.
Chaque scénario a été attaqué par un adversaire indépendant qui a fouillé l’arbre de travail, ~300
révisions d’historique git, messages de commit, docs, config, stashes et objets dangling (zéro
résultat), et qui **a consigné une supposition tirée de la convention avant de regarder**. Ces
suppositions ont obtenu 0/3, 0/3 et 1/5.

Chaque dépôt contient aussi un piège : greppez « emitter » et vous trouvez `ResponseEmitter` ;
cherchez une taille de chunk et vous trouvez `4096` ; cherchez une politique MSRV dans la pile de RFC
et les documents proposent `N-2`.

| Scénario | zero-base | OKF | wrong knowledge | CLAUDE.md |
|---|---:|---:|---:|---:|
| `slim_policy` — quel env active les détails d’erreur, et l’exception | **0/5** ($0.0509 dépensés) | **5/5** · $0.0840 | 0/5 | 5/5 · $0.1314 |
| `slim_domain` — ce que l’équipe entend par « 에미터 » | **0/5** · **confiant et faux 5/5** | **4/5** · $0.0624 | 0/5 | 5/5 · $0.1198 |
| `rfcs_policy` — le délai d’attente de la « thaw rule » de l’équipe | **0/5** | 2/5 · $0.0749 | 0/5 | 0/5 |

**Zero-base a fait 0 sur 15.** Il a dépensé l’argent et n’a rien obtenu, parce que la réponse n’est
pas là. Sur `slim_domain` il a été **confiant et faux dans 5 runs sur 5** : il a exploré, trouvé
`ResponseEmitter`, et répondu avec une grande confiance — alors que le « 에미터 » de l’équipe est
`OutputBufferingMiddleware`, parce qu’ils tournent en mode worker FrankenPHP où `ResponseEmitter` est
du code mort. L’exploration ne se contente pas d’échouer ici ; elle fabrique une réponse fausse et
confiante à partir du piège.

**Wrong knowledge a fait 0 sur 15 aussi.** Un gate rempli de concepts réels mais hors sujet ne
récupère rien. Le gain vient de la connaissance, pas du fait d’avoir un gate.

OKF a répondu à 11 sur 15, pour 1.6–1.9× moins cher que CLAUDE.md portant les mêmes faits. Sur
`slim_domain` il n’a lu **aucun fichier de concept** (0/5) — la seule ligne d’index a suffi, avec
2 tool calls contre 7 pour zero-base.

**CLAUDE.md marche ici aussi**, et le tableau le dit : 5/5 sur `slim_policy`, et 5/5 sur
`slim_domain`, où il bat le 4/5 d’OKF. Ce que ce tableau étaye, c’est la parité avec le titulaire en
place pour 1.6–1.9× moins cher, avec une injection bornée — pas l’exclusivité. Cette section a d’abord
été publiée sous le titre « Là où OKF est la seule chose qui marche », que son propre tableau réfute ;
**ce titre est retiré.**

`rfcs_policy` est l’échec honnête : OKF n’a atteint que 2/5. **L’explication publiée ici — la
proposition `N-2` qui traîne dans la pile de documents serait un piège assez fort pour détourner le
modèle d’une ligne d’index correcte — était fausse, et elle est retirée.** Les 5 runs OKF n’ont lu que
des fichiers du bundle ; aucun n’a ouvert de document RFC ; aucun n’a répondu `N-2`. Tous les cinq ont
répondu « 4 releases ». Le piège ne s’est jamais déclenché. La cause du 2/5 n’a pas été investiguée
avant publication, et aucune explication de remplacement n’est proposée ici ; une nouvelle mesure est
en cours. CLAUDE.md y a marqué 0/5, donc OKF bat toujours le titulaire en place sur ce scénario.

### Accumulation — l’affirmation de tendance est retirée

Cette section a d’abord publié une courbe de coût en fonction de la taille du bundle (1 → 35 concepts)
et le titre **« De 1 à 35 concepts, OKF est devenu moins cher ($0.1291 → $0.0908) tandis que CLAUDE.md
est devenu 2.2× plus cher ($0.1279 → $0.2828). Les courbes divergent. »** **Cette affirmation de
tendance est retirée, faute d’être étayée par son échantillon.**

Les chiffres n’étaient pas fabriqués — ce sont des médianes sur les seuls runs corrects, ce qui est la
règle pré-enregistrée. Mais ce sont des médianes de **3, 2, 5, 3, 2 et 4** runs, et le point bas à
$0.0701 est *la médiane de deux runs*. Sur l’ensemble des runs, les distributions des niveaux se
recouvrent complètement (le niveau à 1 concept s’étend de $0.0774 à $0.2214 ; celui à 35 concepts, de
$0.0836 à $0.1606), et les médianes sur tous les runs ne sont pas monotones du tout : $0.1237,
$0.1884, $0.1425, $0.0852, $0.1142, $0.1135. Cette même section disait déjà, deux paragraphes plus
loin, « À n=5, rien ici ne sépare » — cette phrase était juste et le titre au-dessus d’elle ne l’était
pas. La courbe n’est pas republiée ici, car une médiane de deux runs n’est pas un point sur une courbe.

Le plateau du gate a lui aussi été mal expliqué. On l’a attribué au batch fondant 14 concepts en une
seule ligne d’index, présenté comme une propriété émergente de la façon dont OKF organise la
connaissance. **C’est le plafond `inject_max_lines: 120` dans `lib/config.mjs`** — une constante de
configuration. `bench-bundles.mjs` enregistre `gateTruncated`, vrai exactement au niveau où le plateau
commence : les entrées d’index ont été **écartées faute de budget**, pas élégamment imbriquées.

Une moitié de l’ancienne affirmation survit, et seulement énoncée seule : CLAUDE.md porte le corps de
chaque concept dans chaque prompt, son prompt grandit donc linéairement avec le nombre de concepts.
Cela découle mécaniquement du format. Aucune comparaison du côté d’OKF n’en est tirée ici.

La précision ne s’est pas améliorée avec le volume et est restée bruitée (2/5–5/5). **L’axe des
niveaux est retiré en v3** : il mesure une constante de configuration, et le relancer n’achèterait
qu’une lecture plus précise d’un nombre qu’on peut lire dans un fichier de configuration.

### Overhead local (pas le résultat d’efficacité)

Mesuré le 2026-07-16, macOS arm64, Node `v26.4.0`, médiane avec min/max.

| Opération locale | Médiane | Plage |
|---|---:|---:|
| Processus SessionStart gate | 57.3 ms | 56.1–60.0 ms |
| Processus trigger batch SessionEnd | 40.1 ms | 39.3–40.8 ms |
| Processus statusline | 35.8 ms | 34.6–36.3 ms |

Reproduire avec `node test/bench.mjs [dépôt]`. Coût de process local uniquement ; cela ne prouve rien
sur les tokens ni sur la latence du modèle.

### Le coût, et ce que ce run ne peut pas vous dire

Construire la connaissance a coûté **$3.59** en vraies sessions et **$4.92** en batch ingest. Les 250
runs mesurés ont coûté **$28.16** plus **$9.44** de notation.

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-knowledge.mjs --target slim --dir <repo>   # vraies sessions → transcripts
OKF_RUN_LIVE_BENCH=1 node test/bench-bundles.mjs --target slim --levels 1,5,20  # vrai batch → bundles par niveau
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                                    # mesure
```

Payant, authentifié, et exclu des smoke tests et de la CI, volontairement.
[Rapport complet](docs/benchmarks/okf-benchmark-2026-07-16.md) ·
[raw JSON](docs/benchmarks/raw/) ·
[pré-enregistrement](docs/benchmarks/pre-registration-2026-07-16.md) ·
[guide d’utilisation](docs/USAGE.md).

Les limites, énoncées sans détour :

- **n=5 par cellule.** C’est peu. Seule une séparation complète entre distributions est décrite ici comme une victoire.
- **Le mix de modèles n’est pas épinglé.** `claude-sonnet-5` a été demandé ; le CLI a résolu
  `claude-haiku-4-5` à côté de lui pour le travail interne. Les comparaisons de coût entre conditions
  portent cet artefact.
- **Deux dépôts, un langage chacun.** Aucune prétention à la généralité sur d’autres tailles ou écosystèmes.
- **Le wall-clock n’est pas publié.** La mesure a tourné à concurrence 5 ; le coût, les tokens et les
  tool calls n’en sont pas affectés, la latence de réponse si. Toute affirmation sur la vitesse
  exigerait un re-run séquentiel.
- Le texte du gate est préfixé au prompt plutôt que délivré par le chemin de production
  `SessionStart` `additionalContext`. Même texte, livraison différente.
- Les scénarios de politique reposent sur un humain qui rédige la politique. C’est ce qu’est une
  politique. La défense est que la réponse est prouvablement absente du dépôt et qu’un adversaire
  n’a pas pu la deviner.

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
