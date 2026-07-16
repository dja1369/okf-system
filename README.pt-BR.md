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

## Benchmark do OKF

<!-- okf-benchmark: 2026-07-16 -->

**O OKF não te poupa de explorar. Ele guarda aquilo que explorar nunca vai encontrar.**

As duas metades dessa frase estão medidas abaixo, em repositórios open source reais, e a metade desfavorável vem publicada primeiro.

### Como foi medido

Dois repositórios públicos fixados — sem fixture sintético, então explorar custa o que explorar de fato custa e a baseline sem memória pode genuinamente vencer:

| Papel | Repositório | Commit |
|---|---|---|
| Codebase | [slimphp/Slim](https://github.com/slimphp/Slim) | `80900fb3` (125 arquivos PHP) |
| Pilha de documentos | [rust-lang/rfcs](https://github.com/rust-lang/rfcs) | `f635361c` (651 arquivos Markdown) |

Cada concept de cada bundle foi produzido pelo pipeline real — uma sessão `claude -p` real explorando o repo fixado, seu transcript real do Claude Code, batch ingest real, gate real. **Nenhum concept foi escrito à mão**, incluindo o enchimento que cria volume. Isso importa mais do que parece: veja [Acumulação](#acumulação-o-que-enchimento-semeado-à-mão-não-consegue-mostrar).

Cinco condições. Todas recebem ferramentas idênticas (`Read`, `Glob`, `Grep`, `Bash(git log/show/diff/blame/grep)`) e uma instrução idêntica e neutra quanto à condição — nenhuma condição é instruída a consultar o gate.

- **zero-base** — nada. Aquilo que o OKF diz substituir.
- **gabarito** — a resposta colada no prompt. Produzir essa string exige já saber a resposta, então nenhum usuário ocupa essa condição. É um piso, não um competidor.
- **OKF** — o texto real do gate.
- **conhecimento errado** — um gate de tamanho equivalente com concepts reais sobre o *outro* repositório. Separa "o conhecimento ajudou" de "ter um gate ajudou".
- **CLAUDE.md** — o mesmo conhecimento acumulado colado em um arquivo plano. O incumbente de verdade.

`total_cost_usd` é o número de manchete; a token activity aparece ao lado dele, nunca no lugar dele, porque `cache_read` domina essa soma e é cobrado ~50× mais barato — as duas colunas discordam na direção. A eficiência é comparada apenas em runs corretos. Um nonce por run derrota o prompt caching. A correção é feita por um juiz cego à condição, contra ground truth verificado a partir do código-fonte. **Nenhum número é tirado como média entre cenários**: um grep e uma cadeia de chamadas de cinco arquivos são fenômenos diferentes, e misturá-los deixaria a escolha de cenário definir a manchete.

O desenho, as previsões e os critérios de refutação foram [pré-registrados](docs/benchmarks/pre-registration-2026-07-16.md) e commitados **antes da primeira chamada paga**.

### Onde o OKF perde: qualquer coisa que o código consiga responder

Cinco cenários cujas respostas estão no código-fonte ou no histórico do git, verificadas a partir do checkout fixado, e cada uma sobreviveu a uma tentativa independente de refutá-la.

| Cenário | zero-base | OKF | veredito |
|---|---:|---:|---|
| `rfcs_cheap` — um grep | **$0.0256** · 4/5 | $0.0505 · 3/5 | OKF 2.0× mais caro |
| `slim_cheap` — um grep | **$0.0198** · 4/5 | $0.0386 · 5/5 | OKF 1.9× mais caro |
| `slim_stale` — conhecimento do bundle desatualizado por um commit posterior | **$0.0345** · 5/5 | $0.0632 · 4/5 | OKF 1.8× mais caro |
| `rfcs_buried` — achar a justificativa entre 651 documentos | **$0.0326** · 4/5 | $0.0910 · 3/5 | OKF 2.8× mais caro |
| `slim_buried` — seguir uma cadeia de chamadas de cinco arquivos | $0.1669 · 2/5 · **10 tools** | **$0.0701** · 2/5 · **3 tools** | **OKF 2.4× mais barato** |

**O OKF perde em quatro de cinco.** Ele só vence onde explorar é genuinamente caro, e lá corta as tool calls de 10 para 3. Se um grep responde a sua pergunta, o gate é puro overhead — isso não é um defeito, é aritmética.

Vale nomear o `slim_stale`: o bundle carregava uma afirmação desatualizada (o renderizador de erro HTML não faz escape — verdade antes do commit `f897118b`, falso no commit fixado) e o modelo **conferiu o código e corrigiu a informação mesmo assim**, 4/5. Conhecimento desatualizado não o deixou confiantemente errado. A previsão pré-registrada de que deixaria estava errada.

### Onde só o OKF funciona: conhecimento que o código não contém

Política de time e vocabulário de domínio — decididos em conversa, nunca escritos no repo. Cada cenário foi atacado por um adversário independente que vasculhou a working tree, ~300 revisões do histórico do git, mensagens de commit, docs, config, stashes e objetos dangling (zero acertos), e que **registrou um palpite baseado em convenção antes de olhar**. Esses palpites fizeram 0/3, 0/3 e 1/5.

Cada repo também contém uma armadilha: dê grep em "emitter" e você acha `ResponseEmitter`; procure um tamanho de chunk e você acha `4096`; busque uma política de MSRV na pilha de RFCs e os documentos propõem `N-2`.

| Cenário | zero-base | OKF | conhecimento errado | CLAUDE.md |
|---|---:|---:|---:|---:|
| `slim_policy` — qual env habilita detalhes de erro, e a exceção | **0/5** ($0.0509 gastos) | **5/5** · $0.0840 | 0/5 | 5/5 · $0.1314 |
| `slim_domain` — o que o time quer dizer com "에미터" | **0/5** · **confiantemente errado 5/5** | **4/5** · $0.0624 | 0/5 | 5/5 · $0.1198 |
| `rfcs_policy` — o período de espera da "thaw rule" do time | **0/5** | 2/5 · $0.0749 | 0/5 | 0/5 |

**A zero-base fez 0 de 15.** Gastou o dinheiro e não conseguiu nada, porque a resposta não está lá. No `slim_domain` ela ficou **confiantemente errada em 5 runs de 5**: explorou, achou `ResponseEmitter` e respondeu com alta confiança — enquanto o "에미터" do time é o `OutputBufferingMiddleware`, porque eles rodam FrankenPHP em worker mode, onde `ResponseEmitter` é código morto. Explorar não apenas falha aqui; ele fabrica uma resposta errada e confiante a partir da armadilha.

**O conhecimento errado também fez 0 de 15.** Um gate cheio de concepts reais porém irrelevantes não recupera nada. O ganho vem do conhecimento, não de haver um gate.

O OKF respondeu 11 de 15, a 1.6–1.9× menos que o CLAUDE.md carregando os mesmos fatos. No `slim_domain` ele **não leu nenhum arquivo de concept** (0/5) — só a linha do índice bastou, com 2 tool calls contra as 7 da zero-base.

`rfcs_policy` é a falha honesta: o OKF conseguiu apenas 2/5. A proposta `N-2` parada na pilha de documentos é uma armadilha forte o suficiente para tirar o modelo de uma linha de índice correta. O CLAUDE.md fez 0/5 ali.

### Acumulação: o que enchimento semeado à mão não consegue mostrar

Mesma pergunta (`slim_buried`), mesmo harness, bundle crescido por ingestão de mais sessões reais.

| Concepts no bundle | Bytes do gate | OKF | CLAUDE.md | zero-base (referência plana) |
|---:|---:|---:|---:|---:|
| 1 | 2,551 | $0.1291 | $0.1279 | $0.1669 |
| 5 | 3,621 | $0.1020 | $0.1506 | $0.1669 |
| 8 | 4,701 | $0.1425 | $0.1741 | $0.1669 |
| 10 | 5,414 | $0.0919 | $0.2358 | $0.1669 |
| 15 | 5,415 | **$0.0701** | $0.2249 | $0.1669 |
| 35 | 5,415 | $0.0908 | **$0.2828** | $0.1669 |

**De 1 para 35 concepts o OKF ficou mais barato ($0.1291 → $0.0908) enquanto o CLAUDE.md ficou 2.2× mais caro ($0.1279 → $0.2828).** As curvas divergem.

A razão está visível na segunda coluna. Entre 15 e 35 concepts — 2.3× o conhecimento — o gate cresceu **um byte**, porque o batch criou um domínio aninhado e colapsou 14 concepts em uma única linha de índice (`- [slim](/references/slim/index.md): 하위 도메인 — concept 14개`). O CLAUDE.md carrega o corpo de cada concept em todo prompt, então cresce linearmente. **O gate não.**

Essa é a descoberta que só conhecimento real poderia produzir. Um run anterior deste benchmark semeou enchimento à mão — vinte concepts autorais, todos planos, todos em `decisions/` — o que força o índice a crescer linearmente e concluiu que a economia do OKF piora com a acumulação. O batch real não empilha conhecimento desse jeito. A medição era do fixture, não do sistema.

Acurácia, honestamente: ela não melhora com o volume e continua ruidosa (2/5–5/5). Com n=5, nada aqui separa.

### Overhead local (não é o resultado de efetividade)

Medido em 2026-07-16, macOS arm64, Node `v26.4.0`, mediana com min/max.

| Operação local | Mediana | Faixa |
|---|---:|---:|
| Processo SessionStart gate | 57.3 ms | 56.1–60.0 ms |
| Processo trigger do batch no SessionEnd | 40.1 ms | 39.3–40.8 ms |
| Processo statusline | 35.8 ms | 34.6–36.3 ms |

Reproduza com `node test/bench.mjs [repositório]`. É só custo de processo local; não prova nada sobre tokens nem sobre latência do modelo.

### Custo, e o que este run não consegue te dizer

Construir o conhecimento custou **$3.59** em sessões reais e **$4.92** em batch ingest. Os 250 runs medidos custaram **$28.16** mais **$9.44** de correção.

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-knowledge.mjs --target slim --dir <repo>   # sessões reais → transcripts
OKF_RUN_LIVE_BENCH=1 node test/bench-bundles.mjs --target slim --levels 1,5,20  # batch real → bundles por nível
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                                    # medir
```

Pago, autenticado e excluído de propósito dos smoke tests e do CI.
[Relatório completo](docs/benchmarks/okf-benchmark-2026-07-16.md) ·
[raw JSON](docs/benchmarks/raw/) ·
[pré-registro](docs/benchmarks/pre-registration-2026-07-16.md) ·
[guia de uso](docs/USAGE.md).

Limites, ditos com todas as letras:

- **n=5 por célula.** Pouco. Só separação completa entre distribuições é descrita como vitória aqui.
- **O mix de modelos não está fixado.** `claude-sonnet-5` foi solicitado; a CLI resolveu `claude-haiku-4-5` junto com ele para trabalho interno. Comparações de custo entre condições carregam esse artefato.
- **Dois repositórios, uma linguagem cada.** Nenhuma alegação de generalidade entre tamanhos ou ecossistemas.
- **Wall-clock não está publicado.** A medição rodou com concorrência 5; custo, tokens e tool calls não são afetados por isso, latência de resposta é. Alegações de velocidade exigiriam um re-run sequencial.
- O texto do gate é prefixado ao prompt em vez de ser entregue pelo caminho de produção `additionalContext` do `SessionStart`. Mesmo texto, entrega diferente.
- Os cenários de política dependem de um humano ter escrito a política. É isso que política é. A defesa é que a resposta está comprovadamente ausente do repo e que um adversário não conseguiu adivinhá-la.

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
