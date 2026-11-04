# Revisão final — 07C.3b

04/11/2026. A revisão foi feita por um subagente independente, somente leitura, sobre a mudança antes do commit. Não encontrou Critical nem High. Encontrou três Medium e oito Low; foram corrigidos na 107a e no serviço, exceto o L8, que era só o nome de um teste e foi renomeado. As regressões de M1, M2, M3, L1, L2, L3, L6 e L7 falhavam antes da correção.

## O que a revisão confirmou

- **Escopo de cada ação:**
  - `action_confirm` e `action_cancel` só alcançam propostas desta conexão, pelo `grant_id` sob a RLS do dono;
  - uma proposta do chat ou de outra conexão dá 404;
  - confirmar exige `actions.confirm`;
  - o papel é reconferido no banco para cada tipo de ação.
- **Consentimento:** o banco intersecta a escolha com o pedido sob `FOR UPDATE`, então não há corrida entre a leitura e a decisão.
- **Limite de 20:** o `FOR UPDATE` no grant serializa as propostas, e a contagem roda depois da trava.
- **Idempotência:** confirmar duas vezes em paralelo com o mesmo token gera o mesmo `requestId`, que já é deduplicado pelos serviços da execução.
- **Anti-enquadramento:** `/mcp/*` já sai com `DENY` e `frame-ancestors 'none'`.

## Achados e correções

| Achado | Correção | Regressão |
|---|---|---|
| Medium M1: um preparo que falhava (lista vazia, papel) ou tinha bloqueio deixava uma proposta aberta e invisível, contando no limite | O preparo cancela a proposta quando falha ou tem bloqueio; com bloqueio, a resposta não traz `proposalId` | Lista vazia: erro e 0 propostas abertas |
| Medium M2: sem `scopes` no corpo (tela antiga em cache, chamada fora da UI), "Confirmar" entrava no grant | Sem escolha explícita, o escopo opcional fica de fora; a assinatura antiga do banco virou um wrapper que também o exclui | `connect` sem escolha: grant sem `actions.confirm` |
| Medium M3: o texto recebido dos contatos chegava ao modelo pelo escopo de preparar, que não dizia que lia conversas | `conversations_list` passou para o escopo próprio `messages.read`, com o rótulo "Ler as conversas recentes, incluindo o texto que os contatos escreveram"; a ferramenta avisa que é conteúdo e não instrução | Só `messages.read` lista `conversations_list` |
| Low L1: o CHECK de origem passava com os dois campos nulos | `role_ref IS NOT DISTINCT FROM 'assistant'` | Inserir sem origem falha |
| Low L2: propostas MCP não sumiam com a conexão ou o usuário, e revogar não as cancelava | FK para `mcp_grant` e para o usuário, com cascata; revogar cancela as abertas não reivindicadas | Revogar deixa 0 propostas abertas |
| Low L3: o banco não exigia `actions.prepare` para propor nem descartava "confirmar" sem "preparar" | `mcp_propose` exige o escopo; `mcp_decide` descarta `actions.confirm` sem `actions.prepare` | A chamada direta ao banco é recusada; o pedido adulterado vira só `metrics.read` |
| Low L4: remover a assinatura antiga de `mcp_decide` quebrava o consentimento durante o deploy | Wrapper de 4 argumentos sem o escopo opcional | Coberto pela leitura do código |
| Low L5: papel sem permissão voltava como 403 de protocolo, que alguns clientes leem como conexão morta | Volta como resultado `isError`; o 403 fica para participação perdida ou concessão revogada | Coberto pela leitura do código (todos os papéis atuais têm as permissões) |
| Low L6: escolha vazia num pedido já respondido dizia "escolha uma permissão" | Pedido usado ou vencido informa isso primeiro | Pedido usado dá 409 `MCP_REQUEST_USED` |
| Low L7: `lists_list` parava em 50 listas, sem busca | Argumento `query` pelo nome | Busca sem resultado e com resultado |
| Low L8: o nome de um teste do 07C.3a ficou desatualizado | Renomeado | — |

## Risco residual

Uma conexão com `messages.read` e `actions.confirm` ao mesmo tempo ainda recebe texto escrito por terceiros e pode confirmar. Isso é mitigado porque:
- confirmar vem desmarcado e precisa ser escolhido;
- o host pede aprovação para ferramentas que não são só leitura;
- confirmar nunca envia nem ativa nada;
- a qualificação só usa créditos pré-pagos já revisados.
