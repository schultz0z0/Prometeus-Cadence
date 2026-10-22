# Decisões de implementação05B

Registro integral das decisões da execução nativa, incluindo justificativas, custos e decisões finais sobre os itens reservados pelo revisor. Nenhum achado Minor foi reportado.

- Ruling: Reuse clean feature checkout codex/email-05b-design in the primary workspace instead of creating another checkout — already dedicated to the approved delivery, user requested native execution and shared installed runtime — cost if wrong: working preview may see new code before build; main stays unchanged until integration.

- Task 1: Ruling: Keep PublicationSnapshot as legacy export and add VersionedPublicationSnapshot union until T7 switches consumers — preserves type safety and runnable current UI during staged delivery — cost if wrong: union migration must not be forgotten in T7.

- Task 1: Ruling: Unknown WhatsApp provider rejection is tested/changed with T2 channel storage filtering — connections.ts is server-only and its factory consumers are modified in T2 — cost if wrong: no email provider is yet persisted before that gate.

- Task 2: Ruling: Stage conversation uniqueness replacement in T6 with all SQL materialization/ingress consumers, not T2 — ON CONFLICT(workspace,sender,identity) in 05A requires its unique constraint until those functions are upgraded — cost if wrong: email threading must remain unavailable until T6, no change to legacy behavior now.

- Task 2: Ruling: MailConfig belongs in mail/contracts.ts before adapter contracts arrive in T4 — T2 repository produces it without depending on a future adapter module — cost if wrong: adapter module will reexport the same type rather than define a duplicate.

- Task 3: Ruling: Preserve bounded classification headers and an 8KiB delivery-status part in normalized mail — T9 requires actual MIME bounce evidence, which MailParser merges into ordinary text by default — cost if wrong: parser metadata contract gains optional server evidence fields; inbox must not expose arbitrary headers.

- Task 3: Ruling: Test real SMTP/IMAP sockets with adapters in T5; T3 verifies public DNS pin options and MIME independently — no adapter exists until T5 — cost if wrong: socket library integration must be covered before connector acceptance.

- Task 4: Ruling: Add additive migration038-email-oauth.sql for protected one-use OAuth and refresh CAS functions — T2 intentionally did not grant direct access to token-attempt storage — cost if wrong: subsequent uncreated migration numbers must shift by one, without editing037/038.

- Task 4: Ruling: withGmailAccess requires a Principal in server-only dependencies until T6/T8 add leased worker access — mailboxId alone must not grant credentials — cost if wrong: worker integration must use explicit lease proof rather than bypass tenancy.

- Task 4: Ruling: OAuth builder and bounded HTTP adapter have separate protocol modules importable by unit tests, orchestration remains server-only — permits real protocol tests without database globals or disabling server-only in the app — cost if wrong: no secret settings module may be imported by a client component.

- Task 5: Ruling: Any transport failure without a definite SMTP response remains uncertain, including ECONNECTION with command CONN — real fixture proved the library reports that same command after DATA was received — cost if wrong: conservative false uncertainties require reconciliation instead of an unsafe retry.

- Task 6: Ruling: Expired history or UIDVALIDITY recovery scans the observable time range with five-minute overlap but retains sync_gap until explicit administrator review — removed messages cannot be proven recovered from current mailbox contents — cost if wrong: extra manual recovery acknowledgement, safer than resuming campaigns over an unknown response gap. T10/T11 must expose the reviewed acknowledgement.

- Task 6: Ruling: Use additive040/041 fixes after039 was exercised: initial INSERT next_at must use tick p_now; readiness variable must not collide with sender.ready — preserving applied migration bytes — cost if wrong: larger migration chain, with upgrade tests guarding it. Fixture manual due time moved one second back to avoid microsecond server/client rounding.

- Task 6: Ruling: Gmail refresh has dedicated dispatcher functions gated by exact sync lease/fence/revision; never impersonate a Principal — protects credentials for native workers — cost if wrong: shared refresh CAS must remain compatible with administrative refresh in038.

- Task 6: Ruling: Sent observations/correlation to app outbox are finalized with reconciliation in T8 rather than importing arbitrary SENT mail now — avoids mislabelling an uncertain app send as a duplicate external message — cost if wrong: sent sync integration must not be omitted in T8/T12.

- Task 7: Ruling: Add migration043/044 rather than the planned039; OAuth/sync already consumed038–042 and043 was exercised before a trigger-record failure — preserve applied bytes — cost if wrong: longer additive migration chain.

- Task 7: Ruling: Introduce encrypted review material and hashed unsubscribe registry now, before T10 routes — a confirmed publication must freeze the actual footer link without writing during prepare — cost if wrong: T10 must use the exact frozen URL and hash; provider credentials never enter publication snapshots.

- Task 7: Ruling: Update the remaining TypeScript WhatsApp ON CONFLICT target alongside v2 publication — T6 upgraded SQL functions but missed the new-contact reviewed-test consumer — cost if wrong: four-column uniqueness must remain compatible with the WhatsApp partial unique index.

- Task 8: Ruling: Extend existing dispatch scope/reservation functions with channel barriers instead of duplicating the common receipt ledger — keeps05A acceptance, retry and exact-ID fencing unchanged — cost if wrong: wrapper upgrades must preserve legacy function names and grants; regression suites cover them.

- Task 8: Ruling: Sent observations enter through the authenticated sync lease and reconcile exact RFC/from/to before ordinary ingestion; unrelated Sent mail is ignored — avoids duplicate app messages and broad mailbox import — cost if wrong: an unthreaded external Sent message remains outside the inbox.

- Task 8: Ruling: Use independent IMAP Inbox/Sent checkpoints and bounded Gmail pending IDs — a history record can exceed one message batch and previously stalled forever — cost if wrong: cursor metadata grows but remains bounded; schema rejects unsupported cursor shapes.

- Task 8: Ruling: Serialize sync commit and refresh with workspace rotation locks, and read service evidence from the actual message conversation — lock-order review found mailbox→connection inversion and multiple email threads per contact — cost if wrong: additional same-workspace serialization, no relaxed authorization.

- Task 9: Ruling: Apply email stop/window hooks after MIME metadata instead of on raw channel_message insert — automatic replies and DSNs cannot be classified until metadata exists — cost if wrong: all email ingestion paths must preserve this atomic order; WhatsApp hooks remain original.

- Task 9: Ruling: Human thread references and contact must match a prior app message before cancelling linked outreach; unthreaded explicit opt-outs still suppress that email identity — avoids subject-only cancellation without ignoring removal requests — cost if wrong: a human response without usable references needs review, not automatic cancellation.

- Task 9: Ruling: Manual email reply input carries a stable draft messageId before review — freezes the RFC Message-ID without a write during prepare and distinguishes identical intentional replies — cost if wrong: client must retain the draft ID through confirmation retries.

- Task 10: Ruling: Complete SMTP own-address proof through a provisional unready sender, initial read baseline and exact registered proof outbox — the sender cannot become ready from credentials alone — cost if wrong: proof-specific exceptions must remain gated by mailbox/revision/message challenge and expiry, never by a client boolean.

- Task 10: Ruling: Add053 after052 proof-read test exposed the030 scope_data variable instead of027 state — preserve exercised migrations and assert the exact replacement marker — cost if wrong: one additional migration; proof and ordinary dispatch regression tests guard it.

- Task 10: Ruling: Share the exact rendered footer between publication preview and MIME, and point RFC8058 headers at /api/mail-unsubscribe/token/one-click — the original composer and preview differed — cost if wrong: new previews must match the composed text byte-for-byte, existing legacy WhatsApp snapshots stay untouched.

- Task 10: Ruling: Anonymous descadastro uses a bounded per-process POST throttle after intent parsing, never counts GET, and uses a database-idempotent hash lookup — protects the first legitimate request without storing public tokens — cost if wrong: distributed deployments need an edge-wide throttle for aggregate traffic; unsubscribe correctness remains database-atomic.

- Task 10: Ruling: General email inbox filter/DTO wiring is implemented with T12, where its consumer and pagination tests live; email reply and consent commands are exposed now — avoids introducing half a typed inbox interface — cost if wrong: T12 must retain WhatsApp as the omitted-filter default.

- Task 11: Ruling: New publications use the v2 UI for both supported channels while published legacy snapshots gain a read-only history endpoint — no automatic conversion or mutation of old versions — cost if wrong: the old wire contract remains supported on the server but newly approved versions use v2.

- Task 11: Ruling: Move the fixture sending slot two minutes ahead instead of one before rounding to minutes — a real boundary failure showed confirmation could miss the first slot while tests assumed it remained ahead — cost if wrong: fixture dates change, while production scheduling is unchanged and predecessor-delay assertions remain.

- Task 11: Ruling: Migrate local037–053 before rendered QA and use the supported webpack dev mode after Turbopack stayed compiling /login and HTTP timed out — production webpack build already passed — cost if wrong: development engine differs; no production configuration, credentials, or outbound workers changed.

- Task 11: Ruling: Prevent native Escape default-close from bypassing a modal's pending-action close guard — the shared dialog invokes its existing onClose decision instead — cost if wrong: callers must unmount dialogs when onClose is accepted; existing components already do.

- Task 12: Ruling: Signed pagination cursors bind actor/workspace and active email filters or thread; stable UUID list order avoids shifting pages on incoming mail — cost if wrong: inbox ordering is stable rather than newest-first.

- Task 12: Ruling: CUA provides desktop/keyboard but no viewport/emulation capability here; desktop filters and empty states verified with screenshot, populated provider/mobile QA remains explicitly pending — cost if wrong: narrow-screen styling is covered by CSS review only until the combined pilot.

- Task 13: Ruling: Claim sync leases just before each mailbox, never all ten ahead of sequential network work; fixed tick time plus next_at and a local seen set limit one use per mailbox — cost if wrong: throughput is sequential and favors lease correctness over parallelism.

- Task 13: Ruling: Exact-message dispatcher pilot never triggers mailbox discovery/materialization or sync; synchronize its exact mailbox separately before the reviewed send — cost if wrong: operator needs a separate explicit sync command, preserving one-message isolation.

- Task 13: Ruling: Every saved mailbox revision resets proof, baseline, freshness and fenced cursor via restricted admin function055; stale proof after IMAP configuration rotation failed a regression — cost if wrong: even cosmetic edits require reverification; historical messages and ownership reservations remain.

- Task 13: Ruling: Older SMTP verification test expected no sender, but051 intentionally provisions an unready sender for the reviewed self-proof; assert sender.ready=false instead — cost if wrong: provisional sender must never bypass the exact self-proof registry/barrier, covered by mail-http integration.

- Final: Ruling: Most-capable reviewer gpt-6-astra could not start due to account usage limit and produced no review; dispatch the one substantive fresh review on gpt-6.1-sol — cost if wrong: reviewer capability differs, with no duplicate review expense or author-only gate.

- Final: Ruling: Real Gmail/SMTP acceptance, delivery, quotas and revocation stay deferred to the user-selected final credential pilot — no external calls authorized for this local acceptance — cost if wrong: integration may expose provider-specific restrictions during pilot.

- Final: Ruling: Public OAuth verification/security assessment, DKIM alignment, reputation and DNS deployment remain launch prerequisites — no public approval or deliverability claim — cost if wrong: public release must wait for provider review/configuration.

- Final: Ruling: Populated-provider/mobile rendered QA stays explicitly pending; available CUA evidence covers desktop empty flows, populated contracts are tested locally — cost if wrong: visual issues may remain at narrow widths or with real account data.

- Final: Ruling: Historical mailbox migration and unrelated Sent import remain excluded; only bounded recovery/app-correlated Sent is implemented — avoids unexpected whole-mailbox ingestion — cost if wrong: older unrelated conversations are absent from the app.

- Final: Ruling: Microsoft OAuth, Pub/Sub, MX hosting, full attachments, arbitrary HTML and recipient tracking remain outside05B — user chose GmailOAuth plusSMTP/IMAP — cost if wrong: those capabilities require later scoped delivery.

- Final: Ruling: Unsubscribe throttle remains per-process; deployment-wide enforcement belongs to public ingress operations — atomic suppression remains in PostgreSQL — cost if wrong: multi-instance aggregate abuse protection requires an edge-wide limiter before launch.

- Final: Ruling: Thread acknowledgement is per-conversation, admin-only and bound to latest displayed message plus mailbox revision, with immutable review audit; it does not reset mailbox freshness or suppression — cost if wrong: administrator must additionally recover/sync the mailbox before sending.
