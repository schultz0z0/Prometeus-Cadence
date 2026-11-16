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
