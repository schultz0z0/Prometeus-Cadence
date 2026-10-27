# 06B.3 — Investigação da empresa e redes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the native execution chosen by the user. Follow tasks in order; perform a fresh final review at execution time under the applicable execution skill. This session authors plans only.

**Goal:** Investigação da empresa e redes; requisitos R02, R03, R05 do PRD.
**Architecture:** Evoluir serviços do monólito com os contratos da área; reutilizar autoridade, banco, jobs, ledger e eventos existentes. Novas interfaces listadas são contratos planejados, não funções já implementadas.
**Tech Stack:** Next 16.4.2, React 19.3.1, TypeScript 5.9.3, PostgreSQL/pg, Zod e node:test existentes; navegador de QA já disponível para UI.
**Spec:** [desenho da área](../specs/2026-10-27-prometeus-cadence-research-design.md), [PRD](../specs/2026-10-27-prometeus-cadence-complete-prd.md), [contratos comuns](../specs/2026-10-27-prometeus-cadence-technical-contracts.md).

## Global Constraints

- Pacote planejado; não marcado concluído. Dependências: 06IA, 06B.1, 06B.2. Ordem vigente no índice geral;07D só executa produto após seu gate.
- Apify/LLM centrais; contexto, canais, dados, cache, quota e resultados privados por workspace. Sem autoelevação de owner a admin da plataforma.
- Preservar trial de 7 dias, consumo pré-pago e OpenWA 20 mensagens/5 novoscontatos por dia; intervalo 60–180 s e demais gates existentes.
- Fidelidade ao CadenceFlow por rota/estado/viewport; não criar outra estética. Estados da referência não observados permanecem classificados.
- Mutações revisadas/idempotentes; I/O incerto não autoriza repetição. Piloto/cobrança/envio externo exigem contas/ações próprias autorizadas, não são iniciados por este plano.

## Review Focus

1. mesma empresa por domínio confirmado: fatos com URL/hash/data são revisáveis; empresa sem site continua pela fonte pública habilitada
2. timeout de rede social preserva fatos do site em partial; perfil desabilitado não faz chamada
3. duas confirmações com mesmo requestId criam 1 job e 1 reserva; cancelamento após coleta não reinicia Actor
4. revogar membership/política durante I/O preserva receipt mas publica 0 fatos; fetch de localhost/redirect privado é rejeitado
5. A chamada HTTP/SQL direta e a revogação durante I/O não podem ampliar autoridade; resposta/log/evidência não incluem segredos nem conteúdo de outro workspace.

## File Structure

- Create: `src/domain/company-research.ts`.
- Create: `src/server/research/company.ts`.
- Create: `src/server/research/source-registry.ts`.
- Create: `src/server/research/http.ts`.
- Create: `src/client/research-client.ts`.
- Create: `src/app/api/research/route.ts`.
- Create: `src/app/api/research/[id]/route.ts`.
- Create: `src/app/api/research/[id]/[action]/route.ts`.
- Create: `db/migrations/083-company-research.sql`.
- Create: `tests/06b3-company-research.test.ts`.
- Create: `tests/integration/06b3-company-research.test.ts`.
- Modify: `src/server/prospecting/providers/profiles.ts`.
- Modify: `src/server/prospecting/worker.ts`.
- Modify: `src/server/prospecting/extraction/fetch-page.ts`.
- Modify: `src/domain/operation-events.ts`.
- Modify: `src/modules/prospecting/server-generator.tsx`.
- Modify: `src/modules/contacts/lead-detail.tsx`.
- Modify: `scripts/test-integration.mjs`.
- Evidence: `docs/validation/06b3-company-research.md` e `docs/validation/evidence/06b3-company-research/` com relatório/manifest/capturas mascaradas. Não gerar evidência de sucesso antes de executar.

## Interfaces e dados

Consome Principal/withWorkspaceTransaction/requirePermission/AppError atuais; Reviewed/Confirm/EvidenceRef/EffectResult conforme contratos comuns quando aplicáveis. A API de frontend não recebePrincipal do cliente. Reusar um serviço existente com assinatura equivalente via adaptação explícita antes de criar duplicação.

```ts
type CompanyResearchInput={leadIds:string[],sourceKinds:("website"|"social"|"registry")[],maxPagesPerCompany:number};
type ResearchCaseView={id:string,revision:number,state:string,facts:ResearchFact[],missing:string[]};
type ResearchFact={id:string,field:string,value:string,evidence:EvidenceRef[],attribution:"company"|"uncertain"};
type ResearchAdapters={collect:(source:string,urls:string[],signal:AbortSignal)=>Promise<EvidenceRef[]>};
type ResearchApplication={caseId:string,factIds:string[],expectedRevision:number};
declare function prepareCompanyResearch(p:Principal,input:CompanyResearchInput):Promise<Reviewed<CompanyResearchInput>>;
declare function confirmCompanyResearch(p:Principal,input:Confirm<CompanyResearchInput>):Promise<ResearchCaseView>;
declare function runCompanyResearch(lease:JobLease,deps:ResearchAdapters):Promise<void>;
declare function prepareResearchApplication(p:Principal,input:ResearchApplication):Promise<Reviewed<ResearchApplication>>;
declare function confirmResearchApplication(p:Principal,input:Confirm<ResearchApplication>):Promise<{applied:number}>;
```

**Entrada HTTP/CLI:** POST /api/research {action:prepare|confirm,input:{leadIds:string[],sourceKinds:string[],maxPagesPerCompany:number},token?,requestId?}; GET /api/research/:id; POST /api/research/:id/cancel; POST /api/research/:id/apply com fatos selecionados/revisão

**Persistência:** research_case, research_source, research_fact; chave(workspace_id,lead_id,case_version); UNIQUE(workspace_id,operation_key) Migração reservada`db/migrations/083-company-research.sql`; não editar 001–082 aplicadas.

### Task 1: Contrato de domínio e persistência autorizada

**Files:** `src/domain/company-research.ts`, `tests/06b3-company-research.test.ts`, `db/migrations/083-company-research.sql`; DTOs deste plano pertencem ao domínio do pacote.

**Interfaces:** Produz `matchCompanySource(input:{companyDomain:string;candidateDomain:string;corroborated:boolean}):'matched'|'review'` e os DTOs acima. Consome os contratos comuns e formatos existentes da área.

- [ ] **Step 1 — RED:** criar `tests/06b3-company-research.test.ts` com o caso abaixo e variações de limite/ausência. Domínio divergente sem corroboração exige revisão; nome semelhante não prova vínculo.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {matchCompanySource} from '../src/domain/company-research.ts';
test('06B.3 preserva a regra do domínio',()=>{
  assert.deepEqual(matchCompanySource({"companyDomain":"clinica.example","candidateDomain":"outra.example","corroborated":false}),"review");
});
```

- [ ] **Step 2 — confirmar RED:** `rtk proxy node --experimental-strip-types --test tests/06b3-company-research.test.ts`. Esperado: teste falha pela função/regra ausente; corrigir antes erros de fixture/sintaxe que mascarem a regra.
- [ ] **Step 3 — implementar:** definir os tipos e a função acima. Criar migração com tabelas/índices/FKs descritos, RLS forçada por workspace, funções worker mínimas e idempotência transacional; não conceder escrita ampla ao dispatcher. Registrar perfis centrais habilitados sem trocar allowlist por Actor arbitrário. Usar WEB/Maps/site já coletados, procurar links sociais e corroborar identidade por domínio/CNPJ/endereço antes de aceitar fatos. Limitar 10 páginas/empresa; aplicar no máximo 500 leads/rodada e continuar com partial por falha de uma fonte. Checkpoints/receipts e custo técnico usam journal existente; aplicação à base é revisada. Aplicar pesquisa revalida campo/fonte/hash, revisão do lead e caso e grava campos suportados com origem em uma transação. Não sobrescrever valor humano conflitante sem escolha explícita da revisão; fatos uncertain ficam somente na pesquisa até resolução. Perfis novos de rede social são configuração central protegida por isPlatformAiAdmin, sem aceitar Actor/build enviados no pedido do cliente.
- [ ] **Step 4 — GREEN e commit:** repetir exatamente o comando RED até passar; conferir tipos/contratos e commit local focado, sem push/deploy implícito.

### Task 2: Serviço, execução e invariantes de falha

**Files:** `src/server/research/company.ts`, `src/server/research/source-registry.ts`, `src/server/research/http.ts`, `src/app/api/research/route.ts`, `src/app/api/research/[id]/route.ts`, `src/app/api/research/[id]/[action]/route.ts`, `tests/integration/06b3-company-research.test.ts`, `scripts/test-integration.mjs` e serviços existentes da área listados em Modify.

**Interfaces:** Consome DTOs/identidade e o resultado da Task 1; produz exatamente as funções de serviço declaradas neste plano. Dependências externas devem ser injetáveis nos testes, sem substituir autoridade real do banco.

- [ ] **Step 1 — RED de integração:** adicionar `06b3-company-research` à allowlist do runner. Reaproveitar fixtures de identidade/bancos/fechamento em tests/integration/helpers.ts e helpers da área; criar 2 workspaces e papéis próprios, sem usar contas/dados reais. Escrever os testes abaixo com contagens/estados/efeitos observáveis.

  - Caso 1: mesma empresa por domínio confirmado: fatos com URL/hash/data são revisáveis; empresa sem site continua pela fonte pública habilitada.
  - Caso 2: timeout de rede social preserva fatos do site em partial; perfil desabilitado não faz chamada.
  - Caso 3: duas confirmações com mesmo requestId criam 1 job e 1 reserva; cancelamento após coleta não reinicia Actor.
  - Caso 4: revogar membership/política durante I/O preserva receipt mas publica 0 fatos; fetch de localhost/redirect privado é rejeitado.

  - Caso de autoridade: endpoint direto/worker com usuário removido ou recurso cruzado retorna 403/404, publica 0 resultados para o cliente e não expõe segredo. Receipts técnicos já recebidos ficam só no escopo autorizado.

- [ ] **Step 2 — confirmar RED:** `rtk proxy node scripts/test-integration.mjs 06b3-company-research`. Esperado: falha pela regra de serviço ainda ausente; banco criado pelo runner é efêmero _test, nunca o banco operacional.
- [ ] **Step 3 — implementar serviço:** usar as assinaturas declaradas, validação Zod, transações/locks/leases e deduplicação. Registrar perfis centrais habilitados sem trocar allowlist por Actor arbitrário. Usar WEB/Maps/site já coletados, procurar links sociais e corroborar identidade por domínio/CNPJ/endereço antes de aceitar fatos. Limitar 10 páginas/empresa; aplicar no máximo 500 leads/rodada e continuar com partial por falha de uma fonte. Checkpoints/receipts e custo técnico usam journal existente; aplicação à base é revisada. Aplicar pesquisa revalida campo/fonte/hash, revisão do lead e caso e grava campos suportados com origem em uma transação. Não sobrescrever valor humano conflitante sem escolha explícita da revisão; fatos uncertain ficam somente na pesquisa até resolução. Perfis novos de rede social são configuração central protegida por isPlatformAiAdmin, sem aceitar Actor/build enviados no pedido do cliente. Não ampliar permissões para fazer teste passar. Task 2 cobre todos os itens de Review Focus; nenhum caso fica delegado apenas à observação visual.
- [ ] **Step 4 — GREEN e commit:** repetir a suíte focada; comparar os efeitos reais no banco/adapter com asserções e confirmar 0 efeitos inesperados. Commitar apenas os arquivos do pacote.

### Task 3: HTTP, UI/UX e aceite do pacote

**Files:** rotas/clientes novos listados na estrutura, `src/modules/prospecting/server-generator.tsx`, `src/modules/contacts/lead-detail.tsx` e relatório de validação do pacote.

**Interfaces:** Consome serviços da Task 2 e expõe os mesmos estados ao usuário, sem simular resultado nem autorização no browser. Se 07D for excluído, não criar superfícies deproduto e registrar a decisão como entrega do gate.

- [ ] **Step 1 — RED de contrato HTTP:** acrescentar à suíte focada pedido anônimo 401/403, papel proibido 403, input inválido 422, revisão conflitante 409 e repetição idempotente quando houver mutação; para avaliadorCLI, manifesto incompleto retorna exitcode nãozero e relatório de pendências. Confirmar falha antes do handler/avaliador.
- [ ] **Step 2 — ligar operações:** POST /api/research {action:prepare|confirm,input:{leadIds:string[],sourceKinds:string[],maxPagesPerCompany:number},token?,requestId?}; GET /api/research/:id; POST /api/research/:id/cancel; POST /api/research/:id/apply com fatos selecionados/revisão Reaproveitar formulário→revisão→progresso→resultado. Detalhe mostra fonte/data e fatos não encontrados; ações aplicar/descartar respeitam revisão; fontes técnicas não aparecem como exigência do cliente. Gates de menu são só apresentação; serviço continua autoritativo. Estados de erro/loading/empty/partial/revoke e limites têm ação de recuperação e não apagam rascunho.
- [ ] **Step 3 — conferir visual e jornada:** `/leads/generator?source=MAPS`, `/leads/generator?source=WEB`, `/contacts`, `/leads/[id]`, `/executions/[id]`. Comparar com evidência disponível da referência no mesmo estado em 1920×855/390×844; checar 320 px, foco/escape/scroll, loading/falha/limite/sucesso. Mascarar dados e restaurar contexto de navegação/QA. Registrar desconhecidos da referência em separado.
- [ ] **Step 4 — verificação e aceite:** focados GREEN → `rtk proxy npm test` → `rtk proxy npm run test:integration` → `rtk proxy npm run build` → `rtk proxy npm run typecheck` → `rtk proxy git diff --check`. Todos passam ou o pacote fica pendente com falha reproduzível. No pacote puramente documental/gate excluído, rodar validador de documentos/links e suíte focada correspondente, sem testes de produto não alterado.
- [ ] **Step 5 — fechamento:** escrever relatório com casos, evidências/limitações, cleanupQA, restore de políticas/destinos, custos/saldo quando aplicável e estado de runtime. Revisão final conforme execução nativa; corrigir achados com regressão. Atualizar linha do índice/roadmap somente pelo aceite efetivo e commit local focado.

## Gate externo e critério específico

Antes de ativar rede adicional: contrato I/O/build/custo/acesso e amostra controlada registrados. Sem fonte nova pronta, exibir cobertura indisponível; não declarar a rede homologada.

## Self-review do plano

R02, R03, R05 mapeados às três tarefas. DTOs e funções têm uma definição neste plano e no desenho de área; contratos comuns evitam reinterpretar autorização/revisão. Task 1 cobre regra pura/persistência;Task 2 cobre todos os itens de Review Focus;Task 3 cobre o que a pessoa realmente consegue operar e ver. Dados/arquivos citados como Create são futuros; Modify foi conferido no baseline ou tem pacote anterior proprietário. Escrever um plano não equivale a passar seus testes.
