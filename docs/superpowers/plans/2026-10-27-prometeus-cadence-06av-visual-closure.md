# 06A-V — Fechamento visual contínuo e diferenças residuais Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the native execution chosen by the user. Follow tasks in order; perform a fresh final review at execution time under the applicable execution skill. This session authors plans only.

**Goal:** Fechamento visual contínuo e diferenças residuais; requisitos R24 do PRD.
**Architecture:** Evoluir serviços do monólito com os contratos da área; reutilizar autoridade, banco, jobs, ledger e eventos existentes. Novas interfaces listadas são contratos planejados, não funções já implementadas.
**Tech Stack:** Next 16.4.2, React 19.3.1, TypeScript 5.9.3, PostgreSQL/pg, Zod e node:test existentes; navegador de QA já disponível para UI.
**Spec:** [desenho da área](../specs/2026-10-27-prometeus-cadence-release-design.md), [PRD](../specs/2026-10-27-prometeus-cadence-complete-prd.md), [contratos comuns](../specs/2026-10-27-prometeus-cadence-technical-contracts.md).

## Global Constraints

- Pacote planejado; não marcado concluído. Dependências: áreas existentes; porta contínua. Ordem vigente no índice geral;07D só executa produto após seu gate.
- Apify/LLM centrais; contexto, canais, dados, cache, quota e resultados privados por workspace. Sem autoelevação de owner a admin da plataforma.
- Preservar trial de 7 dias, consumo pré-pago e OpenWA 20 mensagens/5 novoscontatos por dia; intervalo 60–180 s e demais gates existentes.
- Fidelidade ao CadenceFlow por rota/estado/viewport; não criar outra estética. Estados da referência não observados permanecem classificados.
- Mutações revisadas/idempotentes; I/O incerto não autoriza repetição. Piloto/cobrança/envio externo exigem contas/ações próprias autorizadas, não são iniciados por este plano.

## Review Focus

1. inventáriocomestadofaltante/nocapture ebaselineantiga gera pendência, nãoaceite
2. controlevisível semexecutor falha mesmo截图igual; relatório não soma visita comoprova
3. 390/320 semoverflow e modallongo comscroll/focoresguardado
4. prefdark/textosize/zoomnão apagamcontroles nemdados; unobservedcontinua separado
5. A chamada HTTP/SQL direta e a revogação durante I/O não podem ampliar autoridade; resposta/log/evidência não incluem segredos nem conteúdo de outro workspace.

## File Structure

- Create: `scripts/lib/visual-coverage.ts`.
- Create: `scripts/audit-visual-coverage.mjs`.
- Create: `tests/fixtures/visual-coverage.json`.
- Create: `tests/06av-visual-closure.test.ts`.
- Create: `tests/integration/06av-visual-closure.test.ts`.
- Modify: `docs/reverse-engineering/visual-2026-10-25/inventory/coverage.md`.
- Modify: `docs/reverse-engineering/visual-2026-10-25/design/gaps.md`.
- Modify: `src/app/visual-detail-refinements.css`.
- Modify: `src/modules/settings/context.tsx`.
- Modify: `scripts/test-integration.mjs`.
- Evidence: `docs/validation/06av-visual-closure.md` e `docs/validation/evidence/06av-visual-closure/` com relatório/manifest/capturas mascaradas. Não gerar evidência de sucesso antes de executar.

## Interfaces e dados

Consome Principal/withWorkspaceTransaction/requirePermission/AppError atuais; Reviewed/Confirm/EvidenceRef/EffectResult conforme contratos comuns quando aplicáveis. A API de frontend não recebePrincipal do cliente. Reusar um serviço existente com assinatura equivalente via adaptação explícita antes de criar duplicação.

```ts
type VisualCoverageInput={inventoryPath:string,evidenceRoot:string};
type VisualCoverageReport={total:number,compared:number,openDifferences:string[],unknownReference:string[],approvedExceptions:string[]};
declare function auditVisualCoverage(input:VisualCoverageInput):Promise<VisualCoverageReport>;
```

**Entrada HTTP/CLI:** NenhumaAPI nova. Usar rotasautorizadas existentes; conferir controles e requestsapenasnosescopos de QA.

**Persistência:** Manifest/evidências de validação; nenhuma migração de produto neste pacote.

### Task 1: Contrato de domínio e persistência autorizada

**Files:** `scripts/lib/visual-coverage.ts`, `tests/06av-visual-closure.test.ts`; DTOs deste plano pertencem ao domínio do pacote.

**Interfaces:** Produz `visualStateAccepted(input:{referenceObserved:boolean;localCompared:boolean;openDifferences:number;approvedException:boolean}):boolean` e os DTOs acima. Consome os contratos comuns e formatos existentes da área.

- [ ] **Step 1 — RED:** criar `tests/06av-visual-closure.test.ts` com o caso abaixo e variações de limite/ausência. Comparar local semestadoobservado não prova réplica 100%.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {visualStateAccepted} from '../scripts/lib/visual-coverage.ts';
test('06A-V preserva a regra do domínio',()=>{
  assert.deepEqual(visualStateAccepted({"referenceObserved":false,"localCompared":true,"openDifferences":0,"approvedException":false}),false);
});
```

- [ ] **Step 2 — confirmar RED:** `rtk proxy node --experimental-strip-types --test tests/06av-visual-closure.test.ts`. Esperado: teste falha pela função/regra ausente; corrigir antes erros de fixture/sintaxe que mascarem a regra.
- [ ] **Step 3 — implementar:** definir os tipos e a função acima. Implementar o avaliador puro de cobertura/readiness sem afirmar execução de produto. Importarinventário 50 rotas/estados/overlays já conhecido; não repetirvarredura inteira semmudança. Priorizarresíduos documentadosEV271(contextocampos/ícones/feedback) e diferençaspréexistentes porárea. Medirgeometria/fonte/espaçamento/cor/foco/carga/falha, comparar antes/depoismesmo viewport/dados; CSScompartilhado nãoaceita todasinstâncias. Arte/brandingpróprios ficam divergências classificadas. Cada pacote adicionaprópriosexemplos e 08Aconsolida.
- [ ] **Step 4 — GREEN e commit:** repetir exatamente o comando RED até passar; conferir tipos/contratos e commit local focado, sem push/deploy implícito.

### Task 2: Serviço, execução e invariantes de falha

**Files:** `scripts/audit-visual-coverage.mjs`, `tests/fixtures/visual-coverage.json`, `tests/integration/06av-visual-closure.test.ts`, `scripts/test-integration.mjs` e serviços existentes da área listados em Modify.

**Interfaces:** Consome DTOs/identidade e o resultado da Task 1; produz exatamente as funções de serviço declaradas neste plano. Dependências externas devem ser injetáveis nos testes, sem substituir autoridade real do banco.

- [ ] **Step 1 — RED de integração:** adicionar `06av-visual-closure` à allowlist do runner. Reaproveitar fixtures de identidade/bancos/fechamento em tests/integration/helpers.ts e helpers da área; criar 2 workspaces e papéis próprios, sem usar contas/dados reais. Escrever os testes abaixo com contagens/estados/efeitos observáveis.

  - Caso 1: inventáriocomestadofaltante/nocapture ebaselineantiga gera pendência, nãoaceite.
  - Caso 2: controlevisível semexecutor falha mesmo截图igual; relatório não soma visita comoprova.
  - Caso 3: 390/320 semoverflow e modallongo comscroll/focoresguardado.
  - Caso 4: prefdark/textosize/zoomnão apagamcontroles nemdados; unobservedcontinua separado.

  - Caso de autoridade: endpoint direto/worker com usuário removido ou recurso cruzado retorna 403/404, publica 0 resultados para o cliente e não expõe segredo. Receipts técnicos já recebidos ficam só no escopo autorizado.

- [ ] **Step 2 — confirmar RED:** `rtk proxy node scripts/test-integration.mjs 06av-visual-closure`. Esperado: falha pela regra de serviço ainda ausente; banco criado pelo runner é efêmero _test, nunca o banco operacional.
- [ ] **Step 3 — implementar serviço:** usar as assinaturas declaradas, validação Zod, transações/locks/leases e deduplicação. Importarinventário 50 rotas/estados/overlays já conhecido; não repetirvarredura inteira semmudança. Priorizarresíduos documentadosEV271(contextocampos/ícones/feedback) e diferençaspréexistentes porárea. Medirgeometria/fonte/espaçamento/cor/foco/carga/falha, comparar antes/depoismesmo viewport/dados; CSScompartilhado nãoaceita todasinstâncias. Arte/brandingpróprios ficam divergências classificadas. Cada pacote adicionaprópriosexemplos e 08Aconsolida. Não ampliar permissões para fazer teste passar. Task 2 cobre todos os itens de Review Focus; nenhum caso fica delegado apenas à observação visual.
- [ ] **Step 4 — GREEN e commit:** repetir a suíte focada; comparar os efeitos reais no banco/adapter com asserções e confirmar 0 efeitos inesperados. Commitar apenas os arquivos do pacote.

### Task 3: HTTP, UI/UX e aceite do pacote

**Files:** rotas/clientes novos listados na estrutura, `src/app/visual-detail-refinements.css`, `src/modules/settings/context.tsx` e relatório de validação do pacote.

**Interfaces:** Consome serviços da Task 2 e expõe os mesmos estados ao usuário, sem simular resultado nem autorização no browser. Se 07D for excluído, não criar superfícies deproduto e registrar a decisão como entrega do gate.

- [ ] **Step 1 — RED de contrato HTTP:** acrescentar à suíte focada pedido anônimo 401/403, papel proibido 403, input inválido 422, revisão conflitante 409 e repetição idempotente quando houver mutação; para avaliadorCLI, manifesto incompleto retorna exitcode nãozero e relatório de pendências. Confirmar falha antes do handler/avaliador.
- [ ] **Step 2 — ligar operações:** NenhumaAPI nova. Usar rotasautorizadas existentes; conferir controles e requestsapenasnosescopos de QA. Réplicainicial preservada; nenhumaestética nova nem substituição por cardsgenéricos. Capturascomdadospessoais mascaradas; acessibilidade/erro melhoram semalterarhierarquiaobservada. Gates de menu são só apresentação; serviço continua autoritativo. Estados de erro/loading/empty/partial/revoke e limites têm ação de recuperação e não apagam rascunho.
- [ ] **Step 3 — conferir visual e jornada:** `inventário completo routes.md`, `/settings/context`, `todas abas/popups por pacote`. Comparar com evidência disponível da referência no mesmo estado em 1920×855/390×844; checar 320 px, foco/escape/scroll, loading/falha/limite/sucesso. Mascarar dados e restaurar contexto de navegação/QA. Registrar desconhecidos da referência em separado.
- [ ] **Step 4 — verificação e aceite:** focados GREEN → `rtk proxy npm test` → `rtk proxy npm run test:integration` → `rtk proxy npm run build` → `rtk proxy npm run typecheck` → `rtk proxy git diff --check`. Todos passam ou o pacote fica pendente com falha reproduzível. No pacote puramente documental/gate excluído, rodar validador de documentos/links e suíte focada correspondente, sem testes de produto não alterado.
- [ ] **Step 5 — fechamento:** escrever relatório com casos, evidências/limitações, cleanupQA, restore de políticas/destinos, custos/saldo quando aplicável e estado de runtime. Revisão final conforme execução nativa; corrigir achados com regressão. Atualizar linha do índice/roadmap somente pelo aceite efetivo e commit local focado.

## Gate externo e critério específico

Estados pagos/conectados semsessãoautorizada permanecemnãoobservados; não contratarreferência para obter screenshot. Correçõeslocais não podemdeclará-losaceitos.

## Self-review do plano

R24 mapeados às três tarefas. DTOs e funções têm uma definição neste plano e no desenho de área; contratos comuns evitam reinterpretar autorização/revisão. Task 1 cobre regra pura/persistência;Task 2 cobre todos os itens de Review Focus;Task 3 cobre o que a pessoa realmente consegue operar e ver. Dados/arquivos citados como Create são futuros; Modify foi conferido no baseline ou tem pacote anterior proprietário. Escrever um plano não equivale a passar seus testes.
