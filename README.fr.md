# OKF for Claude Code

**Votre agent oublie tout ce que vous lui avez dit hier. Voici le correctif — et la
mémoire qu'il construit est un dossier de fichiers markdown qui vous appartient, pas une base de données qui vous enferme.**

![Licence MIT](https://img.shields.io/badge/license-MIT-blue) ![OKF v0.1](https://img.shields.io/badge/OKF-v0.1%20Draft-4ecdc4) ![Node uniquement](https://img.shields.io/badge/runtime-Node%20only-5c6bc0) ![aucun npm install](https://img.shields.io/badge/dependencies-vendored-66bb6a)

**[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · Français · [Deutsch](README.de.md) · [Português](README.pt-BR.md)**

![Graphe de connaissances OKF — les concepts reliés au code qu'ils décrivent](docs/okf-graph.png)

<sub>`/okf:okf-visualize` — vos connaissances (nœuds en contour) et votre base de code dans un seul graphe.
Les arêtes jaunes en pointillés sont l'essentiel : chaque concept est relié aux fichiers source
dont il parle réellement.</sub>

Chaque session repart de zéro. Vous réexpliquez la même décision d'architecture, la
même politique de déploiement, le même « on a essayé, ça a cassé » — et dès que la
session se termine, tout disparaît à nouveau. Pendant ce temps, les connaissances qui
*auraient* répondu à la question sont éparpillées entre les wikis, les commentaires de
code et, comme le dit l'annonce OKF de Google, « the heads of a few senior engineers »
(la tête de quelques ingénieurs seniors).

Ce plugin ferme cette boucle automatiquement : il capture ce dont vous avez réellement
discuté, en distille les parties réutilisables dans un bundle de connaissances
structuré, et remet ces connaissances sous les yeux du modèle au début de chaque session.

## Le format

Les connaissances sont stockées au format **[OKF (Open Knowledge Format)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)** —
une spécification ouverte que Google Cloud a [publiée en juin 2026](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/?hl=en&utm_source=pytorchkr&ref=pytorchkr)
(v0.1 Draft, Apache-2.0). Il est délibérément banal, et c'est tout l'intérêt :

> "The format is intentionally minimal: a directory of markdown files with YAML
> frontmatter. There is no schema registry, no central authority, and no required
> tooling. **If you can `cat` a file, you can read OKF; if you can `git clone` a
> repo, you can ship it.**"

OKF formalise le motif du « LLM wiki » qu'[Andrej Karpathy avait esquissé](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
dix semaines plus tôt — l'annonce de Google le dit explicitement. Depuis sa publication, un
[petit écosystème](https://github.com/search?q=%22open+knowledge+format%22&type=repositories)
de générateurs, linters, visualiseurs et serveurs MCP s'est formé autour, et le format
apparaît aussi en dehors de Google (AWS propose un [exemple](https://github.com/aws-samples/sample-okf-llm-wiki)
qui expose des bases Glue sous forme de bundles OKF). C'est tout récent — la majeure
partie de cet écosystème n'a que quelques semaines — mais le format fait ce qu'il annonce :
être lisible sans les outils de son auteur.

**Pourquoi un format et non un produit de mémoire.** Des outils comme mem0, Letta, Zep et
Cognee sont des *runtimes* de mémoire — vous intégrez une bibliothèque ou hébergez un
service, et votre mémoire vit dans son magasin vectoriel ou son graphe. C'est une couche
différente, pas un concurrent ; certains d'entre eux pourraient stocker de l'OKF. La
différence pratique, c'est le **coût de sortie** : des connaissances enfouies dans une base
de données orientée graphe ne sont lisibles que par ce système, alors qu'un bundle OKF
s'ouvre dans votre éditeur, s'affiche sur GitHub, se compare dans une pull request et se
lit par n'importe quel autre agent sans étape de traduction. Ce plugin ne vous demande
jamais de lui confier l'unique copie.

## Ce qu'il fait

1. **Capture** l'intégralité de la conversation de chaque session, sans perte, à sa fin.
2. **Compresse** les sessions capturées en arrière-plan (un traitement par lots
   opportuniste, pas une tâche cron/planifiée) à l'aide de `claude -p` pour en extraire
   les connaissances réutilisables — decisions, project facts, preferences, patterns,
   references, troubleshooting.
3. **Injecte** un index de ce bundle dans le contexte de chaque nouvelle session sous
   forme de gate obligatoire, pour que Claude lise vraiment les connaissances passées
   pertinentes avant de travailler sur un sujet connexe, au lieu de repartir de zéro à
   chaque fois.
4. **Visualise** le bundle et votre base de code dans un seul graphe, en reliant chaque
   concept aux fichiers dont il parle réellement (`/okf:okf-visualize`).

Tout réside dans un dépôt git local sous `~/.claude/okf` (ou
`$CLAUDE_CONFIG_DIR/okf`). Rien n'est poussé nulle part. Les seuls appels réseau sont
ceux que vous faites déjà vers l'API d'Anthropic — l'étape de batch n'est qu'un appel
`claude -p` de plus, exécuté localement.

## Prérequis

- Claude Code avec la prise en charge des plugins
- Node.js (la version que `claude` exige déjà lui-même — aucun runtime supplémentaire)
- git

Aucune étape `npm install`. Aucun service externe. Aucune configuration requise pour
démarrer.

## Installation

```
claude plugin marketplace add dja1369/okf-system
claude plugin install okf@okf-marketplace
```

(Pour installer depuis un clone local à la place : `claude plugin marketplace add /path/to/your/clone`.)

C'est tout — redémarrez votre session et les hooks de gate/capture sont actifs. Au
démarrage de la session suivante, le bundle est initialisé automatiquement (un dépôt git
local est créé sous `~/.claude/okf` avec la structure de base).

Pour désinstaller : `claude plugin uninstall okf`. Vos données dans `~/.claude/okf`
restent intactes — c'est un simple dépôt git que vous pouvez inspecter, sauvegarder ou
supprimer manuellement avec `rm -rf ~/.claude/okf`.

## Utilisation

L'usage normal ne demande rien de votre part. La capture et la compression par lots se
font automatiquement. Cinq commandes sont disponibles pour l'inspection/le contrôle
manuels — **notez le préfixe `okf:`**, requis car ce sont des commandes propres au plugin :

| Commande | Ce qu'elle fait |
|---|---|
| `/okf:okf-status` | Indique la dernière exécution du batch, les sessions en attente, l'état du verrou |
| `/okf:okf-batch` | Force une exécution immédiate du batch (ignore le gate d'intervalle, respecte toujours le verrou) |
| `/okf:okf-config` | Affiche la configuration actuelle et permet de la modifier |
| `/okf:okf-index` | Affiche un aperçu lisible du bundle — chaque catégorie et titre de concept, plus les changements récents de `log.md` |
| `/okf:okf-visualize` | Rend le bundle + votre base de code sous forme d'un seul graphe interactif (HTML autonome) |

Une installation neuve n'est pas vide : le bundle est livré pré-alimenté avec des concepts
décrivant OKF lui-même, l'architecture de ce plugin et les règles de rédaction du bundle —
ainsi le gate a quelque chose de concret à montrer dès la première session, et le bundle
se documente lui-même.

## Visualisation

`/okf:okf-visualize` rend vos connaissances et votre code sous forme d'un seul graphe. L'intérêt
n'est dans aucune des deux moitiés — il est dans les liens en pointillés entre elles, qui
relient chaque concept aux fichiers source dont il parle réellement.

Si [Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) a déjà analysé
le dépôt (`.understand-anything/` ou `.ua/knowledge-graph.json`), c'est ce graphe plus
riche, résumé par LLM, qui est utilisé. Sinon, l'analyseur intégré à ce plugin en construit
un — du Node pur, sans module natif, qui extrait les fichiers, les fonctions, les classes
et le graphe d'imports pour JS/TS, Python, Go, Rust, Java/Kotlin, Ruby, PHP, C/C++, C# et Swift.

Le résultat est un fichier HTML autonome : pas de CDN, pas de requêtes réseau, pas de
backend. Il s'ouvre hors ligne, parce qu'ouvrir sa propre base de connaissances ne devrait
appeler personne.

## Fonctionnement

![Architecture : les sessions sont capturées dans raw, un batch en arrière-plan distille un bundle OKF, l'index du bundle est réinjecté dans la session suivante](docs/architecture.svg)

- **La capture** est une pure copie de fichier — aucun parsing, aucun filtrage, aucune
  limite de taille. La transcription complète est écrite dans `raw/` à chaque
  `SessionEnd`. C'est délibéré : une base de connaissances bâtie sur un souvenir partiel
  de ce qui s'est passé est pire que pas de base du tout.
- **La compression** n'a lieu qu'au moment du batch, sur une copie de travail — l'original
  capturé n'est jamais touché. Elle s'exécute avec un accès aux outils restreint à
  `Read/Glob/Grep/Write/Edit` (pas de `Bash`) et avec tous *vos* autres hooks,
  plugins et serveurs MCP désactivés pour cet appel précis (`--safe-mode`), afin qu'elle
  ne puisse pas reboucler sur sa propre capture.
- **Le gate** injecte un index de catégories compact (pas le texte complet des concepts)
  ainsi que les changements récents, et impose à Claude de faire un vrai `Read` du fichier
  concerné avant de toucher à un travail connexe — l'index seul ne suffit pas pour qu'il
  agisse sur des hypothèses périmées.
- Un linter structurel maintient le bundle toujours conforme à la spécification : si une
  exécution du batch laissait quoi que ce soit de malformé, elle est automatiquement
  annulée avant le commit.

Voir l'[annonce Open Knowledge Format](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/?hl=en&utm_source=pytorchkr&ref=pytorchkr) de Google Cloud pour le contexte et les choix de conception du format — ce ne sont que des
fichiers markdown avec du frontmatter YAML, lisibles par n'importe quel outil, sans rien de spécifique à ce plugin.

## Configuration

Modifiez directement `~/.claude/okf/.okf/config.md` (frontmatter), ou utilisez
`/okf:okf-config`.

| Clé | Défaut | Signification |
|---|---|---|
| `enabled` | `true` | Interrupteur général marche/arrêt (capture, gate et batch le suivent tous) |
| `batch_interval_hours` | `1` | Durée minimale entre deux exécutions du batch |
| `batch_max_digest_kb` | `600` | Budget par exécution sur le total d'octets de digest — le vrai plafond de coût. Les sessions au-delà du budget passent à l'exécution suivante |
| `batch_max_sessions` | `50` | Plafond de sécurité uniquement ; `batch_max_digest_kb` est le véritable réglage |
| `seed_language` | `en` | Langue des concepts pré-alimentés au premier bootstrap (`en`, `ko` ; les valeurs inconnues retombent sur `en`) |
| `batch_model` | `claude-sonnet-5` | Modèle utilisé pour l'ingestion par lots ; vide = valeur par défaut de la CLI |
| `batch_effort` | `medium` | Effort de raisonnement pour l'ingestion par lots (`low`/`medium`/`high`/`xhigh`/`max`) ; vide = valeur par défaut de la CLI |
| `capture_exclude_cwd` | `[]` | Motifs glob des répertoires à ne pas capturer (opt-out uniquement — la capture elle-même n'est jamais partielle) |
| `batch_digest_cap_kb` | `150` | Plafond de taille par session pour le résumé destiné au LLM (l'original capturé n'est jamais plafonné) |
| `remove_candidate_ttl_days` | `30` | Durée de conservation des transcriptions brutes déjà traitées avant suppression |
| `inject_max_lines` / `inject_max_bytes` | `120` / `16384` | Plafonds de taille de l'injection du gate |
| `claude_bin` / `node_bin` | *(vide)* | Chemins absolus de substitution si la résolution via `PATH` échoue dans votre environnement |

## Données et confidentialité

- Tout reste local : `~/.claude/okf` est un dépôt git ordinaire à part entière,
  entièrement séparé du dépôt sur lequel vous travaillez. **Aucun chemin de code de ce
  plugin n'exécute jamais `git push`, `git remote add`, ni quoi que ce soit de lié au
  réseau dessus** — les seules opérations git utilisées, où que ce soit, sont `init`,
  `commit`, `checkout` et `clean` (vérifiable : `grep -n "push\|remote" lib/*.mjs bin/*.mjs` —
  les seules correspondances sont des appels `Array.push()` sans rapport). Votre bundle ne
  quitte jamais votre machine, sauf si vous le poussez délibérément vous-même avec `git push`.
- L'étape de batch envoie le contenu des sessions à l'API d'Anthropic pour effectuer le
  résumé/l'extraction — la même API que celle que votre usage normal de Claude Code
  sollicite déjà, simplement via un appel `claude -p` de plus. Aucun service tiers
  n'intervient.
- `raw/` (les transcriptions complètes capturées) et les transcriptions traitées en attente
  de suppression sont ignorées par git, pas committées — seul le bundle de connaissances extrait l'est.

## Portabilité

Aucun chemin n'est jamais codé en dur — tout est résolu via `os.homedir()` /
`process.env.CLAUDE_CONFIG_DIR` / `process.env.HOME`, si bien qu'une installation neuve sur
une autre machine ou un autre compte utilisateur produit son propre bundle indépendant.
C'est vérifié par la suite de tests (`test/smoke.mjs`, 78 scénarios) dans des bacs à sable
`HOME`/`CLAUDE_CONFIG_DIR` isolés, dont un **sans aucune identité git configurée** — le
plugin ne dépend jamais de vos `user.name`/`user.email` ; ses propres commits automatisés
utilisent toujours une identité synthétique fixe
(`OKF Batch <okf-batch@localhost>`). macOS et Linux sont testés ainsi
directement ; les chemins spécifiques à Windows (`shell:true` pour `claude.cmd`, séparateurs
de chemin) sont implémentés conformément aux exigences du document de conception, mais n'ont
pas encore été exécutés sur une véritable machine Windows — considérez cette combinaison
comme non vérifiée tant que personne ne l'a confirmée.

## Licence

MIT
