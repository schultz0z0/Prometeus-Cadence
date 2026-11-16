import test from 'node:test';import assert from 'node:assert/strict';
import {testAdmin} from './prospecting-helpers.ts';
import {meetingTurn,approve} from './sdr-helpers.ts';
import {sdrReminderTimes} from '../../src/domain/sdr-reminder.ts';
// 16/11/2026: meeting reminders of the Agente SDR (day before and 2h before, managed WhatsApp only).
const H={timezone:'America/Sao_Paulo',weekdays:[0,1,2,3,4,5,6],start:'00:00',end:'23:59',allDay:true};
const rows=(ws:string)=>testAdmin(async c=>(await c.query("SELECT r.kind,r.state,r.due_at,v.start_at FROM app.sdr_meeting_reminder r JOIN app.calendar_reservation v ON v.workspace_id=r.workspace_id AND v.id=r.reservation_id WHERE r.workspace_id=$1 ORDER BY r.due_at",[ws])).rows);
async function booked(o:Parameters<typeof meetingTurn>[1]={}){const m=await meetingTurn('ana@x.com',{noticeHours:30,...o});const at=new Date().toISOString();await approve(m);return {m,at};}

test('booking a meeting on the managed WhatsApp schedules its reminders',async()=>{
 const {m,at}=await booked({managed:true}),r=await rows(m.f.p.workspaceId);
 const start=new Date(r[0].start_at).toISOString(),want=sdrReminderTimes({start,bookedAt:at,hours:H});
 assert.ok(want.some(x=>x.kind==='two-hours'));
 assert.deepEqual(r.map(x=>x.kind),want.map(x=>x.kind));assert.ok(r.every(x=>x.state==='due'));
 const ev=await testAdmin(async c=>(await c.query("SELECT count(*) n FROM app.consent_evidence WHERE workspace_id=$1 AND source='sdr-meeting-reminder' AND purpose='service'",[m.f.p.workspaceId])).rows[0].n);
 assert.equal(Number(ev),1);
});
test('the official WhatsApp gets no reminder',async()=>{
 const {m}=await booked();assert.equal((await rows(m.f.p.workspaceId)).length,0);
});
test('reminders off in the agent schedule nothing',async()=>{
 const {m}=await booked({managed:true,draft:{meetingReminders:false}});assert.equal((await rows(m.f.p.workspaceId)).length,0);
});
import {randomUUID} from 'node:crypto';
import {runSdrTick} from '../../src/server/sdr/worker.ts';
import {readSdrConversation,prepareSdrReply,approveSdrReply,rejectSdrReply} from '../../src/server/sdr/conversation.ts';
import {cancelSdrBooking} from '../../src/server/sdr/business-actions.ts';
import {inbound,outbox,route} from './sdr-helpers.ts';
/** Booked on the managed WhatsApp, with its 2h reminder due now (and the day-before one moved out of the way). */
async function due(o:{presence?:string}={}){
 const {m}=await booked({managed:true});
 await testAdmin(async c=>{
  await c.query("UPDATE app.sdr_meeting_reminder SET due_at=CASE kind WHEN 'two-hours' THEN now()-interval '1 minute' ELSE now()+interval '1 day' END WHERE workspace_id=$1",[m.f.p.workspaceId]);
  if(o.presence)await c.query('UPDATE app.calendar_reservation SET sdr_presence=$2 WHERE workspace_id=$1',[m.f.p.workspaceId,o.presence]);
 });
 return m;
}
import {readCalendarSlots} from '../../src/server/integrations/calendar.ts';
// The worker reads the same fake calendar the meeting was booked on.
const tick=(m:Awaited<ReturnType<typeof due>>,generate?:any)=>runSdrTick({limit:5,workspaceId:m.f.p.workspaceId},{route,slots:async()=>{const r=await readCalendarSlots(m.f.p,{},m.g.deps);return {timezone:r.timezone,slots:r.slots.map(x=>({start:x.start,end:x.end}))};},...(generate?{generate}:{})});
const reminder=(m:Awaited<ReturnType<typeof due>>)=>testAdmin(async c=>(await c.query("SELECT r.state,r.turn_id,v.sdr_presence presence,v.meet_url FROM app.sdr_meeting_reminder r JOIN app.calendar_reservation v ON v.workspace_id=r.workspace_id AND v.id=r.reservation_id WHERE r.workspace_id=$1 AND r.kind='two-hours'",[m.f.p.workspaceId])).rows[0]);
const turnOf=(m:Awaited<ReturnType<typeof due>>,id:string)=>testAdmin(async c=>(await c.query('SELECT state,text,reserved,proposal FROM app.sdr_turn WHERE id=$1',[id])).rows[0]);
async function approveReminder(m:Awaited<ReturnType<typeof due>>,edit?:(t:string)=>string){
 const r=await reminder(m),t=await turnOf(m,r.turn_id),text=edit?edit(t.text):t.text,review=await prepareSdrReply(m.f.p,m.f.conversation,{turnId:r.turn_id,text});
 return approveSdrReply(m.f.p,m.f.conversation,{turnId:r.turn_id,text,reviewToken:review.review.token,requestId:randomUUID()},m.g.deps);
}
test('a due reminder becomes a draft with the app text',async()=>{
 const m=await due();await tick(m);
 const r=await reminder(m),t=await turnOf(m,r.turn_id);
 assert.equal(r.state,'drafted');assert.equal(t.state,'pending-approval');assert.equal(t.reserved,false);assert.equal(t.proposal.kind,'reminder');
 assert.match(t.text,/^Oi, QA! Nossa reunião é hoje às \d\d:\d\d/);assert.ok(r.meet_url&&t.text.includes(r.meet_url),'brings the meeting link');assert.match(t.text,/Segue de pé\?$/);
});
test('approving a reminder sends it and marks presence pending',async()=>{
 const m=await due();await tick(m);const before=await outbox(m.f);
 await approveReminder(m);
 const r=await reminder(m);assert.equal(r.state,'sent');assert.equal(r.presence,'pending');assert.equal(await outbox(m.f),before+1);
});
test('a lead message while the reminder waits sends it back to due',async()=>{
 const m=await due();await tick(m);
 await inbound(m.f,'Uma dúvida antes da reunião');
 await tick(m,async(_c:any,r:any)=>({value:r.parse({reply:'Claro, pode perguntar.',decision:'reply',fields:[],action:'none',quote:''}),usage:{provider:'openai'}}));
 await tick(m);
 assert.equal((await reminder(m)).state,'due');
});
test("a cancelled meeting's reminder cannot be approved",async()=>{
 const m=await due();await tick(m);
 const b=(await readSdrConversation(m.f.p,m.f.conversation)).booking!;
 await cancelSdrBooking(m.f.p,m.f.conversation,{reservationId:b.id,expectedRevision:b.revision},m.g.deps);
 await assert.rejects(approveReminder(m),(e:any)=>e.code==='SDR_REMINDER_STALE');
 await tick(m);assert.equal((await reminder(m)).state,'dropped');
});
test('an edited reminder without the date still sends',async()=>{
 const m=await due();await tick(m);await approveReminder(m,()=>'Oi, Ana! Tudo certo para nossa conversa?');
 assert.equal((await reminder(m)).state,'sent');
});
test('a rejected reminder is not drafted again',async()=>{
 const m=await due();await tick(m);const r=await reminder(m);
 await rejectSdrReply(m.f.p,m.f.conversation,{turnId:r.turn_id});await tick(m);
 assert.equal((await reminder(m)).state,'rejected');
});
test('a 2h reminder after a confirmation says Te espero lá',async()=>{
 const m=await due({presence:'confirmed'});await tick(m);
 const t=await turnOf(m,(await reminder(m)).turn_id);assert.match(t.text,/Te espero lá!$/);
});
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
// The lead's answer after the reminder went out.
async function answered(text:string,o:{presence:string;choose?:boolean}){
 const m=await due();await tick(m);await approveReminder(m);
 await inbound(m.f,text);
 await tick(m,async(_c:any,r:any)=>{const p=JSON.parse(r.prompt);
  return {value:r.parse(p.offer?{reply:'Tenho '+p.offer.slots[0].label+'. Pode ser?',decision:'reply',fields:[],action:'none',quote:'',offered:['s1'],presence:o.presence}:{reply:'Combinado, até lá!',decision:'reply',fields:[],action:'none',quote:'',presence:o.presence}),usage:{provider:'openai'}};});
 const turn=(await readSdrConversation(m.f.p,m.f.conversation)).turn!;return {m,turn};
}
const approveTurn=async(m:Awaited<ReturnType<typeof due>>,turn:{id:string;text:string|null})=>{const review=await prepareSdrReply(m.f.p,m.f.conversation,{turnId:turn.id,text:turn.text!});
 return approveSdrReply(m.f.p,m.f.conversation,{turnId:turn.id,text:turn.text!,reviewToken:review.review.token,requestId:randomUUID()},m.g.deps);};
const presence=(m:Awaited<ReturnType<typeof due>>)=>testAdmin(async c=>(await c.query("SELECT sdr_presence p FROM app.calendar_reservation WHERE workspace_id=$1 AND state='accepted'",[m.f.p.workspaceId])).rows.map(x=>x.p));
test('confirming after the reminder marks presence confirmed on approval',async()=>{
 const {m,turn}=await answered('Confirmado, até lá',{presence:'confirmed'});
 assert.equal((turn.proposal as any)?.kind,'presence');assert.deepEqual(await presence(m),['pending']);
 await approveTurn(m,turn);
 assert.deepEqual(await presence(m),['confirmed']);
 const st=await testAdmin(async c=>(await c.query("SELECT payload->'sdrProfile'->>'status' s FROM app.lead WHERE id=$1",[m.leadId])).rows[0].s);assert.match(st,/^Presença confirmada para \d\d\/\d\d \d\d:\d\d$/);
});
test('a rejected confirmation changes nothing',async()=>{
 const {m,turn}=await answered('Confirmado',{presence:'confirmed'});
 await rejectSdrReply(m.f.p,m.f.conversation,{turnId:turn.id});assert.deepEqual(await presence(m),['pending']);
});
test('rescheduling books the new meeting and then cancels the old one',async()=>{
 const {m,turn}=await answered('Não vou conseguir, pode ser outro dia?',{presence:'reschedule'});
 assert.match(turn.text!,/^Tenho /);
 await approveTurn(m,turn);assert.deepEqual(await presence(m),['reschedule']);
 await inbound(m.f,'Pode ser esse');
 await tick(m,async(_c:any,r:any)=>{const label=JSON.parse(r.prompt).offer.slots[0].label;return {value:r.parse({reply:'Combinado: '+label+' (horário de Brasília), 30 minutos pelo Google Meet.',decision:'reply',fields:[],action:'none',quote:'',chosen:'s1'}),usage:{provider:'openai'}};});
 const next=(await readSdrConversation(m.f.p,m.f.conversation)).turn!;assert.equal((next.proposal as any)?.kind,'meeting',JSON.stringify({state:next.state,reason:next.reason,text:next.text,stage:(await readSdrConversation(m.f.p,m.f.conversation)).stage}));
 await approveTurn(m,next);
 const rs=await testAdmin(async c=>(await c.query('SELECT state,sdr_presence FROM app.calendar_reservation WHERE workspace_id=$1 ORDER BY created_at',[m.f.p.workspaceId])).rows);
 assert.deepEqual(rs.map(x=>x.state),['cancelled','accepted']);assert.equal(m.g.created.length,2);
 const kinds=await testAdmin(async c=>(await c.query("SELECT count(*) n FROM app.sdr_meeting_reminder r JOIN app.calendar_reservation v ON v.workspace_id=r.workspace_id AND v.id=r.reservation_id WHERE r.workspace_id=$1 AND v.state='accepted' AND r.state='due'",[m.f.p.workspaceId])).rows[0].n);
 assert.ok(Number(kinds)>=1,'the new meeting has its own reminders');
});
test('a meeting is still refused while the current one is not being rescheduled',async()=>{
 const m=await due();
 const active=()=>withWorkspaceTransaction(m.f.p,async c=>(await c.query('SELECT app.sdr_booking_active($1,$2) a',[m.f.conversation,randomUUID()])).rows[0].a as boolean);
 assert.equal(await active(),true);
 await testAdmin(c=>c.query("UPDATE app.calendar_reservation SET sdr_presence='reschedule' WHERE workspace_id=$1",[m.f.p.workspaceId]));
 assert.equal(await active(),false);
});
test('the conversation view shows presence',async()=>{
 const m=await due();await tick(m);await approveReminder(m);
 assert.equal(((await readSdrConversation(m.f.p,m.f.conversation)).booking as any).presence,'pending');
});
