# SDD ledger — plan: docs/superpowers/plans/2026-10-20-prometeus-cadence-03-prospecting.md

User approved written spec, plan and native execution on 20/10/2026. Implementation BASE a97d784; published milestones01–02 main base178cbf9. Current branch codex/prospecting, existing checkout requested/preserved for local preview.

Ruling: reuse existing in-place feature branch and preview path as explicitly described in the approved plan and prior execution — no work on main or second preview location — cost: branch isolation rather than a second checkout.
Ruling: use Windows-compatible manual ledger/brief extraction instead of POSIX sdd helpers, as in milestone02 — equivalent durable task record — cost: manual bookkeeping.

Pre-flight T1→T2: job DTO, usage ledger and lease guard created T1; ingestion must not depend on T3 claim. Plan corrected before approval.
Pre-flight T1/T2→T3: worker role absent from existing init volume; provision on migration runner before 008, leave applied001–005 unchanged. worker transaction shares context discipline and RLS.
Pre-flight T3→T4: source adapters return normalized candidates and evidence; JEV Decisions API is distinct from text generation. Provider capabilities unavailable until configured, no silent fixture fallback.
Pre-flight T2/T3/T4→T5: receipt+checkpoint+usage commit together, external network outside SQL transaction, lease fencing checked after response. Cancellation/revocation may clean up own remote run without returning old data.
Pre-flight T5→T6: client awaits confirmation/apply, stable requestId and shared Promise; no domain snapshot refresh on every progress poll.
Pre-flight T4/T5/T6→T7: tests cannot claim measured provider accuracy or paid service success from fixtures. CLI local opt-in is separate from hosted runtime.

T1 RED observed: missing schemas/service modules in unit and integration tests. GREEN: npm test 45/45; integration 23/23 including concurrent confirmation, cross-workspace denial, review invalidation, budget rollback and cancellation release; typecheck exit0. Migration006 applied additively to test and main.
Ruling: add PROSPECTING_GLOBAL_DAILY_UNITS alongside workspace limits — shared credentials require a global dimensional budget in the approved spec — cost: one additional server configuration variable.
Ruling: settleUsage accepts (client, jobId, usage), with operationId inside usage — binds accounting to the same job as ingestion — cost: consumers must use this exact signature.
Ruling: reuse data.write for prepare/confirm/apply without changing permissions.ts — existing operator permissions already match the approved role policy — cost: no independent prospecting permission toggle.

Tasks T1–T7: complete; final results below.
Task 1: complete (commits a97d784..a5f36c5; tests: npm test 45/45, test:integration 23/23, typecheck exit0).
Task 2: started; BASE a5f36c5; brief read. Identity writes serialize on workspace_meta before job locks, matching existing command ordering.
T2 RED: missing normalization/ingestion modules observed. GREEN: unit47/47, integration27/27, typecheck exit0; scopes/workspace isolation/replay/rollback/revocation/fencing/manual identity verified.
Ruling: maintain manual registry identity through a database trigger rather than commands.ts — covers every existing CRUD/import path atomically without accepting private sourceRef fields — cost: identity maintenance lives in SQL and list moves drop source identity until a later provider receipt.
T2 regression diagnosis: full suite hit signup429 from shared test rateLimit rows; reuse existing resetRateLimits before each new prospecting test, only on _test, preserving production throttling. Full suite then27/27.
Task 2: complete (commits a5f36c5..289de6a; tests: npm test47/47, integration27/27, typecheck exit0).
Task 3: started; BASE289de6a; brief read.
T3 RED: missing adapter and lease modules; organic pagination test also reproduced dropped results before correction. GREEN52/52 unit,28/28 integration,typecheck0;008 applied/repeated on both databases. Worker cannot read auth or claim through app role; expired heartbeat/fence rejected.
Ruling: reject unsupported CNPJ/Apollo filters at review instead of silently approximating them — verified actor contract does not implement every reference UI filter — cost: reduced live filtering until additional provider contracts are verified. CNPJ requires a CNAE or registry lookup; term is only the audience label.
Ruling: provider fixtures remain inline in focused tests rather than separate fixture files — small synthetic bodies are fully visible beside their assertions — cost: large future fixtures should be extracted.
Task 3: complete (commits289de6a..cb43d68; tests52/52unit,28/28integration,typecheck0).
Task 4: started; brief read; next RED extraction/AI contracts.
T4 BASEcb43d68. RED missing extraction/AI modules, then SQL slot ambiguity reproduced by cross-workspace test. GREEN60/60 unit, worker2/2 integration,typecheck0. parse5/ipaddr pinned; npm audit0. Native requests pin approved IP and bound DNS/cancel/redirect/decoded bytes. JEV exact1.13 Decisions rechecked official API; confidence remains separate from measured accuracy. Codex no OAuth read/copy, tool flags/CLI help/features inspected without inference.
Ruling: add migrations009(cache/global Codex slot) and010(additive slot-column qualification fix) — cross-process serialization cannot live in memory; applied checksums preserved — cost: two additional migrations beyond T3's008.
Ruling: restrict live Codex execution to CLI0.163.0-alpha.10.2 whose flags were verified — an updated executable must be revalidated before tool suppression is trusted — cost: upgrades temporarily disable local generation.
Ruling: deep extraction requests home,/sobre,/contato, capped at three pages — deterministic bounded company pages avoid arbitrary crawls — cost: differently named content pages may not be discovered.
Task 4: complete (commitscb43d68..067ea6e; tests60/60unit,worker2/2,typecheck0).
Task 5: started BASE067ea6e; brief read. RED missing steps/application/reconciliation. GREEN60/60unit,36/36integration,typecheck0. Pipeline covers durable page recovery, uncertain POST, cancellation during start, expired fencing, revoked creator cleanup, human-field conflict, context conflict, idempotent apply, omitted summary making zero generator calls.
Ruling: retain60-second leases with10-second heartbeats instead of the later plan paragraph's30/10 — compatible with T3's verified60-second contract and long Codex steps; fence and DB timestamp still gate every commit — cost: crashed-worker recovery can take up to60seconds.
Ruling: add011 cleanup-ticket functions for revoked creators — cleanup must abort already-started remote runs without granting worker/customer data access under a removed membership — cost: a narrow privileged metadata-only cleanup path to audit.
Ruling: journal.ts holds shared durable step helpers alongside the named T5 files — generation and qualification need the same intent/fencing/accounting contract — cost: one additional internal module.
Ruling: definitive module failures are saved as failed results and other selected modules can continue; uncertain billable operations pause for reconciliation — avoids converting provider errors into negative qualification or blind retry — cost: an administrator must resolve ambiguous provider calls.
Task 5: complete (commits067ea6e..7ea2c69; tests60/60unit,36/36integration,typecheck0; worker --once starts/exits cleanly with external execution disabled).
Task 6: started BASE7ea2c69; brief read; Next installed page/server-client docs read. RED missing prospecting-client; GREEN client2/2, fullunit62/62,integration36/36,typecheck0. Browser/build checks in progress.
Ruling: keep separate server generator/qualifier components selected by the authenticated provider — preserves the approved explicit demo without a silent fallback — cost: two small wrapper components and distinct forms.
Ruling: live CNPJ form shows only verified CNAE/city/UF filters rather than the demo's broader controls — unsupported predicates must not silently change the target audience — cost: narrower live filtering for this milestone.
Ruling: the list link after confirmed prospecting uses a full navigation; progress polling never refreshes the global repository — retains milestone02's stale-form protection and loads fresh rows only when requested — cost: other open forms need an explicit refresh before editing new data.
Build diagnosis: Turbopack compile stalled with low CPU and no progress; stopped only verified own next-build PID5396 and reran installed supported --webpack. No unrelated Node processes touched.
T6 browser: production webpack build passed (all routes); runtime3210 session90887. Authenticated generator: blocked credential review, disabled confirm; mobile390px inspected. Dedicated QA fixture workspace21e3c8e0-1bfc-4e12-83a3-a69fd4e32c70 with synthetic-only lead/jobs, private seed harness no HTTP fallback. UI RESULT_CONFLICT kept modal open and preserved human email; after restoring fixture base, same request applied once; queued cancellation and partial states verified. Console clean. Screenshot capture returned inline; file output rejected by Chrome MCP workspace-root policy, both absolute/relative; do not bypass. Final fixture badge added after this build, requires final rebuild.
Ruling: seed dedicated local QA-account workspace for browser fixtures with a private CLI harness and explicit synthetic labels — tests cannot prove live provider behavior and no production API fallback is introduced — cost: synthetic QA rows remain in their separate workspace.
Ruling: use supported webpack production build for acceptance after Turbopack stalled — verified installed Next option, successful complete build — cost: different bundler from default dev build; default build command will explicitly use webpack for reproducibility.
Task 6: complete (commits7ea2c69..bdf1039; tests62/62unit,36/36integration,typecheck0,production webpack build0, browser review/apply/conflict/cancel/partial/mobile verified).
Task 7: started; brief read. Evaluation and opt-in smoke harness next.
T7 BASEbdf1039. RED missing evaluation module observed; GREENunit64/64,integration36/36,typecheck0,build webpack0,smoke48/48. Provider smoke without flags SKIPPED. Docker exclusive DB restart healthy; worker --once0. QA data reloaded after restart; external integrations remain disabled.
Ruling: real-provider smoke requires server QA allowlist and one call/record unit; data-source smoke queues the normal job and reports QUEUED, never success — paid external acceptance requires credentials/explicit limit and the standard worker — cost: a separate worker completion check is needed for data-source smokes.
Ruling: save captured screenshots inline only after Chrome MCP denied file output — respect tool workspace-root enforcement — cost: repository has textual QA evidence but no new PNG files.
Task 7: complete (commitsbdf1039..4874f37; tests64/64unit,36/36integration,typecheck0,build0,smoke48/48). Whole-branch independent review completed; results below.


Final review: independent fresh-context reviewer /root/prospecting_branch_review, gpt-6-astra high. Reviewed a97d784..4874f375e03cced63e4dbf234b712a7b2162f128. Zero Critical, eight Important, one Minor. Regraded by user-visible effect: all eight Important accepted, Minor remains deferred. One correction pass, no re-review.
Final: fixed exhausted-checkpoint recovery — recovery after the last receipt finishes without reading page zero again (Maps and Apollo) RED→GREEN, suite71/71 unit +39/39 integration.
Final: fixed Apollo unstable pagination — Apollo keeps per_page stable for a150-record limit and accepts only the remaining rows RED→GREEN, suite71/71 +39/39.
Final: fixed incomplete reconciliation — uncertain website qualification reconciles the specific run; unavailable inference settles without a second call; operator denied RED→GREEN, suite71/71 +39/39.
Final: fixed cancellation releasing uncertain usage — uncertain website qualification retains reservation on cancel RED→GREEN, suite71/71 +39/39.
Final: fixed unusable successful POST responses — missing run ID, empty/oversized POST body and invalid successful JEV schema remain uncertain RED→GREEN, suite71/71 +39/39.
Final: fixed confidence without evidence quality — high confidence with quality0/coverage0 stays pending RED→GREEN, suite71/71 +39/39.
Final: fixed apex/www canonical evidence loss — canonical www redirect retains evidence under existing SSRF validation RED→GREEN, suite71/71 +39/39.
Final: fixed lost factual provenance — Apify mapped Web facts/snippet/source retained; website proposal references persisted evidence RED→GREEN, suite71/71 +39/39.
Final: minor (deferred): execution history lacks kind/state/source filters; refresh and pagination work, but finding jobs in a large history takes more effort.
Final: Ruling: use quality>=0.5 and coverage>=1 as conservative evidence gates with missing quality abstaining — high confidence must not override absent evidence; these are not empirical accuracy thresholds — cost: some usable candidates can remain pending until calibration with human labels.
Final: Ruling: live provider eligibility, balances, pricing and compatibility remain unverified — no app credentials or purchased balance supplied; adapters and failure contracts tested with bounded fixtures — cost: real accounts may need additional setup or contract adjustments before successful live execution.
Final: Ruling: empirical JEV accuracy and threshold calibration remain pending — use an explicit100-case human-labelled pilot with separate adjustment/test companies rather than generated gold — cost: classification quality for the target audience is not established yet.
Final: Ruling: actual Codex inference/tool suppression is not claimed as tested — installed version/help/argv/environment reviewed, local inference remains opt-in and version-pinned — cost: a real local smoke may reveal CLI/provider compatibility or isolation limitations.
Final: Ruling: acceptance is loopback local operation, not public deployment or alternative bindings — matches approved Docker/local milestone — cost: public hosting needs separate hardening and acceptance.
Final: Ruling: cancellation never promises provider refunds — retain unknown usage until explicit reconciliation and ask the operator to check the provider — cost: remote billing or a live run can persist until the provider/operator resolves it.
Final: Ruling: national CNPJ completeness, paid people enrichment and CRM coverage are outside this milestone — expose only verified narrow organization/source contracts — cost: some desired audiences and contact details are unavailable.
Final: Ruling: recurring scheduler, messaging channels, production cadences and billing remain later milestones — preserve paused/draft states and make no sends — cost: this delivery alone is not an operational outbound subscription SaaS.
Final: Ruling: throughput and long-term ledger performance are not benchmarked — bounded batches, one workspace operation and indexed PostgreSQL provide local correctness acceptance — cost: production load may require tuning or additional capacity.
Final: Ruling: repository screenshot files remain absent after MCP policy refusal — inline captures and textual browser evidence are preserved without bypass — cost: visual comparisons lack committed PNG artifacts.
Final: Ruling: webpack acceptance does not establish bundler performance parity — complete successful supported build replaces stalled Turbopack on this machine — cost: deployment/dev performance may differ.

Final verification: npm test71/71; npm run test:integration39/39; npm run typecheck0; npm run build --webpack0; node scripts/smoke-routes.mjs48/48; provider smoke without flags SKIPPED. New reconciliation UI checked desktop1440/mobile390: operation selection, initially disabled confirmation, run ID requirement and unavailable-result explanation; modal cancelled without provider call; console no error/warn. Prior browser application/conflict/cancellation and cross-workspace denial remain recorded above. Production preview on127.0.0.1:3210. No external inference/search or credit purchase.

QA fixtures are synthetic and remain only in workspace21e3c8e0-1bfc-4e12-83a3-a69fd4e32c70, list6a2345e4-a8f8-4892-905f-1249460fa991. Private seed harness now reports IDs on stdout without depending on deleted scratch. Existing uncertain fixture received a synthetic attempt and reserved unit for modal inspection. No provider execution enabled.
Final review gate: all accepted Important findings addressed by the single correction pass; Minor explicitly deferred. Fixes ready to commit. Branch integration decision pending user; main remains178cbf9.
