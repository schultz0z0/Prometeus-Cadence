# Agentes de IA por módulo (fase 1) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada chamada de IA passa a pertencer a um de quatro agentes (`prospecting`, `linkedin`, `assistant`, `sdr`), com modelo escolhível por agente pelo administrador, sem mudar nenhum pedido enviado ao provedor.

**Architecture:** Um registro de agentes no domínio; `ConventionalContext` ganha `agent` e `operation`; `conventionalConfig` resolve o modelo efetivo do agente a partir do mapa `agentModels` guardado no registro criptografado da chave do provedor (mesmo arquivo de hoje), de modo que a impressão digital fica idêntica quando não há escolha. Testes de pedido de referência travam o comportamento antes de qualquer mudança.

**Tech Stack:** Next.js 16, TypeScript com `--experimental-strip-types`, `node:test`, Postgres (suítes de integração via `scripts/test-integration.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-14-ai-agents-per-module-design.md`

## Global Constraints

- Nenhuma mudança de prompt, schema, `maxOutputTokens`, tempo limite ou modelo efetivo nesta fase.
- Provedor único (o da política da plataforma); modelo por agente só para provedores de chave (`openai`, `gemini`); `codex-local` e `chatgpt-oauth` ignoram o mapa.
- Modelo por agente: vazio = "Padrão da plataforma"; só valores presentes em `models` da chave do provedor; só o administrador da plataforma lê e altera.
- Com o mapa vazio, `configFingerprint` de cada rota é idêntica à de hoje.
- Textos de interface em português do Brasil; resposta ao operador em português.

## Correção ao desenho (decidida no plano)

- O mapa `agentModels` fica no registro da chave de cada provedor (`.runtime/ai-keys/<provider>.json`), não na tabela `ai_policy`: `conventionalConfig` e `assertConventionalConfiguration` são síncronos e já leem esse arquivo, então a checagem de impressão digital dos jobs continua funcionando. Consequência: cada provedor guarda o seu mapa; trocar de provedor usa o mapa do outro (vazio por padrão), o que cumpre "volta ao padrão".
- A checagem de rota em `automations/state.ts` valida a IA dos jobs de prospecção que a automação dispara, então é do agente `prospecting`, não do `assistant`.
- Instruções já isoladas em arquivo próprio (`sdr-turn.ts`, `planning/prompts.ts`, `prospecting/ai/output.ts` + `ai-skills.ts`, `decisors.ts`) não se movem; só saem de dentro do serviço as instruções embutidas do assistente e do comentário do LinkedIn. O registro aponta, por agente, os arquivos de instruções.

## Review Focus

1. Job de prospecção criado antes do deploy e executado depois: deve rodar (impressão digital igual com mapa vazio). Teste em Task 3.
2. Administrador escolhe um modelo para `sdr` e depois a chave é trocada por outra sem esse modelo: o agente volta ao padrão, sem erro de rota. Teste em Task 4.
3. Workspace comum chamando a rota de modelos por agente: 403. Teste em Task 4.
4. Ponto de IA chamado com operação de outro agente (ex.: `sdr` + `planning`): erro `AI_AGENT_OPERATION`, sem chamada ao provedor. Teste em Task 2.
5. Job de prospecção já na fila quando o administrador muda o modelo de `prospecting`: falha como "configuração mudou" (comportamento atual de troca de modelo), não roda com o modelo novo pela metade. Teste em Task 3.

---

### Task 1: Pedidos de referência (antes de qualquer mudança)

**Files:**
- Create: `tests/ai-golden.test.ts`
- Create: `tests/fixtures/ai-golden/*.json` (gerados pelo próprio teste)

**Interfaces:**
- Produces: fixtures `{prompt:string,schema:unknown,maxOutputTokens:number}` por operação, nomes: `prospecting-conventional-qualify`, `prospecting-decisors`, `prospecting-company-people`, `prospecting-planning`, `linkedin-comment`, `assistant-answer`, `sdr-turn`, `sdr-simulation`.

- [ ] **Step 1: Escrever o teste** com entradas fixas (datas e ids constantes) chamando: `conventionalPrompt`/`conventionalSchema` (`prospecting/ai/output.ts`), `decisorRequest` e `companyPeopleRequest` (`prospecting/ai/decisors.ts`), `planningPrompt`/`planningJsonSchema` com `maxOutputTokens:8192`, `generateCommentWithRoute` com `JsonDependencies.fetcher` falso que captura o corpo enviado ao Gemini, `answerAssistant` (`assistant/service.ts`) com `deps.generate` que captura o pedido (precisa de banco: este caso vai na suíte de integração `06f-assistant-experience`, gravando a mesma fixture), `sdrPrompt` + `sdrOutputJsonSchema`. Cada caso compara com `tests/fixtures/ai-golden/<nome>.json`; se o arquivo não existir e `UPDATE_GOLDEN=1`, grava; sem a variável e sem arquivo, falha.
- [ ] **Step 2: Gerar as referências** — Run: `$env:UPDATE_GOLDEN='1'; node --conditions=react-server --experimental-strip-types --test tests/ai-golden.test.ts` — Expected: PASS e 8 arquivos criados.
- [ ] **Step 3: Rodar sem a variável** — Run: `node --conditions=react-server --experimental-strip-types --test tests/ai-golden.test.ts` — Expected: PASS.
- [ ] **Step 4: Commit** `test: lock AI requests per operation before splitting agents`

### Task 2: Registro de agentes e operação obrigatória na chamada

**Files:**
- Create: `src/domain/ai-agents.ts`
- Modify: `src/server/prospecting/ai/json.ts` (`ConventionalContext`, `runConventionalJson`)
- Modify: todos os construtores de `ConventionalContext`: `prospecting/qualification.ts:343`, `prospecting/ai/decisors.ts` (via chamadores), `planning/model.ts` e `planning/execution.ts`, `research/people.ts`, `linkedin/comment-ai.ts`, `assistant/service.ts:108`, `sdr/configuration.ts:103`, `sdr/worker.ts:29`
- Test: `tests/ai-agents.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type AiAgentId='prospecting'|'linkedin'|'assistant'|'sdr';
  export type AiOperation='qualify'|'decisors'|'company-people'|'research'|'planning'|'linkedin-comment'|'assistant-answer'|'sdr-turn'|'sdr-simulation';
  export const AI_AGENTS:Record<AiAgentId,{label:string;operations:readonly AiOperation[];instructions:readonly string[]}>;
  export function assertAgentOperation(agent:AiAgentId,operation:AiOperation):void; // throws Error('AI_AGENT_OPERATION')
  ```
  `ConventionalContext` ganha `agent:AiAgentId;operation:AiOperation`. Labels: Prospecção, LinkedIn, Assistente, Agente SDR.

- [ ] **Step 1: Teste que falha**: `assertAgentOperation('sdr','planning')` lança `AI_AGENT_OPERATION`; `runConventionalJson` com `{agent:'sdr',operation:'planning'}` lança `ProviderError('AI_AGENT_OPERATION')` sem chamar o `fetcher` falso; cada `AiOperation` pertence a exatamente um agente.
- [ ] **Step 2: Rodar e ver falhar** — `node --conditions=react-server --experimental-strip-types --test tests/ai-agents.test.ts`
- [ ] **Step 3: Implementar** o registro e a checagem como primeira linha de `runConventionalJson`; passar `agent`/`operation` em cada ponto (o compilador aponta os que faltarem).
- [ ] **Step 4: Rodar** `tests/ai-agents.test.ts`, `tests/ai-golden.test.ts` e `npm run typecheck` — Expected: PASS, sem erros de tipo.
- [ ] **Step 5: Commit** `feat(ai): every AI call names its agent and operation`

### Task 3: Modelo efetivo por agente na rota

**Files:**
- Modify: `src/server/prospecting/ai/api-keys.ts` (`Stored.metadata.agentModels?:Partial<Record<AiAgentId,string>>`, `storedApiKey` devolve `agentModels`)
- Modify: `src/server/prospecting/ai/config.ts` (`conventionalConfig(workspaceId:string,agent?:AiAgentId):AiRuntime`)
- Modify: `src/server/prospecting/ai/json.ts` (`assertConventionalConfiguration` usa `conventionalConfig(ctx.workspaceId,ctx.agent)`)
- Modify: as 10 chamadas de `conventionalConfig(...)` em `assistant/service.ts`, `automations/state.ts`, `linkedin/approvals.ts`, `planning/service.ts`, `prospecting/service.ts`, `research/journey.ts`, `sdr/configuration.ts`, `sdr/worker.ts` passando o agente do mapa da spec (probe de IA fica sem agente = padrão)
- Test: `tests/ai-agents.test.ts`

**Interfaces:**
- Consumes: `AiAgentId` (Task 2).
- Produces: `conventionalConfig(ws, agent)` com `route.model = agentModels[agent] ?? model`; a impressão digital é calculada com o modelo efetivo e com os mesmos campos de hoje.

- [ ] **Step 1: Teste que falha**: com registro gemini sem `agentModels`, `conventionalConfig(ws,'sdr').conventional.gemini.route` é idêntico (`deepEqual`, incluindo `configFingerprint`) a `conventionalConfig(ws)`; com `agentModels:{sdr:'gemini-x'}` (presente em `models`), `route.model==='gemini-x'` e a impressão digital difere só para `sdr`; com `agentModels:{sdr:'gemini-removido'}` fora de `models`, volta ao modelo padrão; um job com rota criada antes da troca de modelo de `prospecting` falha em `assertConventionalConfiguration` com `AI_CONFIGURATION_CHANGED`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** unidade + `tests/ai-golden.test.ts` + integração: `node scripts/test-integration.mjs prospecting-pipeline planning-pipeline platform-ai platform-ai-context 07b1-sdr-configuration 07b2-sdr-conversation 06f-assistant-experience` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ai): resolve each agent's model, unchanged by default`

### Task 4: Configurar modelo por agente (API + tela)

**Files:**
- Modify: `src/server/prospecting/ai/api-keys.ts` (`writeAgentModels(scope,provider,expectedRevision,map):ApiKeyView`)
- Modify: `src/server/prospecting/ai/api-key-settings.ts` (`saveAgentModels(p:Principal,input:unknown):Promise<ApiKeyView>` com `requireAiAdmin`, valida cada modelo contra `models`, auditoria `ai.agent-models.save`)
- Modify: `src/app/api/prospecting/ai/keys/route.ts` (ação `agent-models`)
- Modify: `src/domain/ai-routing.ts` (`ApiKeyView.agentModels`)
- Modify: `src/client/prospecting-client.ts`, `src/modules/settings/api-key-connection.tsx` ou `src/modules/settings/ai.tsx` (seção "Modelo por agente")
- Test: `tests/ai-api-keys.test.ts`

**Interfaces:**
- Consumes: `AI_AGENTS` (Task 2), `agentModels` (Task 3).
- Produces: `POST /api/prospecting/ai/keys` com `{action:'agent-models',provider,expectedRevision,agentModels}`; ao salvar uma chave nova (`saveApiKey`), entradas de `agentModels` fora da nova lista de `models` são descartadas.

- [ ] **Step 1: Teste que falha**: não-admin recebe 403 `PLATFORM_ADMIN_REQUIRED`; modelo fora da lista → 422 "Modelo indisponível para esta chave."; revisão antiga → 409; salvar `{}` restaura o padrão; trocar a chave por uma sem o modelo do `sdr` remove essa entrada.
- [ ] **Step 2: Rodar e ver falhar** — `node --conditions=react-server --experimental-strip-types --test tests/ai-api-keys.test.ts`
- [ ] **Step 3: Implementar** serviço, rota e a seção de tela: quatro linhas (Prospecção, LinkedIn, Assistente, Agente SDR), cada uma com `<select>` "Padrão da plataforma (<modelo>)" + modelos da chave, botão "Salvar modelos", visível só com `canManage`; estados de carregando, erro e salvo no padrão visual da tela de chaves.
- [ ] **Step 4: Rodar** os testes e `npm run typecheck`; no app (build de produção, aba do Terminal), abrir Configurações → IA como administrador e conferir a seção com os quatro agentes em "Padrão da plataforma". Captura de tela como prova.
- [ ] **Step 5: Commit** `feat(settings): platform admin picks a model per AI agent`

### Task 5: Uso marcado com o agente e instruções embutidas extraídas

**Files:**
- Modify: `src/domain/prospecting.ts` (`ProviderUsage.agent?:AiAgentId`)
- Modify: `src/server/prospecting/ai/json.ts` (preenche `usage.agent=ctx.agent`)
- Create: `src/server/assistant/prompt.ts` (move a função `prompt` de `assistant/service.ts` sem mudar o texto)
- Create: `src/server/linkedin/comment-prompt.ts` (move o prompt embutido de `comment-ai.ts`)
- Modify: `src/domain/ai-agents.ts` (`instructions` aponta esses arquivos e os já existentes)
- Test: `tests/ai-golden.test.ts`, `tests/ai-agents.test.ts`

- [ ] **Step 1: Teste que falha**: `runConventionalJson` com `agent:'linkedin'` devolve `usage.agent==='linkedin'`.
- [ ] **Step 2: Implementar** o campo e mover os dois prompts.
- [ ] **Step 3: Rodar** `tests/ai-golden.test.ts` **sem** `UPDATE_GOLDEN` — Expected: PASS sem alterar nenhuma fixture.
- [ ] **Step 4: Commit** `refactor(ai): agent-owned instructions and usage`

### Task 6: Regressão completa e homologação curta

**Files:**
- Modify: `docs/validation/2026-11-12-homologacao-canais-reais.md` (resultado)

- [ ] **Step 1: Suítes completas** — Run: `npm test` (unidade) e `node scripts/test-integration.mjs` (todas) — Expected: tudo passando; comparar contagem com a última execução registrada.
- [ ] **Step 2: Build de produção** — `npm run build`, reiniciar a aba do Terminal do app e o worker (`node scripts/runtime-control.mjs stop` / `start`).
- [ ] **Step 3: Rodada real** no app: um job de qualificação pequeno, uma simulação do Agente SDR, uma pergunta ao assistente; se o LinkedIn estiver conectado, um comentário em rascunho. Conferir que os resultados vêm como antes e que o uso registra o agente.
- [ ] **Step 4: Registrar** o resultado no documento de homologação e commit `docs: record per-module AI agents regression`.
