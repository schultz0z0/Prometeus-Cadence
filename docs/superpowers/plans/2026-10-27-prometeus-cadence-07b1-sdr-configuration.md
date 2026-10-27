# 07B.1 — Configuração e ativação do agente SDR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the native execution chosen by the user. Follow tasks in order; perform a fresh final review at execution time under the applicable execution skill. This session authors plans only.

**Goal:** Configuração e ativação do agente SDR; requisitos R19 do PRD.
**Architecture:** Evoluir serviços do monólito com os contratos da área; reutilizar autoridade, banco, jobs, ledger e eventos existentes. Novas interfaces listadas são contratos planejados, não funções já implementadas.
**Tech Stack:** Next 16.4.2, React 19.3.1, TypeScript 5.9.3, PostgreSQL/pg, Zod e node:test existentes; navegador de QA já disponível para UI.
**Spec:** [desenho da área](../specs/2026-10-27-prometeus-cadence-sdr-design.md), [PRD](../specs/2026-10-27-prometeus-cadence-complete-prd.md), [contratos comuns](../specs/2026-10-27-prometeus-cadence-technical-contracts.md).

## Global Constraints

- Pacote planejado; não marcado concluído. Dependências: 06F, 07C.2, 07A.3, 07C.3. Ordem vigente no índice geral;07D só executa produto após seu gate.
- Apify/LLM centrais; contexto, canais, dados, cache, quota e resultados privados por workspace. Sem autoelevação de owner a admin da plataforma.
- Preservar trial de 7 dias, consumo pré-pago e OpenWA 20 mensagens/5 novoscontatos por dia; intervalo 60–180 s e demais gates existentes.
- Fidelidade ao CadenceFlow por rota/estado/viewport; não criar outra estética. Estados da referência não observados permanecem classificados.
- Mutações revisadas/idempotentes; I/O incerto não autoriza repetição. Piloto/cobrança/envio externo exigem contas/ações próprias autorizadas, não são iniciados por este plano.

## Review Focus

1. salvardraft e simular não envia nem ativaporretornoUI
2. ownercliente não trocamodelo/key; knowledgeURL privada e promptinjection rejeitados/isolados
3. alterarhorário/roteiro/contexto apósreview 409; canalde outro workspace 404
4. pauseconcorrecomação: nova mensagemnãoentraworker; apenasmanualrestorepode reativar
5. A chamada HTTP/SQL direta e a revogação durante I/O não podem ampliar autoridade; resposta/log/evidência não incluem segredos nem conteúdo de outro workspace.

## File Structure

- Create: `src/domain/sdr-policy.ts`.
- Create: `src/server/sdr/configuration.ts`.
- Create: `src/server/sdr/knowledge.ts`.
- Create: `src/server/sdr/http.ts`.
- Create: `src/app/api/sdr/[resource]/route.ts`.
- Create: `src/app/api/sdr/[resource]/[id]/[action]/route.ts`.
- Create: `src/modules/sdr/agent-settings.tsx`.
- Create: `src/client/sdr-client.ts`.
- Create: `db/migrations/102-sdr-configuration.sql`.
- Create: `tests/07b1-sdr-configuration.test.ts`.
- Create: `tests/integration/07b1-sdr-configuration.test.ts`.
- Modify: `src/modules/settings/sdr-overview.tsx`.
- Modify: `src/domain/ai-skills.ts`.
- Modify: `scripts/test-integration.mjs`.
- Evidence: `docs/validation/07b1-sdr-configuration.md` e `docs/validation/evidence/07b1-sdr-configuration/` com relatório/manifest/capturas mascaradas. Não gerar evidência de sucesso antes de executar.

## Interfaces e dados

Consome Principal/withWorkspaceTransaction/requirePermission/AppError atuais; Reviewed/Confirm/EvidenceRef/EffectResult conforme contratos comuns quando aplicáveis. A API de frontend não recebePrincipal do cliente. Reusar um serviço existente com assinatura equivalente via adaptação explícita antes de criar duplicação.

```ts
type SdrDraft={id:string,expectedRevision:number,name:string,instructions:string,knowledgeIds:string[],channelIds:string[],hours:{timezone:string,weekdays:number[],start:string,end:string,allDay:boolean},qualification:{field:string,required:boolean}[],handoffMemberId:string,maxRepliesPerDay:number,approvalMode:"all"|"bounded-auto",followupEnabled:boolean,approvedFaqIds:string[]};
type SdrAgentView={id:string,revision:number,state:"draft"|"active"|"paused",contextVersion:number};
declare function saveSdrDraft(p:Principal,input:SdrDraft):Promise<Versioned<SdrDraft>>;
declare function prepareSdrActivation(p:Principal,input:{agentId:string;revision:number}):Promise<Reviewed<{agentId:string;revision:number}>>;
declare function confirmSdrActivation(p:Principal,input:Confirm<{agentId:string;revision:number}>):Promise<SdrAgentView>;
```

**Entrada HTTP/CLI:** GET/POST /api/sdr/agents para draft; POST /api/sdr/agents/:id/{prepare-activate,confirm-activate,pause}; conhecimento versionado via /api/sdr/knowledge

**Persistência:** sdr_agent, sdr_agent_revision, sdr_knowledge, sdr_channel_binding; versão imutável de configuração ativada, FKcanais por workspace Migração reservada`db/migrations/102-sdr-configuration.sql`; não editar 001–082 aplicadas.

### Task 1: Contrato de domínio e persistência autorizada

**Files:** `src/domain/sdr-policy.ts`, `tests/07b1-sdr-configuration.test.ts`, `db/migrations/102-sdr-configuration.sql`; DTOs deste plano pertencem ao domínio do pacote.

**Interfaces:** Produz `sdrActivationAllowed(input:{contextApproved:boolean;channelReady:boolean;hasHandoff:boolean;reviewed:boolean}):boolean` e os DTOs acima. Consome os contratos comuns e formatos existentes da área.

- [ ] **Step 1 — RED:** criar `tests/07b1-sdr-configuration.test.ts` com o caso abaixo e variações de limite/ausência. Agente sem destinohumano/regra deencaminhamento não ativa.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {sdrActivationAllowed} from '../src/domain/sdr-policy.ts';
test('07B.1 preserva a regra do domínio',()=>{
  assert.deepEqual(sdrActivationAllowed({"contextApproved":true,"channelReady":true,"hasHandoff":false,"reviewed":true}),false);
});
```

- [ ] **Step 2 — confirmar RED:** `rtk proxy node --experimental-strip-types --test tests/07b1-sdr-configuration.test.ts`. Esperado: teste falha pela função/regra ausente; corrigir antes erros de fixture/sintaxe que mascarem a regra.
- [ ] **Step 3 — implementar:** definir os tipos e a função acima. Criar migração com tabelas/índices/FKs descritos, RLS forçada por workspace, funções worker mínimas e idempotência transacional; não conceder escrita ampla ao dispatcher. Começar WhatsApppadrão; e-mail/LinkedIn somente capacidadeenviorecebimentovalidada, sem prometer 24 h noofficialLinkedInassistido. Contexto/produtosaprovados maisconhecimento do cliente ficamdadosprivados; instruções geraisprotegidas. Roteiro/limites/perguntas/handoff/regras persistidos e validados; defaultsapprovalall e teto 20 respostas/dia em OpenWAcompartilhado com outrosenvios. Sandboxdryrun semenvioantesativação. Canaldesconectado/contextoremovido invalidaativação. followupEnabled=false por padrão; FAQ aprovada é resposta textual versionada com campos permitidos, sem negociação autônoma de preço. Ativar bounded-auto não autoriza ferramentas de escrita/agenda/CRM sem política e revisão específica.
- [ ] **Step 4 — GREEN e commit:** repetir exatamente o comando RED até passar; conferir tipos/contratos e commit local focado, sem push/deploy implícito.

### Task 2: Serviço, execução e invariantes de falha

**Files:** `src/server/sdr/configuration.ts`, `src/server/sdr/knowledge.ts`, `src/server/sdr/http.ts`, `src/app/api/sdr/[resource]/route.ts`, `src/app/api/sdr/[resource]/[id]/[action]/route.ts`, `tests/integration/07b1-sdr-configuration.test.ts`, `scripts/test-integration.mjs` e serviços existentes da área listados em Modify.

**Interfaces:** Consome DTOs/identidade e o resultado da Task 1; produz exatamente as funções de serviço declaradas neste plano. Dependências externas devem ser injetáveis nos testes, sem substituir autoridade real do banco.

- [ ] **Step 1 — RED de integração:** adicionar `07b1-sdr-configuration` à allowlist do runner. Reaproveitar fixtures de identidade/bancos/fechamento em tests/integration/helpers.ts e helpers da área; criar 2 workspaces e papéis próprios, sem usar contas/dados reais. Escrever os testes abaixo com contagens/estados/efeitos observáveis.

  - Caso 1: salvardraft e simular não envia nem ativaporretornoUI.
  - Caso 2: ownercliente não trocamodelo/key; knowledgeURL privada e promptinjection rejeitados/isolados.
  - Caso 3: alterarhorário/roteiro/contexto apósreview 409; canalde outro workspace 404.
  - Caso 4: pauseconcorrecomação: nova mensagemnãoentraworker; apenasmanualrestorepode reativar.

  - Caso de autoridade: endpoint direto/worker com usuário removido ou recurso cruzado retorna 403/404, publica 0 resultados para o cliente e não expõe segredo. Receipts técnicos já recebidos ficam só no escopo autorizado.

- [ ] **Step 2 — confirmar RED:** `rtk proxy node scripts/test-integration.mjs 07b1-sdr-configuration`. Esperado: falha pela regra de serviço ainda ausente; banco criado pelo runner é efêmero _test, nunca o banco operacional.
- [ ] **Step 3 — implementar serviço:** usar as assinaturas declaradas, validação Zod, transações/locks/leases e deduplicação. Começar WhatsApppadrão; e-mail/LinkedIn somente capacidadeenviorecebimentovalidada, sem prometer 24 h noofficialLinkedInassistido. Contexto/produtosaprovados maisconhecimento do cliente ficamdadosprivados; instruções geraisprotegidas. Roteiro/limites/perguntas/handoff/regras persistidos e validados; defaultsapprovalall e teto 20 respostas/dia em OpenWAcompartilhado com outrosenvios. Sandboxdryrun semenvioantesativação. Canaldesconectado/contextoremovido invalidaativação. followupEnabled=false por padrão; FAQ aprovada é resposta textual versionada com campos permitidos, sem negociação autônoma de preço. Ativar bounded-auto não autoriza ferramentas de escrita/agenda/CRM sem política e revisão específica. Não ampliar permissões para fazer teste passar. Task 2 cobre todos os itens de Review Focus; nenhum caso fica delegado apenas à observação visual.
- [ ] **Step 4 — GREEN e commit:** repetir a suíte focada; comparar os efeitos reais no banco/adapter com asserções e confirmar 0 efeitos inesperados. Commitar apenas os arquivos do pacote.

### Task 3: HTTP, UI/UX e aceite do pacote

**Files:** rotas/clientes novos listados na estrutura, `src/modules/settings/sdr-overview.tsx` e relatório de validação do pacote.

**Interfaces:** Consome serviços da Task 2 e expõe os mesmos estados ao usuário, sem simular resultado nem autorização no browser. Se 07D for excluído, não criar superfícies deproduto e registrar a decisão como entrega do gate.

- [ ] **Step 1 — RED de contrato HTTP:** acrescentar à suíte focada pedido anônimo 401/403, papel proibido 403, input inválido 422, revisão conflitante 409 e repetição idempotente quando houver mutação; para avaliadorCLI, manifesto incompleto retorna exitcode nãozero e relatório de pendências. Confirmar falha antes do handler/avaliador.
- [ ] **Step 2 — ligar operações:** GET/POST /api/sdr/agents para draft; POST /api/sdr/agents/:id/{prepare-activate,confirm-activate,pause}; conhecimento versionado via /api/sdr/knowledge Configuração/guiapopups no padrãoobservado oucontratopróprio rotulado quandoestado pago nãoobservado; ativação mostraescopo/canais/horários/limites/approvals. Gates de menu são só apresentação; serviço continua autoritativo. Estados de erro/loading/empty/partial/revoke e limites têm ação de recuperação e não apagam rascunho.
- [ ] **Step 3 — conferir visual e jornada:** `/sdr`, `/settings/context`, `/settings/whatsapp`. Comparar com evidência disponível da referência no mesmo estado em 1920×855/390×844; checar 320 px, foco/escape/scroll, loading/falha/limite/sucesso. Mascarar dados e restaurar contexto de navegação/QA. Registrar desconhecidos da referência em separado.
- [ ] **Step 4 — verificação e aceite:** focados GREEN → `rtk proxy npm test` → `rtk proxy npm run test:integration` → `rtk proxy npm run build` → `rtk proxy npm run typecheck` → `rtk proxy git diff --check`. Todos passam ou o pacote fica pendente com falha reproduzível. No pacote puramente documental/gate excluído, rodar validador de documentos/links e suíte focada correspondente, sem testes de produto não alterado.
- [ ] **Step 5 — fechamento:** escrever relatório com casos, evidências/limitações, cleanupQA, restore de políticas/destinos, custos/saldo quando aplicável e estado de runtime. Revisão final conforme execução nativa; corrigir achados com regressão. Atualizar linha do índice/roadmap somente pelo aceite efetivo e commit local focado.

## Gate externo e critério específico

Pro/assinaturaválida e capacidadesoperacionais antesativar; gatesde venda 06G sóapós 07B3.

## Self-review do plano

R19 mapeados às três tarefas. DTOs e funções têm uma definição neste plano e no desenho de área; contratos comuns evitam reinterpretar autorização/revisão. Task 1 cobre regra pura/persistência;Task 2 cobre todos os itens de Review Focus;Task 3 cobre o que a pessoa realmente consegue operar e ver. Dados/arquivos citados como Create são futuros; Modify foi conferido no baseline ou tem pacote anterior proprietário. Escrever um plano não equivale a passar seus testes.
