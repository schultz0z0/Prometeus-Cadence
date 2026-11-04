# Revisão final — 07C.3a

04/11/2026. A revisão foi feita por um subagente independente, somente leitura, sobre o commit cac182f. Não encontrou Critical nem High; encontrou dois Medium e sete Low, todos corrigidos na 106a. Os testes de regressão de 1, 2, 4, 5, 6 e 8 falhavam antes.

Itens confirmados pela revisão:
- **Autorização:**
  - cliente ou redirect desconhecido dá 400 sem redirecionar;
  - o redirect é exato e só S256 é aceito;
  - o código é de 256 bits, guardado como hash, de uso único com trava, vale 60 s e reusado revoga;
  - na troca, cliente, redirect, PKCE e recurso são conferidos de novo.
- **Tokens:** o refresh é rotativo e reusado revoga; o access é preso ao recurso; há RFC 7009; o token vai só no cabeçalho.
- **Endpoint:** 401 com `resource_metadata`, 403 com `insufficient_scope`, lote e versão recusados, e limite por concessão.
- **Consentimento:**
  - `checkOrigin` e corpo JSON;
  - o workspace vem da sessão e o pedido é de uso único;
  - quem não confirmou o 2FA não autoriza;
  - o `next` do login só aceita `/mcp/authorize?request=<uuid>`.
- **`sessionId` vazio:** só nos tokens MCP e nas chaves de API, sem ampliar autoridade além dos escopos.
- **Isolamento:** as ferramentas usam os mesmos serviços e a RLS do app, e as mensagens de erro saem sem detalhes internos.

| Achado | Correção | Regressão |
|---|---|---|
| Medium: o teto global de registro anônimo deixava qualquer um bloquear todos, e os clientes nunca eram apagados | 20 por hora por endereço e 2.000 no total; clientes sem concessão somem depois de 1 dia | 21º do mesmo endereço dá 429, outro endereço passa, cliente velho é apagado |
| Medium: pedidos de autorização anônimos gravavam sem limite | Até 20 abertos por cliente, apagados ao vencer | 21º volta com `temporarily_unavailable`; vencidos são apagados e o seguinte entra |
| Low/Medium: a tela de consentimento podia ser enquadrada | `X-Frame-Options: DENY` e `frame-ancestors 'none'` em `/mcp/*` e `/login` | Conferido nos cabeçalhos do servidor local |
| Low: consentimento sem troca e concessões paradas apareciam como conexão | Só concessão com token vivo | Consentimento sem troca não aparece; com troca, aparece |
| Low: remover o membro não revogava a concessão | A primeira chamada depois da remoção revoga | Removido: 403; convidado de volta: 401 |
| Low: erro de redirect sem `iss` | `iss` em toda resposta | Conferido no redirect de erro |
| Low: erro de banco na resolução do token escapava sem JSON | Resposta JSON 500 genérica | Coberto pela leitura do código |
| Low: tokens vencidos nunca eram apagados | Apagados a cada rotação | Depois da rotação, nenhum token vencido |
| Low: o nome do cliente é informado por ele mesmo | A tela destaca o endereço de retorno e marca o nome como informado pelo aplicativo | Coberto pela leitura do código |
