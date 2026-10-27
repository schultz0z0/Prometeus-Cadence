# 07C.2 — Conectores de cliente e agenda/CRM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the native execution chosen by the user. Follow tasks in order; perform a fresh final review at execution time under the applicable execution skill. This session authors plans only.

**Goal:** Conectores de cliente e agenda/CRM; requisitos R16 do PRD.
**Architecture:** Evoluir serviços do monólito com os contratos da área; reutilizar autoridade, banco, jobs, ledger e eventos existentes. Novas interfaces listadas são contratos planejados, não funções já implementadas.
**Tech Stack:** Next 16.4.2, React 19.3.1, TypeScript 5.9.3, PostgreSQL/pg, Zod e node:test existentes; navegador de QA já disponível para UI.
**Spec:** [desenho da área](../specs/2026-10-27-prometeus-cadence-integrations-design.md), [PRD](../specs/2026-10-27-prometeus-cadence-complete-prd.md), [contratos comuns](../specs/2026-10-27-prometeus-cadence-technical-contracts.md).

## Global Constraints

- Pacote planejado; não marcado concluído. Dependências: 07C.1. Ordem vigente no índice geral;07D só executa produto após seu gate.
- Apify/LLM centrais; contexto, canais, dados, cache, quota e resultados privados por workspace. Sem autoelevação de owner a admin da plataforma.
- Preservar trial de 7 dias, consumo pré-pago e OpenWA 20 mensagens/5 novoscontatos por dia; intervalo 60–180 s e demais gates existentes.
- Fidelidade ao CadenceFlow por rota/estado/viewport; não criar outra estética. Estados da referência não observados permanecem classificados.
- Mutações revisadas/idempotentes; I/O incerto não autoriza repetição. Piloto/cobrança/envio externo exigem contas/ações próprias autorizadas, não são iniciados por este plano.

## Review Focus

1. callbackstate deoutro tenant/expirado/used rejeita e 0 conexões; refreshrevogado impede sync
2. retrySheets/CRM não duplica linha/negócio e preserva ediçãohumana; schema externo mudado gera erro reparável
3. 2 reservasmesmoslot:1 sucesso 1 conflict; timeout pós-criação reconcilia pororiginid sem 2 eventos
4. revogação antes I/O/result cancela efeito pendente; plataforma não empresta conexãoApollo de outro workspace
5. credentialRef expirado, consumido ou de outro usuário/workspace/kind retorna 403/409 e 0 conexões; mapping com campo inexistente 422; cancelarreserva duplicado 1 efeito remoto
6. A chamada HTTP/SQL direta e a revogação durante I/O não podem ampliar autoridade; resposta/log/evidência não incluem segredos nem conteúdo de outro workspace.

## File Structure

- Create: `src/domain/connector-capabilities.ts`.
- Create: `src/server/integrations/connectors/contracts.ts`.
- Create: `src/server/integrations/connectors/sheets.ts`.
- Create: `src/server/integrations/connectors/crm.ts`.
- Create: `src/server/integrations/connectors/apollo.ts`.
- Create: `src/server/integrations/connectors/calendar.ts`.
- Create: `src/server/integrations/connectors/meetings.ts`.
- Create: `src/server/integrations/connections.ts`.
- Create: `src/app/api/integration-oauth/[provider]/callback/route.ts`.
- Create: `src/app/api/integrations/[id]/sync/route.ts`.
- Create: `src/app/api/integrations/credentials/route.ts`.
- Create: `db/migrations/095-customer-connectors.sql`.
- Create: `tests/07c2-customer-connectors.test.ts`.
- Create: `tests/integration/07c2-customer-connectors.test.ts`.
- Modify: `src/modules/settings/reference-integrations.tsx`.
- Modify: `src/modules/settings/meetflow-preview.tsx`.
- Modify: `src/server/prospecting/providers/apollo.ts`.
- Modify: `src/server/prospecting/config.ts`.
- Modify: `src/server/channels/crypto.ts`.
- Modify: `src/app/api/integrations/route.ts`.
- Modify: `src/server/integrations/http.ts`.
- Modify: `scripts/test-integration.mjs`.
- Evidence: `docs/validation/07c2-customer-connectors.md` e `docs/validation/evidence/07c2-customer-connectors/` com relatório/manifest/capturas mascaradas. Não gerar evidência de sucesso antes de executar.

## Interfaces e dados

Consome Principal/withWorkspaceTransaction/requirePermission/AppError atuais; Reviewed/Confirm/EvidenceRef/EffectResult conforme contratos comuns quando aplicáveis. A API de frontend não recebePrincipal do cliente. Reusar um serviço existente com assinatura equivalente via adaptação explícita antes de criar duplicação.

```ts
type ConnectorInput={kind:"sheets"|"crm"|"apollo"|"calendar"|"meetings",name:string,credentialRef:string,expectedRevision:number};
type ConnectionView={id:string,kind:string,state:string,capabilities:string[],revision:number};
type SlotQuery={connectionId:string,from:string,to:string,timezone:string};
type CalendarSlot={id:string,start:string,end:string,available:boolean};
type SlotReservation={connectionId:string,slotId:string,conversationId:string,requestId:string};
type ConnectorMapping={connectionId:string,expectedRevision:number,destinationId:string,fieldMap:{sourceField:string,targetField:string}[],events:string[]};
type CalendarReservationView={id:string,connectionId:string,slotId:string,externalId:string|null,state:"prepared"|"accepted"|"uncertain"|"cancelled",revision:number};
declare function connectIntegration(p:Principal,input:ConnectorInput):Promise<ConnectionView>;
declare function syncIntegration(p:Principal,input:{connectionId:string;requestId:string}):Promise<EffectResult>;
declare function readCalendarSlots(p:Principal,input:SlotQuery):Promise<CalendarSlot[]>;
declare function reserveCalendarSlot(p:Principal,input:SlotReservation):Promise<EffectResult>;
declare function storeConnectorSecret(p:Principal,input:{kind:string;secret:string}):Promise<{credentialRef:string;expiresAt:string}>;
declare function prepareConnectorAuthorization(p:Principal,input:{kind:string;returnTo:string;requestId:string}):Promise<{authorizationUrl:string;stateId:string}>;
declare function saveConnectorMapping(p:Principal,input:ConnectorMapping):Promise<Versioned<ConnectorMapping>>;
declare function cancelCalendarReservation(p:Principal,input:{reservationId:string;requestId:string;expectedRevision:number}):Promise<EffectResult>;
```

**Entrada HTTP/CLI:** POST /api/integrations {kind,action:prepare-connect|confirm-connect|mapping,...}; callbackOAuthstate+PKCEquando suportado; POST /api/integrations/:id/sync; disconnect/revoke via 07C.1

**Persistência:** integration_connection, integration_mapping, integration_cursor, calendar_reservation; escopo/revisão/epoch por conexão; UNIQUE(workspace_id,connection_id,external_key) Migração reservada`db/migrations/095-customer-connectors.sql`; não editar 001–082 aplicadas.

### Task 1: Contrato de domínio e persistência autorizada

**Files:** `src/domain/connector-capabilities.ts`, `tests/07c2-customer-connectors.test.ts`, `db/migrations/095-customer-connectors.sql`; DTOs deste plano pertencem ao domínio do pacote.

**Interfaces:** Produz `connectorActionAllowed(input:{action:string;capabilities:string[];connected:boolean}):boolean` e os DTOs acima. Consome os contratos comuns e formatos existentes da área.

- [ ] **Step 1 — RED:** criar `tests/07c2-customer-connectors.test.ts` com o caso abaixo e variações de limite/ausência. Conexão de leitura não autoriza gravar uma reunião.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorActionAllowed} from '../src/domain/connector-capabilities.ts';
test('07C.2 preserva a regra do domínio',()=>{
  assert.deepEqual(connectorActionAllowed({"action":"calendar.reserve","capabilities":["calendar.read"],"connected":true}),false);
});
```

- [ ] **Step 2 — confirmar RED:** `rtk proxy node --experimental-strip-types --test tests/07c2-customer-connectors.test.ts`. Esperado: teste falha pela função/regra ausente; corrigir antes erros de fixture/sintaxe que mascarem a regra.
- [ ] **Step 3 — implementar:** definir os tipos e a função acima. Criar migração com tabelas/índices/FKs descritos, RLS forçada por workspace, funções worker mínimas e idempotência transacional; não conceder escrita ampla ao dispatcher. Contrato Connector com read/upsert/slots/reserve apenas capacidades concedidas. Sheets export idempotente por leadId em coluna técnica, mapear campos e cursores. CRM upsert com originId sem sobrescrever campos humanos sem mapeamento. Apollo por conta do cliente quando conexão habilitada; preservar env central legado só em migração auditada, sem exigir chave Apify/LLM ao cliente. Agenda base Google Calendar OAuth e clock/timezone com lock local+id externo/reconciliação. CRM/reuniões só adaptador oficial documentado disponível; MeetFlow não é produto novo. Credenciais de conta criptografadas por workspace, callbacks não retornam tokens. Primeiro acesso: OAuth exige channels.manage/workspace.settings e origem/returnTo allowlisted; state+PKCE TTL10 min, uso único e vínculo usuário/workspace/provedor. APIkey entra somente POST /api/integrations/credentials (HTTPS, same-origin, segredo não logado), criptografada; credentialRef opaco TTL10 min, mesmo usuário/workspace/kind, consumo único. connectIntegration só resolve esse registro interno e nunca aceita chave ou referência de outro cliente. Callbacks guardam refresh/access no mesmo namespace. Mapping permite somente campos do Lead/contexto declarados, sem expressão/código e com validação de campo obrigatório. SlotId é token opaco por conexão/intervalo/fuso, TTL5 min; reservar relê disponibilidade. Cancelamento usa reservationId local, autoridade, revisão e remoteId guardado; caso incerto consulta antes de dizer cancelado. GoogleCalendar usa OAuth read-only+events conforme ação; Sheets usa conta própria e escopos mínimos de destino escolhido, cada grant informado na revisão. CRM/Apollo/reuniões usam authmode documentado no perfil; sem contrato o conector permanece indisponível.
- [ ] **Step 4 — GREEN e commit:** repetir exatamente o comando RED até passar; conferir tipos/contratos e commit local focado, sem push/deploy implícito.

### Task 2: Serviço, execução e invariantes de falha

**Files:** `src/server/integrations/connectors/contracts.ts`, `src/server/integrations/connectors/sheets.ts`, `src/server/integrations/connectors/crm.ts`, `src/server/integrations/connectors/apollo.ts`, `src/server/integrations/connectors/calendar.ts`, `src/server/integrations/connectors/meetings.ts`, `src/server/integrations/connections.ts`, `src/app/api/integration-oauth/[provider]/callback/route.ts`, `src/app/api/integrations/[id]/sync/route.ts`, `src/app/api/integrations/credentials/route.ts`, `tests/integration/07c2-customer-connectors.test.ts`, `scripts/test-integration.mjs` e serviços existentes da área listados em Modify.

**Interfaces:** Consome DTOs/identidade e o resultado da Task 1; produz exatamente as funções de serviço declaradas neste plano. Dependências externas devem ser injetáveis nos testes, sem substituir autoridade real do banco.

- [ ] **Step 1 — RED de integração:** adicionar `07c2-customer-connectors` à allowlist do runner. Reaproveitar fixtures de identidade/bancos/fechamento em tests/integration/helpers.ts e helpers da área; criar 2 workspaces e papéis próprios, sem usar contas/dados reais. Escrever os testes abaixo com contagens/estados/efeitos observáveis.

  - Caso 1: callbackstate deoutro tenant/expirado/used rejeita e 0 conexões; refreshrevogado impede sync.
  - Caso 2: retrySheets/CRM não duplica linha/negócio e preserva ediçãohumana; schema externo mudado gera erro reparável.
  - Caso 3: 2 reservasmesmoslot:1 sucesso 1 conflict; timeout pós-criação reconcilia pororiginid sem 2 eventos.
  - Caso 4: revogação antes I/O/result cancela efeito pendente; plataforma não empresta conexãoApollo de outro workspace.
  - Caso 5: credentialRef expirado, consumido ou de outro usuário/workspace/kind retorna 403/409 e 0 conexões; mapping com campo inexistente 422; cancelarreserva duplicado 1 efeito remoto.

  - Caso de autoridade: endpoint direto/worker com usuário removido ou recurso cruzado retorna 403/404, publica 0 resultados para o cliente e não expõe segredo. Receipts técnicos já recebidos ficam só no escopo autorizado.

- [ ] **Step 2 — confirmar RED:** `rtk proxy node scripts/test-integration.mjs 07c2-customer-connectors`. Esperado: falha pela regra de serviço ainda ausente; banco criado pelo runner é efêmero _test, nunca o banco operacional.
- [ ] **Step 3 — implementar serviço:** usar as assinaturas declaradas, validação Zod, transações/locks/leases e deduplicação. Contrato Connector com read/upsert/slots/reserve apenas capacidades concedidas. Sheets export idempotente por leadId em coluna técnica, mapear campos e cursores. CRM upsert com originId sem sobrescrever campos humanos sem mapeamento. Apollo por conta do cliente quando conexão habilitada; preservar env central legado só em migração auditada, sem exigir chave Apify/LLM ao cliente. Agenda base Google Calendar OAuth e clock/timezone com lock local+id externo/reconciliação. CRM/reuniões só adaptador oficial documentado disponível; MeetFlow não é produto novo. Credenciais de conta criptografadas por workspace, callbacks não retornam tokens. Primeiro acesso: OAuth exige channels.manage/workspace.settings e origem/returnTo allowlisted; state+PKCE TTL10 min, uso único e vínculo usuário/workspace/provedor. APIkey entra somente POST /api/integrations/credentials (HTTPS, same-origin, segredo não logado), criptografada; credentialRef opaco TTL10 min, mesmo usuário/workspace/kind, consumo único. connectIntegration só resolve esse registro interno e nunca aceita chave ou referência de outro cliente. Callbacks guardam refresh/access no mesmo namespace. Mapping permite somente campos do Lead/contexto declarados, sem expressão/código e com validação de campo obrigatório. SlotId é token opaco por conexão/intervalo/fuso, TTL5 min; reservar relê disponibilidade. Cancelamento usa reservationId local, autoridade, revisão e remoteId guardado; caso incerto consulta antes de dizer cancelado. GoogleCalendar usa OAuth read-only+events conforme ação; Sheets usa conta própria e escopos mínimos de destino escolhido, cada grant informado na revisão. CRM/Apollo/reuniões usam authmode documentado no perfil; sem contrato o conector permanece indisponível. Não ampliar permissões para fazer teste passar. Task 2 cobre todos os itens de Review Focus; nenhum caso fica delegado apenas à observação visual.
- [ ] **Step 4 — GREEN e commit:** repetir a suíte focada; comparar os efeitos reais no banco/adapter com asserções e confirmar 0 efeitos inesperados. Commitar apenas os arquivos do pacote.

### Task 3: HTTP, UI/UX e aceite do pacote

**Files:** rotas/clientes novos listados na estrutura, `src/modules/settings/reference-integrations.tsx`, `src/modules/settings/meetflow-preview.tsx` e relatório de validação do pacote.

**Interfaces:** Consome serviços da Task 2 e expõe os mesmos estados ao usuário, sem simular resultado nem autorização no browser. Se 07D for excluído, não criar superfícies deproduto e registrar a decisão como entrega do gate.

- [ ] **Step 1 — RED de contrato HTTP:** acrescentar à suíte focada pedido anônimo 401/403, papel proibido 403, input inválido 422, revisão conflitante 409 e repetição idempotente quando houver mutação; para avaliadorCLI, manifesto incompleto retorna exitcode nãozero e relatório de pendências. Confirmar falha antes do handler/avaliador.
- [ ] **Step 2 — ligar operações:** POST /api/integrations {kind,action:prepare-connect|confirm-connect|mapping,...}; callbackOAuthstate+PKCEquando suportado; POST /api/integrations/:id/sync; disconnect/revoke via 07C.1 Conectar→permissões→escolherdestino→mapear→revisar→estado/histórico, com desconexão real; estados nãoobservados são contrato próprio. Conta admin de fonte nunca aparecepara cliente. Gates de menu são só apresentação; serviço continua autoritativo. Estados de erro/loading/empty/partial/revoke e limites têm ação de recuperação e não apagam rascunho.
- [ ] **Step 3 — conferir visual e jornada:** `/settings/apps`, `/settings/apps/google-sheets`, `/settings/apps/funnelsflow`, `/settings/apps/apollo`, `/settings/apps/meetflow`. Comparar com evidência disponível da referência no mesmo estado em 1920×855/390×844; checar 320 px, foco/escape/scroll, loading/falha/limite/sucesso. Mascarar dados e restaurar contexto de navegação/QA. Registrar desconhecidos da referência em separado.
- [ ] **Step 4 — verificação e aceite:** focados GREEN → `rtk proxy npm test` → `rtk proxy npm run test:integration` → `rtk proxy npm run build` → `rtk proxy npm run typecheck` → `rtk proxy git diff --check`. Todos passam ou o pacote fica pendente com falha reproduzível. No pacote puramente documental/gate excluído, rodar validador de documentos/links e suíte focada correspondente, sem testes de produto não alterado.
- [ ] **Step 5 — fechamento:** escrever relatório com casos, evidências/limitações, cleanupQA, restore de políticas/destinos, custos/saldo quando aplicável e estado de runtime. Revisão final conforme execução nativa; corrigir achados com regressão. Atualizar linha do índice/roadmap somente pelo aceite efetivo e commit local focado.

## Gate externo e critério específico

CRM/MeetFlow/Apollo/Calendar exigem documentação oficial, credenciais próprias e acesso real. Sem contrato: registrar barreira e alternativa equivalente antesativar; não imitar sucesso. UsoGoogleCalendar é decisão técnica, não observação do backendCadenceFlow.

## Self-review do plano

R16 mapeados às três tarefas. DTOs e funções têm uma definição neste plano e no desenho de área; contratos comuns evitam reinterpretar autorização/revisão. Task 1 cobre regra pura/persistência;Task 2 cobre todos os itens de Review Focus;Task 3 cobre o que a pessoa realmente consegue operar e ver. Dados/arquivos citados como Create são futuros; Modify foi conferido no baseline ou tem pacote anterior proprietário. Escrever um plano não equivale a passar seus testes.
