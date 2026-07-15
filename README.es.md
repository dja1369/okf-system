# OKF para Claude Code

**Convierte decisiones de sesiones anteriores de Claude Code en conocimiento local y revisable que una sesión futura puede usar de verdad.**

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · **Español** · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português](README.pt-BR.md)

OKF captura la conversación al cerrar una sesión, extrae decisiones y soluciones reutilizables como Markdown e inyecta un índice compacto en la siguiente sesión. El bundle es un repositorio git local que puedes inspeccionar, comparar, respaldar o borrar.

## Inicio en un minuto

Requiere Claude Code con plugins, Node.js y git. No hay `npm install`.

```sh
claude plugin marketplace add dja1369/okf-system
claude plugin install okf@okf-marketplace
```

Reinicia Claude Code, termina una sesión normal y ejecuta:

```text
/okf:okf-status
/okf:okf-index
```

El primer `SessionStart` crea `~/.claude/okf` (o `$CLAUDE_CONFIG_DIR/okf`). La captura y el batch oportunista son automáticos.

## Flujo de continuidad

```text
decisión en sesión 1 -> copia raw sin pérdida en SessionEnd -> batch crea Markdown OKF -> índice en sesión 2 -> Read del concept relevante
```

Por ejemplo, “desplegar 10% → 50% → 100% y revertir por encima de 0,5% de errores” puede recuperarse sin que el usuario vuelva a pegarlo. El índice enruta; Claude debe hacer `Read` del concept antes de actuar.

## Comandos

| Comando | Uso |
|---|---|
| `/okf:okf-status` | Última captura/batch, sesiones pendientes y lock |
| `/okf:okf-batch` | Ingest inmediato respetando el lock |
| `/okf:okf-config` | Ver o editar configuración validada |
| `/okf:okf-index` | Categorías, títulos y cambios recientes |
| `/okf:okf-visualize` | Solo concepts OKF y sus relaciones |
| `/okf:okf-analysis [ruta]` | Repositorio más los concepts OKF relacionados |

`visualize` no analiza código. `analysis` rechaza rutas inexistentes o que no sean directorios e informa truncamiento, concepts no relacionados ocultos y estadísticas por lenguaje. Ambos producen HTML autocontenido sin CDN ni red en ejecución.

## Statusline opcional

`bin/statusline.mjs` produce una línea como `OKF 12 · +3 · 2h ago` sin red ni análisis completo. Claude Code solo admite un `statusLine`; OKF no lo instala ni reemplaza. Añade la salida de `node /path/to/okf/bin/statusline.mjs` a tu script existente.

## Benchmark del efecto OKF

<!-- okf-live-benchmark: valid-2026-07-15T15-03-01Z -->

Ejecución live del 2026-07-15: Claude Code `2.1.210`, `sonnet`/medium (Sonnet 5 + Haiku 4.5), macOS arm64, Node `v26.4.0`, commit `c00d3fc`, cinco repeticiones por condición. Antes del follow-up, C tenía 8/8 hechos en concepts y 8/8 rutas en gate; D tenía 0/8.

| Condición | Continuidad | token activity p50 / p95 | wall p50 / p95 | coste p50 |
|---|---:|---:|---:|---:|
| A — no memory | 0/5 | 27,320 / 27,574 | 16.40 / 18.17 s | $0.024037 |
| B — manual restatement | 5/5 | 9,070 / 9,093 | 6.07 / 7.42 s | $0.008410 |
| C — OKF enabled | 5/5 | 22,857 / 22,883 | 11.33 / 12.80 s | $0.033189 |
| D — irrelevant OKF | 0/5 | 21,507 / 22,261 | 16.92 / 18.88 s | $0.030332 |

C recuperó todos los hechos, pero frente a B usó 13,787 token activity más y 5.26 s más de wall time en la mediana. No demuestra mejora de eficiencia. Un batch costó 111,381 token activity/$0.164360; B−C fue negativo, sin break-even.

Cada condición se repite al menos 5 veces. Se guardan éxito, cumplimiento, supuestos erróneos, preguntas, tool calls, primera respuesta válida, tiempo API/wall, `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` y coste del CLI. Las categorías siguen separadas en JSON; batch y repair entran en el break-even. Valores no separados por el CLI, como tokens solo del usuario o gate, quedan `null`, sin estimación.

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs
```

Es opt-in, autenticada y de pago, fuera de CI. Véanse el [informe válido](docs/benchmarks/okf-live-2026-07-15T15-03-01-343Z.md), [raw JSON](docs/benchmarks/raw/okf-live-2026-07-15T15-03-01-343Z.json) y [docs/USAGE.md](docs/USAGE.md).

### Overhead local — no es el resultado de efectividad

Medición nueva del 2026-07-15, macOS arm64, Node `v26.4.0`:

| Operación | Mediana | Rango |
|---|---:|---:|
| SessionStart gate | 57.4 ms | 56.7–58.2 ms |
| SessionEnd capture sin pérdida | 43.4 ms | 41.8–43.9 ms |
| statusline | 36.7 ms | 34.8–36.8 ms |

Reproduce con `node test/bench.mjs [repositorio]`. Solo mide procesos locales, no ahorro de tokens ni velocidad del modelo.

### Coste batch y break-even

```text
coste inicial OKF = batch ingest + repair + overhead medido del gate irrelevante
ahorro por sesión = mediana manual-restatement - mediana OKF
sesiones break-even = ceil(coste inicial / ahorro positivo por sesión)
```

El ahorro B−C medido fue negativo; no existe break-even de tokens ni coste en este run.

## Lenguajes

El analizador fallback es determinista, sin dependencias y conservador; distingue “archivo encontrado” de “estructura analizada”.

| Lenguaje | Relaciones y declaraciones | Límites principales |
|---|---|---|
| JS / TS | import/export/require relativo, function/class | paquetes bare externos |
| Python | módulos dotted, function/class | import dinámico omitido |
| Go | package nodes internos desde `go.mod`, function/struct | no inventa file edges |
| Rust | `mod`/`use`, function/struct/enum/trait | macros omitidas |
| Java / Kotlin | package/class paths, tipos y Kotlin function | reflexión omitida |
| Ruby | `require_relative`, class/method | gems externos |
| PHP | namespace/use/alias/grouped use, require/include, tipos/function | autoload dinámico omitido |
| C / C++ | quoted include, angle local único con ruta explícita, tipos/namespace/function definition | regex puede omitir macros o sintaxis multilínea compleja |
| C# | namespace nodes declarados, tipos principales | namespaces externos no se enlazan |
| Swift | inheritance/conformance/extension explícitos, tipos/function | targets nested entre archivos se omiten para evitar colisiones |

A 2.000 archivos se marca `truncated`; archivos mayores de 512 KiB siguen visibles pero no analizados.

## Validación con open source real

Se clonaron commits fijos y se contrastaron edges representativos con el código fuente. Los tiempos son solo seguridad operativa.

| Repositorio | Commit | Archivos del lenguaje | Declaraciones | Internal edges | Truncated |
|---|---|---:|---:|---:|---:|
| [Slim](https://github.com/slimphp/Slim) | `80900fb` | 125 | 127 | 305 | no |
| [Redis](https://github.com/redis/redis) | `f76dff7` | 784 | 5,796 | 990 | no |
| [fmt](https://github.com/fmtlib/fmt) | `a79df45` | 46 | 283 | 121 | no |
| [Alamofire](https://github.com/Alamofire/Alamofire) | `903c53c` | 98 | 2,052 | 215 | no |

La validación detectó y corrigió un `Error` estándar de Swift enlazado a un tipo nested homónimo y headers estándar C enlazados a copias vendored. Detalles en el [informe](docs/benchmarks/oss-analysis-2026-07-15.md).

## Datos y privacidad

- `SessionEnd` copia el transcript completo a `raw/` sin pérdida.
- Batch crea un digest limitado y lo envía a Anthropic mediante otro `claude -p`; es la única transferencia de modelo/API adicional.
- Usa `--safe-mode`, tools restringidas, prompt por stdin, lint/rollback y sin Bash.
- Raw está ignorado por git; solo el Markdown extraído se confirma localmente. El plugin no hace push ni añade remote.
- Directorios POSIX `0700`, raw/state/log `0600`. Los logs persistentes excluyen transcript, stdout/stderr de Claude, credenciales y rutas raw completas.
- El fixture live es sintético, sin datos personales ni credenciales.

## Configuración y desinstalación

Usa `~/.claude/okf/.okf/config.md` o `/okf:okf-config`. Valores principales: `enabled: true`, `batch_interval_hours: 1`, `batch_max_digest_kb: 600`, `batch_digest_cap_kb: 150`, `remove_candidate_ttl_days: 30`, `inject_max_lines` / `inject_max_bytes`: `120` / `9000`. Valores inválidos vuelven a defaults seguros.

```sh
claude plugin uninstall okf
```

El bundle queda en `~/.claude/okf` para revisarlo, respaldarlo o borrarlo manualmente.

## Verificación de desarrollo

```sh
node test/smoke.mjs
node test/bench.mjs
for file in $(rg --files -g '*.mjs'); do node --check "$file"; done
claude plugin validate .claude-plugin/plugin.json
claude plugin validate .claude-plugin/marketplace.json
git diff --check
```

Live: `OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs`.

## Referencias y licencia

La estructura se inspira en la presentación concisa y reproducible de [uv](https://github.com/astral-sh/uv), [Ruff](https://github.com/astral-sh/ruff), [Playwright](https://github.com/microsoft/playwright), [fmt](https://github.com/fmtlib/fmt) y [Slim](https://github.com/slimphp/Slim), sin copiar texto ni afirmaciones. [Especificación OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md). Licencia: [MIT](LICENSE).
