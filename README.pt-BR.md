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
| `/okf:okf-deprecate <alvo>` | Aposentar um concept — o arquivo e seus links ficam, o gate para de injetá-lo |

`visualize` não analisa repositórios. `analysis` rejeita caminhos ausentes/não diretórios e informa truncamento, concepts irrelevantes ocultos e estatísticas por linguagem. Ambos geram HTML autocontido, sem CDN nem rede durante a execução.

## Statusline opcional

`bin/statusline.mjs` mostra uma linha como `OKF 12 · +3 · 2h ago`, sem rede ou análise completa. Claude Code aceita apenas um `statusLine`; o OKF não instala nem sobrescreve. Acrescente a saída de `node /path/to/okf/bin/statusline.mjs` ao script existente.

## Benchmark do OKF

<!-- okf-benchmark: 2026-07-26-e2 -->

### E2 — quatro caracteres antes do `title` (2026-07-26)

Nenhum byte de corpo, nome de arquivo ou caminho foi alterado. Bastou pôr quatro caracteres antes do **`title`** do frontmatter do conceito-resposta para o `recall` ir de **0.262 a 0.533** em N=400 — o dobro — e de **0.400 a 1.000** em N=24. O mesmo conhecimento, os mesmos arquivos, o mesmo tamanho de bundle. O que mudou foi só a posição da linha na ordenação.

> **recall não é taxa de acerto.** Distratores sintéticos dão apenas um **limite superior** do desempenho do roteador.
> **Não compare os números do E2 com os do E1 e chame isso de "melhora" ou "piora"** — o orçamento (+11 B) e o modo de gerar o filler mudaram, então as duas execuções são condições diferentes. O que dá para comparar são as três condições de perturbação *dentro* do E2.

| N | none | front (`!!! `) | back (`힣힣 `) | spread |
|---|---|---|---|---|
| 24 | 0.400 ± 0.000 (n=20, 0.40–0.40) | **1.000 ± 0.000** (n=20, 1.00–1.00) | 0.400 ± 0.000 (n=20, 0.40–0.40) | **0.600** |
| 50 | 0.277 ± 0.038 (n=20, 0.20–0.35) | 0.560 ± 0.064 (n=20, 0.50–0.70) | 0.182 ± 0.044 (n=20, 0.15–0.30) | **0.378** |
| 100 | 0.247 ± 0.034 (n=20, 0.20–0.30) | 0.523 ± 0.030 (n=20, 0.45–0.55) | 0.170 ± 0.025 (n=20, 0.15–0.20) | **0.353** |
| 200 | 0.250 ± 0.040 (n=20, 0.15–0.30) | 0.528 ± 0.030 (n=20, 0.45–0.55) | 0.175 ± 0.026 (n=20, 0.15–0.20) | **0.353** |
| 400 | 0.262 ± 0.039 (n=20, 0.15–0.30) | 0.533 ± 0.024 (n=20, 0.50–0.55) | 0.185 ± 0.024 (n=20, 0.15–0.20) | **0.348** |

**R6 foi desenhado para refutar, e a tentativa de refutação falhou.** R6 foi pré-registrado como "se mexer no `title` não move o `recall`, o diagnóstico de dominância da ordenação está errado", com limiar de 0,05. O spread medido é de 0,348 a 0,600 — **de 7 a 12 vezes o limiar** —, então a refutação não se sustentou e o diagnóstico sobreviveu. **Num gate com zero sinais de relevância esse é o resultado esperado, não a descoberta de um bug**; o que há de novo é que o tamanho do efeito virou número.

**`cwdIndependent` se inverte.** Os 6 conceitos que em E1 eram aniquilados (0.000) com N≥200 voltam a **0.967** com um único prefixo. Aquele resultado do E1 não era "conhecimento independente do repositório é prejudicado" — era **função da nomeação**.

**R2 e R3 dispararam de novo**, então, pela regra de tratamento pré-registrada, os valores absolutos de recall continuam sem servir de fundamento para qualquer decisão de política.

**Na disciplina de medição houve um passo à frente.** No E1 os fixtures apareciam pela primeira vez no commit do relatório; no E2 eles vão junto no commit do pré-registro, e o smoke impõe uma desigualdade estrita via `git log --diff-filter=A`.

```sh
node test/gate-recall.mjs --e2 --perturb all   # 3 condições × 5 níveis × 20 sementes
```

Essa execução registra **$0.00** e **26,6 segundos** para 300 amostras. Os dois são propriedades do arnês de medição — não são afirmações sobre custo ou velocidade do gate.

[Relatório E2](docs/benchmarks/gate-recall-2026-07-26-e2.md) ·
[pré-registro E2](docs/benchmarks/pre-registration-2026-07-26-e2.md)

<!-- okf-benchmark: 2026-07-26-e1 -->

### E1 — recall@cap do gate, medido por $0.00 (2026-07-26)

Esta execução custou **$0.00**, e isso é provado pela própria execução, não declarado: o arnês coloca um `claude` de mentira no início do `PATH` antes de subir o hook, e esse stub nunca foi executado (`paidCallTrapTripped: false`). 4 níveis × 20 sementes = **80 amostras, 6,2 segundos**.

Mede um único número: `recall(N)` — com N conceitos no bundle, a fração das 20 perguntas congeladas cujo conceito-resposta sobrevive no índice que o gate de fato injeta.

> **recall não é taxa de acerto.** Esta medição só responde "o gate carregou a linha relevante?". Se "o modelo realmente usou aquela linha" não dá para verificar sem chamadas pagas. Distratores sintéticos dão apenas um **limite superior** do desempenho do roteador, então o recall no uso real é menor que este.

| N | recall média ± desvio-padrão | amostra | min–max |
|---|---|---|---|
| 24 | 0.400 ± 0.000 | n=20 | 0.40–0.40 |
| 50 | 0.277 ± 0.038 | n=20 | 0.20–0.35 |
| 100 | 0.245 ± 0.036 | n=20 | 0.20–0.30 |
| 200 | 0.248 ± 0.041 | n=20 | 0.15–0.30 |

(Pôr `n=` e o min–max **na mesma linha** da média é uma convenção que `test/bench-report.mjs` estabeleceu e que o smoke impõe.)

**R3 disparou** (violação da queda monotônica: +0,0025 de N=100 para N=200) e **R2 também disparou** (`recall(24)` = 0.400 < 0.60). Pela regra de tratamento pré-registrada, **os valores absolutos de recall não são usados como fundamento de nenhuma decisão de política.** A regra vale mesmo que o delta infrator seja 1/16 do desvio-padrão entre sementes daquele nível, porque o pré-registro fixou de antemão que um delta pequeno não cancela um disparo. A tabela é publicada; ela não decide nada.

**O achado é a forma, não o nível.** Das 20 perguntas, 9 sobrevivem em 0 em todos os níveis e 3 sobrevivem em 1.0 em todos os níveis; as 8 restantes ficam em valores intermediários. Por célula (20 perguntas × 4 níveis = 80) são 48 zeros, 19 uns e 13 valores intermediários — o recall não é binário. Três das perguntas intermediárias até sobem conforme N cresce (q06: 0 → 0,60 → 0,65 → 0,70), e essa subida é a origem aritmética do R3. O gate não preenche uma linha por categoria e para: ele **percorre as categorias repetidamente até o orçamento acabar**. Cada categoria termina com 1–3 linhas só porque uma única linha é grande — linhas de conceito têm 200–1.030 B contra um orçamento de índice de 6.956 B, então o total tomado se esgota em 8–11 linhas. De `references` é tomada exatamente 1 linha em qualquer nível (1 de 57 linhas em N=200), então das 8 respostas concentradas ali no máximo uma sobrevive. E quem ocupa essas vagas não é decidido pela relevância, mas pela **ordenação no momento da geração e pelo comprimento da linha**, com pelo menos 5 fatores confirmados. O principal: dentro de uma seção a chave de ordenação é a **ordem alfabética do `title` do frontmatter, não do nome do arquivo** (`lib/index-gen.mjs:315`; o nome do arquivo é apenas fallback quando o parse do frontmatter falha), e o **comprimento em bytes da linha** também muda a sobrevivência — se a próxima linha ultrapassa o orçamento restante, aquela categoria para ali (`lib/gate.mjs:122`). O gate atual não tem nenhuma referência a cwd, recência ou termos da consulta.

**Profundidade de aninhamento (eixo A-2).** 25 conceitos fixos, conteúdo idêntico, só os caminhos mais profundos:

| Condição | linhas de conceito injetadas | links de subdomínio |
|---|---:|---:|
| plano | 28 | 0 |
| 2 níveis | 27 | 0 |
| 3 níveis | 26 | 0 |
| 4 níveis | 25 | 0 |

Cada condição foi medida **uma única vez** (n=1, sem repetição de sementes), e nessa medição única perdeu-se uma linha por nível de profundidade. Com apenas 4 pontos não dá para distinguir se essa queda é linear, e profundidades acima de 4 níveis não foram medidas. Contado sobre os conceitos plantados, 3 níveis são 25 → 23, **-8,0%**. A causa é pressão de bytes, não uma travessia de cadeia que falhou: cada segmento a mais no caminho alonga todas as linhas até empurrar uma para fora do orçamento.

```sh
node test/gate-recall.mjs     # 4 níveis × 20 sementes, ~6 s, zero chamadas pagas
node test/bench-nesting.mjs   # o eixo de profundidade de aninhamento
node test/smoke.mjs           # guardas de regressão
```

[Relatório E1](docs/benchmarks/gate-recall-2026-07-26-e1.md) ·
[pré-registro E1](docs/benchmarks/pre-registration-2026-07-26-e1.md)

### Execução paga de ponta a ponta (v3, 2026-07-16)

<!-- okf-benchmark: 2026-07-16-v3 -->

**O OKF é sobrecarga em quase tudo que o código consegue responder, e onde o código não tem resposta alguma, um simples CLAUDE.md também o supera — a única vantagem do OKF é fazer isso de forma mais barata. Um teste direto de sua promessa central (conhecimento acumulado compensa ao longo do tempo) foi executado e refutado.**

Cada afirmação desse parágrafo está medida abaixo, em repositórios open source reais, com n=15 por célula de comparação. As partes desfavoráveis ao OKF vêm publicadas primeiro.

### Como foi medido

Dois repositórios públicos fixados — sem fixture sintético, então explorar custa o que explorar de fato custa e a baseline sem memória pode genuinamente vencer:

| Papel | Repositório | Commit |
|---|---|---|
| Codebase | [slimphp/Slim](https://github.com/slimphp/Slim) | `80900fb3` (125 arquivos PHP) |
| Pilha de documentos | [rust-lang/rfcs](https://github.com/rust-lang/rfcs) | `f635361c` (651 arquivos Markdown) |

Cada concept de cada bundle foi produzido pelo pipeline real — uma sessão `claude -p` real explorando o repo fixado, seu transcript real do Claude Code, batch ingest real, gate real. **Nenhum concept foi escrito à mão.** Os bundles estão commitados neste repositório ([docs/benchmarks/bundles/](docs/benchmarks/bundles/)), então você pode ler o texto exato do gate e o corpo dos concepts em que cada número abaixo se apoia, e refutar este run do mesmo jeito que a v2 foi refutada — a partir do repo, sem confiar no autor.

Cinco condições. Todas recebem ferramentas idênticas (`Read`, `Glob`, `Grep`, `Bash(git log/show/diff/blame/grep)`) e uma instrução idêntica e neutra quanto à condição — nenhuma condição é instruída a consultar o gate. O gate é entregue pelo **hook `SessionStart` real** (`additionalContext`), não prefixado ao prompt; os bytes entregues são verificados por run.

- **zero-base** — nada. Aquilo que o OKF diz substituir.
- **gabarito** — a resposta colada no prompt. Produzir essa string exige já saber a resposta, então nenhum usuário ocupa essa condição. É um piso, não um competidor.
- **OKF** — o texto real do gate.
- **conhecimento errado** — um gate de tamanho equivalente com concepts reais sobre o *outro* repositório. Separa "o conhecimento ajudou" de "ter um gate ajudou".
- **CLAUDE.md** — o mesmo conhecimento acumulado colado em um arquivo plano. O incumbente de verdade.

`total_cost_usd` é o número de manchete; o custo somente-sonnet é publicado ao lado do custo total, então o `claude-haiku` que a CLI resolve para trabalho interno (2,3% do gasto) pode ser descontado e não consegue esconder uma conclusão. A eficiência é comparada apenas em runs corretos. Cada resposta é corrigida por **átomo** — o ground truth é dividido em fatos verificáveis de forma independente, congelados antes da medição — e a pontuação binária no estilo v2 (todos os átomos corretos) é publicada ao lado. Um nonce por run derrota o prompt caching. **Nenhum número é tirado como média entre cenários.**

O desenho, as previsões e os critérios de refutação R1–R5 foram [pré-registrados](docs/benchmarks/pre-registration-2026-07-16-v3.md) e commitados **antes da primeira chamada paga**. Esse documento também registra, em detalhe, as seis afirmações falsas ou não sustentadas que a publicação anterior (v2) deste benchmark fez, e como cada uma foi flagrada a partir dos seus próprios dados brutos.

### Onde o OKF perde: qualquer coisa que o código consiga responder

Cinco cenários cujas respostas estão no código-fonte, no histórico do git ou no bundle, cada uma verificada a partir do checkout fixado. O custo é a mediana dos runs corretos, com sua dispersão.

| Cenário | zero-base | OKF | veredito |
|---|---:|---:|---|
| `rfcs_cheap` — um grep | **$0.062** · 13/15 | $0.077 · 14/15 | OKF 1.2× mais caro |
| `slim_cheap` — um grep | **$0.067** · 14/15 | $0.114 · 15/15 | OKF 1.7× mais caro |
| `rfcs_buried` — achar a justificativa entre 651 documentos | **$0.097** · 12/15 | $0.112 · 13/15 | OKF 1.2× mais caro |
| `slim_buried` — seguir uma cadeia de chamadas de cinco arquivos | $0.277 · 13/15 · **10 tools** | **$0.232** · 9/15 · **8 tools** | OKF mais barato, menos tools |
| `slim_stale` — conhecimento do bundle desatualizado por um commit posterior | crítico **15/15** | crítico **15/15** | empate — veja abaixo |

**Em greps baratos o OKF é puro overhead** — 1.2–1.7× mais caro pela mesma resposta, porque o gate é um custo fixo que um `grep` não precisa. Ele só compensa onde explorar é genuinamente caro: `slim_buried` segue uma cadeia de chamadas de cinco arquivos, e lá o OKF é mais barato com menos tool calls. Isso não é um defeito, é aritmética — se um grep responde a sua pergunta, não pague por um gate.

`slim_stale` é onde a correção por átomo mostrou seu valor. O bundle carregava uma afirmação tornada obsoleta por um commit posterior, e a pontuação binária marca **0/15 para toda condição** — o que parece um massacre total. Não é. Os átomos *críticos* (o que a pergunta de fato pede — que o renderizador de HTML faz escape, com qual função e flags) ficam em **15/15**: o modelo leu o código e respondeu o fato central corretamente. Os únicos átomos que ele errou são proveniência que a pergunta nunca pediu (o SHA do commit que introduziu o escaping). Conhecimento desatualizado **não** o deixou confiantemente errado — a previsão pré-registrada de que deixaria estava errada, e a pontuação binária sozinha teria escondido isso.

### Onde explorar não ajuda: conhecimento que o código não contém

Política de time decidida em conversa, nunca escrita no repo. A pilha de RFCs contém até uma armadilha: busque nela uma política de MSRV e os documentos propõem `N-2` — a regra real do time é diferente.

| Cenário | zero-base | OKF | conhecimento errado | CLAUDE.md |
|---|---:|---:|---:|---:|
| `rfcs_policy` — a "thaw rule" do time: período de espera, cadência de MSRV, duas exceções | **0/15** | **11/15** · $0.075 | — | 15/15 · $0.144 |

**A zero-base fez 0 de 15.** Gastou o dinheiro e não conseguiu nada, porque a resposta não está no repositório — verificado por um adversário que vasculhou a working tree, o histórico do git, mensagens de commit, docs e config, e não achou nenhum acerto. A armadilha também não a pegou; ela simplesmente não conseguiu responder.

O OKF respondeu **11 de 15**, a aproximadamente metade do custo do CLAUDE.md carregando os mesmos fatos. Esta é a única coisa que explorar não consegue fazer e uma decisão guardada consegue. **O CLAUDE.md também responde** (15/15) — o OKF não é único aqui, é uma forma mais barata e de injeção limitada do mesmo incumbente. O controle de `conhecimento errado` para este cenário fica excluído: um bug de contaminação de medição (abaixo) deixou que ele lesse a resposta, então ele não pode servir como o controle de "só um gate não ajuda" neste run.

Este é um único cenário de política limpo, não três. Dois outros (`slim_policy`, `slim_domain`) foram medidos e depois **excluídos** — veja abaixo.

### O que este run não consegue te dizer

- **Dois cenários de política foram excluídos por contaminação.** O Claude Code injeta automaticamente a memória de projeto por diretório (`~/.claude/projects/<cwd>/memory/`) em toda sessão. Durante a construção do conhecimento, uma sessão `claude -p` explorando o repo alvo salvou as decisões do time nessa memória, e como a medição rodou no mesmo diretório de trabalho, a memória chegou até a condição **zero-base** — que não deveria ter conhecimento algum. No `slim_domain`, a zero-base então "respondeu" uma decisão de time que não existe em lugar nenhum do código, 15/15. Qualquer cenário cujos runs de zero-base leram a memória de projeto é retirado da publicação (`slim_domain`, `slim_policy`); o harness agora limpa essa memória antes de medir, e o relatório detecta e exclui tais cenários mecanicamente. Os cenários limpos acima tiveram zero leituras de memória.
- **n=15 nas condições de contraste, n=5 nos controles.** Pouco. Só separação completa entre distribuições é descrita como vitória.
- **Dois repositórios, dois ecossistemas (PHP + Markdown).** Nenhuma alegação de generalidade entre tamanhos ou linguagens. Um terceiro repositório foi projetado e depois rejeitado por custo-por-credibilidade antes de gastar.
- **Sessões de pergunta única.** O custo fixo do gate do OKF é pago uma vez por pergunta em vez de amortizado ao longo de uma sessão real com várias perguntas, então este run *subestima* o OKF.
- **O juiz é uma única família de LLM**, corrigindo por átomo contra ground truth verificado a partir do código-fonte.

Os critérios de refutação **R1–R5 foram todos avaliados mecanicamente e nenhum disparou** (após excluir as células contaminadas) — este run não refuta a alegação. Isso não é o mesmo que uma confirmação forte com n=15; é a ausência de uma refutação.

### Um follow-up em cadeia: acumulação real ajuda? (v4, refutado)

<!-- okf-benchmark-chain: 2026-07-16-v4 -->

Um run separado e pré-registrado testou o mecanismo do OKF diretamente: uma cadeia de 4 perguntas relacionadas, mas diferentes, sobre o `pkg/scheduler` do `kubernetes/kubernetes` (v1.30.0, 178 arquivos Go), em que a conclusão de cada sessão passa por um **batch real** antes de a sessão seguinte começar, comparada com as mesmas 4 perguntas feitas sem acumulação nenhuma, jamais. Este é exatamente o formato que o pré-registro da v3 flagrou como "favorece o OKF e é ajustável para bajulá-lo" e recusou-se a rodar. A v4 rodou mesmo assim, desta vez com guardas: as 4 perguntas foram congeladas e verificadas na fonte antes do gasto, a guarda de contaminação limpa a memória de projeto do Claude Code antes de **cada** sessão (não uma única vez), e os critérios de refutação foram fixados antes da medição — veja o [pré-registro](docs/benchmarks/pre-registration-2026-07-16-v4.md).

Houve acumulação real: os bytes do gate cresceram monotonicamente ao longo dos passos (1835 → 2613 → 3675 → 4950, n=15 cadeias), respaldados por gasto de batch real e medido ($25.81 no total). **A previsão central — de que o custo cai ao longo da cadeia — foi refutada.** O custo do OKF foi $0.231 → $0.216 → $0.258 → **$0.447** ao longo das quatro perguntas; o controle sem memória se moveu do mesmo jeito ($0.255 → $0.256 → $0.272 → $0.411). A explicação mais provável é que a quarta pergunta simplesmente era mais difícil para os dois braços — ela pergunta sobre dois mecanismos de uma vez — não que a acumulação tenha ajudado ou atrapalhado. A acurácia por átomo do OKF não superou a da baseline em nenhum passo, e ficou abaixo dela tanto na primeira quanto na última pergunta. A pontuação binária (todos os átomos corretos) foi 0/106 para os dois braços — este conjunto de perguntas é difícil o bastante para que apenas a pontuação por átomo seja sequer utilizável. [Relatório completo](docs/benchmarks/okf-benchmark-chain-2026-07-16-v4.md).

### Overhead local (não é o resultado de efetividade)

Medido em 2026-07-16, macOS arm64, Node `v26.4.0`, mediana com min/max.

| Operação local | Mediana | Faixa |
|---|---:|---:|
| Processo SessionStart gate | 57.3 ms | 56.1–60.0 ms |
| Processo trigger do batch no SessionEnd | 40.1 ms | 39.3–40.8 ms |
| Processo statusline | 35.8 ms | 34.6–36.3 ms |

Reproduza com `node test/bench.mjs [repositório]`. É só custo de processo local; não prova nada sobre tokens nem sobre latência do modelo.

### Custo, reprodução e links

Os 440 runs medidos custaram **$66.26** mais **$14.74** de correção; a construção do conhecimento e dos bundles somou ~$3.2. Total deste run ≈ **$84**. Pago, autenticado e excluído de propósito dos smoke tests e do CI.

```sh
OKF_RUN_LIVE_BENCH=1 node test/bench-knowledge.mjs --target slim --dir <repo>   # sessões reais → transcripts
OKF_RUN_LIVE_BENCH=1 node test/bench-bundles.mjs --target slim --levels 20      # batch real → bundle
OKF_RUN_LIVE_BENCH=1 node test/bench-okf.mjs                                    # medir
```

O run em cadeia da v4 (120 sessões, batches reais entre os passos) custou **$31.95** de medição + **$9.20** de correção + **$25.81** de ingest real ≈ **$67**:

```sh
OKF_RUN_LIVE_BENCH=1 OKF_BENCH_CHAINS=15 node test/bench-chain.mjs   # sessões encadeadas, batch real, medir
```

[Relatório completo](docs/benchmarks/okf-benchmark-2026-07-16-v3.md) ·
[relatório do follow-up em cadeia](docs/benchmarks/okf-benchmark-chain-2026-07-16-v4.md) ·
[raw JSON](docs/benchmarks/raw/) ·
[bundles commitados](docs/benchmarks/bundles/) ·
[pré-registro](docs/benchmarks/pre-registration-2026-07-16-v3.md) ·
[pré-registro da cadeia](docs/benchmarks/pre-registration-2026-07-16-v4.md) ·
[guia de uso](docs/USAGE.md).

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

Use `~/.claude/okf/.okf/config.md` ou `/okf:okf-config`. Principais valores: `enabled: true` (chave mestra para coleta, gate e batch), `batch_interval_hours: 1`, `batch_max_digest_kb: 600`, `batch_digest_cap_kb: 150`, `remove_candidate_ttl_days: 30`, `inject_max_lines` / `inject_max_bytes`: `120` / `9000`, `sweep_min_idle_minutes: 60` (tempo de ociosidade após a última atividade antes da sessão ser coletada; `0` coleta imediatamente), `sweep_backfill_days: 0` (quantos dias **antes** do marcador de instalação o sweep pode alcançar; `0`, o padrão, = apenas conversas posteriores à instalação; a janela rígida de 7 dias continua sendo o teto), `batch_max_usd_per_day: 0` (teto de gasto diário com o LLM em USD; `0` = ilimitado, o padrão — o custo é registrado e exibido de qualquer forma; é uma guarda best-effort cujo acumulado vive em `.okf/last-batch.json`). Valores inválidos voltam a defaults seguros.

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
