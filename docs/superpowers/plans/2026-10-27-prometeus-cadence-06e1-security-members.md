# 06E.1 — Autenticador, sessões e administração de membros Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the native execution chosen by the user. Follow tasks in order; perform a fresh final review at execution time under the applicable execution skill. This session authors plans only.

**Goal:** Autenticador, sessões e administração de membros; requisitos R01, R12 do PRD.
**Architecture:** Evoluir serviços do monólito com os contratos da área; reutilizar autoridade, banco, jobs, ledger e eventos existentes. Novas interfaces listadas são contratos planejados, não funções já implementadas.
**Tech Stack:** Next 16.4.2, React 19.3.1, TypeScript 5.9.3, PostgreSQL/pg, Zod e node:test existentes; navegador de QA já disponível para UI.
**Spec:** [desenho da área](../specs/2026-10-27-prometeus-cadence-operations-design.md), [PRD](../specs/2026-10-27-prometeus-cadence-complete-prd.md), [contratos comuns](../specs/2026-10-27-prometeus-cadence-technical-contracts.md).

## Global Constraints

- Pacote planejado; não marcado concluído. Dependências: 02, 06A-P, 06A-H. Ordem vigente no índice geral;07D só executa produto após seu gate.
- Apify/LLM centrais; contexto, canais, dados, cache, quota e resultados privados por workspace. Sem autoelevação de owner a admin da plataforma.
- Preservar trial de 7 dias, consumo pré-pago e OpenWA 20 mensagens/5 novoscontatos por dia; intervalo 60–180 s e demais gates existentes.
- Fidelidade ao CadenceFlow por rota/estado/viewport; não criar outra estética. Estados da referência não observados permanecem classificados.
- Mutações revisadas/idempotentes; I/O incerto não autoriza repetição. Piloto/cobrança/envio externo exigem contas/ações próprias autorizadas, não são iniciados por este plano.

## Review Focus

1. codeerrado/expirado/repetido não libera sessão; backupconcorrente só 1 vez
2. trocarpassword/revogar sessão elimina acessoatual e challenge pendente; endpoint direto não contorna 2FA
3. duasremoções simultâneas de owners: uma 409 e 1 owner remanescente
4. doisconvites no últimoassento: só 1 reserva; convidado não autoeleva admin da plataforma
5. A chamada HTTP/SQL direta e a revogação durante I/O não podem ampliar autoridade; resposta/log/evidência não incluem segredos nem conteúdo de outro workspace.

## File Structure

- Create: `src/domain/security-policy.ts`.
- Create: `src/server/auth/two-factor-policy.ts`.
- Create: `src/app/api/security/two-factor/[action]/route.ts`.
- Create: `db/migrations/091-security-members.sql`.
- Create: `tests/06e1-security-members.test.ts`.
- Create: `tests/integration/06e1-security-members.test.ts`.
- Modify: `src/server/auth/auth.ts`.
- Modify: `src/lib/auth-client.ts`.
- Modify: `src/server/auth/security.ts`.
- Modify: `src/server/workspaces/service.ts`.
- Modify: `src/modules/settings/security.tsx`.
- Modify: `src/modules/settings/members.tsx`.
- Modify: `src/modules/auth/form.tsx`.
- Modify: `scripts/test-integration.mjs`.
- Evidence: `docs/validation/06e1-security-members.md` e `docs/validation/evidence/06e1-security-members/` com relatório/manifest/capturas mascaradas. Não gerar evidência de sucesso antes de executar.

## Interfaces e dados

Consome Principal/withWorkspaceTransaction/requirePermission/AppError atuais; Reviewed/Confirm/EvidenceRef/EffectResult conforme contratos comuns quando aplicáveis. A API de frontend não recebePrincipal do cliente. Reusar um serviço existente com assinatura equivalente via adaptação explícita antes de criar duplicação.

```ts
type TotpChallenge={id:string,userId:string,expiresAt:string,verifiedAt:string|null};
type MembershipChange={memberId:string,expectedRevision:number,role:"owner"|"admin"|"operator",requestId:string};
// estruturas internas TOTP/backup da biblioteca, sem reimplementar algoritmo
declare function prepareTotp(headers:Headers,input:{password:string}):Promise<{challengeId:string;uri:string;backupCodes:string[]}>;
declare function verifyTotp(headers:Headers,input:{challengeId:string;code:string}):Promise<{enabled:boolean}>;
declare function disableTotp(headers:Headers,input:{password:string;code:string}):Promise<void>;
```

**Entrada HTTP/CLI:** POST /api/security/two-factor/{prepare,verify,disable,recovery}; reusar /api/security e comandosmembership; authchallenge só retorna sessão plena após verificação

**Persistência:** migração gerada da versão localBetterAuthtwoFactor e registrodesafio recente; usar auth.member/session existentes e invariantes de últimoowner Migração reservada`db/migrations/091-security-members.sql`; não editar 001–082 aplicadas.

### Task 1: Contrato de domínio e persistência autorizada

**Files:** `src/domain/security-policy.ts`, `tests/06e1-security-members.test.ts`, `db/migrations/091-security-members.sql`; DTOs deste plano pertencem ao domínio do pacote.

**Interfaces:** Produz `canRemoveOwner(input:{targetRole:string;remainingOwners:number}):boolean` e os DTOs acima. Consome os contratos comuns e formatos existentes da área.

- [ ] **Step 1 — RED:** criar `tests/06e1-security-members.test.ts` com o caso abaixo e variações de limite/ausência. Remoção concorrente não deixa workspace semowner.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {canRemoveOwner} from '../src/domain/security-policy.ts';
test('06E.1 preserva a regra do domínio',()=>{
  assert.deepEqual(canRemoveOwner({"targetRole":"owner","remainingOwners":0}),false);
});
```

- [ ] **Step 2 — confirmar RED:** `rtk proxy node --experimental-strip-types --test tests/06e1-security-members.test.ts`. Esperado: teste falha pela função/regra ausente; corrigir antes erros de fixture/sintaxe que mascarem a regra.
- [ ] **Step 3 — implementar:** definir os tipos e a função acima. Criar migração com tabelas/índices/FKs descritos, RLS forçada por workspace, funções worker mínimas e idempotência transacional; não conceder escrita ampla ao dispatcher. Reusar módulo twoFactor já incluído em BetterAuth instalado; verificar métodos/tipos locais e migraçãogerada antes de usar. Senha+TOTP/backup desafiam login, códigos usadosuma vez e rate-limit. OAuthsempassword não ligaTOTP por mudança de flagcliente: reautenticaçãofresca e método suportadopela versão ou setup explícito de senha verificada antes. Sessões/desafios/backup nunca logados; APIs existentes não podem ignorar challenge. Convites/roles/capacidadecom lockinvariantes no servidor.
- [ ] **Step 4 — GREEN e commit:** repetir exatamente o comando RED até passar; conferir tipos/contratos e commit local focado, sem push/deploy implícito.

### Task 2: Serviço, execução e invariantes de falha

**Files:** `src/server/auth/two-factor-policy.ts`, `src/app/api/security/two-factor/[action]/route.ts`, `tests/integration/06e1-security-members.test.ts`, `scripts/test-integration.mjs` e serviços existentes da área listados em Modify.

**Interfaces:** Consome DTOs/identidade e o resultado da Task 1; produz exatamente as funções de serviço declaradas neste plano. Dependências externas devem ser injetáveis nos testes, sem substituir autoridade real do banco.

- [ ] **Step 1 — RED de integração:** adicionar `06e1-security-members` à allowlist do runner. Reaproveitar fixtures de identidade/bancos/fechamento em tests/integration/helpers.ts e helpers da área; criar 2 workspaces e papéis próprios, sem usar contas/dados reais. Escrever os testes abaixo com contagens/estados/efeitos observáveis.

  - Caso 1: codeerrado/expirado/repetido não libera sessão; backupconcorrente só 1 vez.
  - Caso 2: trocarpassword/revogar sessão elimina acessoatual e challenge pendente; endpoint direto não contorna 2FA.
  - Caso 3: duasremoções simultâneas de owners: uma 409 e 1 owner remanescente.
  - Caso 4: doisconvites no últimoassento: só 1 reserva; convidado não autoeleva admin da plataforma.

  - Caso de autoridade: endpoint direto/worker com usuário removido ou recurso cruzado retorna 403/404, publica 0 resultados para o cliente e não expõe segredo. Receipts técnicos já recebidos ficam só no escopo autorizado.

- [ ] **Step 2 — confirmar RED:** `rtk proxy node scripts/test-integration.mjs 06e1-security-members`. Esperado: falha pela regra de serviço ainda ausente; banco criado pelo runner é efêmero _test, nunca o banco operacional.
- [ ] **Step 3 — implementar serviço:** usar as assinaturas declaradas, validação Zod, transações/locks/leases e deduplicação. Reusar módulo twoFactor já incluído em BetterAuth instalado; verificar métodos/tipos locais e migraçãogerada antes de usar. Senha+TOTP/backup desafiam login, códigos usadosuma vez e rate-limit. OAuthsempassword não ligaTOTP por mudança de flagcliente: reautenticaçãofresca e método suportadopela versão ou setup explícito de senha verificada antes. Sessões/desafios/backup nunca logados; APIs existentes não podem ignorar challenge. Convites/roles/capacidadecom lockinvariantes no servidor. Não ampliar permissões para fazer teste passar. Task 2 cobre todos os itens de Review Focus; nenhum caso fica delegado apenas à observação visual.
- [ ] **Step 4 — GREEN e commit:** repetir a suíte focada; comparar os efeitos reais no banco/adapter com asserções e confirmar 0 efeitos inesperados. Commitar apenas os arquivos do pacote.

### Task 3: HTTP, UI/UX e aceite do pacote

**Files:** rotas/clientes novos listados na estrutura, `src/modules/settings/security.tsx`, `src/modules/settings/members.tsx`, `src/modules/auth/form.tsx` e relatório de validação do pacote.

**Interfaces:** Consome serviços da Task 2 e expõe os mesmos estados ao usuário, sem simular resultado nem autorização no browser. Se 07D for excluído, não criar superfícies deproduto e registrar a decisão como entrega do gate.

- [ ] **Step 1 — RED de contrato HTTP:** acrescentar à suíte focada pedido anônimo 401/403, papel proibido 403, input inválido 422, revisão conflitante 409 e repetição idempotente quando houver mutação; para avaliadorCLI, manifesto incompleto retorna exitcode nãozero e relatório de pendências. Confirmar falha antes do handler/avaliador.
- [ ] **Step 2 — ligar operações:** POST /api/security/two-factor/{prepare,verify,disable,recovery}; reusar /api/security e comandosmembership; authchallenge só retorna sessão plena após verificação QRsegredoTOTP somente popupprivado; backup visíveluma vez econfirmaçãoantesfechar. Sessões/membros exibemresultado persistido e recuperação clara mobile. Gates de menu são só apresentação; serviço continua autoritativo. Estados de erro/loading/empty/partial/revoke e limites têm ação de recuperação e não apagam rascunho.
- [ ] **Step 3 — conferir visual e jornada:** `/settings/security`, `/settings/seats`, `/accept-invitation`, `/login`, `/reset-password`. Comparar com evidência disponível da referência no mesmo estado em 1920×855/390×844; checar 320 px, foco/escape/scroll, loading/falha/limite/sucesso. Mascarar dados e restaurar contexto de navegação/QA. Registrar desconhecidos da referência em separado.
- [ ] **Step 4 — verificação e aceite:** focados GREEN → `rtk proxy npm test` → `rtk proxy npm run test:integration` → `rtk proxy npm run build` → `rtk proxy npm run typecheck` → `rtk proxy git diff --check`. Todos passam ou o pacote fica pendente com falha reproduzível. No pacote puramente documental/gate excluído, rodar validador de documentos/links e suíte focada correspondente, sem testes de produto não alterado.
- [ ] **Step 5 — fechamento:** escrever relatório com casos, evidências/limitações, cleanupQA, restore de políticas/destinos, custos/saldo quando aplicável e estado de runtime. Revisão final conforme execução nativa; corrigir achados com regressão. Atualizar linha do índice/roadmap somente pelo aceite efetivo e commit local focado.

## Gate externo e critério específico

Nenhuma biblioteca/pluginCodexnovo é necessário. Schema/exports locais prevalecem sobre documentação mais recente; recuperação preserva prova de identidade.

## Self-review do plano

R01, R12 mapeados às três tarefas. DTOs e funções têm uma definição neste plano e no desenho de área; contratos comuns evitam reinterpretar autorização/revisão. Task 1 cobre regra pura/persistência;Task 2 cobre todos os itens de Review Focus;Task 3 cobre o que a pessoa realmente consegue operar e ver. Dados/arquivos citados como Create são futuros; Modify foi conferido no baseline ou tem pacote anterior proprietário. Escrever um plano não equivale a passar seus testes.
