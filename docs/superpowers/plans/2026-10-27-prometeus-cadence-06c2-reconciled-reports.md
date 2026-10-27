# 06C.2 — Dashboard, relatórios e execuções reconciliados Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the native execution chosen by the user. Follow tasks in order; perform a fresh final review at execution time under the applicable execution skill. This session authors plans only.

**Goal:** Dashboard, relatórios e execuções reconciliados; requisitos R10 do PRD.
**Architecture:** Evoluir serviços do monólito com os contratos da área; reutilizar autoridade, banco, jobs, ledger e eventos existentes. Novas interfaces listadas são contratos planejados, não funções já implementadas.
**Tech Stack:** Next 16.4.2, React 19.3.1, TypeScript 5.9.3, PostgreSQL/pg, Zod e node:test existentes; navegador de QA já disponível para UI.
**Spec:** [desenho da área](../specs/2026-10-27-prometeus-cadence-operations-design.md), [PRD](../specs/2026-10-27-prometeus-cadence-complete-prd.md), [contratos comuns](../specs/2026-10-27-prometeus-cadence-technical-contracts.md).

## Global Constraints

- Pacote planejado; não marcado concluído. Dependências: 06D.2, 06B.5, 06C.1. Ordem vigente no índice geral;07D só executa produto após seu gate.
- Apify/LLM centrais; contexto, canais, dados, cache, quota e resultados privados por workspace. Sem autoelevação de owner a admin da plataforma.
- Preservar trial de 7 dias, consumo pré-pago e OpenWA 20 mensagens/5 novoscontatos por dia; intervalo 60–180 s e demais gates existentes.
- Fidelidade ao CadenceFlow por rota/estado/viewport; não criar outra estética. Estados da referência não observados permanecem classificados.
- Mutações revisadas/idempotentes; I/O incerto não autoriza repetição. Piloto/cobrança/envio externo exigem contas/ações próprias autorizadas, não são iniciados por este plano.

## Review Focus

1. reply humano/DSN/timeout/retry produzem contagem correta e drilldown iguala total
2. evento repetido/atrasado/rebuild produz mesmo agregado que fontes autoritativas
3. virada dedata/DST/fuso e período vazio sem vazamento entre 2 workspaces
4. 10 mil eventos e 10 mil leads: APIs locais aquecidasp 95<=250 ms no perfil 06C.1; não publicar SLOpúblico a partir dele
5. A chamada HTTP/SQL direta e a revogação durante I/O não podem ampliar autoridade; resposta/log/evidência não incluem segredos nem conteúdo de outro workspace.

## File Structure

- Create: `src/domain/reporting.ts`.
- Create: `src/server/operations/reports.ts`.
- Create: `src/server/operations/projections.ts`.
- Create: `src/app/api/reports/route.ts`.
- Create: `src/app/api/reports/[id]/route.ts`.
- Create: `src/client/report-client.ts`.
- Create: `db/migrations/089-report-projections.sql`.
- Create: `tests/06c2-reconciled-reports.test.ts`.
- Create: `tests/integration/06c2-reconciled-reports.test.ts`.
- Modify: `src/server/messaging/metrics.ts`.
- Modify: `src/server/operations/repository.ts`.
- Modify: `src/modules/dashboard/dashboard.tsx`.
- Modify: `src/modules/reports/reports.tsx`.
- Modify: `src/modules/cadences/cadence-insights.tsx`.
- Modify: `src/modules/automations/runtime-history.tsx`.
- Modify: `scripts/test-integration.mjs`.
- Evidence: `docs/validation/06c2-reconciled-reports.md` e `docs/validation/evidence/06c2-reconciled-reports/` com relatório/manifest/capturas mascaradas. Não gerar evidência de sucesso antes de executar.

## Interfaces e dados

Consome Principal/withWorkspaceTransaction/requirePermission/AppError atuais; Reviewed/Confirm/EvidenceRef/EffectResult conforme contratos comuns quando aplicáveis. A API de frontend não recebePrincipal do cliente. Reusar um serviço existente com assinatura equivalente via adaptação explícita antes de criar duplicação.

```ts
type ReportQuery={view:"dashboard"|"cadences"|"executions"|"funnel",from:string,to:string,timezone:string,cadenceId?:string,cursor?:string};
type ReportView={period:{from:string,to:string,timezone:string},totals:Record<string,number|null>,series:{date:string,values:Record<string,number|null>}[],items:unknown[],nextCursor:string|null,asOf:string,stale:boolean};
declare function readReport(p:Principal,input:ReportQuery):Promise<ReportView>;
declare function rebuildReportProjection(p:Principal,input:{from:string;to:string}):Promise<{checkpoint:string;rows:number}>;
```

**Entrada HTTP/CLI:** GET /api/reports?view=dashboard|cadences|executions|funnel&from&to&timezone&cadenceId&cursor; GET /api/reports/:id para detalhe autorizado

**Persistência:** report_projection_checkpoint, report_daily_projection; UNIQUE(workspace_id,projection_version,period,key); replay ordenado sem alterar fontes Migração reservada`db/migrations/089-report-projections.sql`; não editar 001–082 aplicadas.

### Task 1: Contrato de domínio e persistência autorizada

**Files:** `src/domain/reporting.ts`, `tests/06c2-reconciled-reports.test.ts`, `db/migrations/089-report-projections.sql`; DTOs deste plano pertencem ao domínio do pacote.

**Interfaces:** Produz `supportedMetric(input:{supported:boolean;value:number}):number|null` e os DTOs acima. Consome os contratos comuns e formatos existentes da área.

- [ ] **Step 1 — RED:** criar `tests/06c2-reconciled-reports.test.ts` com o caso abaixo e variações de limite/ausência. Indisponibilidade de telemetria não aparece como zero medido.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {supportedMetric} from '../src/domain/reporting.ts';
test('06C.2 preserva a regra do domínio',()=>{
  assert.deepEqual(supportedMetric({"supported":false,"value":0}),null);
});
```

- [ ] **Step 2 — confirmar RED:** `rtk proxy node --experimental-strip-types --test tests/06c2-reconciled-reports.test.ts`. Esperado: teste falha pela função/regra ausente; corrigir antes erros de fixture/sintaxe que mascarem a regra.
- [ ] **Step 3 — implementar:** definir os tipos e a função acima. Criar migração com tabelas/índices/FKs descritos, RLS forçada por workspace, funções worker mínimas e idempotência transacional; não conceder escrita ampla ao dispatcher. Projetar fatos por identidade/etapa/publicação e consumir eventos existentes; backfill limitado e retomável. Definir numerador/denominador de cada KPI no domínio. Somar mensagens únicas e respostas humanas sem contar tentativas, períodos UTCabsolutos agrupados pelo fuso. Corrigir bounces/opt-outs por cadência que hoje voltam 0 apenas por haverfiltro. Drilldown usa mesmaquerybase; exporte colunaindisponível comnull. Sem snapshot inteiro para relatório.
- [ ] **Step 4 — GREEN e commit:** repetir exatamente o comando RED até passar; conferir tipos/contratos e commit local focado, sem push/deploy implícito.

### Task 2: Serviço, execução e invariantes de falha

**Files:** `src/server/operations/reports.ts`, `src/server/operations/projections.ts`, `src/app/api/reports/route.ts`, `src/app/api/reports/[id]/route.ts`, `tests/integration/06c2-reconciled-reports.test.ts`, `scripts/test-integration.mjs` e serviços existentes da área listados em Modify.

**Interfaces:** Consome DTOs/identidade e o resultado da Task 1; produz exatamente as funções de serviço declaradas neste plano. Dependências externas devem ser injetáveis nos testes, sem substituir autoridade real do banco.

- [ ] **Step 1 — RED de integração:** adicionar `06c2-reconciled-reports` à allowlist do runner. Reaproveitar fixtures de identidade/bancos/fechamento em tests/integration/helpers.ts e helpers da área; criar 2 workspaces e papéis próprios, sem usar contas/dados reais. Escrever os testes abaixo com contagens/estados/efeitos observáveis.

  - Caso 1: reply humano/DSN/timeout/retry produzem contagem correta e drilldown iguala total.
  - Caso 2: evento repetido/atrasado/rebuild produz mesmo agregado que fontes autoritativas.
  - Caso 3: virada dedata/DST/fuso e período vazio sem vazamento entre 2 workspaces.
  - Caso 4: 10 mil eventos e 10 mil leads: APIs locais aquecidasp 95<=250 ms no perfil 06C.1; não publicar SLOpúblico a partir dele.

  - Caso de autoridade: endpoint direto/worker com usuário removido ou recurso cruzado retorna 403/404, publica 0 resultados para o cliente e não expõe segredo. Receipts técnicos já recebidos ficam só no escopo autorizado.

- [ ] **Step 2 — confirmar RED:** `rtk proxy node scripts/test-integration.mjs 06c2-reconciled-reports`. Esperado: falha pela regra de serviço ainda ausente; banco criado pelo runner é efêmero _test, nunca o banco operacional.
- [ ] **Step 3 — implementar serviço:** usar as assinaturas declaradas, validação Zod, transações/locks/leases e deduplicação. Projetar fatos por identidade/etapa/publicação e consumir eventos existentes; backfill limitado e retomável. Definir numerador/denominador de cada KPI no domínio. Somar mensagens únicas e respostas humanas sem contar tentativas, períodos UTCabsolutos agrupados pelo fuso. Corrigir bounces/opt-outs por cadência que hoje voltam 0 apenas por haverfiltro. Drilldown usa mesmaquerybase; exporte colunaindisponível comnull. Sem snapshot inteiro para relatório. Não ampliar permissões para fazer teste passar. Task 2 cobre todos os itens de Review Focus; nenhum caso fica delegado apenas à observação visual.
- [ ] **Step 4 — GREEN e commit:** repetir a suíte focada; comparar os efeitos reais no banco/adapter com asserções e confirmar 0 efeitos inesperados. Commitar apenas os arquivos do pacote.

### Task 3: HTTP, UI/UX e aceite do pacote

**Files:** rotas/clientes novos listados na estrutura, `src/modules/dashboard/dashboard.tsx`, `src/modules/reports/reports.tsx`, `src/modules/cadences/cadence-insights.tsx`, `src/modules/automations/runtime-history.tsx` e relatório de validação do pacote.

**Interfaces:** Consome serviços da Task 2 e expõe os mesmos estados ao usuário, sem simular resultado nem autorização no browser. Se 07D for excluído, não criar superfícies deproduto e registrar a decisão como entrega do gate.

- [ ] **Step 1 — RED de contrato HTTP:** acrescentar à suíte focada pedido anônimo 401/403, papel proibido 403, input inválido 422, revisão conflitante 409 e repetição idempotente quando houver mutação; para avaliadorCLI, manifesto incompleto retorna exitcode nãozero e relatório de pendências. Confirmar falha antes do handler/avaliador.
- [ ] **Step 2 — ligar operações:** GET /api/reports?view=dashboard|cadences|executions|funnel&from&to&timezone&cadenceId&cursor; GET /api/reports/:id para detalhe autorizado Filtros, cards, gráficos, funil, tabela e detalhe seguem referência; mostrar atualização/indisponível/erro sem inventar dados. Evento atualiza consulta preservando período e edição. Gates de menu são só apresentação; serviço continua autoritativo. Estados de erro/loading/empty/partial/revoke e limites têm ação de recuperação e não apagam rascunho.
- [ ] **Step 3 — conferir visual e jornada:** `/dashboard`, `/reports`, `/reports/[tab]`, `/executions`, `/executions/[id]`, `/cadences/[id]`. Comparar com evidência disponível da referência no mesmo estado em 1920×855/390×844; checar 320 px, foco/escape/scroll, loading/falha/limite/sucesso. Mascarar dados e restaurar contexto de navegação/QA. Registrar desconhecidos da referência em separado.
- [ ] **Step 4 — verificação e aceite:** focados GREEN → `rtk proxy npm test` → `rtk proxy npm run test:integration` → `rtk proxy npm run build` → `rtk proxy npm run typecheck` → `rtk proxy git diff --check`. Todos passam ou o pacote fica pendente com falha reproduzível. No pacote puramente documental/gate excluído, rodar validador de documentos/links e suíte focada correspondente, sem testes de produto não alterado.
- [ ] **Step 5 — fechamento:** escrever relatório com casos, evidências/limitações, cleanupQA, restore de políticas/destinos, custos/saldo quando aplicável e estado de runtime. Revisão final conforme execução nativa; corrigir achados com regressão. Atualizar linha do índice/roadmap somente pelo aceite efetivo e commit local focado.

## Gate externo e critério específico

Projeção pode ser reconstruída; indicadoratualizado só após checkpoint confirmado. Métrica não fornecida pelo canal continua indisponível.

## Self-review do plano

R10 mapeados às três tarefas. DTOs e funções têm uma definição neste plano e no desenho de área; contratos comuns evitam reinterpretar autorização/revisão. Task 1 cobre regra pura/persistência;Task 2 cobre todos os itens de Review Focus;Task 3 cobre o que a pessoa realmente consegue operar e ver. Dados/arquivos citados como Create são futuros; Modify foi conferido no baseline ou tem pacote anterior proprietário. Escrever um plano não equivale a passar seus testes.
