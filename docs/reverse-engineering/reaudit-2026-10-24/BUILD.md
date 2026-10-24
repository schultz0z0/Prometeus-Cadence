# Prometeus Cadence — audit handoff

Read STATUS.md, clone/prd.md and clone/parity.md first. This bundle is a study of the reference, not copied implementation code and not a claim that connected/paid behavior was tested.

The existing Prometeus repository at baseline a63161f already provides workspace identity, server persistence, prospecting jobs, provider usage reservations, AI routing, planning, email/WhatsApp adapters and continuous runtime. Do not replace these with a scaffold. The presence of useDemo is not sufficient to infer fake persistence: WorkspaceProvider bridges the shared repository.

Current user decisions: Stripe sandbox; monthly subscription and prepaid consumption packs; managed Docker OpenWA with in-app QR; keep official Meta as alternative; own branding; native implementation in the current conversation. Corrective milestones for previous areas are authorized.

Use the revised project roadmap and the06A billing design in the parent repository. The study records offered rules and visible states, not private backend contracts. Static endpoint candidates must never be called to bypass UI restrictions.

Requirements have evidence IDs. Each area must close UI, rules, persistence, permissions, background work, failures and real authorized acceptance. Keep blocked cases open. Do not claim100% from routes, screenshots or test counts alone.

No study-created persistent reference objects exist. The ledger is empty. Source/gateway credentials, real lead values, real QR data and raw account cookies are deliberately absent from the bundle.
