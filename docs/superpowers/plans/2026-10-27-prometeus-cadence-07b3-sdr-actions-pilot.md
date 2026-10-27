# 07B.3 — Agenda, CRM, acompanhamento e piloto SDR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the native execution chosen by the user. Follow tasks in order; perform a fresh final review at execution time under the applicable execution skill. This session authors plans only.

**Goal:** Agenda, CRM, acompanhamento e piloto SDR; requisitos R21 do PRD.
**Architecture:** Evoluir serviços do monólito com os contratos da área; reutilizar autoridade, banco, jobs, ledger e eventos existentes. Novas interfaces listadas são contratos planejados, não funções já implementadas.
**Tech Stack:** Next 16.4.2, React 19.3.1, TypeScript 5.9.3, PostgreSQL/pg, Zod e node:test existentes; navegador de QA já disponível para UI.
**Spec:** [desenho da área](../specs/2026-10-27-prometeus-cadence-sdr-design.md), [PRD](../specs/2026-10-27-prometeus-cadence-complete-prd.md), [contratos comuns](../specs/2026-10-27-prometeus-cadence-technical-contracts.md).

## Global Constraints

- Pacote planejado; não marcado concluído. Dependências: 07B.2, 07C.2, 06C.3. Ordem vigente no índice geral;07D só executa produto após seu gate.
- Apify/LLM centrais; contexto, canais, dados, cache, quota e resultados privados por workspace. Sem autoelevação de owner a admin da plataforma.
- Preservar trial de 7 dias, consumo pré-pago e OpenWA 20 mensagens/5 novoscontatos por dia; intervalo 60–180 s e demais gates existentes.
- Fidelidade ao CadenceFlow por rota/estado/viewport; não criar outra estética. Estados da referência não observados permanecem classificados.
- Mutações revisadas/idempotentes; I/O incerto não autoriza repetição. Piloto/cobrança/envio externo exigem contas/ações próprias autorizadas, não são iniciados por este plano.

## Review Focus

1. doiscontatos pegamslot: umareserva confirmada eoutrareoferta; semdoublebooking
2. timeoutdeagenda apósremoto criauncertain e consultaoriginid, sem segundareserva
3. humano/optout/desativação durantefollowup gera 0 envio e liberareserva
4. piloto próprio comprova ida/volta/approval/handoff/CRM/agenda/dashboard com 1 efeito cada; canalindisponível recebe limite explícito
5. sem consentimento ativo por identidade/canal/finalidade scheduler cria 0 ações; citação inexistente não pode ser confirmada; cancel/CRM têmreview/retry/incerto e proteção de domínio
6. A chamada HTTP/SQL direta e a revogação durante I/O não podem ampliar autoridade; resposta/log/evidência não incluem segredos nem conteúdo de outro workspace.

## File Structure

- Create: `src/domain/sdr-business-action.ts`.
- Create: `src/server/sdr/business-actions.ts`.
- Create: `src/server/sdr/followup.ts`.
- Create: `src/server/sdr/pilot.ts`.
- Create: `scripts/smoke-sdr.ts`.
- Create: `db/migrations/104-sdr-business-actions.sql`.
- Create: `tests/07b3-sdr-actions-pilot.test.ts`.
- Create: `tests/integration/07b3-sdr-actions-pilot.test.ts`.
- Modify: `src/server/integrations/connectors/calendar.ts`.
- Modify: `src/server/integrations/connectors/crm.ts`.
- Modify: `src/server/sdr/worker.ts`.
- Modify: `src/modules/sdr/conversation-controls.tsx`.
- Modify: `src/server/sdr/http.ts`.
- Modify: `scripts/test-integration.mjs`.
- Evidence: `docs/validation/07b3-sdr-actions-pilot.md` e `docs/validation/evidence/07b3-sdr-actions-pilot/` com relatório/manifest/capturas mascaradas. Não gerar evidência de sucesso antes de executar.

## Interfaces e dados

Consome Principal/withWorkspaceTransaction/requirePermission/AppError atuais; Reviewed/Confirm/EvidenceRef/EffectResult conforme contratos comuns quando aplicáveis. A API de frontend não recebePrincipal do cliente. Reusar um serviço existente com assinatura equivalente via adaptação explícita antes de criar duplicação.

```ts
type SdrBookingInput={threadId:string,calendarConnectionId:string,slotId:string,expectedRevision:number};
type SdrFollowupPolicy={maxAttempts:number,minDelayHours:number,requiresConsent:true};
// defaults próprios maxAttempts2,minDelayHours24, combinados com limitemaisrestritivo deconta/canal
type SdrCancellation={threadId:string,reservationId:string,expectedRevision:number};
type SdrCrmInput={threadId:string,connectionId:string,leadId:string,fieldMapVersion:number,expectedRevision:number};
type FollowupConsent={threadId:string,identityId:string,channel:"WHATSAPP"|"EMAIL"|"LINKEDIN",inboundId:string,quote:string,purpose:"conversation-followup",expiresAt:string};
declare function prepareSdrBooking(p:Principal,input:SdrBookingInput):Promise<Reviewed<SdrBookingInput>>;
declare function confirmSdrBooking(p:Principal,input:Confirm<SdrBookingInput>):Promise<EffectResult>;
declare function runSdrFollowupTick(input:{limit:number;signal:AbortSignal}):Promise<{queued:number;blocked:number}>;
declare function cancelSdrBooking(p:Principal,input:Confirm<SdrCancellation>):Promise<EffectResult>;
declare function prepareSdrCancellation(p:Principal,input:SdrCancellation):Promise<Reviewed<SdrCancellation>>;
declare function prepareSdrCrm(p:Principal,input:SdrCrmInput):Promise<Reviewed<SdrCrmInput>>;
declare function confirmSdrCrm(p:Principal,input:Confirm<SdrCrmInput>):Promise<EffectResult>;
declare function recordSdrFollowupConsent(p:Principal,input:FollowupConsent):Promise<{id:string;active:boolean}>;
```

**Entrada HTTP/CLI:** POST /api/sdr/conversations/:id/{prepare-booking,confirm-booking,cancel-booking,prepare-crm,confirm-crm}; atividadesplanejadas via /api/sdr/actions, limitadas aos mesmosserviços

**Persistência:** sdr_business_action, sdr_followup; UNIQUE(workspace_id,thread_id,action_key); vincular operação externa reservada/confirmada/uncertain; sdr_followup_consent com origem inbound/citação, finalidade, canal, identidade, versão de política, validade/revogação e ação humana responsável Migração reservada`db/migrations/104-sdr-business-actions.sql`; não editar 001–082 aplicadas.

### Task 1: Contrato de domínio e persistência autorizada

**Files:** `src/domain/sdr-business-action.ts`, `tests/07b3-sdr-actions-pilot.test.ts`, `db/migrations/104-sdr-business-actions.sql`; DTOs deste plano pertencem ao domínio do pacote.

**Interfaces:** Produz `sdrFollowupAllowed(input:{consented:boolean;humanOwned:boolean;optedOut:boolean;channelWindowOpen:boolean}):boolean` e os DTOs acima. Consome os contratos comuns e formatos existentes da área.

- [ ] **Step 1 — RED:** criar `tests/07b3-sdr-actions-pilot.test.ts` com o caso abaixo e variações de limite/ausência. FollowupSDR não contorna janela do canal nem agenda humana.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {sdrFollowupAllowed} from '../src/domain/sdr-business-action.ts';
test('07B.3 preserva a regra do domínio',()=>{
  assert.deepEqual(sdrFollowupAllowed({"consented":true,"humanOwned":false,"optedOut":false,"channelWindowOpen":false}),false);
});
```

- [ ] **Step 2 — confirmar RED:** `rtk proxy node --experimental-strip-types --test tests/07b3-sdr-actions-pilot.test.ts`. Esperado: teste falha pela função/regra ausente; corrigir antes erros de fixture/sintaxe que mascarem a regra.
- [ ] **Step 3 — implementar:** definir os tipos e a função acima. Criar migração com tabelas/índices/FKs descritos, RLS forçada por workspace, funções worker mínimas e idempotência transacional; não conceder escrita ampla ao dispatcher. Sugerir slots do serviço real; confirmar reserva só após resposta do provedor, validar de novo disponibilidade/hash. CRM com campos permitidos, idempotência por origem; nunca dizer agendado antes da aceitação. Followup só com autorização registrada pela conversa/política do cliente, máximo 2 retornos separados>=24 h e parada com humano/optout/resposta. Fora da janela exige template aprovado onde o canal exigir; sem template bloqueia. Piloto transversal contextualiza empresa→responde→qualifica→agenda→CRM→métricasnotificação; cleanup de eventos de teste autorizado. O consentimento é fato separado da inferênciaLLM: proposta followup-consent extrai citação literal de inbound existente, e humano confirma a finalidade/canal/validade na UI. Mensagem genérica ou simples resposta não vira autorização de follow-up. ExpiresAt máximo 30 dias como default próprio; optout/retirada/novo human takeover revogam e impedem scheduler. Ações CRM e cancelar agendamento usam os mesmos princípios prepare/confirm/revisão/epoch do booking. ConfirmSdrCrm delega mapeamento/schema/upsert ao conector 07C.2; cancelSdrBooking delega cancelCalendarReservation e aguarda prova. Proposta é um draft, nunca compromisso aceito no calendário.
- [ ] **Step 4 — GREEN e commit:** repetir exatamente o comando RED até passar; conferir tipos/contratos e commit local focado, sem push/deploy implícito.

### Task 2: Serviço, execução e invariantes de falha

**Files:** `src/server/sdr/business-actions.ts`, `src/server/sdr/followup.ts`, `src/server/sdr/pilot.ts`, `scripts/smoke-sdr.ts`, `tests/integration/07b3-sdr-actions-pilot.test.ts`, `scripts/test-integration.mjs` e serviços existentes da área listados em Modify.

**Interfaces:** Consome DTOs/identidade e o resultado da Task 1; produz exatamente as funções de serviço declaradas neste plano. Dependências externas devem ser injetáveis nos testes, sem substituir autoridade real do banco.

- [ ] **Step 1 — RED de integração:** adicionar `07b3-sdr-actions-pilot` à allowlist do runner. Reaproveitar fixtures de identidade/bancos/fechamento em tests/integration/helpers.ts e helpers da área; criar 2 workspaces e papéis próprios, sem usar contas/dados reais. Escrever os testes abaixo com contagens/estados/efeitos observáveis.

  - Caso 1: doiscontatos pegamslot: umareserva confirmada eoutrareoferta; semdoublebooking.
  - Caso 2: timeoutdeagenda apósremoto criauncertain e consultaoriginid, sem segundareserva.
  - Caso 3: humano/optout/desativação durantefollowup gera 0 envio e liberareserva.
  - Caso 4: piloto próprio comprova ida/volta/approval/handoff/CRM/agenda/dashboard com 1 efeito cada; canalindisponível recebe limite explícito.
  - Caso 5: sem consentimento ativo por identidade/canal/finalidade scheduler cria 0 ações; citação inexistente não pode ser confirmada; cancel/CRM têmreview/retry/incerto e proteção de domínio.

  - Caso de autoridade: endpoint direto/worker com usuário removido ou recurso cruzado retorna 403/404, publica 0 resultados para o cliente e não expõe segredo. Receipts técnicos já recebidos ficam só no escopo autorizado.

- [ ] **Step 2 — confirmar RED:** `rtk proxy node scripts/test-integration.mjs 07b3-sdr-actions-pilot`. Esperado: falha pela regra de serviço ainda ausente; banco criado pelo runner é efêmero _test, nunca o banco operacional.
- [ ] **Step 3 — implementar serviço:** usar as assinaturas declaradas, validação Zod, transações/locks/leases e deduplicação. Sugerir slots do serviço real; confirmar reserva só após resposta do provedor, validar de novo disponibilidade/hash. CRM com campos permitidos, idempotência por origem; nunca dizer agendado antes da aceitação. Followup só com autorização registrada pela conversa/política do cliente, máximo 2 retornos separados>=24 h e parada com humano/optout/resposta. Fora da janela exige template aprovado onde o canal exigir; sem template bloqueia. Piloto transversal contextualiza empresa→responde→qualifica→agenda→CRM→métricasnotificação; cleanup de eventos de teste autorizado. O consentimento é fato separado da inferênciaLLM: proposta followup-consent extrai citação literal de inbound existente, e humano confirma a finalidade/canal/validade na UI. Mensagem genérica ou simples resposta não vira autorização de follow-up. ExpiresAt máximo 30 dias como default próprio; optout/retirada/novo human takeover revogam e impedem scheduler. Ações CRM e cancelar agendamento usam os mesmos princípios prepare/confirm/revisão/epoch do booking. ConfirmSdrCrm delega mapeamento/schema/upsert ao conector 07C.2; cancelSdrBooking delega cancelCalendarReservation e aguarda prova. Proposta é um draft, nunca compromisso aceito no calendário. Não ampliar permissões para fazer teste passar. Task 2 cobre todos os itens de Review Focus; nenhum caso fica delegado apenas à observação visual.
- [ ] **Step 4 — GREEN e commit:** repetir a suíte focada; comparar os efeitos reais no banco/adapter com asserções e confirmar 0 efeitos inesperados. Commitar apenas os arquivos do pacote.

### Task 3: HTTP, UI/UX e aceite do pacote

**Files:** rotas/clientes novos listados na estrutura, `src/modules/sdr/conversation-controls.tsx` e relatório de validação do pacote.

**Interfaces:** Consome serviços da Task 2 e expõe os mesmos estados ao usuário, sem simular resultado nem autorização no browser. Se 07D for excluído, não criar superfícies deproduto e registrar a decisão como entrega do gate.

- [ ] **Step 1 — RED de contrato HTTP:** acrescentar à suíte focada pedido anônimo 401/403, papel proibido 403, input inválido 422, revisão conflitante 409 e repetição idempotente quando houver mutação; para avaliadorCLI, manifesto incompleto retorna exitcode nãozero e relatório de pendências. Confirmar falha antes do handler/avaliador.
- [ ] **Step 2 — ligar operações:** POST /api/sdr/conversations/:id/{prepare-booking,confirm-booking,cancel-booking,prepare-crm,confirm-crm}; atividadesplanejadas via /api/sdr/actions, limitadas aos mesmosserviços Cards deagenda/CRMcomstatusconfirmado/pendente, opçõeshumano/cancelar eáreas detrabalho existentes; não conduzirusuário a endpointtécnico. Gates de menu são só apresentação; serviço continua autoritativo. Estados de erro/loading/empty/partial/revoke e limites têm ação de recuperação e não apagam rascunho.
- [ ] **Step 3 — conferir visual e jornada:** `/sdr`, `/messages/whatsapp`, `/settings/apps`, `/reports`. Comparar com evidência disponível da referência no mesmo estado em 1920×855/390×844; checar 320 px, foco/escape/scroll, loading/falha/limite/sucesso. Mascarar dados e restaurar contexto de navegação/QA. Registrar desconhecidos da referência em separado.
- [ ] **Step 4 — verificação e aceite:** focados GREEN → `rtk proxy npm test` → `rtk proxy npm run test:integration` → `rtk proxy npm run build` → `rtk proxy npm run typecheck` → `rtk proxy git diff --check`. Todos passam ou o pacote fica pendente com falha reproduzível. No pacote puramente documental/gate excluído, rodar validador de documentos/links e suíte focada correspondente, sem testes de produto não alterado.
- [ ] **Step 5 — fechamento:** escrever relatório com casos, evidências/limitações, cleanupQA, restore de políticas/destinos, custos/saldo quando aplicável e estado de runtime. Revisão final conforme execução nativa; corrigir achados com regressão. Atualizar linha do índice/roadmap somente pelo aceite efetivo e commit local focado.

## Gate externo e critério específico

ConcluirSDR exige piloto autorizado; não venderatéaceite. Integraçãoexternanãodisponível épendênciaoperacional, não “testada” poradapterfake.

## Self-review do plano

R21 mapeados às três tarefas. DTOs e funções têm uma definição neste plano e no desenho de área; contratos comuns evitam reinterpretar autorização/revisão. Task 1 cobre regra pura/persistência;Task 2 cobre todos os itens de Review Focus;Task 3 cobre o que a pessoa realmente consegue operar e ver. Dados/arquivos citados como Create são futuros; Modify foi conferido no baseline ou tem pacote anterior proprietário. Escrever um plano não equivale a passar seus testes.
