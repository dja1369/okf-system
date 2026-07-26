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
| `/okf:okf-deprecate <cible>` | Retirer un concept — le fichier et ses liens restent, le gate cesse de l’injecter |

`visualize` ne scanne aucun dépôt. `analysis` refuse les chemins absents/non-répertoires et signale analyse tronquée, concepts sans rapport masqués et statistiques par langage. Les deux produisent un HTML autonome, sans CDN ni réseau à l’exécution.

## Statusline optionnelle

`bin/statusline.mjs` affiche une ligne telle que `OKF 12 · +3 · 2h ago`, sans réseau ni analyse globale. Claude Code n’accepte qu’un `statusLine`; OKF ne l’installe ni ne l’écrase. Ajoutez la sortie de `node /path/to/okf/bin/statusline.mjs` à votre script existant.

## Benchmark OKF

<!-- okf-benchmark: 2026-07-26-e3 -->

### Gate recall@cap — trois manches préenregistrées, E1 → E3 (2026-07-26)

Les trois manches ont coûté **0,00 $**, et c'est l'exécution qui le prouve plutôt qu'une déclaration :
le banc d'essai place un stub `claude` en tête de `PATH`, constate que ce stub existe, et le stub n'est
jamais exécuté (`paidCallTrapInstalled: true`, `paidCallTrapTripped: false`).

Elles mesurent `recall(N)` — avec N concepts dans le bundle, la proportion des 20 questions gelées dont
le concept de réponse survit jusqu'à l'index que la porte injecte réellement.

> **recall n'est pas un taux de réussite.** Il répond seulement à « la porte a-t-elle chargé la ligne
> pertinente ». Savoir si le modèle a **utilisé** cette ligne ne peut être vérifié sans appels payants.
> Les distracteurs synthétiques ne donnent qu'une **borne supérieure**, le recall réel est donc plus bas.

**Conditions** — 3 perturbations × 5 niveaux × 20 graines = 300 échantillons, 28 s. Quatre caractères
sont ajoutés devant le **`title`** du frontmatter du concept de réponse ; ni le corps, ni le nom de
fichier, ni le chemin ne changent.

| N | `none` | `front` (`!!! `) **tel que publié** | `front` **sûr avec guillemets** | `back` (`힣힣 `) |
|---|---|---|---|---|
| 24 | 0,400 ± 0,000 | 1,000 ± 0,000 | **0,400** | 0,400 ± 0,000 |
| 50 | 0,277 ± 0,038 | 0,560 ± 0,064 | **0,400** | 0,182 ± 0,044 |
| 100 | 0,247 ± 0,034 | 0,523 ± 0,030 | **0,400** | 0,170 ± 0,025 |
| 200 | 0,250 ± 0,040 | 0,528 ± 0,030 | **0,400** | 0,175 ± 0,026 |
| 400 | 0,262 ± 0,039 | 0,533 ± 0,024 | **0,400** | 0,185 ± 0,024 |

n=20 par cellule. E1 n'a exécuté que `none` avec un budget inférieur de 11 o et a produit
0,400 / 0,277 / 0,245 / 0,248 — c'est une **condition différente**, ni meilleure ni pire que le tableau
ci-dessus.

**La colonne `front` telle que publiée est contaminée, et c'est sa propre garde qui l'a détecté.**
`!!!` est un **indicateur de tag** YAML. Placé devant un `title:` *sans guillemets*, il casse
entièrement le frontmatter : le type est perdu, le texte du lien retombe sur le nom de fichier, et **la
description disparaît**, faisant s'effondrer la ligne de ~700 o à ~30 o. **14 des 20 questions gelées
ont des titres sans guillemets.** Pour ces 14, l'expérience a donc mesuré non pas la position de tri
mais l'**échec d'analyse** : une ligne courte laisse entrer bien plus de lignes dans le même budget,
ce qui correspond exactement au `taken` = 24 et à la longueur moyenne de 263 o observés à N=24. Refaite
avec un préfixe sûr avec guillemets, `front` s'effondre à un **0,400 plat**. `none` et `back` ne bougent
pas d'un chiffre, ce qui confirme la neutralité du correctif et montre que `힣힣 ` n'a jamais rien cassé.

**Ce qui subsiste et ce qui tombe.** Le tri décide toujours de la survie : à N=400 l'écart sûr avec
guillemets vaut 0,400 − 0,185 = **0,215**, soit encore **4,3×** le seuil de réfutation de 0,05, et le
fait que `back` fasse passer le recall de 0,262 à 0,185 est un pur effet d'ordre. **Dans un système sans
aucun signal de pertinence, c'est le résultat attendu et non la découverte d'un bogue** — ce qui est
nouveau, c'est l'ampleur. Mais trois ampleurs publiées ne survivent pas : « quatre caractères doublent
le recall » passe de 2,03× à **1,53×** ; « N=24 passe de 0,400 à 1,000 » devient **aucun changement** ;
et le bond de `cwdIndependent` d'E1, 0,000 → 0,967, devient **0,000 → 0,333**. À leur place apparaît un
fait nouveau : **quand les concepts se trient en tête, le recall cesse totalement de dépendre de N**
(0,400 plat sur une plage de taille de bundle de 17×), car ce qui borne alors la survie est `taken` et
non N.

**La condition de survie est exactement `rank < taken`** — un concept survit si et seulement si son rang
de tri par titre à l'intérieur de sa catégorie est inférieur au nombre de lignes que cette catégorie a
obtenues. Le recall est donc une fonction **complète** des vecteurs rank et `taken` et se décompose sans
approximation. À N=24→50 la composante rank domine (−0,15 à −0,41) ; à N≥100 elle meurt à ~0, un effet
plancher : le rang moyen des réponses (26,9) dépasse largement `taken` (10,5), et ajouter du remplissage
ne change rien aux concepts déjà exclus. Réserve publiée avec le résultat : la décomposition est de la
**comptabilité, pas de la causalité**, et ses composantes dépendent de la ligne de base.

**Deux corrections d'E3 à E2, et une à elle-même.** E2 rapportait que le recall « monte de façon
monotone » de N=100 à 400 et laissait l'explication à E3. Avec le n=20 préenregistré, cette montée **ne
peut pas être établie du tout** : 0 paire adjacente sur 12 est `rising`. Le premier titre publié d'E3 en
concluait que la montée « n'existe pas » ; **c'était faux**, et une vérification adverse de puissance
statistique l'a détecté : à n=60, trois paires sont `rising` (p descendant jusqu'à 0,00027), et dans les
trois la composante `taken` porte 100 % du mouvement tandis que la composante rank vaut exactement 0. La
montée est réelle mais **non substantielle** (IC de la médiane = [0,000, 0,000]). E3 a aussi remplacé la
règle `|Δ| ≤ 0,05` d'E2 — qui confond « plat » et « petit mais constant » — par un test des signes exact
apparié plus un intervalle de confiance de la médiane sans hypothèse de distribution, en publiant la
direction et l'ampleur comme deux valeurs distinctes.

**L'ancien R3 se déclenchait sur du bruit.** Son libellé disait « décroissance monotone violée →
*défaut du banc d'essai* → tout jeter », mais son implémentation comparait des moyennes sans aucun
traitement de l'incertitude, si bien que ±0,005 de bruit de graine le déclenchait aussi bien dans E1 que
dans E2 — les deux manches ont été publiées dans l'état contradictoire « déclenché, mais rien de jeté ».
E3 n'a pas assoupli le seuil ; il a repointé le critère vers ce que dit son libellé et a mesuré
l'intégrité directement. Sur les mêmes 300 échantillons, l'ancien R3 se déclenche et le nouveau R3a non.

**Dans le bundle réel, le biais de tri ne peut pas encore être établi.** Mesuré en lecture seule et
n'émettant que des décomptes : ni titres, ni descriptions, ni noms de fichiers, ni liens ne sortent de la
mesure, et `raw/` n'est jamais ouvert. Le tri compare `title.toLowerCase()` avec `<`, c'est-à-dire un
**ordre d'unités de code UTF-16, pas une collation localisée** ; un titre commençant par de l'ASCII
précède donc toujours un titre commençant par du hangul. Les concepts à initiale ASCII représentent
65,4 % du bundle et prennent 70,6 % des places de la porte — mais avec 26 concepts, le test
hypergéométrique exact contre une hypothèse nulle stratifiée donne **p = 0,667**. Ce n'est pas un
résultat. Et un faible surcroît ne doit pas se lire « le tri est inoffensif » : la porte charge
actuellement **65,4 %** de tous les candidats, et là où tout est chargé le tri ne décide de rien (2
catégories sur 6 ont zéro degré de liberté). Par catégorie, le taux de chargement se sépare déjà :
`decisions`/`projects` 1,000, `patterns` 0,500, `references` **0,429**. Une version antérieure affirmait
qu'un taux de chargement décroissant amplifierait l'effet ; **les données mêmes du benchmark la
réfutent**, cette affirmation a donc été retirée.

**Ce qui prend une place est décidé par l'ordre et la longueur de ligne, pas par la pertinence.** Cinq
facteurs sont confirmés dans le code : le tri sensible à la casse des noms de section de type, qui fait
que `# Subdirectories` précède toujours `# reference` (`lib/index-gen.mjs:242`) et tire les concepts
imbriqués en tête de leur catégorie ; à l'intérieur d'une section, l'ordre alphabétique du **`title`** du
frontmatter — et non du nom de fichier, qui n'est qu'un repli en cas d'échec d'analyse (`:315`) ;
`status: deprecated` relégué en fin de section (`:245`) ; l'ordre de parcours des catégories par nom de
répertoire (`:227`) ; et la **longueur de ligne en octets**, puisqu'une ligne suivante dépassant le
budget restant arrête cette catégorie (`lib/gate.mjs:122`). La porte ne contient aucune référence au
cwd, à la fraîcheur ou à la requête.

**Le résultat, c'est la forme, pas le niveau.** Sur les 20 questions, 9 survivent à 0 à tous les niveaux
et 3 à 1,0 ; les 8 restantes se situent entre les deux — le recall n'est pas binaire. La porte remplit en
tourniquet jusqu'à épuisement du budget ; une catégorie ne finit à 1–3 lignes que parce qu'une seule
ligne est grosse (200–1 030 o contre un budget d'index d'environ 6 960 o), si bien que la prise totale
s'épuise à 8–11 lignes. `references` obtient exactement une ligne à chaque niveau, donc sur les 8
réponses qui y sont concentrées, une seule au plus peut survivre.

**Profondeur d'imbrication (axe A-2).** 25 concepts fixés, contenus identiques, seuls les chemins
approfondis :

| Condition | lignes de concept injectées | liens de sous-domaine |
|---|---:|---:|
| plat | 28 | 0 |
| 2 niveaux | 27 | 0 |
| 3 niveaux | 26 | 0 |
| 4 niveaux | 25 | 0 |

Chaque condition a été mesurée **une fois** (n=1, sans répétition de graine), et dans cette unique
mesure une ligne a été perdue par niveau de profondeur. Quatre points ne permettent pas de dire si le
déclin est linéaire, et les profondeurs au-delà de 4 n'ont pas été mesurées. Rapporté aux concepts
plantés, 3 niveaux donne 25 → 23, soit **−8,0 %**. La cause est la pression en octets, pas un parcours
de chaîne défaillant : chaque segment de chemin supplémentaire allonge toutes les lignes jusqu'à ce que
l'une soit poussée hors du budget.

**R2 se déclenche à chaque manche** (`recall(24)` = 0,400 < 0,60). Selon la règle de traitement
préenregistrée, **les valeurs absolues de recall ne décident de rien** — les tableaux sont publiés et ne
pilotent aucune politique.

**Discipline de mesure, et où elle s'est améliorée.** Dans E1, les fixtures sont entrées dans git pour la
première fois au commit du **rapport** : les seuils étaient fixés à l'avance, mais pas le matériel qui a
réellement déterminé les chiffres. À partir d'E2, les fixtures sont livrées dans le commit de
préenregistrement et le smoke impose une inégalité **stricte** via `git log --diff-filter=A` ; pointée
sur l'ensemble de fichiers d'E1, elle produit 3 violations, elle attrape donc l'accident réel au lieu de
l'approuver. Chaque manche publie les valeurs déjà connues au moment de la rédaction de son
préenregistrement, ainsi que toute arithmétique modifiée après la mesure — E3 a quantifié les deltas de
recall sur la grille de 1/20 parce que `0,25 − 0,20 = 0,04999…` alors que `0,20 − 0,15 = 0,05000…2`,
plaçant le même mouvement d'une question de part et d'autre de la borne d'équivalence ; ce correctif a
supprimé le seul verdict `indeterminate` de la manche, il jouait donc **contre** l'argument du rapport
lui-même, et il est divulgué comme tel. La revue adverse a ensuite montré que la garde de l'identité de
survie était quasi tautologique (elle rappelait la fonction même qu'elle vérifiait), et le remplacement
non circulaire **s'est déclenché dès sa première exécution** : c'est ainsi que la contamination de
`front` ci-dessus a été trouvée. Un défaut ouvert est assumé plutôt que comblé par une conjecture : la
même garde se déclenche aussi sur 8 échantillons non perturbés sur 100, et la cause n'est pas encore
identifiée.

```sh
node test/gate-recall.mjs --e3 --perturb all   # 3 conditions × 5 niveaux × 20 graines, ~28 s
node test/gate-recall.mjs --e3 --perturb all --quote-safe-perturb   # le préfixe corrigé
node test/gate-title-distribution.mjs          # distribution des titres du bundle réel (lecture seule)
node test/gate-recall.mjs --e2 --perturb all   # E2
node test/gate-recall.mjs                      # E1
node test/bench-nesting.mjs                    # axe profondeur d'imbrication
node test/smoke.mjs                            # gardes de régression
```

[Rapport E3](docs/benchmarks/gate-recall-2026-07-26-e3.md) ·
[Préenregistrement E3](docs/benchmarks/pre-registration-2026-07-26-e3.md) ·
[Rapport E2](docs/benchmarks/gate-recall-2026-07-26-e2.md) ·
[Préenregistrement E2](docs/benchmarks/pre-registration-2026-07-26-e2.md) ·
[Rapport E1](docs/benchmarks/gate-recall-2026-07-26-e1.md) ·
[Préenregistrement E1](docs/benchmarks/pre-registration-2026-07-26-e1.md)

<!-- okf-benchmark: 2026-07-27-efficiency -->

### Efficacité de la porte — le format d'index mérite-t-il ses octets ? (axe E, 2026-07-27)

E1–E3 n'ont jamais perturbé que les entrées d'OKF lui-même ; la question « ce format mérite-t-il ses
octets ? » ne pouvait donc même pas être posée : il n'existait aucun terme de comparaison. L'axe E en
construit un : **même paquet, même budget en octets, six stratégies d'index interchangées.** Coût :
**0,00 $**, là encore non pas déclaré mais prouvé à l'exécution par le piège PATH.

Les questions ne sont plus écrites à la main. Pour chacun des 20 concepts-réponses, la requête est
générée mécaniquement à partir des 8 termes tf-idf les plus forts de son propre **corps de texte** —
précisément la partie que l'index ne transporte jamais. Le moteur de recherche est BM25 avec des
paramètres standard fixés avant la mesure ; sa normalisation par longueur pénalise les lignes longues,
donc ce choix penche **en défaveur** d'OKF. Le nombre de graines (40) provient d'un calcul de
puissance effectué avant l'exécution, et non d'un héritage d'une manche précédente.

**Sur cinq hypothèses préenregistrées, deux tiennent et trois sont réfutées.**

| Hypothèse | Verdict | Preuve |
|---|---|---|
| titre+description bat les seuls liens de catégorie | **soutenue** | okf gagne 12/12 cellules, toutes à p<1e-4 |
| les descriptions méritent leurs octets | **réfutée** | les retirer gagne 12/12 cellules à ordre égal |
| le round-robin mérite son surcoût | **réfutée, sous condition** | −0,050 au plafond 2048 ; +0,017…+0,218 au plafond 9000 |
| un index trié bat un index aléatoire | soutenue de justesse | okf gagne 7/12 — mais perd les trois cellules à N=26 |
| les chemins seuls ne suffisent pas | **réfutée** | l'index de chemins seuls gagne 8/12 cellules |

La première ligne clôt un point jamais mesuré. La note d'architecture du paquet en production
justifie le changement du 2026-07-17 (« seulement les compteurs de catégorie » → « titre +
description ») par **une seule anecdote** et en chiffre le coût à **n=3**. Il y a désormais un nombre.

**Le format achète de la précision et vend de la capacité.** Une ligne OKF, une fois injectée, est
presque toujours classée première (précision 0,93–1,00) ; le goulot d'étranglement, c'est que les
9 000 octets par défaut ne contiennent qu'environ 12 à 14 lignes de concept. Les lignes titre-seul
tiennent les 26 à N=26 (précision 0,649) ; les lignes chemin-seul également (précision 0,350). **Les
descriptions représentent environ 82 %** des octets d'une ligne — 733 B par ligne, 133 B sans elles.

**Le signe du round-robin s'inverse avec le budget.** Six catégories préemptent chacune un titre de
section et un marqueur d'omission ; au plafond 2048, ce coût fixe dévore le bénéfice à toutes les
tailles (−0,050). Au défaut livré de 9 000, il est rentable, et le gain croît avec le paquet
(+0,218 à N=200). **Le défaut livré est correct à son propre point de fonctionnement** — et le code
applique le round-robin quel que soit le budget.

> **Cela ne dit pas « supprimez les descriptions ».** Cette manche mesure le fait de **trouver**, pas
> celui de **répondre**. La règle 1 de la porte promet : « si le titre et la description contiennent
> la réponse, cite la ligne sans faire de Read » — et ce chemin meurt sans elles. Savoir si les
> descriptions remboursent ces 82 % relève de l'**axe payant, qui n'a jamais été exécuté.** Ce que
> cette manche produit est une étiquette de prix, pas un verdict.

**Paquet en production, lecture seule, uniquement des comptes et des octets.** 26 concepts /
108 431 B. La porte dépense **8 885 B — 98,7 % de son budget — pour montrer 14 concepts sur 26
(53,8 %).** La compression est de 12,2× ; 71,6 % des octets injectés sont de la connaissance et
28,4 % de la structure, dont la seule queue de `log.md` fait 1 341 B (15,1 % de l'injection, soit
2,6 fois les titres de section et les marqueurs d'omission réunis). Le paquet synthétique a prédit
cette couverture de 53,8 % à **2,3 points près** — un contrôle externe de la synthèse.

**Cette manche a trouvé un de ses propres défauts avant publication.** Lors de la première exécution
enregistrée, le taux d'atteinte de la stratégie chemins-seuls était de 0,000 dans les 12 cellules. Lu
tel quel, cela ressemble à un résultat ; c'était un bug : l'évaluateur n'extrayait les chemins que de
la syntaxe de lien markdown. Après correction, cette hypothèse est passée de soutenue à réfutée. Les
neuf nouvelles assertions de fumée ont chacune été testées par mutation, et les six mutations ont tué
leur garde.

**Ce qui n'a pas été mesuré, publié comme tel** : BM25 est un recouvrement lexical, pas un jugement
du modèle ; le paquet est synthétique, ceci est donc une borne supérieure ; la liste des
concepts-réponses reste choisie par moi (seules les requêtes sont mécaniques) ; les scores de `paths`
dépendent du fait que ce paquet est en prose coréenne avec des slugs anglais ; n=40 détecte avec une
puissance de 0,981 un effet cohérent sur 80 % des graines, mais seulement 0,703 à 70 % — donc ici
« pas de différence » signifie « non établi » ; l'échantillon en production est le paquet d'un seul
auteur ; le nombre de tokens n'a pas été mesuré faute de tokeniseur hors ligne ; et aucune lentille
adverse indépendante n'a tourné — la vérification a été faite par moi-même.

```sh
node test/gate-efficiency.mjs                    # 4 tailles × 3 budgets × 40 graines, ~30 s
node test/gate-efficiency.mjs --determinism-check
node test/gate-live-efficiency.mjs               # paquet en production, lecture seule
```

[Rapport axe E](docs/benchmarks/gate-efficiency-2026-07-27.md) ·
[Préenregistrement axe E](docs/benchmarks/pre-registration-2026-07-27-efficiency.md)

### Exécution payante de bout en bout (v3, 2026-07-16)

<!-- okf-benchmark: 2026-07-16-v3 -->

**OKF est un surcoût pour presque tout ce que le code peut résoudre, et là où le code n’a aucune
réponse, un simple CLAUDE.md le surpasse lui aussi — le seul avantage d’OKF est de le faire à moindre
coût. Un test direct de sa promesse fondamentale (les connaissances accumulées finissent par payer
avec le temps) a été mené, puis réfuté.**

Chaque affirmation de ce paragraphe est mesurée ci-dessous, sur de vrais dépôts open source, à n=15
par cellule de comparaison. Les parties peu flatteuses pour OKF sont publiées en premier.

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

Utilisez `~/.claude/okf/.okf/config.md` ou `/okf:okf-config`. Valeurs principales : `enabled: true` (interrupteur maître pour collecte, gate et batch), `batch_interval_hours: 1`, `batch_max_digest_kb: 600`, `capture_exclude_cwd` (globs d’exclusion de la collecte, évalués contre le cwd de la session), `sweep_min_idle_minutes: 60` (délai en minutes après la dernière activité avant collecte ; `0` collecte immédiatement), `batch_digest_cap_kb: 150`, `remove_candidate_ttl_days: 30`, `inject_max_lines` / `inject_max_bytes` : `120` / `9000`, `sweep_backfill_days: 0` (nombre de jours **avant** le marqueur d’installation que le sweep peut remonter ; `0` par défaut = uniquement les conversations postérieures à l’installation ; la fenêtre dure de 7 jours reste le plafond), `batch_max_usd_per_day: 0` (plafond de dépense LLM par jour en USD ; `0` = illimité, la valeur par défaut — le coût est enregistré et affiché dans tous les cas ; garde best-effort dont le cumul vit dans `.okf/last-batch.json`). Les valeurs invalides reviennent à des defaults sûrs.

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
