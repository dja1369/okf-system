# OKF for Claude Code

**Transforme decisões de sessões anteriores do Claude Code em conhecimento local e revisável que sessões futuras conseguem usar de verdade.**

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · **Português**

O OKF captura a conversa ao encerrar uma sessão, extrai decisões e soluções reutilizáveis como Markdown e injeta um índice compacto na sessão seguinte. O bundle é um repositório git local que você pode ler, comparar, fazer backup ou apagar.

## Início em um minuto

Requer Claude Code com plugins, Node.js e git. Não há `npm install`.

```sh
claude plugin marketplace add dja1369/okf-system
claude plugin install okf@okf-marketplace
```

Reinicie o Claude Code, encerre uma sessão normal e execute:

```text
/okf:okf-status
/okf:okf-index
```

O primeiro `SessionStart` cria `~/.claude/okf` (ou `$CLAUDE_CONFIG_DIR/okf`). Coleta e batch oportunista são automáticos — uma conversa é coletada cerca de uma hora após sua última atividade, então ninguém precisa encerrar a sessão explicitamente.

## Fluxo de continuidade

```text
Sessão 1                ~1h de ociosidade         Batch em segundo plano      Sessão 2
decisão na sessão  ->   sweep coleta o raw   ->   Markdown OKF reutilizável -> índice compacto injetado
(sem necessidade de     (cópia sem perdas;            |                              |
 encerramento explícito) crescimento recoleta)        +-- histórico git local        +-- Read do concept relevante
```

Por exemplo, “deploy 10% → 50% → 100%, rollback acima de 0,5% de erros” pode ser recuperado sem o usuário colar tudo novamente. O índice apenas direciona; Claude deve `Read` o concept antes de agir.

Por que baseado em ociosidade? Sessões raramente terminam de forma explícita — agentes em segundo plano nunca terminam — e um snapshot de fim de sessão tirado no `resume` costumava congelar uma conversa no meio como “processada”, perdendo tudo que era dito depois. Por isso o sweep coleta um transcript assim que ele fica quieto por `sweep_min_idle_minutes` (padrão 60), o processo de batch permanece ativo até as conversas pendentes atingirem ociosidade (checando a cada ~5 minutos, por até 8 horas), uma sessão já coletada só é coletada **de novo** se tiver crescido depois, e uma sessão sem alteração nunca é recoletada. Os hooks de sessão apenas acordam o batch.

## Comandos

| Comando | Finalidade |
|---|---|
| `/okf:okf-status` | Último batch, sessões pendentes e lock |
| `/okf:okf-batch` | Ingest imediato respeitando o lock |
| `/okf:okf-config` | Ver ou editar configuração validada |
| `/okf:okf-index` | Categorias, títulos e mudanças recentes |
| `/okf:okf-visualize` | Somente concepts OKF e relações entre eles |
| `/okf:okf-analysis [caminho]` | Repositório mais apenas os concepts OKF relacionados |

`visualize` não analisa repositórios. `analysis` rejeita caminhos ausentes/não diretórios e informa truncamento, concepts irrelevantes ocultos e estatísticas por linguagem. Ambos geram HTML autocontido, sem CDN nem rede durante a execução.

## Statusline opcional

`bin/statusline.mjs` mostra uma linha como `OKF 12 · +3 · 2h ago`, sem rede ou análise completa. Claude Code aceita apenas um `statusLine`; o OKF não instala nem sobrescreve. Acrescente a saída de `node /path/to/okf/bin/statusline.mjs` ao script existente.

## Benchmark do efeito OKF

<!-- okf-live-benchmark: valid-2026-07-15T16-06-28Z -->

**O OKF não economiza tokens. Ele recupera o que uma sessão nova já perdeu.** Os números abaixo são publicados porque dizem isso com todas as letras.

Uma sessão de follow-up é questionada sobre oito fatos que a sessão anterior estabeleceu — arquitetura (SQLite / repository pattern), regra de código (named export only), correção de incidente passado (`busy_timeout=5000`), preferência de resposta (coreano / conciso), política de arquivo e deploy (`src/config.mjs` / `npm run deploy:canary`) — mais um controle aritmético sem relação (7 × 8 = 56), que a memória não ajuda a responder. Cinco condições, cinco runs em ordem cruzada cada. O bundle de C vem de coleta real em `raw/` → batch ingest isolado → gate SessionStart, sem concepts semeados à mão. Um preflight só libera o gasto se C contiver e rotear todos os fatos-alvo e D não contiver nenhum.

Run live em 2026-07-15: Claude Code `2.1.210`, `sonnet`/medium (Sonnet 5 + Haiku 4.5), macOS arm64, Node `v26.4.0`, cinco repetições por condição. Preflight de C: 8/8 fatos presentes, 8/8 roteados pelo gate. D: 0/8.

| Condição | Continuidade | aderência p50 | token activity p50/p95 | wall p50/p95 | custo p50 |
|---|---:|---:|---:|---:|---:|
| A — no memory | **0/5** | 12% | 27,246/27,518 | 13.82/18.17 s | $0.022218 |
| B_oracle (gabarito) | 5/5 | 100% | 9,069/9,069 | 4.86/6.46 s | $0.008410 |
| B_realistic | 5/5 | 100% | 9,069/9,069 | 5.96/6.27 s | $0.008410 |
| **C — OKF enabled** | **5/5** | 100% | **10,395**/10,459 | 6.46/7.15 s | $0.011329 |
| D — irrelevant OKF | 0/5 | 0% | 20,602/21,662 | 14.50/21.15 s | $0.025879 |

Os tool calls por trás dessas linhas explicam os números: A lê 2 arquivos em 4 turnos e ainda assim falha; B responde em 1 turno com 0 reads porque as respostas já estão no prompt; **C responde em 1 turno com 0 reads** — só o índice do gate bastou; D lê 1 arquivo em 2 turnos atrás do que seu gate nunca teve.

Leia o `p95` com cuidado: com n=5, `ceil(0.95×5)−1` é o último índice, então p95 **é** o máximo — um único run de cache frio, não uma estatística de cauda. Está publicado porque o formato pedido exige, não porque seja uma.

**Leia a linha A primeiro.** Sem memória a sessão queima 27,246 tokens, lê dois arquivos atrás da resposta, gasta quatro turnos — e ainda entrega **0/8**. É essa a condição que o OKF de fato substitui, e C ganha dela: 2.6× menos tokens, 8/8, em um único turno e sem nenhum read.

**C não ganha de B, e nunca vai.** A string de restatement de B_oracle contém as próprias respostas, então produzi-la exige já saber tudo que o OKF existe para recuperar: **nenhum usuário ocupa essa condição** — é um limite superior, não uma baseline, e seu trabalho humano é precificado em zero. B_realistic — restabelecer tudo que talvez seja relevante, porque não dá para saber de antemão de qual fato a próxima sessão precisa; o hábito do CLAUDE.md — é a comparação real, e é contra ela que o break-even é calculado. Neste tamanho de bundle B_realistic empata com B_oracle (ainda não há conhecimento sem relação para restabelecer), por isso os dois ficam em 9,069. Ainda assim C custa 1,326 tokens e $0.0029 a mais por sessão. Construir o bundle custou um batch ingest de **133,364** de token activity e **$0.176758**. **Não existe break-even** de tokens nem de custo; o harness reporta `null` em vez de inventar um.

O que mudou desde o run anterior foi o gate. C custava **22,857** tokens em 7 turnos com 5 reads; agora custa **10,395** em 1 turno com 0 reads, com o mesmo recall 5/5. 91% do overhead antigo era um `Read` obrigatório que ia buscar fatos que o índice já havia entregue.

### O limite de acumulação — medido, não projetado

**A tese "o OKF fica mais barato conforme o conhecimento acumula" é falsa.** Ele fica mais caro — e mais rápido que a alternativa. Mesmo benchmark, mesmo bundle, com 20 concepts sem relação adicionados; tudo ainda cabe no índice (21 linhas, 5,548 de 9,000 bytes, nada truncado):

| Condição | Continuidade | aderência p50 | token activity p50/p95 | wall p50/p95 | custo p50 |
|---|---:|---:|---:|---:|---:|
| A — no memory | 0/5 | 0% | 27,316/27,717 | 13.79/18.05 s | $0.022838 |
| B_oracle (gabarito) | 5/5 | 100% | 9,070/9,085 | 5.33/6.78 s | $0.008410 |
| B_realistic | 5/5 | 100% | 10,406/10,406 | 5.72/9.62 s | $0.010134 |
| **C — OKF enabled** | **5/5** | 100% | **25,384**/25,773 | 11.75/13.15 s | $0.030721 |
| D — irrelevant OKF | 0/5 | 0% | 22,265/22,334 | 14.91/19.59 s | $0.037354 |

Contra o run de 0 enchimento: B_realistic cresceu **+1,337** (9,069 → 10,406) enquanto C cresceu **+14,989** (10,395 → 25,384). **C degrada ~11× mais rápido** — 749 tokens por concept adicionado contra 67. Os dois ainda respondem 5/5, então isso é uma regressão pura de custo, não de acurácia.

A causa não é truncamento. É confiança:

```text
0 enchimento:   C reads=0  turns=1    responde direto pela linha do índice
20 enchimento:  C reads=3  turns=4    volta a abrir arquivos
```

Vinte concepts irrelevantes bastaram para o modelo parar de confiar na linha do índice e ir conferir no arquivo — ressuscitando exatamente o round-trip que a correção do gate tinha removido. O índice diz que a linha existe; não diz que a linha é a resposta *completa*, então conforme o ruído em volta cresce, conferir vira a jogada racional. **Esse é o teto real, e ele chega em ~21 concepts — muito antes de qualquer cap apertar.**

Truncamento é a segunda parede, mais adiante:

| Concepts no bundle | Mostrados no índice |
|---:|---:|
| 20 | 20 |
| 40 | 40 |
| **55** | **43** (truncado) |
| 100 | 43 (truncado) |

Acima de ~43 concepts o índice trunca e quem sobrevive é escolhido por nome de arquivo — não por relevância nem recência. Um run com 50 concepts de enchimento **falha no preflight** exatamente por isso (`presentFacts: 8, routedFacts: 6`): `decisions/tech-stack.md` ficou atrás do enchimento na ordenação e foi cortado. As categorias são distribuídas em round-robin para nenhuma passar fome, e cada categoria truncada aponta para o próprio `index.md` — mas descer é um round-trip de tool, o mesmo custo de novo.

Nenhuma das duas paredes é um botão de ajuste. Corrigir a primeira exige que o índice sinalize *quais linhas são respostas completas*, para o modelo poder confiar nelas sem abrir o arquivo; esse trabalho não está feito, e até estar, a economia do OKF piora a cada concept adicionado.

Run de acumulação: [raw JSON](docs/benchmarks/raw/okf-live-2026-07-15T16-30-11-404Z.json). A falha de preflight com 50 de enchimento está preservada em [auditoria de preflight](docs/benchmarks/raw/okf-live-preflight-failed-2026-07-15T16-11-37-402Z.json) — um resultado negativo mantido de propósito.

Medimos também aderência, suposições erradas, perguntas extras, tool calls, primeira resposta válida, tempo API/wall, `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` e custo do CLI; as categorias permanecem separadas no JSON. `tokenActivity` soma cache reads 1:1 com output tokens embora cache read seja ~50× mais barato — **custo é a coluna defensável**. Com n=5 o `p95` do harness é sempre o máximo (o run frio) — leia o p95 das tabelas com essa ressalva. Tokens user-only/gate-only que o CLI não separa ficam `null`, sem estimativa.

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                      # publicado acima
OKF_RUN_LIVE_BENCH=1 OKF_BENCH_FILLER=50 node test/bench-okf.mjs  # eixo de acumulação
```

Execução paga e opt-in, fora do CI. Veja o [relatório](docs/benchmarks/okf-live-2026-07-15T16-06-28-592Z.md), [raw JSON](docs/benchmarks/raw/okf-live-2026-07-15T16-06-28-592Z.json) e [docs/USAGE.md](docs/USAGE.md). O run anterior, pré-correção, fica como trilha de auditoria.

### Overhead local — não é o resultado de efetividade

Medição nova de 2026-07-16, macOS arm64, Node `v26.4.0`:

| Operação | Mediana | Faixa |
|---|---:|---:|
| Processo SessionStart gate | 57.2 ms | 56.9–58.1 ms |
| Processo trigger do SessionEnd | 41.4 ms | 39.0–42.1 ms |
| Processo statusline | 35.0 ms | 35.0–35.2 ms |

Reproduza com `node test/bench.mjs [repositório]`. Isso mede custo local, não economia de tokens nem velocidade do modelo.

### Custo do batch e break-even

```text
custo OKF inicial = batch ingest + repair + overhead medido do gate irrelevante
economia por sessão = mediana B_realistic - mediana OKF
sessões break-even = ceil(custo inicial / economia positiva por sessão)
```

A comparação é contra **B_realistic**, não B_oracle: a string de B_oracle contém as próprias respostas, então precificaria em zero justamente o trabalho que o OKF existe para fazer — um break-even contra ela não significaria nada. A economia medida foi negativa de qualquer forma (−1,326 tokens, −$0.0029), então os dois campos de break-even reportam `null`. Isso é o resultado, não uma lacuna do harness.

## Linguagens

O analisador fallback é determinístico, sem dependências e conservador; diferencia “arquivo encontrado” de “estrutura analisada”.

| Linguagem | Relações e declarações | Limites principais |
|---|---|---|
| JS / TS | import/export/require relativo, function/class | bare packages externos |
| Python | módulos dotted, function/class | import dinâmico omitido |
| Go | package nodes internos via `go.mod`, function/struct | não inventa file edges |
| Rust | `mod`/`use`, function/struct/enum/trait | macros omitidas |
| Java / Kotlin | package/class paths, types/Kotlin function | reflection omitida |
| Ruby | `require_relative`, class/method | gems externas |
| PHP | namespace/use/alias/grouped use, require/include, types/function | autoload dinâmico omitido |
| C / C++ | quoted include, angle local único com caminho explícito, types/namespace/function definition | regex pode perder macros e sintaxe multilinha complexa |
| C# | namespace nodes declarados, types principais | namespaces externos não ligados |
| Swift | inheritance/conformance/extension explícitos, types/function | targets nested entre arquivos omitidos contra colisões |

Com 2.000 arquivos, marca `truncated`; arquivos acima de 512 KiB continuam visíveis, mas não analisados.

## Validação real em open source

Commits fixos foram clonados e edges representativos conferidos no código. Tempos servem apenas para segurança operacional.

| Repositório | Commit | Arquivos da linguagem | Declarações | Internal edges | Truncated |
|---|---|---:|---:|---:|---:|
| [Slim](https://github.com/slimphp/Slim) | `80900fb` | 125 | 127 | 305 | não |
| [Redis](https://github.com/redis/redis) | `f76dff7` | 784 | 5,796 | 990 | não |
| [fmt](https://github.com/fmtlib/fmt) | `a79df45` | 46 | 283 | 121 | não |
| [Alamofire](https://github.com/Alamofire/Alamofire) | `903c53c` | 98 | 2,052 | 215 | não |

A validação corrigiu um `Error` padrão do Swift ligado a um tipo nested homônimo e headers padrão C ligados a cópias vendored. Veja o [relatório](docs/benchmarks/oss-analysis-2026-07-15.md).

## Dados e privacidade

- O sweep de ociosidade copia o transcript completo para `raw/`, sem parsing ou truncamento durante a coleta. Os hooks de sessão apenas acordam o batch.
- Batch cria um digest limitado e o envia à Anthropic por outro `claude -p`; é a única transferência modelo/API adicional.
- Usa `--safe-mode`, tools restritas, prompt por stdin, lint/rollback e sem Bash.
- O analisador trabalha sobre uma cópia descartável do conhecimento em um workspace temporário e não tem acesso físico a `raw/`, `.okf/` ou `.git`; o driver só reflete arquivos `.md` regulares (scripts e symlinks nunca chegam ao bundle).
- Raw é ignorado pelo git; somente Markdown extraído recebe commit local. O plugin não faz push nem adiciona remote.
- Diretórios POSIX `0700`, raw/state/log `0600`. Logs persistentes excluem transcript, stdout/stderr do Claude, credenciais e caminhos raw completos.
- O fixture live é sintético, sem dados pessoais ou credenciais.

## Configuração e remoção

Use `~/.claude/okf/.okf/config.md` ou `/okf:okf-config`. Principais valores: `enabled: true` (chave mestra para coleta, gate e batch), `batch_interval_hours: 1`, `batch_max_digest_kb: 600`, `batch_digest_cap_kb: 150`, `remove_candidate_ttl_days: 30`, `inject_max_lines` / `inject_max_bytes`: `120` / `9000`, `sweep_min_idle_minutes: 60` (tempo de ociosidade após a última atividade antes da sessão ser coletada; `0` coleta imediatamente). Valores inválidos voltam a defaults seguros.

```sh
claude plugin uninstall okf
```

O bundle permanece em `~/.claude/okf` para inspeção, backup ou remoção manual.

## Verificação de desenvolvimento

```sh
node test/smoke.mjs
node test/bench.mjs
for file in $(rg --files -g '*.mjs'); do node --check "$file"; done
claude plugin validate .claude-plugin/plugin.json
claude plugin validate .claude-plugin/marketplace.json
git diff --check
```

Live: `OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs`.

## Referências e licença

A estrutura se inspira na apresentação curta e reproduzível de [uv](https://github.com/astral-sh/uv), [Ruff](https://github.com/astral-sh/ruff), [Playwright](https://github.com/microsoft/playwright), [fmt](https://github.com/fmtlib/fmt) e [Slim](https://github.com/slimphp/Slim), sem copiar texto ou claims. [Especificação OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md). Licença: [MIT](LICENSE).
