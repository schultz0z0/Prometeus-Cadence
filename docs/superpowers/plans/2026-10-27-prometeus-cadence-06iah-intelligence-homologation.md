# 06IA-H — Homologação das fontes e inteligência Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the native execution chosen by the user. Follow tasks in order; perform a fresh final review at execution time under the applicable execution skill. This session authors plans only.

**Goal:** Homologação das fontes e inteligência; requisitos R06 do PRD.
**Architecture:** Evoluir serviços do monólito com os contratos da área; reutilizar autoridade, banco, jobs, ledger e eventos existentes. Novas interfaces listadas são contratos planejados, não funções já implementadas.
**Tech Stack:** Next 16.4.2, React 19.3.1, TypeScript 5.9.3, PostgreSQL/pg, Zod e node:test existentes; navegador de QA já disponível para UI.
**Spec:** [desenho da área](../specs/2026-10-27-prometeus-cadence-research-design.md), [PRD](../specs/2026-10-27-prometeus-cadence-complete-prd.md), [contratos comuns](../specs/2026-10-27-prometeus-cadence-technical-contracts.md).

## Global Constraints

- Pacote planejado; não marcado concluído. Dependências: 06B.5, 06IA. Ordem vigente no índice geral;07D só executa produto após seu gate.
- Apify/LLM centrais; contexto, canais, dados, cache, quota e resultados privados por workspace. Sem autoelevação de owner a admin da plataforma.
- Preservar trial de 7 dias, consumo pré-pago e OpenWA 20 mensagens/5 novoscontatos por dia; intervalo 60–180 s e demais gates existentes.
- Fidelidade ao CadenceFlow por rota/estado/viewport; não criar outra estética. Estados da referência não observados permanecem classificados.
- Mutações revisadas/idempotentes; I/O incerto não autoriza repetição. Piloto/cobrança/envio externo exigem contas/ações próprias autorizadas, não são iniciados por este plano.

## Review Focus

1. dataset com 0 dados não passa por denominadorzero; unknowncost não ézeroUSD
2. modo fixture executa 0HTTP e compara saída ao gabarito; modo live recusa orçamentoausente
3. versão de Actor/modelo/skill/contexto muda impressão daavaliação e invalidaatestadoantigo
4. fonte injetada não muda tarefa/provedor; caso comtelefone corporativo preservaabstenção pessoal
5. A chamada HTTP/SQL direta e a revogação durante I/O não podem ampliar autoridade; resposta/log/evidência não incluem segredos nem conteúdo de outro workspace.

## File Structure

- Create: `src/domain/research-evaluation.ts`.
- Create: `src/server/research/evaluation.ts`.
- Create: `scripts/evaluate-research.ts`.
- Create: `tests/fixtures/research-evaluation.json`.
- Create: `db/migrations/088-research-evaluations.sql`.
- Create: `tests/06iah-intelligence-homologation.test.ts`.
- Create: `tests/integration/06iah-intelligence-homologation.test.ts`.
- Modify: `scripts/evaluate-prospecting.mjs`.
- Modify: `src/domain/ai-skills.ts`.
- Modify: `src/server/prospecting/ai/decisors.ts`.
- Modify: `src/server/prospecting/ai/jev.ts`.
- Modify: `scripts/test-integration.mjs`.
- Evidence: `docs/validation/06iah-intelligence-homologation.md` e `docs/validation/evidence/06iah-intelligence-homologation/` com relatório/manifest/capturas mascaradas. Não gerar evidência de sucesso antes de executar.

## Interfaces e dados

Consome Principal/withWorkspaceTransaction/requirePermission/AppError atuais; Reviewed/Confirm/EvidenceRef/EffectResult conforme contratos comuns quando aplicáveis. A API de frontend não recebePrincipal do cliente. Reusar um serviço existente com assinatura equivalente via adaptação explícita antes de criar duplicação.

```ts
type EvaluationInput={datasetVersion:string,caseIds:string[],mode:"fixture"|"live-owned",maxCostUsd:number};
type EvaluationAdapters={run:(caseId:string)=>Promise<{facts:number,supported:number,attributionCorrect:number,costUsd:number|null,durationMs:number}>};
type EvaluationReport={runId:string,accepted:boolean,unsupportedFacts:number,crossTenantLeaks:number,attributionPrecision:number,coverage:number,costUsd:number|null,unknownCosts:number};
declare function evaluateResearch(input:EvaluationInput,deps:EvaluationAdapters):Promise<EvaluationReport>;
```

**Entrada HTTP/CLI:** Sem nova API de cliente. ExecuçãoCLI administrativa; leitura resumida apenas por admin da plataforma, reaproveitando guardplatformAI.

**Persistência:** ai_evaluation_run, ai_evaluation_case; snapshots de versões/receipts/métricassem dados brutos pessoais no relatório público Migração reservada`db/migrations/088-research-evaluations.sql`; não editar 001–082 aplicadas.

### Task 1: Contrato de domínio e persistência autorizada

**Files:** `src/domain/research-evaluation.ts`, `tests/06iah-intelligence-homologation.test.ts`, `db/migrations/088-research-evaluations.sql`; DTOs deste plano pertencem ao domínio do pacote.

**Interfaces:** Produz `acceptResearchEvaluation(input:{unsupportedFacts:number;crossTenantLeaks:number;attributionPrecision:number}):boolean` e os DTOs acima. Consome os contratos comuns e formatos existentes da área.

- [ ] **Step 1 — RED:** criar `tests/06iah-intelligence-homologation.test.ts` com o caso abaixo e variações de limite/ausência. Umfato semsuporte reprova o conjunto mesmo se precisão geral éalta.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptResearchEvaluation} from '../src/domain/research-evaluation.ts';
test('06IA-H preserva a regra do domínio',()=>{
  assert.deepEqual(acceptResearchEvaluation({"unsupportedFacts":1,"crossTenantLeaks":0,"attributionPrecision":1}),false);
});
```

- [ ] **Step 2 — confirmar RED:** `rtk proxy node --experimental-strip-types --test tests/06iah-intelligence-homologation.test.ts`. Esperado: teste falha pela função/regra ausente; corrigir antes erros de fixture/sintaxe que mascarem a regra.
- [ ] **Step 3 — implementar:** definir os tipos e a função acima. Criar migração com tabelas/índices/FKs descritos, RLS forçada por workspace, funções worker mínimas e idempotência transacional; não conceder escrita ampla ao dispatcher. Dataset versionado com 30 casos: empresascom/sem site, sociaisconfusas, QSAsemcontato, homônimos, gestor não sócio, fonte ausente e instruçãoinjetada. Avaliartradicional e híbrido com mesmasevidências. Gates próprios:0 vazamentos/0 fatossemcitação, precisão deatribuição>=95% sobre casosrotulados e 100%abstenção noscasos semsuporte; cobertura e custo reportados sem garantia comercial. Publicarversão de skill só após regressão;live opt-in tetoUSDpositivo e bloqueioquandoatingido.
- [ ] **Step 4 — GREEN e commit:** repetir exatamente o comando RED até passar; conferir tipos/contratos e commit local focado, sem push/deploy implícito.

### Task 2: Serviço, execução e invariantes de falha

**Files:** `src/server/research/evaluation.ts`, `scripts/evaluate-research.ts`, `tests/fixtures/research-evaluation.json`, `tests/integration/06iah-intelligence-homologation.test.ts`, `scripts/test-integration.mjs` e serviços existentes da área listados em Modify.

**Interfaces:** Consome DTOs/identidade e o resultado da Task 1; produz exatamente as funções de serviço declaradas neste plano. Dependências externas devem ser injetáveis nos testes, sem substituir autoridade real do banco.

- [ ] **Step 1 — RED de integração:** adicionar `06iah-intelligence-homologation` à allowlist do runner. Reaproveitar fixtures de identidade/bancos/fechamento em tests/integration/helpers.ts e helpers da área; criar 2 workspaces e papéis próprios, sem usar contas/dados reais. Escrever os testes abaixo com contagens/estados/efeitos observáveis.

  - Caso 1: dataset com 0 dados não passa por denominadorzero; unknowncost não ézeroUSD.
  - Caso 2: modo fixture executa 0HTTP e compara saída ao gabarito; modo live recusa orçamentoausente.
  - Caso 3: versão de Actor/modelo/skill/contexto muda impressão daavaliação e invalidaatestadoantigo.
  - Caso 4: fonte injetada não muda tarefa/provedor; caso comtelefone corporativo preservaabstenção pessoal.

  - Caso de autoridade: endpoint direto/worker com usuário removido ou recurso cruzado retorna 403/404, publica 0 resultados para o cliente e não expõe segredo. Receipts técnicos já recebidos ficam só no escopo autorizado.

- [ ] **Step 2 — confirmar RED:** `rtk proxy node scripts/test-integration.mjs 06iah-intelligence-homologation`. Esperado: falha pela regra de serviço ainda ausente; banco criado pelo runner é efêmero _test, nunca o banco operacional.
- [ ] **Step 3 — implementar serviço:** usar as assinaturas declaradas, validação Zod, transações/locks/leases e deduplicação. Dataset versionado com 30 casos: empresascom/sem site, sociaisconfusas, QSAsemcontato, homônimos, gestor não sócio, fonte ausente e instruçãoinjetada. Avaliartradicional e híbrido com mesmasevidências. Gates próprios:0 vazamentos/0 fatossemcitação, precisão deatribuição>=95% sobre casosrotulados e 100%abstenção noscasos semsuporte; cobertura e custo reportados sem garantia comercial. Publicarversão de skill só após regressão;live opt-in tetoUSDpositivo e bloqueioquandoatingido. Não ampliar permissões para fazer teste passar. Task 2 cobre todos os itens de Review Focus; nenhum caso fica delegado apenas à observação visual.
- [ ] **Step 4 — GREEN e commit:** repetir a suíte focada; comparar os efeitos reais no banco/adapter com asserções e confirmar 0 efeitos inesperados. Commitar apenas os arquivos do pacote.

### Task 3: HTTP, UI/UX e aceite do pacote

**Files:** rotas/clientes novos listados na estrutura, inventário/relatórios da estrutura e relatório de validação do pacote.

**Interfaces:** Consome serviços da Task 2 e expõe os mesmos estados ao usuário, sem simular resultado nem autorização no browser. Se 07D for excluído, não criar superfícies deproduto e registrar a decisão como entrega do gate.

- [ ] **Step 1 — RED de contrato HTTP:** acrescentar à suíte focada pedido anônimo 401/403, papel proibido 403, input inválido 422, revisão conflitante 409 e repetição idempotente quando houver mutação; para avaliadorCLI, manifesto incompleto retorna exitcode nãozero e relatório de pendências. Confirmar falha antes do handler/avaliador.
- [ ] **Step 2 — ligar operações:** Sem nova API de cliente. ExecuçãoCLI administrativa; leitura resumida apenas por admin da plataforma, reaproveitando guardplatformAI. Cliente recebeestado/cobertura/ausênciahonestos, sem scoresdeconfiança promocionais; admin recebe relatório versionado queexplica falhas e custo. Gates de menu são só apresentação; serviço continua autoritativo. Estados de erro/loading/empty/partial/revoke e limites têm ação de recuperação e não apagam rascunho.
- [ ] **Step 3 — conferir visual e jornada:** `/settings/ai`, `/settings/context`, `/leads/enrich`. Comparar com evidência disponível da referência no mesmo estado em 1920×855/390×844; checar 320 px, foco/escape/scroll, loading/falha/limite/sucesso. Mascarar dados e restaurar contexto de navegação/QA. Registrar desconhecidos da referência em separado.
- [ ] **Step 4 — verificação e aceite:** focados GREEN → `rtk proxy npm test` → `rtk proxy npm run test:integration` → `rtk proxy npm run build` → `rtk proxy npm run typecheck` → `rtk proxy git diff --check`. Todos passam ou o pacote fica pendente com falha reproduzível. No pacote puramente documental/gate excluído, rodar validador de documentos/links e suíte focada correspondente, sem testes de produto não alterado.
- [ ] **Step 5 — fechamento:** escrever relatório com casos, evidências/limitações, cleanupQA, restore de políticas/destinos, custos/saldo quando aplicável e estado de runtime. Revisão final conforme execução nativa; corrigir achados com regressão. Atualizar linha do índice/roadmap somente pelo aceite efetivo e commit local focado.

## Gate externo e critério específico

Produção/fornecedor pago sórecebem aceite empírico após piloto real controlado; fixture prova contrato, não acurácia nomundo real.

## Self-review do plano

R06 mapeados às três tarefas. DTOs e funções têm uma definição neste plano e no desenho de área; contratos comuns evitam reinterpretar autorização/revisão. Task 1 cobre regra pura/persistência;Task 2 cobre todos os itens de Review Focus;Task 3 cobre o que a pessoa realmente consegue operar e ver. Dados/arquivos citados como Create são futuros; Modify foi conferido no baseline ou tem pacote anterior proprietário. Escrever um plano não equivale a passar seus testes.
