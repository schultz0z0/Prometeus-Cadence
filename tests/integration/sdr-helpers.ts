// Shared SDR integration fixtures (moved from sdr-objectives.test.ts, 16/11/2026).
import {after,before,beforeEach} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {resetRateLimits} from './helpers.ts';
import {testAdmin,closeProspectingPools} from './prospecting-helpers.ts';
import {verifiedMetaFixture} from './whatsapp-helpers.ts';
import {defaultSdrDraft} from '../../src/domain/sdr-policy.ts';
import {saveSdrAgent,prepareSdrActivation,confirmSdrActivation} from '../../src/server/sdr/configuration.ts';
import {workerPool} from '../../src/server/prospecting/worker-db.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import type {Principal} from '../../src/domain/workspace.ts';
after(closeProspectingPools);
beforeEach(resetRateLimits);
// 16/11/2026: SDR objectives — stage state, automatic lead link and lead record updates.
export type Fix={p:Principal;connection:string;sender:string;identity:string;conversation:string;phone:string};
export async function fixture(o:{phone?:string;draft?:Partial<ReturnType<typeof defaultSdrDraft>>}={}):Promise<Fix>{
 const m=await verifiedMetaFixture(),p=m.u.p,identity=randomUUID(),conversation=randomUUID(),phone=o.phone??'+55119'+String(Math.floor(1e7+Math.random()*8e7));
 await testAdmin(async c=>{
  await c.query("UPDATE app.billing_account SET state='active',plan='pro',period_start=now(),period_end=now()+interval '30 days' WHERE workspace_id=$1",[p.workspaceId]);
  await c.query("INSERT INTO app.billing_grant(workspace_id,id,unit,quantity,source,external_ref,expires_at) VALUES($1,$2,'sdr',5,'plan',$2,now()+interval '30 days')",[p.workspaceId,randomUUID()]);
  await c.query("INSERT INTO app.context_version(workspace_id,version,payload) VALUES($1,1,$2)",[p.workspaceId,{name:'[RE] QA',offer:'Consultoria',approvedAt:new Date().toISOString()}]);
  await c.query("INSERT INTO app.messaging_limits(workspace_id,workspace_daily_limit,timezone) VALUES($1,100,'UTC') ON CONFLICT DO NOTHING",[p.workspaceId]);
  await c.query("UPDATE app.channel_sender SET daily_limit=100,ready=true WHERE workspace_id=$1",[p.workspaceId]);await c.query("UPDATE app.channel_connection SET state='ready',challenge_verified=true,inbound_verified=true WHERE workspace_id=$1",[p.workspaceId]);
  await c.query("INSERT INTO app.channel_identity(workspace_id,id,scope,external_id,phone) VALUES($1,$2,(SELECT identity_scope FROM app.channel_sender WHERE id=$3),$4,$5)",[p.workspaceId,identity,m.sender.id,phone.slice(1),phone]);
  await c.query("INSERT INTO app.channel_conversation(workspace_id,id,connection_id,sender_id,identity_id,channel,last_inbound_at,last_message_at) VALUES($1,$2,$3,$4,$5,'WHATSAPP',now(),now())",[p.workspaceId,conversation,m.connection.id,m.sender.id,identity]);
 });
 const draft={...defaultSdrDraft(),name:'[RE] Agente',instructions:'Somos a [RE] QA.',channelIds:[m.connection.id],handoff:{memberId:p.userId,rules:['Pediu proposta']},hours:{timezone:'America/Sao_Paulo',weekdays:[0,1,2,3,4,5,6],start:'00:00',end:'23:59',allDay:true},qualification:[{question:'Porte?',field:'porte',required:true}],...o.draft};
 const a=await saveSdrAgent(p,{expectedRevision:0,draft}),r=await prepareSdrActivation(p,{agentId:a.id,revision:a.revision});assert.deepEqual(r.blockers,[]);
 await confirmSdrActivation(p,{agentId:a.id,revision:a.revision,token:r.token,requestId:randomUUID()});
 await testAdmin(c=>c.query("UPDATE app.sdr_channel_binding SET created_at=now()-interval '1 hour' WHERE workspace_id=$1",[p.workspaceId]));
 return {p,connection:m.connection.id,sender:m.sender.id,identity,conversation,phone};
}
export const lead=(f:Fix,payload:Record<string,unknown>)=>testAdmin(async c=>{const list=randomUUID(),id=randomUUID();
 await c.query('INSERT INTO app.list(workspace_id,id,name) VALUES($1,$2,$3)',[f.p.workspaceId,list,'QA']);
 await c.query('INSERT INTO app.lead(workspace_id,id,list_id,payload) VALUES($1,$2,$3,$4)',[f.p.workspaceId,id,list,{id,name:'QA lead',listId:list,...payload}]);return id;});
export const ensure=async(f:Fix)=>(await workerPool().query('SELECT app.sdr_ensure_lead($1,$2) v',[f.p.workspaceId,f.conversation])).rows[0].v as {leadId:string|null;mode:string};
export const linked=(f:Fix)=>testAdmin(async c=>(await c.query('SELECT lead_id FROM app.channel_conversation WHERE id=$1',[f.conversation])).rows[0].lead_id as string|null);
export const inbound=(f:Fix,text:string)=>testAdmin(async c=>(await c.query("INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,state,text,occurred_at) VALUES($1,gen_random_uuid()::text,$2,$3,$4,$5,'inbound','received',$6,now()) RETURNING id",[f.p.workspaceId,f.connection,f.sender,f.identity,f.conversation,text])).rows[0].id as string);
export const IN=new Date();
import {runSdrTick} from '../../src/server/sdr/worker.ts';
export const route={provider:'openai' as const,model:'qa',configFingerprint:'qa',contractVersion:'conventional-v1' as const};
export const asMeetings=(f:Fix)=>testAdmin(c=>c.query("UPDATE app.sdr_agent_revision SET config=jsonb_set(config,'{objective}','\"meetings\"') WHERE workspace_id=$1",[f.p.workspaceId]));
import {fakeCalendar} from './calendar-helpers.ts';
import {base} from './helpers.ts';
import {startCalendarAuthorization,finishCalendarAuthorization,configureCalendar,readCalendarSlots} from '../../src/server/integrations/calendar.ts';
import {readSdrConversation,prepareSdrReply,approveSdrReply} from '../../src/server/sdr/conversation.ts';
export const callback=base+'/api/integration-oauth/google-calendar/callback',calEnv={GOOGLE_CALENDAR_CLIENT_ID:'client-qa',GOOGLE_CALENDAR_CLIENT_SECRET:'secret-qa',GOOGLE_CALENDAR_REDIRECT_URI:callback};
const savedEnv:Record<string,string|undefined>={};
before(()=>{for(const [k,v] of Object.entries(calEnv)){savedEnv[k]=process.env[k];process.env[k]=v;}});
after(()=>{for(const k of Object.keys(calEnv)){if(savedEnv[k]===undefined)delete process.env[k];else process.env[k]=savedEnv[k];}});
export async function calendarOn(p:Principal,noticeHours=0){const g=fakeCalendar(),u=new URL((await startCalendarAuthorization(p,p.sessionId)).authorizationUrl);
 await finishCalendarAuthorization(p,p.sessionId,new URL(callback+'?state='+u.searchParams.get('state')+'&code=code-qa'),g.deps);
 await configureCalendar(p,{timezone:'America/Sao_Paulo',weekdays:[0,1,2,3,4,5,6],start:'00:00',end:'23:30',durationMinutes:30,noticeHours,horizonDays:3,expectedRevision:0},g.deps);return g;}
/** A meetings conversation whose latest draft carries the lead's choice of the first offered slot. */
export async function meetingTurn(email?:string,o:{noticeHours?:number;managed?:boolean;draft?:Record<string,unknown>}={}){
 const f=await fixture({draft:{qualification:[{question:'Porte?',field:'porte',required:false}],...o.draft}});await asMeetings(f);const g=await calendarOn(f.p,o.noticeHours??0);
 // The managed WhatsApp (OpenWA) sends without a service window; Meta does not.
 if(o.managed)await testAdmin(c=>c.query(`UPDATE app.channel_sender SET capabilities=capabilities||'{"requiresServiceWindow":false}' WHERE workspace_id=$1`,[f.p.workspaceId]));
 const leadId=await lead(f,{phone:f.phone,...(email?{email}:{})});await ensure(f);
 const deps={route,slots:async()=>{const r=await readCalendarSlots(f.p,{},g.deps);return {timezone:r.timezone,slots:r.slots.map(x=>({start:x.start,end:x.end}))};}};
 let label='';
 await inbound(f,'Quero uma demonstração');
 await runSdrTick({limit:5,now:IN,workspaceId:f.p.workspaceId},{...deps,generate:async(_c:any,r:any)=>{label=JSON.parse(r.prompt).offer.slots[0].label;return {value:r.parse({reply:'Tenho '+label+'. Pode ser?',decision:'reply',fields:[],action:'none',quote:'',offered:['s1']}),usage:{provider:'openai'}};}});
 const first=(await readSdrConversation(f.p,f.conversation)).turn!;await testAdmin(c=>c.query("UPDATE app.sdr_turn SET state='superseded' WHERE id=$1",[first.id]));
 await inbound(f,'Pode ser esse');
 const text='Combinado: '+label+' (horário de Brasília), 30 minutos pelo Google Meet.';
 await runSdrTick({limit:5,now:IN,workspaceId:f.p.workspaceId},{...deps,generate:async(_c:any,r:any)=>({value:r.parse({reply:text,decision:'reply',fields:[],action:'none',quote:'',chosen:'s1'}),usage:{provider:'openai'}})});
 const turn=(await readSdrConversation(f.p,f.conversation)).turn!;assert.equal((turn.proposal as any)?.kind,'meeting');
 return {f,g,turn,text,leadId};
}
export const approve=async(m:Awaited<ReturnType<typeof meetingTurn>>,text=m.text)=>{const review=await prepareSdrReply(m.f.p,m.f.conversation,{turnId:m.turn.id,text});
 return approveSdrReply(m.f.p,m.f.conversation,{turnId:m.turn.id,text,reviewToken:review.review.token,requestId:randomUUID()},m.g.deps);};
export const stageOf=(f:Fix)=>testAdmin(async c=>(await c.query('SELECT stage FROM app.sdr_thread_state WHERE conversation_id=$1',[f.conversation])).rows[0].stage as string);
export const outbox=(f:Fix)=>testAdmin(async c=>Number((await c.query('SELECT count(*) n FROM app.message_outbox WHERE workspace_id=$1',[f.p.workspaceId])).rows[0].n));
