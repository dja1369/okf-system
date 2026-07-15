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

Le premier `SessionStart` crée `~/.claude/okf` (ou `$CLAUDE_CONFIG_DIR/okf`). Capture et batch opportuniste sont ensuite automatiques.

## Boucle de continuité

```text
décision session 1 -> copie raw sans perte à SessionEnd -> batch en Markdown OKF -> index session 2 -> Read du concept pertinent
```

Ainsi, « déployer 10 % → 50 % → 100 %, rollback au-dessus de 0,5 % d’erreurs » peut être retrouvé sans nouvelle saisie. L’index sert de routage ; Claude doit `Read` le concept avant d’agir.

## Commandes

| Commande | Rôle |
|---|---|
| `/okf:okf-status` | Dernière capture/batch, sessions en attente et verrou |
| `/okf:okf-batch` | Ingest immédiat en respectant le verrou |
| `/okf:okf-config` | Afficher ou modifier la configuration validée |
| `/okf:okf-index` | Catégories, titres et changements récents |
| `/okf:okf-visualize` | Concepts OKF et liens entre concepts uniquement |
| `/okf:okf-analysis [chemin]` | Dépôt analysé avec seulement les concepts OKF liés |

`visualize` ne scanne aucun dépôt. `analysis` refuse les chemins absents/non-répertoires et signale analyse tronquée, concepts sans rapport masqués et statistiques par langage. Les deux produisent un HTML autonome, sans CDN ni réseau à l’exécution.

## Statusline optionnelle

`bin/statusline.mjs` affiche une ligne telle que `OKF 12 · +3 · 2h ago`, sans réseau ni analyse globale. Claude Code n’accepte qu’un `statusLine`; OKF ne l’installe ni ne l’écrase. Ajoutez la sortie de `node /path/to/okf/bin/statusline.mjs` à votre script existant.

## Benchmark de l’effet OKF

<!-- okf-live-benchmark: valid-2026-07-15T15-03-01Z -->

Run live du 2026-07-15 : Claude Code `2.1.210`, `sonnet`/medium (Sonnet 5 + Haiku 4.5), macOS arm64, Node `v26.4.0`, commit `c00d3fc`, cinq répétitions par condition. Avant le follow-up, C avait 8/8 faits dans les concepts et 8/8 routés par le gate ; D avait 0/8.

| Condition | Continuité | token activity p50 / p95 | wall p50 / p95 | coût p50 |
|---|---:|---:|---:|---:|
| A — no memory | 0/5 | 27,320 / 27,574 | 16.40 / 18.17 s | $0.024037 |
| B — manual restatement | 5/5 | 9,070 / 9,093 | 6.07 / 7.42 s | $0.008410 |
| C — OKF enabled | 5/5 | 22,857 / 22,883 | 11.33 / 12.80 s | $0.033189 |
| D — irrelevant OKF | 0/5 | 21,507 / 22,261 | 16.92 / 18.88 s | $0.030332 |

C récupère tous les faits, mais utilise en médiane 13,787 token activity et 5.26 s de plus que B. Aucune amélioration d’efficacité n’est démontrée. Le batch coûte 111,381 token activity/$0.164360 ; B−C est négatif, donc aucun break-even.

Chaque condition est répétée au moins 5 fois. Sont mesurés : succès, conformité, hypothèses fausses, questions, tool calls, première réponse valide, temps API/wall, `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` et coût CLI. Les catégories restent séparées dans le JSON ; batch et repair entrent dans le break-even. Les tokens user-only/gate-only non exposés séparément restent `null`, sans estimation.

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs
```

Exécution payante et opt-in, exclue de CI. Voir le [rapport valide](docs/benchmarks/okf-live-2026-07-15T15-03-01-343Z.md), le [raw JSON](docs/benchmarks/raw/okf-live-2026-07-15T15-03-01-343Z.json) et [docs/USAGE.md](docs/USAGE.md).

### Overhead local — pas le résultat d’efficacité

Mesure fraîche du 2026-07-15, macOS arm64, Node `v26.4.0` :

| Opération | Médiane | Plage |
|---|---:|---:|
| Processus SessionStart gate | 57.4 ms | 56.7–58.2 ms |
| Processus SessionEnd capture sans perte | 43.4 ms | 41.8–43.9 ms |
| Processus statusline | 36.7 ms | 34.8–36.8 ms |

Reproduire avec `node test/bench.mjs [dépôt]`. Cela mesure le coût local, pas une économie de tokens ni la vitesse du modèle.

### Coût batch et break-even

```text
coût OKF initial = batch ingest + repair + overhead mesuré du gate non pertinent
économie/session = médiane manual-restatement - médiane OKF
sessions break-even = ceil(coût initial / économie positive par session)
```

L’économie B−C mesurée est négative ; ce run n’a donc aucun break-even token ou coût.

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

- `SessionEnd` copie le transcript complet dans `raw/`, sans perte.
- Batch crée un digest plafonné et l’envoie à Anthropic via un `claude -p` séparé : seule transmission modèle/API ajoutée.
- Il utilise `--safe-mode`, des tools limités, le prompt via stdin, lint/rollback et aucun Bash.
- Raw est ignoré par git ; seul le Markdown extrait est commit localement. Aucun push ni remote ajouté.
- Répertoires POSIX `0700`, raw/state/log `0600`. Les logs persistants excluent transcript, stdout/stderr Claude, credentials et chemins raw complets.
- Le fixture live est synthétique, sans donnée personnelle ni credential.

## Configuration et suppression

Utilisez `~/.claude/okf/.okf/config.md` ou `/okf:okf-config`. Valeurs principales : `enabled: true`, `batch_interval_hours: 1`, `batch_max_digest_kb: 600`, `batch_digest_cap_kb: 150`, `remove_candidate_ttl_days: 30`, `inject_max_lines` / `inject_max_bytes` : `120` / `9000`. Les valeurs invalides reviennent à des defaults sûrs.

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
