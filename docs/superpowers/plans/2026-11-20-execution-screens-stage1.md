# Telas de execução — etapa 1 (estrutura comum + Qualificação) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A página `/executions/[id]` de uma qualificação passa a mostrar ao usuário final o progresso como mapa de pontos e o resultado em grupos com aprovação em lote (até 500), deixando a visão técnica atrás de "Detalhes técnicos".

**Architecture:** O servidor ganha uma leitura resumida da execução (`overview`: grupos, contagens, pontos, progresso) calculada sobre todos os itens, e a aplicação passa a aceitar até 500 itens pulando conflitos por item. A IA de aderência devolve também um motivo curto. No cliente, uma estrutura comum (`ExecutionShell` + `LotMap`) e o painel da Qualificação substituem a visão atual para jobs de qualificação; a visão atual continua, intacta, como "Detalhes técnicos".

**Tech Stack:** Next.js 16 (App Router), React, TypeScript, PostgreSQL, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-20-execution-results-panel-design.md` (modelo visual aprovado: `.superpowers/brainstorm/1539-1795201989/content/painel-a-v3.html`, fora do git).

## Global Constraints

- Toda resposta e texto de interface em português; nenhum código técnico, nome de provedor ou URL de API na tela do usuário.
- Identidade do app: Manrope no texto, Sora nos números/títulos, tokens de `src/app/globals.css` (`--primary`, `--green`, `--red`, `--border`, `--secondary`), tema escuro pelos tokens existentes. Texto sobre o laranja com contraste AA (texto escuro).
- Nada de fileira de cartões iguais, rótulos em caixa alta, gradiente decorativo; um único destaque (bloco das prontas).
- Responsivo até 320 px, foco de teclado visível, `prefers-reduced-motion` desliga o pulso.
- Proteções da aplicação continuam: idempotência por `requestId`, permissão `data.write`, conferência de campo-base e de lista por lead; versão do Contexto de IA/produto continua recusando o lote inteiro.
- Testes de integração rodam uma suíte por vez (`node scripts/test-integration.mjs <suite>`); nada de jobs `queued`/`running` semeados no banco compartilhado.
- Só jobs de qualificação (não enriquecimento, não pesquisa, não teste de conexão da IA) usam o painel novo nesta etapa.

## Review Focus

- Lote de 500 com um lead editado depois da análise: 499 aplicados, 1 listado em "ficaram de fora" com "foi editada depois da análise"; repetir o mesmo clique não aplica de novo (idempotente).
- Execução parcial/cancelada: pontos dos leads não processados ficam vazados e não entram em nenhum grupo nem botão.
- Lead aderente sem nenhuma alteração proposta (ou já aplicado): fora do N do botão; contado em "sem nada a aplicar".
- Resposta antiga da IA sem `brief`: a linha mostra o motivo vazio, sem quebrar nem cortar o parecer.
- Job que não é de qualificação (enriquecimento, pesquisa, teste de conexão) continua abrindo a página atual sem mudança.

---

### Task 1: Motivo curto na avaliação de aderência

**Files:**
- Modify: `src/server/prospecting/ai/output.ts` (schema `qualify`, `conventionalSchema`, `ConventionalResult`, `parseConventional`)
- Modify: `src/domain/prospecting.ts:33` (`ModuleResult`)
- Modify: `src/server/prospecting/qualification.ts:292` (grava `result.brief`)
- Test: `tests/ai-conventional.test.ts`

**Interfaces:**
- Produces: `ModuleResult.brief?: string` (≤ 80 caracteres, só no módulo `qualify` vindo da LLM convencional); `ConventionalResult` de `qualify` ganha `brief?: string`.

- [ ] **Step 1: Write the failing tests** em `tests/ai-conventional.test.ts`:
  - `qualify returns a short reason when the model sends brief` — payload `{verdict:'fits',reason:'Clínica com consultas.',brief:'site desatualizado',evidenceIds:['e1']}` → `result.brief==='site desatualizado'`.
  - `qualify without brief still parses` — payload sem `brief` → `result.brief===undefined`, `result.reason` preservado.
  - `qualify brief longer than 80 is rejected as invalid` — `brief` com 81 caracteres → rejeita com `code:'INVALID_CONVENTIONAL_RESULT'`.
  - `conventionalSchema('qualify') requires brief` — `required` contém `'brief'`.
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/ai-conventional.test.ts` — Expected: FAIL nos 4 testes novos.
- [ ] **Step 3: Implement.** zod: `brief:z.string().trim().min(1).max(80).optional()`; JSON schema: `brief:{type:'string'}` em `properties` e `required`; instrução do prompt de `qualify`: "brief: motivo em até 8 palavras, em português, sem citar fontes"; `parseConventional` repassa `brief`; em `qualification.ts:292` `result.brief=classified.brief` quando houver.
- [ ] **Step 4: Run** o mesmo comando — Expected: PASS (todos).
- [ ] **Step 5: Commit** `feat(qualification): the fit assessment returns a short reason`

### Task 2: Resumo da execução para a tela (overview)

**Files:**
- Create: `src/domain/execution-overview.ts` (tipos + função pura)
- Create: `src/server/prospecting/overview.ts` (`readExecutionOverview`)
- Modify: `src/server/prospecting/http.ts` (ação `'overview'`), `src/client/prospecting-client.ts` (`overview(id)`)
- Create: `src/app/api/prospecting/jobs/[id]/overview/route.ts` (igual a `items/route.ts`, ação `'overview'`)
- Test: `tests/execution-overview.test.ts`, `tests/integration/prospecting-pipeline.test.ts`

**Interfaces:**
- Produces (em `src/domain/execution-overview.ts`):
  - `export type LotGroup='ready'|'noInfo'|'outside'|'nothing'`
  - `export type LotDot={group:LotGroup|'pending'|'current';name:string}`
  - `export interface QualificationOverview{total:number;done:number;etaMinutes:number|null;stage:'sites'|'cnpj'|'ai'|'summary'|null;dots:LotDot[];groups:Record<Exclude<LotGroup,'nothing'>,{count:number;itemIds:string[]}>&{nothing:{count:number}};ready:{emails:number;cnpjs:number;summaries:number};noInfo:{contacts:number};items:Record<string,{name:string;leadId:string|null;brief:string|null;found:('email'|'phone'|'cnpj'|'site')[];reason:string|null}>}`
  - `export function summarizeQualification(input:{total:number;items:{id:string;name:string;leadId:string|null;applied:boolean;results:ModuleResult[];createdAt:string}[];startedAt:string;now:string;currentStep:string|null}):QualificationOverview`
  - Server: `readExecutionOverview(p:Principal,id:string):Promise<QualificationOverview>`; client: `overview(id:string)=>Promise<QualificationOverview>`.
- Regras: grupo pelo `proposed.qualification` dos resultados `pending_review` não aplicados (`qualified`→`ready`, `disqualified`→`outside`, demais→`noInfo`); item sem nenhuma proposta ou já aplicado→`nothing`; `itemIds` só dos aplicáveis. `dots`: os concluídos agrupados na ordem `ready`,`noInfo`,`outside`,`nothing`; depois um `current` (se ainda rodando) e `pending` até `total`. `etaMinutes`: `null` com menos de 3 concluídos; senão média (`now−startedAt`)/`done` × restantes, arredondado para cima. `stage` pelo `currentStep` (`website|registry`→`cnpj` se registry, `evidence|deep|verify-site|maps-evidence|research-evidence`→`sites`, `qualify`→`ai`, `summary`→`summary`). `found`: campos de contato/cadastro propostos. `reason`: `proposed.reason` do módulo `qualify` (para "Ver por quê").

- [ ] **Step 1: Write the failing unit tests** em `tests/execution-overview.test.ts` (fixtures de `ModuleResult` mínimos):
  - `groups by the final proposed qualification` — 2 `qualified`, 1 `disqualified`, 1 `pending` → `groups.ready.count===2`, `outside.count===1`, `noInfo.count===1`.
  - `applied or empty items count as nothing and stay out of the buttons` — 1 aplicado + 1 sem proposta → `groups.nothing.count===2`, ausentes de todos os `itemIds`.
  - `dots: finished grouped by color, then current, then pending up to total` — `total:5`, 3 concluídos (ready, outside, ready) rodando → grupos `['ready','ready','outside','current','pending']`.
  - `eta is null before 3 finished and rounds up after` — 2 concluídos → `null`; 3 concluídos em 30 min de `total:6` → `30`.
  - `stage follows the current step` — `'qualify:lead1'`→`'ai'`, `'registry:lead1'`→`'cnpj'`, `null`→`null`.
  - `ready totals count new emails, cnpjs and summaries` — 2 prontas, uma com `email`+`cnpj`+`summary`, outra só `summary` → `ready:{emails:1,cnpjs:1,summaries:2}`.
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/execution-overview.test.ts` — Expected: FAIL (módulo não existe).
- [ ] **Step 3: Implement** `summarizeQualification` e `readExecutionOverview` (lê `prospecting_job` e todos os `prospecting_item` do job numa transação do workspace, `currentStep` = `step` da última `prospecting_attempt` em `prepared` ou mais recente; `total` = `input.leadIds.length`; recusa 404 para job inexistente e 409 para job que não é de qualificação ou é teste de conexão).
- [ ] **Step 4: Run** o mesmo comando — Expected: PASS.
- [ ] **Step 5: Integration test** em `tests/integration/prospecting-pipeline.test.ts`: `overview of a finished qualification groups real items` — reaproveita um job de qualificação já usado na suíte, chama `readExecutionOverview` e confere `total`, `done` e a soma dos grupos igual a `done`. Run `node scripts/test-integration.mjs prospecting-pipeline` — Expected: PASS.
- [ ] **Step 6: Commit** `feat(executions): qualification overview for the end-user screen`

### Task 3: Aprovação em lote até 500, pulando conflitos por empresa

**Files:**
- Modify: `src/server/prospecting/application.ts` (schema, laço de qualificação, retorno)
- Modify: `src/client/prospecting-client.ts` (`apply` aceita `{skipConflicts:true}` e devolve `skipped`)
- Test: `tests/integration/prospecting-pipeline.test.ts`

**Interfaces:**
- Produces: `applyJobResults(p,jobId,body)` aceita `itemIds` com até 500 e `skipConflicts?:boolean`; retorna `{applied:number;revision:number;skipped?:{itemId:string;name:string;reason:'edited'|'moved'|'unavailable'}[]}`.
- Regras: com `skipConflicts`, lead removido/movido → `moved`; `inputFingerprint` ou campo-base diferente → `edited`; item já aplicado ou inexistente → `unavailable`; esses itens são pulados e listados, os demais aplicados na mesma transação. Contexto/produto mudado continua recusando tudo (`RESULT_CONFLICT`). Sem `skipConflicts`, comportamento atual inalterado (limite volta a ser verificado só para ≤ 500). Seleção que, depois dos pulos, não tem alteração: `{applied:0,skipped:[…]}` em vez de erro.

- [ ] **Step 1: Write the failing integration tests** em `tests/integration/prospecting-pipeline.test.ts`:
  - `batch apply skips an edited lead and applies the rest` — 2 itens aplicáveis, edita o `email` de um lead antes → `applied===1`, `skipped` = `[{itemId,name,reason:'edited'}]`; o outro lead recebeu a proposta.
  - `batch apply is idempotent with skipped items` — mesmo `requestId` de novo → mesmo resultado, nada reaplicado.
  - `batch apply accepts more than 100 items` — seleção de 101 ids com `skipConflicts` não é recusada por tamanho (ids inexistentes viram `unavailable`).
  - `a changed AI context still refuses the whole batch` — muda a versão do contexto → `RESULT_CONFLICT`.
- [ ] **Step 2: Run** `node scripts/test-integration.mjs prospecting-pipeline` — Expected: FAIL nos 4 novos.
- [ ] **Step 3: Implement** conforme as regras; `hash` do comando inclui `skipConflicts`.
- [ ] **Step 4: Run** o mesmo comando — Expected: PASS (todos, inclusive os antigos de aplicação).
- [ ] **Step 5: Commit** `feat(executions): batch approval up to 500 skips conflicting companies`

### Task 4: Tela nova da qualificação (estrutura comum + painel)

**Files:**
- Create: `src/modules/prospecting/execution/lot-map.tsx` (`LotMap`)
- Create: `src/modules/prospecting/execution/execution-shell.tsx` (`ExecutionShell`)
- Create: `src/modules/prospecting/execution/qualification-panel.tsx` (`QualificationPanel`)
- Create: `src/modules/prospecting/execution/execution.css` (importado pelo shell)
- Modify: `src/modules/prospecting/job-progress.tsx` (qualificação usa a tela nova; `?detalhes=1` mostra a visão atual)
- Test: verificação no navegador (abaixo) + `npm test` + `npm run build`

**Interfaces:**
- Consumes: `client.overview(id)` (Task 2), `client.apply(id,itemIds,rejected,{skipConflicts:true})` (Task 3), `ModuleResult.brief` (Task 1).
- Produces: `LotMap({dots}:{dots:LotDot[]})` (cada ponto com `title`/`aria-label` "<nome> — <grupo>"; 25 por linha no desktop, 15 abaixo de 600 px); `ExecutionShell({title,status,stages,current,technicalHref,children})` com `stages:{key:string;label:string}[]` (reutilizável pelas próximas etapas); `QualificationPanel({job,overview,onApplied})`.
- Copy fixa (do desenho/modelo): "Qualificando N empresas" / "N empresas analisadas em <duração>"; "X de N", "faltam cerca de M minutos"; etapas "Sites lidos", "CNPJ conferido", "IA avaliando o perfil", "Resumos"; "Pode fechar esta tela. O resultado fica em Execuções."; bloco "N empresas prontas para abordar", "Combinam com o seu cliente ideal.", botão "Aprovar as N", link "Conferir a lista antes"; linhas "N sem informação suficiente" + "Salvar os contatos" e "N fora do perfil" + "Ver por quê"; resultado "X aprovadas" e, se houver, "Y ficaram de fora" com motivo ("foi editada depois da análise", "mudou de lista", "já não está disponível"); link "Detalhes técnicos" só para dono/administrador. Estados: parcial → "Parte das empresas não foi analisada."; cancelada → "Execução cancelada. O que foi analisado está abaixo."; `needs_reconciliation` → "Uma etapa precisa ser conferida por um administrador." + botão atual de conferir para dono/admin; espera de capacidade → "Aguardando vez para continuar."
- Comportamento: "Aprovar as N" envia os `itemIds` do grupo `ready` menos os desmarcados na lista, com `skipConflicts:true`; "Salvar os contatos" envia `noInfo.itemIds` com `rejected` = `['qualification','reason','summary']` por item; "Fora do perfil" "Ver por quê" abre o `reason` em um painel e oferece "Marcar como fora do perfil" (aplica o grupo `outside`). Lista "Conferir" com rolagem e todos marcados; desmarcar remove do envio. Atualização ao vivo pelo mesmo `useLiveRefresh` (5 s) chamando `overview`.

- [ ] **Step 1: Implement** os quatro arquivos e a troca em `job-progress.tsx` (só `job.kind==='qualification' && !job.enrichment && !job.research && !job.companyPeople && job.purpose!=='ai-connection-test'`; com `?detalhes=1` ou nos outros tipos, renderiza a visão atual).
- [ ] **Step 2: Run** `npm test` e `npm run build` — Expected: unit PASS (exceto a falha antiga conhecida de `tests/sdr-compose.test.ts`), build OK.
- [ ] **Step 3: Verificação no app** (Chrome, `http://127.0.0.1:3210`, app iniciado destacado e runtime reiniciado): qualificar ~10 leads reais de uma lista do workspace Agência Prometeus; conferir durante a execução os pontos acendendo, "X de N", etapas e tempo; ao terminar, grupos e contagens batem com `overview`; aprovar as prontas e conferir nos leads; abrir "Detalhes técnicos" como dono; largura 390 px sem rolagem horizontal; tema escuro legível. Prints da tela em andamento e concluída.
- [ ] **Step 4: Commit** `feat(executions): end-user qualification screen with lot map and batch approval`
