# EV-296 — Comandos revisados no MCP 07C.3b

[obs EV-296] Sessão s34, 04/11/2026. Sem escrita na referência nem chamada a ela. A referência (EV-245, EV-246) lista pedidos prontos que mudam dados ("Leads novos toda semana", "O que responder pra quem respondeu"), sem mostrar como a confirmação acontece.

Páginas locais:
- **`/mcp/authorize`:** permissões com caixas; "Confirmar" vem desmarcado e só vale com "Preparar".
- **`/mcp/review/<id>`:** o cartão de proposta do assistente (Revisar → Confirmar ou Cancelar). Confirmar parou no gate de cobrança da conta sem teste ativo e liberou a proposta.
- **`/settings/mcp`:** pedidos prontos de público, respostas e cadência copiáveis.
- **Cliente local no loopback:** `lists_list`, `qualification_prepare` (sem token sem o escopo), `action_confirm` (erro do gate de cobrança), `action_cancel` e `conversations_list`.
- **375 px:** sem overflow.

Identidade descartável L-043 (removed): resíduo 0.

[Relatório](../../../validation/07c3b-mcp-commands.md) e [revisão](../../../validation/07c3b-mcp-commands-review.md).
