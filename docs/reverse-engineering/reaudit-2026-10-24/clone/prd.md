# Clone requirements and build order

Intent: reproduce observed product structure, workflows and capabilities under Prometeus branding, retaining explicit user-approved differences: managed OpenWA replaces Twilio; conservative OpenWA limits; customer-configurable AI; monthly subscription plus prepaid consumption packs. No competitor account/backend is an implementation dependency.

## Build order

1. 06A: audited commercial catalog, server entitlement ledger, Stripe sandbox, billing contact/invoices/renewal/cancel and prepaid credits. R-001 to R-004.
2. 06B: finish lead data, filters, import, enrichment and qualification differences. R-005 and R-006.
3. 06C: operational dashboard, reports, trace and actual notifications. R-018.
4. 06D: close messaging/cadence UX and real round-trip acceptance, preserving adapters and consent/limits. R-007, R-015, R-016.
5. 06E: security, retention and member/data lifecycle. R-011 and R-014.
6. 07A: LinkedIn complete, independent workflows. R-008, R-009, R-017.
7. 07B: SDR complete, review-first and observable. R-010.
8. 07C: CRM, Sheets, API, outgoing webhooks and MCP. R-012 to R-014.
9. 07D: confirm scoring/Hot Now availability, then implement if current capability confirmed. Q-002.
10. 08A: final visual/state/flow matrix; 08B: production recovery, isolation and performance acceptance. Q-008.

## Definition of done

An area closes only after its UI, server contracts, data persistence, permissions, background execution, failure/reconciliation and evidence-based acceptance are complete. Previous implementation milestone is not retrospectively called nonexistent; its remaining parity work is tracked separately. All references are in clone/parity.md.

## Not included automatically

Reference's promotional response rates, proprietary model text/assets, third-party subscription giveaways, mandatory bespoke setup fees, legal wording and provider-ban guarantees. They are not behavior to fabricate in our product. [obs EV-060] [obs EV-080] [doc SRC-002]
