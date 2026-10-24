# Open questions

| ID | Question | Evidence / reason | How to resolve | Blocking |
|---|---|---|---|---|
| Q-001 | What do paid, connected and failed provider states actually do? | L4 account has no channels; SDR gated | Dedicated user-owned test account and connected test channels | Operational parity claim |
| Q-002 | Is Hot Now/scoring still offered in the current product and under which plan? | Public guide uses older plan names [doc SRC-003] | Current entitled account or current official confirmation | 07D implementation scope |
| Q-003 | Why does qualified KPI show 10 while dashboard distribution shows 11? | [obs EV-001] [obs EV-055] | Inspect definitions, periods and archived rows in dedicated fixture | Copying metric semantics |
| Q-004 | What are actual connected OAuth scopes and mapping/retry rules? | Empty connection forms only [obs EV-053] [obs EV-065] | User-owned integration sandbox; no reference credentials copied | 07C |
| Q-005 | What are upgrade proration, refund, overdue grace, setup fee and unused add-on rules? | Catalog alone insufficient; static candidates do not prove behavior [obs EV-081] | Adopt explicit Prometeus policy; verify in Stripe sandbox | 06A commercial acceptance |
| Q-006 | Why did Next and step navigation remain on source in the reference automation wizard? | Valid name/source; no visible progression [obs EV-076] | Repeat in dedicated fixture; inspect real browser diagnostics if authorized | Remaining wizard states |
| Q-007 | Are Asaas/boleto candidates active or legacy? | Static-only candidates [obs EV-081] | Current entitled billing UI; no endpoint probing | Optional future payment methods |
| Q-008 | What are mobile, dark mode, large data and keyboard behaviors? | Desktop light screenshots/AX only [obs EV-078] | Screen/state matrix in 08A | 100% visual claim |
| Q-009 | Is duplication merging reversible and what survives a merge? | Settings review only [obs EV-021] | Fake records in dedicated account | 06B dedupe behavior |
| Q-010 | Can the user authorize a reference test environment for transactional tests? | Current study deliberately L4 | User prepares account; no trial/upgrade started by agent | Deep operational study |
| Q-011 | Are AI-related subscription rights sufficient for hosted commercial use? | Local ChatGPT OAuth pilot exists, not commercial approval | Validate chosen provider terms/contract before SaaS deployment | Commercial rollout |
| Q-012 | How should subscription capacity extras be charged? | User selected prepaid packs; reference seats/mailboxes/numbers recur [obs EV-004] | Explicit policy in 06A design; do not turn capacity into lifetime prepaid rights | Capacity commerce |
