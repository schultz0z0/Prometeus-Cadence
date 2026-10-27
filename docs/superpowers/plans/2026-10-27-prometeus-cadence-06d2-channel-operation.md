# 06D.2 — Canais, inbox e homologação de entrega Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the native execution chosen by the user. Follow tasks in order; perform a fresh final review at execution time under the applicable execution skill. This session authors plans only.

**Goal:** Canais, inbox e homologação de entrega; requisitos R09 do PRD.
**Architecture:** Evoluir serviços do monólito com os contratos da área; reutilizar autoridade, banco, jobs, ledger e eventos existentes. Novas interfaces listadas são contratos planejados, não funções já implementadas.
**Tech Stack:** Next 16.4.2, React 19.3.1, TypeScript 5.9.3, PostgreSQL/pg, Zod e node:test existentes; navegador de QA já disponível para UI.
**Spec:** [desenho da área](../specs/2026-10-27-prometeus-cadence-messaging-design.md), [PRD](../specs/2026-10-27-prometeus-cadence-complete-prd.md), [contratos comuns](../specs/2026-10-27-prometeus-cadence-technical-contracts.md).

## Global Constraints

- Pacote planejado; não marcado concluído. Dependências: 06D.1. Ordem vigente no índice geral;07D só executa produto após seu gate.
- Apify/LLM centrais; contexto, canais, dados, cache, quota e resultados privados por workspace. Sem autoelevação de owner a admin da plataforma.
- Preservar trial de 7 dias, consumo pré-pago e OpenWA 20 mensagens/5 novoscontatos por dia; intervalo 60–180 s e demais gates existentes.
- Fidelidade ao CadenceFlow por rota/estado/viewport; não criar outra estética. Estados da referência não observados permanecem classificados.
- Mutações revisadas/idempotentes; I/O incerto não autoriza repetição. Piloto/cobrança/envio externo exigem contas/ações próprias autorizadas, não são iniciados por este plano.

## Review Focus

1. receberresposta na mesma thread interrompe futuro follow-up em todoscanais relacionados
2. opt-out concorre comdispatch: nenhum envio novoapós bloqueio autoritativo; resultado incerto permanece reservado
3. reiniciarworker após aceitação antesreceipt não duplica mensagem; credencial revogada durante I/O não publica sucessofalso
4. SMTPaceito mostraaccepted;pixel ausente retornanull;QRready sem piloto não mostraentregue
5. A chamada HTTP/SQL direta e a revogação durante I/O não podem ampliar autoridade; resposta/log/evidência não incluem segredos nem conteúdo de outro workspace.

## File Structure

- Create: `src/domain/channel-evidence.ts`.
- Create: `src/server/messaging/pilot.ts`.
- Create: `src/server/messaging/delivery-evidence.ts`.
- Create: `db/migrations/086-message-operation.sql`.
- Create: `tests/06d2-channel-operation.test.ts`.
- Create: `tests/integration/06d2-channel-operation.test.ts`.
- Modify: `src/server/messaging/inbox.ts`.
- Modify: `src/server/messaging/replies.ts`.
- Modify: `src/server/messaging/email-replies.ts`.
- Modify: `src/server/messaging/receipts.ts`.
- Modify: `src/server/messaging/metrics.ts`.
- Modify: `src/server/channels/archive.ts`.
- Modify: `src/server/mail/threading.ts`.
- Modify: `src/modules/messages/whatsapp-inbox.tsx`.
- Modify: `src/modules/messages/email-inbox.tsx`.
- Modify: `src/modules/settings/whatsapp-settings.tsx`.
- Modify: `scripts/test-integration.mjs`.
- Evidence: `docs/validation/06d2-channel-operation.md` e `docs/validation/evidence/06d2-channel-operation/` com relatório/manifest/capturas mascaradas. Não gerar evidência de sucesso antes de executar.

## Interfaces e dados

Consome Principal/withWorkspaceTransaction/requirePermission/AppError atuais; Reviewed/Confirm/EvidenceRef/EffectResult conforme contratos comuns quando aplicáveis. A API de frontend não recebePrincipal do cliente. Reusar um serviço existente com assinatura equivalente via adaptação explícita antes de criar duplicação.

```ts
type DeliveryEvidence={messageId:string,state:string,acceptedAt:string|null,deliveredAt:string|null,readAt:string|null,supported:string[]};
type ChannelPilotInput={connectionId:string,ownedRecipient:string,reviewToken:string,requestId:string};
type PilotAdapters={observe:(remoteId:string)=>Promise<DeliveryEvidence>};
type PilotResult={outboundId:string,inboundId:string|null,delivery:DeliveryEvidence,stoppedEnrollment:boolean};
declare function readDeliveryEvidence(p:Principal,messageId:string):Promise<DeliveryEvidence>;
declare function runChannelPilot(p:Principal,input:ChannelPilotInput,deps:PilotAdapters):Promise<PilotResult>;
```

**Entrada HTTP/CLI:** Reusar /api/channels/:id/:action, /api/mailboxes/:id/:action e /api/messaging/:resource/:id/:action para teste/reply/read/reconcile; acrescentar evidência suportada ao DTO existente, semendpoint paralelo de envio

**Persistência:** estender vínculos de recibo/consentimento/inbox existentes; novos índices por workspace/remotereference; não recriar outbox ou canal Migração reservada`db/migrations/086-message-operation.sql`; não editar 001–082 aplicadas.

### Task 1: Contrato de domínio e persistência autorizada

**Files:** `src/domain/channel-evidence.ts`, `tests/06d2-channel-operation.test.ts`, `db/migrations/086-message-operation.sql`; DTOs deste plano pertencem ao domínio do pacote.

**Interfaces:** Produz `classifyDeliveryProof(input:{accepted:boolean;delivered:boolean|null;read:boolean|null}):'pending'|'accepted'|'delivered'|'read'` e os DTOs acima. Consome os contratos comuns e formatos existentes da área.

- [ ] **Step 1 — RED:** criar `tests/06d2-channel-operation.test.ts` com o caso abaixo e variações de limite/ausência. Aceitação do provedor não significa entrega ou leitura.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyDeliveryProof} from '../src/domain/channel-evidence.ts';
test('06D.2 preserva a regra do domínio',()=>{
  assert.deepEqual(classifyDeliveryProof({"accepted":true,"delivered":null,"read":null}),"accepted");
});
```

- [ ] **Step 2 — confirmar RED:** `rtk proxy node --experimental-strip-types --test tests/06d2-channel-operation.test.ts`. Esperado: teste falha pela função/regra ausente; corrigir antes erros de fixture/sintaxe que mascarem a regra.
- [ ] **Step 3 — implementar:** definir os tipos e a função acima. Criar migração com tabelas/índices/FKs descritos, RLS forçada por workspace, funções worker mínimas e idempotência transacional; não conceder escrita ampla ao dispatcher. Cobrir conectar/verificar/revogar/recuperar Meta/OpenWA/Gmail/SMTPIMAP comcontratos atuais. Vincular thread enviado/recebido e ações de leitura apenas aplicativo. Recibo fora de ordem não regride estado; resposta humana/optout trava materialização pendente. Reconciliarincerto antes de reenviar; anexos e variante congelados seguemreceipt. Corrigir separações indevidas de thread somente com cabeçalhos/IDs provados.
- [ ] **Step 4 — GREEN e commit:** repetir exatamente o comando RED até passar; conferir tipos/contratos e commit local focado, sem push/deploy implícito.

### Task 2: Serviço, execução e invariantes de falha

**Files:** `src/server/messaging/pilot.ts`, `src/server/messaging/delivery-evidence.ts`, `tests/integration/06d2-channel-operation.test.ts`, `scripts/test-integration.mjs` e serviços existentes da área listados em Modify.

**Interfaces:** Consome DTOs/identidade e o resultado da Task 1; produz exatamente as funções de serviço declaradas neste plano. Dependências externas devem ser injetáveis nos testes, sem substituir autoridade real do banco.

- [ ] **Step 1 — RED de integração:** adicionar `06d2-channel-operation` à allowlist do runner. Reaproveitar fixtures de identidade/bancos/fechamento em tests/integration/helpers.ts e helpers da área; criar 2 workspaces e papéis próprios, sem usar contas/dados reais. Escrever os testes abaixo com contagens/estados/efeitos observáveis.

  - Caso 1: receberresposta na mesma thread interrompe futuro follow-up em todoscanais relacionados.
  - Caso 2: opt-out concorre comdispatch: nenhum envio novoapós bloqueio autoritativo; resultado incerto permanece reservado.
  - Caso 3: reiniciarworker após aceitação antesreceipt não duplica mensagem; credencial revogada durante I/O não publica sucessofalso.
  - Caso 4: SMTPaceito mostraaccepted;pixel ausente retornanull;QRready sem piloto não mostraentregue.

  - Caso de autoridade: endpoint direto/worker com usuário removido ou recurso cruzado retorna 403/404, publica 0 resultados para o cliente e não expõe segredo. Receipts técnicos já recebidos ficam só no escopo autorizado.

- [ ] **Step 2 — confirmar RED:** `rtk proxy node scripts/test-integration.mjs 06d2-channel-operation`. Esperado: falha pela regra de serviço ainda ausente; banco criado pelo runner é efêmero _test, nunca o banco operacional.
- [ ] **Step 3 — implementar serviço:** usar as assinaturas declaradas, validação Zod, transações/locks/leases e deduplicação. Cobrir conectar/verificar/revogar/recuperar Meta/OpenWA/Gmail/SMTPIMAP comcontratos atuais. Vincular thread enviado/recebido e ações de leitura apenas aplicativo. Recibo fora de ordem não regride estado; resposta humana/optout trava materialização pendente. Reconciliarincerto antes de reenviar; anexos e variante congelados seguemreceipt. Corrigir separações indevidas de thread somente com cabeçalhos/IDs provados. Não ampliar permissões para fazer teste passar. Task 2 cobre todos os itens de Review Focus; nenhum caso fica delegado apenas à observação visual.
- [ ] **Step 4 — GREEN e commit:** repetir a suíte focada; comparar os efeitos reais no banco/adapter com asserções e confirmar 0 efeitos inesperados. Commitar apenas os arquivos do pacote.

### Task 3: HTTP, UI/UX e aceite do pacote

**Files:** rotas/clientes novos listados na estrutura, `src/modules/messages/whatsapp-inbox.tsx`, `src/modules/messages/email-inbox.tsx`, `src/modules/settings/whatsapp-settings.tsx` e relatório de validação do pacote.

**Interfaces:** Consome serviços da Task 2 e expõe os mesmos estados ao usuário, sem simular resultado nem autorização no browser. Se 07D for excluído, não criar superfícies deproduto e registrar a decisão como entrega do gate.

- [ ] **Step 1 — RED de contrato HTTP:** acrescentar à suíte focada pedido anônimo 401/403, papel proibido 403, input inválido 422, revisão conflitante 409 e repetição idempotente quando houver mutação; para avaliadorCLI, manifesto incompleto retorna exitcode nãozero e relatório de pendências. Confirmar falha antes do handler/avaliador.
- [ ] **Step 2 — ligar operações:** Reusar /api/channels/:id/:action, /api/mailboxes/:id/:action e /api/messaging/:resource/:id/:action para teste/reply/read/reconcile; acrescentar evidência suportada ao DTO existente, semendpoint paralelo de envio Conexão permanece em cartõeslimpos e popups; histórico agrupa threads, colapsa citações e mantém rascunho/scroll; falha mostraação útil e estadoreal. Gates de menu são só apresentação; serviço continua autoritativo. Estados de erro/loading/empty/partial/revoke e limites têm ação de recuperação e não apagam rascunho.
- [ ] **Step 3 — conferir visual e jornada:** `/settings/whatsapp`, `/settings/email`, `/messages/whatsapp`, `/messages/email`, `/cadences/[id]`. Comparar com evidência disponível da referência no mesmo estado em 1920×855/390×844; checar 320 px, foco/escape/scroll, loading/falha/limite/sucesso. Mascarar dados e restaurar contexto de navegação/QA. Registrar desconhecidos da referência em separado.
- [ ] **Step 4 — verificação e aceite:** focados GREEN → `rtk proxy npm test` → `rtk proxy npm run test:integration` → `rtk proxy npm run build` → `rtk proxy npm run typecheck` → `rtk proxy git diff --check`. Todos passam ou o pacote fica pendente com falha reproduzível. No pacote puramente documental/gate excluído, rodar validador de documentos/links e suíte focada correspondente, sem testes de produto não alterado.
- [ ] **Step 5 — fechamento:** escrever relatório com casos, evidências/limitações, cleanupQA, restore de políticas/destinos, custos/saldo quando aplicável e estado de runtime. Revisão final conforme execução nativa; corrigir achados com regressão. Atualizar linha do índice/roadmap somente pelo aceite efetivo e commit local focado.

## Gate externo e critério específico

Piloto real sócom contas/destinatários próprios, orçamento e ações explícitas autorizadas. Não enviar automaticamente para números antigos deprints.

## Self-review do plano

R09 mapeados às três tarefas. DTOs e funções têm uma definição neste plano e no desenho de área; contratos comuns evitam reinterpretar autorização/revisão. Task 1 cobre regra pura/persistência;Task 2 cobre todos os itens de Review Focus;Task 3 cobre o que a pessoa realmente consegue operar e ver. Dados/arquivos citados como Create são futuros; Modify foi conferido no baseline ou tem pacote anterior proprietário. Escrever um plano não equivale a passar seus testes.
