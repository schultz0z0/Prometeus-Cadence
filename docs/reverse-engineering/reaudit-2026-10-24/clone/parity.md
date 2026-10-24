# Parity and acceptance backlog

“100%” is the target, not the audit result. Every offered capability needs observable acceptance; paid/gated states stay blocked until evidence exists. A matching route or passing unit test does not close visual/operational parity. [obs EV-082]

| Area / milestone | Reference | Prometeus at a63161f | Acceptance |
|---|---|---|---|
| 06A billing | R-001 to R-004; plan catalog | Demo plan; provider usage reservations real | Signed duplicate/out-of-order events; paid renewal once; cancel at period end; unpaid packs never granted; quota enforced across UI/API/workers |
| 06B prospecting | R-005, R-006; source/qualifier forms | Sources/jobs real; enrichment preview; DNS-only email check | Useful-result credit once; cache windows; contacts filters; SMTP/WA validation clearly classified; review and cancellation |
| 06C dashboard/reports | R-018 | Mixed real message metrics and synthetic/simplified panels | Known fixture events reconcile across dashboard/report/execution; timezone/period; zero differs from unavailable; no fixed curves |
| 06C notifications | Reply groups / quiet window [obs EV-018] | Preferences only | Dedupe and grouping; quiet window; report only with activity; no draft loss under continuous refresh |
| 06D channels/cadences | R-007, R-015, R-016 | Gmail/SMTP/Meta/OpenWA adapters and safeguards; UX refinements still needed | Authorized send→receipt→reply; reply stops later touches; recover after restart; clean modals; unified trace; no uncertain resend |
| 06E account/data | R-011, R-014; security [obs EV-012] | Sessions/roles real; TOTP/retention/merge missing | Two-member isolation, trusted-device lifecycle, body tombstone excluded from AI, reversible merge or explicit reviewed contract |
| 07A LinkedIn | R-008, R-009, R-017 | Preview shell | Target search→draft→review→invitation→accept→lead→cadence; public comment approval; no silent burst |
| 07B SDR | R-010 | Preview shell | Per-channel thread, review-first, quota weights, stop/handoff, scheduling and CRM outcomes; Pro gating server-side |
| 07C integrations/API/MCP | R-012 to R-014 | Adapter placeholders except Apollo prospecting | OAuth/key isolation, mappings, retry/outbox, HMAC deliveries, scoped MCP confirmation, revoke and cross-tenant denial |
| 07D scoring discovery | [doc SRC-003] | No verified current scope | First verify offered live behavior; then event score/decay/tier fixture and replays, never score synthetic delivery |
| 08A visual/flow audit | [obs EV-078] [obs EV-080] | Shared typography and route structure; no complete screenshot matrix | Desktop/tablet/mobile, empty/full/error/loading/gated, keyboard, focus, dark/text sizes; all differences classified |
| 08B production | Runtime and isolation code [obs EV-082] | Local services and Docker pilot, not hosted acceptance | Restore from backup, tenant isolation, bounded polling, provider outage, secret rotation, safe deploy/rollback, observed latency budget |

Existing contracts and unit/integration suites are reused, not discarded. The presence of useDemo in a component alone is not evidence of fake persistence: WorkspaceProvider also supplies the shared repository context. Specific hardcoded values and placeholder actions above were inspected directly. [obs EV-082]
