# 07A.0 — Viabilidade e capacidades do LinkedIn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the native execution chosen by the user. Follow tasks in order; perform a fresh final review at execution time under the applicable execution skill. This session authors plans only.

**Goal:** Viabilidade e capacidades do LinkedIn; requisitos R18 do PRD.
**Architecture:** Evoluir serviços do monólito com os contratos da área; reutilizar autoridade, banco, jobs, ledger e eventos existentes. Novas interfaces listadas são contratos planejados, não funções já implementadas.
**Tech Stack:** Next 16.4.2, React 19.3.1, TypeScript 5.9.3, PostgreSQL/pg, Zod e node:test existentes; navegador de QA já disponível para UI.
**Spec:** [desenho da área](../specs/2026-10-27-prometeus-cadence-linkedin-design.md), [PRD](../specs/2026-10-27-prometeus-cadence-complete-prd.md), [contratos comuns](../specs/2026-10-27-prometeus-cadence-technical-contracts.md).

## Global Constraints

- Pacote planejado; não marcado concluído. Dependências: 06IA, 06E.1. Ordem vigente no índice geral;07D só executa produto após seu gate.
- Apify/LLM centrais; contexto, canais, dados, cache, quota e resultados privados por workspace. Sem autoelevação de owner a admin da plataforma.
- Preservar trial de 7 dias, consumo pré-pago e OpenWA 20 mensagens/5 novoscontatos por dia; intervalo 60–180 s e demais gates existentes.
- Fidelidade ao CadenceFlow por rota/estado/viewport; não criar outra estética. Estados da referência não observados permanecem classificados.
- Mutações revisadas/idempotentes; I/O incerto não autoriza repetição. Piloto/cobrança/envio externo exigem contas/ações próprias autorizadas, não são iniciados por este plano.

## Review Focus

1. OAuthlogin semgrantsconvite/mensagem deixaambosfalse
2. attestationexpirada/revogadabloqueia worker ecliente direto
3. oficialMessages recusa envio agendado mesmo owner/pagamento válido
4. todas as ações observadas no inventário têm capacidade, evidência e decisão; falta não é sucesso
5. A chamada HTTP/SQL direta e a revogação durante I/O não podem ampliar autoridade; resposta/log/evidência não incluem segredos nem conteúdo de outro workspace.

## File Structure

- Create: `src/domain/linkedin-capabilities.ts`.
- Create: `src/server/linkedin/capabilities.ts`.
- Create: `src/server/linkedin/provider-contract.ts`.
- Create: `src/server/linkedin/admin.ts`.
- Create: `db/migrations/096-linkedin-capabilities.sql`.
- Create: `tests/07a0-linkedin-feasibility.test.ts`.
- Create: `tests/integration/07a0-linkedin-feasibility.test.ts`.
- Modify: `src/server/auth/permissions.ts`.
- Modify: `src/modules/settings/linkedin-sdr.tsx`.
- Modify: `scripts/test-integration.mjs`.
- Evidence: `docs/validation/07a0-linkedin-feasibility.md` e `docs/validation/evidence/07a0-linkedin-feasibility/` com relatório/manifest/capturas mascaradas. Não gerar evidência de sucesso antes de executar.

## Interfaces e dados

Consome Principal/withWorkspaceTransaction/requirePermission/AppError atuais; Reviewed/Confirm/EvidenceRef/EffectResult conforme contratos comuns quando aplicáveis. A API de frontend não recebePrincipal do cliente. Reusar um serviço existente com assinatura equivalente via adaptação explícita antes de criar duplicação.

```ts
type LinkedinCapabilities={version:string,connect:boolean,audience:boolean,invite:boolean,acceptance:boolean,readMessages:boolean,sendMessage:"unavailable"|"assisted"|"automatic",profileActions:string[],verifiedAt:string|null};
type AdapterAttestation={adapterId:string,agreementRef:string,expiresAt:string,capabilities:LinkedinCapabilities,evidenceRefs:string[]};
declare function readLinkedinCapabilities(p:Principal):Promise<LinkedinCapabilities>;
declare function validateLinkedinAdapter(input:AdapterAttestation):Promise<LinkedinCapabilities>;
```

**Entrada HTTP/CLI:** GET /api/linkedin/capabilities será servido em 07A.1; administração protegida reaproveita autoridadeplatformAI sem entregargrantsecret ao cliente

**Persistência:** linkedin_capability_profile; versão do adaptador, grants comprovados, expiração/revogação e evidência da habilitação; somenteadmin configura infraestrutura Migração reservada`db/migrations/096-linkedin-capabilities.sql`; não editar 001–082 aplicadas.

### Task 1: Contrato de domínio e persistência autorizada

**Files:** `src/domain/linkedin-capabilities.ts`, `tests/07a0-linkedin-feasibility.test.ts`, `db/migrations/096-linkedin-capabilities.sql`; DTOs deste plano pertencem ao domínio do pacote.

**Interfaces:** Produz `linkedinMessageMode(input:{approved:boolean;humanActionRequired:boolean;canMessage:boolean}):'unavailable'|'assisted'|'automatic'` e os DTOs acima. Consome os contratos comuns e formatos existentes da área.

- [ ] **Step 1 — RED:** criar `tests/07a0-linkedin-feasibility.test.ts` com o caso abaixo e variações de limite/ausência. APIoficial queexige ação humana nunca é anunciada comomensagem agendada automática.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {linkedinMessageMode} from '../src/domain/linkedin-capabilities.ts';
test('07A.0 preserva a regra do domínio',()=>{
  assert.deepEqual(linkedinMessageMode({"approved":true,"humanActionRequired":true,"canMessage":true}),"assisted");
});
```

- [ ] **Step 2 — confirmar RED:** `rtk proxy node --experimental-strip-types --test tests/07a0-linkedin-feasibility.test.ts`. Esperado: teste falha pela função/regra ausente; corrigir antes erros de fixture/sintaxe que mascarem a regra.
- [ ] **Step 3 — implementar:** definir os tipos e a função acima. Criar migração com tabelas/índices/FKs descritos, RLS forçada por workspace, funções worker mínimas e idempotência transacional; não conceder escrita ampla ao dispatcher. Matrizaçãoverificável por capacidade: contaOAuth, search/postaudience, convite/nota, aceites, inbox, mensagens, visita/like/comentário observados. OficialMessages exige açãoafirmativaeditável no momento: modoassistedsemcron. CapturardadosApify não concede ação de conta. Capacidade não comprovada desliga botão/executor. Comparar alternativa de conector com operação equivalente, custo/permissões e contrato antes decidir; não instalaroucontratar nesta prova sem autorização específica.
- [ ] **Step 4 — GREEN e commit:** repetir exatamente o comando RED até passar; conferir tipos/contratos e commit local focado, sem push/deploy implícito.

### Task 2: Serviço, execução e invariantes de falha

**Files:** `src/server/linkedin/capabilities.ts`, `src/server/linkedin/provider-contract.ts`, `src/server/linkedin/admin.ts`, `tests/integration/07a0-linkedin-feasibility.test.ts`, `scripts/test-integration.mjs` e serviços existentes da área listados em Modify.

**Interfaces:** Consome DTOs/identidade e o resultado da Task 1; produz exatamente as funções de serviço declaradas neste plano. Dependências externas devem ser injetáveis nos testes, sem substituir autoridade real do banco.

- [ ] **Step 1 — RED de integração:** adicionar `07a0-linkedin-feasibility` à allowlist do runner. Reaproveitar fixtures de identidade/bancos/fechamento em tests/integration/helpers.ts e helpers da área; criar 2 workspaces e papéis próprios, sem usar contas/dados reais. Escrever os testes abaixo com contagens/estados/efeitos observáveis.

  - Caso 1: OAuthlogin semgrantsconvite/mensagem deixaambosfalse.
  - Caso 2: attestationexpirada/revogadabloqueia worker ecliente direto.
  - Caso 3: oficialMessages recusa envio agendado mesmo owner/pagamento válido.
  - Caso 4: todas as ações observadas no inventário têm capacidade, evidência e decisão; falta não é sucesso.

  - Caso de autoridade: endpoint direto/worker com usuário removido ou recurso cruzado retorna 403/404, publica 0 resultados para o cliente e não expõe segredo. Receipts técnicos já recebidos ficam só no escopo autorizado.

- [ ] **Step 2 — confirmar RED:** `rtk proxy node scripts/test-integration.mjs 07a0-linkedin-feasibility`. Esperado: falha pela regra de serviço ainda ausente; banco criado pelo runner é efêmero _test, nunca o banco operacional.
- [ ] **Step 3 — implementar serviço:** usar as assinaturas declaradas, validação Zod, transações/locks/leases e deduplicação. Matrizaçãoverificável por capacidade: contaOAuth, search/postaudience, convite/nota, aceites, inbox, mensagens, visita/like/comentário observados. OficialMessages exige açãoafirmativaeditável no momento: modoassistedsemcron. CapturardadosApify não concede ação de conta. Capacidade não comprovada desliga botão/executor. Comparar alternativa de conector com operação equivalente, custo/permissões e contrato antes decidir; não instalaroucontratar nesta prova sem autorização específica. Não ampliar permissões para fazer teste passar. Task 2 cobre todos os itens de Review Focus; nenhum caso fica delegado apenas à observação visual.
- [ ] **Step 4 — GREEN e commit:** repetir a suíte focada; comparar os efeitos reais no banco/adapter com asserções e confirmar 0 efeitos inesperados. Commitar apenas os arquivos do pacote.

### Task 3: HTTP, UI/UX e aceite do pacote

**Files:** rotas/clientes novos listados na estrutura, `src/modules/settings/linkedin-sdr.tsx` e relatório de validação do pacote.

**Interfaces:** Consome serviços da Task 2 e expõe os mesmos estados ao usuário, sem simular resultado nem autorização no browser. Se 07D for excluído, não criar superfícies deproduto e registrar a decisão como entrega do gate.

- [ ] **Step 1 — RED de contrato HTTP:** acrescentar à suíte focada pedido anônimo 401/403, papel proibido 403, input inválido 422, revisão conflitante 409 e repetição idempotente quando houver mutação; para avaliadorCLI, manifesto incompleto retorna exitcode nãozero e relatório de pendências. Confirmar falha antes do handler/avaliador.
- [ ] **Step 2 — ligar operações:** GET /api/linkedin/capabilities será servido em 07A.1; administração protegida reaproveita autoridadeplatformAI sem entregargrantsecret ao cliente Estimativa comercial rotuladailustrativa, requisitos reais e motivo de indisponibilidade. Não alterar geometria para esconder limitação do fornecedor. Gates de menu são só apresentação; serviço continua autoritativo. Estados de erro/loading/empty/partial/revoke e limites têm ação de recuperação e não apagam rascunho.
- [ ] **Step 3 — conferir visual e jornada:** `/linkedin/dashboard`, `/linkedin/campaigns/new`, `/linkedin/approvals`. Comparar com evidência disponível da referência no mesmo estado em 1920×855/390×844; checar 320 px, foco/escape/scroll, loading/falha/limite/sucesso. Mascarar dados e restaurar contexto de navegação/QA. Registrar desconhecidos da referência em separado.
- [ ] **Step 4 — verificação e aceite:** focados GREEN → `rtk proxy npm test` → `rtk proxy npm run test:integration` → `rtk proxy npm run build` → `rtk proxy npm run typecheck` → `rtk proxy git diff --check`. Todos passam ou o pacote fica pendente com falha reproduzível. No pacote puramente documental/gate excluído, rodar validador de documentos/links e suíte focada correspondente, sem testes de produto não alterado.
- [ ] **Step 5 — fechamento:** escrever relatório com casos, evidências/limitações, cleanupQA, restore de políticas/destinos, custos/saldo quando aplicável e estado de runtime. Revisão final conforme execução nativa; corrigir achados com regressão. Atualizar linha do índice/roadmap somente pelo aceite efetivo e commit local focado.

## Gate externo e critério específico

07A.0 fecha com decisão de viabilidade documentada, não com aprovação automática de paridade operacional. Seautomaçãoalvo não disponível, alternativa deve satisfazer requisito ou permanecerpendência explícita antes fechar 07A.

## Self-review do plano

R18 mapeados às três tarefas. DTOs e funções têm uma definição neste plano e no desenho de área; contratos comuns evitam reinterpretar autorização/revisão. Task 1 cobre regra pura/persistência;Task 2 cobre todos os itens de Review Focus;Task 3 cobre o que a pessoa realmente consegue operar e ver. Dados/arquivos citados como Create são futuros; Modify foi conferido no baseline ou tem pacote anterior proprietário. Escrever um plano não equivale a passar seus testes.
