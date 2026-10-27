# 06IA Platform AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution, one final fresh-context review.

**Goal:** Platform-managed AI infrastructure with tenant-private context and versioned task instructions.
**Architecture:** Protected platform control workspace reuses policy/probes/OAuth. Tenant jobs inherit infrastructure but retain their own authorization, context, usage and outputs. Central skill contracts are pure bounded prompt data, never tenant-provided executable skills.
**Tech Stack:** Existing Next.js/React/PostgreSQL/TypeScript/node:test and Playwright.
**Spec:** docs/superpowers/specs/2026-10-26-prometeus-cadence-06ia-design.md

## Global Constraints

- Base18fcc4a, branch codex/platform-ai-06ia; current checkout/runtime reused under native autonomous preference.
- No new dependency/provider/key, paid live call, external message or reference write.
- PLATFORM_AI_WORKSPACE_ID and PLATFORM_AI_ADMIN_USER_IDS designate existing verified administrative identities only; no signup self-elevation.
- Public hosted OAuth restrictions remain. No100% private backend/visual/accuracy claims.
- Setup-agent unavailable after tool discovery; reuse existing runtime/instructions rather than installing tools.

## Review Focus

1. A customer owner uses direct old APIs/SQL or forged identity flags to administer global infrastructure.
2. Global policy/credential revocation during provider I/O publishes stale results or silently changes provider on retry.
3. Shared credentials accidentally share private company context, cache/person data or budget across tenants.
4. A source, custom criterion or company profile injects provider/tool/permission instructions into central skills.
5. A central uncertain probe or a tenant's operation corrupts the shared health attestation and JEV authorization.

### Task1: Protected platform authority and shared policy
**Files:** db/migrations/082-platform-ai.sql; scripts/provision-platform-ai.mjs; server/prospecting/ai/{platform,settings,connection,config}.ts; integration/platform-ai.test.ts and shared fixtures.
**Interfaces:** platformAiWorkspace():string|null; isPlatformAiAdmin(c):Promise<boolean>; requireAiAdmin(c); readAiPolicy(c):Promise<AiPolicy>. SQL narrow platform policy/check readers with current membership and configured scope.
- [ ] RED integration: customer owner denied without provisioning; designated admin saves once; other customer sees shared effective policy but cannot save/forge SQL; admin revocation wins. Run `rtk proxy node scripts/test-integration.mjs platform-ai` → FAIL missing contract.
- [ ] Add protected control record/provisioning, narrow readers, policy SQL guards and shared credential namespace. Adapt test setups to explicitly provision a platform admin rather than grant it via signup. Same command → PASS.
- [ ] Pin uncertain central probe vs tenant operation isolation and changed global route; run relevant ai-settings/probe/routing/OAuth suites → PASS. Commit Task1.

### Task2: Versioned adaptive instructions and measurable contracts
**Files:** domain/ai-skills.ts; server/prospecting/ai/{output,decisors,jev,json,config}.ts; server/planning/prompts.ts; pipeline context/fingerprint callers; tests/ai-skills*.test.ts and integration/platform-ai.test.ts.
**Interfaces:** AI_SKILLS_VERSION; buildAiSkill(task,{company,product,request,language,evidence}): bounded JSON-ready trusted instructions plus untrusted data, reused by actual provider requests.
- [ ] RED units: current dental/Rio request preserved separately from another company's ICP; only approved allowed company fields, bounded inputs, source instructions remain data, no provider selection; versions differ by task; JEV evaluation role distinct. `rtk proxy node --experimental-strip-types --test tests/ai-skills.test.ts` → FAIL.
- [ ] Wire the skill builder to actual planning/qualification/decisor/JEV requests and cache/fingerprints; no dynamic executable skill/tools. Same tests → PASS.
- [ ] Controlled integration proves two tenant jobs use central model and distinct frozen context/request, changed context/global version rejects stale action, quotas remain scoped. Execute focused suites → PASS. Commit Task2.

### Task3: Administrative UI and customer journey
**Files:** server/workspaces/service.ts, client/workspace-provider.tsx, modules/settings/{settings-layout,ai,reference-settings}.tsx, prospecting/planning provider links, admin capability read.
**Interfaces:** optional identity platformAiAdmin boolean computed by server, no client authorization reliance. GET/POST policy/probe/OAuth/diagnostic guard remains authoritative.
- [ ] RED API test: all administrative endpoints reject ordinary tenant owners; response contains no connection/account/keys and customer prepare stays usable via global route. Run focused platform-ai suite → FAIL missing guard.
- [ ] Remove provider menu/config links from customer flows, guard direct page, label platform-wide scope and keep admin OAuth/probe controls; company-context UI remains editable per customer. Focused tests → PASS.
- [ ] Browser: admin and customer identities,1920/390/320px, menu/direct URL/context/preview/cancel/loading/error/dirty forms; no paid confirm. Compare customer context to existing reference at same viewport. Commit Task3.

### Task4: Rollout, verification and closure
**Files:** docs/validation/06-platform-ai.md, evidence/06ia, roadmap and execution ledger; local ignored bootstrap helpers only for existing verified operator.
- [ ] Verify explicit existing admin/bootstrap scope, migrate and provision local control without rotating keys or disconnecting channels. Verify no customer inherits admin, local OAuth preserved. Stop/restart hidden services when needed; main migration immutable after rollout.
- [ ] Full unit/integration, production build then tsc, diff/secret audit; QA cleanup, healthy3210 and six lanes. Expected all PASS.
- [ ] One independent whole-branch review on most capable model per executing-plans; fix Important/Critical once using RED→GREEN and green suite; ledger minors/rulings.
- [ ] Document real versus controlled evidence, admin setup instructions if manual production bootstrap needed, unknown accuracy/hosted OAuth, next06D.1; commit and archive only own ledger.

## Self-review

Authority→route→job→prompt→result interfaces have one shared configuration namespace and tenant context. Review focus1/5 pinned in Task1/3;2/3/4 in Task2 plus existing post-call publication tests. UI flag is advisory only. Bootstrap authority never comes from tenant payload. Scope excludes new provider/tool installation and live model accuracy certification. Native execution method and autonomy already supplied; no new confirmation round.
