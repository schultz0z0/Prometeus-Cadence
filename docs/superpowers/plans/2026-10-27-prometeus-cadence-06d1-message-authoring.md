# 06D.1 — Autoria, variantes, anexos e publicação Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the native execution chosen by the user. Follow tasks in order; perform a fresh final review at execution time under the applicable execution skill. This session authors plans only.

**Goal:** Autoria, variantes, anexos e publicação; requisitos R07, R08 do PRD.
**Architecture:** Evoluir serviços do monólito com os contratos da área; reutilizar autoridade, banco, jobs, ledger e eventos existentes. Novas interfaces listadas são contratos planejados, não funções já implementadas.
**Tech Stack:** Next 16.4.2, React 19.3.1, TypeScript 5.9.3, PostgreSQL/pg, Zod e node:test existentes; navegador de QA já disponível para UI.
**Spec:** [desenho da área](../specs/2026-10-27-prometeus-cadence-messaging-design.md), [PRD](../specs/2026-10-27-prometeus-cadence-complete-prd.md), [contratos comuns](../specs/2026-10-27-prometeus-cadence-technical-contracts.md).

## Global Constraints

- Pacote planejado; não marcado concluído. Dependências: 06B.4, 05. Ordem vigente no índice geral;07D só executa produto após seu gate.
- Apify/LLM centrais; contexto, canais, dados, cache, quota e resultados privados por workspace. Sem autoelevação de owner a admin da plataforma.
- Preservar trial de 7 dias, consumo pré-pago e OpenWA 20 mensagens/5 novoscontatos por dia; intervalo 60–180 s e demais gates existentes.
- Fidelidade ao CadenceFlow por rota/estado/viewport; não criar outra estética. Estados da referência não observados permanecem classificados.
- Mutações revisadas/idempotentes; I/O incerto não autoriza repetição. Piloto/cobrança/envio externo exigem contas/ações próprias autorizadas, não são iniciados por este plano.

## Review Focus

1. template selecionado realmente copia conteúdo editável; IA obsoleta não apaga edição manual
2. anexo de outro tenant/arquivo rejeitado/canal sem suporte bloqueiam revisão; download apósrevogação 403
3. mesma publicação repete mesma variante eanexos; edição posterior não muda mensagens já publicadas
4. calendário/fuso/delay/stopOnReply preservados; revisão vencida 409 e 0 outbox novo
5. A chamada HTTP/SQL direta e a revogação durante I/O não podem ampliar autoridade; resposta/log/evidência não incluem segredos nem conteúdo de outro workspace.

## File Structure

- Create: `src/domain/message-authoring.ts`.
- Create: `src/server/messaging/content.ts`.
- Create: `src/server/messaging/attachments.ts`.
- Create: `src/server/files/blob-store.ts`.
- Create: `src/server/files/local-store.ts`.
- Create: `src/app/api/message-content/route.ts`.
- Create: `src/app/api/message-files/route.ts`.
- Create: `src/app/api/message-files/[id]/route.ts`.
- Create: `db/migrations/085-message-content.sql`.
- Create: `tests/06d1-message-authoring.test.ts`.
- Create: `tests/integration/06d1-message-authoring.test.ts`.
- Modify: `src/domain/model.ts`.
- Modify: `src/domain/cadence.ts`.
- Modify: `src/server/planning/contracts.ts`.
- Modify: `src/server/messaging/publication-v2.ts`.
- Modify: `src/server/messaging/outbox.ts`.
- Modify: `src/modules/cadences/step-editor.tsx`.
- Modify: `src/modules/cadences/template-library.tsx`.
- Modify: `src/modules/cadences/cadence-publication-v2.tsx`.
- Modify: `scripts/test-integration.mjs`.
- Evidence: `docs/validation/06d1-message-authoring.md` e `docs/validation/evidence/06d1-message-authoring/` com relatório/manifest/capturas mascaradas. Não gerar evidência de sucesso antes de executar.

## Interfaces e dados

Consome Principal/withWorkspaceTransaction/requirePermission/AppError atuais; Reviewed/Confirm/EvidenceRef/EffectResult conforme contratos comuns quando aplicáveis. A API de frontend não recebePrincipal do cliente. Reusar um serviço existente com assinatura equivalente via adaptação explícita antes de criar duplicação.

```ts
type ContentDraft={cadenceId:string,expectedRevision:number,steps:{id:string,channel:"EMAIL"|"WHATSAPP"|"LINKEDIN",body:string,subject?:string,variant?:"A"|"B",attachmentIds:string[]}[]};
type ContentPublication={cadenceId:string,contentRevision:number};
type AttachmentUpload={name:string,mime:string,bytes:Uint8Array};
type AttachmentView={id:string,name:string,mime:string,size:number,state:"pending"|"ready"|"rejected"};
declare function saveCadenceContent(p:Principal,input:ContentDraft):Promise<Versioned<ContentDraft>>;
declare function prepareContentPublication(p:Principal,input:ContentPublication):Promise<Reviewed<ContentPublication>>;
declare function storeAttachment(p:Principal,file:AttachmentUpload):Promise<AttachmentView>;
```

**Entrada HTTP/CLI:** POST /api/message-content {action:save|prepare-publish|confirm-publish,cadenceId,expectedRevision,...}; POST /api/message-files multipart restrito; GET /api/message-files/:id com autorização; publicação continua usando /api/messaging/publications

**Persistência:** cadence_content_revision, cadence_variant, message_attachment; vínculo à publicação imutável ehash do conteúdo; variantes determinísticas por enrollment Migração reservada`db/migrations/085-message-content.sql`; não editar 001–082 aplicadas.

### Task 1: Contrato de domínio e persistência autorizada

**Files:** `src/domain/message-authoring.ts`, `tests/06d1-message-authoring.test.ts`, `db/migrations/085-message-content.sql`; DTOs deste plano pertencem ao domínio do pacote.

**Interfaces:** Produz `validateAuthoringVariables(input:{body:string;allowed:string[]}):{valid:boolean;unknown:string[]}` e os DTOs acima. Consome os contratos comuns e formatos existentes da área.

- [ ] **Step 1 — RED:** criar `tests/06d1-message-authoring.test.ts` com o caso abaixo e variações de limite/ausência. Variável desconhecida impede publicação; não renderizar vazio silenciosamente.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAuthoringVariables} from '../src/domain/message-authoring.ts';
test('06D.1 preserva a regra do domínio',()=>{
  assert.deepEqual(validateAuthoringVariables({"body":"Olá {{inexistente}}","allowed":["companyName"]}),{"valid":false,"unknown":["inexistente"]});
});
```

- [ ] **Step 2 — confirmar RED:** `rtk proxy node --experimental-strip-types --test tests/06d1-message-authoring.test.ts`. Esperado: teste falha pela função/regra ausente; corrigir antes erros de fixture/sintaxe que mascarem a regra.
- [ ] **Step 3 — implementar:** definir os tipos e a função acima. Criar migração com tabelas/índices/FKs descritos, RLS forçada por workspace, funções worker mínimas e idempotência transacional; não conceder escrita ampla ao dispatcher. Conectar modos manual/IA/assistente/modelo à mesma revisão de conteúdo. Preservar edição concorrente e rascunho; publicação congela versão/variáveis/attachments. DivisãoA/B50/50 determinística por enrollment, sem rerrolar ao retry; desabilitada se faltar variante completa. Reusar preparePublicationV2 com bases estendidas. Blob privado 10MiB/5 arquivos; bytesMIME/hash, estado de verificação e suporte do canal antes do envio.
- [ ] **Step 4 — GREEN e commit:** repetir exatamente o comando RED até passar; conferir tipos/contratos e commit local focado, sem push/deploy implícito.

### Task 2: Serviço, execução e invariantes de falha

**Files:** `src/server/messaging/content.ts`, `src/server/messaging/attachments.ts`, `src/server/files/blob-store.ts`, `src/server/files/local-store.ts`, `src/app/api/message-content/route.ts`, `src/app/api/message-files/route.ts`, `src/app/api/message-files/[id]/route.ts`, `tests/integration/06d1-message-authoring.test.ts`, `scripts/test-integration.mjs` e serviços existentes da área listados em Modify.

**Interfaces:** Consome DTOs/identidade e o resultado da Task 1; produz exatamente as funções de serviço declaradas neste plano. Dependências externas devem ser injetáveis nos testes, sem substituir autoridade real do banco.

- [ ] **Step 1 — RED de integração:** adicionar `06d1-message-authoring` à allowlist do runner. Reaproveitar fixtures de identidade/bancos/fechamento em tests/integration/helpers.ts e helpers da área; criar 2 workspaces e papéis próprios, sem usar contas/dados reais. Escrever os testes abaixo com contagens/estados/efeitos observáveis.

  - Caso 1: template selecionado realmente copia conteúdo editável; IA obsoleta não apaga edição manual.
  - Caso 2: anexo de outro tenant/arquivo rejeitado/canal sem suporte bloqueiam revisão; download apósrevogação 403.
  - Caso 3: mesma publicação repete mesma variante eanexos; edição posterior não muda mensagens já publicadas.
  - Caso 4: calendário/fuso/delay/stopOnReply preservados; revisão vencida 409 e 0 outbox novo.

  - Caso de autoridade: endpoint direto/worker com usuário removido ou recurso cruzado retorna 403/404, publica 0 resultados para o cliente e não expõe segredo. Receipts técnicos já recebidos ficam só no escopo autorizado.

- [ ] **Step 2 — confirmar RED:** `rtk proxy node scripts/test-integration.mjs 06d1-message-authoring`. Esperado: falha pela regra de serviço ainda ausente; banco criado pelo runner é efêmero _test, nunca o banco operacional.
- [ ] **Step 3 — implementar serviço:** usar as assinaturas declaradas, validação Zod, transações/locks/leases e deduplicação. Conectar modos manual/IA/assistente/modelo à mesma revisão de conteúdo. Preservar edição concorrente e rascunho; publicação congela versão/variáveis/attachments. DivisãoA/B50/50 determinística por enrollment, sem rerrolar ao retry; desabilitada se faltar variante completa. Reusar preparePublicationV2 com bases estendidas. Blob privado 10MiB/5 arquivos; bytesMIME/hash, estado de verificação e suporte do canal antes do envio. Não ampliar permissões para fazer teste passar. Task 2 cobre todos os itens de Review Focus; nenhum caso fica delegado apenas à observação visual.
- [ ] **Step 4 — GREEN e commit:** repetir a suíte focada; comparar os efeitos reais no banco/adapter com asserções e confirmar 0 efeitos inesperados. Commitar apenas os arquivos do pacote.

### Task 3: HTTP, UI/UX e aceite do pacote

**Files:** rotas/clientes novos listados na estrutura, `src/modules/cadences/step-editor.tsx`, `src/modules/cadences/template-library.tsx`, `src/modules/cadences/cadence-publication-v2.tsx` e relatório de validação do pacote.

**Interfaces:** Consome serviços da Task 2 e expõe os mesmos estados ao usuário, sem simular resultado nem autorização no browser. Se 07D for excluído, não criar superfícies deproduto e registrar a decisão como entrega do gate.

- [ ] **Step 1 — RED de contrato HTTP:** acrescentar à suíte focada pedido anônimo 401/403, papel proibido 403, input inválido 422, revisão conflitante 409 e repetição idempotente quando houver mutação; para avaliadorCLI, manifesto incompleto retorna exitcode nãozero e relatório de pendências. Confirmar falha antes do handler/avaliador.
- [ ] **Step 2 — ligar operações:** POST /api/message-content {action:save|prepare-publish|confirm-publish,cadenceId,expectedRevision,...}; POST /api/message-files multipart restrito; GET /api/message-files/:id com autorização; publicação continua usando /api/messaging/publications Todos os controles do editor, preview de variáveis, varianteB, anexos, templates, agenda e revisão precisam persistir e alterar o executor. Nenhum botão de envio na sugestão. Gates de menu são só apresentação; serviço continua autoritativo. Estados de erro/loading/empty/partial/revoke e limites têm ação de recuperação e não apagam rascunho.
- [ ] **Step 3 — conferir visual e jornada:** `/cadences/new`, `/cadences/[id]`, `/templates`, `/automations/new/ai`. Comparar com evidência disponível da referência no mesmo estado em 1920×855/390×844; checar 320 px, foco/escape/scroll, loading/falha/limite/sucesso. Mascarar dados e restaurar contexto de navegação/QA. Registrar desconhecidos da referência em separado.
- [ ] **Step 4 — verificação e aceite:** focados GREEN → `rtk proxy npm test` → `rtk proxy npm run test:integration` → `rtk proxy npm run build` → `rtk proxy npm run typecheck` → `rtk proxy git diff --check`. Todos passam ou o pacote fica pendente com falha reproduzível. No pacote puramente documental/gate excluído, rodar validador de documentos/links e suíte focada correspondente, sem testes de produto não alterado.
- [ ] **Step 5 — fechamento:** escrever relatório com casos, evidências/limitações, cleanupQA, restore de políticas/destinos, custos/saldo quando aplicável e estado de runtime. Revisão final conforme execução nativa; corrigir achados com regressão. Atualizar linha do índice/roadmap somente pelo aceite efetivo e commit local focado.

## Gate externo e critério específico

Arquivos privados precisam de volume durável no deploy. Provedor que não aceitar conteúdo/anexo não pode ser habilitado com base só na UI.

## Self-review do plano

R07, R08 mapeados às três tarefas. DTOs e funções têm uma definição neste plano e no desenho de área; contratos comuns evitam reinterpretar autorização/revisão. Task 1 cobre regra pura/persistência;Task 2 cobre todos os itens de Review Focus;Task 3 cobre o que a pessoa realmente consegue operar e ver. Dados/arquivos citados como Create são futuros; Modify foi conferido no baseline ou tem pacote anterior proprietário. Escrever um plano não equivale a passar seus testes.
