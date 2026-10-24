# API surface: candidates only

No authenticated request/response shapes were captured in this study. These are inert static frontend candidates from four observed public chunks; not endpoint liveness, permission, payload or server implementation proof. Never probe them to bypass the current UI. [obs EV-081]

| Candidate | Related UI | Certainty |
|---|---|---|
| /api/stripe/create-checkout | Subscribe | static literal only |
| /api/stripe/trial | Trial | static literal only |
| /api/stripe/billing and /api/stripe/billing-contact | History/contact | static literal only |
| /api/stripe/preview-upgrade and /api/stripe/upgrade | Plan change | static literal only |
| /api/stripe/cancel | Cancellation | static literal only |
| /api/stripe/addon-checkout and /api/stripe/addon-cancel | Extras | static literal only |
| /api/enrichment/checkout and /api/ai-credits/checkout | Credits | static literal only |
| /api/asaas/* | Alternative billing | unknown active versus legacy; Q-007 |

REA coverage: 36 inventoried files, 4 selected. Partial AST/semantic graph, 32 unselected files, semantic truncation and 5404 semantic unknowns. Static analysis was never executed as application code. [obs EV-011] [obs EV-081]

Prometeus should expose its own contracts, not mirror these names as implementation requirements. [obs EV-082]
