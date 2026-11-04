# 07C.3a — MCP autenticado: autorização, transporte e leitura

04/11/2026. Primeira parte do [07C.3](2026-10-27-prometeus-cadence-07c3-mcp.md). O 07C.3 foi dividido como os pacotes anteriores:
- **07C.3a (este):** servidor de autorização OAuth do produto, endpoint MCP, ferramentas de leitura e a página `/settings/mcp` com conexões e revogação.
- **07C.3b:** ferramentas que mudam dados (preparar e confirmar cadência, resposta e qualificação), reaproveitando as propostas revisadas do assistente (06F).

## Referência

EV-245 e EV-246 (`/settings/mcp`) mostram:
- "Opere o CadenceFlow de dentro do Claude ou do ChatGPT, por linguagem natural";
- vídeo de 2 minutos;
- URL DO CONECTOR com "Copiar";
- LOGIN NO CONECTOR: "abre uma tela… clique em Permitir acesso (autenticação OAuth)";
- onde adicionar no Claude e no ChatGPT, com a dica de remover e adicionar de novo;
- quatro pedidos prontos com "Copiar".

A referência não mostra lista de conexões; a lista e a revogação vêm do requisito R17 e do Review Focus.

## Especificação MCP (2025-11-25, consultada nesta execução)

- **Transporte Streamable HTTP:**
  - POST com uma mensagem JSON-RPC; resposta `application/json`; notificação ou resposta do cliente → 202;
  - GET e DELETE → 405;
  - `Origin` inválido → 403;
  - `MCP-Protocol-Version` não suportado → 400 (sem o cabeçalho, assume `2025-03-26`).
  - Versões aceitas: 2025-11-25, 2025-06-18 e 2025-03-26. Lote (array) é recusado.
- **Autorização:**
  - **Metadados:** Protected Resource Metadata (RFC 9728) em `/.well-known/oauth-protected-resource` (também com o caminho `/api/mcp`), e 401 com `WWW-Authenticate: Bearer resource_metadata="…"`. Authorization Server Metadata (RFC 8414) em `/.well-known/oauth-authorization-server`.
  - **PKCE e audiência:** PKCE S256 obrigatório; `resource` (RFC 8707) é ligado ao token, e a audiência é conferida em toda chamada.
  - **Registro de cliente:** registro dinâmico (RFC 7591), que é o caminho usado pelos conectores personalizados do Claude e do ChatGPT. Client ID Metadata Documents ficam como limite registrado.
  - **Refresh:** rotativo para cliente público.
  - **Escopo:** escopo insuficiente → 403 `insufficient_scope`.

## Regras

- **Cliente:**
  - o registro aceita só `redirect_uris` https, ou http em `localhost`/`127.0.0.1` (de 1 a 5);
  - nome até 100 caracteres; `token_endpoint_auth_method: none`;
  - o cliente não tem segredo e não pertence a um workspace.
- **Autorizar:**
  - **Pedido:** `GET /api/mcp/oauth/authorize` valida cliente, `redirect_uri` registrado exato, `response_type=code`, PKCE S256 e `resource` igual à URL do MCP; guarda o pedido por 10 min e leva à tela `/mcp/authorize?request=…`;
  - **`redirect_uri` desconhecido:** mostra o erro e nunca redireciona;
  - **Sem login:** a tela leva ao login e volta.
- **Consentimento:**
  - mostra o cliente, o workspace ativo, a conta e as permissões;
  - "Permitir acesso" e "Recusar" exigem a sessão do app (Origin, 2FA da sessão);
  - o workspace do pedido precisa ser o do Principal;
  - qualquer membro (owner, admin, operador) pode autorizar; o papel continua valendo em cada ferramenta.
- **Escopos (07C.3a):** `contacts.read`, `jobs.read` e `metrics.read`. Sem `scope`, valem os três. Um escopo desconhecido é ignorado. Os escopos que mudam dados chegam no 07C.3b.
- **Tokens:**
  - opacos e aleatórios; o banco guarda só o SHA-256;
  - o código vale 60 s e é de uso único: reusar o código revoga a concessão;
  - o access token vale 15 min, preso à concessão e ao `resource`;
  - o refresh vale 7 dias e é rotativo: reusar um refresh antigo revoga a concessão inteira;
  - a revogação (RFC 7009) ou "Revogar" em Configurações derruba todos os tokens;
  - um usuário removido do workspace faz o token parar na hora.
- **Chamada MCP:**
  - o token vira um Principal (usuário, workspace e papel atuais, sem sessão de navegador), como as chaves de API do 07C.1;
  - limite de 120 chamadas por minuto por concessão;
  - erros JSON-RPC tipados, sem detalhes internos.
- **Ferramentas (07C.3a):**
  - `contacts_search` (`contacts.read`): busca, lista, qualificação e respondeu, até 25 por página. Usa `readContacts`.
  - `jobs_list` (`jobs.read`): execuções recentes e o status. Usa `listJobs`.
  - `metrics_read` (`metrics.read`): métricas de mensagens dos últimos N dias. Usa `readMessageMetrics`.
  - `tools/list` mostra só o que a concessão permite.
- **Página `/settings/mcp`:**
  - estrutura da referência, com a URL real do conector, o login OAuth e onde adicionar;
  - "Conexões autorizadas" (cliente, permissões, autorizada em, último uso) com "Revogar" confirmado;
  - pedidos prontos: os que dependem de comandos do 07C.3b ficam marcados como "chega com os comandos revisados", sem botão de copiar.

## Arquivos

- `db/migrations/106-mcp-authorization.sql` (100 está ocupada): `mcp_client`, `mcp_auth_request`, `mcp_grant`, `mcp_auth_code`, `mcp_token` e funções SECURITY DEFINER.
- `src/domain/mcp-authorization.ts`: escopos, `mcpScopeAllowed`, validação de redirect, PKCE e versões.
- `src/server/mcp/authorization.ts`: registro, pedido, consentimento, token, refresh, revogação e resolução do token.
- `src/server/mcp/tools.ts` e `src/server/mcp/service.ts`: JSON-RPC e ferramentas.
- `src/server/mcp/http.ts`.
- Rotas:
  - `src/app/api/mcp/route.ts`
  - `src/app/api/mcp/oauth/[action]/route.ts`
  - `src/app/api/mcp/connections/...`
  - `src/app/.well-known/oauth-protected-resource/[[...path]]/route.ts`
  - `src/app/.well-known/oauth-authorization-server/route.ts`
- Tela `src/app/mcp/authorize/page.tsx` e o módulo de consentimento.
- `src/modules/settings/reference-settings.tsx` (seção `mcp`).
- `src/domain/registration.ts`: o `next` do login aceita `/mcp/authorize?request=…`.
- Testes: `tests/07c3a-mcp.test.ts` e `tests/integration/07c3a-mcp.test.ts`.

## Testes (RED primeiro)

1. **Escopo, redirect e PKCE:** um escopo de leitura não permite outro; o redirect fora da regra é recusado; o verificador PKCE errado falha.
2. **Fluxo completo:** registro → pedido → consentimento → código → token → `initialize` → `tools/list` → `tools/call`, com dados só do workspace autorizado.
3. **Reuso:** o código reusado revoga; o refresh reusado revoga a concessão; um `redirect_uri` ou `client_id` diferente na troca é recusado; o código vencido é recusado.
4. **Audiência e acesso:** `resource` errado dá 401; o usuário removido dá 403 sem efeito; a revogação em Configurações derruba o access e o refresh.
5. **Consentimento:** um workspace diferente do Principal é recusado; "Recusar" redireciona com `access_denied`.
6. **HTTP:** 401 com `WWW-Authenticate`; GET dá 405; `Origin` estranho dá 403; versão inválida dá 400; o `tools/call` sem escopo dá erro; a lista de conexões e a revogação ficam presas ao workspace e ao papel.
