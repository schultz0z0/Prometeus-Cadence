# Lembrete de reunião do Agente SDR — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A meeting booked by the Agente SDR gets two app-written WhatsApp reminders (day before, 2h before) that wait for approval; the AI handles the lead's reply (confirm → short close; can't make it → reschedule with a new event, old one cancelled after).

**Migrations:** Tasks 3, 4 and 5 each add their own file (128, 128a, 128b), because each is applied to the local database while the next task is written.

**Architecture:** Reminder rows (`app.sdr_meeting_reminder`) are created when `bookSdrProposal` books a meeting. The SDR worker drafts due reminders as ordinary `sdr_turn`s in `pending-approval` with app text (no AI, no billing), so approval, rejection, the pending list and the send path are the existing ones. Presence (`pending`/`confirmed`/`reschedule`) lives on `calendar_reservation` and is written only when a turn is approved: `pending` when a reminder is sent, `confirmed`/`reschedule` from the AI's new `presence` output carried in the turn proposal.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` before touching routes), TypeScript run with `--experimental-strip-types`, Postgres 18 with forced RLS and SECURITY DEFINER functions, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-16-sdr-meeting-reminder-design.md`

## Global Constraints

- Reminders only on a sender whose `capabilities->>'requiresServiceWindow'` is `'false'` (the managed WhatsApp, OpenWA). Meta official never gets one.
- Only meetings booked by the agent after deploy, objective `meetings`, agent config `meetingReminders` true (default true), agent active when drafting.
- Day-before at 09:00 in the agent timezone (`hours.timezone`); if 09:00 is outside that day's hours, the day's `hours.start`; day not in `hours.weekdays` → no day-before reminder. `allDay` counts as open all day.
- 2h-before = start − 2h; outside the agent hours → no 2h reminder.
- A reminder exists only if its time is ≥ booking time + 1h.
- Drafting deadline: start − 30 min; after that, or if the reservation is not `accepted`, the reminder is `dropped`.
- A reminder is drafted only when the conversation is free: owner not human, no turn `claimed|queued|pending-approval|uncertain`, `sdr_thread_open` true (also refuses suppressed contacts).
- Text is exact copy (below); edits happen in the approval box. No AI, no `billing_reserve`, does not count in `maxRepliesPerDay`; the number's daily cap applies through the existing send path.
- The 2h text always asks again unless presence is `confirmed`; the link is always `calendar_reservation.meet_url` of that same reservation.
- Presence is written only on approval. Rejected drafts change nothing.
- Reschedule: new event first (`bookSdrProposal`), then cancel the old reservation; if the new booking fails, the old one stays. The app never cancels without a new event.
- All user-facing copy in Brazilian Portuguese.

Exact copy (`{nome}` = first name, omitted with its comma when unknown → "Oi! …"; `{dia}` = `segunda`…`domingo`; `{dd/mm}`; `{hh:mm}`; `{fuso}` = `timezoneLabel(tz)`):
- day before: `Oi, {nome}! Passando para confirmar nossa reunião amanhã, {dia}, {dd/mm}, às {hh:mm} ({fuso}), pelo Google Meet. Segue de pé? Se precisar, te ofereço outro horário.`
- 2h, with link: `Oi, {nome}! Nossa reunião é hoje às {hh:mm} ({fuso}). O link do Google Meet é {url} e também está no convite do seu e-mail. Segue de pé?`
- 2h, presence confirmed: same, ending `… e também está no convite do seu e-mail. Te espero lá!`
- 2h, no link: `Oi, {nome}! Nossa reunião é hoje às {hh:mm} ({fuso}). Segue de pé?` (or `Te espero lá!`)

## Review Focus

1. A lead message arriving while a reminder waits for approval: the reminder draft is superseded (thread no longer open) and must go back to `due`, not be lost, and the AI turn for the new message runs normally.
2. Meeting cancelled (button) or rescheduled while a reminder is `due` or drafted: nothing is drafted, and a drafted one cannot be approved (`SDR_REMINDER_STALE`).
3. The booking-active guard: with an `accepted` future meeting and presence `reschedule`, a new booking is allowed; with any other presence it is still refused.
4. Same-day booking 2h40 before start: no reminder at all (2h reminder would be 40 min after booking).
5. A reminder text the operator edits to remove the date still sends (no date check on reminders) — only meeting confirmations keep `mentionsSlot`.

Each has a test in the owning task below.

---

### Task 1: Reminder times and text (pure domain)

**Files:**
- Create: `src/domain/sdr-reminder.ts`
- Test: `tests/sdr-reminder.test.ts`

**Interfaces:**
- Consumes: `timezoneLabel(tz)` from `src/domain/sdr-stage.ts`; `SdrDraft['hours']` from `src/domain/sdr-policy.ts`.
- Produces:
  - `export type SdrReminderKind='day-before'|'two-hours'`
  - `export function sdrReminderTimes(i:{start:string;bookedAt:string;hours:SdrDraft['hours']}):{kind:SdrReminderKind;at:string}[]` (ISO UTC, ordered, 0–2 items)
  - `export function sdrReminderText(i:{kind:SdrReminderKind;name:string|null;start:string;timezone:string;meetUrl:string|null;confirmed:boolean}):string`
  - `export function firstName(name:string|null):string|null` (null for empty or phone-like `^[+\d\s()-]+$`)

- [ ] **Step 1: Write the failing tests** in `tests/sdr-reminder.test.ts`:

```ts
const H={timezone:'America/Sao_Paulo',weekdays:[1,2,3,4,5],start:'09:00',end:'18:00',allDay:false};
// Wed 18/11 15:30 BRT, booked Mon 16/11
test('day before at 09:00 and 2h before',()=>assert.deepEqual(sdrReminderTimes({start:'2026-11-18T18:30:00.000Z',bookedAt:'2026-11-16T14:00:00.000Z',hours:H}),
 [{kind:'day-before',at:'2026-11-17T12:00:00.000Z'},{kind:'two-hours',at:'2026-11-18T16:30:00.000Z'}]));
// Wed 18/11 10:00 BRT: 2h before is 08:00, outside 09–18
test('2h reminder outside agent hours is skipped',()=>assert.deepEqual(sdrReminderTimes({start:'2026-11-18T13:00:00.000Z',bookedAt:'2026-11-16T14:00:00.000Z',hours:H}).map(x=>x.kind),['day-before']));
```
Also:
- `start:'2026-11-16T18:30:00.000Z',bookedAt:'2026-11-16T14:05:00.000Z'` → `[{kind:'two-hours',at:'2026-11-16T16:30:00.000Z'}]` (same day: no day-before).
- `start:'2026-11-16T18:30:00.000Z',bookedAt:'2026-11-16T15:50:00.000Z'` → `[]` (Review Focus 4).
- Monday `start:'2026-11-23T18:30:00.000Z'`, weekdays `[1,2,3,4,5]` → Sunday is closed → only `two-hours`.
- `hours:{...H,start:'10:00'}` → day-before at `2026-11-17T13:00:00.000Z` (10:00 BRT).
- `allDay:true,weekdays:[0,1,2,3,4,5,6]` → day-before `2026-11-17T12:00:00.000Z`, two-hours start − 2h.
- Text: `sdrReminderText({kind:'two-hours',name:'Raphael teste',start:'2026-11-16T18:30:00.000Z',timezone:'America/Sao_Paulo',meetUrl:'https://meet.google.com/ziy-npok-ece',confirmed:true})` equals `Oi, Raphael! Nossa reunião é hoje às 15:30 (horário de Brasília). O link do Google Meet é https://meet.google.com/ziy-npok-ece e também está no convite do seu e-mail. Te espero lá!` (use whatever `timezoneLabel('America/Sao_Paulo')` returns in place of "horário de Brasília" if it differs, and assert through it).
- `confirmed:false` ends `Segue de pé?`; `meetUrl:null` drops the link sentence; `name:'+5521964342764'` → starts `Oi! Nossa…`; day-before for `2026-11-17T12:00:00.000Z` start reads `…amanhã, terça, 17/11, às 09:00 (…), pelo Google Meet. Segue de pé? Se precisar, te ofereço outro horário.`

- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/sdr-reminder.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `src/domain/sdr-reminder.ts` with `Intl.DateTimeFormat` in the agent timezone (same approach as `parts()` in `sdr-stage.ts`; reuse it by exporting it if needed). "Within hours" for a local time: weekday in `weekdays` and (`allDay` or `start<=hh:mm<end`).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(sdr): reminder times and text`.

### Task 2: `meetingReminders` setting

**Files:**
- Modify: `src/domain/sdr-policy.ts` (schema + `defaultSdrDraft`)
- Modify: `src/modules/sdr/agent-settings.tsx` (Objetivo block, only when `d.objective==='meetings'`)
- Test: `tests/07b1-sdr-configuration.test.ts`

**Interfaces:**
- Produces: `SdrDraft.meetingReminders:boolean` (`z.boolean().default(true)`).

- [ ] **Step 1:** Add test `meeting reminders default on and survive parsing`: `sdrDraftSchema.parse({...defaultSdrDraft(),meetingReminders:undefined}).meetingReminders===true` and `parse({...defaultSdrDraft(),meetingReminders:false}).meetingReminders===false`.
- [ ] **Step 2:** Run `node --experimental-strip-types --test tests/07b1-sdr-configuration.test.ts` — FAIL.
- [ ] **Step 3:** Add the field; in the settings, a checkbox labelled `Confirmar presença: lembrete na véspera e 2h antes (WhatsApp gerenciado)` under the calendar status line.
- [ ] **Step 4:** Run again — PASS; `npx tsc --noEmit -p .` — no errors.
- [ ] **Step 5: Commit** `feat(sdr): meeting reminders setting`.

### Task 3: Reminders are scheduled when the agent books a meeting

**Files:**
- Create: `db/migrations/128-sdr-meeting-reminders.sql`
- Modify: `src/server/sdr/business-actions.ts` (`bookSdrProposal`)
- Create: `tests/integration/sdr-helpers.ts` (move `Fix`, `fixture`, `lead`, `inbound`, `meetingTurn`, `approve`, `outbox` out of `sdr-objectives.test.ts`, which then imports them)
- Create: `tests/integration/sdr-reminders.test.ts`; register `"sdr-reminders"` in `scripts/test-integration.mjs` after `"sdr-objectives"`

**Interfaces:**
- Consumes: `sdrReminderTimes` (Task 1), `SdrDraft.meetingReminders` (Task 2).
- Produces (migration 128):
  - `app.sdr_meeting_reminder(workspace_id,id,conversation_id,reservation_id,kind CHECK IN('day-before','two-hours'),due_at,deadline_at,state CHECK IN('due','drafted','sent','rejected','dropped') DEFAULT 'due',turn_id,evidence_id,created_at)`, PK `(workspace_id,id)`, UNIQUE `(workspace_id,reservation_id,kind)`, index on `(due_at) WHERE state='due'`, forced RLS + workspace policy like `sdr_followup` (migration 110 lines 19–24), SELECT to `cadence_app`.
  - `ALTER TABLE app.calendar_reservation ADD COLUMN sdr_presence text CHECK(sdr_presence IN('pending','confirmed','reschedule'))`.
  - `app.sdr_reminders_schedule(p_conversation text,p_reservation text,p_times jsonb) RETURNS integer` (SECURITY DEFINER, `cadence_app`): returns 0 without inserting unless the conversation's agent (`sdr_agent_for_connection`) has `objective='meetings'` and `meetingReminders` not false, the sender has `requiresServiceWindow` = false, and the reservation is `accepted`. Drops (`state='dropped'`) `due`/`drafted` reminders of the conversation for other reservations. Inserts one `consent_evidence` (`purpose 'service'`, `source 'sdr-meeting-reminder'`, quote = latest inbound text, truncated to 500) and one row per `p_times` item with `deadline_at = start − 30 min`.
- `bookSdrProposal`: after `booked.state==='accepted'`, read the agent hours from the draft config and call `sdr_reminders_schedule(id, booked.id, sdrReminderTimes({start:booked.start,bookedAt:now,hours}))`. Reminder scheduling failure must not fail the booking (catch and ignore, comment why).

- [ ] **Step 1: Write failing tests** in `sdr-reminders.test.ts` (fixture conversation with sender capability flipped: `UPDATE app.channel_sender SET capabilities=capabilities||'{"requiresServiceWindow":false}'`):
  - `booking a meeting on the managed WhatsApp schedules both reminders` → rows `day-before`,`two-hours`, state `due`, one consent_evidence with source `sdr-meeting-reminder`.
  - `official WhatsApp gets no reminder` (capability untouched) → 0 rows.
  - `reminders off in the agent schedule nothing` (`meetingReminders:false`) → 0 rows.
- [ ] **Step 2:** `node scripts/test-integration.mjs sdr-reminders` — FAIL.
- [ ] **Step 3:** Write the migration and the `bookSdrProposal` call; `npm run db:migrate`.
- [ ] **Step 4:** Run `sdr-reminders` and `sdr-objectives` — PASS.
- [ ] **Step 5: Commit** `feat(sdr): schedule meeting reminders on booking`.

### Task 4: The worker drafts due reminders; approval, rejection and staleness

**Files:**
- Create: `db/migrations/128a-sdr-meeting-reminder-turns.sql`
- Modify: `src/server/sdr/worker.ts`
- Modify: `src/server/sdr/business-actions.ts` (failure copy)
- Test: `tests/integration/sdr-reminders.test.ts`

**Interfaces:**
- Produces:
  - `ALTER TABLE app.sdr_turn ADD COLUMN reminder_id text`; replace the unique `(workspace_id,conversation_id,inbound_message_id,followup_attempt)` with a unique index on `(workspace_id,conversation_id,inbound_message_id,followup_attempt,reminder_id) NULLS NOT DISTINCT`.
  - `app.sdr_claim_reminder(p_now timestamptz,p_workspace text DEFAULT NULL) RETURNS jsonb` (`cadence_worker`): first resets `drafted` reminders whose turn is `superseded|blocked` to `due`, marks `rejected` those whose turn is `rejected`, `dropped` those past `deadline_at` or whose reservation is not `accepted`; then picks one `due` row with `due_at<=p_now`, conversation free (Global Constraints), agent still as required by Task 3; marks it `drafted` and returns `{reminderId,workspaceId,conversationId,kind,start,timezone,meetUrl,name,confirmed}` (`name` = `payload->'sdrProfile'->>'personName'` or lead `name`; `confirmed` = `sdr_presence='confirmed'`), else NULL. Uses the same advisory lock key as turns (`'sdr-conversation:'||conversation_id`).
  - `app.sdr_draft_reminder(p_ws text,p_reminder text,p_text text) RETURNS text` (`cadence_worker`): inserts an `sdr_turn` (state `pending-approval`, inbound = latest inbound id, current agent id/revision, `reminder_id`, `text`, `proposal={"kind":"reminder","reminderId":…}`, `reserved=false`), stores `turn_id`, returns the turn id. If the conversation stopped being free, returns NULL and sets the reminder back to `due`.
  - `sdr_check_approval`: for a turn with `reminder_id`, raise `SDR_REMINDER_STALE` unless the reminder is `drafted`, its reservation is `accepted` and `clock_timestamp()<deadline_at`.
  - `sdr_approve_turn`: for `reminder_id` → reminder `sent`, reservation `sdr_presence='pending'` unless it is `confirmed` (a 2h reminder after a confirmation keeps `confirmed`).
  - `sdr_reject_turn`: for `reminder_id` → reminder `rejected`.
  - `SdrProposal` (`src/domain/sdr-turn.ts`) gains `{kind:'reminder';reminderId:string}`.
- Worker: at the start of `runSdrTick`, loop up to `o.limit` times `sdr_claim_reminder` → `sdrReminderText(...)` → `sdr_draft_reminder`. Failures of one reminder do not stop the turn loop.
- `business-actions.ts` failures: `SDR_REMINDER_STALE:[409,'Este lembrete não vale mais: a reunião mudou ou já está perto de começar.']`.

- [ ] **Step 1: Write failing tests:**
  - `a due reminder becomes a draft with the app text` → after `runSdrTick({limit:5,now:<due>})` there is one `pending-approval` turn whose text starts `Oi` and contains the meeting time; reminder `drafted`; no `billing_reservation` for it.
  - `approving a reminder sends it and marks presence pending` → outbox +1, reminder `sent`, `sdr_presence='pending'`.
  - `a lead message while the reminder waits sends it back to due` (Review Focus 1) → insert inbound, run tick: reminder `due` again (or re-drafted after the AI turn is decided).
  - `a cancelled meeting's reminder cannot be approved` (Review Focus 2) → cancel via `cancelSdrBooking`, approve → rejects with `SDR_REMINDER_STALE`; next tick marks it `dropped`.
  - `an edited reminder without the date still sends` (Review Focus 5).
  - `a 2h reminder after a confirmation says Te espero lá` → set `sdr_presence='confirmed'` before the tick.
- [ ] **Step 2:** `node scripts/test-integration.mjs sdr-reminders` — FAIL.
- [ ] **Step 3:** Implement the SQL and the worker loop; `npm run db:migrate`.
- [ ] **Step 4:** Run `sdr-reminders`, `sdr-objectives`, `07b2-sdr-conversation`, `07b3-sdr-actions` — PASS.
- [ ] **Step 5: Commit** `feat(sdr): worker drafts meeting reminders for approval`.

### Task 5: The AI reads the reply — confirm or reschedule

**Files:**
- Modify: `src/domain/sdr-turn.ts` (output `presence`, prompt rules, proposal)
- Modify: `src/server/sdr/compose.ts`
- Modify: `src/server/sdr/business-actions.ts` (`bookSdrProposal`: cancel the old meeting after a reschedule)
- Create: `db/migrations/128b-sdr-meeting-reminder-presence.sql`: `sdr_turn_payload` adds `reminder`; `sdr_approve_turn` applies presence; `sdr_booking_active` lets a `reschedule` meeting through
- Test: `tests/sdr-compose.test.ts`, `tests/integration/sdr-reminders.test.ts`, `tests/fixtures/ai-golden/sdr-turn.json` if the golden covers the output schema

**Interfaces:**
- Produces:
  - Output field `presence: z.enum(['','confirmed','reschedule'])` (empty = nothing said).
  - `SdrProposal` gains `{kind:'presence';value:'confirmed'|'reschedule';reservationId:string}`.
  - Claim/compose input gains `reminder:{kind:SdrReminderKind;reservationId:string;start:string}|null` (latest `sent` reminder of the conversation whose reservation is `accepted` and not yet started; from `sdr_turn_payload`).
  - Prompt rules (replace the line `Quando meeting vier preenchido, já há reunião marcada nesse horário: não ofereça outros.`):
    - `Quando meeting vier preenchido, já há reunião marcada nesse horário: não ofereça outros, a não ser que o lead diga que não pode ou peça outro horário.`
    - `Quando reminder vier preenchido, o app lembrou o lead da reunião. Se ele confirmar, agradecer ou disser ok, responda curto, encerrando com cordialidade, e presence é confirmed. Se ele não puder ou pedir outro horário, presence é reschedule. Fora isso, presence fica vazio.`
  - Compose: when `out.presence==='reschedule'`, objective `meetings` and `progress.stage==='done'`, set stage `qualified`, `openOffer(exclude=[current meeting start])` and regenerate once within the existing 3-call cap, so the same draft already offers real times. `r.proposal` is the presence proposal (a `meeting` proposal from `chosen` still wins).
  - `sdr_approve_turn`: proposal `presence` → `calendar_reservation.sdr_presence` = value (only if the reservation is still `accepted`); `reschedule` also drops that reservation's `due`/`drafted` reminders; lead `payload.sdrProfile.status` = `Presença confirmada para dd/mm hh:mm` or `Pediu para remarcar`.
  - `sdr_booking_active`: an `accepted` future reservation with `sdr_presence='reschedule'` no longer counts as active.
  - `bookSdrProposal`: read `sdr_booking_view` before booking; if it is `accepted`, a different start and `sdr_presence='reschedule'`, after the new booking is `accepted` call `cancelCalendarReservation(p, old.id, {expectedRevision:old.revision}, deps)`; a failure there leaves the old one (comment why) and does not fail the approval. `sdr_booking_view` returns `presence`.

- [ ] **Step 1: Write failing tests:**
  - unit `a confirmation after the reminder gives a presence proposal` → `composeSdrReply` with `reminder` set and generate returning `presence:'confirmed'` → `r.proposal` `{kind:'presence',value:'confirmed',…}`.
  - unit `a reschedule reopens the offer in the same draft` → stage `done`, generate first returns `presence:'reschedule'`, second call sees `offer` in the prompt without the current slot; `r.progress.stage==='offer'`.
  - integration `confirming after the reminder marks presence confirmed on approval` and `a rejected confirmation changes nothing`.
  - integration `rescheduling books the new meeting and then cancels the old one` → two reservations: old `cancelled`, new `accepted` with its own reminders; Google fake `created.length===2`, one delete.
  - integration `a meeting is still refused while the current one is not being rescheduled` (Review Focus 3).
- [ ] **Step 2:** Run `node --experimental-strip-types --test tests/sdr-compose.test.ts` and `node scripts/test-integration.mjs sdr-reminders` — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both plus `sdr-objectives` and `npm test` — PASS.
- [ ] **Step 5: Commit** `feat(sdr): reply to the reminder confirms or reschedules`.

### Task 6: Panel and lead record

**Files:**
- Modify: `src/server/sdr/conversation.ts` (booking view carries `presence`; turn view carries `proposal` already)
- Modify: `src/modules/sdr/conversation-controls.tsx`
- Test: `tests/integration/sdr-reminders.test.ts` (view shape)

**Interfaces:**
- Consumes: `sdr_booking_view(...).presence`, proposal kinds `reminder`/`presence`.
- UI copy:
  - Draft heading for a reminder turn: `Lembrete da reunião: nada sai sem o seu ok` (instead of `Rascunho do agente: …`).
  - Under `Reunião marcada para …`: `presence==='confirmed'` → `Presença confirmada`; `'pending'` → `Sem confirmação`; `'reschedule'` → `Lead pediu para remarcar`.
  - Stale reminder error shows the `SDR_REMINDER_STALE` copy from Task 4.
  - Only show `Reunião marcada para …` when the booking end is in the future (fixes the past 10:00 meeting seen in homologation).

- [ ] **Step 1:** Test `the conversation view shows presence` → `readSdrConversation(...).booking.presence==='pending'` after a sent reminder.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS; `npx tsc --noEmit -p .`.
- [ ] **Step 5: Commit** `feat(sdr): reminder drafts and presence in the conversation panel`.

### Task 7: Docs and full verification

**Files:**
- Modify: `AGENTS.md` (divergence paragraph: since 16/11/2026 the SDR sends app-written reminders the day before and 2h before, with approval, managed WhatsApp only, and reschedules on request; the reference has none)
- Modify: `docs/validation/2026-11-12-homologacao-canais-reais.md` (section "Lembrete de reunião do Agente SDR", pending real homologation)

- [ ] **Step 1:** Write both docs.
- [ ] **Step 2:** `npm test` → all pass; `node scripts/test-integration.mjs` (alone, nothing else running) → 0 fail; `npx tsc --noEmit -p .` → 0 errors.
- [ ] **Step 3: Commit** `docs: SDR meeting reminders`.
