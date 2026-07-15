# OKF for Claude Code

**Seu agente esquece tudo o que você disse ontem. Isto resolve isso — e a memória
que ele constrói é uma pasta de markdown que pertence a você, não um banco de dados que te prende.**

![licença MIT](https://img.shields.io/badge/license-MIT-blue) ![OKF v0.1](https://img.shields.io/badge/OKF-v0.1%20Draft-4ecdc4) ![somente Node](https://img.shields.io/badge/runtime-Node%20only-5c6bc0) ![sem npm install](https://img.shields.io/badge/dependencies-vendored-66bb6a)

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · **Português**

![Grafo de conhecimento do OKF — conceitos ligados ao código que descrevem](docs/okf-graph.png)

<sub>`/okf:okf-visualize` — seu conhecimento (nós contornados) e sua base de código em um único grafo.
As arestas amarelas tracejadas são o ponto principal: cada conceito ligado aos arquivos-fonte
de que ele realmente trata.</sub>

Toda sessão começa do zero. Você reexplica a mesma decisão de arquitetura, a mesma
política de deploy, o mesmo "já tentamos isso e quebrou" — e no instante em que a
sessão termina, tudo se perde de novo. Enquanto isso, o conhecimento que *teria*
respondido à pergunta está espalhado por wikis, comentários de código e, como diz o
anúncio do OKF do Google, "the heads of a few senior engineers" (nas cabeças de
alguns engenheiros sêniores).

Este plugin fecha esse ciclo automaticamente: captura o que você de fato discutiu,
destila as partes reaproveitáveis em um bundle de conhecimento estruturado e coloca
esse conhecimento de volta diante do modelo no início de cada sessão.

## O formato

O conhecimento é armazenado em **[OKF (Open Knowledge Format)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)** —
uma especificação aberta que o Google Cloud [publicou em junho de 2026](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/?hl=en&utm_source=pytorchkr&ref=pytorchkr)
(v0.1 Draft, Apache-2.0). Ela é deliberadamente sem graça, e é justamente esse o ponto:

> "The format is intentionally minimal: a directory of markdown files with YAML
> frontmatter. There is no schema registry, no central authority, and no required
> tooling. **If you can `cat` a file, you can read OKF; if you can `git clone` a
> repo, you can ship it.**"

O OKF formaliza o padrão de "LLM wiki" que [Andrej Karpathy esboçou](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
dez semanas antes — o anúncio do Google diz isso explicitamente. Desde a publicação,
formou-se em torno dele um [pequeno ecossistema](https://github.com/search?q=%22open+knowledge+format%22&type=repositories)
de geradores, linters, visualizadores e servidores MCP, e o formato também aparece
fora do Google (a AWS tem um [exemplo](https://github.com/aws-samples/sample-okf-llm-wiki)
que serve bancos de dados do Glue como bundles OKF). É cedo — a maior parte desse
ecossistema tem poucas semanas de vida — mas o formato está fazendo o que promete:
ser legível sem as ferramentas de quem o criou.

**Por que um formato e não um produto de memória.** Ferramentas como mem0, Letta, Zep
e Cognee são *runtimes* de memória — você acopla uma biblioteca ou hospeda um serviço,
e sua memória passa a viver no armazenamento vetorial ou em grafo dessa ferramenta.
Elas são outra camada, não concorrentes; algumas delas poderiam armazenar OKF. A
diferença prática é o **custo de saída**: conhecimento embutido em um banco de dados de
grafos só é legível para aquele sistema, enquanto um bundle OKF abre no seu editor,
renderiza no GitHub, aparece no diff de um pull request e é lido por qualquer outro
agente sem etapa de tradução. Este plugin nunca pede que você confie a ele a única cópia.

## O que ele faz

1. **Captura** a conversa completa de cada sessão, sem perdas, quando ela termina.
2. **Comprime** as sessões capturadas em segundo plano (um job em lote oportunista,
   não uma tarefa cron/agendada) usando `claude -p` para extrair conhecimento
   reaproveitável — decisions, project facts, preferences, patterns, references, troubleshooting.
3. **Injeta** um índice desse bundle no contexto de cada nova sessão como um gate
   obrigatório, para que o Claude realmente leia o conhecimento passado relevante antes
   de trabalhar em algo relacionado, em vez de começar do zero toda vez.
4. **Visualiza** o bundle e sua base de código como um único grafo, ligando cada
   conceito aos arquivos de que ele realmente trata (`/okf:okf-visualize`).

Tudo fica em um repositório git local em `~/.claude/okf` (ou
`$CLAUDE_CONFIG_DIR/okf`). Nada é enviado para lugar nenhum. As únicas chamadas de rede
são as que você já faz para a API da Anthropic — a etapa de batch é apenas mais uma
chamada `claude -p`, executada localmente.

## Requisitos

- Claude Code com suporte a plugins
- Node.js (o que o próprio `claude` já exige — nenhum runtime adicional)
- git

Sem etapa de `npm install`. Sem serviços externos. Nenhuma configuração necessária para
começar.

## Instalação

```
claude plugin marketplace add dja1369/okf-system
claude plugin install okf@okf-marketplace
```

(Para instalar a partir de um clone local: `claude plugin marketplace add /path/to/your/clone`.)

É isso — reinicie sua sessão e os hooks de gate/captura estarão ativos. No próximo
início de sessão, o bundle é inicializado automaticamente (um repositório git local é
criado em `~/.claude/okf` com a estrutura base).

Para desinstalar: `claude plugin uninstall okf`. Seus dados em `~/.claude/okf` permanecem
intactos — é um repositório git comum que você pode inspecionar, fazer backup ou apagar
manualmente com `rm -rf ~/.claude/okf`.

## Uso

O uso normal não exige nada de você. A captura e a compressão em lote acontecem
automaticamente. Cinco comandos estão disponíveis para inspeção/controle manual —
**atenção ao prefixo `okf:`**, obrigatório porque são comandos com escopo de plugin:

| Comando | O que faz |
|---|---|
| `/okf:okf-status` | Informa a última execução do batch, as sessões pendentes e o estado do lock |
| `/okf:okf-batch` | Força uma execução imediata do batch (ignora o gate de intervalo, mas ainda respeita o lock) |
| `/okf:okf-config` | Mostra e permite editar a configuração atual |
| `/okf:okf-index` | Imprime uma visão geral legível do bundle — todas as categorias e títulos de conceitos, além das mudanças recentes em `log.md` |
| `/okf:okf-visualize` | Renderiza o bundle + sua base de código como um único grafo interativo (HTML autocontido) |

Uma instalação nova não vem vazia: o bundle já vem semeado com conceitos que descrevem
o próprio OKF, a arquitetura deste plugin e as regras de escrita do bundle — assim o gate
tem algo real para apontar desde a primeira sessão, e o bundle documenta a si mesmo.

## Visualização

O `/okf:okf-visualize` renderiza seu conhecimento e seu código como um único grafo. A parte
interessante não é nenhuma das duas metades — são os links tracejados entre elas,
conectando cada conceito aos arquivos-fonte de que ele realmente fala.

Se o [Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) já tiver
analisado o repositório (`.understand-anything/` ou `.ua/knowledge-graph.json`), esse
grafo mais rico, resumido por LLM, é usado. Caso contrário, o analisador do próprio
plugin constrói um — Node puro, sem módulos nativos, extraindo arquivos, funções, classes
e o grafo de imports em JS/TS, Python, Go, Rust, Java/Kotlin, Ruby, PHP, C/C++, C# e Swift.

A saída é um arquivo HTML autocontido: sem CDN, sem requisições de rede, sem backend. Ele
abre offline, porque abrir sua própria base de conhecimento não deveria telefonar para lugar nenhum.

## Como funciona

![Arquitetura: as sessões são capturadas em raw, um batch em segundo plano destila tudo em um bundle OKF, e o índice do bundle é injetado de volta na sessão seguinte](docs/architecture.svg)

- **A captura** é uma cópia de arquivo pura — sem parsing, sem filtragem, sem limite de
  tamanho. O transcript completo vai para `raw/` a cada `SessionEnd`. Isso é intencional:
  uma base de conhecimento construída sobre uma memória parcial do que aconteceu é pior que nenhuma.
- **A compressão** só acontece no momento do batch, sobre uma cópia temporária — o
  original capturado nunca é tocado. Ela roda com acesso a ferramentas restrito a
  `Read/Glob/Grep/Write/Edit` (sem `Bash`) e com todos os *seus* outros hooks,
  plugins e servidores MCP desativados durante essa única chamada (`--safe-mode`), de
  modo que não consiga entrar em loop capturando a si mesma.
- **O gate** injeta um índice compacto de categorias (não o texto completo dos
  conceitos) mais as mudanças recentes, e instrui o Claude a de fato dar `Read` no
  arquivo relevante antes de mexer em trabalho relacionado — o índice sozinho não basta
  para que ele aja com base em suposições desatualizadas.
- Um linter estrutural mantém o bundle sempre em conformidade com a spec: se uma
  execução do batch deixar qualquer coisa malformada, ela é automaticamente revertida antes do commit.

Veja o [anúncio do Open Knowledge Format](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/?hl=en&utm_source=pytorchkr&ref=pytorchkr) do Google Cloud para o histórico e a justificativa de design do formato — são apenas arquivos
markdown com YAML frontmatter, legíveis por qualquer ferramenta, sem nada específico deste plugin.

## Configuração

Edite `~/.claude/okf/.okf/config.md` diretamente (frontmatter) ou use
`/okf:okf-config`.

| Chave | Padrão | Significado |
|---|---|---|
| `enabled` | `true` | Chave geral de liga/desliga (captura, gate e batch seguem todos ela) |
| `batch_interval_hours` | `1` | Tempo mínimo entre execuções do batch |
| `batch_max_digest_kb` | `600` | Orçamento por execução para o total de bytes de digest — o limite de custo real. Sessões que estouram o orçamento passam para a execução seguinte |
| `batch_max_sessions` | `50` | Apenas um teto de segurança; `batch_max_digest_kb` é o botão que realmente regula |
| `seed_language` | `en` | Idioma dos conceitos semeados no primeiro bootstrap (`en`, `ko`; valores desconhecidos caem para `en`) |
| `batch_model` | `claude-sonnet-5` | Modelo usado na ingestão em lote; vazio = padrão da CLI |
| `batch_effort` | `medium` | Esforço de raciocínio na ingestão em lote (`low`/`medium`/`high`/`xhigh`/`max`); vazio = padrão da CLI |
| `capture_exclude_cwd` | `[]` | Padrões glob de diretórios cuja captura deve ser pulada (apenas opt-out — a captura em si nunca é parcial) |
| `batch_digest_cap_kb` | `150` | Limite de tamanho por sessão para o resumo enviado ao LLM (o original capturado nunca é limitado) |
| `remove_candidate_ttl_days` | `30` | Por quanto tempo os transcripts raw já processados são mantidos antes da exclusão |
| `inject_max_lines` / `inject_max_bytes` | `120` / `16384` | Limites de tamanho da injeção do gate |
| `claude_bin` / `node_bin` | *(vazio)* | Sobrescritas de caminho absoluto caso a resolução do `PATH` falhe no seu ambiente |

## Dados e privacidade

- Tudo permanece local: `~/.claude/okf` é um repositório git comum próprio, totalmente
  separado de qualquer repositório em que você por acaso esteja trabalhando. **Nenhum
  caminho de código deste plugin executa `git push`, `git remote add` ou qualquer coisa
  relacionada a rede nele** — as únicas operações git usadas em qualquer lugar são
  `init`, `commit`, `checkout` e `clean` (verificável: `grep -n "push\|remote" lib/*.mjs bin/*.mjs`
  — os únicos resultados são chamadas `Array.push()` sem relação com isso). Seu bundle
  nunca sai da sua máquina, a menos que você mesmo, deliberadamente, dê `git push` nele.
- A etapa de batch envia o conteúdo da sessão para a API da Anthropic para fazer o
  resumo/extração — a mesma API com que seu uso normal do Claude Code já conversa,
  apenas por meio de mais uma chamada `claude -p`. Nenhum serviço de terceiros está
  envolvido.
- O `raw/` (transcripts completos capturados) e os transcripts já processados que aguardam
  exclusão são ignorados pelo git, não comitados — apenas o bundle de conhecimento extraído é.

## Portabilidade

Nenhum caminho é hardcoded — tudo é resolvido via `os.homedir()` /
`process.env.CLAUDE_CONFIG_DIR` / `process.env.HOME`, de modo que uma instalação nova em
outra máquina ou conta de usuário produz seu próprio bundle independente. Isso é
exercitado pela suíte de testes (`test/smoke.mjs`, 78 cenários) em sandboxes isolados de
`HOME`/`CLAUDE_CONFIG_DIR`, incluindo um **sem nenhuma identidade git configurada** — o
plugin nunca depende do seu `user.name`/`user.email`; seus próprios commits automatizados
sempre usam uma identidade sintética fixa
(`OKF Batch <okf-batch@localhost>`). macOS e Linux são exercitados assim
diretamente; os caminhos específicos do Windows (`shell:true` para `claude.cmd`,
separadores de caminho) estão implementados conforme os requisitos do documento de design,
mas ainda não foram executados em uma máquina Windows real — trate essa combinação como
não verificada até que alguém confirme.

## Licença

MIT
