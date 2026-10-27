# 06E.2 — Duplicados, fusão, privacidade e ciclo dos dados Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the native execution chosen by the user. Follow tasks in order; perform a fresh final review at execution time under the applicable execution skill. This session authors plans only.

**Goal:** Duplicados, fusão, privacidade e ciclo dos dados; requisitos R13 do PRD.
**Architecture:** Evoluir serviços do monólito com os contratos da área; reutilizar autoridade, banco, jobs, ledger e eventos existentes. Novas interfaces listadas são contratos planejados, não funções já implementadas.
**Tech Stack:** Next 16.4.2, React 19.3.1, TypeScript 5.9.3, PostgreSQL/pg, Zod e node:test existentes; navegador de QA já disponível para UI.
**Spec:** [desenho da área](../specs/2026-10-27-prometeus-cadence-operations-design.md), [PRD](../specs/2026-10-27-prometeus-cadence-complete-prd.md), [contratos comuns](../specs/2026-10-27-prometeus-cadence-technical-contracts.md).

## Global Constraints

- Pacote planejado; não marcado concluído. Dependências: 06E.1, 06B.4. Ordem vigente no índice geral;07D só executa produto após seu gate.
- Apify/LLM centrais; contexto, canais, dados, cache, quota e resultados privados por workspace. Sem autoelevação de owner a admin da plataforma.
- Preservar trial de 7 dias, consumo pré-pago e OpenWA 20 mensagens/5 novoscontatos por dia; intervalo 60–180 s e demais gates existentes.
- Fidelidade ao CadenceFlow por rota/estado/viewport; não criar outra estética. Estados da referência não observados permanecem classificados.
- Mutações revisadas/idempotentes; I/O incerto não autoriza repetição. Piloto/cobrança/envio externo exigem contas/ações próprias autorizadas, não são iniciados por este plano.

## Review Focus

1. scanencontra duplicatafora da primeira página; nomesiguais não são fundidos
2. merge repetido semdupla quota; optout prevalece; undoapósedição 409 eantesrestaura vínculos
3. deleteinterrompe jobs/rascunhosSDR/exports eapaga dados de IA/cache mantendo receiptssemconteúdo
4. retenção 22 dias nãotocarecentes; workerrevogado não apaga outro tenant; arquivos sãoinacessíveis pósdelete
5. A chamada HTTP/SQL direta e a revogação durante I/O não podem ampliar autoridade; resposta/log/evidência não incluem segredos nem conteúdo de outro workspace.

## File Structure

- Create: `src/domain/data-lifecycle.ts`.
- Create: `src/server/privacy/service.ts`.
- Create: `src/server/privacy/merge.ts`.
- Create: `src/server/privacy/worker.ts`.
- Create: `src/app/api/data-lifecycle/route.ts`.
- Create: `src/app/api/data-lifecycle/[id]/[action]/route.ts`.
- Create: `db/migrations/092-data-lifecycle.sql`.
- Create: `tests/06e2-data-lifecycle.test.ts`.
- Create: `tests/integration/06e2-data-lifecycle.test.ts`.
- Modify: `src/modules/settings/reference-settings.tsx`.
- Modify: `src/server/contacts/repository.ts`.
- Modify: `src/server/prospecting/evidence.ts`.
- Modify: `src/server/contacts/http.ts`.
- Modify: `src/server/messaging/inbox.ts`.
- Modify: `src/server/planning/evidence.ts`.
- Modify: `scripts/test-integration.mjs`.
- Evidence: `docs/validation/06e2-data-lifecycle.md` e `docs/validation/evidence/06e2-data-lifecycle/` com relatório/manifest/capturas mascaradas. Não gerar evidência de sucesso antes de executar.

## Interfaces e dados

Consome Principal/withWorkspaceTransaction/requirePermission/AppError atuais; Reviewed/Confirm/EvidenceRef/EffectResult conforme contratos comuns quando aplicáveis. A API de frontend não recebePrincipal do cliente. Reusar um serviço existente com assinatura equivalente via adaptação explícita antes de criar duplicação.

```ts
type MergeInput={targetId:string,sourceIds:string[],expectedRevision:number,fieldChoices:Record<string,string>};
type MergeView={id:string,state:"merged"|"undone"|"conflict",undoUntil:string};
type DataRequest={kind:"export"|"delete"|"retention",leadIds:string[],requestId:string,retentionDays?:number};
declare function prepareMerge(p:Principal,input:MergeInput):Promise<Reviewed<MergeInput>>;
declare function confirmMerge(p:Principal,input:Confirm<MergeInput>):Promise<MergeView>;
declare function undoMerge(p:Principal,input:{mergeId:string;expectedRevision:number;requestId:string}):Promise<MergeView>;
declare function requestDataLifecycle(p:Principal,input:DataRequest):Promise<{id:string;state:string}>;
```

**Entrada HTTP/CLI:** POST /api/data-lifecycle {action:scan|prepare-merge|confirm-merge|prepare-delete|confirm-delete|export|retention,input,token?,requestId?}; POST /:id/undo; GET /api/data-lifecycle?id=... para progresso/download autorizado

**Persistência:** merge_record, data_request, retention_policy, data_tombstone; unicidade de solicitação e snapshot privado com expiração Migração reservada`db/migrations/092-data-lifecycle.sql`; não editar 001–082 aplicadas.

### Task 1: Contrato de domínio e persistência autorizada

**Files:** `src/domain/data-lifecycle.ts`, `tests/06e2-data-lifecycle.test.ts`, `db/migrations/092-data-lifecycle.sql`; DTOs deste plano pertencem ao domínio do pacote.

**Interfaces:** Produz `duplicateIdentityMatch(input:{emailA:string;emailB:string;companyA:string;companyB:string}):boolean` e os DTOs acima. Consome os contratos comuns e formatos existentes da área.

- [ ] **Step 1 — RED:** criar `tests/06e2-data-lifecycle.test.ts` com o caso abaixo e variações de limite/ausência. Nomeigual semidentificador confiável não determina duplicata.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {duplicateIdentityMatch} from '../src/domain/data-lifecycle.ts';
test('06E.2 preserva a regra do domínio',()=>{
  assert.deepEqual(duplicateIdentityMatch({"emailA":"","emailB":"","companyA":"Empresa A","companyB":"Empresa A"}),false);
});
```

- [ ] **Step 2 — confirmar RED:** `rtk proxy node --experimental-strip-types --test tests/06e2-data-lifecycle.test.ts`. Esperado: teste falha pela função/regra ausente; corrigir antes erros de fixture/sintaxe que mascarem a regra.
- [ ] **Step 3 — implementar:** definir os tipos e a função acima. Criar migração com tabelas/índices/FKs descritos, RLS forçada por workspace, funções worker mínimas e idempotência transacional; não conceder escrita ampla ao dispatcher. Scan paginado base completa com CNPJ/email/phone normalizados semusar nome comoidentidade. Fusão preserva vínculos históricos/consentimento mais restritivo; arquivaorigens, não duplica quota. Desfazeraté 7 dias sóse revisões afetadas intactas; conflitoretorn 409, jamais sobrescrever mudançasnovas. Retenção desligada porpadrão; ativa 7/30/90/180/365 dias escolhidos explicitamente, texto/anexos apagados em lotes. Tombstone invalida cache/evidência/IA/busca/exports; trilha mínima semcorpo. Exportprivado expira 24 h; links 5 min.
- [ ] **Step 4 — GREEN e commit:** repetir exatamente o comando RED até passar; conferir tipos/contratos e commit local focado, sem push/deploy implícito.

### Task 2: Serviço, execução e invariantes de falha

**Files:** `src/server/privacy/service.ts`, `src/server/privacy/merge.ts`, `src/server/privacy/worker.ts`, `src/app/api/data-lifecycle/route.ts`, `src/app/api/data-lifecycle/[id]/[action]/route.ts`, `tests/integration/06e2-data-lifecycle.test.ts`, `scripts/test-integration.mjs` e serviços existentes da área listados em Modify.

**Interfaces:** Consome DTOs/identidade e o resultado da Task 1; produz exatamente as funções de serviço declaradas neste plano. Dependências externas devem ser injetáveis nos testes, sem substituir autoridade real do banco.

- [ ] **Step 1 — RED de integração:** adicionar `06e2-data-lifecycle` à allowlist do runner. Reaproveitar fixtures de identidade/bancos/fechamento em tests/integration/helpers.ts e helpers da área; criar 2 workspaces e papéis próprios, sem usar contas/dados reais. Escrever os testes abaixo com contagens/estados/efeitos observáveis.

  - Caso 1: scanencontra duplicatafora da primeira página; nomesiguais não são fundidos.
  - Caso 2: merge repetido semdupla quota; optout prevalece; undoapósedição 409 eantesrestaura vínculos.
  - Caso 3: deleteinterrompe jobs/rascunhosSDR/exports eapaga dados de IA/cache mantendo receiptssemconteúdo.
  - Caso 4: retenção 22 dias nãotocarecentes; workerrevogado não apaga outro tenant; arquivos sãoinacessíveis pósdelete.

  - Caso de autoridade: endpoint direto/worker com usuário removido ou recurso cruzado retorna 403/404, publica 0 resultados para o cliente e não expõe segredo. Receipts técnicos já recebidos ficam só no escopo autorizado.

- [ ] **Step 2 — confirmar RED:** `rtk proxy node scripts/test-integration.mjs 06e2-data-lifecycle`. Esperado: falha pela regra de serviço ainda ausente; banco criado pelo runner é efêmero _test, nunca o banco operacional.
- [ ] **Step 3 — implementar serviço:** usar as assinaturas declaradas, validação Zod, transações/locks/leases e deduplicação. Scan paginado base completa com CNPJ/email/phone normalizados semusar nome comoidentidade. Fusão preserva vínculos históricos/consentimento mais restritivo; arquivaorigens, não duplica quota. Desfazeraté 7 dias sóse revisões afetadas intactas; conflitoretorn 409, jamais sobrescrever mudançasnovas. Retenção desligada porpadrão; ativa 7/30/90/180/365 dias escolhidos explicitamente, texto/anexos apagados em lotes. Tombstone invalida cache/evidência/IA/busca/exports; trilha mínima semcorpo. Exportprivado expira 24 h; links 5 min. Não ampliar permissões para fazer teste passar. Task 2 cobre todos os itens de Review Focus; nenhum caso fica delegado apenas à observação visual.
- [ ] **Step 4 — GREEN e commit:** repetir a suíte focada; comparar os efeitos reais no banco/adapter com asserções e confirmar 0 efeitos inesperados. Commitar apenas os arquivos do pacote.

### Task 3: HTTP, UI/UX e aceite do pacote

**Files:** rotas/clientes novos listados na estrutura, `src/modules/settings/reference-settings.tsx` e relatório de validação do pacote.

**Interfaces:** Consome serviços da Task 2 e expõe os mesmos estados ao usuário, sem simular resultado nem autorização no browser. Se 07D for excluído, não criar superfícies deproduto e registrar a decisão como entrega do gate.

- [ ] **Step 1 — RED de contrato HTTP:** acrescentar à suíte focada pedido anônimo 401/403, papel proibido 403, input inválido 422, revisão conflitante 409 e repetição idempotente quando houver mutação; para avaliadorCLI, manifesto incompleto retorna exitcode nãozero e relatório de pendências. Confirmar falha antes do handler/avaliador.
- [ ] **Step 2 — ligar operações:** POST /api/data-lifecycle {action:scan|prepare-merge|confirm-merge|prepare-delete|confirm-delete|export|retention,input,token?,requestId?}; POST /:id/undo; GET /api/data-lifecycle?id=... para progresso/download autorizado Procurar→comparar campos→revisar→fundir→histórico/desfazer, com estados reais. Privacidade mostra escopo/consequência e progresso, não toggledecorativo. Gates de menu são só apresentação; serviço continua autoritativo. Estados de erro/loading/empty/partial/revoke e limites têm ação de recuperação e não apagam rascunho.
- [ ] **Step 3 — conferir visual e jornada:** `/settings/dados`, `/settings/privacy`, `/contacts`, `/leads/[id]`. Comparar com evidência disponível da referência no mesmo estado em 1920×855/390×844; checar 320 px, foco/escape/scroll, loading/falha/limite/sucesso. Mascarar dados e restaurar contexto de navegação/QA. Registrar desconhecidos da referência em separado.
- [ ] **Step 4 — verificação e aceite:** focados GREEN → `rtk proxy npm test` → `rtk proxy npm run test:integration` → `rtk proxy npm run build` → `rtk proxy npm run typecheck` → `rtk proxy git diff --check`. Todos passam ou o pacote fica pendente com falha reproduzível. No pacote puramente documental/gate excluído, rodar validador de documentos/links e suíte focada correspondente, sem testes de produto não alterado.
- [ ] **Step 5 — fechamento:** escrever relatório com casos, evidências/limitações, cleanupQA, restore de políticas/destinos, custos/saldo quando aplicável e estado de runtime. Revisão final conforme execução nativa; corrigir achados com regressão. Atualizar linha do índice/roadmap somente pelo aceite efetivo e commit local focado.

## Gate externo e critério específico

Políticade retenção financeira/jurídica separa metadados obrigatórios de conteúdo. Não oferecer restauração após expurgo físico ou após conflito.

## Self-review do plano

R13 mapeados às três tarefas. DTOs e funções têm uma definição neste plano e no desenho de área; contratos comuns evitam reinterpretar autorização/revisão. Task 1 cobre regra pura/persistência;Task 2 cobre todos os itens de Review Focus;Task 3 cobre o que a pessoa realmente consegue operar e ver. Dados/arquivos citados como Create são futuros; Modify foi conferido no baseline ou tem pacote anterior proprietário. Escrever um plano não equivale a passar seus testes.
