# SDD ledger — plan: docs/superpowers/plans/2026-10-27-prometeus-cadence-06b5-prospecting-journey.md
Base:85009f4
Todo:1 domain/persistence;2 service/invariants;3 HTTP/UI/verification/review.

Ruling: native checkout on dedicated codex/prospecting-journey-06b5 branch based on 85009f4, no new worktree — preserves the user's established execution choice — cost if wrong: less filesystem isolation. Pre-flight: Task1 DTO/stage checkpoint -> Task2 service -> Task3 client use one domain definition. Existing prepareJob and planningReviewState are transaction adapters; reuse rather than nested confirmations. Ruling: durable orchestration tick runs inside existing prospecting worker, claiming the last terminal child with a narrow SQL fence; no new worker/scheduler lane — survives finish/advance crash gap — cost if wrong: up to worker tick latency. Task1 migration/type supports batches (people max100, other jobs max500), retained success and explicitly reviewed retry of missing companies; unknown I/O stays reconciliation, never new attempt. Baseline npm test 342/342.

Task 1: complete (base85009f4, domain RED module absent -> GREEN 3/3; migration087 created, SQL authority will run with real roles in Task2). Reviewed domain limits500 and people batching100, uncertainty excluded from retry. Task1 produces JourneyReview/JourneyView and SQL stage fences consumed by Task2.

Task2 integration RED missing journey service after Docker startup -> GREEN7/7. Initial fixture failures corrected: pg JSON fixtures, real trial enrichment ceiling, no duplicate Apify start usage, SQL viewer UPDATE correctly affects0 rows. Ruling: journey has no productId input, so approved company context is frozen; no product is silently selected — explicit product UX remains existing planning flow — cost if wrong: product-specific runs need that existing selection. Ruling: prepare-cadence reviews analysis cost; confirm-cadence queues one analysis atomically, selection uses existing reviewed planning confirmation and creates only a draft — avoids generation implying publication — cost if wrong: additional explicit selection step. Source/capacity gates retain supported partial outcomes and reconciliation. Controlled100-company fixture proves70 retained/30 retried; real collector revocation proves0 publication.

Task 2: complete (70f97fd..HEAD; focused integration8/8 incl HTTP RED missinghandler->GREEN and direct worker/SQL/role tests; tsc green after fixture types). Ruling: use transaction-owned prospectingReviewState and existing planning selection rather than duplicate schedulers/confirmations — shared quota, billing and authority remain authoritative — cost if wrong: coupling to existing job contracts. No changes needed in scheduler.ts: journey uses existing prospecting loop, not recurring automation authority. HTTP task3 first gate is already covered8/8. Costs and results remain controlled fixtures; no live calls.

Task3 regression found paused queued research skipped to people; RED9test caught the stage classification, fixed terminal cancelled pending cases and coverage across retained batches; GREEN9/9. Full suite fixture worker dispatch hit global concurrency1 from earlier retained test jobs; suite sets existing supported32 concurrency only within its test process, no production limits changed. Runtime was offline after restart; Docker started hidden, migrate087 applied and six-lane supervisor started. RES KB baseline75EV/14ledger/0open passed; reference uses historical L4 evidence, no new authenticated access available.

Browser QA script retries were selector errors, not product success: contacts page title differs and /cadences/new is a canvas without h1. Corrected waits from actual DOM; sequential final browser run uses a frozen file and clears previous response routes. Earlier overlapping CLI invocation4 failed while invocation3 completed; neither is counted as final evidence. No persistent mutations or paid calls.

Ruling: reuse historical reference EV205/206,211/212,213/214,231/232 at1920x855 and prior mobile evidence; the new combined journey states are controlled product contracts, not claimed observations of gated reference behavior — user explicitly selected unobserved states — cost if wrong: visual/flow gaps remain for08A when those states become observable. Ruling: keep draft channel selection available while disconnected, as existing CadenceFlow-aligned wizard explicitly allows; publication remains separately gated by live senders and consent — cost if wrong: users may draft a channel they later need to connect. No new provider/tool/Actor introduced; reused existing infrastructure. Windows Node helpers adapt skill scripts without bash and archive the same ledger contracts.

Task 3: verification complete before final review: npm test346/346; full integration392/392; focused9/9; final webpackbuild and tsc green; git diff check green. Browser final2 frozen sequential run48screens0pageerrors/overflow,0persistentwrites. Extra cadence editor validation is running separately, no scope change. Draft channel planning allowed offline preserves reference wizard behavior. Ruling: keep branch local after this package; prior main push was already fulfilled before06D2 — no new integration/push requested here — cost if wrong: GitHub remains behind until next authorized integration.

Extra UI editor probe: AddStep did render four steps; first check raced React, second getByLabel exact included textarea text in label matching. Fresh accessibility snapshot proved4 Mensagem textboxes; use exact accessible textbox role and wait for fourth. No product code change was needed. Final exact-tree build/tsc passed, 392/392 integration and346/346 unit fresh.

Extra editor viewport assertion initially read layout immediately after resize; passive DOM check at390 showed scrollWidth390/no offenders. Match primary QA's settled resize (250ms) before recording overflow; no CSS change based on a transient measurement. Four steps and edited text survive live polling in the observed page.

Task 3: complete (ebe86e6..review HEAD; focused9/9; unit346/346; integration392/392; finalbuild/types/diffcheck green;57masked screens; own QA closed/restored/revoked; runtime200/sixhealthy). Extra editor9screens confirms4editable steps, poll preserves draft,1controlled draft confirmation and0persistentwrites/sends/calls.

Pre-final review dispatched one fresh astra/high seat for85009f4..2fe8447 with exact ReviewFocus and all rulings. Scope native execution itself remained inline. QAclosed:57screens hashes verified; RES76EV/15rows/0open passes after action vocabulary normalize; planning37docs/26packages/26requirements no cycles/errors; runtime200sixhealthy.

Interrupted initial final review hit usage limit before returning findings. User requested continue; same sole seat resumed (no replacement/re-review). Current tree2fe8447clean, local smoke200sixhealthy and RES/planning checks reconfirmed.

Final review received: 0Critical/8Important/0Minor. Accepted all eight after tracing service/worker/SQL boundaries; one RED-GREEN correction pass begins. Root causes: terminal cancellation rechecks publication authority; stage-level coverage loses per-company/module outcomes; generic ownership grants; proposal link single-shot; SQL lacks frozen-basis fence. Nine Declined-to-judge entries preserved in review report; final rulings below.

Final: Ruling: live Apify/LLM/JEV accuracy, availability and monetary cost remain06IA-H — controlled contracts are not a paid/live pilot — cost if wrong: supplier coverage and estimates may need revision before public sale.
Final: Ruling: connected/paid CadenceFlow states stay unobserved — preserve the user's explicit evidence boundary rather than imply backend/visual parity — cost if wrong: gaps remain for08A when observable.
Final: Ruling: author browser QA covers the57 prior captures and12 post-review recovery captures at1920/390/320; reviewer inspected two only — accept bounded interaction/overflow evidence, not an independent complete pixel audit — cost if wrong: unobserved visual states can differ.
Final: Ruling: cleanup and runtime are rechecked by the executor after deployment locally — reviewer did not rerun them — cost if wrong: runtime health is only a point-in-time observation.
Final: Ruling: executor reruns full suites/build/types after fixes; no second review/re-execution seat — follows the approved single-review correction process — cost if wrong: author verification has less independence.
Final: Ruling: evidence is masked and tracked text is checked, without a forensic claim about all binaries/images/history — this package does not certify all historic artifacts — cost if wrong: a historical leak could need separate remediation.
Final: Ruling: real sending, trial, complete commercial consumption and OpenWA limits keep their existing tests and later live gates —06B5 creates jobs/drafts and never sends — cost if wrong: inherited external integration behavior still needs its own homologation.
Final: Ruling: production load, rollout and restore remain08B — local migration/build checks do not prove public readiness — cost if wrong: deployment/scale gaps may require correction at that gate.
Final: Ruling: no implicit product in journey DTO; existing wizard remains explicit — preserve approved company context without guessing a product — cost if wrong: product-specific generation requires the separate picker.
Final: minor (deferred): inherited06B3 batch detail initially ignores leadId query; visible company selector works. Move residual navigation polish from06B5 to06F; not part of the eight functional/authority fixes.

Correction pass: nine regressions RED in review-red2 (active cancel/context recovery, stopped jobs, repeated recovered batch, partial modules, ownership, proposal, SQL publication); all18 GREEN, then19 including deterministic adapter/HTTP cancellation. Strong-identity duplicate semantic mutation additionally reproduced blocked instead of running (18/19 RED), restored exact source; final full suite running. Migration087a applied locally, build/types green;12 postreview captures at1920/390/320, QA L016 restored/revoked,0writes/sends/calls;69image hashes verified.

Final: fixed Important1 — active pause and context invalidation drain safely RED→GREEN; suite402/402, focused19/19.

Final: fixed Important2 — HTTP cancellation and deterministic provider failure wait for review RED→GREEN; suite402/402, focused19/19.

Final: fixed Important3 — later successful recovery covers cancelled history RED→GREEN; suite402/402, focused19/19.

Final: fixed Important4 — partial people/qualification retry only missing company/modules RED→GREEN; suite402/402, focused19/19.

Final: fixed Important5 — strong identity duplicate in another list does not block eligible contacts RED→GREEN; suite402/402, focused19/19.

Final: fixed Important6 — real SQL operator cannot change actor; admin can pause RED→GREEN; suite402/402, focused19/19.

Final: fixed Important7 — failed/cancelled/context-invalid proposals replace atomically; obsolete choice rejected; one linked draft RED→GREEN; suite402/402, focused19/19.

Final: fixed Important8 — direct SQL publication rejects changed context/central policy; technical receipt retained RED→GREEN; suite402/402, focused19/19.

Final verification:346/346 unit;402/402 full integration;19/19focused;webpackbuild/types/diffcheck;69hashedmaskedcaptures including12postreview;QA L015/L016restored/ownsessionrevoked;runtime200sixhealthy. EightImportant fixed in one pass,0Critical,0newMinor; inherited navigation minor06B3→06F. Final review clean after verified fixes; keep local branch, next06IA-H.
