# 07C.3b — MCP: comandos revisados

Data: 04/11/2026. Estado: concluído local/controlado ([revisão](07c3b-mcp-commands-review.md), [plano de execução](../superpowers/plans/2026-11-04-prometeus-cadence-07c3b-mcp-commands-execution.md)). Com o [07C.3a](07c3a-mcp.md), o 07C.3 está completo.

Nenhum cliente real (Claude ou ChatGPT) foi conectado; o fluxo foi exercido com um cliente local no loopback.

## O que o cliente consegue fazer

- **No Claude ou no ChatGPT**, além da leitura do 07C.3a:
  - **Listas e conversas:**
    - `lists_list` (com busca pelo nome) devolve as listas e seus ids;
    - `conversations_list` mostra as conversas recentes, com a última mensagem recebida marcada como conteúdo do contato.
  - **Preparar:** `cadence_prepare`, `qualification_prepare`, `audience_prepare` e `reply_prepare` preparam a ação e devolvem:
    - o resumo, os avisos, os bloqueios, o uso estimado e a validade;
    - o link de revisão no app.
  - **Confirmar e cancelar:** `action_confirm` e `action_cancel` agem sobre as ações preparadas pela própria conexão.
- **Consentimento:**
  - cada permissão tem uma caixa;
  - "Confirmar as ações que ele preparou sem você abrir o Prometeus Cadence (pode gastar créditos)" vem desmarcado e só vale junto com "Preparar".
- **`/mcp/review/<id>`:**
  - mostra o mesmo cartão de proposta do assistente (Revisar, e então Confirmar ou Cancelar);
  - sem login, passa pelo login e volta;
  - com outra conta ou outro workspace ativo, diz que não encontrou a ação e orienta.
- **`/settings/mcp`:**
  - o texto explica os comandos e a confirmação;
  - "Leads novos toda semana, sozinho", "O que responder pra quem respondeu" e "Cadência para uma lista" agora são copiáveis;
  - "Configurar a conta do zero" e "Reescrever uma cadência com tom humano" seguem marcados como ainda não disponíveis.

## Regras executáveis

- **Base:** o MCP não tem caminho de escrita próprio. Cada ação é uma proposta do assistente (06F), validada pelo mesmo allowlist e com a referência conferida sob RLS, e a revisão e a confirmação são os mesmos serviços revisados do app.
- **Nada envia, publica ou ativa:**
  - cadência gera opções;
  - público cria automações pausadas;
  - qualificação cria a execução revisada, que usa créditos pré-pagos;
  - rascunho só guarda o texto e abre a conversa.
- **Escopos:**
  - `messages.read`, `actions.prepare` e `actions.confirm` (opcional);
  - o grant é a interseção entre o pedido do cliente e o que a pessoa marcou, conferida também no banco;
  - "confirmar" sem "preparar" é descartado;
  - sem escolha explícita, "confirmar" fica de fora.
- **Token de confirmação:** só sai no preparo quando a conexão tem `actions.confirm`. Está preso ao conteúdo exato da revisão, e a mesma confirmação repetida devolve o mesmo resultado.
- **Mudanças e falhas:**
  - base alterada dá 409 e pede para preparar de novo;
  - preparo com falha ou bloqueio cancela a proposta.
- **Limites:**
  - 20 ações abertas por conexão;
  - revogar a conexão cancela as abertas;
  - remover o usuário ou a conexão apaga as suas.
- **Papel:** ferramentas cujo escopo ou permissão o papel não tem não aparecem; papel sem permissão vira erro de ferramenta, e a participação perdida vira 403.

## Validação executada

- **Unitários:** 4/4 (escopos, escolha no consentimento, id de confirmação e `next` do login).
- **Integração focada:** 6/6. Cobre:
  - metadados e `tools/list` por escopo;
  - escolha de escopos e pedido adulterado;
  - qualificação: preparar não cria nada, confirmar duas vezes cria 1 execução e 0 envios, base alterada dá 409, lista vazia e lista alheia;
  - sem `actions.confirm`, a resposta não traz token e a confirmação acontece no app;
  - proposta do chat ou de outra conexão fora de alcance;
  - rascunho de resposta com 0 envios, e cancelamento;
  - limite de 20, membro removido, chamada direta ao banco, CHECK de origem e revogação.
- **Regressão do 07C.3a e do 06F:** 9/9 e 16/16 focados, com o padrão de escopos e a nova `lists_list` atualizados nos testes do 07C.3a.
- **Suítes completas:** 424/424 unitários e 603/603 de integração. Build e tipos com exit 0, e `git diff --check` limpo.

## QA no navegador

Conta descartável `[RE] QA MCP Comandos` e lista `[RE] Lista MCP QA` com dois contatos, mais o cliente local e o ouvinte no `127.0.0.1:8787`. Nenhuma chamada externa.
- **Consentimento:**
  - seis caixas, com "Confirmar" desmarcado ([captura](evidence/07c3b-mcp-commands/local-mcp-consent-scopes.jpg));
  - desmarcar "Preparar" desabilita "Confirmar";
  - corrigido no QA: as caixas saíam enormes pelo estilo global de input e passaram a usar o mesmo tratamento do aceite do cadastro.
- **Sem confirmar pelo cliente:**
  - `qualification_prepare` devolveu o resumo "[RE] Lista MCP QA (2 contatos)", o link de revisão e nenhum token;
  - em `/mcp/review/<id>`, Revisar e Confirmar ([captura](evidence/07c3b-mcp-commands/local-mcp-review.jpg)) pararam no gate real de cobrança ("Ative o teste de 7 dias…"), a proposta foi liberada e nenhuma execução foi criada;
  - corrigido no QA: os botões ocupavam a largura toda.
- **Com confirmar pelo cliente:**
  - o token veio com os seis escopos;
  - `action_confirm` devolveu o mesmo gate como erro de ferramenta;
  - `action_cancel` cancelou;
  - `conversations_list` veio vazia, com o aviso.
- **`/settings/mcp`:** pedidos prontos ([captura](evidence/07c3b-mcp-commands/local-mcp-ready-prompts.jpg)).
- **375 px:** sem overflow horizontal na revisão e em `/settings/mcp`.
- **Limpeza (L-043 removed):** resíduo 0, contando propostas, concessões e clientes `[RE]`.

## Limites

- **Clientes reais:** a conexão com Claude e ChatGPT não foi homologada; nada é declarado pronto até um cliente próprio conectar por uma URL pública.
- **Confirmação bem-sucedida:** coberta na integração; no navegador a conta de QA não tinha o teste de 7 dias ativo.
- **Texto de terceiros:** uma conexão com `messages.read` e `actions.confirm` ainda recebe texto escrito por terceiros; veja o risco residual na revisão.
- **Fora do conector:** editar uma cadência existente e configurar a conta do zero.
- **Sem paridade completa:** esta entrega não declara paridade.
- **Entrega:** sem push, merge ou deploy.
