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

<!-- okf-benchmark: 2026-07-26-e3 -->

### Gate recall@cap — três rodadas pré-registradas, E1 → E3 (2026-07-26)

As três rodadas custaram **US$ 0,00**, e isso é provado pela execução em vez de declarado: o arcabouço
coloca um stub `claude` no início do `PATH`, verifica que esse stub existe, e o stub nunca é executado
(`paidCallTrapInstalled: true`, `paidCallTrapTripped: false`).

Elas medem `recall(N)` — com N concepts no bundle, a fração das 20 perguntas congeladas cujo concept de
resposta sobrevive até o índice que o portão de fato injeta.

> **recall não é taxa de acerto.** Ele só responde «o portão carregou a linha relevante?». Se o modelo
> **usou** aquela linha não há como verificar sem chamadas pagas. Distratores sintéticos dão apenas um
> **limite superior**, então o recall real é menor.

**Condições** — 3 perturbações × 5 níveis × 20 sementes = 300 amostras, 28 s. Quatro caracteres são
acrescentados antes do **`title`** do frontmatter do concept de resposta; corpo, nome de arquivo e
caminho não mudam.

| N | `none` | `front` (`!!! `) **como publicado** | `front` **seguro com aspas** | `back` (`힣힣 `) |
|---|---|---|---|---|
| 24 | 0,400 ± 0,000 | 1,000 ± 0,000 | **0,400** | 0,400 ± 0,000 |
| 50 | 0,277 ± 0,038 | 0,560 ± 0,064 | **0,400** | 0,182 ± 0,044 |
| 100 | 0,247 ± 0,034 | 0,523 ± 0,030 | **0,400** | 0,170 ± 0,025 |
| 200 | 0,250 ± 0,040 | 0,528 ± 0,030 | **0,400** | 0,175 ± 0,026 |
| 400 | 0,262 ± 0,039 | 0,533 ± 0,024 | **0,400** | 0,185 ± 0,024 |

n=20 por célula. O E1 rodou só `none` com um orçamento 11 B menor e produziu
0,400 / 0,277 / 0,245 / 0,248 — uma **condição diferente**, nem melhor nem pior que a tabela acima.

**A coluna `front` como publicada está contaminada, e quem detectou isso foi a guarda dela própria.**
`!!!` é um **indicador de tag** do YAML. Colocado antes de um `title:` *sem aspas*, ele quebra o
frontmatter por completo: o tipo se perde, o texto do link cai para o nome do arquivo e **a descrição
desaparece**, fazendo a linha colapsar de ~700 B para ~30 B. **14 das 20 perguntas congeladas têm
títulos sem aspas.** Ou seja, nessas 14 o experimento mediu não a posição de ordenação, mas a **falha de
parsing** — linha curta deixa entrar muito mais linhas no mesmo orçamento, que é exatamente o
`taken` = 24 e os 263 B de comprimento médio observados em N=24. Refeito com um prefixo seguro com
aspas, `front` colapsa para um **0,400 plano**. `none` e `back` não se movem um dígito sequer, o que
confirma que a correção é neutra e ao mesmo tempo mostra que `힣힣 ` nunca quebrou nada.

**O que sobrevive e o que cai.** Que a ordenação decide a sobrevivência continua de pé: em N=400 o
spread seguro com aspas é 0,400 − 0,185 = **0,215**, ainda **4,3×** o limiar de refutação de 0,05, e o
`back` empurrar o recall de 0,262 para 0,185 é um efeito puro de ordem. **Num sistema com zero sinais de
relevância isso é o resultado esperado, não a descoberta de um bug** — o que é novo é a magnitude. Mas
três magnitudes publicadas não sobrevivem: «quatro caracteres dobram o recall» passa de 2,03× para
**1,53×**; «N=24 vai de 0,400 a 1,000» vira **nenhuma mudança**; e o salto de `cwdIndependent` do E1,
0,000 → 0,967, vira **0,000 → 0,333**. No lugar delas surge um fato novo: **quando os concepts ordenam
para a frente, o recall deixa de depender de N por completo** (0,400 plano numa faixa de 17× no tamanho
do bundle), porque então o que limita a sobrevivência é `taken`, não N.

**A condição de sobrevivência é exatamente `rank < taken`** — um concept sobrevive se e somente se seu
posto de ordenação por título dentro da categoria for menor que o número de linhas que aquela categoria
recebeu. Portanto o recall é uma função **completa** dos vetores rank e `taken` e se decompõe sem
aproximação. Em N=24→50 a componente rank domina (−0,15 a −0,41); em N≥100 ela morre para ~0, um efeito
de piso: o posto médio das respostas (26,9) está muito além de `taken` (10,5), e mais preenchimento não
muda concepts já excluídos. Ressalva publicada junto: a decomposição é **contabilidade, não
causalidade**, e suas componentes dependem da linha de base.

**Duas correções do E3 ao E2 e uma a si mesmo.** O E2 relatou que o recall «sobe monotonicamente» de
N=100 a 400 e deixou a explicação para o E3. Com o n=20 pré-registrado essa subida **não pode ser
estabelecida de forma alguma** — 0 de 12 pares adjacentes são `rising`. A primeira manchete publicada do
E3 concluiu daí que a subida «não existe»; **isso estava errado**, e uma verificação adversarial de
poder estatístico pegou: em n=60 há três pares `rising` (p chegando a 0,00027), e nos três a componente
`taken` carrega 100 % do movimento enquanto a componente rank é exatamente 0. A subida é real, mas **não
substantiva** (IC da mediana = [0,000, 0,000]). O E3 também substituiu a regra `|Δ| ≤ 0,05` do E2 — que
confunde «plano» com «pequeno mas consistente» — por um teste de sinais exato pareado mais um intervalo
de confiança da mediana livre de distribuição, publicando direção e magnitude como dois valores
separados.

**O antigo R3 estava disparando com ruído.** Sua redação era «decrescimento monótono violado → *defeito
do arcabouço* → descartar tudo», mas a implementação comparava médias sem qualquer tratamento de
incerteza, de modo que ±0,005 de ruído de semente o disparava tanto no E1 quanto no E2 — as duas rodadas
saíram no estado autocontraditório de «disparou, mas nada foi descartado». O E3 não afrouxou o limiar;
apontou o critério de volta para o que sua redação diz e mediu integridade diretamente. Nas mesmas 300
amostras o antigo R3 dispara e o novo R3a não.

**No bundle real o viés de ordenação ainda não pode ser estabelecido.** Medido somente em leitura e
emitindo apenas contagens — títulos, descrições, nomes de arquivo e links não saem da medição, e `raw/`
nunca é aberto. A ordenação compara `title.toLowerCase()` com `<`, isto é, **ordem de unidades de código
UTF-16, não colação por localidade**, então um título iniciado em ASCII sempre precede um iniciado em
hangul. Concepts com início ASCII são 65,4 % do bundle e ocupam 70,6 % das vagas do portão — mas com 26
concepts o teste hipergeométrico exato contra uma hipótese nula estratificada dá **p = 0,667**. Isso não
é um resultado. E um lift pequeno também não deve ser lido como «ordenar é inofensivo»: o portão carrega
atualmente **65,4 %** de todos os candidatos, e onde tudo é carregado a ordenação não decide nada (2 de
6 categorias têm zero graus de liberdade). Por categoria a taxa de carga já se separa —
`decisions`/`projects` 1,000, `patterns` 0,500, `references` **0,429**. Um rascunho anterior afirmava
que uma taxa de carga decrescente amplificaria o efeito; **os próprios dados do benchmark refutam
isso**, então a afirmação foi retirada.

**O que ocupa uma vaga é decidido pela ordem e pelo comprimento da linha, não pela relevância.** Cinco
fatores estão confirmados no código: a ordenação sensível a maiúsculas dos nomes de seção de tipo, que
faz `# Subdirectories` sempre preceder `# reference` (`lib/index-gen.mjs:242`) e puxa concepts aninhados
para a frente de sua categoria; dentro de uma seção, a ordem alfabética do **`title`** do frontmatter —
não do nome do arquivo, que é apenas um recurso de reserva quando o parsing falha (`:315`);
`status: deprecated` rebaixado (`:245`); a ordem de percurso das categorias por nome de diretório
(`:227`); e o **comprimento da linha em bytes**, já que uma próxima linha que exceda o orçamento restante
interrompe aquela categoria (`lib/gate.mjs:122`). O portão não contém nenhuma referência a cwd,
atualidade ou à consulta.

**A descoberta é a forma, não o nível.** Das 20 perguntas, 9 sobrevivem com 0 em todos os níveis e 3 com
1,0; as 8 restantes ficam no meio — recall não é binário. O portão preenche em revezamento até o
orçamento acabar; uma categoria termina com 1–3 linhas só porque uma única linha é grande (200–1.030 B
contra um orçamento de índice de ~6.960 B), de modo que toda a carga se esgota em 8–11 linhas.
`references` recebe exatamente uma linha em todos os níveis, então das 8 respostas concentradas ali no
máximo uma pode sobreviver.

**Profundidade de aninhamento (eixo A-2).** 25 concepts fixos, conteúdos idênticos, apenas caminhos mais
profundos:

| Condição | linhas de concept injetadas | links de subdomínio |
|---|---:|---:|
| plano | 28 | 0 |
| 2 níveis | 27 | 0 |
| 3 níveis | 26 | 0 |
| 4 níveis | 25 | 0 |

Cada condição foi medida **uma vez** (n=1, sem repetição de sementes), e nessa única medição perdeu-se
uma linha por nível de profundidade. Quatro pontos não permitem distinguir se o declínio é linear, e
profundidades além de 4 não foram medidas. Contado contra os concepts plantados, 3 níveis é 25 → 23,
**−8,0 %**. A causa é pressão de bytes, não uma travessia de cadeia que falhou: cada segmento de caminho
a mais alonga todas as linhas até que uma seja empurrada para fora do orçamento.

**R2 dispara em todas as rodadas** (`recall(24)` = 0,400 < 0,60). Pela regra de tratamento
pré-registrada, **os valores absolutos de recall não decidem nada** — as tabelas são publicadas e não
movem política alguma.

**Disciplina de medição, e onde ela melhorou.** No E1 os fixtures entraram no git pela primeira vez no
commit do **relatório** — os limiares estavam fixados de antemão, mas o material que de fato determinou
os números não. A partir do E2 os fixtures vão dentro do commit de pré-registro e o smoke impõe uma
desigualdade **estrita** via `git log --diff-filter=A`; apontada ao conjunto de arquivos do E1 ela
produz 3 violações, ou seja, pega o acidente real em vez de aprová-lo. Cada rodada publica os valores já
conhecidos quando seu pré-registro foi escrito, e qualquer aritmética alterada após a medição — o E3
quantizou os deltas de recall na grade de 1/20 porque `0,25 − 0,20 = 0,04999…` enquanto
`0,20 − 0,15 = 0,05000…2` colocava o mesmo movimento de uma pergunta em lados opostos do limite de
equivalência; essa correção eliminou o único veredito `indeterminate` da rodada, ou seja, jogou
**contra** o próprio argumento do relatório, e é divulgada como tal. Em seguida a revisão adversarial
mostrou que a guarda da identidade de sobrevivência era quase tautológica (ela rechamava a mesma função
que estava verificando), e a substituta não circular **disparou em sua primeira execução** — foi assim
que a contaminação de `front` acima foi encontrada. Um defeito em aberto é assumido em vez de preenchido
com suposição: a mesma guarda também dispara em 8 de 100 amostras não perturbadas, e a causa ainda não
foi identificada.

```sh
node test/gate-recall.mjs --e3 --perturb all   # 3 condições × 5 níveis × 20 sementes, ~28 s
node test/gate-recall.mjs --e3 --perturb all --quote-safe-perturb   # o prefixo corrigido
node test/gate-title-distribution.mjs          # distribuição de títulos do bundle real (somente leitura)
node test/gate-recall.mjs --e2 --perturb all   # E2
node test/gate-recall.mjs                      # E1
node test/bench-nesting.mjs                    # eixo de profundidade de aninhamento
node test/smoke.mjs                            # guardas de regressão
```

[Relatório E3](docs/benchmarks/gate-recall-2026-07-26-e3.md) ·
[Pré-registro E3](docs/benchmarks/pre-registration-2026-07-26-e3.md) ·
[Relatório E2](docs/benchmarks/gate-recall-2026-07-26-e2.md) ·
[Pré-registro E2](docs/benchmarks/pre-registration-2026-07-26-e2.md) ·
[Relatório E1](docs/benchmarks/gate-recall-2026-07-26-e1.md) ·
[Pré-registro E1](docs/benchmarks/pre-registration-2026-07-26-e1.md)

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
