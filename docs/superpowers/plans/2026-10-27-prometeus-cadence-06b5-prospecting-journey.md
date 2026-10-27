# 06B.5 — Jornada integrada de prospecção e cadência Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the native execution chosen by the user. Follow tasks in order; perform a fresh final review at execution time under the applicable execution skill. This session authors plans only.

**Goal:** Jornada integrada de prospecção e cadência; requisitos R05, R07 do PRD.
**Architecture:** Evoluir serviços do monólito com os contratos da área; reutilizar autoridade, banco, jobs, ledger e eventos existentes. Novas interfaces listadas são contratos planejados, não funções já implementadas.
**Tech Stack:** Next 16.4.2, React 19.3.1, TypeScript 5.9.3, PostgreSQL/pg, Zod e node:test existentes; navegador de QA já disponível para UI.
**Spec:** [desenho da área](../specs/2026-10-27-prometeus-cadence-research-design.md), [PRD](../specs/2026-10-27-prometeus-cadence-complete-prd.md), [contratos comuns](../specs/2026-10-27-prometeus-cadence-technical-contracts.md).

## Global Constraints

- Pacote planejado; não marcado concluído. Dependências: 06B.3, 06B.4, 06D.1, 06D.2. Ordem vigente no índice geral;07D só executa produto após seu gate.
- Apify/LLM centrais; contexto, canais, dados, cache, quota e resultados privados por workspace. Sem autoelevação de owner a admin da plataforma.
- Preservar trial de 7 dias, consumo pré-pago e OpenWA 20 mensagens/5 novoscontatos por dia; intervalo 60–180 s e demais gates existentes.
- Fidelidade ao CadenceFlow por rota/estado/viewport; não criar outra estética. Estados da referência não observados permanecem classificados.
- Mutações revisadas/idempotentes; I/O incerto não autoriza repetição. Piloto/cobrança/envio externo exigem contas/ações próprias autorizadas, não são iniciados por este plano.

## Review Focus

1. mesmo pedido repetido produz uma jornada, jobs/contatos únicos e consumouma vez por regra comercial
2. fontefalha em 30/100 empresas preserva 70 resultados e expõe faltantes; retry somente daspendências
3. cancel/resume e mudança decontexto exigem novarevisão semreexecutar fatos ainda válidos
4. prepararproposta não cria lista/cadência/envio; confirmar escolha cria 1 rascunho com origem e 0 publicações
5. A chamada HTTP/SQL direta e a revogação durante I/O não podem ampliar autoridade; resposta/log/evidência não incluem segredos nem conteúdo de outro workspace.

## File Structure

- Create: `src/domain/prospecting-journey.ts`.
- Create: `src/server/research/journey.ts`.
- Create: `src/app/api/prospecting/journeys/route.ts`.
- Create: `src/app/api/prospecting/journeys/[id]/[action]/route.ts`.
- Create: `src/modules/prospecting/research-journey.tsx`.
- Create: `db/migrations/087-prospecting-journey.sql`.
- Create: `tests/06b5-prospecting-journey.test.ts`.
- Create: `tests/integration/06b5-prospecting-journey.test.ts`.
- Modify: `src/server/planning/confirmation.ts`.
- Modify: `src/server/prospecting/job-store.ts`.
- Modify: `src/server/automations/scheduler.ts`.
- Modify: `src/client/prospecting-client.ts`.
- Modify: `src/modules/automations/server-audience-wizard.tsx`.
- Modify: `src/modules/planning/cadence-proposals.tsx`.
- Modify: `scripts/test-integration.mjs`.
- Evidence: `docs/validation/06b5-prospecting-journey.md` e `docs/validation/evidence/06b5-prospecting-journey/` com relatório/manifest/capturas mascaradas. Não gerar evidência de sucesso antes de executar.

## Interfaces e dados

Consome Principal/withWorkspaceTransaction/requirePermission/AppError atuais; Reviewed/Confirm/EvidenceRef/EffectResult conforme contratos comuns quando aplicáveis. A API de frontend não recebePrincipal do cliente. Reusar um serviço existente com assinatura equivalente via adaptação explícita antes de criar duplicação.

```ts
type JourneyInput={brief:string,location:string,limit:number,destinationListId?:string};
type JourneyView={id:string,revision:number,state:string,stages:{name:string,jobId:string|null,state:string}[],listId:string|null,proposalJobId:string|null};
type JourneyStage="discover"|"research"|"people"|"qualify"|"review"|"cadence";
declare function prepareJourney(p:Principal,input:JourneyInput):Promise<Reviewed<JourneyInput>>;
declare function confirmJourney(p:Principal,input:Confirm<JourneyInput>):Promise<JourneyView>;
declare function advanceJourney(lease:JobLease):Promise<JourneyView>;
```

**Entrada HTTP/CLI:** POST /api/prospecting/journeys {action:prepare|confirm,input:{brief,location,limit,destinationListId?},token?,requestId?}; POST /:id/{cancel,resume,prepare-cadence,confirm-cadence}; GET usa rota /api/prospecting/journeys?id=...

**Persistência:** prospecting_journey, journey_stage; UNIQUE(workspace_id,request_id), vínculos a jobs/listas/propostas atuais, estados/checkpoints versionados Migração reservada`db/migrations/087-prospecting-journey.sql`; não editar 001–082 aplicadas.

### Task 1: Contrato de domínio e persistência autorizada

**Files:** `src/domain/prospecting-journey.ts`, `tests/06b5-prospecting-journey.test.ts`, `db/migrations/087-prospecting-journey.sql`; DTOs deste plano pertencem ao domínio do pacote.

**Interfaces:** Produz `nextJourneyStage(input:{research:string;qualification:string;cadenceApproved:boolean}):'research'|'qualify'|'review'|'ready'` e os DTOs acima. Consome os contratos comuns e formatos existentes da área.

- [ ] **Step 1 — RED:** criar `tests/06b5-prospecting-journey.test.ts` com o caso abaixo e variações de limite/ausência. Pesquisa parcial concluída segue para revisão e não publica cadência sozinha.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {nextJourneyStage} from '../src/domain/prospecting-journey.ts';
test('06B.5 preserva a regra do domínio',()=>{
  assert.deepEqual(nextJourneyStage({"research":"partial","qualification":"completed","cadenceApproved":false}),"review");
});
```

- [ ] **Step 2 — confirmar RED:** `rtk proxy node --experimental-strip-types --test tests/06b5-prospecting-journey.test.ts`. Esperado: teste falha pela função/regra ausente; corrigir antes erros de fixture/sintaxe que mascarem a regra.
- [ ] **Step 3 — implementar:** definir os tipos e a função acima. Criar migração com tabelas/índices/FKs descritos, RLS forçada por workspace, funções worker mínimas e idempotência transacional; não conceder escrita ampla ao dispatcher. Orquestrador referenciajobs existentes sem criarworkerduplicado. Brief/contexto/produto são congelados na revisão; cada estágio usa chave journeyId+stage+company+version. Pausa retémresultados;resume aproveita checkpoints ainda válidos e apresenta novo custo se invalidou. Cadência sugeridapadrão 3 etapas editáveis, canais disponíveis e variáveis permitidas; quantidade não é limite fixo. Criação sórascunho atépublicação 06D.
- [ ] **Step 4 — GREEN e commit:** repetir exatamente o comando RED até passar; conferir tipos/contratos e commit local focado, sem push/deploy implícito.

### Task 2: Serviço, execução e invariantes de falha

**Files:** `src/server/research/journey.ts`, `src/app/api/prospecting/journeys/route.ts`, `src/app/api/prospecting/journeys/[id]/[action]/route.ts`, `tests/integration/06b5-prospecting-journey.test.ts`, `scripts/test-integration.mjs` e serviços existentes da área listados em Modify.

**Interfaces:** Consome DTOs/identidade e o resultado da Task 1; produz exatamente as funções de serviço declaradas neste plano. Dependências externas devem ser injetáveis nos testes, sem substituir autoridade real do banco.

- [ ] **Step 1 — RED de integração:** adicionar `06b5-prospecting-journey` à allowlist do runner. Reaproveitar fixtures de identidade/bancos/fechamento em tests/integration/helpers.ts e helpers da área; criar 2 workspaces e papéis próprios, sem usar contas/dados reais. Escrever os testes abaixo com contagens/estados/efeitos observáveis.

  - Caso 1: mesmo pedido repetido produz uma jornada, jobs/contatos únicos e consumouma vez por regra comercial.
  - Caso 2: fontefalha em 30/100 empresas preserva 70 resultados e expõe faltantes; retry somente daspendências.
  - Caso 3: cancel/resume e mudança decontexto exigem novarevisão semreexecutar fatos ainda válidos.
  - Caso 4: prepararproposta não cria lista/cadência/envio; confirmar escolha cria 1 rascunho com origem e 0 publicações.

  - Caso de autoridade: endpoint direto/worker com usuário removido ou recurso cruzado retorna 403/404, publica 0 resultados para o cliente e não expõe segredo. Receipts técnicos já recebidos ficam só no escopo autorizado.

- [ ] **Step 2 — confirmar RED:** `rtk proxy node scripts/test-integration.mjs 06b5-prospecting-journey`. Esperado: falha pela regra de serviço ainda ausente; banco criado pelo runner é efêmero _test, nunca o banco operacional.
- [ ] **Step 3 — implementar serviço:** usar as assinaturas declaradas, validação Zod, transações/locks/leases e deduplicação. Orquestrador referenciajobs existentes sem criarworkerduplicado. Brief/contexto/produto são congelados na revisão; cada estágio usa chave journeyId+stage+company+version. Pausa retémresultados;resume aproveita checkpoints ainda válidos e apresenta novo custo se invalidou. Cadência sugeridapadrão 3 etapas editáveis, canais disponíveis e variáveis permitidas; quantidade não é limite fixo. Criação sórascunho atépublicação 06D. Não ampliar permissões para fazer teste passar. Task 2 cobre todos os itens de Review Focus; nenhum caso fica delegado apenas à observação visual.
- [ ] **Step 4 — GREEN e commit:** repetir a suíte focada; comparar os efeitos reais no banco/adapter com asserções e confirmar 0 efeitos inesperados. Commitar apenas os arquivos do pacote.

### Task 3: HTTP, UI/UX e aceite do pacote

**Files:** rotas/clientes novos listados na estrutura, `src/modules/automations/server-audience-wizard.tsx`, `src/modules/planning/cadence-proposals.tsx` e relatório de validação do pacote.

**Interfaces:** Consome serviços da Task 2 e expõe os mesmos estados ao usuário, sem simular resultado nem autorização no browser. Se 07D for excluído, não criar superfícies deproduto e registrar a decisão como entrega do gate.

- [ ] **Step 1 — RED de contrato HTTP:** acrescentar à suíte focada pedido anônimo 401/403, papel proibido 403, input inválido 422, revisão conflitante 409 e repetição idempotente quando houver mutação; para avaliadorCLI, manifesto incompleto retorna exitcode nãozero e relatório de pendências. Confirmar falha antes do handler/avaliador.
- [ ] **Step 2 — ligar operações:** POST /api/prospecting/journeys {action:prepare|confirm,input:{brief,location,limit,destinationListId?},token?,requestId?}; POST /:id/{cancel,resume,prepare-cadence,confirm-cadence}; GET usa rota /api/prospecting/journeys?id=... Cliente usa umobjetivo e acompanha etapas compreensíveis; revisão e sugestões aproveitam aUX existente sem assistente técnico de APIs. Não prometercontagem de contatos pessoais garantida. Gates de menu são só apresentação; serviço continua autoritativo. Estados de erro/loading/empty/partial/revoke e limites têm ação de recuperação e não apagam rascunho.
- [ ] **Step 3 — conferir visual e jornada:** `/leads/generator`, `/automations/new/ai`, `/executions/[id]`, `/contacts`, `/cadences/new`. Comparar com evidência disponível da referência no mesmo estado em 1920×855/390×844; checar 320 px, foco/escape/scroll, loading/falha/limite/sucesso. Mascarar dados e restaurar contexto de navegação/QA. Registrar desconhecidos da referência em separado.
- [ ] **Step 4 — verificação e aceite:** focados GREEN → `rtk proxy npm test` → `rtk proxy npm run test:integration` → `rtk proxy npm run build` → `rtk proxy npm run typecheck` → `rtk proxy git diff --check`. Todos passam ou o pacote fica pendente com falha reproduzível. No pacote puramente documental/gate excluído, rodar validador de documentos/links e suíte focada correspondente, sem testes de produto não alterado.
- [ ] **Step 5 — fechamento:** escrever relatório com casos, evidências/limitações, cleanupQA, restore de políticas/destinos, custos/saldo quando aplicável e estado de runtime. Revisão final conforme execução nativa; corrigir achados com regressão. Atualizar linha do índice/roadmap somente pelo aceite efetivo e commit local focado.

## Gate externo e critério específico

Aceite pontaaponta depende de 06D e de fontes habilitadas; contratos controlados não substituempiloto de acurácia 06IA-H.

## Self-review do plano

R05, R07 mapeados às três tarefas. DTOs e funções têm uma definição neste plano e no desenho de área; contratos comuns evitam reinterpretar autorização/revisão. Task 1 cobre regra pura/persistência;Task 2 cobre todos os itens de Review Focus;Task 3 cobre o que a pessoa realmente consegue operar e ver. Dados/arquivos citados como Create são futuros; Modify foi conferido no baseline ou tem pacote anterior proprietário. Escrever um plano não equivale a passar seus testes.
