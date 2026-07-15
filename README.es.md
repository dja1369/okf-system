# OKF para Claude Code

**Tu agente olvida todo lo que le dijiste ayer. Esto lo soluciona, y la memoria que
construye es una carpeta de markdown que te pertenece, no una base de datos que te encierra.**

![Licencia MIT](https://img.shields.io/badge/license-MIT-blue) ![OKF v0.1](https://img.shields.io/badge/OKF-v0.1%20Draft-4ecdc4) ![Solo Node](https://img.shields.io/badge/runtime-Node%20only-5c6bc0) ![sin npm install](https://img.shields.io/badge/dependencies-vendored-66bb6a)

**[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · Español · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português](README.pt-BR.md)**

![Grafo de conocimiento de OKF: conceptos enlazados con el código que describen](docs/okf-graph.png)

<sub>`/okf:okf-visualize` — tu conocimiento (los nodos con contorno) y tu base de código en un
solo grafo. Las aristas amarillas discontinuas son lo importante: cada concepto enlazado
con los archivos fuente de los que realmente trata.</sub>

Cada sesión empieza de cero. Vuelves a explicar la misma decisión de arquitectura, la
misma política de despliegue, el mismo «ya lo probamos y se rompió»; y en cuanto
termina la sesión, todo desaparece otra vez. Mientras tanto, el conocimiento que
*habría* respondido a la pregunta está disperso entre wikis, comentarios de código y,
como dice el anuncio de OKF de Google, «las cabezas de unos pocos ingenieros senior».

Este plugin cierra ese ciclo automáticamente: captura lo que realmente discutiste,
destila las partes reutilizables en un paquete de conocimiento estructurado y vuelve a
poner ese conocimiento delante del modelo al inicio de cada sesión.

## El formato

El conocimiento se almacena en **[OKF (Open Knowledge Format)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)**,
una especificación abierta que Google Cloud [publicó en junio de 2026](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/?hl=en&utm_source=pytorchkr&ref=pytorchkr)
(v0.1 Draft, Apache-2.0). Es deliberadamente anodina, y ahí está la gracia:

> "The format is intentionally minimal: a directory of markdown files with YAML
> frontmatter. There is no schema registry, no central authority, and no required
> tooling. **If you can `cat` a file, you can read OKF; if you can `git clone` a
> repo, you can ship it.**"

OKF formaliza el patrón de «wiki para LLM» que [Andrej Karpathy esbozó](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
diez semanas antes; el anuncio de Google lo dice explícitamente. Desde su publicación se
ha formado a su alrededor un [pequeño ecosistema](https://github.com/search?q=%22open+knowledge+format%22&type=repositories)
de generadores, linters, visores y servidores MCP, y el formato también aparece fuera de
Google (AWS tiene un [ejemplo](https://github.com/aws-samples/sample-okf-llm-wiki)
que sirve bases de datos de Glue como paquetes OKF). Es pronto —la mayor parte de ese
ecosistema tiene semanas de vida—, pero el formato hace lo que promete: ser legible sin
las herramientas de su autor.

**Por qué un formato y no un producto de memoria.** Herramientas como mem0, Letta, Zep y
Cognee son *runtimes* de memoria: enlazas una librería o alojas un servicio, y tu memoria
vive en su almacén vectorial o de grafos. Son otra capa, no un competidor; algunas de
ellas podrían almacenar OKF. La diferencia práctica es el **coste de salida**: el
conocimiento incrustado en una base de datos de grafos solo es legible para ese sistema,
mientras que un paquete OKF se abre en tu editor, se renderiza en GitHub, se compara en un
pull request y lo lee cualquier otro agente sin ningún paso de traducción. Este plugin
nunca te pide que le confíes la única copia.

## Qué hace

1. **Captura** la conversación completa de cada sesión, sin pérdidas, cuando esta termina.
2. **Comprime** las sesiones capturadas en segundo plano (un trabajo por lotes
   oportunista, no una tarea cron ni programada) usando `claude -p` para extraer
   conocimiento reutilizable: decision, project, preference, pattern, reference,
   troubleshooting.
3. **Inyecta** un índice de ese paquete en el contexto de cada nueva sesión como una
   compuerta obligatoria, de modo que Claude lea de verdad el conocimiento previo
   relevante antes de trabajar en algo relacionado, en lugar de empezar de cero cada vez.
4. **Visualiza** el paquete y tu base de código como un único grafo, enlazando cada
   concepto con los archivos de los que realmente trata (`/okf:okf-visualize`).

Todo vive en un repositorio git local bajo `~/.claude/okf` (o
`$CLAUDE_CONFIG_DIR/okf`). No se sube nada a ninguna parte. Las únicas llamadas de red son
las que ya haces a la API de Anthropic: el paso por lotes no es más que otra llamada a
`claude -p`, ejecutada localmente.

## Requisitos

- Claude Code con soporte de plugins
- Node.js (el que ya requiere `claude` de por sí — sin runtime adicional)
- git

Sin paso de `npm install`. Sin servicios externos. Sin configuración necesaria para
empezar.

## Instalación

```
claude plugin marketplace add dja1369/okf-system
claude plugin install okf@okf-marketplace
```

(Para instalar desde un clon local: `claude plugin marketplace add /path/to/your/clone`.)

Eso es todo: reinicia tu sesión y los hooks de compuerta/captura quedan activos. Al
iniciar la siguiente sesión, el paquete se inicializa automáticamente (se crea un
repositorio git local bajo `~/.claude/okf` con la estructura base).

Para desinstalar: `claude plugin uninstall okf`. Tus datos en `~/.claude/okf` quedan
intactos: es un repositorio git normal que puedes inspeccionar, respaldar o borrar a mano
con `rm -rf ~/.claude/okf`.

## Uso

El uso normal no requiere nada de tu parte. La captura y la compresión por lotes ocurren
automáticamente. Hay cinco comandos disponibles para inspección/control manual —
**fíjate en el prefijo `okf:`**, obligatorio porque son comandos con ámbito de plugin:

| Comando | Qué hace |
|---|---|
| `/okf:okf-status` | Informa de la última ejecución por lotes, las sesiones pendientes y el estado del lock |
| `/okf:okf-batch` | Fuerza una ejecución por lotes inmediata (ignora la compuerta de intervalo, pero sigue respetando el lock) |
| `/okf:okf-config` | Muestra la configuración actual y te permite editarla |
| `/okf:okf-index` | Imprime un resumen legible del paquete: cada categoría y título de concepto, más los cambios recientes de `log.md` |
| `/okf:okf-visualize` | Renderiza el paquete + tu base de código como un único grafo interactivo (HTML autocontenido) |

Una instalación nueva no está vacía: el paquete viene sembrado con conceptos que
describen el propio OKF, la arquitectura de este plugin y las reglas de escritura del
paquete, de modo que la compuerta tenga algo real a lo que apuntar desde la primera
sesión, y el paquete se documenta a sí mismo.

## Visualización

`/okf:okf-visualize` renderiza tu conocimiento y tu código como un solo grafo. Lo interesante
no es ninguna de las dos mitades, sino los enlaces discontinuos entre ellas, que conectan
cada concepto con los archivos fuente de los que realmente habla.

Si [Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) ya ha
analizado el repositorio (`.understand-anything/` o `.ua/knowledge-graph.json`), se usa
ese grafo más rico resumido por un LLM. Si no, el analizador propio de este plugin
construye uno: Node puro, sin módulos nativos, extrayendo archivos, funciones, clases y
el grafo de imports en JS/TS, Python, Go, Rust, Java/Kotlin, Ruby, PHP, C/C++, C# y Swift.

La salida es un archivo HTML autocontenido: sin CDN, sin peticiones de red, sin backend.
Se abre sin conexión, porque abrir tu propia base de conocimiento no debería llamar a
ninguna parte.

## Cómo funciona

![Arquitectura: las sesiones se capturan en raw, un proceso por lotes en segundo plano las destila en un paquete OKF y el índice del paquete se inyecta de vuelta en la siguiente sesión](docs/architecture.svg)

- **La captura** es una copia de archivo pura: sin parseo, sin filtrado, sin límite de
  tamaño. La transcripción completa va a `raw/` en cada `SessionEnd`. Es intencionado:
  una base de conocimiento construida sobre un recuerdo parcial de lo que pasó es peor
  que ninguna.
- **La compresión** solo ocurre en el momento del lote, sobre una copia temporal: el
  original capturado nunca se toca. Se ejecuta con el acceso a herramientas restringido a
  `Read/Glob/Grep/Write/Edit` (sin `Bash`) y con todos *tus* demás hooks, plugins y
  servidores MCP desactivados para esa única llamada (`--safe-mode`), de modo que no
  pueda realimentarse capturándose a sí misma.
- **La compuerta** inyecta un índice de categorías compacto (no el texto completo de los
  conceptos) más los cambios recientes, e indica a Claude que haga `Read` de verdad del
  archivo relevante antes de tocar trabajo relacionado: el índice por sí solo no basta
  para actuar sobre suposiciones desactualizadas.
- Un linter estructural mantiene el paquete siempre conforme a la especificación: si una
  ejecución por lotes dejara algo malformado, se revierte automáticamente antes del commit.

Consulta el [anuncio del Open Knowledge Format](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/?hl=en&utm_source=pytorchkr&ref=pytorchkr) de Google Cloud para conocer el contexto y las razones de diseño del formato: son solo
archivos markdown con frontmatter YAML, legibles por cualquier herramienta y no
específicos de este plugin.

## Configuración

Edita `~/.claude/okf/.okf/config.md` directamente (el frontmatter), o usa
`/okf:okf-config`.

| Clave | Valor por defecto | Significado |
|---|---|---|
| `enabled` | `true` | Interruptor general de encendido/apagado (captura, compuerta y lotes lo siguen) |
| `batch_interval_hours` | `1` | Tiempo mínimo entre ejecuciones por lotes |
| `batch_max_digest_kb` | `600` | Presupuesto por ejecución sobre el total de bytes de digest: el verdadero tope de coste. Las sesiones que se pasen del presupuesto pasan a la siguiente ejecución |
| `batch_max_sessions` | `50` | Solo un techo de seguridad; `batch_max_digest_kb` es el dial real |
| `seed_language` | `en` | Idioma de los conceptos sembrados en el primer arranque (`en`, `ko`; los valores desconocidos recurren a `en`) |
| `batch_model` | `claude-sonnet-5` | Modelo usado para la ingesta por lotes; vacío = valor por defecto de la CLI |
| `batch_effort` | `medium` | Esfuerzo de razonamiento para la ingesta por lotes (`low`/`medium`/`high`/`xhigh`/`max`); vacío = valor por defecto de la CLI |
| `capture_exclude_cwd` | `[]` | Patrones glob de directorios cuya captura se omite (solo opt-out — la captura en sí nunca es parcial) |
| `batch_digest_cap_kb` | `150` | Límite de tamaño por sesión para el resumen que ve el LLM (el original capturado nunca se recorta) |
| `remove_candidate_ttl_days` | `30` | Cuánto tiempo se conservan las transcripciones raw ya procesadas antes de borrarlas |
| `inject_max_lines` / `inject_max_bytes` | `120` / `16384` | Límites de tamaño de la inyección de la compuerta |
| `claude_bin` / `node_bin` | *(vacío)* | Rutas absolutas para sobrescribir la resolución si `PATH` falla en tu entorno |

## Datos y privacidad

- Todo se queda en local: `~/.claude/okf` es su propio repositorio git normal,
  completamente separado de cualquier repositorio en el que estés trabajando. **Ninguna
  ruta de código de este plugin ejecuta jamás `git push`, `git remote add` ni nada
  relacionado con la red sobre él**: las únicas operaciones git que se usan en cualquier
  punto son `init`, `commit`, `checkout` y `clean` (verificable:
  `grep -n "push\|remote" lib/*.mjs bin/*.mjs` — las únicas coincidencias son llamadas a
  `Array.push()` sin relación). Tu paquete nunca sale de tu máquina salvo que hagas
  `git push` deliberadamente tú mismo.
- El paso por lotes envía el contenido de la sesión a la API de Anthropic para hacer el
  resumen/extracción: la misma API con la que ya habla tu uso normal de Claude Code,
  solo que mediante una llamada más a `claude -p`. No interviene ningún servicio de
  terceros.
- `raw/` (las transcripciones capturadas completas) y las transcripciones ya procesadas
  pendientes de borrado están en git-ignore, no se commitean: solo se commitea el paquete
  de conocimiento extraído.

## Portabilidad

Ninguna ruta está nunca hardcodeada: todo se resuelve a través de `os.homedir()` /
`process.env.CLAUDE_CONFIG_DIR` / `process.env.HOME`, de modo que una instalación nueva
en otra máquina o cuenta de usuario produce su propio paquete independiente. Esto lo
ejercita la suite de tests (`test/smoke.mjs`) bajo sandboxes aislados de
`HOME`/`CLAUDE_CONFIG_DIR`, incluido uno **sin ninguna identidad de git configurada**:
el plugin nunca depende de tu `user.name`/`user.email`; sus propios commits automáticos
usan siempre una identidad sintética fija
(`OKF Batch <okf-batch@localhost>`). macOS y Linux se ejercitan así
directamente; las rutas específicas de Windows (`shell:true` para `claude.cmd`,
separadores de ruta) están implementadas según los requisitos del documento de diseño,
pero todavía no se han ejecutado en una máquina Windows real: trata esa combinación como
no verificada hasta que alguien lo confirme.

## Licencia

MIT
