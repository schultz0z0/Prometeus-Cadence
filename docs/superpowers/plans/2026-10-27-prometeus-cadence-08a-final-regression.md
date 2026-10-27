# 08A — Regressão integral de jornadas e UI/UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the native execution chosen by the user. Follow tasks in order; perform a fresh final review at execution time under the applicable execution skill. This session authors plans only.

**Goal:** Regressão integral de jornadas e UI/UX; requisitos R24, R01, R07, R09, R18, R21 do PRD.
**Architecture:** Evoluir serviços do monólito com os contratos da área; reutilizar autoridade, banco, jobs, ledger e eventos existentes. Novas interfaces listadas são contratos planejados, não funções já implementadas.
**Tech Stack:** Next 16.4.2, React 19.3.1, TypeScript 5.9.3, PostgreSQL/pg, Zod e node:test existentes; navegador de QA já disponível para UI.
**Spec:** [desenho da área](../specs/2026-10-27-prometeus-cadence-release-design.md), [PRD](../specs/2026-10-27-prometeus-cadence-complete-prd.md), [contratos comuns](../specs/2026-10-27-prometeus-cadence-technical-contracts.md).

## Global Constraints

- Pacote planejado; não marcado concluído. Dependências: 06G, 07B.3, 07C.3, 06A-V. Ordem vigente no índice geral;07D só executa produto após seu gate.
- Apify/LLM centrais; contexto, canais, dados, cache, quota e resultados privados por workspace. Sem autoelevação de owner a admin da plataforma.
- Preservar trial de 7 dias, consumo pré-pago e OpenWA 20 mensagens/5 novoscontatos por dia; intervalo 60–180 s e demais gates existentes.
- Fidelidade ao CadenceFlow por rota/estado/viewport; não criar outra estética. Estados da referência não observados permanecem classificados.
- Mutações revisadas/idempotentes; I/O incerto não autoriza repetição. Piloto/cobrança/envio externo exigem contas/ações próprias autorizadas, não são iniciados por este plano.

## Review Focus

1. registradoridentificapopup/rota/estado não executado e nãoaprova por screenshotbaseline
2. duascontas paralelas comparadas semcontexto/IDs/arquivosmisturados
3. navegaçãoerro/retry preserva rascunho e foco; nenhumoverflowhorizontal 320 e controlesacessíveis
4. móduloanunciado comooperacional exige serviço/caso feliz/falha/recuperação eefeito externopróprio quando aplicável
5. A chamada HTTP/SQL direta e a revogação durante I/O não podem ampliar autoridade; resposta/log/evidência não incluem segredos nem conteúdo de outro workspace.

## File Structure

- Create: `scripts/lib/release-coverage.ts`.
- Create: `scripts/audit-release-coverage.mjs`.
- Create: `tests/manual/full-journeys.mjs`.
- Create: `docs/validation/08-release-matrix.json`.
- Create: `tests/08a-final-regression.test.ts`.
- Create: `tests/integration/08a-final-regression.test.ts`.
- Modify: `scripts/smoke-routes.mjs`.
- Modify: `docs/reverse-engineering/visual-2026-10-25/inventory/coverage.md`.
- Modify: `scripts/test-integration.mjs`.
- Evidence: `docs/validation/08a-final-regression.md` e `docs/validation/evidence/08a-final-regression/` com relatório/manifest/capturas mascaradas. Não gerar evidência de sucesso antes de executar.

## Interfaces e dados

Consome Principal/withWorkspaceTransaction/requirePermission/AppError atuais; Reviewed/Confirm/EvidenceRef/EffectResult conforme contratos comuns quando aplicáveis. A API de frontend não recebePrincipal do cliente. Reusar um serviço existente com assinatura equivalente via adaptação explícita antes de criar duplicação.

```ts
type ReleaseCoverageInput={manifestPath:string,evidenceRoot:string};
type ReleaseCoverageReport={required:number,passed:number,failed:string[],blocked:string[],referenceUnknown:string[],exceptions:string[]};
declare function auditReleaseCoverage(input:ReleaseCoverageInput):Promise<ReleaseCoverageReport>;
```

**Entrada HTTP/CLI:** SemnovasAPIs; exercitarserviços/rotas públicos eprivados daplataforma em QA próprio. Contratosexternos sócontasoperador.

**Persistência:** Manifest/evidências de validação; nenhuma migração de produto neste pacote.

### Task 1: Contrato de domínio e persistência autorizada

**Files:** `scripts/lib/release-coverage.ts`, `tests/08a-final-regression.test.ts`; DTOs deste plano pertencem ao domínio do pacote.

**Interfaces:** Produz `releaseCoverageAccepted(input:{required:number;passed:number;criticalFailures:number;unknownUnclassified:number}):boolean` e os DTOs acima. Consome os contratos comuns e formatos existentes da área.

- [ ] **Step 1 — RED:** criar `tests/08a-final-regression.test.ts` com o caso abaixo e variações de limite/ausência. 99/100 itens obrigatórios não fechamaceiteintegral.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseCoverageAccepted} from '../scripts/lib/release-coverage.ts';
test('08A preserva a regra do domínio',()=>{
  assert.deepEqual(releaseCoverageAccepted({"required":100,"passed":99,"criticalFailures":0,"unknownUnclassified":0}),false);
});
```

- [ ] **Step 2 — confirmar RED:** `rtk proxy node --experimental-strip-types --test tests/08a-final-regression.test.ts`. Esperado: teste falha pela função/regra ausente; corrigir antes erros de fixture/sintaxe que mascarem a regra.
- [ ] **Step 3 — implementar:** definir os tipos e a função acima. Implementar o avaliador puro de cobertura/readiness sem afirmar execução de produto. Materializarregistrodetodasrotas/estados/roles/coortes/2 tenants. Jornadas obrigatórias: signup→trial→assinatura; pesquisa→pessoas→qualifica→cadência→inbox/parada; LinkedInconectado→açãoautorizada→conversa; SDR→handoff/agenda/CRM; pack/renova/cancel; delete/export/merge; API/MCPescopos/revoke. Rodar 1920/1440/768/390/320, tema/texto/teclado/zoom 200, falsosatrasos/offline/503. Capturasevidências vinculadas aRQ/pacote. Semcritical/highabertos; exceção deobservação não vira funcionalidade local dispensada.
- [ ] **Step 4 — GREEN e commit:** repetir exatamente o comando RED até passar; conferir tipos/contratos e commit local focado, sem push/deploy implícito.

### Task 2: Serviço, execução e invariantes de falha

**Files:** `scripts/audit-release-coverage.mjs`, `tests/manual/full-journeys.mjs`, `docs/validation/08-release-matrix.json`, `tests/integration/08a-final-regression.test.ts`, `scripts/test-integration.mjs` e serviços existentes da área listados em Modify.

**Interfaces:** Consome DTOs/identidade e o resultado da Task 1; produz exatamente as funções de serviço declaradas neste plano. Dependências externas devem ser injetáveis nos testes, sem substituir autoridade real do banco.

- [ ] **Step 1 — RED de integração:** adicionar `08a-final-regression` à allowlist do runner. Reaproveitar fixtures de identidade/bancos/fechamento em tests/integration/helpers.ts e helpers da área; criar 2 workspaces e papéis próprios, sem usar contas/dados reais. Escrever os testes abaixo com contagens/estados/efeitos observáveis.

  - Caso 1: registradoridentificapopup/rota/estado não executado e nãoaprova por screenshotbaseline.
  - Caso 2: duascontas paralelas comparadas semcontexto/IDs/arquivosmisturados.
  - Caso 3: navegaçãoerro/retry preserva rascunho e foco; nenhumoverflowhorizontal 320 e controlesacessíveis.
  - Caso 4: móduloanunciado comooperacional exige serviço/caso feliz/falha/recuperação eefeito externopróprio quando aplicável.

  - Caso de autoridade: endpoint direto/worker com usuário removido ou recurso cruzado retorna 403/404, publica 0 resultados para o cliente e não expõe segredo. Receipts técnicos já recebidos ficam só no escopo autorizado.

- [ ] **Step 2 — confirmar RED:** `rtk proxy node scripts/test-integration.mjs 08a-final-regression`. Esperado: falha pela regra de serviço ainda ausente; banco criado pelo runner é efêmero _test, nunca o banco operacional.
- [ ] **Step 3 — implementar serviço:** usar as assinaturas declaradas, validação Zod, transações/locks/leases e deduplicação. Materializarregistrodetodasrotas/estados/roles/coortes/2 tenants. Jornadas obrigatórias: signup→trial→assinatura; pesquisa→pessoas→qualifica→cadência→inbox/parada; LinkedInconectado→açãoautorizada→conversa; SDR→handoff/agenda/CRM; pack/renova/cancel; delete/export/merge; API/MCPescopos/revoke. Rodar 1920/1440/768/390/320, tema/texto/teclado/zoom 200, falsosatrasos/offline/503. Capturasevidências vinculadas aRQ/pacote. Semcritical/highabertos; exceção deobservação não vira funcionalidade local dispensada. Não ampliar permissões para fazer teste passar. Task 2 cobre todos os itens de Review Focus; nenhum caso fica delegado apenas à observação visual.
- [ ] **Step 4 — GREEN e commit:** repetir a suíte focada; comparar os efeitos reais no banco/adapter com asserções e confirmar 0 efeitos inesperados. Commitar apenas os arquivos do pacote.

### Task 3: HTTP, UI/UX e aceite do pacote

**Files:** rotas/clientes novos listados na estrutura, inventário/relatórios da estrutura e relatório de validação do pacote.

**Interfaces:** Consome serviços da Task 2 e expõe os mesmos estados ao usuário, sem simular resultado nem autorização no browser. Se 07D for excluído, não criar superfícies deproduto e registrar a decisão como entrega do gate.

- [ ] **Step 1 — RED de contrato HTTP:** acrescentar à suíte focada pedido anônimo 401/403, papel proibido 403, input inválido 422, revisão conflitante 409 e repetição idempotente quando houver mutação; para avaliadorCLI, manifesto incompleto retorna exitcode nãozero e relatório de pendências. Confirmar falha antes do handler/avaliador.
- [ ] **Step 2 — ligar operações:** SemnovasAPIs; exercitarserviços/rotas públicos eprivados daplataforma em QA próprio. Contratosexternos sócontasoperador. Regressão final não recebe dívidainteira devisual; cada área chegaaceita. Diferençasabertas retornam aoplanodono com teste, semreplanejar escopo completo. Gates de menu são só apresentação; serviço continua autoritativo. Estados de erro/loading/empty/partial/revoke e limites têm ação de recuperação e não apagam rascunho.
- [ ] **Step 3 — conferir visual e jornada:** `todas rotas do inventário`, `todasabas/menus/popups/fluxos`, `desktop/tablet/mobile`. Comparar com evidência disponível da referência no mesmo estado em 1920×855/390×844; checar 320 px, foco/escape/scroll, loading/falha/limite/sucesso. Mascarar dados e restaurar contexto de navegação/QA. Registrar desconhecidos da referência em separado.
- [ ] **Step 4 — verificação e aceite:** focados GREEN → `rtk proxy npm test` → `rtk proxy npm run test:integration` → `rtk proxy npm run build` → `rtk proxy npm run typecheck` → `rtk proxy git diff --check`. Todos passam ou o pacote fica pendente com falha reproduzível. No pacote puramente documental/gate excluído, rodar validador de documentos/links e suíte focada correspondente, sem testes de produto não alterado.
- [ ] **Step 5 — fechamento:** escrever relatório com casos, evidências/limitações, cleanupQA, restore de políticas/destinos, custos/saldo quando aplicável e estado de runtime. Revisão final conforme execução nativa; corrigir achados com regressão. Atualizar linha do índice/roadmap somente pelo aceite efetivo e commit local focado.

## Gate externo e critério específico

Referênciaunknownclassificada e limitaçãoremotaregistrada sãoaceitas comolimite deprova, não licença para deixarfunção local incompleta. QR/OAuth/checkoutreturnnão bastam.

## Self-review do plano

R24, R01, R07, R09, R18, R21 mapeados às três tarefas. DTOs e funções têm uma definição neste plano e no desenho de área; contratos comuns evitam reinterpretar autorização/revisão. Task 1 cobre regra pura/persistência;Task 2 cobre todos os itens de Review Focus;Task 3 cobre o que a pessoa realmente consegue operar e ver. Dados/arquivos citados como Create são futuros; Modify foi conferido no baseline ou tem pacote anterior proprietário. Escrever um plano não equivale a passar seus testes.
