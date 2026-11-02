# 07C.1b — API pública com chaves escopadas

Data: 02/11/2026. Estado: concluído local/controlado após revisão independente ([revisão](07c1b-public-api-review.md)). [Plano do pacote](../superpowers/plans/2026-11-02-prometeus-cadence-07c1b-public-api.md). Fecha o 07C.1 junto com o [07C.1a](07c1a-webhooks.md). Não é aceite de produção pública.

## Contrato entregue

- **Chaves de API**, na página "Webhooks e API" (seção "API de leitura", desenho próprio, porque a referência não mostra chaves):
  - nome e escopos `leads:read` e `events:read`;
  - o token `pcak_…` tem 256 bits e aparece uma vez; o banco guarda só o SHA-256;
  - gerar uma nova chave desativa a anterior na hora, e revogar é definitivo; as duas ações pedem confirmação;
  - limite de 10 chaves ativas; somente proprietário ou administrador gerencia.
- **Autenticação:** só o cabeçalho `Authorization: Bearer`; o cookie de sessão nunca vale.
  - A chave age como o seu criador, que precisa continuar proprietário ou administrador; a checagem é refeita na mesma transação da leitura.
  - Sem token: 401 com `WWW-Authenticate: Bearer`. Token inválido, revogado ou sem dono ativo: 401 com `error="invalid_token"`. Escopo ausente: 403.
  - Acima de 120 requisições por minuto por chave: 429 com `Retry-After`. Chamadas sem o escopo também contam.
- **Endpoints, somente leitura:**
  - `GET /api/v1/leads?list&cursor&limit`: lista de leads (foto atual, não um feed de mudanças), em ordem de criação.
  - `GET /api/v1/events?cursor&limit`: eventos `lead.created`, `lead.qualified` e `lead.connected` dos últimos 30 dias, com `idempotencyKey`, `listId` e `channel`. Só aparecem depois de 60 s, para um commit atrasado não ser pulado pelo cursor.
  - As duas respostas sempre devolvem `nextCursor` (também na última página, para retomar) e `hasMore`, com índices próprios.
- **Gravação de eventos:** também acontece para chaves com `events:read` em uso (usadas ou criadas nos últimos 7 dias) cujo criador ainda é proprietário ou administrador. Uma chave esquecida não guarda cópias. O diálogo avisa que esses eventos ficam 30 dias.
- **Escrita pela API:** fora deste pacote; comandos revisados ficam para o 07C.3/MCP.

## Validação executada

- **Unitários:** 4/4 no arquivo do 07C (formato do Bearer, escopos e entrada).
- **Integração focada:** 14/14, sendo 8 do 07C.1a e 6 do 07C.1b.
  - token só como digest e listagem sem segredo;
  - paginação de leads e isolamento entre tenants;
  - cookie e token inexistente recebem 401; escopo ausente, 403; limite inválido, 422;
  - geração de nova chave (antiga 401, nova 200) e conflito de revisão;
  - criador rebaixado ou removido recebe 401; revogação;
  - feed de eventos por workspace e 429 com `Retry-After`;
  - gestão só por proprietário ou administrador, limite de 10 e contrato HTTP;
  - atraso de commit, cursor retomável, `listId`/`channel` e `list` recusado em `/events`;
  - chave esquecida não grava eventos; escopo ausente conta no limite; autenticação antes da validação.
- **Suítes completas:** 382/382 unitários; integração com 1 falha: o teste de desempenho do 06C.2 (p95 de leitura, limite de 250 ms) deu 337 ms sob a carga da suíte completa e passou isolado, com 134 ms e 11/11 no arquivo. Esse teste já tinha oscilado antes destas mudanças (262 ms no 07C.1a). Fica registrado como instabilidade de carga para o 08B (carga/produção), não como regressão. Build e tipos exit 0, `git diff --check` limpo.
- **RED:**
  - sem a 096, 5 testes falharam;
  - sem a 096a e o novo `public-api.ts`, os 2 testes da revisão falharam.

## QA no navegador

- Conta descartável `[RE] QA API` com dois leads `[RE]`.
- A chave criada pela interface respondeu 200 com os dois leads. A chamada sem Bearer, com o cookie de sessão presente, recebeu 401.
- "Gerar nova" com confirmação: a chave antiga passou a 401 e a nova a 200.
- Revogar: 401.
- O token só foi visto no banner, fechado antes da captura.
- Na largura medida do painel não houve overflow. A emulação de 320 px não foi aplicada pelo painel, então essa largura ficou sem verificação.

## QA, runtime e custos

- **L-032 removed:** conta e workspace removidos por IDs exatos, sem resíduo.
- **Migrações:** 096/096a aplicadas localmente.
- **Runtime:** sem lane novo.
- **Custo externo:** zero.
- **Entrega:** sem merge, push ou deploy.

## Limites

- O atraso de 60 s cobre transações mais curtas que ele; uma transação mais longa pode chegar depois do cursor. Isso está documentado como entrega eventual.
- A janela de limite é fixa de um minuto: na virada podem passar até 240 requisições.
- `/api/v1/leads` é uma foto ordenada pelo `createdAt` do lead, que pode vir do cliente; para acompanhar mudanças use `/events`.
- Não há documentação pública (OpenAPI) nem exemplos de cliente; fica para o 08B.
