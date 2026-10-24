# Current catalog checkpoint

This checkpoint records observed UI contracts. Copy that describes a capability is evidence of the offered behavior, not proof that the backend delivered it. No reference jobs or financial actions were run.

## Subscription and units

- Essential R$397/month; Pro R$897/month. Annual option shows 20% reduction: R$317.60 and R$717.60 monthly equivalents, charged R$3811.20 and R$8611.20/year. Trial is 14 days. [obs EV-003] [obs EV-004] [obs EV-005]
- Essential: 5000 extractions, 5000 imports, 3 mailboxes, 2 WhatsApp numbers, 2 seats. Pro: 8000 extractions, 15000 imports, 5 mailboxes, 3 WhatsApp numbers, 3 seats, 300 SDR conversations and 1 LinkedIn account. Both show 100 active cadences and 50 active automations. [obs EV-004]
- Additional extraction tiers: +2000/R$97, +5000/R$219, +10000/R$399; imports +5000/R$27, +10000/R$47, +50000/R$147. Mailbox R$19, WhatsApp number R$49, seat R$59, LinkedIn module R$149. Reference describes these as monthly recurring. [obs EV-004] [obs EV-006]
- Enrichment: 50 monthly plan credits reset on calendar day 1 and do not accumulate. Purchased subscription credits arrive after a paid invoice, do not expire and are spent after plan credits. Additional units: 1/R$1.50, 50/R$65, 100/R$120, 300/R$330. These clocks differ from account subscription renewal. [obs EV-003] [obs EV-004] [obs EV-027]
- Billing contact differs from login identity; invoice history has an empty state. No paid invoice, checkout completion, cancellation or portal was exercised. [obs EV-007] [obs EV-023]

## Settings and lifecycle

- Invitations last 7 days; seats currently show 1 of 2. MCP permission can be granted to members; owner has full MCP access. MCP connects by OAuth at the published connector URL. [obs EV-009] [obs EV-013]
- Security offers password changes, TOTP, login email codes and trusted browsers for 30 days. These were not activated. [obs EV-012]
- Body retention can remove text while retaining metadata/tombstones; inbound minimum 90 days, outbound 30 days. Removed bodies must not remain available to AI/SDR. No retention setting changed. [obs EV-016]
- Notification rules cover grouped lead replies, SDR replies, meetings, handoff, approvals and failures. Quiet hours use business days/holidays and do not defer skipped events. Authentication/billing notices are separate. [obs EV-018]
- Account timezone and activity reports (daily 08:00, weekly Monday, monthly day 1) are configurable. Empty periods should not send a report. [obs EV-023]
- CRM, Google Sheets, Apollo and MeetFlow are visible integrations. Outgoing lead webhooks allow up to 10 destinations. No connection or webhook was created. [obs EV-014] [obs EV-015]

## Prospecting and contacts

- Sources: Base CNPJ, Google Maps, Web, Apollo using the customer's key. Source forms offer AI assistance, geography and source-specific filters. Search/extraction was not run. [obs EV-024] [obs EV-025] [obs EV-026]
- Qualification exposes email/phone extraction, website discovery, summary, deep crawl, DNS/MX/SMTP email verification, WhatsApp registration checks, Receita data and AI verdict. Summary languages pt/en/es; batches 1–500. No job was run. [obs EV-029]
- Enrichment offers free eligibility preview, qualified+CNPJ constraints, credit ceiling, one person/company, 6-month positive cache and 45-day negative cooldown; no result means no credit charged according to the UI. [obs EV-027]
- Contacts support lists, favorites, CSV/TXT/manual import, bulk actions, columns and filters for status, cadence, contact availability, response, source, enrichment, UF, date, favorite, CRM, email verification and opt-out. Persistent preferences were not toggled. Table values are masked. [obs EV-030] [obs EV-031] [obs EV-032] [obs EV-033] [obs EV-034]

## Messaging and execution

- Email inbox has received/sent/all/unread/favorite/lead/bounce filters and requires an IMAP connection. WhatsApp has a channel-setup empty state. No actual reference conversations were opened. [obs EV-041] [obs EV-042]
- Cadence pipeline filters status and qualification. Templates are separate reusable messages; system cadence models belong to the creation flow. Executions offer status, channel, period and meaningful-only versus trace detail. [obs EV-036] [obs EV-037] [obs EV-038]
- Reports split overview, funnel, CRM deals and performance, with cadence and custom-period filters. Empty state waits for the first send. [obs EV-040]

## LinkedIn and SDR

- LinkedIn can be drafted before subscribing, but connection is not included in trial. Campaign sends invitations; cadence handles accepted connections. Separate people, pipeline, enrichment and approval screens exist. Public comments require human approval. No campaign was created or connected. [obs EV-044] [obs EV-045] [obs EV-046] [obs EV-047] [obs EV-048] [obs EV-049] [obs EV-050] [obs EV-051]
- SDR is Pro-only, not sold separately. Standard quota 300 conversations/month; economy consumes half and premium triple. Offered behaviors: reply in original channel/thread, score, qualification, meeting negotiation, CRM write, follow-up, human handoff, per-conversation instructions and stop. Initial mode requests human approval. Operational screens are gated. [obs EV-043]

## Not tested

- All paid, connected, send, background-job, multi-user, persisted preference and real provider outcomes.
- Lifecycle failures, races, quotas under load and backend guarantees cannot be established by UI copy alone.
