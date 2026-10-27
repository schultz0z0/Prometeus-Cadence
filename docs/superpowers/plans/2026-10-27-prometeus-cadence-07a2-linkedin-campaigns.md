# 07A.2 — Públicos, campanhas, convites e aceites LinkedIn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the native execution chosen by the user. Follow tasks in order; perform a fresh final review at execution time under the applicable execution skill. This session authors plans only.

**Goal:** Públicos, campanhas, convites e aceites LinkedIn; requisitos R18 do PRD.
**Architecture:** Evoluir serviços do monólito com os contratos da área; reutilizar autoridade, banco, jobs, ledger e eventos existentes. Novas interfaces listadas são contratos planejados, não funções já implementadas.
**Tech Stack:** Next 16.4.2, React 19.3.1, TypeScript 5.9.3, PostgreSQL/pg, Zod e node:test existentes; navegador de QA já disponível para UI.
**Spec:** [desenho da área](../specs/2026-10-27-prometeus-cadence-linkedin-design.md), [PRD](../specs/2026-10-27-prometeus-cadence-complete-prd.md), [contratos comuns](../specs/2026-10-27-prometeus-cadence-technical-contracts.md).

## Global Constraints

- Pacote planejado; não marcado concluído. Dependências: 07A.1, 06B.5. Ordem vigente no índice geral;07D só executa produto após seu gate.
- Apify/LLM centrais; contexto, canais, dados, cache, quota e resultados privados por workspace. Sem autoelevação de owner a admin da plataforma.
- Preservar trial de 7 dias, consumo pré-pago e OpenWA 20 mensagens/5 novoscontatos por dia; intervalo 60–180 s e demais gates existentes.
- Fidelidade ao CadenceFlow por rota/estado/viewport; não criar outra estética. Estados da referência não observados permanecem classificados.
- Mutações revisadas/idempotentes; I/O incerto não autoriza repetição. Piloto/cobrança/envio externo exigem contas/ações próprias autorizadas, não são iniciados por este plano.

## Review Focus

1. todosfiltros chegamprovider ou retornamunsupported antes de cobrar
2. duascampanhas/cron concorrentes respeitamlimiteconta/dia e 1 convitepessoa
3. timeoutenvio incerto não reenvia; pausaapósclaim impede novos convites
4. aceiterepetido insere 1 destino e 1 evento; nãoaceite não vira leadcomresposta
5. A chamada HTTP/SQL direta e a revogação durante I/O não podem ampliar autoridade; resposta/log/evidência não incluem segredos nem conteúdo de outro workspace.

## File Structure

- Create: `src/domain/linkedin-campaign.ts`.
- Create: `src/server/linkedin/campaigns.ts`.
- Create: `src/server/linkedin/audience.ts`.
- Create: `src/server/linkedin/invites.ts`.
- Create: `src/modules/linkedin/campaign-editor.tsx`.
- Create: `src/modules/linkedin/campaign-list.tsx`.
- Create: `db/migrations/098-linkedin-campaigns.sql`.
- Create: `tests/07a2-linkedin-campaigns.test.ts`.
- Create: `tests/integration/07a2-linkedin-campaigns.test.ts`.
- Modify: `src/modules/settings/linkedin-sdr.tsx`.
- Modify: `src/server/linkedin/http.ts`.
- Modify: `src/domain/operation-events.ts`.
- Modify: `scripts/test-integration.mjs`.
- Evidence: `docs/validation/07a2-linkedin-campaigns.md` e `docs/validation/evidence/07a2-linkedin-campaigns/` com relatório/manifest/capturas mascaradas. Não gerar evidência de sucesso antes de executar.

## Interfaces e dados

Consome Principal/withWorkspaceTransaction/requirePermission/AppError atuais; Reviewed/Confirm/EvidenceRef/EffectResult conforme contratos comuns quando aplicáveis. A API de frontend não recebePrincipal do cliente. Reusar um serviço existente com assinatura equivalente via adaptação explícita antes de criar duplicação.

```ts
type LinkedinCampaignDraft={id:string,name:string,accountId:string,expectedRevision:number,source:{mode:"filters"|"post",roles:string[],locations:string[],industries:string[],postUrl?:string,degrees:number[]},note:string,dailyLimit:number,acceptListId:string|null,otherListId:string|null,enrichOnAccept:boolean};
type CampaignPersonView={id:string,state:"candidate"|"review"|"queued"|"invited"|"accepted"|"failed"|"uncertain",remoteId:string|null};
declare function saveLinkedinCampaign(p:Principal,input:LinkedinCampaignDraft):Promise<Versioned<LinkedinCampaignDraft>>;
declare function prepareLinkedinCampaign(p:Principal,input:{id:string;revision:number}):Promise<Reviewed<{id:string;revision:number}>>;
declare function runLinkedinInviteTick(options:{limit:number;signal:AbortSignal}):Promise<{accepted:number;uncertain:number}>;
```

**Entrada HTTP/CLI:** GET /api/linkedin/campaigns; POST para save/prepare/confirm; POST /api/linkedin/campaigns/:id/{pause,resume,cancel}; GET /api/linkedin/audience?campaignId&cursor; prévias de coleta com confirmação de custo

**Persistência:** linkedin_campaign, linkedin_campaign_person, linkedin_invite_operation; UNIQUE(workspace_id,campaign_id,person_external_id), fila e revisão congeladas Migração reservada`db/migrations/098-linkedin-campaigns.sql`; não editar 001–082 aplicadas.

### Task 1: Contrato de domínio e persistência autorizada

**Files:** `src/domain/linkedin-campaign.ts`, `tests/07a2-linkedin-campaigns.test.ts`, `db/migrations/098-linkedin-campaigns.sql`; DTOs deste plano pertencem ao domínio do pacote.

**Interfaces:** Produz `linkedinInviteEligible(input:{connectedAlready:boolean;pendingInvite:boolean;approved:boolean}):boolean` e os DTOs acima. Consome os contratos comuns e formatos existentes da área.

- [ ] **Step 1 — RED:** criar `tests/07a2-linkedin-campaigns.test.ts` com o caso abaixo e variações de limite/ausência. Convitependente não é enviado novamente em outra tentativa.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {linkedinInviteEligible} from '../src/domain/linkedin-campaign.ts';
test('07A.2 preserva a regra do domínio',()=>{
  assert.deepEqual(linkedinInviteEligible({"connectedAlready":false,"pendingInvite":true,"approved":true}),false);
});
```

- [ ] **Step 2 — confirmar RED:** `rtk proxy node --experimental-strip-types --test tests/07a2-linkedin-campaigns.test.ts`. Esperado: teste falha pela função/regra ausente; corrigir antes erros de fixture/sintaxe que mascarem a regra.
- [ ] **Step 3 — implementar:** definir os tipos e a função acima. Criar migração com tabelas/índices/FKs descritos, RLS forçada por workspace, funções worker mínimas e idempotência transacional; não conceder escrita ampla ao dispatcher. Filtros reais porcontrato;unsupportedfield dá 422 emvezignorar. Extrair público depost só fontegrantvalidada. Notapersonalizável com IA central e variáveispermitidas; semfato inventado. Ritmo inicial máximo 12 convites/dia ou menorlimiteconcedido, semgarantia de conta segura. Warmup/visita/like/comentário só executam sobcapacidade e revisão, senãobloqueadoscom motivo. Aceite é evento remotecomprovado, gera destino/enrichment revisadoconformeconfig, não dadoestimado.
- [ ] **Step 4 — GREEN e commit:** repetir exatamente o comando RED até passar; conferir tipos/contratos e commit local focado, sem push/deploy implícito.

### Task 2: Serviço, execução e invariantes de falha

**Files:** `src/server/linkedin/campaigns.ts`, `src/server/linkedin/audience.ts`, `src/server/linkedin/invites.ts`, `tests/integration/07a2-linkedin-campaigns.test.ts`, `scripts/test-integration.mjs` e serviços existentes da área listados em Modify.

**Interfaces:** Consome DTOs/identidade e o resultado da Task 1; produz exatamente as funções de serviço declaradas neste plano. Dependências externas devem ser injetáveis nos testes, sem substituir autoridade real do banco.

- [ ] **Step 1 — RED de integração:** adicionar `07a2-linkedin-campaigns` à allowlist do runner. Reaproveitar fixtures de identidade/bancos/fechamento em tests/integration/helpers.ts e helpers da área; criar 2 workspaces e papéis próprios, sem usar contas/dados reais. Escrever os testes abaixo com contagens/estados/efeitos observáveis.

  - Caso 1: todosfiltros chegamprovider ou retornamunsupported antes de cobrar.
  - Caso 2: duascampanhas/cron concorrentes respeitamlimiteconta/dia e 1 convitepessoa.
  - Caso 3: timeoutenvio incerto não reenvia; pausaapósclaim impede novos convites.
  - Caso 4: aceiterepetido insere 1 destino e 1 evento; nãoaceite não vira leadcomresposta.

  - Caso de autoridade: endpoint direto/worker com usuário removido ou recurso cruzado retorna 403/404, publica 0 resultados para o cliente e não expõe segredo. Receipts técnicos já recebidos ficam só no escopo autorizado.

- [ ] **Step 2 — confirmar RED:** `rtk proxy node scripts/test-integration.mjs 07a2-linkedin-campaigns`. Esperado: falha pela regra de serviço ainda ausente; banco criado pelo runner é efêmero _test, nunca o banco operacional.
- [ ] **Step 3 — implementar serviço:** usar as assinaturas declaradas, validação Zod, transações/locks/leases e deduplicação. Filtros reais porcontrato;unsupportedfield dá 422 emvezignorar. Extrair público depost só fontegrantvalidada. Notapersonalizável com IA central e variáveispermitidas; semfato inventado. Ritmo inicial máximo 12 convites/dia ou menorlimiteconcedido, semgarantia de conta segura. Warmup/visita/like/comentário só executam sobcapacidade e revisão, senãobloqueadoscom motivo. Aceite é evento remotecomprovado, gera destino/enrichment revisadoconformeconfig, não dadoestimado. Não ampliar permissões para fazer teste passar. Task 2 cobre todos os itens de Review Focus; nenhum caso fica delegado apenas à observação visual.
- [ ] **Step 4 — GREEN e commit:** repetir a suíte focada; comparar os efeitos reais no banco/adapter com asserções e confirmar 0 efeitos inesperados. Commitar apenas os arquivos do pacote.

### Task 3: HTTP, UI/UX e aceite do pacote

**Files:** rotas/clientes novos listados na estrutura, `src/modules/settings/linkedin-sdr.tsx` e relatório de validação do pacote.

**Interfaces:** Consome serviços da Task 2 e expõe os mesmos estados ao usuário, sem simular resultado nem autorização no browser. Se 07D for excluído, não criar superfícies deproduto e registrar a decisão como entrega do gate.

- [ ] **Step 1 — RED de contrato HTTP:** acrescentar à suíte focada pedido anônimo 401/403, papel proibido 403, input inválido 422, revisão conflitante 409 e repetição idempotente quando houver mutação; para avaliadorCLI, manifesto incompleto retorna exitcode nãozero e relatório de pendências. Confirmar falha antes do handler/avaliador.
- [ ] **Step 2 — ligar operações:** GET /api/linkedin/campaigns; POST para save/prepare/confirm; POST /api/linkedin/campaigns/:id/{pause,resume,cancel}; GET /api/linkedin/audience?campaignId&cursor; prévias de coleta com confirmação de custo Todoschips/filtros/post/nota/ritmo/destinos/quaisquercontrolesvisíveis têm persistência e efeito. Revisão mostra público real separado de estimativa. Gates de menu são só apresentação; serviço continua autoritativo. Estados de erro/loading/empty/partial/revoke e limites têm ação de recuperação e não apagam rascunho.
- [ ] **Step 3 — conferir visual e jornada:** `/linkedin/campaigns`, `/linkedin/campaigns/new`, `/linkedin/dashboard`. Comparar com evidência disponível da referência no mesmo estado em 1920×855/390×844; checar 320 px, foco/escape/scroll, loading/falha/limite/sucesso. Mascarar dados e restaurar contexto de navegação/QA. Registrar desconhecidos da referência em separado.
- [ ] **Step 4 — verificação e aceite:** focados GREEN → `rtk proxy npm test` → `rtk proxy npm run test:integration` → `rtk proxy npm run build` → `rtk proxy npm run typecheck` → `rtk proxy git diff --check`. Todos passam ou o pacote fica pendente com falha reproduzível. No pacote puramente documental/gate excluído, rodar validador de documentos/links e suíte focada correspondente, sem testes de produto não alterado.
- [ ] **Step 5 — fechamento:** escrever relatório com casos, evidências/limitações, cleanupQA, restore de políticas/destinos, custos/saldo quando aplicável e estado de runtime. Revisão final conforme execução nativa; corrigir achados com regressão. Atualizar linha do índice/roadmap somente pelo aceite efetivo e commit local focado.

## Gate externo e critério específico

Limite 12 é teto inicial conservador próprio, não política do LinkedIn nem promessa depermissão. Nãoenviar convites a terceiros em QA.

## Self-review do plano

R18 mapeados às três tarefas. DTOs e funções têm uma definição neste plano e no desenho de área; contratos comuns evitam reinterpretar autorização/revisão. Task 1 cobre regra pura/persistência;Task 2 cobre todos os itens de Review Focus;Task 3 cobre o que a pessoa realmente consegue operar e ver. Dados/arquivos citados como Create são futuros; Modify foi conferido no baseline ou tem pacote anterior proprietário. Escrever um plano não equivale a passar seus testes.
