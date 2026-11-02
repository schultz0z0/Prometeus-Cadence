# 07C.1b — API pública com chaves escopadas

Data: 02/11/2026. Segundo pacote do [plano 07C.1](2026-10-27-prometeus-cadence-07c1-api-webhooks.md), depois do [07C.1a](2026-11-02-prometeus-cadence-07c1a-webhooks.md). A referência não mostra chaves de API nem endpoints públicos: a seção é desenho próprio, no padrão visual da página "Webhooks e API".

## Contrato

- **Chave de API:**
  - nome, escopos (`leads:read`, `events:read`) e prefixo visível;
  - o banco guarda só o digest SHA-256; o token aparece uma vez na criação e na rotação;
  - rotacionar invalida o token anterior na hora e nunca o devolve; revogar invalida para sempre;
  - somente proprietário ou administrador gerencia; limite de 10 chaves ativas por workspace.
- **Autoridade:** `resolveApiPrincipal(token, scope)` resolve o workspace e o criador da chave. A chamada falha (401) quando:
  - a chave foi revogada ou rotacionada;
  - o criador deixou o workspace ou não é mais proprietário/administrador.

  Escopo ausente recebe 403. Cookies de sessão nunca autenticam `/api/v1`.
- **Endpoints, somente leitura:**
  - `GET /api/v1/leads?list&cursor&limit` retorna os leads do workspace, com cursor por chave e limite de até 100;
  - `GET /api/v1/events?cursor&limit` retorna os eventos de integração (`lead.created`, `lead.qualified`, `lead.connected`) dos últimos 30 dias.

  Eventos passam a ser gravados quando há destino ativo **ou** chave ativa com `events:read`.
- **Limite:** 120 requisições por minuto por chave; acima disso, 429 com `Retry-After`.
- **Escrita:** fica fora da API pública neste pacote, sem CRUD livre; comandos de escrita revisados exigem um contrato próprio (07C.3/MCP).

## Persistência

Migração 096: `api_credential` (digest único, escopos, prefixo, criador, uso, revogação) e `api_rate` (janela de um minuto), com RLS de leitura para proprietário e administrador e funções `SECURITY DEFINER` para criar, rotacionar, revogar, resolver e contar uso.

## Testes

- **Unitário:** formato do token, digest, escopos e resposta de limite.
- **Integração:**
  - token desconhecido, revogado ou rotacionado: 401; o token novo funciona;
  - criador removido ou rebaixado: 401; escopo ausente: 403;
  - outro tenant isolado, sem cookie aceito;
  - paginação estável;
  - eventos do próprio workspace;
  - 429 com `Retry-After`;
  - o segredo nunca aparece em listagens.
