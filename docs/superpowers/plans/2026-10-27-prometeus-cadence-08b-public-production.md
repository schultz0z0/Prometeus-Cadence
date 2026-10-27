# 08B — Homologação e operação de produção pública Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the native execution chosen by the user. Follow tasks in order; perform a fresh final review at execution time under the applicable execution skill. This session authors plans only.

**Goal:** Homologação e operação de produção pública; requisitos R25, R26, R01 do PRD.
**Architecture:** Evoluir serviços do monólito com os contratos da área; reutilizar autoridade, banco, jobs, ledger e eventos existentes. Novas interfaces listadas são contratos planejados, não funções já implementadas.
**Tech Stack:** Next 16.4.2, React 19.3.1, TypeScript 5.9.3, PostgreSQL/pg, Zod e node:test existentes; navegador de QA já disponível para UI.
**Spec:** [desenho da área](../specs/2026-10-27-prometeus-cadence-release-design.md), [PRD](../specs/2026-10-27-prometeus-cadence-complete-prd.md), [contratos comuns](../specs/2026-10-27-prometeus-cadence-technical-contracts.md).

## Global Constraints

- Pacote planejado; não marcado concluído. Dependências: 08A. Ordem vigente no índice geral;07D só executa produto após seu gate.
- Apify/LLM centrais; contexto, canais, dados, cache, quota e resultados privados por workspace. Sem autoelevação de owner a admin da plataforma.
- Preservar trial de 7 dias, consumo pré-pago e OpenWA 20 mensagens/5 novoscontatos por dia; intervalo 60–180 s e demais gates existentes.
- Fidelidade ao CadenceFlow por rota/estado/viewport; não criar outra estética. Estados da referência não observados permanecem classificados.
- Mutações revisadas/idempotentes; I/O incerto não autoriza repetição. Piloto/cobrança/envio externo exigem contas/ações próprias autorizadas, não são iniciados por este plano.

## Review Focus

1. restaurarbackup emambienteisolado comprova dados/arquivos/quotas e proíbe dispatch no restore; falhadechave vira bloqueio
2. perfilcontrolado 50 tenantsx 10 milleads,25 sessões,10 req/s por 30 min;APIsinternas p 95<=500 ms e erros<1%;browserLCP<=2.5 s emperfilrede declarada, semcontartempodefontesexternascomoAPIsíncrona
3. soak 24 h,kill/restart/429/timeoutse credencialrevogada:0 efeitosduplicados, fila progride eclientepequeno nãofica faminto
4. modoStripeinvertido/chavesincompatíveis bloqueiamstartup;ressuscitarbanco nãoenviawebhooks/mensagens;proxyIPforjadenãoburla ratelimit
5. A chamada HTTP/SQL direta e a revogação durante I/O não podem ampliar autoridade; resposta/log/evidência não incluem segredos nem conteúdo de outro workspace.

## File Structure

- Create: `scripts/lib/release-readiness.ts`.
- Create: `scripts/verify-release-readiness.mjs`.
- Create: `scripts/backup-database.mjs`.
- Create: `scripts/restore-database.mjs`.
- Create: `scripts/load-production-profile.mjs`.
- Create: `docs/runbooks/public-production.md`.
- Create: `docs/runbooks/disaster-recovery.md`.
- Create: `docker/production/compose.yml`.
- Create: `tests/08b-public-production.test.ts`.
- Create: `tests/integration/08b-public-production.test.ts`.
- Modify: `scripts/runtime-control.mjs`.
- Modify: `scripts/runtime-supervisor.ts`.
- Modify: `src/server/auth/auth.ts`.
- Modify: `src/server/auth/mail.ts`.
- Modify: `src/server/billing/config.ts`.
- Modify: `src/server/billing/signature.ts`.
- Modify: `src/server/prospecting/config.ts`.
- Modify: `src/server/db/config.ts`.
- Modify: `scripts/test-integration.mjs`.
- Evidence: `docs/validation/08b-public-production.md` e `docs/validation/evidence/08b-public-production/` com relatório/manifest/capturas mascaradas. Não gerar evidência de sucesso antes de executar.

## Interfaces e dados

Consome Principal/withWorkspaceTransaction/requirePermission/AppError atuais; Reviewed/Confirm/EvidenceRef/EffectResult conforme contratos comuns quando aplicáveis. A API de frontend não recebePrincipal do cliente. Reusar um serviço existente com assinatura equivalente via adaptação explícita antes de criar duplicação.

```ts
type ProductionInputs={origin:string,backupEvidence:string,rollbackEvidence:string,providerAttestations:string[],loadEvidence:string};
type ProductionReadinessReport={ready:boolean,blockers:string[],checks:{name:string,passed:boolean,evidence:string}[]};
declare function verifyProductionReadiness(input:ProductionInputs):Promise<ProductionReadinessReport>;
```

**Entrada HTTP/CLI:** ReadinessGET privado admin/health separado de livenesssemsegredos; app público apenas reverseproxyHTTPS; entradawebhookassinada eOAuthorigens reais. NenhumadminDBexposto.

**Persistência:** Manifest/evidências de validação; nenhuma migração de produto neste pacote.

### Task 1: Contrato de domínio e persistência autorizada

**Files:** `scripts/lib/release-readiness.ts`, `tests/08b-public-production.test.ts`; DTOs deste plano pertencem ao domínio do pacote.

**Interfaces:** Produz `productionReleaseAllowed(input:{restoreVerified:boolean;tenantIsolationPassed:boolean;externalGrantsReady:boolean;rollbackReady:boolean}):boolean` e os DTOs acima. Consome os contratos comuns e formatos existentes da área.

- [ ] **Step 1 — RED:** criar `tests/08b-public-production.test.ts` com o caso abaixo e variações de limite/ausência. Semrestauração testada não liberar produção.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionReleaseAllowed} from '../scripts/lib/release-readiness.ts';
test('08B preserva a regra do domínio',()=>{
  assert.deepEqual(productionReleaseAllowed({"restoreVerified":false,"tenantIsolationPassed":true,"externalGrantsReady":true,"rollbackReady":true}),false);
});
```

- [ ] **Step 2 — confirmar RED:** `rtk proxy node --experimental-strip-types --test tests/08b-public-production.test.ts`. Esperado: teste falha pela função/regra ausente; corrigir antes erros de fixture/sintaxe que mascarem a regra.
- [ ] **Step 3 — implementar:** definir os tipos e a função acima. Implementar o avaliador puro de cobertura/readiness sem afirmar execução de produto. DeployDockerLinux emhostdefinido pelooperador, volumeDB/blobs/sessõesOpenWAprivados, health/restart/drain. ConfigurartrustedproxyIPreal,securecookies/origin/CSP/CSRF, allowlistcallbacks, autenticaçãoadmin e SMTPtransacionalreal(replaceMailhog). Stripehojevalida livemodefalse: introduzir modoexplicitotest/live comchaves/webhook/catalogoseparados e validaçãoconsistente,default test eefeitoslive somente apósativaçãoexpressa. PublichostedChatGPTOAuth exigehabilitação própria ou usarAPI central suportada; não assumirpermissãocomercial. Backupcriptografadodiário+WAL/PITR seinfraoferecer; alvoRPO<=24 h/RTO<=4 h demonstradosemrestoreisolado. Fillidempotentedos 40 grantsantigosreferênciaP3, preservarledger. Migraçãoforwardcompat/rollbackapp, nuncaeditar 082 anteriores.
- [ ] **Step 4 — GREEN e commit:** repetir exatamente o comando RED até passar; conferir tipos/contratos e commit local focado, sem push/deploy implícito.

### Task 2: Serviço, execução e invariantes de falha

**Files:** `scripts/verify-release-readiness.mjs`, `scripts/backup-database.mjs`, `scripts/restore-database.mjs`, `scripts/load-production-profile.mjs`, `docs/runbooks/public-production.md`, `docs/runbooks/disaster-recovery.md`, `docker/production/compose.yml`, `tests/integration/08b-public-production.test.ts`, `scripts/test-integration.mjs` e serviços existentes da área listados em Modify.

**Interfaces:** Consome DTOs/identidade e o resultado da Task 1; produz exatamente as funções de serviço declaradas neste plano. Dependências externas devem ser injetáveis nos testes, sem substituir autoridade real do banco.

- [ ] **Step 1 — RED de integração:** adicionar `08b-public-production` à allowlist do runner. Reaproveitar fixtures de identidade/bancos/fechamento em tests/integration/helpers.ts e helpers da área; criar 2 workspaces e papéis próprios, sem usar contas/dados reais. Escrever os testes abaixo com contagens/estados/efeitos observáveis.

  - Caso 1: restaurarbackup emambienteisolado comprova dados/arquivos/quotas e proíbe dispatch no restore; falhadechave vira bloqueio.
  - Caso 2: perfilcontrolado 50 tenantsx 10 milleads,25 sessões,10 req/s por 30 min;APIsinternas p 95<=500 ms e erros<1%;browserLCP<=2.5 s emperfilrede declarada, semcontartempodefontesexternascomoAPIsíncrona.
  - Caso 3: soak 24 h,kill/restart/429/timeoutse credencialrevogada:0 efeitosduplicados, fila progride eclientepequeno nãofica faminto.
  - Caso 4: modoStripeinvertido/chavesincompatíveis bloqueiamstartup;ressuscitarbanco nãoenviawebhooks/mensagens;proxyIPforjadenãoburla ratelimit.

  - Caso de autoridade: endpoint direto/worker com usuário removido ou recurso cruzado retorna 403/404, publica 0 resultados para o cliente e não expõe segredo. Receipts técnicos já recebidos ficam só no escopo autorizado.

- [ ] **Step 2 — confirmar RED:** `rtk proxy node scripts/test-integration.mjs 08b-public-production`. Esperado: falha pela regra de serviço ainda ausente; banco criado pelo runner é efêmero _test, nunca o banco operacional.
- [ ] **Step 3 — implementar serviço:** usar as assinaturas declaradas, validação Zod, transações/locks/leases e deduplicação. DeployDockerLinux emhostdefinido pelooperador, volumeDB/blobs/sessõesOpenWAprivados, health/restart/drain. ConfigurartrustedproxyIPreal,securecookies/origin/CSP/CSRF, allowlistcallbacks, autenticaçãoadmin e SMTPtransacionalreal(replaceMailhog). Stripehojevalida livemodefalse: introduzir modoexplicitotest/live comchaves/webhook/catalogoseparados e validaçãoconsistente,default test eefeitoslive somente apósativaçãoexpressa. PublichostedChatGPTOAuth exigehabilitação própria ou usarAPI central suportada; não assumirpermissãocomercial. Backupcriptografadodiário+WAL/PITR seinfraoferecer; alvoRPO<=24 h/RTO<=4 h demonstradosemrestoreisolado. Fillidempotentedos 40 grantsantigosreferênciaP3, preservarledger. Migraçãoforwardcompat/rollbackapp, nuncaeditar 082 anteriores. Não ampliar permissões para fazer teste passar. Task 2 cobre todos os itens de Review Focus; nenhum caso fica delegado apenas à observação visual.
- [ ] **Step 4 — GREEN e commit:** repetir a suíte focada; comparar os efeitos reais no banco/adapter com asserções e confirmar 0 efeitos inesperados. Commitar apenas os arquivos do pacote.

### Task 3: HTTP, UI/UX e aceite do pacote

**Files:** rotas/clientes novos listados na estrutura, inventário/relatórios da estrutura e relatório de validação do pacote.

**Interfaces:** Consome serviços da Task 2 e expõe os mesmos estados ao usuário, sem simular resultado nem autorização no browser. Se 07D for excluído, não criar superfícies deproduto e registrar a decisão como entrega do gate.

- [ ] **Step 1 — RED de contrato HTTP:** acrescentar à suíte focada pedido anônimo 401/403, papel proibido 403, input inválido 422, revisão conflitante 409 e repetição idempotente quando houver mutação; para avaliadorCLI, manifesto incompleto retorna exitcode nãozero e relatório de pendências. Confirmar falha antes do handler/avaliador.
- [ ] **Step 2 — ligar operações:** ReadinessGET privado admin/health separado de livenesssemsegredos; app público apenas reverseproxyHTTPS; entradawebhookassinada eOAuthorigens reais. NenhumadminDBexposto. Mensagensdeerro deprodução segurasúteis, suporte/statusfuncionais; origemsempreHTTPS e links/callbacks corretos. Semterminalsvisíveis em Windowslocal; produção semdependência dodesktop. Gates de menu são só apresentação; serviço continua autoritativo. Estados de erro/loading/empty/partial/revoke e limites têm ação de recuperação e não apagam rascunho.
- [ ] **Step 3 — conferir visual e jornada:** `/login`, `/register`, `/dashboard`, `/settings/plan`, `/settings/ai`, `todas jornadas públicas de08A`. Comparar com evidência disponível da referência no mesmo estado em 1920×855/390×844; checar 320 px, foco/escape/scroll, loading/falha/limite/sucesso. Mascarar dados e restaurar contexto de navegação/QA. Registrar desconhecidos da referência em separado.
- [ ] **Step 4 — verificação e aceite:** focados GREEN → `rtk proxy npm test` → `rtk proxy npm run test:integration` → `rtk proxy npm run build` → `rtk proxy npm run typecheck` → `rtk proxy git diff --check`. Todos passam ou o pacote fica pendente com falha reproduzível. No pacote puramente documental/gate excluído, rodar validador de documentos/links e suíte focada correspondente, sem testes de produto não alterado.
- [ ] **Step 5 — fechamento:** escrever relatório com casos, evidências/limitações, cleanupQA, restore de políticas/destinos, custos/saldo quando aplicável e estado de runtime. Revisão final conforme execução nativa; corrigir achados com regressão. Atualizar linha do índice/roadmap somente pelo aceite efetivo e commit local focado.

## Gate externo e critério específico

Entradasmanuais: domínio/host/acessos, identificação/documentosjurídicosdefinitivos, DNS/SMTP, aprovações deprovedor, budget/contasde QA. Não marcar deploypúblico/pagamentolive pronto semessasprovas e açãoexternaautorizada. Código e runbookprontos não significamproduçãoativada.

## Self-review do plano

R25, R26, R01 mapeados às três tarefas. DTOs e funções têm uma definição neste plano e no desenho de área; contratos comuns evitam reinterpretar autorização/revisão. Task 1 cobre regra pura/persistência;Task 2 cobre todos os itens de Review Focus;Task 3 cobre o que a pessoa realmente consegue operar e ver. Dados/arquivos citados como Create são futuros; Modify foi conferido no baseline ou tem pacote anterior proprietário. Escrever um plano não equivale a passar seus testes.
