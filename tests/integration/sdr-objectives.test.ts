import test,{after,beforeEach} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
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
type Fix={p:Principal;connection:string;sender:string;identity:string;conversation:string;phone:string};
async function fixture(o:{phone?:string;draft?:Partial<ReturnType<typeof defaultSdrDraft>>}={}):Promise<Fix>{
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
const lead=(f:Fix,payload:Record<string,unknown>)=>testAdmin(async c=>{const list=randomUUID(),id=randomUUID();
 await c.query('INSERT INTO app.list(workspace_id,id,name) VALUES($1,$2,$3)',[f.p.workspaceId,list,'QA']);
 await c.query('INSERT INTO app.lead(workspace_id,id,list_id,payload) VALUES($1,$2,$3,$4)',[f.p.workspaceId,id,list,{id,name:'QA lead',listId:list,...payload}]);return id;});
const ensure=async(f:Fix)=>(await workerPool().query('SELECT app.sdr_ensure_lead($1,$2) v',[f.p.workspaceId,f.conversation])).rows[0].v as {leadId:string|null;mode:string};
const linked=(f:Fix)=>testAdmin(async c=>(await c.query('SELECT lead_id FROM app.channel_conversation WHERE id=$1',[f.conversation])).rows[0].lead_id as string|null);
const inbound=(f:Fix,text:string)=>testAdmin(async c=>(await c.query("INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,state,text,occurred_at) VALUES($1,gen_random_uuid()::text,$2,$3,$4,$5,'inbound','received',$6,now()) RETURNING id",[f.p.workspaceId,f.connection,f.sender,f.identity,f.conversation,text])).rows[0].id as string);
const IN=new Date();

test('the lead is linked whatever way its phone was typed',async()=>{
 for(const typed of ['21964342764','+55 21 96434-2764','5521964342764']){
  const f=await fixture({phone:'+5521964342764'}),id=await lead(f,{phone:typed});
  assert.deepEqual(await ensure(f),{leadId:id,mode:'linked'},typed);assert.equal(await linked(f),id);
  assert.deepEqual(await ensure(f),{leadId:id,mode:'existing'});
 }
});
test('an unknown number gets a new lead in the Agente SDR list',async()=>{
 const f=await fixture(),r=await ensure(f);assert.equal(r.mode,'created');
 const row=await testAdmin(async c=>(await c.query('SELECT l.payload,li.name FROM app.lead l JOIN app.list li ON li.workspace_id=l.workspace_id AND li.id=l.list_id WHERE l.id=$1',[r.leadId])).rows[0]);
 assert.equal(row.name,'Agente SDR');assert.equal(row.payload.source,'sdr');assert.equal(row.payload.phone,f.phone);assert.equal(await linked(f),r.leadId);
});
test('two leads with the same phone link nothing',async()=>{
 const f=await fixture();await lead(f,{phone:f.phone});await lead(f,{phone:f.phone.slice(3)});
 assert.deepEqual(await ensure(f),{leadId:null,mode:'ambiguous'});assert.equal(await linked(f),null);
});
async function claimAndFinish(f:Fix,decision:string,progress:unknown,text='Olá!'){
 const msg=await inbound(f,'Somos 5 pessoas, e-mail b@x.com');const token=randomUUID();
 const claim=(await workerPool().query('SELECT app.sdr_claim_turn($1,$2,$3) v',[token,IN,f.p.workspaceId])).rows[0].v;assert.ok(claim,'a turn is claimed');
 await workerPool().query('SELECT app.sdr_finish_turn($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[f.p.workspaceId,claim.turnId,token,decision,text,'[]',null,null,IN,null,JSON.stringify({sources:[],alerts:[],summary:'s',facts:[]}),JSON.stringify(progress)]);
 return {claim,msg};
}
test('finishing a turn fills only empty lead fields and keeps conflicts',async()=>{
 const f=await fixture(),id=await lead(f,{phone:f.phone,email:'a@x.com'});await ensure(f);
 await claimAndFinish(f,'reply',{stage:'qualified',answers:{porte:{value:'5',messageId:'m'}},attempts:{},asked:null,offer:null,contact:{name:'Ana',email:'b@x.com',phone:'',company:'Nexus',messageId:'m'},profile:{pain:'Retrabalho',plan:'Automação',nextStep:'Reunião'},status:'Qualificado'});
 const p=await testAdmin(async c=>(await c.query('SELECT payload FROM app.lead WHERE id=$1',[id])).rows[0].payload);
 assert.equal(p.email,'a@x.com');assert.equal(p.companyName,'Nexus');assert.equal(p.sdrProfile.personName,'Ana');assert.equal(p.sdrProfile.info,'porte: 5');assert.equal(p.sdrProfile.status,'Qualificado');
 const s=await testAdmin(async c=>(await c.query('SELECT stage,conflicts FROM app.sdr_thread_state WHERE conversation_id=$1',[f.conversation])).rows[0]);
 assert.equal(s.stage,'qualified');assert.deepEqual(s.conflicts,[{field:'email',value:'b@x.com',current:'a@x.com'}]);
 await withWorkspaceTransaction(f.p,c=>c.query('SELECT app.sdr_apply_conflict($1,$2)',[f.conversation,'email']));
 const after=await testAdmin(async c=>(await c.query('SELECT l.payload->>\'email\' e,s.conflicts FROM app.lead l,app.sdr_thread_state s WHERE l.id=$1 AND s.conversation_id=$2',[id,f.conversation])).rows[0]);
 assert.equal(after.e,'b@x.com');assert.deepEqual(after.conflicts,[]);
});
test('progress is not written by a lost or superseded turn',async()=>{
 const f=await fixture();await ensure(f);
 const msg=await inbound(f,'Oi');const token=randomUUID();
 const claim=(await workerPool().query('SELECT app.sdr_claim_turn($1,$2,$3) v',[token,IN,f.p.workspaceId])).rows[0].v;
 await inbound(f,'Mais uma');// a newer inbound supersedes the claimed turn
 await workerPool().query('SELECT app.sdr_finish_turn($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[f.p.workspaceId,claim.turnId,token,'reply','Olá','[]',null,null,IN,null,null,JSON.stringify({stage:'done',answers:{},attempts:{},asked:null,offer:null})]);
 const s=await testAdmin(async c=>(await c.query('SELECT stage FROM app.sdr_thread_state WHERE conversation_id=$1',[f.conversation])).rows[0]);
 assert.notEqual(s?.stage,'done');void msg;
});
import {runSdrTick} from '../../src/server/sdr/worker.ts';
const route={provider:'openai' as const,model:'qa',configFingerprint:'qa',contractVersion:'conventional-v1' as const};
const asMeetings=(f:Fix)=>testAdmin(c=>c.query("UPDATE app.sdr_agent_revision SET config=jsonb_set(config,'{objective}','\"meetings\"') WHERE workspace_id=$1",[f.p.workspaceId]));
test('a qualified meetings agent offers real slots',async()=>{
 const f=await fixture({draft:{qualification:[{question:'Porte?',field:'porte',required:false}]}});await asMeetings(f);await inbound(f,'Quero conhecer a solução');
 const slots=Array.from({length:8},(_,i)=>({start:new Date(Date.UTC(2030,0,7+Math.floor(i/4),12+i%4)).toISOString(),end:new Date(Date.UTC(2030,0,7+Math.floor(i/4),12+i%4,30)).toISOString()}));
 const seen:{offer?:any}={};
 await runSdrTick({limit:5,now:IN,workspaceId:f.p.workspaceId},{route,slots:async()=>({timezone:'America/Sao_Paulo',slots}),
  generate:async(_c:any,r:any)=>{const offer=JSON.parse(r.prompt).offer;seen.offer=offer;return {value:r.parse({reply:'Tenho '+offer.slots[0].label+' ou '+offer.slots[4].label+'. Qual fica melhor?',decision:'reply',fields:[],action:'none',quote:'',offered:['s1','s5']}),usage:{provider:'openai'}};}});
 const s=await testAdmin(async c=>(await c.query('SELECT s.stage,s.offer,t.state FROM app.sdr_thread_state s JOIN app.sdr_turn t ON t.conversation_id=s.conversation_id WHERE s.conversation_id=$1',[f.conversation])).rows[0]);
 assert.equal(s.state,'pending-approval');assert.equal(s.stage,'offer');assert.equal(s.offer.slots.length,6);assert.equal(seen.offer.slots.length,6);
 assert.ok(await linked(f),'the conversation got a lead');
});
