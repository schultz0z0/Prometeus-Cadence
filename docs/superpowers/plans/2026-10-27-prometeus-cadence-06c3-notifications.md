# 06C.3 — Notificações, preferências e resumos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the native execution chosen by the user. Follow tasks in order; perform a fresh final review at execution time under the applicable execution skill. This session authors plans only.

**Goal:** Notificações, preferências e resumos; requisitos R11 do PRD.
**Architecture:** Evoluir serviços do monólito com os contratos da área; reutilizar autoridade, banco, jobs, ledger e eventos existentes. Novas interfaces listadas são contratos planejados, não funções já implementadas.
**Tech Stack:** Next 16.4.2, React 19.3.1, TypeScript 5.9.3, PostgreSQL/pg, Zod e node:test existentes; navegador de QA já disponível para UI.
**Spec:** [desenho da área](../specs/2026-10-27-prometeus-cadence-operations-design.md), [PRD](../specs/2026-10-27-prometeus-cadence-complete-prd.md), [contratos comuns](../specs/2026-10-27-prometeus-cadence-technical-contracts.md).

## Global Constraints

- Pacote planejado; não marcado concluído. Dependências: 06C.2. Ordem vigente no índice geral;07D só executa produto após seu gate.
- Apify/LLM centrais; contexto, canais, dados, cache, quota e resultados privados por workspace. Sem autoelevação de owner a admin da plataforma.
- Preservar trial de 7 dias, consumo pré-pago e OpenWA 20 mensagens/5 novoscontatos por dia; intervalo 60–180 s e demais gates existentes.
- Fidelidade ao CadenceFlow por rota/estado/viewport; não criar outra estética. Estados da referência não observados permanecem classificados.
- Mutações revisadas/idempotentes; I/O incerto não autoriza repetição. Piloto/cobrança/envio externo exigem contas/ações próprias autorizadas, não são iniciados por este plano.

## Review Focus

1. mesmo evento em 2 ticks gera 1 item/entrega, unread diminuiuma vez por usuário
2. silentwindow 22–08 atravessameianoite corretamente; sumário semanal não inclui workspacevizinho
3. revogar membership/canal antesentrega produz 0 envio; mudançadepreferência respeitada no claim
4. abaofflinesom não repete backlog inteiro ao retornar; contador deriva itens efetivos
5. A chamada HTTP/SQL direta e a revogação durante I/O não podem ampliar autoridade; resposta/log/evidência não incluem segredos nem conteúdo de outro workspace.

## File Structure

- Create: `src/domain/notifications.ts`.
- Create: `src/server/notifications/service.ts`.
- Create: `src/server/notifications/worker.ts`.
- Create: `src/app/api/notifications/route.ts`.
- Create: `src/app/api/notifications/[id]/[action]/route.ts`.
- Create: `src/client/notification-client.ts`.
- Create: `db/migrations/090-notifications.sql`.
- Create: `tests/06c3-notifications.test.ts`.
- Create: `tests/integration/06c3-notifications.test.ts`.
- Modify: `src/modules/settings/reference-settings.tsx`.
- Modify: `src/components/shell/account-controls.tsx`.
- Modify: `src/components/shell/app-shell.tsx`.
- Modify: `scripts/runtime-supervisor.ts`.
- Modify: `src/server/auth/mail.ts`.
- Modify: `scripts/test-integration.mjs`.
- Evidence: `docs/validation/06c3-notifications.md` e `docs/validation/evidence/06c3-notifications/` com relatório/manifest/capturas mascaradas. Não gerar evidência de sucesso antes de executar.

## Interfaces e dados

Consome Principal/withWorkspaceTransaction/requirePermission/AppError atuais; Reviewed/Confirm/EvidenceRef/EffectResult conforme contratos comuns quando aplicáveis. A API de frontend não recebePrincipal do cliente. Reusar um serviço existente com assinatura equivalente via adaptação explícita antes de criar duplicação.

```ts
type NotificationPreferences={expectedRevision:number,events:string[],email:boolean,whatsapp:boolean,sound:boolean,badge:boolean,quiet:{timezone:string,start:string,end:string}|null,summary:{frequency:"off"|"daily"|"weekly",time:string}};
type NotificationItem={id:string,eventKey:string,title:string,href:string,readAt:string|null,createdAt:string};
declare function saveNotificationPreferences(p:Principal,input:NotificationPreferences):Promise<Versioned<NotificationPreferences>>;
declare function listNotifications(p:Principal,cursor?:string):Promise<Page<NotificationItem>>;
declare function processNotificationTick(options:{limit:number;signal:AbortSignal}):Promise<{delivered:number;deferred:number}>;
```

**Entrada HTTP/CLI:** GET /api/notifications?cursor; POST /api/notifications {action:preferences,expectedRevision,input}; POST /api/notifications/:id/read; GET preferences com modo explícito

**Persistência:** notification_preference, notification_item, notification_delivery, scheduled_summary; UNIQUE(workspace_id,user_id,event_key,channel) Migração reservada`db/migrations/090-notifications.sql`; não editar 001–082 aplicadas.

### Task 1: Contrato de domínio e persistência autorizada

**Files:** `src/domain/notifications.ts`, `tests/06c3-notifications.test.ts`, `db/migrations/090-notifications.sql`; DTOs deste plano pertencem ao domínio do pacote.

**Interfaces:** Produz `notificationAllowed(input:{enabled:boolean;quiet:boolean;verifiedDestination:boolean}):boolean` e os DTOs acima. Consome os contratos comuns e formatos existentes da área.

- [ ] **Step 1 — RED:** criar `tests/06c3-notifications.test.ts` com o caso abaixo e variações de limite/ausência. Preferência ligada sem destino verificado não autoriza envio externo.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationAllowed} from '../src/domain/notifications.ts';
test('06C.3 preserva a regra do domínio',()=>{
  assert.deepEqual(notificationAllowed({"enabled":true,"quiet":false,"verifiedDestination":false}),false);
});
```

- [ ] **Step 2 — confirmar RED:** `rtk proxy node --experimental-strip-types --test tests/06c3-notifications.test.ts`. Esperado: teste falha pela função/regra ausente; corrigir antes erros de fixture/sintaxe que mascarem a regra.
- [ ] **Step 3 — implementar:** definir os tipos e a função acima. Criar migração com tabelas/índices/FKs descritos, RLS forçada por workspace, funções worker mínimas e idempotência transacional; não conceder escrita ampla ao dispatcher. Convertereventos confirmados em itens porusuário e preferências. Somapenas após gesto/permissão do browser, sem autoplay quebrado. Quiet window cruza meia-noite/fuso e adia, não duplica. Destinosemailtelefone vêm de conta verificada ou canal configurado, sem bodydestination arbitrário. Resumos agrupam fatosdo período comchaveúnica. Ativossemcapacidade ficam adiados/erro útil; SLA não inventa WhatsAppsend gratuita.
- [ ] **Step 4 — GREEN e commit:** repetir exatamente o comando RED até passar; conferir tipos/contratos e commit local focado, sem push/deploy implícito.

### Task 2: Serviço, execução e invariantes de falha

**Files:** `src/server/notifications/service.ts`, `src/server/notifications/worker.ts`, `src/app/api/notifications/route.ts`, `src/app/api/notifications/[id]/[action]/route.ts`, `tests/integration/06c3-notifications.test.ts`, `scripts/test-integration.mjs` e serviços existentes da área listados em Modify.

**Interfaces:** Consome DTOs/identidade e o resultado da Task 1; produz exatamente as funções de serviço declaradas neste plano. Dependências externas devem ser injetáveis nos testes, sem substituir autoridade real do banco.

- [ ] **Step 1 — RED de integração:** adicionar `06c3-notifications` à allowlist do runner. Reaproveitar fixtures de identidade/bancos/fechamento em tests/integration/helpers.ts e helpers da área; criar 2 workspaces e papéis próprios, sem usar contas/dados reais. Escrever os testes abaixo com contagens/estados/efeitos observáveis.

  - Caso 1: mesmo evento em 2 ticks gera 1 item/entrega, unread diminuiuma vez por usuário.
  - Caso 2: silentwindow 22–08 atravessameianoite corretamente; sumário semanal não inclui workspacevizinho.
  - Caso 3: revogar membership/canal antesentrega produz 0 envio; mudançadepreferência respeitada no claim.
  - Caso 4: abaofflinesom não repete backlog inteiro ao retornar; contador deriva itens efetivos.

  - Caso de autoridade: endpoint direto/worker com usuário removido ou recurso cruzado retorna 403/404, publica 0 resultados para o cliente e não expõe segredo. Receipts técnicos já recebidos ficam só no escopo autorizado.

- [ ] **Step 2 — confirmar RED:** `rtk proxy node scripts/test-integration.mjs 06c3-notifications`. Esperado: falha pela regra de serviço ainda ausente; banco criado pelo runner é efêmero _test, nunca o banco operacional.
- [ ] **Step 3 — implementar serviço:** usar as assinaturas declaradas, validação Zod, transações/locks/leases e deduplicação. Convertereventos confirmados em itens porusuário e preferências. Somapenas após gesto/permissão do browser, sem autoplay quebrado. Quiet window cruza meia-noite/fuso e adia, não duplica. Destinosemailtelefone vêm de conta verificada ou canal configurado, sem bodydestination arbitrário. Resumos agrupam fatosdo período comchaveúnica. Ativossemcapacidade ficam adiados/erro útil; SLA não inventa WhatsAppsend gratuita. Não ampliar permissões para fazer teste passar. Task 2 cobre todos os itens de Review Focus; nenhum caso fica delegado apenas à observação visual.
- [ ] **Step 4 — GREEN e commit:** repetir a suíte focada; comparar os efeitos reais no banco/adapter com asserções e confirmar 0 efeitos inesperados. Commitar apenas os arquivos do pacote.

### Task 3: HTTP, UI/UX e aceite do pacote

**Files:** rotas/clientes novos listados na estrutura, `src/modules/settings/reference-settings.tsx`, `src/components/shell/account-controls.tsx`, `src/components/shell/app-shell.tsx` e relatório de validação do pacote.

**Interfaces:** Consome serviços da Task 2 e expõe os mesmos estados ao usuário, sem simular resultado nem autorização no browser. Se 07D for excluído, não criar superfícies deproduto e registrar a decisão como entrega do gate.

- [ ] **Step 1 — RED de contrato HTTP:** acrescentar à suíte focada pedido anônimo 401/403, papel proibido 403, input inválido 422, revisão conflitante 409 e repetição idempotente quando houver mutação; para avaliadorCLI, manifesto incompleto retorna exitcode nãozero e relatório de pendências. Confirmar falha antes do handler/avaliador.
- [ ] **Step 2 — ligar operações:** GET /api/notifications?cursor; POST /api/notifications {action:preferences,expectedRevision,input}; POST /api/notifications/:id/read; GET preferences com modo explícito Feed/contador e toggles da referência ficam operacionais, com estado de destino pendente e feedback de salvar; nenhuma notificação marca conversa remota como lida. Gates de menu são só apresentação; serviço continua autoritativo. Estados de erro/loading/empty/partial/revoke e limites têm ação de recuperação e não apagam rascunho.
- [ ] **Step 3 — conferir visual e jornada:** `/settings/notifications`, `/settings/account`, `/dashboard`. Comparar com evidência disponível da referência no mesmo estado em 1920×855/390×844; checar 320 px, foco/escape/scroll, loading/falha/limite/sucesso. Mascarar dados e restaurar contexto de navegação/QA. Registrar desconhecidos da referência em separado.
- [ ] **Step 4 — verificação e aceite:** focados GREEN → `rtk proxy npm test` → `rtk proxy npm run test:integration` → `rtk proxy npm run build` → `rtk proxy npm run typecheck` → `rtk proxy git diff --check`. Todos passam ou o pacote fica pendente com falha reproduzível. No pacote puramente documental/gate excluído, rodar validador de documentos/links e suíte focada correspondente, sem testes de produto não alterado.
- [ ] **Step 5 — fechamento:** escrever relatório com casos, evidências/limitações, cleanupQA, restore de políticas/destinos, custos/saldo quando aplicável e estado de runtime. Revisão final conforme execução nativa; corrigir achados com regressão. Atualizar linha do índice/roadmap somente pelo aceite efetivo e commit local focado.

## Gate externo e critério específico

Provedor de avisos e destino verificado necessários ao aceiteexterno. Testes locais usam capturadores; não enviar ao operador por simples teste de preferências.

## Self-review do plano

R11 mapeados às três tarefas. DTOs e funções têm uma definição neste plano e no desenho de área; contratos comuns evitam reinterpretar autorização/revisão. Task 1 cobre regra pura/persistência;Task 2 cobre todos os itens de Review Focus;Task 3 cobre o que a pessoa realmente consegue operar e ver. Dados/arquivos citados como Create são futuros; Modify foi conferido no baseline ou tem pacote anterior proprietário. Escrever um plano não equivale a passar seus testes.
