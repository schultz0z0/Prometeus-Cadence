# 07C.1 — API, eventos e webhooks de saída Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the native execution chosen by the user. Follow tasks in order; perform a fresh final review at execution time under the applicable execution skill. This session authors plans only.

**Goal:** API, eventos e webhooks de saída; requisitos R15 do PRD.
**Architecture:** Evoluir serviços do monólito com os contratos da área; reutilizar autoridade, banco, jobs, ledger e eventos existentes. Novas interfaces listadas são contratos planejados, não funções já implementadas.
**Tech Stack:** Next 16.4.2, React 19.3.1, TypeScript 5.9.3, PostgreSQL/pg, Zod e node:test existentes; navegador de QA já disponível para UI.
**Spec:** [desenho da área](../specs/2026-10-27-prometeus-cadence-integrations-design.md), [PRD](../specs/2026-10-27-prometeus-cadence-complete-prd.md), [contratos comuns](../specs/2026-10-27-prometeus-cadence-technical-contracts.md).

## Global Constraints

- Pacote planejado; não marcado concluído. Dependências: 06E.2, 06C.2. Ordem vigente no índice geral;07D só executa produto após seu gate.
- Apify/LLM centrais; contexto, canais, dados, cache, quota e resultados privados por workspace. Sem autoelevação de owner a admin da plataforma.
- Preservar trial de 7 dias, consumo pré-pago e OpenWA 20 mensagens/5 novoscontatos por dia; intervalo 60–180 s e demais gates existentes.
- Fidelidade ao CadenceFlow por rota/estado/viewport; não criar outra estética. Estados da referência não observados permanecem classificados.
- Mutações revisadas/idempotentes; I/O incerto não autoriza repetição. Piloto/cobrança/envio externo exigem contas/ações próprias autorizadas, não são iniciados por este plano.

## Review Focus

1. commitabortado emite 0 webhook; mesmoevento/retry mantémidestável e 1 registro lógico
2. redirect para 169.254/localhost/IPv 6 privado/rebinding bloqueado antesrequest
3. revogartokenoumembership invalida chamadaAPI; rotate não retorna segredos antigos
4. 429 respeitaRetryAfter limitado 24 h;401 abreerroacao e 0 loop; outro tenantnãole destinos
5. A chamada HTTP/SQL direta e a revogação durante I/O não podem ampliar autoridade; resposta/log/evidência não incluem segredos nem conteúdo de outro workspace.

## File Structure

- Create: `src/domain/integration-delivery.ts`.
- Create: `src/server/integrations/api-auth.ts`.
- Create: `src/server/integrations/webhooks.ts`.
- Create: `src/server/integrations/outbox.ts`.
- Create: `src/server/integrations/worker.ts`.
- Create: `src/server/integrations/http.ts`.
- Create: `src/app/api/integrations/route.ts`.
- Create: `src/app/api/integrations/[id]/[action]/route.ts`.
- Create: `src/app/api/v1/leads/route.ts`.
- Create: `src/app/api/v1/events/route.ts`.
- Create: `db/migrations/094-integrations-outbox.sql`.
- Create: `tests/07c1-api-webhooks.test.ts`.
- Create: `tests/integration/07c1-api-webhooks.test.ts`.
- Modify: `src/modules/settings/reference-settings.tsx`.
- Modify: `src/server/operations/repository.ts`.
- Modify: `src/server/prospecting/extraction/public-url.ts`.
- Modify: `scripts/runtime-supervisor.ts`.
- Modify: `scripts/test-integration.mjs`.
- Evidence: `docs/validation/07c1-api-webhooks.md` e `docs/validation/evidence/07c1-api-webhooks/` com relatório/manifest/capturas mascaradas. Não gerar evidência de sucesso antes de executar.

## Interfaces e dados

Consome Principal/withWorkspaceTransaction/requirePermission/AppError atuais; Reviewed/Confirm/EvidenceRef/EffectResult conforme contratos comuns quando aplicáveis. A API de frontend não recebePrincipal do cliente. Reusar um serviço existente com assinatura equivalente via adaptação explícita antes de criar duplicação.

```ts
type WebhookInput={name:string,url:string,events:string[],expectedRevision:number};
type WebhookView={id:string,url:string,state:string,secretConfigured:boolean};
type IntegrationEnvelope={id:string,type:string,version:1,occurredAt:string,entity:{kind:string,id:string},data:Record<string,unknown>};
declare function prepareWebhook(p:Principal,input:WebhookInput):Promise<Reviewed<WebhookInput>>;
declare function confirmWebhook(p:Principal,input:Confirm<WebhookInput>):Promise<WebhookView>;
declare function dispatchIntegrationTick(input:{limit:number;signal:AbortSignal}):Promise<{sent:number;deferred:number}>;
declare function resolveApiPrincipal(token:string,scope:string):Promise<Principal>;
```

**Entrada HTTP/CLI:** GET/POST /api/integrations para destinos e credenciais revisados; POST /:id/{rotate,revoke,retry}; GET /api/v1/leads e /events com Bearer escopado; comandoescrita reviewed via mesmo serviço de domínio, não CRUDlivre

**Persistência:** api_credential, webhook_destination, integration_outbox, integration_delivery; UNIQUE(workspace_id,destination_id,event_key); token apenas digest, segredo deassinatura criptografado Migração reservada`db/migrations/094-integrations-outbox.sql`; não editar 001–082 aplicadas.

### Task 1: Contrato de domínio e persistência autorizada

**Files:** `src/domain/integration-delivery.ts`, `tests/07c1-api-webhooks.test.ts`, `db/migrations/094-integrations-outbox.sql`; DTOs deste plano pertencem ao domínio do pacote.

**Interfaces:** Produz `webhookRetryAllowed(input:{status:number;attempt:number;ageHours:number}):boolean` e os DTOs acima. Consome os contratos comuns e formatos existentes da área.

- [ ] **Step 1 — RED:** criar `tests/07c1-api-webhooks.test.ts` com o caso abaixo e variações de limite/ausência. Credencial rejeitada exige intervenção, não retry infinito.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {webhookRetryAllowed} from '../src/domain/integration-delivery.ts';
test('07C.1 preserva a regra do domínio',()=>{
  assert.deepEqual(webhookRetryAllowed({"status":401,"attempt":2,"ageHours":1}),false);
});
```

- [ ] **Step 2 — confirmar RED:** `rtk proxy node --experimental-strip-types --test tests/07c1-api-webhooks.test.ts`. Esperado: teste falha pela função/regra ausente; corrigir antes erros de fixture/sintaxe que mascarem a regra.
- [ ] **Step 3 — implementar:** definir os tipos e a função acima. Criar migração com tabelas/índices/FKs descritos, RLS forçada por workspace, funções worker mínimas e idempotência transacional; não conceder escrita ampla ao dispatcher. Envelopev 1 emitido com efeito de domínio na mesmatransação; templates de eventos entram/qualifica/responde/agenda/handoff. HMACSHA256 corpo+timestamp com janela 5 min; recipient pode deduplicar eventid. Validar DNS/IP/HTTPS/redirecionamento em cada tentativa, bloquear redesprivadas; timeout 10 s/corpo 256KiB; retries 1 min/5 min/30 min/2 h/6 h até 24 h apenas 429/5 xx/rede. Incerto registrado e entrega at-least-once explícita, não prometer exactly-once externo. Tokenmetadata/segredo mostradosuma vez; revoke cancela pendências.
- [ ] **Step 4 — GREEN e commit:** repetir exatamente o comando RED até passar; conferir tipos/contratos e commit local focado, sem push/deploy implícito.

### Task 2: Serviço, execução e invariantes de falha

**Files:** `src/server/integrations/api-auth.ts`, `src/server/integrations/webhooks.ts`, `src/server/integrations/outbox.ts`, `src/server/integrations/worker.ts`, `src/server/integrations/http.ts`, `src/app/api/integrations/route.ts`, `src/app/api/integrations/[id]/[action]/route.ts`, `src/app/api/v1/leads/route.ts`, `src/app/api/v1/events/route.ts`, `tests/integration/07c1-api-webhooks.test.ts`, `scripts/test-integration.mjs` e serviços existentes da área listados em Modify.

**Interfaces:** Consome DTOs/identidade e o resultado da Task 1; produz exatamente as funções de serviço declaradas neste plano. Dependências externas devem ser injetáveis nos testes, sem substituir autoridade real do banco.

- [ ] **Step 1 — RED de integração:** adicionar `07c1-api-webhooks` à allowlist do runner. Reaproveitar fixtures de identidade/bancos/fechamento em tests/integration/helpers.ts e helpers da área; criar 2 workspaces e papéis próprios, sem usar contas/dados reais. Escrever os testes abaixo com contagens/estados/efeitos observáveis.

  - Caso 1: commitabortado emite 0 webhook; mesmoevento/retry mantémidestável e 1 registro lógico.
  - Caso 2: redirect para 169.254/localhost/IPv 6 privado/rebinding bloqueado antesrequest.
  - Caso 3: revogartokenoumembership invalida chamadaAPI; rotate não retorna segredos antigos.
  - Caso 4: 429 respeitaRetryAfter limitado 24 h;401 abreerroacao e 0 loop; outro tenantnãole destinos.

  - Caso de autoridade: endpoint direto/worker com usuário removido ou recurso cruzado retorna 403/404, publica 0 resultados para o cliente e não expõe segredo. Receipts técnicos já recebidos ficam só no escopo autorizado.

- [ ] **Step 2 — confirmar RED:** `rtk proxy node scripts/test-integration.mjs 07c1-api-webhooks`. Esperado: falha pela regra de serviço ainda ausente; banco criado pelo runner é efêmero _test, nunca o banco operacional.
- [ ] **Step 3 — implementar serviço:** usar as assinaturas declaradas, validação Zod, transações/locks/leases e deduplicação. Envelopev 1 emitido com efeito de domínio na mesmatransação; templates de eventos entram/qualifica/responde/agenda/handoff. HMACSHA256 corpo+timestamp com janela 5 min; recipient pode deduplicar eventid. Validar DNS/IP/HTTPS/redirecionamento em cada tentativa, bloquear redesprivadas; timeout 10 s/corpo 256KiB; retries 1 min/5 min/30 min/2 h/6 h até 24 h apenas 429/5 xx/rede. Incerto registrado e entrega at-least-once explícita, não prometer exactly-once externo. Tokenmetadata/segredo mostradosuma vez; revoke cancela pendências. Não ampliar permissões para fazer teste passar. Task 2 cobre todos os itens de Review Focus; nenhum caso fica delegado apenas à observação visual.
- [ ] **Step 4 — GREEN e commit:** repetir a suíte focada; comparar os efeitos reais no banco/adapter com asserções e confirmar 0 efeitos inesperados. Commitar apenas os arquivos do pacote.

### Task 3: HTTP, UI/UX e aceite do pacote

**Files:** rotas/clientes novos listados na estrutura, `src/modules/settings/reference-settings.tsx` e relatório de validação do pacote.

**Interfaces:** Consome serviços da Task 2 e expõe os mesmos estados ao usuário, sem simular resultado nem autorização no browser. Se 07D for excluído, não criar superfícies deproduto e registrar a decisão como entrega do gate.

- [ ] **Step 1 — RED de contrato HTTP:** acrescentar à suíte focada pedido anônimo 401/403, papel proibido 403, input inválido 422, revisão conflitante 409 e repetição idempotente quando houver mutação; para avaliadorCLI, manifesto incompleto retorna exitcode nãozero e relatório de pendências. Confirmar falha antes do handler/avaliador.
- [ ] **Step 2 — ligar operações:** GET/POST /api/integrations para destinos e credenciais revisados; POST /:id/{rotate,revoke,retry}; GET /api/v1/leads e /events com Bearer escopado; comandoescrita reviewed via mesmo serviço de domínio, não CRUDlivre Modal de destino, eventos, histórico/status/retentar e chave copiável reais; só mostrar entrega depois da resposta/receipt. Semtextarea de payload arbitrário. Gates de menu são só apresentação; serviço continua autoritativo. Estados de erro/loading/empty/partial/revoke e limites têm ação de recuperação e não apagam rascunho.
- [ ] **Step 3 — conferir visual e jornada:** `/settings/webhooks`, `/settings/apps`, `/executions/[id]`. Comparar com evidência disponível da referência no mesmo estado em 1920×855/390×844; checar 320 px, foco/escape/scroll, loading/falha/limite/sucesso. Mascarar dados e restaurar contexto de navegação/QA. Registrar desconhecidos da referência em separado.
- [ ] **Step 4 — verificação e aceite:** focados GREEN → `rtk proxy npm test` → `rtk proxy npm run test:integration` → `rtk proxy npm run build` → `rtk proxy npm run typecheck` → `rtk proxy git diff --check`. Todos passam ou o pacote fica pendente com falha reproduzível. No pacote puramente documental/gate excluído, rodar validador de documentos/links e suíte focada correspondente, sem testes de produto não alterado.
- [ ] **Step 5 — fechamento:** escrever relatório com casos, evidências/limitações, cleanupQA, restore de políticas/destinos, custos/saldo quando aplicável e estado de runtime. Revisão final conforme execução nativa; corrigir achados com regressão. Atualizar linha do índice/roadmap somente pelo aceite efetivo e commit local focado.

## Gate externo e critério específico

Não enviar webhook de teste a URLexterna sem autorização. Piloto usa destino controlado com assinatura/idempotência verificados.

## Self-review do plano

R15 mapeados às três tarefas. DTOs e funções têm uma definição neste plano e no desenho de área; contratos comuns evitam reinterpretar autorização/revisão. Task 1 cobre regra pura/persistência;Task 2 cobre todos os itens de Review Focus;Task 3 cobre o que a pessoa realmente consegue operar e ver. Dados/arquivos citados como Create são futuros; Modify foi conferido no baseline ou tem pacote anterior proprietário. Escrever um plano não equivale a passar seus testes.
