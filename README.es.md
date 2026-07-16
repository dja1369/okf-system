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

<!-- okf-benchmark: 2026-07-16 -->

> **Retractación (2026-07-16).** Tres afirmaciones publicadas originalmente en esta sección han sido
> retiradas tras auditar los datos crudos de esta misma ejecución: la explicación de la trampa en
> `rfcs_policy` (fabricada — la trampa nunca se activó), el titular de la tendencia de acumulación
> (no respaldado por su muestra) y el título original de esta sección, «Donde OKF es lo único que
> funciona» (refutado por su propia tabla). Cada retractación está señalada donde estaba la
> afirmación. Qué se retiró, y cómo se detectó cada caso, está registrado en el
> [preregistro v3](docs/benchmarks/pre-registration-2026-07-16-v3.md). El resto de los hallazgos de
> esta sección no cambia.

**OKF no te ahorra explorar. Almacena lo que explorar nunca puede encontrar.**

Las dos mitades de esa frase están medidas abajo, sobre repositorios open-source reales, y la mitad que
resulta desfavorable se publica primero.

### Cómo se midió

Dos repositorios públicos fijados — sin fixture sintético, así que explorar cuesta lo que explorar
cuesta de verdad y la línea base sin memoria puede ganar genuinamente:

| Rol | Repositorio | Commit |
|---|---|---|
| Codebase | [slimphp/Slim](https://github.com/slimphp/Slim) | `80900fb3` (125 archivos PHP) |
| Pila de documentos | [rust-lang/rfcs](https://github.com/rust-lang/rfcs) | `f635361c` (651 archivos Markdown) |

Cada concept de cada bundle lo produjo el pipeline real — una sesión `claude -p` real explorando el
repo fijado, su transcript real de Claude Code, batch ingest real, gate real. **Ningún concept se
escribió a mano**, incluido el relleno que crea volumen.

Cinco condiciones. Todas reciben tools idénticas (`Read`, `Glob`, `Grep`, `Bash(git log/show/diff/blame/grep)`)
y una instrucción idéntica y neutral respecto a la condición — a ninguna condición se le dice que consulte el gate.

- **zero-base** — nada. Aquello que OKF dice sustituir.
- **answer key** (la hoja de respuestas) — la respuesta pegada en el prompt. Producir ese texto exige saber ya la respuesta, así que
  ningún usuario puede ocupar esta condición. Es un suelo, no un competidor.
- **OKF** — el texto real del gate.
- **wrong knowledge** — un gate del mismo tamaño con concepts reales sobre el *otro* repositorio. Separa
  «el conocimiento ayudó» de «un gate ayudó».
- **CLAUDE.md** — el mismo conocimiento acumulado pegado en un archivo plano. El titular real.

`total_cost_usd` es la cifra principal; la actividad de tokens se muestra a su lado, nunca en su lugar, porque
`cache_read` domina esa suma y factura ~50× más barato — las dos columnas discrepan en dirección.
La eficiencia se compara solo sobre ejecuciones correctas. Un nonce por ejecución anula el prompt caching. La calificación la hace un
juez ciego a la condición contra ground truth verificado desde el código fuente. **Ningún número se promedia entre
escenarios**: un grep y una cadena de llamadas de cinco archivos son fenómenos distintos, y mezclarlos dejaría que la
selección de escenarios eligiera el titular.

El diseño, las predicciones y los criterios de refutación se [preregistraron](docs/benchmarks/pre-registration-2026-07-16.md)
y se commitearon **antes de la primera llamada de pago**.

### Donde OKF pierde: todo lo que el código puede responder

Cinco escenarios cuyas respuestas están en el código fuente o en el historial de git, verificadas desde el checkout fijado
y cada una sobrevivió a un intento independiente de refutarla.

| Escenario | zero-base | OKF | veredicto |
|---|---:|---:|---|
| `rfcs_cheap` — un grep | **$0.0256** · 4/5 | $0.0505 · 3/5 | OKF 2.0× más caro |
| `slim_cheap` — un grep | **$0.0198** · 4/5 | $0.0386 · 5/5 | OKF 1.9× más caro |
| `slim_stale` — conocimiento del bundle desactualizado por un commit posterior | **$0.0345** · 5/5 | $0.0632 · 4/5 | OKF 1.8× más caro |
| `rfcs_buried` — encontrar la justificación entre 651 documentos | **$0.0326** · 4/5 | $0.0910 · 3/5 | OKF 2.8× más caro |
| `slim_buried` — seguir una cadena de llamadas de cinco archivos | $0.1669 · 2/5 · **10 tools** | **$0.0701** · 2/5 · **3 tools** | **OKF 2.4× más barato** |

**OKF pierde cuatro de cinco.** Solo gana donde explorar es genuinamente caro, y ahí recorta las
tool calls de 10 a 3. Si un grep responde tu pregunta, el gate es puro overhead — eso no es un
defecto, es aritmética.

`slim_stale` merece nombrarse: el bundle llevaba una afirmación obsoleta (el renderizador HTML de errores no
escapa — cierto antes del commit `f897118b`, falso en el commit fijado) y el modelo **comprobó el código
y lo corrigió igualmente**, 4/5. El conocimiento obsoleto no lo volvió confiadamente incorrecto. La
predicción preregistrada de que lo haría fue errónea.

### Donde explorar no puede ayudar: conocimiento que el código no contiene

Política de equipo y vocabulario de dominio — decididos en conversación, nunca escritos en el repo. Cada
escenario fue atacado por un adversario independiente que buscó en el working tree, ~300 revisiones del
historial de git, mensajes de commit, docs, config, stashes y objetos colgantes (cero aciertos), y que
**registró una conjetura basada en la convención antes de mirar**. Esas conjeturas sacaron 0/3, 0/3 y 1/5.

Cada repo contiene además una trampa: haz grep de "emitter" y encuentras `ResponseEmitter`; busca un tamaño
de chunk y encuentras `4096`; busca una política de MSRV en la pila de RFCs y los documentos proponen `N-2`.

| Escenario | zero-base | OKF | wrong knowledge | CLAUDE.md |
|---|---:|---:|---:|---:|
| `slim_policy` — qué entorno habilita los detalles de error, y la excepción | **0/5** ($0.0509 gastados) | **5/5** · $0.0840 | 0/5 | 5/5 · $0.1314 |
| `slim_domain` — qué entiende el equipo por "에미터" | **0/5** · **confiadamente equivocado 5/5** | **4/5** · $0.0624 | 0/5 | 5/5 · $0.1198 |
| `rfcs_policy` — el período de espera de la "thaw rule" del equipo | **0/5** | 2/5 · $0.0749 | 0/5 | 0/5 |

**zero-base sacó 0 de 15.** Gastó el dinero y no obtuvo nada, porque la respuesta no está ahí. En
`slim_domain` estuvo **confiadamente equivocado en 5 ejecuciones de 5**: exploró, encontró `ResponseEmitter`
y respondió con alta confianza — mientras que el "에미터" del equipo es `OutputBufferingMiddleware`, porque
corren FrankenPHP en modo worker, donde `ResponseEmitter` es código muerto. Explorar no solo falla aquí;
fabrica una respuesta incorrecta y confiada a partir de la trampa.

**wrong knowledge también sacó 0 de 15.** Un gate lleno de concepts reales pero irrelevantes no recupera nada.
La ganancia viene del conocimiento, no de tener un gate.

OKF respondió 11 de 15, a 1.6–1.9× menos que CLAUDE.md llevando los mismos hechos. En `slim_domain`
**no leyó ningún archivo de concept** (0/5) — bastó la línea del índice, con 2 tool calls frente a las
7 de zero-base.

**Aquí CLAUDE.md también funciona**, y la tabla lo dice: 5/5 en `slim_policy` y 5/5 en `slim_domain`,
superando en este último el 4/5 de OKF. Lo que esta tabla respalda es paridad con el titular a 1.6–1.9×
menos coste, con inyección acotada — no exclusividad. Esta sección se publicó primero como «Donde OKF
es lo único que funciona», algo que su propia tabla refuta; **ese título queda retirado.**

`rfcs_policy` es el fracaso honesto: OKF solo logró 2/5. **La explicación publicada aquí — que la
propuesta `N-2` de la pila de documentos es una trampa lo bastante fuerte como para apartar al modelo
de una línea del índice correcta — era falsa y queda retirada.** Las 5 ejecuciones de OKF leyeron solo
archivos del bundle; ninguna abrió un documento RFC; ninguna respondió `N-2`. Las cinco respondieron
«4 releases». La trampa nunca se activó. La causa del 2/5 no se investigó antes de publicar, y aquí no
se ofrece ninguna explicación sustituta; hay una nueva medición en marcha. CLAUDE.md sacó 0/5 en este
escenario, así que OKF sigue ganando al titular aquí.

### Acumulación: la afirmación de tendencia queda retirada

Esta sección publicó primero una curva de coste sobre el tamaño del bundle (1 → 35 concepts) y el
titular **«De 1 a 35 concepts OKF se abarató ($0.1291 → $0.0908) mientras CLAUDE.md se encareció 2.2×
($0.1279 → $0.2828). Las curvas divergen.»** **Esa afirmación de tendencia queda retirada por no estar
respaldada por su muestra.**

Los números no eran inventados — son medianas solo de ejecuciones correctas, que es la regla
preregistrada. Pero son medianas de **3, 2, 5, 3, 2 y 4** ejecuciones, y el punto mínimo de $0.0701 es
*la mediana de dos ejecuciones*. Tomando todas las ejecuciones, las distribuciones de los niveles se
solapan por completo (el nivel de 1 concept abarca $0.0774–$0.2214; el de 35 concepts, $0.0836–$0.1606)
y las medianas sobre todas las ejecuciones no son monótonas en absoluto: $0.1237, $0.1884, $0.1425,
$0.0852, $0.1142, $0.1135. Esta misma sección ya decía, dos párrafos más abajo, «Con n=5 aquí no se
separa nada» — esa frase era correcta y el titular que tenía encima no lo era. La curva no se vuelve a
publicar aquí, porque una mediana de dos ejecuciones no es un punto de una curva.

La meseta del gate también se explicó mal. Se atribuyó a que el batch colapsaba 14 concepts en una sola
línea de índice, presentado como una propiedad emergente de cómo OKF organiza el conocimiento. **Es el
tope `inject_max_lines: 120` de `lib/config.mjs`** — una constante de configuración. `bench-bundles.mjs`
registra `gateTruncated`, que es cierto exactamente en el nivel donde empieza la meseta: las entradas
del índice se **descartaron por presupuesto**, no se anidaron con elegancia.

Una mitad de la afirmación antigua sobrevive, y solo enunciada por separado: CLAUDE.md lleva el cuerpo
de cada concept en cada prompt, así que su prompt crece linealmente con el número de concepts. Eso se
sigue mecánicamente del formato. Aquí no se extrae de ello ninguna comparación con el lado de OKF.

La exactitud no mejoró con el volumen y siguió siendo ruidosa (2/5–5/5). **El eje de niveles queda
retirado en v3**: mide una constante de configuración, así que volver a ejecutarlo solo compraría una
lectura más precisa de un número que puede leerse en un archivo de configuración.

### Overhead local (no es el resultado de efectividad)

Medido el 2026-07-16, macOS arm64, Node `v26.4.0`, mediana con mín/máx.

| Operación local | Mediana | Rango |
|---|---:|---:|
| Proceso del gate SessionStart | 57.3 ms | 56.1–60.0 ms |
| Proceso de disparo del batch en SessionEnd | 40.1 ms | 39.3–40.8 ms |
| Proceso de statusline | 35.8 ms | 34.6–36.3 ms |

Reproduce con `node test/bench.mjs [repositorio]`. Solo coste de proceso local; no prueba nada sobre
tokens ni latencia del modelo.

### Coste, y lo que esta ejecución no puede decirte

Construir el conocimiento costó **$3.59** en sesiones reales y **$4.92** en batch ingest. Las 250
ejecuciones medidas costaron **$28.16** más **$9.44** de calificación.

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-knowledge.mjs --target slim --dir <repo>   # sesiones reales → transcripts
OKF_RUN_LIVE_BENCH=1 node test/bench-bundles.mjs --target slim --levels 1,5,20  # batch real → bundles por nivel
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                                    # medir
```

De pago, autenticada y excluida a propósito de los smoke tests y de CI.
[Informe completo](docs/benchmarks/okf-benchmark-2026-07-16.md) ·
[raw JSON](docs/benchmarks/raw/) ·
[preregistro](docs/benchmarks/pre-registration-2026-07-16.md) ·
[guía de uso](docs/USAGE.md).

Límites, dichos sin rodeos:

- **n=5 por celda.** Pequeño. Aquí solo se describe como victoria una separación completa entre distribuciones.
- **La mezcla de modelos no está fijada.** Se pidió `claude-sonnet-5`; la CLI resolvió
  `claude-haiku-4-5` junto a él para trabajo interno. Las comparaciones de coste entre condiciones arrastran ese
  artefacto.
- **Dos repositorios, un lenguaje cada uno.** Ninguna afirmación de generalidad entre tamaños o ecosistemas.
- **El wall-clock no se publica.** La medición corrió con concurrencia 5; el coste, los tokens y las tool calls
  no se ven afectados por eso, la latencia de respuesta sí. Cualquier afirmación sobre velocidad requeriría una
  re-ejecución secuencial.
- El texto del gate se antepone al prompt en vez de entregarse por la vía de producción
  `additionalContext` de `SessionStart`. Mismo texto, entrega distinta.
- Los escenarios de política descansan en que un humano redactó la política. Eso es lo que es una política. La defensa es que
  la respuesta está demostrablemente ausente del repo y que un adversario no pudo adivinarla.

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
