# Sources

| ID | Title | URL | Type | Read on | Gives |
|---|---|---|---|---|---|
<!-- Example: | SRC-001 | Help center | https://help.example.com | docs | 2026-10-15 | feature tree | -->

| SRC-001 | Actor CNPJ configurado | https://apify.com/bigdavidson/brazil-cnpj-companies | docs | 2026-10-26 | Dados empresariais; e-mail ausente não é contato pessoal |
| SRC-002 | Contrato de entrada CNPJ/QSA | https://apify.com/bigdavidson/brazil-cnpj-companies/input-schema | docs | 2026-10-26 | includePartners; nome/cargo não comprovam celular pessoal |
| SRC-003 | LinkedIn API access | https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access | docs | 2026-10-26 | Produtos/permissões e acesso restrito; OAuth não concede toda capacidade |
| SRC-004 | LinkedIn invitations | https://learn.microsoft.com/en-us/linkedin/shared/integrations/communications/invitations | docs | 2026-10-26 | API restrita a parceiros aprovados |
| SRC-005 | LinkedIn messages | https://learn.microsoft.com/en-us/linkedin/shared/integrations/communications/messages | docs | 2026-10-26 | Parceiros aprovados; ação específica do membro; exclui agendamento automatizado |
| SRC-006 | Comparação de APIs LinkedIn (Unipile, fornecedor) | https://www.unipile.com/best-linkedin-api/ | docs | 2026-11-03 | Conectores de conta enviam convite e mensagem; preço por conta; a API oficial não envia na prática. Fonte com viés comercial |
| SRC-007 | Limites LinkedIn via Unipile | https://www.unipile.com/linkedin-api-rate-limits/ | docs | 2026-11-03 | ~80–100 convites/dia e ~200/semana em conta paga; erro 422 no excesso |
| SRC-008 | Contrato do Usuário LinkedIn e software proibido | https://www.linkedin.com/legal/user-agreement | docs | 2026-11-03 | Proíbe bots e métodos automatizados para adicionar contatos e enviar mensagens; risco de restrição da conta |
| SRC-009 | Unipile Hosted Auth Wizard | https://developer.unipile.com/docs/hosted-auth | docs | 2026-11-03 | Link hospedado (create/reconnect), notify_url com status, account_id e name; não usar iframe; links vencem no restart diário |
| SRC-010 | Unipile account status e GET account | https://developer.unipile.com/docs/account-lifecycle | docs | 2026-11-03 | Estados OK, CREDENTIALS, ERROR/STOPPED, CONNECTING, DELETED; conta com sources[].status e connection_params.im.id |
| SRC-011 | Unipile busca LinkedIn e parâmetros | https://developer.unipile.com/docs/linkedin-search | docs | 2026-11-03 | Busca clássica por IDs (localização, setor), por URL; items com id, network_distance, pending_invitation; paging.total_count e cursor |
| SRC-012 | Unipile convite de usuários | https://developer.unipile.com/docs/invite-users | docs | 2026-11-03 | POST /users/invite com provider_id, account_id e message; contas novas têm convites restringidos pelo LinkedIn |
| SRC-013 | Unipile detecção de convites aceitos | https://developer.unipile.com/docs/detecting-accepted-invitations | docs | 2026-11-03 | Webhook new_relation (até 8 h de atraso) ou leitura periódica de relações, poucas vezes por dia |
| SRC-014 | Unipile envio de mensagens | https://developer.unipile.com/docs/send-messages | docs | 2026-11-03 | POST /chats/{chat_id}/messages em multipart com text; novo chat só com relações (ou InMail) |
| SRC-015 | Unipile leitura de mensagens | https://developer.unipile.com/docs/get-messages | docs | 2026-11-03 | Histórico do chat mais recente primeiro; GET /messages periódico com folga e deduplicação pelo id; webhook em tempo real como alternativa |
