# 06B.1 Contacts and Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close contacts/import/search gaps with real persistence and reference-aligned interfaces.
**Architecture:** Extend current transactional commands and planning jobs; add bounded tenant reads; retain complete authoring snapshot compatibility.
**Tech Stack:** Next.js, React, TypeScript, PostgreSQL RLS, node:test, Playwright CLI.
**Spec:** docs/superpowers/specs/2026-10-26-prometeus-cadence-06b1-design.md

## Global Constraints

- Native implementation in current checkout on `codex/contacts-search-06b1`, based on `d9ade56`; no extra worktree/service/dependency.
- No reference mutations, paid source calls or messages. Preserve user divergences and existing quotas/RLS.
- A preview or AI suggestion creates no list. No silent filter dropping or fabricated verification.
- Same-viewport screenshots with RES masking; blocked reference states remain unobserved.

## Review Focus

1. Import mapping changed after preview, bad headers/encodings/quotes and conflicting identities: no corrupted or silently shifted data.
2. Existing same email/phone in another list and concurrent import: no overwrite, one quota consumption per accepted row.
3. Tenant switched/revoked during paginated read: no stale private response or cross-workspace cursor/query accepted.
4. AI output contains unsupported filters/instructions: only validated fields become a draft, no implicit search/automation creation.
5. Filter/page changes while requests complete out of order: current results and selection stay consistent.

### Task 1: Import contract and atomic deduplication

**Files:** domain/import.ts, model.ts, repository.ts, commands.ts; demo/repository.ts and storage.ts; server/workspaces/{commands,schemas}.ts; client/workspace-repository.ts; modules/contacts/import-preview.tsx; tests/import-contract.test.ts and integration/contacts-base.test.ts.
**Interfaces:** consumes Lead and current `importLeads`; produces ImportField/ImportMapping, autoMapImport, parseManualContacts, deduplicateImports and optional dedupScope on importLeads (default workspace).

- [x] Write failing tests: semicolon/TSV quoted delimiters; aliases/name+surname; malformed shape and invalid contact; manual formats; same CNPJ/email/phone dedup by list/workspace; no name/domain dedup; selected fields preserved.
- [x] Run focused unit tests: expected meaningful FAIL, then implement minimal contract and propagate optional fields/command options.
- [x] Add integration tests for persisted fields, accepted-only consumption, replay and revision conflict/tenant membership. Run expected RED then GREEN.
- [x] Wire source/mapping/review/success UI and run focused regression. Commit deliverable.

### Task 2: Contacts queries and filters

**Files:** domain/leads.ts and contacts-query.ts; server/contacts/{repository,http}.ts; api/contacts/route.ts; client/use-contacts.ts; modules/contacts/contacts-table.tsx; tests/contacts-query.test.ts and integration/contacts-base.test.ts.
**Interfaces:** consumes LeadQuery and principal; produces readContacts(p,query)→{items,total,page,pageSize} (pageSize20/default,100max; page1–5000), strict keys and expected-workspace guard. Current snapshot commands still write.

- [x] Add RED tests for combined filters, inclusive date bounds, ties/stable sorting and invalid query; implement shared domain predicate.
- [x] Add RED integration for bounded pages, tenant isolation, HTTP401/409/422/405 and data state filters; implement parameterized RLS reads.
- [x] Wire authenticated UI with cancellable/latest query guard; keep filters/columns/selection and existing mutations, truthful cadence status. Test and commit.

### Task 3: Supported source filters and AI suggestions

**Files:** domain/generation-draft.ts; modules/prospecting/{server-generator,niche-suggestions}.tsx; prospecting/schemas.ts; tests/generation-draft.test.ts and prospecting pipeline tests.
**Interfaces:** consumes existing audience_plan/PlanningClient; produces audienceOptionToDraft(option) with source-compatible filters, no confirmation of selection/creation. Existing prepare/confirm search remains authority.

- [x] RED tests: hypothesis only fills draft, rejects unsupported/injected fields; CNAE/CNPJ optional lookup variants; source-switch excludes stale filters.
- [x] Implement AI review/status/three choices using existing planning client, apply only to editable source fields. Preserve model usage and no double confirmation.
- [x] Verify prepare creates no list/job; confirmed generation/job ingestion and replay tested. Commit.

### Task 4: Visual and full validation

**Files:** contact/prospecting CSS as required; docs/validation/06-contacts-search.md; KB evidence/STATUS; roadmap.
**Interfaces:** consumes tasks1–3; produces reference-classified proof, screenshots and current next milestone.

- [x] Compare contact menus/filters/import/manual/mapping/review/generator desktop1920×855 and mobile390×844; apply differences and recheck no overflow/errors, keyboard/modal behavior.
- [x] Run unit suite, full integration suite, build and sequential typecheck; expected all PASS. Check diff/secrets.
- [x] One independent final branch review; one Important/Critical fix pass with RED→GREEN and suite, no repeated reviewer loop.
- [x] Update docs with actual evidence/limits, commit and clean this plan's scratch after archiving ledger. Next06B.2.

## Encerramento

290 unitários/283 integrações, build de produção e typecheck posterior; revisão única e correções documentadas no relatório. Os passos de commit são consolidados na entrega nativa, sem commits intermediários por tarefa. Mapeamento final inclui21 campos canônicos, sobrenome auxiliar e campos personalizados por contato. ImportColumns, contacts-read-state e contacts-export compõem os arquivos adicionais do plano; sem nova dependência ou serviço.
