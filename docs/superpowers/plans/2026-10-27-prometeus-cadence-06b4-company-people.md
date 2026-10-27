# 06B.4 — Identidade empresarial e tomadores de decisão Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the native execution chosen by the user. Follow tasks in order; perform a fresh final review at execution time under the applicable execution skill. This session authors plans only.

**Goal:** Identidade empresarial e tomadores de decisão; requisitos R04, R05 do PRD.
**Architecture:** Evoluir serviços do monólito com os contratos da área; reutilizar autoridade, banco, jobs, ledger e eventos existentes. Novas interfaces listadas são contratos planejados, não funções já implementadas.
**Tech Stack:** Next 16.4.2, React 19.3.1, TypeScript 5.9.3, PostgreSQL/pg, Zod e node:test existentes; navegador de QA já disponível para UI.
**Spec:** [desenho da área](../specs/2026-10-27-prometeus-cadence-research-design.md), [PRD](../specs/2026-10-27-prometeus-cadence-complete-prd.md), [contratos comuns](../specs/2026-10-27-prometeus-cadence-technical-contracts.md).

## Global Constraints

- Pacote implementado e validado no escopo local/controlado. Dependências: 06B.3. Ordem vigente no índice geral;07D só executa produto após seu gate.
- Apify/LLM centrais; contexto, canais, dados, cache, quota e resultados privados por workspace. Sem autoelevação de owner a admin da plataforma.
- Preservar trial de 7 dias, consumo pré-pago e OpenWA 20 mensagens/5 novoscontatos por dia; intervalo 60–180 s e demais gates existentes.
- Fidelidade ao CadenceFlow por rota/estado/viewport; não criar outra estética. Estados da referência não observados permanecem classificados.
- Mutações revisadas/idempotentes; I/O incerto não autoriza repetição. Piloto/cobrança/envio externo exigem contas/ações próprias autorizadas, não são iniciados por este plano.

## Review Focus

1. dois homônimos e matriz/filial divergentes exigem revisão; nenhum contato aplicado automaticamente
2. gestor não sócio com fonte entra como manager; sócio sem telefone continua pessoa sem contato
3. cache por workspace/empresa/contrato não vaza entretenants e não cobra 2 vezes a mesma resolução útil
4. alterar contexto/contato selecionado invalida revisão; retirar fonte remove suporte e impede aplicar dado órfão
5. A chamada HTTP/SQL direta e a revogação durante I/O não podem ampliar autoridade; resposta/log/evidência não incluem segredos nem conteúdo de outro workspace.

## File Structure

- Create: `src/domain/company-people.ts`.
- Create: `src/server/research/identity.ts`.
- Create: `src/server/research/people.ts`.
- Create: `src/server/research/people-http.ts`.
- Create: `src/app/api/research/[id]/people/route.ts`.
- Create: `db/migrations/084-company-people.sql`.
- Create: `tests/06b4-company-people.test.ts`.
- Create: `tests/integration/06b4-company-people.test.ts`.
- Modify: `src/domain/enrichment.ts`.
- Modify: `src/server/prospecting/enrichment.ts`.
- Modify: `src/server/prospecting/ai/decisors.ts`.
- Modify: `src/server/prospecting/contact-enrichment.ts`.
- Modify: `src/modules/prospecting/enrichment.tsx`.
- Modify: `src/modules/contacts/lead-detail.tsx`.
- Modify: `scripts/test-integration.mjs`.
- Evidence: `docs/validation/06b4-company-people.md` e `docs/validation/evidence/06b4-company-people/` com relatório/manifest/capturas mascaradas. Não gerar evidência de sucesso antes de executar.

## Interfaces e dados

Consome Principal/withWorkspaceTransaction/requirePermission/AppError atuais; Reviewed/Confirm/EvidenceRef/EffectResult conforme contratos comuns quando aplicáveis. A API de frontend não recebePrincipal do cliente. Reusar um serviço existente com assinatura equivalente via adaptação explícita antes de criar duplicação.

```ts
type CompanyIdentity={caseId:string,cnpj:string|null,legalName:string|null,state:"resolved"|"conflict"|"missing",evidence:EvidenceRef[]};
type PersonContact={kind:"email"|"phone"|"linkedin",value:string,attribution:"personal"|"corporate"|"unresolved",evidence:EvidenceRef[]};
type CompanyPerson={id:string,name:string,role:string,relationship:"partner"|"manager"|"unknown",contacts:PersonContact[],current:"supported"|"uncertain"};
type PeopleApplication={caseId:string,personIds:string[],expectedRevision:number};
type PeopleAdapters={registry:(query:string)=>Promise<EvidenceRef[]>,search:(name:string,company:string)=>Promise<EvidenceRef[]>};
declare function resolveCompanyIdentity(p:Principal,caseId:string):Promise<CompanyIdentity>;
declare function resolveCompanyPeople(lease:JobLease,deps:PeopleAdapters):Promise<void>;
declare function preparePeopleApplication(p:Principal,input:PeopleApplication):Promise<Reviewed<PeopleApplication>>;
declare function confirmPeopleApplication(p:Principal,input:Confirm<PeopleApplication>):Promise<{applied:number}>;
```

**Entrada HTTP/CLI:** GET /api/research/:id/people; POST no mesmo endpoint {action:prepare-apply|confirm-apply,personIds:string[],expectedRevision:number,token?,requestId?}

**Persistência:** research_company_identity, research_person, research_person_company, research_person_contact; FK por workspace; UNIQUE(workspace_id,case_id,identity_key) Migração reservada`db/migrations/084-company-people.sql`; não editar 001–082 aplicadas.

### Task 1: Contrato de domínio e persistência autorizada

**Files:** `src/domain/company-people.ts`, `tests/06b4-company-people.test.ts`, `db/migrations/084-company-people.sql`; DTOs deste plano pertencem ao domínio do pacote.

**Interfaces:** Produz `classifyPersonContact(input:{attributed:boolean;corporate:boolean;hasSource:boolean}):'personal'|'corporate'|'unresolved'` e os DTOs acima. Consome os contratos comuns e formatos existentes da área.

- [x] **Step 1 — RED:** criar `tests/06b4-company-people.test.ts` com o caso abaixo e variações de limite/ausência. Telefone perto de nome sem atribuição explícita continua inconclusivo; contato corporativo nunca vira pessoal.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyPersonContact} from '../src/domain/company-people.ts';
test('06B.4 preserva a regra do domínio',()=>{
  assert.deepEqual(classifyPersonContact({"attributed":false,"corporate":false,"hasSource":true}),"unresolved");
});
```

- [x] **Step 2 — confirmar RED:** `rtk proxy node --experimental-strip-types --test tests/06b4-company-people.test.ts`. Esperado: teste falha pela função/regra ausente; corrigir antes erros de fixture/sintaxe que mascarem a regra.
- [x] **Step 3 — implementar:** definir os tipos e a função acima. Criar migração com tabelas/índices/FKs descritos, RLS forçada por workspace, funções worker mínimas e idempotência transacional; não conceder escrita ampla ao dispatcher. Resolver CNPJ pelo site ou razão social mais sinais concordantes; múltiplas empresas viramconflict. ReaproveitarQSA sem guardarCPF/idade; buscar donos e gestores não sócios por nome+empresa/cargo. Candidato sem contato útil continua pessoa/vínculo no caso de pesquisa, separado do Decisor entregável atual; não afrouxar validateDecisorEvidence para fingir enriquecimento. Página pessoal explícita exige vínculo corroborado; ausência de contato não bloqueia contexto.
- [x] **Step 4 — GREEN e commit:** repetir exatamente o comando RED até passar; conferir tipos/contratos e commit local focado, sem push/deploy implícito.

### Task 2: Serviço, execução e invariantes de falha

**Files:** `src/server/research/identity.ts`, `src/server/research/people.ts`, `src/server/research/people-http.ts`, `src/app/api/research/[id]/people/route.ts`, `tests/integration/06b4-company-people.test.ts`, `scripts/test-integration.mjs` e serviços existentes da área listados em Modify.

**Interfaces:** Consome DTOs/identidade e o resultado da Task 1; produz exatamente as funções de serviço declaradas neste plano. Dependências externas devem ser injetáveis nos testes, sem substituir autoridade real do banco.

- [x] **Step 1 — RED de integração:** adicionar `06b4-company-people` à allowlist do runner. Reaproveitar fixtures de identidade/bancos/fechamento em tests/integration/helpers.ts e helpers da área; criar 2 workspaces e papéis próprios, sem usar contas/dados reais. Escrever os testes abaixo com contagens/estados/efeitos observáveis.

  - Caso 1: dois homônimos e matriz/filial divergentes exigem revisão; nenhum contato aplicado automaticamente.
  - Caso 2: gestor não sócio com fonte entra como manager; sócio sem telefone continua pessoa sem contato.
  - Caso 3: cache por workspace/empresa/contrato não vaza entretenants e não cobra 2 vezes a mesma resolução útil.
  - Caso 4: alterar contexto/contato selecionado invalida revisão; retirar fonte remove suporte e impede aplicar dado órfão.

  - Caso de autoridade: endpoint direto/worker com usuário removido ou recurso cruzado retorna 403/404, publica 0 resultados para o cliente e não expõe segredo. Receipts técnicos já recebidos ficam só no escopo autorizado.

- [x] **Step 2 — confirmar RED:** `rtk proxy node scripts/test-integration.mjs 06b4-company-people`. Esperado: falha pela regra de serviço ainda ausente; banco criado pelo runner é efêmero _test, nunca o banco operacional.
- [x] **Step 3 — implementar serviço:** usar as assinaturas declaradas, validação Zod, transações/locks/leases e deduplicação. Resolver CNPJ pelo site ou razão social mais sinais concordantes; múltiplas empresas viramconflict. ReaproveitarQSA sem guardarCPF/idade; buscar donos e gestores não sócios por nome+empresa/cargo. Candidato sem contato útil continua pessoa/vínculo no caso de pesquisa, separado do Decisor entregável atual; não afrouxar validateDecisorEvidence para fingir enriquecimento. Página pessoal explícita exige vínculo corroborado; ausência de contato não bloqueia contexto. Não ampliar permissões para fazer teste passar. Task 2 cobre todos os itens de Review Focus; nenhum caso fica delegado apenas à observação visual.
- [x] **Step 4 — GREEN e commit:** repetir a suíte focada; comparar os efeitos reais no banco/adapter com asserções e confirmar 0 efeitos inesperados. Commitar apenas os arquivos do pacote.

### Task 3: HTTP, UI/UX e aceite do pacote

**Files:** rotas/clientes novos listados na estrutura, `src/modules/prospecting/enrichment.tsx`, `src/modules/contacts/lead-detail.tsx` e relatório de validação do pacote.

**Interfaces:** Consome serviços da Task 2 e expõe os mesmos estados ao usuário, sem simular resultado nem autorização no browser. Se 07D for excluído, não criar superfícies deproduto e registrar a decisão como entrega do gate.

- [x] **Step 1 — RED de contrato HTTP:** acrescentar à suíte focada pedido anônimo 401/403, papel proibido 403, input inválido 422, revisão conflitante 409 e repetição idempotente quando houver mutação; para avaliadorCLI, manifesto incompleto retorna exitcode nãozero e relatório de pendências. Confirmar falha antes do handler/avaliador.
- [x] **Step 2 — ligar operações:** GET /api/research/:id/people; POST no mesmo endpoint {action:prepare-apply|confirm-apply,personIds:string[],expectedRevision:number,token?,requestId?} Empresa e pessoa têm rótulos separados, fonte por campo, vínculo/atualidade incertos visíveis e revisão antes de criarcontato na lista. Reusar apresentação de enriquecimento, com estado sem resultado útil explícito. Gates de menu são só apresentação; serviço continua autoritativo. Estados de erro/loading/empty/partial/revoke e limites têm ação de recuperação e não apagam rascunho.
- [x] **Step 3 — conferir visual e jornada:** `/leads/enrich`, `/leads/[id]`, `/contacts`, `/linkedin/enrichment`. Comparar com evidência disponível da referência no mesmo estado em 1920×855/390×844; checar 320 px, foco/escape/scroll, loading/falha/limite/sucesso. Mascarar dados e restaurar contexto de navegação/QA. Registrar desconhecidos da referência em separado.
- [x] **Step 4 — verificação e aceite:** focados GREEN → `rtk proxy npm test` → `rtk proxy npm run test:integration` → `rtk proxy npm run build` → `rtk proxy npm run typecheck` → `rtk proxy git diff --check`. Todos passam ou o pacote fica pendente com falha reproduzível. No pacote puramente documental/gate excluído, rodar validador de documentos/links e suíte focada correspondente, sem testes de produto não alterado.
- [x] **Step 5 — fechamento:** escrever relatório com casos, evidências/limitações, cleanupQA, restore de políticas/destinos, custos/saldo quando aplicável e estado de runtime. Revisão final conforme execução nativa; corrigir achados com regressão. Atualizar linha do índice/roadmap somente pelo aceite efetivo e commit local focado.

## Gate externo e critério específico

LinkedIn como fonte de pesquisa depende do perfil de dados habilitado e não da API de convites. Falta de cobertura de perfil/contato gera ausência explícita, sem garantir celular pessoal.

## Self-review do plano

R04, R05 mapeados às três tarefas. DTOs e funções têm uma definição neste plano e no desenho de área; contratos comuns evitam reinterpretar autorização/revisão. Task 1 cobre regra pura/persistência;Task 2 cobre todos os itens de Review Focus;Task 3 cobre o que a pessoa realmente consegue operar e ver. Dados/arquivos citados como Create são futuros; Modify foi conferido no baseline ou tem pacote anterior proprietário. Escrever um plano não equivale a passar seus testes.

## Execução —27/10/2026

Três tarefas concluídas, uma revisão final e uma rodada de cinco correções importantes RED→GREEN. Contrato executável adaptado a `companyPeople`, perfis WEB/CNPJ e coleta pública existentes; mesmo journal/fila/reservas. Migrações084,084a,084b,084c. Aceite e limites em [06B.4](../../validation/06b4-company-people.md). Próximo06D.1; nenhum push/merge ou piloto pago iniciado.
