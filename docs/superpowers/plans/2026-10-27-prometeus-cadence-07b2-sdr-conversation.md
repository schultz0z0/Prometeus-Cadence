# 07B.2 — Atendimento, memória e intervenção humana SDR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the native execution chosen by the user. Follow tasks in order; perform a fresh final review at execution time under the applicable execution skill. This session authors plans only.

**Goal:** Atendimento, memória e intervenção humana SDR; requisitos R20 do PRD.
**Architecture:** Evoluir serviços do monólito com os contratos da área; reutilizar autoridade, banco, jobs, ledger e eventos existentes. Novas interfaces listadas são contratos planejados, não funções já implementadas.
**Tech Stack:** Next 16.4.2, React 19.3.1, TypeScript 5.9.3, PostgreSQL/pg, Zod e node:test existentes; navegador de QA já disponível para UI.
**Spec:** [desenho da área](../specs/2026-10-27-prometeus-cadence-sdr-design.md), [PRD](../specs/2026-10-27-prometeus-cadence-complete-prd.md), [contratos comuns](../specs/2026-10-27-prometeus-cadence-technical-contracts.md).

## Global Constraints

- Pacote planejado; não marcado concluído. Dependências: 07B.1, 06D.2. Ordem vigente no índice geral;07D só executa produto após seu gate.
- Apify/LLM centrais; contexto, canais, dados, cache, quota e resultados privados por workspace. Sem autoelevação de owner a admin da plataforma.
- Preservar trial de 7 dias, consumo pré-pago e OpenWA 20 mensagens/5 novoscontatos por dia; intervalo 60–180 s e demais gates existentes.
- Fidelidade ao CadenceFlow por rota/estado/viewport; não criar outra estética. Estados da referência não observados permanecem classificados.
- Mutações revisadas/idempotentes; I/O incerto não autoriza repetição. Piloto/cobrança/envio externo exigem contas/ações próprias autorizadas, não são iniciados por este plano.

## Review Focus

1. mesmoinboundrepetido/workerreiniciado produz 1 turno/1 outbox
2. humanoassumeenquantoLLMresponde: receiptpreservado, resposta 0 queued
3. fonte injeta ignoraroptout: bloqueioautoritativo permanece; históricodeoutro tenant 0 tokens
4. LLMtimeoutmantémuncertainsem retrycego;limitecanalagregado impedeSDRfurar 20/5OpenWA
5. turno repetido consome 1 unidadeSDR; abstenção 0; uncertain 1 reserva; ausência de franquia impede ativar nova execução sem furar custo global
6. propose-action da LLM nunca executa reserva/CRM diretamente; ID de slot inventado é rejeitado; FAQ não aprovada com confidence alta ainda exige aprovação
7. A chamada HTTP/SQL direta e a revogação durante I/O não podem ampliar autoridade; resposta/log/evidência não incluem segredos nem conteúdo de outro workspace.

## File Structure

- Create: `src/domain/sdr-turn.ts`.
- Create: `src/server/sdr/worker.ts`.
- Create: `src/server/sdr/conversation.ts`.
- Create: `src/server/sdr/actions.ts`.
- Create: `src/server/sdr/prompts.ts`.
- Create: `src/modules/sdr/conversation-controls.tsx`.
- Create: `src/domain/sdr-actions.ts`.
- Create: `db/migrations/103-sdr-conversation.sql`.
- Create: `tests/07b2-sdr-conversation.test.ts`.
- Create: `tests/integration/07b2-sdr-conversation.test.ts`.
- Modify: `src/server/messaging/inbox.ts`.
- Modify: `src/server/messaging/replies.ts`.
- Modify: `src/server/messaging/dispatch.ts`.
- Modify: `scripts/runtime-supervisor.ts`.
- Modify: `src/domain/ai-skills.ts`.
- Modify: `src/server/sdr/http.ts`.
- Modify: `src/server/billing/entitlements.ts`.
- Modify: `scripts/test-integration.mjs`.
- Evidence: `docs/validation/07b2-sdr-conversation.md` e `docs/validation/evidence/07b2-sdr-conversation/` com relatório/manifest/capturas mascaradas. Não gerar evidência de sucesso antes de executar.

## Interfaces e dados

Consome Principal/withWorkspaceTransaction/requirePermission/AppError atuais; Reviewed/Confirm/EvidenceRef/EffectResult conforme contratos comuns quando aplicáveis. A API de frontend não recebePrincipal do cliente. Reusar um serviço existente com assinatura equivalente via adaptação explícita antes de criar duplicação.

```ts
type SdrActionProposal={kind:"calendar-options"|"calendar-book"|"crm-upsert"|"followup-consent",parameters:Record<string,unknown>,evidenceIds:string[]};
type SdrGeneration={kind:"reply"|"qualify"|"handoff"|"abstain"|"propose-action",text:string,fields:Record<string,string>,evidenceIds:string[],faqId:string|null,action:SdrActionProposal|null};
type SdrAdapters={generate:(input:{context:string,history:string[],incoming:string})=>Promise<SdrGeneration>};
type SdrTurnResult={turnId:string,state:"pending-approval"|"queued"|"handed-off"|"abstained"|"blocked",messageId:string|null,proposalId:string|null};
declare function processSdrTurn(input:{threadId:string;inboundId:string},deps:SdrAdapters):Promise<SdrTurnResult>;
declare function takeOverSdr(p:Principal,input:{threadId:string;expectedRevision:number;requestId:string}):Promise<{owner:"human";revision:number}>;
declare function prepareSdrActionProposal(p:Principal,input:{turnId:string;proposal:SdrActionProposal}):Promise<{proposalId:string;state:"pending-approval"|"read-only"}>;
declare function sdrAutoReplyDecision(input:{faqId:string|null;approvedFaqIds:string[];allEvidenceActive:boolean;containsMutation:boolean;humanOwned:boolean}):"approved-template"|"needs-approval";
```

**Entrada HTTP/CLI:** GET /api/sdr/conversations?cursor; POST /api/sdr/conversations/:id/{takeover,resume,prepare-reply,approve-reply,reject-reply}; operação deenvio viaoutboxexistente

**Persistência:** sdr_thread_state, sdr_turn, sdr_action; UNIQUE(workspace_id,thread_id,inbound_message_id), ownerhuman epoch e versão doagente Migração reservada`db/migrations/103-sdr-conversation.sql`; não editar 001–082 aplicadas.

### Task 1: Contrato de domínio e persistência autorizada

**Files:** `src/domain/sdr-turn.ts`, `tests/07b2-sdr-conversation.test.ts`, `db/migrations/103-sdr-conversation.sql`; DTOs deste plano pertencem ao domínio do pacote.

**Interfaces:** Produz `sdrCanRespond(input:{humanOwned:boolean;optedOut:boolean;withinHours:boolean;active:boolean}):boolean` e os DTOs acima. Consome os contratos comuns e formatos existentes da área.

- [ ] **Step 1 — RED:** criar `tests/07b2-sdr-conversation.test.ts` com o caso abaixo e variações de limite/ausência. Intervençãohumana suspende respostaIA mesmo comhorário/agentecorretos.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {sdrCanRespond} from '../src/domain/sdr-turn.ts';
test('07B.2 preserva a regra do domínio',()=>{
  assert.deepEqual(sdrCanRespond({"humanOwned":true,"optedOut":false,"withinHours":true,"active":true}),false);
});
```

- [ ] **Step 2 — confirmar RED:** `rtk proxy node --experimental-strip-types --test tests/07b2-sdr-conversation.test.ts`. Esperado: teste falha pela função/regra ausente; corrigir antes erros de fixture/sintaxe que mascarem a regra.
- [ ] **Step 3 — implementar:** definir os tipos e a função acima. Criar migração com tabelas/índices/FKs descritos, RLS forçada por workspace, funções worker mínimas e idempotência transacional; não conceder escrita ampla ao dispatcher. Umafila/turno porinbound e lockthread; contexto doagentepublicado e memóriaúltimas 20 mensagens +resumoevidenciado, nunca conteúdodeletado. Resultadoestrito, semshell/fetch/alterarpreço/inventarfatos. Fora dehorário adia com prazo/feedback; optoutparadefinitiva; humanoassumetravaepoch. Bounded-auto sóresposta deconhecimento evidenciado epermissãocanal; decisõesbaixa confiança/preçosnãoaprovados/objeçãoforaescopo viramapproval/handoff. Qualificaçãopropostacomorigem não substituiaplicação sempolítica. Roteamento do turno: propose-action passa por schema discriminado por kind (calendar-options: connectionId/from/to/timezone; calendar-book: reservation/slotId; crm-upsert: connectionId/leadId/fieldMapVersion; followup-consent: inboundId/channel/identityId/quote). Parâmetro/ID fora do contexto é rejeitado; ferramenta livre não existe. Persistir proposta ligada ao turn e epoch; consulta de slots é somente leitura e retorna opções reais. Escrita fica pending-approval até prepare/confirm dos serviços 07B.3, com UI de revisão; configuração de autonomia futura não ignora esse contrato. bounded-auto é server-side: somente render de FAQ id aprovado/versão ativa, evidências literais atuais, variáveis allowlisted, zero mutação, sem handoff/optout/limite. Texto livre da LLM, preço não aprovado, ausência de prova ou proposta de ação sempre precisam de aprovação. Falta de campo/faq gera needs-approval, não threshold inventado de confiança. Quota comercialSDR: reservar 1 unidade sdr por turnId antes da execução autorizada; consumir 1 somente quando uma respostaIA gera aceitação de envio confirmada no outbox. Abstenção/rascunho rejeitado/handoff puro liberam reserva. Retry não cobra novamente; uncertain mantém reserva até reconciliação. Agenda/CRM não cobram outra respostaSDR por si sós. Ledger técnicoLLM registra o custo recebido independentemente dessa cobrança, e limites mensais do plano/packs coexistem com limites diários do canal.
- [ ] **Step 4 — GREEN e commit:** repetir exatamente o comando RED até passar; conferir tipos/contratos e commit local focado, sem push/deploy implícito.

### Task 2: Serviço, execução e invariantes de falha

**Files:** `src/server/sdr/worker.ts`, `src/server/sdr/conversation.ts`, `src/server/sdr/actions.ts`, `src/server/sdr/prompts.ts`, `src/domain/sdr-actions.ts`, `tests/integration/07b2-sdr-conversation.test.ts`, `scripts/test-integration.mjs` e serviços existentes da área listados em Modify.

**Interfaces:** Consome DTOs/identidade e o resultado da Task 1; produz exatamente as funções de serviço declaradas neste plano. Dependências externas devem ser injetáveis nos testes, sem substituir autoridade real do banco.

- [ ] **Step 1 — RED de integração:** adicionar `07b2-sdr-conversation` à allowlist do runner. Reaproveitar fixtures de identidade/bancos/fechamento em tests/integration/helpers.ts e helpers da área; criar 2 workspaces e papéis próprios, sem usar contas/dados reais. Escrever os testes abaixo com contagens/estados/efeitos observáveis.

  - Caso 1: mesmoinboundrepetido/workerreiniciado produz 1 turno/1 outbox.
  - Caso 2: humanoassumeenquantoLLMresponde: receiptpreservado, resposta 0 queued.
  - Caso 3: fonte injeta ignoraroptout: bloqueioautoritativo permanece; históricodeoutro tenant 0 tokens.
  - Caso 4: LLMtimeoutmantémuncertainsem retrycego;limitecanalagregado impedeSDRfurar 20/5OpenWA.
  - Caso 5: turno repetido consome 1 unidadeSDR; abstenção 0; uncertain 1 reserva; ausência de franquia impede ativar nova execução sem furar custo global.
  - Caso 6: propose-action da LLM nunca executa reserva/CRM diretamente; ID de slot inventado é rejeitado; FAQ não aprovada com confidence alta ainda exige aprovação.

  - Caso de autoridade: endpoint direto/worker com usuário removido ou recurso cruzado retorna 403/404, publica 0 resultados para o cliente e não expõe segredo. Receipts técnicos já recebidos ficam só no escopo autorizado.

- [ ] **Step 2 — confirmar RED:** `rtk proxy node scripts/test-integration.mjs 07b2-sdr-conversation`. Esperado: falha pela regra de serviço ainda ausente; banco criado pelo runner é efêmero _test, nunca o banco operacional.
- [ ] **Step 3 — implementar serviço:** usar as assinaturas declaradas, validação Zod, transações/locks/leases e deduplicação. Umafila/turno porinbound e lockthread; contexto doagentepublicado e memóriaúltimas 20 mensagens +resumoevidenciado, nunca conteúdodeletado. Resultadoestrito, semshell/fetch/alterarpreço/inventarfatos. Fora dehorário adia com prazo/feedback; optoutparadefinitiva; humanoassumetravaepoch. Bounded-auto sóresposta deconhecimento evidenciado epermissãocanal; decisõesbaixa confiança/preçosnãoaprovados/objeçãoforaescopo viramapproval/handoff. Qualificaçãopropostacomorigem não substituiaplicação sempolítica. Roteamento do turno: propose-action passa por schema discriminado por kind (calendar-options: connectionId/from/to/timezone; calendar-book: reservation/slotId; crm-upsert: connectionId/leadId/fieldMapVersion; followup-consent: inboundId/channel/identityId/quote). Parâmetro/ID fora do contexto é rejeitado; ferramenta livre não existe. Persistir proposta ligada ao turn e epoch; consulta de slots é somente leitura e retorna opções reais. Escrita fica pending-approval até prepare/confirm dos serviços 07B.3, com UI de revisão; configuração de autonomia futura não ignora esse contrato. bounded-auto é server-side: somente render de FAQ id aprovado/versão ativa, evidências literais atuais, variáveis allowlisted, zero mutação, sem handoff/optout/limite. Texto livre da LLM, preço não aprovado, ausência de prova ou proposta de ação sempre precisam de aprovação. Falta de campo/faq gera needs-approval, não threshold inventado de confiança. Quota comercialSDR: reservar 1 unidade sdr por turnId antes da execução autorizada; consumir 1 somente quando uma respostaIA gera aceitação de envio confirmada no outbox. Abstenção/rascunho rejeitado/handoff puro liberam reserva. Retry não cobra novamente; uncertain mantém reserva até reconciliação. Agenda/CRM não cobram outra respostaSDR por si sós. Ledger técnicoLLM registra o custo recebido independentemente dessa cobrança, e limites mensais do plano/packs coexistem com limites diários do canal. Não ampliar permissões para fazer teste passar. Task 2 cobre todos os itens de Review Focus; nenhum caso fica delegado apenas à observação visual.
- [ ] **Step 4 — GREEN e commit:** repetir a suíte focada; comparar os efeitos reais no banco/adapter com asserções e confirmar 0 efeitos inesperados. Commitar apenas os arquivos do pacote.

### Task 3: HTTP, UI/UX e aceite do pacote

**Files:** rotas/clientes novos listados na estrutura, inventário/relatórios da estrutura e relatório de validação do pacote.

**Interfaces:** Consome serviços da Task 2 e expõe os mesmos estados ao usuário, sem simular resultado nem autorização no browser. Se 07D for excluído, não criar superfícies deproduto e registrar a decisão como entrega do gate.

- [ ] **Step 1 — RED de contrato HTTP:** acrescentar à suíte focada pedido anônimo 401/403, papel proibido 403, input inválido 422, revisão conflitante 409 e repetição idempotente quando houver mutação; para avaliadorCLI, manifesto incompleto retorna exitcode nãozero e relatório de pendências. Confirmar falha antes do handler/avaliador.
- [ ] **Step 2 — ligar operações:** GET /api/sdr/conversations?cursor; POST /api/sdr/conversations/:id/{takeover,resume,prepare-reply,approve-reply,reject-reply}; operação deenvio viaoutboxexistente Históricoúnico mostra IA/humano, pendingapproval, aprovar/editar/rejeitar, assumir/retomar e motivo deabstenção. NenhumchatSDRparalelo fora dainbox. Gates de menu são só apresentação; serviço continua autoritativo. Estados de erro/loading/empty/partial/revoke e limites têm ação de recuperação e não apagam rascunho.
- [ ] **Step 3 — conferir visual e jornada:** `/sdr`, `/messages/whatsapp`, `/messages/email`, `/linkedin/approvals`. Comparar com evidência disponível da referência no mesmo estado em 1920×855/390×844; checar 320 px, foco/escape/scroll, loading/falha/limite/sucesso. Mascarar dados e restaurar contexto de navegação/QA. Registrar desconhecidos da referência em separado.
- [ ] **Step 4 — verificação e aceite:** focados GREEN → `rtk proxy npm test` → `rtk proxy npm run test:integration` → `rtk proxy npm run build` → `rtk proxy npm run typecheck` → `rtk proxy git diff --check`. Todos passam ou o pacote fica pendente com falha reproduzível. No pacote puramente documental/gate excluído, rodar validador de documentos/links e suíte focada correspondente, sem testes de produto não alterado.
- [ ] **Step 5 — fechamento:** escrever relatório com casos, evidências/limitações, cleanupQA, restore de políticas/destinos, custos/saldo quando aplicável e estado de runtime. Revisão final conforme execução nativa; corrigir achados com regressão. Atualizar linha do índice/roadmap somente pelo aceite efetivo e commit local focado.

## Gate externo e critério específico

Piloto conversacional comfontescontroladas antes debounded-auto; oficialLinkedIn exigeaçãohumana e não recebeenvio 24 hautomático.

## Self-review do plano

R20 mapeados às três tarefas. DTOs e funções têm uma definição neste plano e no desenho de área; contratos comuns evitam reinterpretar autorização/revisão. Task 1 cobre regra pura/persistência;Task 2 cobre todos os itens de Review Focus;Task 3 cobre o que a pessoa realmente consegue operar e ver. Dados/arquivos citados como Create são futuros; Modify foi conferido no baseline ou tem pacote anterior proprietário. Escrever um plano não equivale a passar seus testes.
