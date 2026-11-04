# EV-295 — MCP autenticado 07C.3a

[obs EV-295] Sessão s33, 04/11/2026. Sem escrita na referência nem chamada a ela. A referência (EV-245, EV-246) mostra `/settings/mcp` com a URL do conector, o login OAuth ("Permitir acesso"), onde adicionar e pedidos prontos.

Páginas locais:
- **`/mcp/authorize`:** consentimento com conta, workspace e permissões.
- **`/settings/mcp`:** URL real, conexões autorizadas e revogação com confirmação.
- **Cliente local no loopback:** registro, código, token, `initialize`, `tools/list` e `tools/call`; depois da revogação, 401.
- **375 px:** sem overflow.

Identidade descartável L-042 (removed): resíduo 0.

[Relatório](../../../validation/07c3a-mcp.md) e [revisão](../../../validation/07c3a-mcp-review.md).
