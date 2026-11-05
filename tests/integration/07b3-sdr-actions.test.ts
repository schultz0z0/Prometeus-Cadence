import test,{after,before,beforeEach} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {base,resetRateLimits} from './helpers.ts';
import {testAdmin,closeProspectingPools} from './prospecting-helpers.ts';
import {verifiedMetaFixture} from './whatsapp-helpers.ts';
import {fakeCalendar} from './calendar-helpers.ts';
import {defaultSdrDraft} from '../../src/domain/sdr-policy.ts';
import {saveSdrAgent,prepareSdrActivation,confirmSdrActivation} from '../../src/server/sdr/configuration.ts';
import {runSdrTick,type SdrWorkerDeps} from '../../src/server/sdr/worker.ts';
import {readSdrConversation,takeOverSdr} from '../../src/server/sdr/conversation.ts';
import {sdrSlots,prepareSdrBooking,confirmSdrBooking,cancelSdrBooking,recordSdrFollowup,revokeSdrFollowup} from '../../src/server/sdr/business-actions.ts';
import {startCalendarAuthorization,finishCalendarAuthorization,configureCalendar} from '../../src/server/integrations/calendar.ts';
import type {Principal} from '../../src/domain/workspace.ts';
after(closeProspectingPools);
beforeEach(resetRateLimits);
const callback=base+'/api/integration-oauth/google-calendar/callback',env={GOOGLE_CALENDAR_CLIENT_ID:'client-qa',GOOGLE_CALENDAR_CLIENT_SECRET:'secret-qa',GOOGLE_CALENDAR_REDIRECT_URI:callback};
const saved:Record<string,string|undefined>={};
before(()=>{for(const [k,v] of Object.entries(env)){saved[k]=process.env[k];process.env[k]=v;}});
after(()=>{for(const k of Object.keys(env)){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}});
const route={provider:'openai' as const,model:'qa',configFingerprint:'qa',contractVersion:'conventional-v1' as const};
const out=(o:Record<string,unknown>={})=>({reply:'Olá!',decision:'reply',fields:[],action:null,quote:null,...o});
const gen=(v:unknown,seen?:{n:number;prompt?:string}):SdrWorkerDeps=>({route,generate:async(_c,r)=>{if(seen){seen.n++;seen.prompt=r.prompt;}return{value:r.parse(v),usage:{provider:'openai'}};}});
const rows=(t:string,ws:string,where='')=>testAdmin(async c=>Number((await c.query(`SELECT count(*) FROM app.${t} WHERE workspace_id=$1 ${where}`,[ws])).rows[0].count));
type Fix={p:Principal;connection:string;sender:string;identity:string;conversation:string;agent:string};
async function conversation(p:Principal,connection:string,sender:string,lead?:string){const identity=randomUUID(),id=randomUUID();
 await testAdmin(async c=>{
  await c.query("INSERT INTO app.channel_identity(workspace_id,id,scope,external_id,phone) VALUES($1,$2,(SELECT identity_scope FROM app.channel_sender WHERE id=$3),$2,$4)",[p.workspaceId,identity,sender,'+5511'+Math.floor(1e8+Math.random()*8e8)]);
  await c.query("INSERT INTO app.channel_conversation(workspace_id,id,connection_id,sender_id,identity_id,channel,last_inbound_at,last_message_at,lead_id) VALUES($1,$2,$3,$4,$5,'WHATSAPP',now(),now(),$6)",[p.workspaceId,id,connection,sender,identity,lead??null]);
 });return{identity,id};}
async function fixture(o:{followup?:boolean;lead?:boolean}={}):Promise<Fix>{
 const m=await verifiedMetaFixture(),p=m.u.p,lead=o.lead===false?undefined:'qa-lead';
 await testAdmin(async c=>{
  await c.query("UPDATE app.billing_account SET state='active',plan='pro',period_start=now(),period_end=now()+interval '30 days' WHERE workspace_id=$1",[p.workspaceId]);
  await c.query("INSERT INTO app.billing_grant(workspace_id,id,unit,quantity,source,external_ref,expires_at) VALUES($1,$2,'sdr',10,'plan',$2,now()+interval '30 days')",[p.workspaceId,randomUUID()]);
  await c.query("INSERT INTO app.context_version(workspace_id,version,payload) VALUES($1,1,$2)",[p.workspaceId,{name:'[RE] QA',approvedAt:new Date().toISOString()}]);
  await c.query("INSERT INTO app.messaging_limits(workspace_id,workspace_daily_limit,timezone) VALUES($1,100,'UTC') ON CONFLICT DO NOTHING",[p.workspaceId]);
  await c.query("UPDATE app.channel_sender SET daily_limit=100,ready=true WHERE workspace_id=$1",[p.workspaceId]);await c.query("UPDATE app.channel_connection SET state='ready',challenge_verified=true,inbound_verified=true WHERE workspace_id=$1",[p.workspaceId]);
  await c.query("INSERT INTO app.list(workspace_id,id,name) VALUES($1,'base','[RE] Base')",[p.workspaceId]);
  await c.query("INSERT INTO app.lead(workspace_id,id,list_id,payload) VALUES($1,'qa-lead','base',$2)",[p.workspaceId,{id:'qa-lead',listId:'base',name:'[RE] Lead',qualification:'pending',source:'MANUAL',createdAt:new Date().toISOString()}]);
 });
 const {identity,id}=await conversation(p,m.connection.id,m.sender.id,lead);
 const draft={...defaultSdrDraft(),name:'[RE] Agente',instructions:'Somos a [RE] QA.',channelIds:[m.connection.id],followupEnabled:o.followup!==false,handoff:{memberId:p.userId,rules:[]},hours:{timezone:'America/Sao_Paulo',weekdays:[0,1,2,3,4,5,6],start:'00:00',end:'23:59',allDay:true}};
 const a=await saveSdrAgent(p,{expectedRevision:0,draft}),r=await prepareSdrActivation(p,{agentId:a.id,revision:a.revision});assert.deepEqual(r.blockers,[]);
 await confirmSdrActivation(p,{agentId:a.id,revision:a.revision,token:r.token,requestId:randomUUID()});
 await testAdmin(c=>c.query("UPDATE app.sdr_channel_binding SET created_at=now()-interval '1 hour' WHERE workspace_id=$1",[p.workspaceId]));
 return {p,connection:m.connection.id,sender:m.sender.id,identity,conversation:id,agent:a.id};
}
const inbound=(f:{p:Principal;connection:string;sender:string},identity:string,conv:string,text:string)=>testAdmin(async c=>(await c.query("INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,state,text,occurred_at) VALUES($1,gen_random_uuid()::text,$2,$3,$4,$5,'inbound','received',$6,now()) RETURNING id",[f.p.workspaceId,f.connection,f.sender,identity,conv,text])).rows[0].id as string);
async function calendarOn(p:Principal){const g=fakeCalendar(),u=new URL((await startCalendarAuthorization(p,p.sessionId)).authorizationUrl);
 await finishCalendarAuthorization(p,p.sessionId,new URL(callback+'?state='+u.searchParams.get('state')+'&code=code-qa'),g.deps);
 await configureCalendar(p,{timezone:'America/Sao_Paulo',weekdays:[0,1,2,3,4,5,6],start:'00:00',end:'23:30',durationMinutes:30,noticeHours:0,horizonDays:3,expectedRevision:0},g.deps);return g;}
const IN=new Date(Date.now());
const tick=(f:Fix,deps:SdrWorkerDeps,now:Date=IN)=>runSdrTick({limit:5,now,workspaceId:f.p.workspaceId},deps);
const hours=(n:number)=>new Date(IN.getTime()+n*3600e3);

test('07B.3 calendar suggestion: real slots, one booking, nothing said before it is accepted',async()=>{
 const f=await fixture(),g=await calendarOn(f.p);await inbound(f,f.identity,f.conversation,'Podemos marcar uma reunião?');
 await tick(f,gen(out({action:'calendar-options'})));
 const v=await readSdrConversation(f.p,f.conversation);assert.deepEqual(v.turn!.proposal,{kind:'calendar-options'});assert.equal(v.booking,null);
 const {slots}=await sdrSlots(f.p,f.conversation,g.deps);assert.ok(slots.length>1);
 // An invented slot id is refused without touching the calendar.
 const fake='x'.repeat(40),rv0=await prepareSdrBooking(f.p,f.conversation,{slotId:fake});
 await assert.rejects(confirmSdrBooking(f.p,f.conversation,{slotId:fake,token:rv0.token,requestId:randomUUID()},g.deps),{status:422});
 assert.equal(g.events.size,0);
 const rv=await prepareSdrBooking(f.p,f.conversation,{slotId:slots[0].id});assert.deepEqual(rv.blockers,[]);assert.equal(rv.lead,'[RE] Lead');
 const requestId=randomUUID(),one=await confirmSdrBooking(f.p,f.conversation,{slotId:slots[0].id,token:rv.token,requestId},g.deps);
 assert.equal(one.state,'accepted');assert.equal(g.events.size,1);
 assert.equal((await confirmSdrBooking(f.p,f.conversation,{slotId:slots[0].id,token:rv.token,requestId},g.deps)).id,one.id,'a repeat books nothing new');assert.equal(g.events.size,1);
 assert.equal((await readSdrConversation(f.p,f.conversation)).booking!.state,'accepted');
 // A second active meeting is refused until this one is cancelled; the outbox stays untouched.
 const rv2=await prepareSdrBooking(f.p,f.conversation,{slotId:slots[1].id});assert.ok(rv2.blockers.some(b=>/reunião/i.test(b)));
 await assert.rejects(confirmSdrBooking(f.p,f.conversation,{slotId:slots[1].id,token:rv2.token,requestId:randomUUID()},g.deps),{status:409});
 assert.equal(await rows('message_outbox',f.p.workspaceId),0);
 const c=await cancelSdrBooking(f.p,f.conversation,{reservationId:one.id,expectedRevision:one.revision},g.deps);assert.equal(c.state,'cancelled');
 assert.equal((await readSdrConversation(f.p,f.conversation)).booking!.state,'cancelled');
 assert.ok((await prepareSdrBooking(f.p,f.conversation,{slotId:slots[1].id})).blockers.length===0);
 await assert.rejects(sdrSlots((await fixture()).p,f.conversation,g.deps),{status:404});
});

test('07B.3 two contacts on one slot: one reservation; a lost answer stays uncertain and a repeat does not book twice',async()=>{
 const f=await fixture(),g=await calendarOn(f.p),b=await conversation(f.p,f.connection,f.sender,'qa-lead');
 const {slots}=await sdrSlots(f.p,f.conversation,g.deps),slotId=slots[0].id;
 const ra=await prepareSdrBooking(f.p,f.conversation,{slotId}),rb=await prepareSdrBooking(f.p,b.id,{slotId});
 await confirmSdrBooking(f.p,f.conversation,{slotId,token:ra.token,requestId:randomUUID()},g.deps);
 await assert.rejects(confirmSdrBooking(f.p,b.id,{slotId,token:rb.token,requestId:randomUUID()},g.deps),{status:409});
 assert.equal(g.events.size,1);assert.notEqual((await readSdrConversation(f.p,b.id)).booking?.state,'accepted');
 const after=(await sdrSlots(f.p,b.id,g.deps)).slots;assert.ok(!after.some(s=>s.start===slots[0].start),'the next offer leaves the taken slot out');
 // Timeout after the remote side accepted.
 const c=await conversation(f.p,f.connection,f.sender,'qa-lead'),rid=randomUUID(),slot=after[0].id,rc=await prepareSdrBooking(f.p,c.id,{slotId:slot});
 g.hooks.afterCreate=()=>{g.hooks.afterCreate=undefined;throw new TypeError('network lost');};
 await assert.rejects(confirmSdrBooking(f.p,c.id,{slotId:slot,token:rc.token,requestId:rid},g.deps));
 assert.equal((await readSdrConversation(f.p,c.id)).booking!.state,'uncertain');const n=g.events.size;
 assert.equal((await confirmSdrBooking(f.p,c.id,{slotId:slot,token:rc.token,requestId:rid},g.deps)).state,'accepted');assert.equal(g.events.size,n,'asks the origin id; no second event');
});

test('07B.3 booking gates: no linked contact, opt-out, changed link, other workspace',async()=>{
 const f=await fixture({lead:false}),g=await calendarOn(f.p),{slots}=await sdrSlots(f.p,f.conversation,g.deps);
 const rv=await prepareSdrBooking(f.p,f.conversation,{slotId:slots[0].id});assert.ok(rv.blockers.some(b=>/contato/i.test(b)));
 await assert.rejects(confirmSdrBooking(f.p,f.conversation,{slotId:slots[0].id,token:rv.token,requestId:randomUUID()},g.deps),{status:409});
 await testAdmin(c=>c.query("UPDATE app.channel_conversation SET lead_id='qa-lead' WHERE id=$1",[f.conversation]));
 await assert.rejects(confirmSdrBooking(f.p,f.conversation,{slotId:slots[0].id,token:rv.token,requestId:randomUUID()},g.deps),{status:409,code:'REVIEW_CHANGED'});
 const ok=await prepareSdrBooking(f.p,f.conversation,{slotId:slots[0].id});
 await testAdmin(c=>c.query("INSERT INTO app.contact_suppression(workspace_id,identity_id,scope,reason) VALUES($1,$2,'all','qa')",[f.p.workspaceId,f.identity]));
 assert.ok((await prepareSdrBooking(f.p,f.conversation,{slotId:slots[0].id})).blockers.some(b=>/receber/i.test(b)));
 await assert.rejects(confirmSdrBooking(f.p,f.conversation,{slotId:slots[0].id,token:ok.token,requestId:randomUUID()},g.deps),{status:409});
 assert.equal(g.events.size,0);
});

test('07B.3 follow-up: consent from a literal quote, two returns 24 h apart, each one awaiting approval',async()=>{
 const f=await fixture();await testAdmin(c=>c.query("UPDATE app.channel_connection SET provider='openwa' WHERE id=$1",[f.connection]));
 await testAdmin(c=>c.query("UPDATE app.channel_sender SET provider='openwa',daily_limit=20,new_conversation_limit=5 WHERE connection_id=$1",[f.connection]));
 await inbound(f,f.identity,f.conversation,'Agora não dá. Pode me chamar semana que vem?');
 const seen={n:0} as {n:number;prompt?:string};
 await tick(f,gen(out({action:'followup-consent',quote:'Pode me chamar semana que vem'}),seen));
 const t=(await readSdrConversation(f.p,f.conversation)).turn!;assert.deepEqual(t.proposal,{kind:'followup-consent',quote:'Pode me chamar semana que vem'});
 // A suggestion alone schedules nothing.
 seen.n=0;await tick(f,gen(out(),seen),hours(30));assert.equal(seen.n,0);assert.equal(await rows('sdr_followup',f.p.workspaceId),0);
 await assert.rejects(recordSdrFollowup(f.p,f.conversation,{turnId:t.id,quote:'Autorizo tudo',days:30}),{status:422});
 await assert.rejects(recordSdrFollowup(f.p,f.conversation,{turnId:t.id,quote:'Pode me chamar semana que vem',days:31}),{status:422});
 const fu=await recordSdrFollowup(f.p,f.conversation,{turnId:t.id,quote:'Pode me chamar semana que vem',days:10});
 assert.equal(await rows('consent_evidence',f.p.workspaceId,"AND source='sdr-followup'"),1);
 assert.equal((await readSdrConversation(f.p,f.conversation)).followup!.id,fu.id);
 await testAdmin(c=>c.query("UPDATE app.sdr_turn SET state='rejected' WHERE id=$1",[t.id]));
 await tick(f,gen(out({reply:'Oi de novo'}),seen),hours(23));assert.equal(seen.n,0,'not before 24 h');
 await tick(f,gen(out({reply:'Oi de novo'}),seen),hours(25));assert.equal(seen.n,1);assert.match(seen.prompt!,/followup/);
 const r1=(await readSdrConversation(f.p,f.conversation)).turn!;assert.equal(r1.state,'pending-approval');assert.equal(r1.followupAttempt,1);
 assert.equal(await rows('message_outbox',f.p.workspaceId),0,'still needs a person');
 await testAdmin(c=>c.query("UPDATE app.sdr_turn SET state='rejected' WHERE id=$1",[r1.id]));
 await tick(f,gen(out(),seen),hours(40));assert.equal(seen.n,1,'24 h between returns');
 await tick(f,gen(out(),seen),hours(50));assert.equal(seen.n,2);
 await testAdmin(c=>c.query("UPDATE app.sdr_turn SET state='rejected' WHERE workspace_id=$1 AND state='pending-approval'",[f.p.workspaceId]));
 await tick(f,gen(out(),seen),hours(90));assert.equal(seen.n,2,'two returns at most');
});

test('07B.3 follow-up stops: reply, takeover, opt-out, withdrawal, expiry, Meta, follow-up off',async()=>{
 const setup=async(o:{openwa?:boolean;followup?:boolean}={})=>{const f=await fixture({followup:o.followup});
  if(o.openwa!==false)await testAdmin(async c=>{await c.query("UPDATE app.channel_connection SET provider='openwa' WHERE id=$1",[f.connection]);await c.query("UPDATE app.channel_sender SET provider='openwa',daily_limit=20,new_conversation_limit=5 WHERE connection_id=$1",[f.connection]);});
  await inbound(f,f.identity,f.conversation,'Pode me chamar amanhã?');await tick(f,gen(out({action:'followup-consent',quote:'Pode me chamar amanhã'})));const t=(await readSdrConversation(f.p,f.conversation)).turn!;return{f,t};};
 const state=(f:Fix)=>testAdmin(async c=>(await c.query('SELECT state,ended_reason FROM app.sdr_followup WHERE workspace_id=$1',[f.p.workspaceId])).rows[0]);
 const evidence=(f:Fix)=>rows('consent_evidence',f.p.workspaceId,"AND source='sdr-followup'");
 const q={quote:'Pode me chamar amanhã',days:30};
 // A new message from the lead.
 {const {f,t}=await setup();await recordSdrFollowup(f.p,f.conversation,{turnId:t.id,...q});await inbound(f,f.identity,f.conversation,'Pensei melhor');
  const s={n:0};await tick(f,gen(out(),s),hours(25));assert.equal(s.n,1,'the new message is answered as a normal turn');assert.equal((await readSdrConversation(f.p,f.conversation)).turn!.followupAttempt,0);
  assert.deepEqual(await state(f),{state:'ended',ended_reason:'REPLIED'});assert.equal(await evidence(f),0);}
 // A person taking over.
 {const {f,t}=await setup();await recordSdrFollowup(f.p,f.conversation,{turnId:t.id,...q});const v=await readSdrConversation(f.p,f.conversation);await takeOverSdr(f.p,f.conversation,{expectedRevision:v.revision});
  assert.deepEqual(await state(f),{state:'ended',ended_reason:'HUMAN'});assert.equal(await evidence(f),0);}
 // Opt-out, and no quota held.
 {const {f,t}=await setup();await recordSdrFollowup(f.p,f.conversation,{turnId:t.id,...q});await testAdmin(c=>c.query("INSERT INTO app.contact_suppression(workspace_id,identity_id,scope,reason) VALUES($1,$2,'all','qa')",[f.p.workspaceId,f.identity]));
  const s={n:0};await tick(f,gen(out(),s),hours(25));assert.equal(s.n,0);assert.deepEqual(await state(f),{state:'ended',ended_reason:'OPT_OUT'});assert.equal(await rows('billing_grant',f.p.workspaceId,"AND unit='sdr' AND held>0"),0);}
 // Withdrawal by a person; a second one is refused.
 {const {f,t}=await setup();const fu=await recordSdrFollowup(f.p,f.conversation,{turnId:t.id,...q});await revokeSdrFollowup(f.p,f.conversation,{id:fu.id});
  assert.deepEqual(await state(f),{state:'ended',ended_reason:'WITHDRAWN'});await assert.rejects(revokeSdrFollowup(f.p,f.conversation,{id:fu.id}),{status:409});}
 // Expiry.
 {const {f,t}=await setup();await recordSdrFollowup(f.p,f.conversation,{turnId:t.id,quote:q.quote,days:1});const s={n:0};await tick(f,gen(out(),s),hours(25));assert.equal(s.n,0);assert.deepEqual(await state(f),{state:'ended',ended_reason:'EXPIRED'});}
 // Meta: returns need a template this flow does not have, so the consent is refused up front.
 {const {f,t}=await setup({openwa:false});await assert.rejects(recordSdrFollowup(f.p,f.conversation,{turnId:t.id,...q}),{status:409,code:'SDR_FOLLOWUP_META'});assert.equal((await readSdrConversation(f.p,f.conversation)).agent!.followupAvailable,false);}
 // Agent without follow-up: the consent itself is refused.
 {const {f,t}=await setup({followup:false});await assert.rejects(recordSdrFollowup(f.p,f.conversation,{turnId:t.id,...q}),{status:409});}
 // Another workspace.
 {const {f,t}=await setup(),o=await fixture();await assert.rejects(recordSdrFollowup(o.p,f.conversation,{turnId:t.id,...q}),{status:404});}
});

const openwa=(f:Fix)=>testAdmin(async c=>{await c.query("UPDATE app.channel_connection SET provider='openwa' WHERE id=$1",[f.connection]);await c.query("UPDATE app.channel_sender SET provider='openwa',daily_limit=20,new_conversation_limit=5 WHERE connection_id=$1",[f.connection]);});
async function consented(q='Pode me chamar amanhã'){const f=await fixture();await openwa(f);await inbound(f,f.identity,f.conversation,q+'?');await tick(f,gen(out({action:'followup-consent',quote:q})));const t=(await readSdrConversation(f.p,f.conversation)).turn!;return{f,t,q};}
const operator=async(f:Fix)=>{const m=await verifiedMetaFixture();await testAdmin(c=>c.query('INSERT INTO auth.member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())',[randomUUID(),f.p.workspaceId,m.u.p.userId,'operator']));return{...m.u.p,workspaceId:f.p.workspaceId,role:'operator' as const};};

test('07B.3 review: consent needs consents.manage and the AI proposal; the quote must match it',async()=>{
 const {f,t,q}=await consented(),op=await operator(f);
 await assert.rejects(recordSdrFollowup(op,f.conversation,{turnId:t.id,quote:q,days:7}),{status:403});
 await assert.rejects(recordSdrFollowup(f.p,f.conversation,{turnId:t.id,quote:'me chamar',days:7}),{status:422},'a fragment is not the proposal');
 // A turn the AI did not flag cannot carry consent, even with a literal quote.
 const g=await fixture();await openwa(g);await inbound(g,g.identity,g.conversation,'não me chame mais por aqui');await tick(g,gen(out()));
 const t2=(await readSdrConversation(g.p,g.conversation)).turn!;await assert.rejects(recordSdrFollowup(g.p,g.conversation,{turnId:t2.id,quote:'não me chame',days:7}),{status:422});
 assert.equal(await rows('consent_evidence',g.p.workspaceId),0);
});

test('07B.3 review: withdrawal drops the pending return, releases the unit and a re-record cannot reset attempts',async()=>{
 const {f,t,q}=await consented();const fu=await recordSdrFollowup(f.p,f.conversation,{turnId:t.id,quote:q,days:10});
 await testAdmin(c=>c.query("UPDATE app.sdr_turn SET state='rejected',reserved=false WHERE id=$1",[t.id]));
 await testAdmin(c=>c.query("UPDATE app.billing_grant SET held=0 WHERE workspace_id=$1",[f.p.workspaceId]));
 const s={n:0};await tick(f,gen(out({reply:'Oi'}),s),hours(25));assert.equal(s.n,1);
 const r=(await readSdrConversation(f.p,f.conversation)).turn!;assert.equal(r.followupAttempt,1);
 await revokeSdrFollowup(f.p,f.conversation,{id:fu.id});
 assert.equal((await readSdrConversation(f.p,f.conversation)).turn!.state,'superseded');
 assert.equal(await rows('billing_grant',f.p.workspaceId,"AND unit='sdr' AND held>0"),0);
 assert.equal(await rows('consent_evidence',f.p.workspaceId,"AND source='sdr-followup'"),0);
 await assert.rejects(recordSdrFollowup(f.p,f.conversation,{turnId:t.id,quote:q,days:10}),{status:409},'returns already happened for this message');
});

test('07B.3 review: pacing at approval, attempts only when a draft exists, stale attempt-0 draft, return without consent',async()=>{
 const {prepareSdrReply,approveSdrReply}=await import('../../src/server/sdr/conversation.ts');
 const {f,t,q}=await consented();await recordSdrFollowup(f.p,f.conversation,{turnId:t.id,quote:q,days:10});
 // No franchise: no attempt spent, retried later.
 await testAdmin(c=>c.query("UPDATE app.billing_grant SET revoked=true WHERE workspace_id=$1",[f.p.workspaceId]));
 await testAdmin(c=>c.query("UPDATE app.sdr_turn SET state='rejected',reserved=false WHERE id=$1",[t.id]));
 await tick(f,gen(out()),hours(25));
 assert.equal((await testAdmin(async c=>(await c.query('SELECT attempts FROM app.sdr_followup WHERE workspace_id=$1',[f.p.workspaceId])).rows[0])).attempts,0);
 await testAdmin(c=>c.query("UPDATE app.billing_grant SET revoked=false WHERE workspace_id=$1",[f.p.workspaceId]));
 await tick(f,gen(out({reply:'Primeiro retorno'})),hours(50));
 const r1=(await readSdrConversation(f.p,f.conversation)).turn!;assert.equal(r1.followupAttempt,1);assert.equal(r1.state,'pending-approval');
 // An outbound sent minutes ago refuses a return, whatever the draft's age.
 await testAdmin(c=>c.query("INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,state,text,occurred_at) VALUES($1,gen_random_uuid()::text,$2,$3,$4,$5,'outbound','accepted','antes',now())",[f.p.workspaceId,f.connection,f.sender,f.identity,f.conversation]));
 const rv=await prepareSdrReply(f.p,f.conversation,{turnId:r1.id,text:'Primeiro retorno'});
 await assert.rejects(approveSdrReply(f.p,f.conversation,{turnId:r1.id,text:'Primeiro retorno',reviewToken:rv.review.token,requestId:randomUUID()}),{status:409,code:'SDR_FOLLOWUP_TOO_SOON'});
 // A return whose consent has ended is not eligible for a retry.
 await testAdmin(c=>c.query("UPDATE app.sdr_turn SET state='uncertain' WHERE id=$1",[r1.id]));
 await testAdmin(c=>c.query("UPDATE app.sdr_followup SET state='ended' WHERE workspace_id=$1",[f.p.workspaceId]));
 const {retrySdrTurn}=await import('../../src/server/sdr/conversation.ts');await assert.rejects(retrySdrTurn(f.p,f.conversation,{turnId:r1.id}),{status:409});
});

test('07B.3 review: recheck, cancel of an uncertain booking, past meetings, retention, HTTP and removed member',async()=>{
 const {recheckSdrBooking}=await import('../../src/server/sdr/business-actions.ts'),{sdrItemRequest}=await import('../../src/server/sdr/http.ts');
 const f=await fixture(),g=await calendarOn(f.p),{slots}=await sdrSlots(f.p,f.conversation,g.deps),slotId=slots[0].id,rv=await prepareSdrBooking(f.p,f.conversation,{slotId});
 await assert.rejects(recheckSdrBooking(f.p,f.conversation,g.deps),{status:404},'nothing to recheck yet');
 g.hooks.afterCreate=()=>{g.hooks.afterCreate=undefined;throw new TypeError('network lost');};
 await assert.rejects(confirmSdrBooking(f.p,f.conversation,{slotId,token:rv.token,requestId:randomUUID()},g.deps));
 const u=(await readSdrConversation(f.p,f.conversation)).booking!;assert.equal(u.state,'uncertain');assert.ok(u.timezone);
 const n=g.events.size,re=await recheckSdrBooking(f.p,f.conversation,g.deps);assert.equal(re.state,'accepted');assert.equal(g.events.size,n);
 assert.equal((await recheckSdrBooking(f.p,f.conversation,g.deps)).state,'accepted','settled: no new call creates anything');assert.equal(g.events.size,n);
 // Opt-out or a slot in the past: recheck refuses instead of creating.
 await testAdmin(c=>c.query("UPDATE app.calendar_reservation SET state='uncertain',start_at=now()-interval '2 hours',end_at=now()-interval '1 hour' WHERE workspace_id=$1",[f.p.workspaceId]));
 await assert.rejects(recheckSdrBooking(f.p,f.conversation,g.deps),{status:409});
 // A past meeting no longer blocks the next one.
 await testAdmin(c=>c.query("UPDATE app.calendar_reservation SET state='accepted' WHERE workspace_id=$1",[f.p.workspaceId]));
 assert.deepEqual((await prepareSdrBooking(f.p,f.conversation,{slotId:slots[1].id})).blockers,[]);
 // Retention reaches the consent quote and the proposal.
 const {f:h,t,q}=await consented();await recordSdrFollowup(h.p,h.conversation,{turnId:t.id,quote:q,days:10});
 const inboundId=await testAdmin(async c=>(await c.query('SELECT inbound_message_id v FROM app.sdr_turn WHERE id=$1',[t.id])).rows[0].v);
 await testAdmin(c=>c.query('UPDATE app.channel_message SET text=NULL,text_purged_at=now() WHERE id=$1',[inboundId]));
 const pv=await readSdrConversation(h.p,h.conversation);assert.equal(pv.turn!.proposal,null);assert.notEqual(pv.followup?.quote,q);
 assert.equal(await rows('consent_evidence',h.p.workspaceId,"AND evidence LIKE '%chamar%'"),0);
 // HTTP and removed member.
 assert.equal((await sdrItemRequest(new Request(base+'/api/sdr/conversations/x/slots',{method:'POST',body:'{}'}),'conversations','x','slots')).status,401);
 await testAdmin(c=>c.query('DELETE FROM auth.member WHERE "organizationId"=$1 AND "userId"=$2',[f.p.workspaceId,f.p.userId]));
 await assert.rejects(prepareSdrBooking(f.p,f.conversation,{slotId}),(e:{status?:number})=>e.status===403||e.status===404);
});
