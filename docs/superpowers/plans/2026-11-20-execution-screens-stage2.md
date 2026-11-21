# Telas de execução — etapa 2 (Geração) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A página `/executions/[id]` de uma geração (Google Maps, busca na web, base CNPJ, Apollo) mostra ao usuário final o progresso como mapa de pontos e, ao terminar, as empresas novas com o botão "Qualificar as N", deixando a visão técnica atrás de "Detalhes técnicos".

**Architecture:** O resumo da execução (`readExecutionOverview`) passa a responder também para gerações, com uma função pura `summarizeGeneration`; a estrutura comum da etapa 1 (`ExecutionShell`, `StageLine`, `LotMap`) é reaproveitada num `GenerationPanel`. O Qualificador aceita `?lista=<id>` para abrir com a lista escolhida.

**Tech Stack:** Next.js 16, React, TypeScript, PostgreSQL, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-20-execution-results-panel-design.md` (seção "Etapa 2 — Geração").

## Global Constraints
- As da etapa 1 (português, sem código técnico na tela, tokens do app, um destaque, responsivo, foco visível, `prefers-reduced-motion`, uma suíte de integração por vez).
- Só jobs `kind==='generation'` usam o painel novo nesta etapa; com `?detalhes=1` (dono/administrador) a visão atual continua.

## Review Focus
- Busca CNPJ (registro primeiro) com mais descartes que o pedido: os pontos mostram todas as examinadas, sem pontos vazados depois de concluída.
- Geração que falhou antes de achar qualquer empresa: frase "A busca parou antes de terminar.", sem botão "Qualificar".
- Todas repetidas (0 novas): sem bloco de destaque; frase "Nenhuma empresa nova entrou na lista." e a linha das repetidas.
- Lista de destino apagada ou renomeada depois: o título usa o nome atual; sem lista, "a lista".
- Execução que não é geração continua com o painel/visão anterior.

---

### Task 1: Resumo da geração (overview)

**Files:**
- Modify: `src/domain/execution-overview.ts` (tipos + `summarizeGeneration` + `discoveryReasonLabels`)
- Modify: `src/server/prospecting/overview.ts` (`readExecutionOverview` devolve `ExecutionOverview`)
- Modify: `src/client/prospecting-client.ts` (tipo de `overview`)
- Modify: `src/modules/prospecting/job-progress.tsx` (usa `discoveryReasonLabels` do domínio)
- Test: `tests/execution-overview.test.ts`, `tests/integration/prospecting-pipeline.test.ts`

**Interfaces:**
- Produces:
  - `export type GenerationDotGroup='new'|'dup'|'out'`
  - `export interface GenerationOverview{kind:'generation';source:'MAPS'|'WEB'|'CNPJ'|'APOLLO';listId:string|null;listName:string|null;target:number;examined:number;etaMinutes:number|null;stage:'search'|'maps'|'site'|'save'|null;dots:{group:GenerationDotGroup|'pending'|'current';name:string}[];created:{count:number;phones:number;sites:number;ratings:number;emails:number;cnpjs:number;companies:{leadId:string;name:string;city:string|null;found:('phone'|'site'|'email'|'cnpj'|'rating')[]}[]};duplicates:{count:number;names:string[]};discarded:{count:number;reasons:{label:string;count:number}[]}}`
  - `export type ExecutionOverview=QualificationOverview&{kind:'qualification'}|GenerationOverview` (o resumo da qualificação ganha `kind:'qualification'`).
  - `export const discoveryReasonLabels:Record<string,string>` (os 7 textos hoje em `job-progress.tsx`).
  - `export function summarizeGeneration(input:{source:GenerationOverview['source'];listId:string|null;listName:string|null;target:number;counts:{inserted:number;duplicates:number;rejected:number};reasons:Record<string,number>;created:{leadId:string;name:string;city?:string;phone?:string;site?:string;email?:string;cnpj?:string;rating?:string}[];duplicateNames:string[];startedAt:string;now:string;running:boolean;currentStep:string|null}):GenerationOverview`
- Regras: `examined=inserted+duplicates+rejected`; pontos `new`×inserted, `dup`×duplicates, `out`×rejected nessa ordem; em andamento, um `current` e `pending` até `target` (nunca menos que examinadas); concluída, sem `pending`/`current`. `etaMinutes` só em andamento com ≥3 examinadas: tempo/examinadas×(target−inserted), arredondado para cima, mínimo 1. `stage`: em andamento sem nenhuma examinada → `search`; passo atual com prefixo `maps:` → `maps`; `website:`/`verify-site`/`evidence` → `site`; demais com examinadas → `save`. Motivos: rótulo de `discoveryReasonLabels` ou o código. `found` e totais só com valor não vazio.

- [ ] **Step 1: Write the failing unit tests** em `tests/execution-overview.test.ts`:
  - `generation dots: new, duplicates, discarded, then current and pending up to target` — target 6, running, counts 2/1/1 → `['new','new','dup','out','current','pending']`.
  - `a finished generation has no pending dots even with more discarded than the target` — target 2, not running, counts 2/0/5 → 7 pontos, nenhum `pending`.
  - `generation totals and found count only filled values` — 2 criadas, uma com phone+site+rating, outra só phone → `phones:2,sites:1,ratings:1,emails:0`; `found` da primeira `['phone','site','rating']`.
  - `discard reasons use the plain labels` — `{NOT_A_COMPANY_SITE:2,X_UNKNOWN:1}` → `[{label:'Resultado de lista, diretório ou rede social, não site de empresa',count:2},{label:'X_UNKNOWN',count:1}]`.
  - `generation stage` — running sem examinadas → `search`; `currentStep:'maps:lead:registry-first'` → `maps`; `'website:x:admission'` → `site`; examinadas e `'start'` → `save`.
  - `qualification overview carries kind` — `summarizeQualification(...)` tem `kind==='qualification'`.
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/execution-overview.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** os tipos, `summarizeGeneration`, `kind` no resumo da qualificação, e em `readExecutionOverview` o ramo de geração: lê `prospecting_job` (counts, checkpoint.discoveryReasons, input.limit, input.source, list_id), o nome da lista (`app.list`), os itens `inserted` com o `payload` do lead (join em `app.lead`) e os nomes dos `duplicate`; `running` = estado em `queued|running|waiting_provider`; passo atual = último `prospecting_attempt.step`. Em `job-progress.tsx`, troca a constante local pelos rótulos do domínio.
- [ ] **Step 4: Run** o mesmo comando — Expected: PASS.
- [ ] **Step 5: Integration** em `tests/integration/prospecting-pipeline.test.ts`, no teste de geração já existente que termina com leads inseridos: `readExecutionOverview` devolve `kind:'generation'`, `created.count` igual a `counts.inserted` e `examined` igual à soma. Run `node scripts/test-integration.mjs prospecting-pipeline` — Expected: PASS.
- [ ] **Step 6: Commit** `feat(executions): generation overview for the end-user screen`

### Task 2: Tela nova da geração + Qualificador com a lista escolhida

**Files:**
- Create: `src/modules/prospecting/execution/generation-panel.tsx` (`GenerationPanel`)
- Modify: `src/modules/prospecting/execution/qualification-panel.tsx` (estreita `overview` para `kind==='qualification'`)
- Modify: `src/modules/prospecting/job-progress.tsx` (geração usa o painel novo)
- Modify: `src/app/(app)/leads/qualifier/page.tsx`, `src/modules/prospecting/qualifier.tsx`, `src/modules/prospecting/server-qualifier.tsx` (`initialList`)
- Modify: `src/app/execution-reference.css` (cores `new`/`dup`/`out` dos pontos e legenda)
- Test: `npm test`, `npm run build`, verificação no app

**Interfaces:**
- Consumes: `client.overview(id)` → `GenerationOverview` (Task 1); `ExecutionShell`, `StageLine`, `LotMap`/`LotLegend` (etapa 1; `LotMap` passa a aceitar os grupos da geração).
- Produces: `GenerationPanel({job,technicalHref,actions})`; `ServerQualifier({initialList}:{initialList?:string})`.
- Copy (do modelo): título = nome da lista ou "Busca de empresas"; status "Buscando N empresas no <fonte>" / "N empresas examinadas em <duração>, no <fonte>"; "X de N" e "faltam cerca de M minutos"; etapas por fonte (spec); "Pode fechar esta tela. As empresas já entram na lista enquanto a busca anda."; legenda "N novas (até agora)", "N já na sua base", "N descartadas"; destaque "N empresas novas na lista <lista>" + "Ainda sem qualificação." + totais não vazios + botão "Qualificar as N" (`/leads/qualifier?lista=<listId>`) + links "Ver as empresas" e "Abrir a lista" (`/contacts?list=<listId>`); linhas "N já estavam na sua base" + "Não foram repetidas; continuam onde estavam." + "Ver quais"; "N descartadas" + "Ver motivos". Sem novas: "Nenhuma empresa nova entrou na lista.". Falha: "A busca parou antes de terminar."; cancelada: "Busca cancelada. O que já entrou na lista está abaixo.". Fonte: Google Maps, busca na web, base CNPJ, Apollo.

- [ ] **Step 1: Implement** `GenerationPanel`, a troca em `job-progress.tsx` (`job.kind==='generation'&&!technical`) e o `initialList` do Qualificador (a página lê `searchParams.lista`; o `ServerQualifier` começa com essa lista escolhida).
- [ ] **Step 2: Run** `npm test` e `npm run build` — Expected: PASS (exceto a falha antiga de `tests/sdr-compose.test.ts`), build OK.
- [ ] **Step 3: Verificação no app** (Chrome, 127.0.0.1:3210, app destacado e runtime reiniciados): gerar 5 empresas reais no Google Maps numa lista nova; conferir a tela em andamento e concluída; "Qualificar as N" abre o Qualificador com a lista escolhida; abrir uma geração antiga (busca que falhou com HTTP_403) e ver a frase simples; 390 px sem rolagem horizontal. Prints.
- [ ] **Step 4: Commit** `feat(executions): end-user generation screen with lot map and qualify shortcut`
