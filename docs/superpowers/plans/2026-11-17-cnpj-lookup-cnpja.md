# Consulta de CNPJ via CNPJá + OpenCNPJ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every one-CNPJ lookup (Qualificador, Enriquecedor, company/people research, web-generation admission) reads CNPJá first and the OpenCNPJ public API as fallback, instead of the Apify CNPJ Actor.

**Architecture:** A new synchronous lookup module returns the same `Candidate` shape the Apify CNPJ branch produced. `sourceResults(...,'registry',...)` calls it through `performStep` under provider `cnpj-registry` with no reserved units, and a crash-left `prepared` attempt is retried instead of sent to reconciliation (read-only call). The Gerador "CNPJ" source (CNAE/UF/city search) stays on Apify.

**Tech Stack:** Next.js 16 / TypeScript, Node test runner (`npm test`), integration via `node scripts/test-integration.mjs <suite>`, Postgres 18.

**Spec:** `docs/superpowers/specs/2026-11-17-cnpj-lookup-cnpja-design.md`

## Global Constraints

- CNPJá: `GET https://api.cnpja.com/office/{cnpj}?strategy=CACHE_IF_FRESH&maxAge=45`, header `Authorization: <CNPJA_API_KEY>`. Key only from env; never in errors, logs, evidence or UI.
- OpenCNPJ: `GET https://api.opencnpj.org/{cnpj}`, no key; 404 = not found.
- Fallback to OpenCNPJ on any CNPJá failure (network, 4xx incl. 401/402/403/404/429, 5xx, invalid body) and when `CNPJA_API_KEY` is unset.
- Both not found → `ProviderError('CNPJ_NOT_FOUND')`; any other double failure → `ProviderError('CNPJ_SOURCE_ERROR')`; never `uncertain`.
- Evidence URL: `https://cnpja.com/office/<cnpj>` or `https://opencnpj.org/<cnpj>`.
- Mobile fix: local number of 8 digits starting with 6–9 gets a leading `9`.
- Reuse `providerJson` (`src/server/prospecting/providers/transport.ts`, 30 s, 3 GET tries).
- No new usage unit and no migration: lookups reserve `{}`.

## Review Focus

- CNPJá answers 200 with a different `taxId` than asked → must not be used (identity check in `sourceResults` throws `CNPJ_IDENTITY_MISMATCH`; Task 1 test asserts the candidate carries the returned CNPJ, Task 2 test asserts the mismatch).
- CNPJá 429/402 (limit or no credits) → OpenCNPJ answers; the job does not stop (Task 1 test).
- Worker crash after the attempt row is `prepared` → rerun completes instead of `needs_reconciliation` (Task 2 test).
- MEI without QSA → owner still derived from company name by `registryDecisionMakers` (Task 1 test keeps `companyName` as the raw registry name).
- Lead CNPJ with punctuation/alfanumérico → `normalizeCnpj` before the URL; invalid CNPJ never reaches the network (Task 1 test).

---

### Task 1: Lookup module

**Files:**
- Create: `src/server/prospecting/providers/registry.ts`
- Test: `tests/registry-lookup.test.ts`

**Interfaces:**
- Produces:
  - `export type RegistryLookup=(cnpj:string,options:{partners:boolean;signal:AbortSignal})=>Promise<{provider:'cnpja'|'opencnpj';candidate:Candidate}>`
  - `export function createRegistryLookup(deps?:{fetcher?:Fetch;apiKey?:string|null}):RegistryLookup` (defaults: `globalThis.fetch`, `process.env.CNPJA_API_KEY`)
  - `export const lookupRegistry:RegistryLookup` (= `createRegistryLookup()` built lazily per call so env is read at call time)
  - `export function registryPhone(area:string,number:string):string|undefined`

Candidate mapping (both providers → `Candidate` with `source:'CNPJ'`, `sourceRef:cnpj`):
| field | CNPJá | OpenCNPJ |
|---|---|---|
| name | `alias` ‖ `company.name` | `nome_fantasia` ‖ `razao_social` |
| companyName | `company.name` | `razao_social` |
| cnpj | `taxId` | `cnpj` |
| city/state | `address.city`/`address.state` | `municipio`/`uf` |
| phone | first `phones[]` → `registryPhone(area,number)` | first non-fax `telefones[]` → `registryPhone(ddd,numero)` |
| email | first `emails[].address` (lowercased) | `email` (lowercased) |
| cnae | `String(mainActivity.id)` padded to 7 | `cnae_principal` |
| openedAt | `founded` | `data_inicio_atividade` |
| facts.registrationStatus | `status.text` uppercased if in ATIVA/BAIXADA/INAPTA/SUSPENSA/NULA | `situacao_cadastral` same rule |
| facts.street | `"<street>, <number>"` | `"<tipo_logradouro> <logradouro>, <numero>"` |
| facts.decisionMakers (only when `partners`) | `company.members[]` → `{name:person.name,role:role.text}` | `QSA[]` via `normalizeDecisionMakers` |
| evidence | one `Evidence` with the URL above, `text`=JSON of the mapped fields (≤6000 chars), `hash:hashValue(text)` | same |

- [ ] **Step 1: Write the failing tests** in `tests/registry-lookup.test.ts` with a fake `fetcher` that records URLs/headers and returns canned bodies (use the Petrobras shapes from the spec research: CNPJá office JSON and OpenCNPJ JSON):
  - `cnpja first: maps name, companyName, city, phone 2121660000, email, registrationStatus ATIVA, evidence url https://cnpja.com/office/33000167000101` — asserts one call to `https://api.cnpja.com/office/33000167000101?strategy=CACHE_IF_FRESH&maxAge=45` with header `Authorization: KEY`, `provider==='cnpja'`.
  - `partners:true maps members to decisionMakers; partners:false omits them`.
  - `cnpja 429 falls back to opencnpj` → `provider==='opencnpj'`, evidence url `https://opencnpj.org/33000167000101`, phone `2121660000` (fax entry skipped).
  - `cnpja 404 falls back; opencnpj 404 → CNPJ_NOT_FOUND`.
  - `both 500 → CNPJ_SOURCE_ERROR, error.uncertain===false`.
  - `no api key → only opencnpj is called`.
  - `error messages never contain the api key`.
  - `invalid cnpj 'abc' → CNPJ_NOT_FOUND without any fetch`.
  - `registryPhone('21','96434276')==='21996434276'`, `registryPhone('21','21660000')==='2121660000'`, `registryPhone('11','')===undefined`.
  - `MEI: companyName stays '12.345.678 FULANO DE TAL' so registryDecisionMakers returns the owner`.

- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/registry-lookup.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/server/prospecting/providers/registry.ts` per the Interfaces block. CNPJá non-OK/throw of any kind (catch `ProviderError`) → try OpenCNPJ; OpenCNPJ `HTTP_404` → `CNPJ_NOT_FOUND` only if CNPJá also was 404 or skipped, otherwise when CNPJá failed non-404 and OpenCNPJ 404 → `CNPJ_NOT_FOUND` too (the company is not in the reachable base); other OpenCNPJ failures → `CNPJ_SOURCE_ERROR`. A body without a valid CNPJ/name counts as a failure of that provider.

- [ ] **Step 4: Run** the same command — Expected: PASS.

- [ ] **Step 5: Commit** `feat(prospecting): CNPJ lookup through CNPJá with OpenCNPJ fallback`

### Task 2: Wire lookups into sourceResults

**Files:**
- Modify: `src/server/prospecting/qualification.ts:33-36` (`QualificationAdapters` gains `registry?:RegistryLookup`), `:126-178` (`sourceResults`)
- Modify: `src/server/prospecting/journal.ts:39` (read-only retry)
- Modify: `src/server/research/company.ts:124,160`, `src/server/research/people.ts:99` (forward `registry:deps.registry`; add `registry?` to their deps types)
- Modify: `src/server/prospecting/providers/apify.ts:48,55-59` only if a CNPJ-lookup-only branch becomes dead (keep the CNPJ search branch used by the Gerador)
- Test: `tests/integration/enrichment.test.ts`, `tests/integration/prospecting-pipeline.test.ts`, plus any suite that fakes CNPJ lookups through `apify` (grep `razao_social|tipo_registro|qsa` under `tests/integration`)

**Interfaces:**
- Consumes: `RegistryLookup`, `lookupRegistry` (Task 1).
- Produces: registry attempts in `app.prospecting_attempt` with `provider='cnpj-registry'`, `payload.reservedUnits={}`, result `{kind:'inline',page:{candidates:[candidate],rejected:[]},source:'cnpja'|'opencnpj'}`.

- [ ] **Step 1: Write the failing integration tests** in `tests/integration/enrichment.test.ts` (fake `registry` in deps, no Apify CNPJ fake):
  - `enrichment reads partners from the registry lookup` — attempt row has `provider='cnpj-registry'`; decisors come from the fake's `decisionMakers`.
  - `a registry lookup returning another CNPJ is rejected` — fake returns candidate with a different `cnpj` → company recorded with `CNPJ_IDENTITY_MISMATCH` path as today (assert existing behavior: job does not apply the data).
  - `a prepared registry attempt is retried, not reconciled` — insert a `prepared` attempt with the step's operation id and `provider='cnpj-registry'`, run the job → job state is not `needs_reconciliation` and the attempt ends `completed`.
  - `CNPJ_NOT_FOUND from the lookup records the company and the batch continues` (adapt the existing not-found test to the new fake).

- [ ] **Step 2: Run** `node scripts/test-integration.mjs enrichment` — Expected: FAIL.

- [ ] **Step 3: Implement.** In `sourceResults`, when `module==='registry'`: keep the `registryFirst` cache read and `remember`; call `options.beforeStart?.(operationId)`; `performStep(lease,step,'cnpj-registry',{},()=>(deps.registry??lookupRegistry)(requestedCnpj!,{partners:!!options.partners,signal}).then(r=>({kind:'inline',page:{candidates:[r.candidate],rejected:[]},source:r.provider})),r=>({provider:'cnpj-registry',operationId,units:{},costUsd:null,costKind:'unknown'}))`; then the existing `matchingCandidates`/`noMatch` logic. Do not build the Apify `ctx` for this branch. In `performStep`, `readOnlyRetry` also holds for `provider==='cnpj-registry'` with `prior.provider===provider&&prior.state==='prepared'`.

- [ ] **Step 4: Update the other suites** that faked CNPJ lookups through `apify` to pass a `registry` fake; run each changed suite with `node scripts/test-integration.mjs <suite>` (one at a time) — Expected: PASS.

- [ ] **Step 5: Commit** `feat(prospecting): registry lookups use CNPJá/OpenCNPJ instead of the Apify actor`

### Task 3: Readiness, estimates and copy

**Files:**
- Modify: `src/server/prospecting/config.ts:41,42,47,63,66`
- Modify: `src/modules/prospecting/job-results.tsx:11` (`CNPJ_NOT_FOUND`, `CNPJ_SOURCE_ERROR` labels)
- Modify: `.env.example` (add `CNPJA_API_KEY=` with a one-line comment), `docs/validation/2026-11-12-homologacao-canais-reais.md` (one short section)
- Test: `tests/prospecting-providers.test.ts` (or the unit file that already asserts `estimateUsage`/blockers — grep `Configure a consulta cadastral`)

**Interfaces:**
- Consumes: nothing new.
- Produces: lookups never blocked by missing `APIFY_CNPJ_*`; estimates no longer count Apify runs for lookups.

- [ ] **Step 1: Write the failing unit tests:**
  - `registry module is not blocked without the Apify CNPJ profile` — blockers for a qualification with `modules:['registry']` and no `APIFY_CNPJ_ACTOR` do not contain `'Configure a consulta cadastral.'`.
  - `enrichment needs only the WEB profile` — no `'Configure os perfis CNPJ e WEB da Apify antes de enriquecer.'` when WEB is ready and CNPJ is not; message becomes `'Configure o perfil WEB da Apify antes de enriquecer.'` when WEB is missing.
  - `estimates drop the registry Apify run` — registry module estimate `apifyRuns = n*1` with WEB ready (the CNPJ search), `0` without; companyResearch with `registry` source kind adds no Apify run; enrichment with `companyPeople` counts `WEB?2:0`; enrichment without it counts `2+linkedin` instead of `3+linkedin`.

- [ ] **Step 2: Run** `npm test` — Expected: the new tests FAIL.

- [ ] **Step 3: Implement** the config changes; labels: `CNPJ_NOT_FOUND:'CNPJ não encontrado na CNPJá nem na OpenCNPJ'`, `CNPJ_SOURCE_ERROR:'as bases de CNPJ não responderam'`. Keep `ready.CNPJ` and its blocker for the Gerador CNPJ source.

- [ ] **Step 4: Run** `npm test` and `npm run build` — Expected: all PASS, build OK.

- [ ] **Step 5: Commit** `feat(prospecting): registry lookups need no Apify CNPJ profile`
