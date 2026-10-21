# SDD ledger — plan: docs/superpowers/plans/2026-10-20-prometeus-cadence-04-automation-ai.md

Approved by user: Aprovar o plano e executar, 2026-10-21. Native execution. Base be0fb87, functional base 191330c. No new external calls authorized. Baseline npm test: 92/92 passing.

Ruling: keep the existing checkout on codex/automation-ai-scheduler — approved plan preserves the current directory/preview and native workflow; clean dedicated feature branch verified, no linked worktree or submodule — less directory isolation if another task writes here concurrently; no other implementer dispatched.

Pre-flight shared interfaces:
- T1→T2/T4/T5: PlanningInput/Proposal/Evidence schemas and job insertion helper; old public clients remain ProspectingInput. Consistent.
- T1→T3: ProductProfile/ApprovedProduct/ProductView/ContextState declared first; T3 supplies repository behavior. Consistent.
- T2/T3→T4: bounded conventional JSON/ranking and latest approved context feed frozen checkpoint. Consistent.
- T4→T5/T6: prepare/confirm/get analysis separated from selection confirmation; no domain writes at analysis. Consistent.
- T5/T6→T7: selection signatures and workspace transport used by authenticated wizards, demos separate. Consistent.
- T8→T9/T10: ScheduleV2 local calendar/UTC conversion, first DST occurrence and latest missed window. Consistent.
- T9→T10: claim/heartbeat/ack migration before consumption; LeadSelector callback implemented in T10. Consistent.
- T1/T4→T9/T10: insertReviewedJob after locks, authorization and idempotence; recurring dispatch guards must also run at worker network boundaries. Consistent.
- T1–T10→T11: offline integration/fixture acceptance, one final independent review only; main push not implied. Consistent.

Task 1: in progress (base be0fb87). Brief task-1-brief.md read. Tests must reject fabricated provenance/market counts and enforce lease/RLS before proposal writes.

Task 1 evidence: RED missing contracts/job-store modules observed; GREEN contracts 5/5, storage+legacy confirmation 7/7, pipeline/results/routing regression 26/26; unit suite 97/97, typecheck exit 0. Migration014 applied only _test, LF/checksums preserved. No network provider invoked. Null-list UI link guarded as required by DTO expansion. Fixed test route fixture to include policyRevision/effectiveMode from actual AiRoute interface.

Task 2: in progress (base 3643e40). Brief task-2-brief.md read. RED missing model/ranking modules observed. Focal 17/17 GREEN, typecheck exit0, no external network.
Task 2: Ruling: generatePlanning requires ctx.jobId and a typed PlanningBase — conventional operationId identifies a billable operation, not its parent job; plan omitted how the required proposal jobId arrives — T4 must supply both IDs or generation cannot compile.
Task 2: Ruling: wire audience filters use key/value pairs and optional email subjects use null, normalized before domain validation — strict provider JSON schemas cannot represent arbitrary dynamic object keys plus optional strict properties consistently; persisted contracts remain records/optional fields — actual live provider schema acceptance remains unverified until an authorized pilot.

Task 2 evidence: additional channel/timezone scope regression RED→GREEN; final focal18/18, unit103/103, typecheck0. No provider network. Server pins option IDs and cadence rhythm; invented market counts rejected.

Task 3: in progress (base 02dadb9). Brief read. RED absent merge function/repository observed after correcting the emptyWorkspace fixture import. Merge2/2 GREEN. Product retry concurrency exposed missing workspace_meta row on brand-new workspace: lockWorkspace selected no row, so two transactions reached command_result insertion. Same initialization pattern as confirmJob added before lock; existing concurrent-save test is regression. Existing context commands already enforce explicit draft/approval and server versions, so no duplicate command implementation needed. Migration015 only _test. Unit105/105, typecheck0.

Task 4: in progress (base 3c02f0b). Brief read. RED missing planning/service observed. Initial PG8/8 GREEN; additional scope/diagnosis/quota regressions included in full integration run. Unit105/105, typecheck0.
Task 4: Ruling: keep immutable generated proposal separate from the ranking assessment journal and merge the recommendation on read — publishing content before uncertain ranking permits recovery without mutating its original hash; only completed rank attempts can recommend — downstream selection must use option identity and explicit current review, never auto-apply recommendation.
Task 4: Ruling: worker injection uses planningGenerate, while runPlanning accepts generate — existing QualificationAdapters.generate is a different summary contract and cannot be intersected with planning generation — future worker tests must use the planning-specific name or they exercise the wrong adapter.

Task 4 evidence: final PG12/12, full integration77/77, unit105/105, typecheck0. HTTP origin/workspace/body guards, quota, separate content/rank journal, uncertain reconciliation without lead IDs, and post-diagnosis policy/revocation/expiry checks covered. No actual provider network.

Task 5: in progress (base e90be14). Brief read. RED missing selection service, then RED old workspace schemas reject saved origin metadata; implemented controlled metadata input with server-preserved origin. PG confirmation+commands7/7, unit105/105, typecheck0. Atomic rollback injected by a real workspace-specific PG constraint; constraint removed in finally. Awaiting full integration result before completion.
Task 5: Ruling: legacy audience.confirm remains explicit manual creation with origin.kind=manual; generic automation/cadence edits preserve the server's original provenance and new objects force manual origin — compatibility retains existing editor operations while preventing arbitrary planning provenance from the browser — UI must display manual origin consistently.

User reminder 2026-10-21: Chrome CadenceFlow inbox and REA available as support; reuse existing reverse-engineering evidence and inspect only concrete gaps.

Task 5 evidence: full integration81/81 passed; task-done recorded PG4/4. No outreach, sources, paid inference or runtime activation performed.

Task 6: in progress (base f139bec). Brief read. Applied React best practices and installed Next route/client guides. RED missing planning client, missing context HTTP and missing public sources DTO; GREEN clients6/6, context+planning PG16/16, unit108/108, full integration82/82, typecheck0. Sources and frozen context/product draft baseline now available on planning GET, excluding execution checkpoint/secrets. UI includes cost modal, polling/cancel/history, literal source comparison and selected-field three-way merge; separate product save/approve/archive. Browser acceptance remains T11.
Task 6: Ruling: planning GET returns a bounded baseline and source pack alongside proposal/job — version numbers alone cannot reconstruct the original draft after page navigation, and source IDs alone cannot show citations — DTO grows by bounded excerpts, without credentials/config fingerprints.
Task 6: Ruling: expose useWorkspaceRefresh for API mutations outside generic command transport — products and future selection APIs increase workspace revision, so local snapshot must refresh after their commits before another form saves — refresh failure is surfaced while the committed object remains saved and retries stay idempotent.

Task 6 evidence: full integration82/82, unit108/108, typecheck0. Task-done recorded unit run. No browser claims yet and migrations remain test-only until local acceptance.

Task 7: in progress (base 6443f7f). Brief read. RED absent planning flow and preview merge, RED history filters rejected; GREEN flow/client9/9 and planning pipeline13/13, unit114/114, typecheck0. Authenticated audience/cadence paths now use real planning APIs; demos kept in separate components. Human edits survive retries, input/selection epochs discard stale review responses, and history resume uses GET only. Preview returns the saved selected step to compare against current editor text; no automatic save/send. Full integration run in progress, including selected-step isolation fixture.
Task 7: Ruling: planning GET also exposes its validated original request and the selected saved preview step — resuming a proposal must restore its exact public inputs without regeneration, and preview acceptance must compare against the saved server version rather than an unsaved local copy — DTO grows by bounded existing content; editor conflicts require manual comparison.
Task 7: Ruling: filter automation linkage at checkpoint.automation.id — the plan did not name the persisted linkage key; T9/T10 will write this exact key — scheduler/history would disagree if later code used a different spelling.

Task 7 evidence: full integration84/84, unit114/114, typecheck0. Selected preview step excludes unrelated cadence messages and cannot persist editor content. Task-done recorded unit run. No external inference/browser claims.

Task 8: in progress (base 585ba42). Brief read. RED missing calendar module, GREEN schedule5/5 with exact São Paulo/NY gap/fold/Lord Howe half-hour assertions, monthly clamp/leap year, biweekly/custom/once, exclusive boundaries and exact omitted counts. Unit119/119, typecheck0. Offset candidates and local calendar arithmetic avoid scanning missed minutes. Manual wizard includes anchor/date, local time, timezone, month day and interval, preserves fields, validates before save. Existing incomplete calendars remain readable but do not pass V2 activation validation.
Task 1: complete (commits be0fb87..3643e40, tests: rtk npm run test:integration -- planning-storage prospecting → ℹ duration_ms 13719.1994)
Task 2: complete (commits 3643e40..02dadb9, tests: rtk npm test → ℹ duration_ms 792.2114)
Task 3: complete (commits 02dadb9..3c02f0b, tests: rtk npm run test:integration -- context-products prospecting-pipeline prospecting-results commands → ℹ duration_ms 10706.0766)
Task 4: complete (commits 3c02f0b..e90be14, tests: rtk npm run test:integration -- planning-pipeline → ℹ duration_ms 14303.1734)
Task 5: complete (commits e90be14..f139bec, tests: rtk npm run test:integration -- planning-confirmation → ℹ duration_ms 12396.335)
Task 6: complete (commits f139bec..6443f7f, tests: rtk npm test → ℹ duration_ms 641.1365)
Task 7: complete (commits 6443f7f..585ba42, tests: rtk npm test → ℹ duration_ms 629.3516)
Task 8: complete (commits 585ba42..c1e9f36, tests: rtk npm test → ℹ duration_ms 658.0494)

Task 9: in progress (base c1e9f36). RED missing automation modules, then worker RLS hid SELECT FOR UPDATE before lease context was installed; installed token/fence before locking and verified forged token cannot write. Migration016 applied _test and immutable. Focal5/5, unit119/119, full integration89/89, typecheck0. Manual replay leaves recurring runtime unchanged; pause blocks scheduled dispatch and retains received results; role/config/quota changes tested without network.
Task 9: Ruling: runtime mutation revision is separate from immutable definition revision — pause/activation must invalidate stale review without rewriting the saved definition — clients must use runtime.revision for actions, not definition.revision.
Task 9: Ruling: authority state lives in an additional state.ts module and accepts freshOperationId — shared guards otherwise introduce cycles and a newly prepared hybrid call would invalidate its own connection attestation — callers must exclude only their exact new operation, never unrelated attempts.
Task 9: Ruling: reconciled jobs assigned to a different administrator cannot dispatch under the original automation authorization — actor identity remains bound to the original approval — continuation requires a newly reviewed execution; already received results remain recoverable.

Task 10: in progress (base 9c25d13). RED missing scheduler/client modules, GREEN focal scheduler6/6 and client2/2. Actual worker grants exposed dependency lookup against legacy automation table; use versioned definition/runtime read already granted, without widening access. Corrected fixture seed payload IDs after generic saves correctly rejected malformed test leads. Unit121/121, typecheck0, disabled CLI --once exits without claim. Full integration running.
Task 10: Ruling: scheduled dependencies wait durably on the original occurrence; a manual dependent run rejects atomically with DEPENDENCY_PENDING if the search is not ready — paused manual runs have no recurring scheduler ticket to resume them — user must explicitly review/retry that one-shot after the search completes; no hidden execution or quota reservation is retained.
Task 10: Ruling: additive017 mirrors only an already cancelled job and releases assigned leads only when no journal attempt or result exists — public queued cancellation has no worker lease; granting general runtime writes would weaken016 — an extra narrow SECURITY DEFINER function is granted only to app, with workspace/role/actor and terminal-state checks; conservative attempted work stays excluded.
Task 10 evidence: cancellation regression RED assigned!=released then GREEN via017; focal6/6, client2/2, unit121/121, full PG95/95, typecheck0, diff check0. 501→500+backlog1→next-day1; 150 pending proposals→next-day empty/no job; partial dependent search preserves waiting occurrence ID and excludes unrelated leads. API admin/operator and no public tick checked. No external provider calls; .env.local unchanged and scheduler disabled.

Task 11: in progress (base b359e1c). Full lifecycle RED showed completed qualification job still queued in occurrence because its terminal path bypassed finishJob; fixed sync within that exact leased terminal transaction, GREEN. Manual scope regression RED rejected scope as source filter; fixed metadata split/dedupScope, GREEN. Focal7/7, fullPG96/96 before added scope test, unit121/121, typecheck0, webpack build0 and anonymous54/54. Main/test014–017 migrated twice; all five local runtimes paused, roles not superuser/BYPASSRLS. Browser owner/operator/B and1440/390 performed via existing Chrome MCP with DOM, console and inline screenshots; path writes denied by that MCP. No browser plugin/new tools installed, no new inference.
Task 11: Ruling: full lifecycle harness sets global worker concurrency32 only inside its isolated _test process — previous suites intentionally retain five-minute fenced leases, which otherwise suppress a real worker claim at concurrency1 — parallel test work can occupy up to32 test slots; production .env, budgets and allowlists are unchanged.
Task 11: Ruling: manual recurring dedup uses the chosen list/workspace scope and the existing strong identities (CNPJ/source ID), exposing these facts instead of inactive email/phone checkboxes — existing generation contract does not support per-field dedup policies — users cannot configure weak phone/email-only identity until a separately designed contract supports it; legacy metadata remains readable.
Task 9: complete (commits c1e9f36..9c25d13, tests: rtk npm run test:integration -- automation-authorization → ℹ duration_ms 12275.1724)
Task 10: complete (commits 9c25d13..b359e1c, tests: rtk npm run test:integration -- automation-scheduler → ℹ duration_ms 14981.0886)
