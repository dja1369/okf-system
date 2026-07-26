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
| `/okf:okf-deprecate <objetivo>` | Retirar un concept — el archivo y sus enlaces se mantienen, el gate deja de inyectarlo |

`visualize` no analiza código. `analysis` rechaza rutas inexistentes o que no sean directorios e informa truncamiento, concepts no relacionados ocultos y estadísticas por lenguaje. Ambos producen HTML autocontenido sin CDN ni red en ejecución.

## Statusline opcional

`bin/statusline.mjs` produce una línea como `OKF 12 · +3 · 2h ago` sin red ni análisis completo. Claude Code solo admite un `statusLine`; OKF no lo instala ni reemplaza. Añade la salida de `node /path/to/okf/bin/statusline.mjs` a tu script existente.

## Benchmark de OKF

<!-- okf-benchmark: 2026-07-26-e3 -->

### Gate recall@cap — tres rondas prerregistradas, E1 → E3 (2026-07-26)

Las tres rondas costaron **$0,00**, y eso queda demostrado por la ejecución en lugar de declararse: el
banco de pruebas coloca un stub `claude` al principio de `PATH`, comprueba que ese stub existe, y el
stub no se ejecuta nunca (`paidCallTrapInstalled: true`, `paidCallTrapTripped: false`).

Miden `recall(N)`: con N concepts en el bundle, la fracción de las 20 preguntas congeladas cuyo concept
de respuesta sobrevive hasta el índice que la puerta inyecta realmente.

> **recall no es una tasa de acierto.** Solo responde a «¿cargó la puerta la línea relevante?». Si el
> modelo **usó** esa línea no puede verificarse sin llamadas de pago. Los distractores sintéticos solo
> dan una **cota superior**, así que el recall real es más bajo.

**Condiciones** — 3 perturbaciones × 5 niveles × 20 semillas = 300 muestras, 28 s. Se anteponen cuatro
caracteres al **`title`** del frontmatter del concept de respuesta; no cambian ni el cuerpo, ni el
nombre de archivo, ni la ruta.

| N | `none` | `front` (`!!! `) **publicado** | `front` **seguro con comillas** | `back` (`힣힣 `) |
|---|---|---|---|---|
| 24 | 0,400 ± 0,000 | 1,000 ± 0,000 | **0,400** | 0,400 ± 0,000 |
| 50 | 0,277 ± 0,038 | 0,560 ± 0,064 | **0,400** | 0,182 ± 0,044 |
| 100 | 0,247 ± 0,034 | 0,523 ± 0,030 | **0,400** | 0,170 ± 0,025 |
| 200 | 0,250 ± 0,040 | 0,528 ± 0,030 | **0,400** | 0,175 ± 0,026 |
| 400 | 0,262 ± 0,039 | 0,533 ± 0,024 | **0,400** | 0,185 ± 0,024 |

n=20 por celda. E1 ejecutó solo `none` con un presupuesto 11 B menor y produjo
0,400 / 0,277 / 0,245 / 0,248: es una **condición distinta**, ni mejor ni peor que la tabla anterior.

**La columna `front` publicada está contaminada, y quien lo detectó fue su propia guarda.** `!!!` es un
**indicador de etiqueta** de YAML. Antepuesto a un `title:` *sin comillas*, rompe el frontmatter por
completo: se pierde el tipo, el texto del enlace cae al nombre de archivo y **la descripción
desaparece**, con lo que la línea colapsa de ~700 B a ~30 B. **14 de las 20 preguntas congeladas tienen
títulos sin comillas.** Es decir, en esas 14 el experimento no midió la posición de ordenación sino el
**fallo de análisis**: una línea corta permite que entren muchas más líneas en el mismo presupuesto, que
es exactamente el `taken` = 24 y los 263 B de longitud media observados en N=24. Al repetirlo con un
prefijo seguro con comillas, `front` colapsa a un **0,400 plano**. `none` y `back` no se mueven ni un
dígito, lo que confirma que la corrección es neutra y a la vez muestra que `힣힣 ` nunca rompió nada.

**Qué sobrevive y qué no.** Que la ordenación decide la supervivencia sigue en pie: en N=400 el spread
seguro con comillas es 0,400 − 0,185 = **0,215**, todavía **4,3×** el umbral de refutación de 0,05, y
que `back` empuje el recall de 0,262 a 0,185 es un efecto de orden puro. **En un sistema con cero
señales de relevancia eso es lo esperable, no el descubrimiento de un fallo**: lo nuevo es la magnitud.
Pero tres magnitudes publicadas no sobreviven: «cuatro caracteres duplican el recall» pasa de 2,03× a
**1,53×**; «N=24 va de 0,400 a 1,000» se convierte en **ningún cambio**; y el salto de `cwdIndependent`
de E1, 0,000 → 0,967, queda en **0,000 → 0,333**. En su lugar aparece un hecho nuevo: **cuando los
concepts se ordenan al principio, el recall deja de depender de N por completo** (0,400 plano en un
rango de 17× en el tamaño del bundle), porque entonces lo que limita la supervivencia es `taken` y no N.

**La condición de supervivencia es exactamente `rank < taken`**: un concept sobrevive si y solo si su
rango de ordenación por título dentro de su categoría es menor que el número de líneas que esa
categoría obtuvo. Por tanto el recall es una función **completa** de los vectores rank y `taken` y se
descompone sin aproximación. En N=24→50 domina la componente rank (−0,15 a −0,41); en N≥100 muere a ~0,
un efecto suelo: el rango medio de las respuestas (26,9) queda muy por encima de `taken` (10,5), y más
relleno no cambia los concepts que ya están fuera. Salvedad publicada junto al dato: la descomposición
es **contabilidad, no causalidad**, y sus componentes dependen de la línea base.

**Dos correcciones de E3 a E2 y una a sí misma.** E2 informó de que el recall «sube monótonamente» de
N=100 a 400 y dejó la explicación a E3. Con el n=20 prerregistrado ese ascenso **no puede establecerse
en absoluto**: 0 de 12 pares adyacentes son `rising`. El primer titular publicado de E3 concluyó por eso
que el ascenso «no existe»; **eso era falso**, y lo detectó una comprobación adversaria de potencia
estadística: con n=60 hay tres pares `rising` (p hasta 0,00027), y en los tres la componente `taken`
carga con el 100 % del movimiento mientras la componente rank es exactamente 0. El ascenso es real pero
**no sustantivo** (IC de la mediana = [0,000, 0,000]). E3 también sustituyó la regla `|Δ| ≤ 0,05` de E2
—que confunde «plano» con «pequeño pero consistente»— por una prueba de signos exacta pareada más un
intervalo de confianza para la mediana libre de distribución, informando dirección y magnitud como dos
valores separados.

**El antiguo R3 se disparaba con ruido.** Su enunciado era «decrecimiento monótono violado → *defecto
del banco de pruebas* → descartar todo», pero su implementación comparaba medias sin tratamiento de
incertidumbre, de modo que ±0,005 de ruido de semilla lo disparaba tanto en E1 como en E2: ambas rondas
se publicaron en el estado autocontradictorio de «se disparó, pero no se descartó nada». E3 no relajó
el umbral; volvió a apuntar el criterio a lo que dice su enunciado y midió la integridad directamente.
Sobre las mismas 300 muestras, el antiguo R3 se dispara y el nuevo R3a no.

**En el bundle real el sesgo de ordenación aún no puede establecerse.** Medido en solo lectura y
emitiendo únicamente recuentos: ni títulos, ni descripciones, ni nombres de archivo, ni enlaces salen de
la medición, y `raw/` no se abre nunca. La ordenación compara `title.toLowerCase()` con `<`, es decir
**orden de unidades de código UTF-16, no colación por configuración regional**, de modo que un título que
empieza en ASCII precede siempre a uno que empieza en hangul. Los concepts con inicio ASCII son el
65,4 % del bundle y ocupan el 70,6 % de las plazas de la puerta, pero con 26 concepts la prueba exacta
hipergeométrica contra una hipótesis nula estratificada da **p = 0,667**. Eso no es un resultado. Y un
lift pequeño tampoco debe leerse como «ordenar es inofensivo»: la puerta carga actualmente el **65,4 %**
de todos los candidatos, y donde todo se carga la ordenación no decide nada (2 de 6 categorías tienen
cero grados de libertad). Por categoría la tasa de carga ya se separa: `decisions`/`projects` 1,000,
`patterns` 0,500, `references` **0,429**. Un borrador anterior afirmaba que una tasa de carga
decreciente amplificaría el efecto; **los propios datos del benchmark lo refutan**, así que esa
afirmación fue retirada.

**Quién ocupa una plaza lo deciden el orden y la longitud de línea, no la relevancia.** Cinco factores
están confirmados en el código: la ordenación sensible a mayúsculas de los nombres de sección de tipo,
que hace que `# Subdirectories` preceda siempre a `# reference` (`lib/index-gen.mjs:242`) y arrastra los
concepts anidados al principio de su categoría; dentro de una sección, el orden alfabético del
**`title`** del frontmatter, no del nombre de archivo, que solo es un respaldo cuando el análisis falla
(`:315`); `status: deprecated` relegado al final (`:245`); el orden de recorrido de categorías por
nombre de directorio (`:227`); y la **longitud de línea en bytes**, ya que una línea siguiente que
exceda el presupuesto restante detiene esa categoría (`lib/gate.mjs:122`). La puerta no contiene
ninguna referencia a cwd, a la actualidad ni a la consulta.

**El hallazgo es la forma, no el nivel.** De las 20 preguntas, 9 sobreviven con 0 en todos los niveles y
3 con 1,0; las 8 restantes quedan en medio: el recall no es binario. La puerta rellena por turnos hasta
agotar el presupuesto; una categoría termina con 1–3 líneas solo porque una sola línea es grande
(200–1.030 B frente a un presupuesto de índice de ~6.960 B), de modo que toda la carga se agota en 8–11
líneas. `references` obtiene exactamente una línea en todos los niveles, así que de las 8 respuestas
concentradas allí como mucho puede sobrevivir una.

**Profundidad de anidamiento (eje A-2).** 25 concepts fijos, contenidos idénticos, solo rutas más
profundas:

| Condición | líneas de concept inyectadas | enlaces de subdominio |
|---|---:|---:|
| plano | 28 | 0 |
| 2 niveles | 27 | 0 |
| 3 niveles | 26 | 0 |
| 4 niveles | 25 | 0 |

Cada condición se midió **una vez** (n=1, sin repetición de semillas), y en esa única medición se perdió
una línea por nivel de profundidad. Cuatro puntos no permiten distinguir si el descenso es lineal, y no
se midieron profundidades mayores de 4. Contado contra los concepts plantados, 3 niveles es 25 → 23,
**−8,0 %**. La causa es la presión de bytes, no un recorrido de cadena fallido: cada segmento de ruta
adicional alarga todas las líneas hasta que una queda fuera del presupuesto.

**R2 se dispara en todas las rondas** (`recall(24)` = 0,400 < 0,60). Según la regla de manejo
prerregistrada, **los valores absolutos de recall no deciden nada**: las tablas se publican y no
impulsan ninguna política.

**Disciplina de medición y dónde mejoró.** En E1 los fixtures entraron en git por primera vez en el
commit del **informe**: los umbrales estaban fijados de antemano, pero el material que realmente
determinó los números no. A partir de E2 los fixtures viajan dentro del commit de prerregistro y el
smoke impone una desigualdad **estricta** vía `git log --diff-filter=A`; apuntada al conjunto de
archivos de E1 produce 3 violaciones, así que atrapa el accidente real en lugar de aprobarlo. Cada ronda
publica los valores ya conocidos cuando se escribió su prerregistro, y cualquier aritmética cambiada
después de medir: E3 cuantizó los deltas de recall a la rejilla de 1/20 porque
`0,25 − 0,20 = 0,04999…` mientras que `0,20 − 0,15 = 0,05000…2` colocaba el mismo movimiento de una
pregunta en lados opuestos del límite de equivalencia; esa corrección eliminó el único veredicto
`indeterminate` de la ronda, es decir, jugó **en contra** del propio argumento del informe, y se declara
como tal. Después, la revisión adversaria mostró que la guarda de la identidad de supervivencia era casi
tautológica (reutilizaba la misma función que estaba comprobando), y el reemplazo no circular **se
disparó en su primera ejecución**: así se encontró la contaminación de `front` descrita arriba. Un
defecto abierto se asume en lugar de rellenarse con conjeturas: la misma guarda también se dispara en 8
de 100 muestras sin perturbar, y la causa aún no se ha identificado.

```sh
node test/gate-recall.mjs --e3 --perturb all   # 3 condiciones × 5 niveles × 20 semillas, ~28 s
node test/gate-recall.mjs --e3 --perturb all --quote-safe-perturb   # el prefijo corregido
node test/gate-title-distribution.mjs          # distribución de títulos del bundle real (solo lectura)
node test/gate-recall.mjs --e2 --perturb all   # E2
node test/gate-recall.mjs                      # E1
node test/bench-nesting.mjs                    # eje de profundidad de anidamiento
node test/smoke.mjs                            # guardas de regresión
```

[Informe E3](docs/benchmarks/gate-recall-2026-07-26-e3.md) ·
[Prerregistro E3](docs/benchmarks/pre-registration-2026-07-26-e3.md) ·
[Informe E2](docs/benchmarks/gate-recall-2026-07-26-e2.md) ·
[Prerregistro E2](docs/benchmarks/pre-registration-2026-07-26-e2.md) ·
[Informe E1](docs/benchmarks/gate-recall-2026-07-26-e1.md) ·
[Prerregistro E1](docs/benchmarks/pre-registration-2026-07-26-e1.md)

### Ejecución de pago de extremo a extremo (v3, 2026-07-16)

<!-- okf-benchmark: 2026-07-16-v3 -->

**OKF supone una sobrecarga para casi todo lo que el código puede responder, y donde el código no tiene
respuesta alguna, un simple CLAUDE.md también lo supera — la única ventaja de OKF es hacerlo más barato.
Una prueba directa de su promesa central (el conocimiento acumulado rinde con el tiempo) se ejecutó y
quedó refutada.**

Cada afirmación de ese párrafo está medida abajo, sobre repositorios open-source reales, con n=15 por
celda de comparación. Las partes desfavorables para OKF se publican primero.

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

### Un seguimiento en cadena: ¿ayuda la acumulación real? (v4, refutada)

<!-- okf-benchmark-chain: 2026-07-16-v4 -->

Una ejecución aparte y preregistrada puso a prueba directamente el mecanismo de OKF: una cadena de 4 preguntas
relacionadas pero distintas sobre el `pkg/scheduler` de `kubernetes/kubernetes` (v1.30.0, 178 archivos Go), donde la
conclusión de cada sesión pasa por un **batch real** antes de que empiece la siguiente sesión, comparada contra las
mismas 4 preguntas hechas sin acumulación alguna, nunca. Esta es exactamente la forma que el preregistro de v3 señaló
como «favorece a OKF y es ajustable para halagarlo» y se negó a ejecutar. v4 la ejecutó de todos modos, esta vez con
salvaguardas: las 4 preguntas se congelaron y se verificaron contra el código fuente antes de gastar, la salvaguarda
contra contaminación limpia la memoria de proyecto de Claude Code antes de **cada** sesión (no una sola vez), y los
criterios de refutación se fijaron antes de la medición — ver el
[preregistro](docs/benchmarks/pre-registration-2026-07-16-v4.md).

Hubo acumulación real: los bytes del gate crecieron de forma monótona a lo largo de los pasos (1835 → 2613 → 3675 →
4950, n=15 cadenas), respaldados por un gasto de batch real y medido ($25.81 en total). **La predicción central — que
el coste cae a lo largo de la cadena — fue refutada.** El coste de OKF fue $0.231 → $0.216 → $0.258 → **$0.447** a lo
largo de las cuatro preguntas; el control sin memoria se movió igual ($0.255 → $0.256 → $0.272 → $0.411). La explicación
más probable es que la cuarta pregunta fue simplemente más difícil para ambos brazos — pregunta por dos mecanismos a la
vez — no que la acumulación ayudara o perjudicara. La precisión por átomo de OKF no superó la de la línea base en ningún
paso, y fue inferior a ella tanto en la primera como en la última pregunta. La puntuación binaria (todos los átomos
correctos) fue 0/106 en ambos brazos — este conjunto de preguntas es lo bastante difícil como para que solo la
puntuación por átomo sea utilizable siquiera. [Informe completo](docs/benchmarks/okf-benchmark-chain-2026-07-16-v4.md).

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

La ejecución en cadena de v4 (120 sesiones, batches reales entre pasos) costó **$31.95** de medición + **$9.20** de
calificación + **$25.81** de ingest real ≈ **$67**:

```sh
OKF_RUN_LIVE_BENCH=1 OKF_BENCH_CHAINS=15 node test/bench-chain.mjs   # sesiones encadenadas, batch real, medir
```

[Informe completo](docs/benchmarks/okf-benchmark-2026-07-16-v3.md) ·
[informe del seguimiento en cadena](docs/benchmarks/okf-benchmark-chain-2026-07-16-v4.md) ·
[raw JSON](docs/benchmarks/raw/) ·
[bundles commiteados](docs/benchmarks/bundles/) ·
[preregistro](docs/benchmarks/pre-registration-2026-07-16-v3.md) ·
[preregistro de la cadena](docs/benchmarks/pre-registration-2026-07-16-v4.md) ·
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

Usa `~/.claude/okf/.okf/config.md` o `/okf:okf-config`. Valores principales: `enabled: true` (interruptor maestro para recolección, gate y batch), `batch_interval_hours: 1`, `batch_max_digest_kb: 600`, `capture_exclude_cwd: []` (globs de exclusión de recolección, evaluados contra el cwd de cada sesión), `sweep_min_idle_minutes: 60` (inactividad tras la última actividad antes de recolectar la sesión; `0` recolecta de inmediato), `batch_digest_cap_kb: 150`, `remove_candidate_ttl_days: 30`, `inject_max_lines` / `inject_max_bytes`: `120` / `9000`, `sweep_backfill_days: 0` (días **anteriores** al marcador de instalación que el sweep puede recuperar; `0` por defecto = solo conversaciones posteriores a la instalación; la ventana dura de 7 días sigue siendo el tope), `batch_max_usd_per_day: 0` (límite de gasto diario del LLM en USD; `0` = sin límite, el valor por defecto — el coste se registra y se muestra igualmente; es una guarda best-effort cuyo acumulado vive en `.okf/last-batch.json`). Valores inválidos vuelven a defaults seguros.

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
