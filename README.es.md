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

<!-- okf-live-benchmark: valid-2026-07-15T16-06-28Z -->

**OKF no ahorra tokens. Recupera lo que una sesión nueva ya ha perdido.** Publicamos las cifras porque dicen justo eso.

A una sesión de follow-up se le piden ocho hechos que estableció una sesión anterior, más un control que la memoria no puede resolver: arquitectura (SQLite / repository pattern), regla de código (named export only), fix de un incidente pasado (`busy_timeout=5000`), preferencia de respuesta (coreano / conciso), política de archivo y despliegue (`src/config.mjs` / `npm run deploy:canary`) y aritmética ajena (7 × 8 = 56). El bundle de C se construye con una captura SessionEnd **real** → batch ingest aislado → gate SessionStart; nada sembrado a mano. Un preflight se niega a gastar dinero salvo que C contenga y rutee por el gate todos los hechos objetivo, y D no contenga ninguno.

- **A — no memory.** El statu quo honesto: sesión nueva, nada repetido.
- **B_oracle — la hoja de respuestas.** Pega los 8 valores esperados. Escribir ese texto exige saber ya todo lo que OKF existe para recuperar, así que **ningún usuario puede ocupar esta condición**: es una cota superior, no una línea base, y su trabajo humano se cotiza a cero.
- **B_realistic — lo que la gente hace de verdad.** Repite todo lo que pueda ser relevante, porque no se sabe de antemano qué hará falta. Es el hábito CLAUDE.md, y la comparación real.
- **C — OKF enabled.**
- **D — irrelevant OKF.** Gate sin contenido relevante, para separar «el gate ayudó» de «un gate cuesta algo».

Ejecución live del 2026-07-15: Claude Code `2.1.210`, `sonnet`/medium (Sonnet 5 + Haiku 4.5), macOS arm64, Node `v26.4.0`, cinco repeticiones cruzadas por condición. Preflight de C: 8/8 hechos presentes, 8/8 ruteados por el gate; D: 0/8.

| Condición | Continuidad | token activity p50 | wall p50 | coste p50 | Reads | Turnos |
|---|---:|---:|---:|---:|---:|---:|
| A — no memory | **0/5** | 27,246 | 13.82 s | $0.022218 | 2 | 4 |
| B_oracle (hoja de respuestas) | 5/5 | 9,069 | 4.86 s | $0.008410 | 0 | 1 |
| B_realistic | 5/5 | 9,069 | 5.96 s | $0.008410 | 0 | 1 |
| **C — OKF enabled** | **5/5** | **10,395** | 6.46 s | $0.011329 | **0** | **1** |
| D — irrelevant OKF | 0/5 | 20,602 | 14.50 s | $0.025879 | 1 | 2 |

**Lee primero la fila A.** Sin memoria la sesión quema 27,246 tokens, lee dos archivos buscando la respuesta, gasta cuatro turnos — y aun así saca **0/8**. Esa es la condición que OKF sustituye de verdad, y C la gana: 2.6× menos tokens, 8/8, en un solo turno y sin leer archivos.

**C no le gana a B, y nunca lo hará.** B pega las respuestas en el prompt; nada recupera más rápido que ya tenerlo. Con este tamaño de bundle B_realistic iguala a B_oracle (aún no hay conocimiento ajeno que repetir), así que ambos quedan en 9,069. C cuesta 1,326 tokens y $0.0029 más por sesión. Construir el bundle costó un batch ingest de **133,364** token activity y **$0.176758**. **No existe break-even de tokens ni de coste**: `perSessionTokenSaving` es negativo y el harness reporta `null` en vez de inventar uno.

Lo que cambió desde la ejecución anterior es el gate. C costaba **22,857** tokens en 7 turnos con 5 lecturas; ahora cuesta **10,395** en 1 turno y 0 lecturas, con el mismo recall 5/5. El gate viejo ordenaba un `Read` incondicional, y el 91% de su overhead era ese ida y vuelta releyendo hechos que el índice ya había entregado.

### El límite de acumulación — medido, no proyectado

**«OKF se abarata según se acumula conocimiento» es falso.** Se encarece, y más rápido que la alternativa. Mismo benchmark, mismo bundle, con 20 conceptos ajenos añadidos — todo sigue cabiendo en el índice (21 líneas, 5.548 de 9.000 bytes, nada truncado):

| Condición | 0 relleno | 20 relleno | Crecimiento |
|---|---:|---:|---:|
| B_realistic | 9,069 | 10,406 | **+1,337** |
| **C — OKF enabled** | 10,395 | **25,384** | **+14,989** |

**C se degrada ~11× más rápido que B** — 749 tokens por concepto añadido frente a 67. Ambos siguen respondiendo 5/5.

La causa no es el truncado. Es la confianza:

```
0 relleno:   C reads=0  turns=1    responde directo desde la línea del índice
20 relleno:  C reads=3  turns=4    vuelve a abrir archivos
```

Veinte conceptos irrelevantes bastaron para que el modelo dejara de creerle a la línea del índice y fuera a verificar contra el archivo — reviviendo justo el ida y vuelta que el fix del gate había eliminado. El índice dice que una línea existe; no dice que esa línea sea la respuesta *completa*, así que cuanto más ruido la rodea, más racional es ir a comprobar. **Este es el techo real, y llega a los ~21 conceptos — mucho antes de que ningún tope apriete.**

El truncado es el segundo muro, más lejos. El índice tiene un tope duro para no pasar el límite de 10.000 caracteres del hook, y una línea de concepto real en coreano ocupa ~214 bytes:

| Conceptos en el bundle | Mostrados en el índice |
|---:|---:|
| 20 | 20 |
| 40 | 40 |
| **55** | **43** (truncado) |
| 100 | 43 (truncado) |

**Pasados ~43 conceptos el índice trunca**, y lo que sobrevive lo decide el nombre de archivo, no la relevancia ni la recencia. Una ejecución con 50 conceptos de relleno **falla el preflight** justo por esto (`presentFacts: 8, routedFacts: 6, ready: false`): `decisions/tech-stack.md` quedó por detrás del relleno y fue cortado, llevándose dos hechos. Las categorías se reparten round-robin para que ninguna se quede sin nada, y cada categoría truncada apunta a su propio `index.md`, así que el resto sigue alcanzable — pero descender es un ida y vuelta de tool, el mismo coste otra vez.

Ninguno de los dos muros es una perilla de configuración. Arreglar el primero exige que el índice señale *qué líneas son respuestas completas* para que el modelo pueda confiar en ellas sin abrir el archivo; ese trabajo no está hecho, y hasta que lo esté, la economía de OKF empeora con cada concepto añadido.

Se guardan además cumplimiento de decisiones, supuestos erróneos, preguntas extra, tool calls, primera respuesta válida, tiempo API/wall, `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` y coste del CLI. Las categorías siguen separadas en JSON. `tokenActivity` suma las lecturas de caché 1:1 con los tokens de salida aunque facturen ~50× más barato — **el coste es la columna defendible** —, y con n=5 el `p95` es siempre el máximo aritmético (la ejecución en frío), así que se omite. Valores no separados por el CLI, como tokens solo del usuario o del gate, quedan `null`, sin estimación.

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                      # lo publicado arriba
OKF_RUN_LIVE_BENCH=1 OKF_BENCH_FILLER=50 node test/bench-okf.mjs  # eje de acumulación
```

Es opt-in, autenticada y de pago, fuera de CI. Véanse el [informe](docs/benchmarks/okf-live-2026-07-15T16-06-28-592Z.md), [raw JSON](docs/benchmarks/raw/okf-live-2026-07-15T16-06-28-592Z.json) y [docs/USAGE.md](docs/USAGE.md). La ejecución anterior al fix se conserva como rastro de auditoría.

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
ahorro por sesión = mediana B_realistic - mediana OKF
sesiones break-even = ceil(coste inicial / ahorro positivo por sesión)
```

El ahorro B_realistic−C medido fue negativo; no existe break-even de tokens ni coste en este run.

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
