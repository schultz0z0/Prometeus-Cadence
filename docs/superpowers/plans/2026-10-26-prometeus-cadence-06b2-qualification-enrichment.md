# 06B.2 Qualification, Enrichment and Recurrence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution, one final independent review.

**Goal:** Deliver evidenced qualification, useful decision-maker enrichment and recoverable recurring selection.
**Architecture:** Extend existing qualification jobs/journal and scheduler, workspace-scoped enrichment cache and protected result delivery; preserve existing APIs and authoring snapshot.
**Tech Stack:** Next.js16.4.2, React, PostgreSQL RLS, TypeScript, node:test, Playwright/RES.
**Spec:** docs/superpowers/specs/2026-10-26-prometeus-cadence-06b2-design.md

## Global Constraints

- Base `ab336b7`, branch `codex/qualification-enrichment-06b2`; current checkout reused for approved native runtime workflow.
- No new dependencies/services, reference writes, paid live calls, messages or charging live.
- Useful means named decision maker with personally attributed email/phone and bounded cited evidence. Generic company contacts and DNS are not verification.
- Useful cache30days/negative1day, maximum100 companies/enrichment, one commercial credit per useful cached resolution. Unknown calls retain holds.
- Public LinkedIn search only with existing Apify WEB; absent dedicated authenticated Actor is not an implemented private integration.
- Same viewport/state evidence; blocked reference remains unobserved. No blanket100% or public production certification.

## Review Focus

1. Generic company phone/CEO hallucination and injected source instructions cannot become a personal contact.
2. Concurrent identical CNPJ/cache expiration and replay cannot double-charge or silently exceed reviewed cost.
3. Forged workspace commands/direct app SQL cannot bypass import quota via an enrichment marker.
4. Membership/configuration revoked during network or partial result retains receipt but publishes no unauthorized data.
5. Reengagement never releases uncertain/pending-review work or starts outbound messaging; edit/pause invalidates old authorization.

### Task 1: Evidence and qualification contracts
**Files:** domain/enrichment.ts, domain/prospecting.ts, server/prospecting/{schemas,qualification,config}.ts, extraction/contacts.ts, tests/enrichment.test.ts and qualification regressions.
**Interfaces:** `Decisor`, `EnrichmentOptions`, `validateDecisorEvidence`; optional enrichment mode on qualification input, structured email assessment without mailbox/WhatsApp claims.
- [x] RED tests for personal-contact attribution, unknown citations, generic contacts, duplicate people and bounded output; implement validators.
- [x] RED tests for individual qualification filters/quality, model cache identity and no evidence; implement and run focused units/integration.

### Task 2: Enrichment execution, cache, commercial credit and delivery
**Files:** server/prospecting/enrichment*.ts, providers/{profiles,apify}.ts, service.ts, qualification.ts, application.ts, domain/model.ts; db/migrations/080-*.sql; tests/integration/enrichment.test.ts.
**Interfaces:** existing prepare/confirm/worker/items/apply, leased receipt/journal; result cache keyed by normalized company+contract/config; DB protected materialization creates target list only for useful reviewed data.
- [x] RED integration: preview no side effects; useful vs empty result, cache replay/concurrency and accepted-only credit; implement job extension and migration.
- [x] RED integration: wrong tenant/role, stale revision/lease/config, forged exemption, uncertain POST/reconciliation, cancel/retry without duplicate call; implement atomic delivery guards.
- [x] Exercise actual provider adapter transport with controlled HTTP, apply/read result and one-credit/no-import consumption; run focused regression.

### Task 3: Recurring qualification and reengagement
**Files:** domain/automation*, server/automations/{state,assignments,dispatch,scheduler}.ts, modules/automations/manual-wizard.tsx; tests/integration/automation*.test.ts.
**Interfaces:** existing definition/filter/modules/schedule, `eligibleLeads` and assignments; explicit reengagement days and no send effect.
- [x] RED integration for completed vs pending/uncertain assignment, minimum interval, opt-out, pause/config and replay; implement supported definition and eligibility.
- [x] Connect module selection, schedule and recovery UI to existing runtime controls. Keep incomplete dependencies explicit; run scheduler regression.

### Task 4: Qualifier/enrichment UI and persisted contact quality
**Files:** modules/prospecting/{enrichment,server-qualifier,job-review,job-results}.tsx, client/prospecting-client.ts, contacts detail/filter, CSS.
**Interfaces:** real reviews/jobs/items; show eligible/cache/useful/budget counts, manual apply/result target list, no unavailable feature sold.
- [x] Wire reference-aligned surfaces and popups, real loading/error/retry and evidence links; preserve drafts/workspace isolation.
- [x] Compare reference/local desktop/mobile; test native keyboard, overflow, preview/cancel and controlled/local persisted result states.

### Task 5: Final verification and handoff
**Files:** docs/validation/06-qualification-enrichment.md, evidence/06b2, KB STATUS/index/log/ledger, roadmap.
- [x] Full unit/integration suites, production build then typecheck, diff/secret audit and runtime recovery.
- [x] One independent final review, regrade and fix Important/Critical with RED→GREEN and green suite. No repeated review loop.
- [x] Record observed/own/unobserved rules, fixtures cleanup, limits/next06D.1; commit, archive own execution ledger.

## Encerramento26/10/2026

Tasks1–5 concluídas no escopo do [relatório](../../validation/06-qualification-enrichment.md):302unitários/306integrações, build/typecheck, revisão independente única e correções RED→GREEN, UI/evidência/aplicação/filtros e limpeza QA. Referência paga e fornecedor real não exercitados. Novo requisito06IA registrado durante o encerramento; próximo06IA antes de06D.1, sem declarar administração central implementada neste pacote.
