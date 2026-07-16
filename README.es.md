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

El primer `SessionStart` crea `~/.claude/okf` (o `$CLAUDE_CONFIG_DIR/okf`). La recolección y el batch oportunista son automáticos, y una conversación se recolecta cerca de una hora después de su última actividad, así que no hace falta terminar la sesión explícitamente.

## Flujo de continuidad

```text
Sesión 1                ~1h idle                 Batch en segundo plano       Sesión 2
toma una decisión  ->   el sweep recolecta   ->   Markdown OKF reutilizable  ->  índice compacto inyectado
(sin fin explícito         raw (copia sin              |                              |
 requerido)                 pérdida; el crecimiento     +-- historial git local        +-- Read del concept relevante
                            re-recolecta)
```

Por ejemplo, “desplegar 10% → 50% → 100% y revertir por encima de 0,5% de errores” puede recuperarse sin que el usuario vuelva a pegarlo. El índice enruta; Claude debe hacer `Read` del concept antes de actuar.

¿Por qué basado en inactividad? Las sesiones rara vez terminan explícitamente —los agentes en segundo plano nunca lo hacen— y una instantánea de fin de sesión tomada al hacer `resume` solía congelar una conversación a medio camino como “procesada”, perdiendo todo lo dicho después. Por eso el sweep recolecta un transcript una vez que ha estado inactivo durante `sweep_min_idle_minutes` (60 por defecto), el proceso de batch persiste hasta que las conversaciones pendientes alcanzan la inactividad (sondeando cada ~5 minutos, hasta 8 horas), una sesión ya recolectada se recolecta **de nuevo** solo si creció después, y una sesión sin cambios nunca se vuelve a recolectar. Los hooks de sesión solo despiertan el batch.

## Comandos

| Comando | Uso |
|---|---|
| `/okf:okf-status` | Último batch, sesiones pendientes y estado del lock |
| `/okf:okf-batch` | Ingest inmediato respetando el lock |
| `/okf:okf-config` | Ver o editar configuración validada |
| `/okf:okf-index` | Categorías, títulos y cambios recientes |
| `/okf:okf-visualize` | Solo concepts OKF y sus relaciones |
| `/okf:okf-analysis [ruta]` | Repositorio más los concepts OKF relacionados |

`visualize` no analiza código. `analysis` rechaza rutas inexistentes o que no sean directorios e informa truncamiento, concepts no relacionados ocultos y estadísticas por lenguaje. Ambos producen HTML autocontenido sin CDN ni red en ejecución.

## Statusline opcional

`bin/statusline.mjs` produce una línea como `OKF 12 · +3 · 2h ago` sin red ni análisis completo. Claude Code solo admite un `statusLine`; OKF no lo instala ni reemplaza. Añade la salida de `node /path/to/okf/bin/statusline.mjs` a tu script existente.

## Benchmark de OKF

<!-- okf-benchmark: 2026-07-16-v3 -->

**OKF no te ahorra explorar. Almacena lo que explorar nunca puede encontrar.**

Las dos mitades de esa frase están medidas abajo, sobre repositorios open-source reales, con n=15 por
celda de comparación. La mitad que resulta desfavorable para OKF se publica primero.

### Cómo se midió

Dos repositorios públicos fijados — sin fixture sintético, así que explorar cuesta lo que explorar
cuesta de verdad y la línea base sin memoria puede ganar genuinamente:

| Rol | Repositorio | Commit |
|---|---|---|
| Codebase | [slimphp/Slim](https://github.com/slimphp/Slim) | `80900fb3` (125 archivos PHP) |
| Pila de documentos | [rust-lang/rfcs](https://github.com/rust-lang/rfcs) | `f635361c` (651 archivos Markdown) |

Cada concept de cada bundle lo produjo el pipeline real — una sesión `claude -p` real explorando el
repo fijado, su transcript real de Claude Code, batch ingest real, gate real. **Ningún concept se
escribió a mano.** Los bundles están commiteados en este repositorio
([docs/benchmarks/bundles/](docs/benchmarks/bundles/)), así que puedes leer el texto exacto del gate y
los cuerpos de los concepts sobre los que descansa cada número de abajo, y refutar esta ejecución como
se refutó v2 — desde el repo, sin confiar en el autor.

Cinco condiciones. Todas reciben tools idénticas (`Read`, `Glob`, `Grep`, `Bash(git log/show/diff/blame/grep)`)
y una instrucción idéntica y neutral respecto a la condición — a ninguna condición se le dice que consulte el gate. El gate
se entrega a través del **hook real `SessionStart`** (`additionalContext`), no anteponiéndolo al
prompt; los bytes entregados se verifican en cada ejecución.

- **zero-base** — nada. Aquello que OKF dice sustituir.
- **answer key** (la hoja de respuestas) — la respuesta pegada en el prompt. Producir ese texto exige saber ya la respuesta, así que
  ningún usuario puede ocupar esta condición. Es un suelo, no un competidor.
- **OKF** — el texto real del gate.
- **wrong knowledge** — un gate del mismo tamaño con concepts reales sobre el *otro* repositorio. Separa
  «el conocimiento ayudó» de «un gate ayudó».
- **CLAUDE.md** — el mismo conocimiento acumulado pegado en un archivo plano. El titular real.

`total_cost_usd` es la cifra principal; el coste solo de sonnet se publica junto al coste total, para que el `claude-haiku`
que la CLI resuelve para trabajo interno (2.3% del gasto) pueda descontarse y no pueda ocultar una conclusión.
La eficiencia se compara solo sobre ejecuciones correctas. Cada respuesta se califica por **átomo** — el ground truth se
divide en hechos verificables de forma independiente, congelados antes de la medición — y la puntuación binaria al estilo v2
(todos los átomos correctos) se publica a su lado. Un nonce por ejecución anula el prompt caching. **Ningún número se
promedia entre escenarios.**

El diseño, las predicciones y los criterios de refutación R1–R5 se
[preregistraron](docs/benchmarks/pre-registration-2026-07-16-v3.md) y se commitearon **antes de la primera
llamada de pago**. Ese documento también registra, en detalle, las seis afirmaciones falsas o no respaldadas que hizo la
publicación anterior (v2) de este benchmark, y cómo se detectó cada una a partir de sus propios datos crudos.

### Donde OKF pierde: todo lo que el código puede responder

Cinco escenarios cuyas respuestas están en el código fuente, en el historial de git o en el bundle, cada una verificada desde
el checkout fijado. El coste es la mediana de las ejecuciones correctas, con su dispersión.

| Escenario | zero-base | OKF | veredicto |
|---|---:|---:|---|
| `rfcs_cheap` — un grep | **$0.062** · 13/15 | $0.077 · 14/15 | OKF 1.2× más caro |
| `slim_cheap` — un grep | **$0.067** · 14/15 | $0.114 · 15/15 | OKF 1.7× más caro |
| `rfcs_buried` — encontrar la justificación entre 651 documentos | **$0.097** · 12/15 | $0.112 · 13/15 | OKF 1.2× más caro |
| `slim_buried` — seguir una cadena de llamadas de cinco archivos | $0.277 · 13/15 · **10 tools** | **$0.232** · 9/15 · **8 tools** | OKF más barato, menos tools |
| `slim_stale` — conocimiento del bundle desactualizado por un commit posterior | crítico **15/15** | crítico **15/15** | empate — ver abajo |

**En greps baratos OKF es puro overhead** — 1.2–1.7× más caro por la misma respuesta, porque el gate es un
coste fijo que un `grep` no necesita. Solo compensa donde explorar es genuinamente caro:
`slim_buried` sigue una cadena de llamadas de cinco archivos, y ahí OKF es más barato con menos tool calls. Eso no
es un defecto, es aritmética — si un grep responde tu pregunta, no pagues por un gate.

`slim_stale` es donde la calificación por átomo se ganó el sueldo. El bundle llevaba una afirmación vuelta obsoleta por un
commit posterior, y la puntuación binaria marca **0/15 en todas las condiciones** — lo que parece una derrota
total. No lo es. Los átomos *críticos* (lo que la pregunta realmente pide — que el renderizador HTML
escapa, con qué función y con qué flags) están en **15/15**: el modelo leyó el código y respondió el hecho
central correctamente. Los únicos átomos que falló son procedencia que la pregunta nunca pidió (el commit SHA
que introdujo el escapado). El conocimiento obsoleto **no** lo volvió confiadamente incorrecto — la
predicción preregistrada de que lo haría fue errónea, y la puntuación binaria por sí sola lo habría ocultado.

### Donde explorar no puede ayudar: conocimiento que el código no contiene

Política de equipo decidida en conversación, nunca escrita en el repo. La pila de RFCs incluso contiene una trampa:
búscale una política de MSRV y los documentos proponen `N-2` — la regla real del equipo es distinta.

| Escenario | zero-base | OKF | wrong knowledge | CLAUDE.md |
|---|---:|---:|---:|---:|
| `rfcs_policy` — la "thaw rule" del equipo: período de espera, cadencia de MSRV, dos excepciones | **0/15** | **11/15** · $0.075 | — | 15/15 · $0.144 |

**zero-base sacó 0 de 15.** Gastó el dinero y no obtuvo nada, porque la respuesta no está en el
repositorio — verificado por un adversario que buscó en el working tree, el historial de git, los mensajes de commit,
los docs y la config, y encontró cero aciertos. La trampa tampoco lo atrapó; simplemente no pudo responder.

OKF respondió **11 de 15**, a aproximadamente la mitad del coste de CLAUDE.md llevando los mismos hechos. Esto es la
única cosa que explorar no puede hacer y una decisión almacenada sí. **CLAUDE.md también la responde** (15/15) — OKF
no es único aquí, es una forma más barata y de inyección acotada del mismo titular. El
control `wrong knowledge` para este escenario queda excluido: un bug de contaminación de la medición (abajo) le
permitió leer la respuesta, así que no puede servir como el control de «un gate por sí solo no ayuda» en esta ejecución.

Este es un único escenario de política limpio, no tres. Otros dos (`slim_policy`, `slim_domain`) se
midieron y luego se **excluyeron** — ver abajo.

### Lo que esta ejecución no puede decirte

- **Dos escenarios de política se excluyeron por contaminación.** Claude Code inyecta automáticamente memoria de
  proyecto por directorio (`~/.claude/projects/<cwd>/memory/`) en cada sesión. Mientras construía conocimiento,
  una sesión `claude -p` explorando el repo objetivo guardó las decisiones del equipo en esa memoria, y
  como la medición corrió en el mismo directorio de trabajo, la memoria alcanzó incluso a la condición **zero-base**
  — que no debería tener conocimiento alguno. En `slim_domain`, zero-base entonces «respondió» una
  decisión del equipo que no existe en ninguna parte del código, 15/15. Cualquier escenario cuyas ejecuciones zero-base lean
  memoria de proyecto se descarta de la publicación (`slim_domain`, `slim_policy`); el harness ahora limpia
  esa memoria antes de medir, y el informe detecta y excluye tales escenarios de forma mecánica. Los
  escenarios limpios de arriba tuvieron cero lecturas de memoria.
- **n=15 en las condiciones de contraste, n=5 en los controles.** Pequeño. Solo una separación completa entre
  distribuciones se describe como victoria.
- **Dos repositorios, dos ecosistemas (PHP + Markdown).** Ninguna afirmación de generalidad entre tamaños o
  lenguajes. Se diseñó un tercer repositorio y luego se rechazó por coste-por-credibilidad antes de gastar.
- **Sesiones de una sola pregunta.** El coste fijo del gate de OKF se paga una vez por pregunta en lugar de amortizarse
  a lo largo de una sesión real de múltiples preguntas, así que esta ejecución *subestima* a OKF.
- **El juez es una sola familia de LLM**, calificando por átomo contra ground truth verificado desde el código fuente.

Los criterios de refutación **R1–R5 se evaluaron todos de forma mecánica y ninguno se activó** (tras excluir las
celdas contaminadas) — esta ejecución no refuta la afirmación. Eso no es lo mismo que una confirmación
fuerte con n=15; es la ausencia de una refutación.

### Overhead local (no es el resultado de efectividad)

Medido el 2026-07-16, macOS arm64, Node `v26.4.0`, mediana con mín/máx.

| Operación local | Mediana | Rango |
|---|---:|---:|
| Proceso del gate SessionStart | 57.3 ms | 56.1–60.0 ms |
| Proceso de disparo del batch en SessionEnd | 40.1 ms | 39.3–40.8 ms |
| Proceso de statusline | 35.8 ms | 34.6–36.3 ms |

Reproduce con `node test/bench.mjs [repositorio]`. Solo coste de proceso local; no prueba nada sobre
tokens ni latencia del modelo.

### Coste, reproducción y enlaces

Las 440 ejecuciones medidas costaron **$66.26** más **$14.74** de calificación; la construcción del conocimiento y de los
bundles añadió ~$3.2. Total de esta ejecución ≈ **$84**. De pago, autenticada y excluida a propósito de los smoke tests y de CI.

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-knowledge.mjs --target slim --dir <repo>   # sesiones reales → transcripts
OKF_RUN_LIVE_BENCH=1 node test/bench-bundles.mjs --target slim --levels 20      # batch real → bundle
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                                    # medir
```

[Informe completo](docs/benchmarks/okf-benchmark-2026-07-16-v3.md) ·
[raw JSON](docs/benchmarks/raw/) ·
[bundles commiteados](docs/benchmarks/bundles/) ·
[preregistro](docs/benchmarks/pre-registration-2026-07-16-v3.md) ·
[guía de uso](docs/USAGE.md).

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

- El sweep de inactividad copia el transcript completo a `raw/`; no se parsea ni se trunca durante la recolección. Los hooks de sesión solo despiertan el batch.
- El analizador trabaja sobre una copia desechable del conocimiento en un workspace temporal y no tiene acceso físico a `raw/`, `.okf/` ni `.git`; el driver solo aplica archivos `.md` canónicos (scripts y symlinks nunca llegan al bundle).
- Batch crea un digest limitado y lo envía a Anthropic mediante otro `claude -p`; es la única transferencia de modelo/API adicional.
- Usa `--safe-mode`, tools restringidas, prompt por stdin, lint/rollback y sin Bash.
- Raw está ignorado por git; solo el Markdown extraído se confirma localmente. El plugin no hace push ni añade remote.
- Directorios POSIX `0700`, raw/state/log `0600`. Los logs persistentes excluyen transcript, stdout/stderr de Claude, credenciales y rutas raw completas.
- El fixture live es sintético, sin datos personales ni credenciales.

## Configuración y desinstalación

Usa `~/.claude/okf/.okf/config.md` o `/okf:okf-config`. Valores principales: `enabled: true` (interruptor maestro para recolección, gate y batch), `batch_interval_hours: 1`, `batch_max_digest_kb: 600`, `capture_exclude_cwd: []` (globs de exclusión de recolección, evaluados contra el cwd de cada sesión), `sweep_min_idle_minutes: 60` (inactividad tras la última actividad antes de recolectar la sesión; `0` recolecta de inmediato), `batch_digest_cap_kb: 150`, `remove_candidate_ttl_days: 30`, `inject_max_lines` / `inject_max_bytes`: `120` / `9000`. Valores inválidos vuelven a defaults seguros.

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
