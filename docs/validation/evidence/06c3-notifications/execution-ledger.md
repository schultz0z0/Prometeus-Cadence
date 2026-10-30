# SDD ledger — plan: docs/superpowers/plans/2026-10-27-prometeus-cadence-06c3-notifications.md
Base:87dab50
Todo:1 domain/persistence;2 service/worker;3 HTTP/UI/QA/final review.
Ruling: dedicated native branch without new worktree, preserving established preference — cost if wrong: less filesystem isolation.
Pre-flight: Task1 DTOs/SQL -> Task2 scoped services/worker -> Task3 HTTP/UI. Existing operation_event is the committed source, existing runtime supervisor owns notification lane. No second business queue. Summary scheduling uses existing DST wall-time helpers.
Ruling: existing planned tools reused; setup-agent not exposed in tool inventory, no new tool/skill/plugin recommended or installed — cost if wrong: unavailable catalog could contain a better helper.

Task1 domain RED missing module -> GREEN5/5; verified-destination/quiet/DST/week/sound/strict-input rules. Ruling: no unverified WhatsApp account destination is promoted from registration phone — pending verification and provider capability are explicit — cost if wrong: external WhatsApp alerts remain deferred until a verified destination transport exists. SQL projection schema introduced; worker functions belong Task2.

Task 1: complete (87dab50..HEAD; domain5/5 RED-GREEN, full unit360/360 and types passed). DTOs/current-user RLS and narrow save/read functions. Operational migration not applied; service tests use fresh isolated databases next.

Task2 service RED missing module -> GREEN7/7 with real PostgreSQL roles. Quiet/current preferences/membership/channel revocation/unverified email/uncertain I/O/per-user unread/summary isolation verified. Source revocation reproducer1unexpectedsend -> GREEN0; invalid SQL quiet timezone RED missing rejection -> GREEN. Test signup429 was fixture rate-limit cleanup, not a product failure; global queue tests count only their own identity. Worker claim uses database clock to retain microsecond due precision. Runtime config RED undefined -> GREEN6/6.

Task 2: complete (f1f59cd..HEAD; focused7/7, domain/runtime6/6 and types passed). Narrow worker-only SQL functions, event projection/checkpoints, per-user summaries, no blind retry after uncertain I/O. Admin-configured dedicated SMTP; disabled without explicit deployment capability. API/UI verification next.

Task3 HTTP RED missing handler -> GREEN8/8 including401/403/409/422, origin, workspace switch and preference conflicts. Ruling: summary contract supports one daily or weekly frequency; monthly remains explicitly unavailable in existing Account layout — cost if wrong: simultaneous/monthly schedules require a future contract extension. Ruling: existing source events support replies/jobs/send failures/integration attention; SDR meeting/handoff/approval/qualification switches remain unavailable rather than invent events — cost if wrong: those notices await their owning module.

Task3 production compiler rejected exporting optional-id handler directly as Next route because its second argument is context, not id. Corrected route wrapper per installed Next16 guide; build itself is RED->GREEN verification gate. No change to service authority.

Visual reference reopened read-only via existing dedicated saved profile; REA target observation ev_9f86d3d8c29179f12a8541f924b74d72f3634d3f0cdb2ebde3c91a841b39a814. Six masked reference captures, no reference writes. Actual reference additionally has first-reply-only/agent-inclusive and business-hours discard behavior; these were absent from approved DTO. Ruling: preserve approved quiet deferral and current each-reply contract, record these observed parity gaps for08A/SDR rather than silently replace behavior — cost if wrong: those states are not exact reference parity yet. Scoped header/weight/switch/listen/destination geometry refinements applied. Initial QA locator getByLabel(exact) included select option text; fresh snapshot proves combobox available, use actual role locator.

Read-only reference confirms six controls/conditional states beyond initial historical snapshot. No reference toggles or feed opened (opening can mark read). Local QA L022 archives own exact preferences/schedule/inbox and will restore them; planned L023 creates only35 synthetic private notification rows for UI pagination, never a provider receipt or delivery. Full pre-review suite440/440, unit361/361.

Ruling: external opt-ins default off in the new per-user service; legacy workspace snapshot flags were preparation placeholders, not delivery authorization — cost if wrong: users must explicitly save their external preference again. Exact lost-response preference replay RED409 -> GREEN same revision/unchanged schedule via forward090b, preserving already-applied migration checksums. Account QA checked before asynchronous load; fresh snapshot showed weekly correctly checked, so wait for enabled controls before asserting.

QA GREEN:9route/viewport pairs plus9empty dialogs, persisted settings/shared Account summary, 17s draft polling and actual aborted network recovery;35synthetic items load30+5, opening preserves35unread and one read yields34. Paired screenshots exposed cramped mobile sound row; scoped wrapping fix before final UI recheck. No provider calls.

Task 3: complete (6824a3a..HEAD; HTTP9/9, full441/441 integration, unit361/361, production build/post-build types/diff-check green;34masked captures/21route-viewports/12dialogs; actual persisted preferences and network recovery;35synthetic UI rows removed; real operator history read-only caught up with0newdeliveries). QA preferences/schedule/inbox/domain data restored, sessions revoked, own browsers closed. Whole-branch review required before roadmap advance. Established keep-native-branch preference; no merge/push/deploy in this turn.

Final review dispatched exactly once to fresh GPT-6 Astra/high on87dab50..7535012 per executing-plans. Read-only; no task-level reviewers. Runtime smoke after QA closure: HTTP200, seven lanes alive with0failures; planning validator37docs/26packages, KB79EV/23ledgerrows/0open both green.

Final reviewer interim: Important direct-SQL preferences may omit payload.expectedRevision; summary worker derives revision from payload and NaN aborts shared tick. Will fix in the single consolidated pass after complete findings, with real SQL reproducer. Reviewer still tracing channel revocation on reply/failure and repeated outage events.

Final review complete: no Critical; seven Important retained by actual impact (SQL-derived revision/shared tick poison, reply/failure source revocation, recurring outage identity, pagination boundary on polling, revoked pagination cache, email alert destination, Account stale-revision recovery). One Minor deferred to08A: weekly isolation fixture uses invalid/non-window timestamp, so positive-neighbor proof is absent; do not fold that minor into this fix pass. Begin ONE consolidated RED-GREEN pass, then full suite; no rereview.

Final: minor (deferred): weekly isolation fixture uses a non-ISO timestamp outside a guaranteed closed week; eligible positive-neighbor proof remains absent. Owner08A.
Final: Ruling: public SMTP deliverability and provider TLS handshake remain an external pilot gate; local adapter capture is not public delivery proof — no new external dispatch authorized — cost if wrong: provider-specific delivery defects may remain until pilot.
Final: Ruling: WhatsApp alert transport and destination proof remain pending, with no registration-phone promotion — owning verified capability absent — cost if wrong: opted-in WhatsApp alerts cannot deliver yet.
Final: Ruling: SDR event producers remain owned by later SDR packages and their switches unavailable — no fabricated events — cost if wrong: no SDR notices until that module.
Final: Ruling: one daily OR weekly summary stands; monthly and simultaneous schedules remain unavailable — approved contract — cost if wrong: users cannot combine schedules yet.
Final: Ruling: first-reply-only and agent-inclusive options remain recorded parity gaps for08A/SDR — approved each-reply contract retained — cost if wrong: these reference states differ.
Final: Ruling: quiet deferral stands instead of reference business-hours discard — approved delivery semantics preserve pending notices — cost if wrong: users receive deferred notices they might expect discarded.
Final: Ruling: legacy preparation flags are not external opt-in authorization — explicit new per-user save required — cost if wrong: users must opt in again.
Final: Ruling: no100percent visual parity claim from34screens; desktop/mobile matrix covers only observed states — blocked reference states remain unobserved — cost if wrong: visual differences remain until08A.
Final: Ruling: uncertain external transmission remains non-retryable automatically — avoid duplicates without authoritative receipt reconciliation — cost if wrong: an unaccepted uncertain notice may remain unsent.

Final: fixed SQL payload revision / shared summary poison — direct SQL rejects missing or mismatched payload revision; summary uses authoritative revision and isolates malformed legacy rows RED→GREEN (six pre-fix failures9/15, including NaN22P02; focused15/15), suite447/447 integration and363/363 unit.

Final: fixed reply/failure source revocation — lead_reply and delivery_failed delivery cancelled after originating connection disconnect RED→GREEN (pre-fix1send vs0 for each; fixed0), suite447/447 integration and363/363 unit.

Final: fixed recurring outage identity — second outage after recovery; repeated ticks and revisions deduplicate RED→GREEN (pre-fix1item vs2; fixed2), suite447/447 integration and363/363 unit.

Final: fixed polling pagination boundary — loaded window35 + new head1 preserves36 RED→GREEN (immutable7535012 expression returned35 vs36; current unit and browser36), suite447/447 integration and363/363 unit.

Final: fixed revoked paginated cache — HTTP403 suppresses every loaded page RED→GREEN (pre-fix browser retained5older items; fixed0), suite447/447 integration and363/363 unit.

Final: fixed email connection destination — email attention points to email settings; WhatsApp to its settings RED→GREEN (pre-fix two WhatsApp paths; fixed one per channel), suite447/447 integration and363/363 unit.

Final: fixed Account stale preference recovery — explicit current-revision rebase retains summary intent and concurrent badge RED→GREEN (pre-fix missing recovery control; fixed desktop/mobile save after explicit review), suite447/447 integration and363/363 unit.

Final acceptance:06C.3 completed-local-controlled on2026-10-30. One independent whole-branch review, seven Important fixed in ONE pass; no rereview.48masked screenshots,30route/viewport checks,15dialogs and2mobile conflict states. L024restored/L025removed,36owned synthetic UI rows removed, exact preferences/schedule/inbox/workspace restored, QA sessions revoked and own browser closed. HTTP200/seven lanes alive/0failures. External sends remain disabled; no100percent parity/public-delivery claim. Next06E.1. Keep native branch; no merge/push/deploy. Archive before removing only this plan scope.

Archive: immutable reviewed diff stored losslessly as gzip with uncompressed SHA256 and round-trip byte comparison; plain context lines carry intentional patch spaces, so compressed storage preserves them without repository whitespace-check failures.
