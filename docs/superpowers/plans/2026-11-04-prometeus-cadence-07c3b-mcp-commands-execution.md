# 07C.3b — MCP: comandos revisados

04/11/2026. Segunda parte do [07C.3](2026-10-27-prometeus-cadence-07c3-mcp.md), depois do [07C.3a](2026-11-04-prometeus-cadence-07c3a-mcp-execution.md). Reaproveita as propostas revisadas do assistente (06F): o MCP não ganha um caminho de escrita próprio.

## Escopo

- **Escopos novos:**
  - `actions.prepare` — "Preparar ações para você revisar": cadência, qualificação, público com automações pausadas e rascunho de resposta.
  - `actions.confirm` — "Confirmar ações preparadas pelo aplicativo, sem abrir o Prometeus Cadence (pode gastar créditos)".
  - Sem `scope` no pedido valem os cinco, mas a tela de consentimento deixa a pessoa escolher. `actions.confirm` vem desmarcado e só vale junto com `actions.prepare`. O grant é a interseção entre o que o cliente pediu e o que a pessoa marcou; nenhuma marcada é 422.
- **Ferramentas:**
  - `lists_list` (`contacts.read`): listas com id, nome e contagem, para o modelo achar o `listId`.
  - `conversations_list` (`actions.prepare` + `messages.reply`): as conversas mais recentes, com a última mensagem recebida marcada como conteúdo do contato, não instrução.
  - `cadence_prepare`, `qualification_prepare`, `audience_prepare` e `reply_prepare` (`actions.prepare` + a permissão do comando no papel):
    - criam uma proposta `assistant_proposal` com `grant_id`, validada pelo mesmo `commandSchemas` e pela existência da referência sob RLS;
    - preparam a revisão da área com `prepareAssistantAction`;
    - devolvem resumo, avisos, bloqueios, uso estimado, validade e o link de revisão `/mcp/review/<id>`;
    - o token de confirmação só aparece quando a conexão tem `actions.confirm`.
  - `action_confirm` (`actions.confirm`): confirma uma proposta desta mesma conexão com o token da revisão.
    - O `requestId` é derivado de proposta + token, então repetir a chamada devolve o mesmo resultado.
    - Base alterada dá 409 e pede para preparar de novo.
  - `action_cancel` (`actions.prepare`): cancela uma proposta desta conexão.
  - Ferramentas sem escopo, ou cuja permissão o papel não tem, não aparecem em `tools/list`.
  - As de escrita levam `readOnlyHint:false`. `action_confirm` leva `destructiveHint:false` e `idempotentHint:true`, para o host pedir aprovação.
- **Nada envia, publica ou ativa:**
  - cadência gera opções;
  - público cria automações pausadas;
  - qualificação cria a execução revisada, que usa créditos pré-pagos;
  - rascunho só guarda o texto e abre a conversa.
- **Limite:** 20 propostas abertas por conexão; a 21ª devolve erro com orientação.
- **Página `/mcp/review/<id>`:**
  - autenticada, com retorno pelo login e protegida contra framing pelo `next.config`;
  - mostra o mesmo cartão de proposta do assistente (Revisar → Confirmar/Cancelar), na mesma moldura da tela de consentimento;
  - com outra conta ou outro workspace ativo, mostra "não encontramos esta ação" com orientação.
- **`/settings/mcp`:**
  - texto atualizado;
  - pedidos prontos de cadência, público e respostas copiáveis;
  - "Configurar a conta do zero" e "Reescrever uma cadência" continuam marcados como ainda não disponíveis.

## Persistência (107)

- **`assistant_proposal`:**
  - nova coluna `grant_id`;
  - `role_ref` passa a aceitar nulo;
  - CHECK de origem: uma proposta é do chat (`role_ref='assistant'`) ou do MCP (`grant_id` preenchido e `role_ref` nulo). Com `role_ref` nulo, a FK com a mensagem não se aplica (MATCH SIMPLE).
- **`app.mcp_propose(grant,kind,payload,summary)`:**
  - confere a participação e o grant vivo do próprio usuário no workspace;
  - aplica o limite de 20 abertas por conexão;
  - insere com um `request_id` novo.
- **`app.mcp_decide`:** ganha `p_scopes`, a escolha da pessoa, que é intersectada com o pedido. Escolha vazia levanta `MCP_SCOPE_EMPTY` antes de consumir o pedido.

## Testes (RED primeiro)

- **Unitários (`tests/07c3b-mcp-commands.test.ts`):** escopos padrão; `chooseMcpScopes` (interseção, confirmação sem preparação descartada, vazio); `mcpConfirmRequestId` determinístico e UUID válido.
- **Integração (`tests/integration/07c3b-mcp-commands.test.ts`):**
  - `tools/list` por escopo;
  - preparar não cria execução;
  - lista de outro workspace dá erro e nenhuma proposta;
  - confirmar duas vezes cria 1 execução e 0 envios;
  - base alterada dá 409;
  - sem `actions.confirm`, a resposta não traz token;
  - proposta do chat ou de outra conexão não é confirmada pelo MCP;
  - revisão no app de uma proposta MCP;
  - rascunho de resposta com 0 envios;
  - cancelamento;
  - limite de 20;
  - membro removido é recusado;
  - consentimento com escopos escolhidos;
  - `view` só do dono.

## Fora

- Editar cadência existente.
- Configurar a conta do zero.
- Ativar ou publicar pelo MCP.
- Homologação com clientes reais, que depende de URL pública e conta do usuário.

## Ajustes da revisão (107a)

- `conversations_list` saiu de `actions.prepare` e passou para o escopo próprio `messages.read`, que diz que lê o texto escrito pelos contatos.
- Sem escolha explícita no consentimento, `actions.confirm` fica de fora.
- Preparo com falha ou bloqueio cancela a proposta.
- Revogar cancela as propostas abertas da conexão.
- `lists_list` ganhou `query`.
