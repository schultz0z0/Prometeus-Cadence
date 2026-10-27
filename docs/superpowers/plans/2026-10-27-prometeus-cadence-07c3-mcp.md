# 07C.3 — MCP autenticado e comandos revisados Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the native execution chosen by the user. Follow tasks in order; perform a fresh final review at execution time under the applicable execution skill. This session authors plans only.

**Goal:** MCP autenticado e comandos revisados; requisitos R17 do PRD.
**Architecture:** Evoluir serviços do monólito com os contratos da área; reutilizar autoridade, banco, jobs, ledger e eventos existentes. Novas interfaces listadas são contratos planejados, não funções já implementadas.
**Tech Stack:** Next 16.4.2, React 19.3.1, TypeScript 5.9.3, PostgreSQL/pg, Zod e node:test existentes; navegador de QA já disponível para UI.
**Spec:** [desenho da área](../specs/2026-10-27-prometeus-cadence-integrations-design.md), [PRD](../specs/2026-10-27-prometeus-cadence-complete-prd.md), [contratos comuns](../specs/2026-10-27-prometeus-cadence-technical-contracts.md).

## Global Constraints

- Pacote planejado; não marcado concluído. Dependências: 07C.1, 06F, 06E.1. Ordem vigente no índice geral;07D só executa produto após seu gate.
- Apify/LLM centrais; contexto, canais, dados, cache, quota e resultados privados por workspace. Sem autoelevação de owner a admin da plataforma.
- Preservar trial de 7 dias, consumo pré-pago e OpenWA 20 mensagens/5 novoscontatos por dia; intervalo 60–180 s e demais gates existentes.
- Fidelidade ao CadenceFlow por rota/estado/viewport; não criar outra estética. Estados da referência não observados permanecem classificados.
- Mutações revisadas/idempotentes; I/O incerto não autoriza repetição. Piloto/cobrança/envio externo exigem contas/ações próprias autorizadas, não são iniciados por este plano.

## Review Focus

1. tokenauderrada/escoporevogado/usuárioremovido:403 e 0 efeito
2. authcode/refreshreusado invalida sessãoMCP, redirectforaallowlist rejeita
3. toolprepare não executa; confirmaçãoduplicadaidempotente e basesalteradas 409
4. listtools não expõe chaves/admin da plataforma; resultado de outro workspace nunca aparece
5. consentimento solicitado paraworkspace diferente do Principal rejeita; operator comscopecadence.confirm não publica, mesmo tokenMCP válido; revogar grant atinge refresh e chamadas correntes
6. A chamada HTTP/SQL direta e a revogação durante I/O não podem ampliar autoridade; resposta/log/evidência não incluem segredos nem conteúdo de outro workspace.

## File Structure

- Create: `src/domain/mcp-authorization.ts`.
- Create: `src/server/mcp/service.ts`.
- Create: `src/server/mcp/authorization.ts`.
- Create: `src/server/mcp/tools.ts`.
- Create: `src/app/api/mcp/route.ts`.
- Create: `src/app/api/mcp/oauth/[action]/route.ts`.
- Create: `src/app/.well-known/oauth-protected-resource/route.ts`.
- Create: `src/app/.well-known/oauth-authorization-server/route.ts`.
- Create: `db/migrations/100-mcp-authorization.sql`.
- Create: `tests/07c3-mcp.test.ts`.
- Create: `tests/integration/07c3-mcp.test.ts`.
- Modify: `src/modules/settings/reference-settings.tsx`.
- Modify: `src/server/assistant/commands.ts`.
- Modify: `scripts/test-integration.mjs`.
- Evidence: `docs/validation/07c3-mcp.md` e `docs/validation/evidence/07c3-mcp/` com relatório/manifest/capturas mascaradas. Não gerar evidência de sucesso antes de executar.

## Interfaces e dados

Consome Principal/withWorkspaceTransaction/requirePermission/AppError atuais; Reviewed/Confirm/EvidenceRef/EffectResult conforme contratos comuns quando aplicáveis. A API de frontend não recebePrincipal do cliente. Reusar um serviço existente com assinatura equivalente via adaptação explícita antes de criar duplicação.

```ts
type McpRequest={jsonrpc:"2.0",id:string|number,method:string,params?:Record<string,unknown>};
type McpResult={content:{type:"text",text:string}[],isError?:boolean};
type McpToolCall={name:string,arguments:Record<string,unknown>};
type McpAuthorization={clientId:string,redirectUri:string,codeChallenge:string,scopes:string[],workspaceId:string};
declare function handleMcp(p:Principal,input:McpRequest):Promise<McpResult>;
declare function authorizeMcp(p:Principal,input:McpAuthorization):Promise<{code:string;expiresAt:string}>;
declare function executeMcpTool(p:Principal,input:McpToolCall):Promise<McpResult>;
```

**Entrada HTTP/CLI:** POST /api/mcp JSON-RPCStreamableHTTP; metadata discovery, authorization_code+PKCES256, refresh rotativo/revoke em /api/mcp/oauth/:action; consentem app autenticado, redirects registrados

**Persistência:** mcp_client_registration, mcp_grant, mcp_auth_code, mcp_refresh; tokenshashed, aud/redirect/escopos e consumo único por workspace/usuário Migração reservada`db/migrations/100-mcp-authorization.sql`; não editar 001–082 aplicadas.

### Task 1: Contrato de domínio e persistência autorizada

**Files:** `src/domain/mcp-authorization.ts`, `tests/07c3-mcp.test.ts`, `db/migrations/100-mcp-authorization.sql`; DTOs deste plano pertencem ao domínio do pacote.

**Interfaces:** Produz `mcpScopeAllowed(input:{required:string;granted:string[];membershipActive:boolean}):boolean` e os DTOs acima. Consome os contratos comuns e formatos existentes da área.

- [ ] **Step 1 — RED:** criar `tests/07c3-mcp.test.ts` com o caso abaixo e variações de limite/ausência. ClienteMCP não usa escopodeleitura para publicar.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {mcpScopeAllowed} from '../src/domain/mcp-authorization.ts';
test('07C.3 preserva a regra do domínio',()=>{
  assert.deepEqual(mcpScopeAllowed({"required":"cadences.publish","granted":["contacts.read"],"membershipActive":true}),false);
});
```

- [ ] **Step 2 — confirmar RED:** `rtk proxy node --experimental-strip-types --test tests/07c3-mcp.test.ts`. Esperado: teste falha pela função/regra ausente; corrigir antes erros de fixture/sintaxe que mascarem a regra.
- [ ] **Step 3 — implementar:** definir os tipos e a função acima. Criar migração com tabelas/índices/FKs descritos, RLS forçada por workspace, funções worker mínimas e idempotência transacional; não conceder escrita ampla ao dispatcher. Reaproveitar serviços de leitura/prepare/confirmUI e allowlisttools contacts.search/jobs.read/metrics.read/cadence.prepare/cadence.confirm/reply.prepare/reply.confirm. Advertise nenhumtool cujo domínio falhegate. Tokensaudiencebound TTL15 min, authorizationcode 60 s e refreshrotativo 7 dias com reuserevoke; confirmação expirada/schemaalterado rejeita. Sem servidorOAuth genérico do modelo ouCódexCLI; esteMCP opera oproduto. SDK novo só após consulta O Setup/documentação e seleção registrada; contrato HTTP não depende de fornecedor de LLM. Matriz de escopos fixa: contacts.read/jobs.read/metrics.read exigem membership atual e RLS; contacts.write e cadence.prepare exigem data.write; cadence.confirm exige cadences.publish quando publica e data.write quando apenas cria rascunho; reply.prepare/reply.confirm exigem messages.reply; toda seleção é interseção dos grants de cliente, escopos aprovados pelo usuário e capabilities do papel. authorizeMcp recebe Principal autenticado obtido de headers e confirma workspaceId correspondente, nunca cria sessão a partir do payload. GET /api/mcp/oauth/authorize mostra consentimento no app; POST confirma/rejeita, vincula grant a userId/workspaceId/clientId/audience/redirectUri/PKCE. Confirmtools recebem requestId e token de revisão ligado ao conteúdo exato, não uma aprovação genérica dochat. Retornar erro JSON-RPC tipado por autorização, input ou revisão sem expor internals.
- [ ] **Step 4 — GREEN e commit:** repetir exatamente o comando RED até passar; conferir tipos/contratos e commit local focado, sem push/deploy implícito.

### Task 2: Serviço, execução e invariantes de falha

**Files:** `src/server/mcp/service.ts`, `src/server/mcp/authorization.ts`, `src/server/mcp/tools.ts`, `src/app/api/mcp/route.ts`, `src/app/api/mcp/oauth/[action]/route.ts`, `src/app/.well-known/oauth-protected-resource/route.ts`, `src/app/.well-known/oauth-authorization-server/route.ts`, `tests/integration/07c3-mcp.test.ts`, `scripts/test-integration.mjs` e serviços existentes da área listados em Modify.

**Interfaces:** Consome DTOs/identidade e o resultado da Task 1; produz exatamente as funções de serviço declaradas neste plano. Dependências externas devem ser injetáveis nos testes, sem substituir autoridade real do banco.

- [ ] **Step 1 — RED de integração:** adicionar `07c3-mcp` à allowlist do runner. Reaproveitar fixtures de identidade/bancos/fechamento em tests/integration/helpers.ts e helpers da área; criar 2 workspaces e papéis próprios, sem usar contas/dados reais. Escrever os testes abaixo com contagens/estados/efeitos observáveis.

  - Caso 1: tokenauderrada/escoporevogado/usuárioremovido:403 e 0 efeito.
  - Caso 2: authcode/refreshreusado invalida sessãoMCP, redirectforaallowlist rejeita.
  - Caso 3: toolprepare não executa; confirmaçãoduplicadaidempotente e basesalteradas 409.
  - Caso 4: listtools não expõe chaves/admin da plataforma; resultado de outro workspace nunca aparece.
  - Caso 5: consentimento solicitado paraworkspace diferente do Principal rejeita; operator comscopecadence.confirm não publica, mesmo tokenMCP válido; revogar grant atinge refresh e chamadas correntes.

  - Caso de autoridade: endpoint direto/worker com usuário removido ou recurso cruzado retorna 403/404, publica 0 resultados para o cliente e não expõe segredo. Receipts técnicos já recebidos ficam só no escopo autorizado.

- [ ] **Step 2 — confirmar RED:** `rtk proxy node scripts/test-integration.mjs 07c3-mcp`. Esperado: falha pela regra de serviço ainda ausente; banco criado pelo runner é efêmero _test, nunca o banco operacional.
- [ ] **Step 3 — implementar serviço:** usar as assinaturas declaradas, validação Zod, transações/locks/leases e deduplicação. Reaproveitar serviços de leitura/prepare/confirmUI e allowlisttools contacts.search/jobs.read/metrics.read/cadence.prepare/cadence.confirm/reply.prepare/reply.confirm. Advertise nenhumtool cujo domínio falhegate. Tokensaudiencebound TTL15 min, authorizationcode 60 s e refreshrotativo 7 dias com reuserevoke; confirmação expirada/schemaalterado rejeita. Sem servidorOAuth genérico do modelo ouCódexCLI; esteMCP opera oproduto. SDK novo só após consulta O Setup/documentação e seleção registrada; contrato HTTP não depende de fornecedor de LLM. Matriz de escopos fixa: contacts.read/jobs.read/metrics.read exigem membership atual e RLS; contacts.write e cadence.prepare exigem data.write; cadence.confirm exige cadences.publish quando publica e data.write quando apenas cria rascunho; reply.prepare/reply.confirm exigem messages.reply; toda seleção é interseção dos grants de cliente, escopos aprovados pelo usuário e capabilities do papel. authorizeMcp recebe Principal autenticado obtido de headers e confirma workspaceId correspondente, nunca cria sessão a partir do payload. GET /api/mcp/oauth/authorize mostra consentimento no app; POST confirma/rejeita, vincula grant a userId/workspaceId/clientId/audience/redirectUri/PKCE. Confirmtools recebem requestId e token de revisão ligado ao conteúdo exato, não uma aprovação genérica dochat. Retornar erro JSON-RPC tipado por autorização, input ou revisão sem expor internals. Não ampliar permissões para fazer teste passar. Task 2 cobre todos os itens de Review Focus; nenhum caso fica delegado apenas à observação visual.
- [ ] **Step 4 — GREEN e commit:** repetir a suíte focada; comparar os efeitos reais no banco/adapter com asserções e confirmar 0 efeitos inesperados. Commitar apenas os arquivos do pacote.

### Task 3: HTTP, UI/UX e aceite do pacote

**Files:** rotas/clientes novos listados na estrutura, `src/modules/settings/reference-settings.tsx` e relatório de validação do pacote.

**Interfaces:** Consome serviços da Task 2 e expõe os mesmos estados ao usuário, sem simular resultado nem autorização no browser. Se 07D for excluído, não criar superfícies deproduto e registrar a decisão como entrega do gate.

- [ ] **Step 1 — RED de contrato HTTP:** acrescentar à suíte focada pedido anônimo 401/403, papel proibido 403, input inválido 422, revisão conflitante 409 e repetição idempotente quando houver mutação; para avaliadorCLI, manifesto incompleto retorna exitcode nãozero e relatório de pendências. Confirmar falha antes do handler/avaliador.
- [ ] **Step 2 — ligar operações:** POST /api/mcp JSON-RPCStreamableHTTP; metadata discovery, authorization_code+PKCES256, refresh rotativo/revoke em /api/mcp/oauth/:action; consentem app autenticado, redirects registrados URLcopiável, explicarpermissões, autorizar workspace, listarconexões e revogar; instruçõesClaude/ChatGPT usam endpoint funcional sem promessa de cliente suportado não testado. Gates de menu são só apresentação; serviço continua autoritativo. Estados de erro/loading/empty/partial/revoke e limites têm ação de recuperação e não apagam rascunho.
- [ ] **Step 3 — conferir visual e jornada:** `/settings/mcp`, `/settings/security`, `shell:assistant`. Comparar com evidência disponível da referência no mesmo estado em 1920×855/390×844; checar 320 px, foco/escape/scroll, loading/falha/limite/sucesso. Mascarar dados e restaurar contexto de navegação/QA. Registrar desconhecidos da referência em separado.
- [ ] **Step 4 — verificação e aceite:** focados GREEN → `rtk proxy npm test` → `rtk proxy npm run test:integration` → `rtk proxy npm run build` → `rtk proxy npm run typecheck` → `rtk proxy git diff --check`. Todos passam ou o pacote fica pendente com falha reproduzível. No pacote puramente documental/gate excluído, rodar validador de documentos/links e suíte focada correspondente, sem testes de produto não alterado.
- [ ] **Step 5 — fechamento:** escrever relatório com casos, evidências/limitações, cleanupQA, restore de políticas/destinos, custos/saldo quando aplicável e estado de runtime. Revisão final conforme execução nativa; corrigir achados com regressão. Atualizar linha do índice/roadmap somente pelo aceite efetivo e commit local focado.

## Gate externo e critério específico

Verificar especificaçãoMCP oficial na execução e homologar cliente compatível próprio. Sem registro/fluxoOAuth suportado não declarar integração pronta; contrato deautorização e tooloperation permanece fixo.

## Self-review do plano

R17 mapeados às três tarefas. DTOs e funções têm uma definição neste plano e no desenho de área; contratos comuns evitam reinterpretar autorização/revisão. Task 1 cobre regra pura/persistência;Task 2 cobre todos os itens de Review Focus;Task 3 cobre o que a pessoa realmente consegue operar e ver. Dados/arquivos citados como Create são futuros; Modify foi conferido no baseline ou tem pacote anterior proprietário. Escrever um plano não equivale a passar seus testes.
