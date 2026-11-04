import test,{after,beforeEach} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {base,resetRateLimits} from './helpers.ts';
import {testAdmin,closeProspectingPools} from './prospecting-helpers.ts';
import {verifiedMetaFixture} from './whatsapp-helpers.ts';
import {defaultSdrDraft} from '../../src/domain/sdr-policy.ts';
import {saveSdrAgent,prepareSdrActivation,confirmSdrActivation} from '../../src/server/sdr/configuration.ts';
import {runSdrTick,type SdrWorkerDeps} from '../../src/server/sdr/worker.ts';
import {readSdrConversation,listSdrPending,takeOverSdr,resumeSdr,retrySdrTurn,prepareSdrReply,approveSdrReply,rejectSdrReply} from '../../src/server/sdr/conversation.ts';
import {sdrConversationRequest} from '../../src/server/sdr/http.ts';
import type {Principal} from '../../src/domain/workspace.ts';
after(closeProspectingPools);
beforeEach(resetRateLimits);
const IN_HOURS=new Date('2026-11-04T15:00:00Z'),route={provider:'openai' as const,model:'qa',configFingerprint:'qa',contractVersion:'conventional-v1' as const};
const reply=(text='Olá! Quantas pessoas tem o seu time?',decision='reply',fields:unknown[]=[{field:'porte',value:'10'}])=>({reply:text,decision,fields});
const gen=(out:unknown,seen?:{n:number;prompt?:string}):SdrWorkerDeps=>({route,generate:async(_c,r)=>{if(seen){seen.n++;seen.prompt=r.prompt;}return{value:r.parse(out),usage:{provider:'openai'}};}});
const rows=(t:string,ws:string,where='')=>testAdmin(async c=>Number((await c.query(`SELECT count(*) FROM app.${t} WHERE workspace_id=$1 ${where}`,[ws])).rows[0].count));
const inbound=(f:Fix,text:string)=>testAdmin(async c=>(await c.query("INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,state,text,occurred_at) VALUES($1,gen_random_uuid()::text,$2,$3,$4,$5,'inbound','received',$6,now()) RETURNING id",[f.p.workspaceId,f.connection,f.sender,f.identity,f.conversation,text])).rows[0].id as string);
type Fix={p:Principal;connection:string;sender:string;identity:string;conversation:string;agent:string};
async function fixture(o:{quota?:number}={}):Promise<Fix>{
 const m=await verifiedMetaFixture(),p=m.u.p,identity=randomUUID(),conversation=randomUUID();
 await testAdmin(async c=>{
  await c.query("UPDATE app.billing_account SET state='active',plan='pro',period_start=now(),period_end=now()+interval '30 days' WHERE workspace_id=$1",[p.workspaceId]);
  if(o.quota!==0)await c.query("INSERT INTO app.billing_grant(workspace_id,id,unit,quantity,source,external_ref,expires_at) VALUES($1,$2,'sdr',$3,'plan',$2,now()+interval '30 days')",[p.workspaceId,randomUUID(),o.quota??5]);
  await c.query("INSERT INTO app.context_version(workspace_id,version,payload) VALUES($1,1,$2)",[p.workspaceId,{name:'[RE] QA',offer:'Consultoria',approvedAt:new Date().toISOString()}]);
  await c.query("INSERT INTO app.messaging_limits(workspace_id,workspace_daily_limit,timezone) VALUES($1,100,'UTC') ON CONFLICT DO NOTHING",[p.workspaceId]);
  await c.query("UPDATE app.channel_sender SET daily_limit=100,ready=true WHERE workspace_id=$1",[p.workspaceId]);await c.query("UPDATE app.channel_connection SET state='ready',challenge_verified=true,inbound_verified=true WHERE workspace_id=$1",[p.workspaceId]);
  await c.query("INSERT INTO app.channel_identity(workspace_id,id,scope,external_id,phone) VALUES($1,$2,(SELECT identity_scope FROM app.channel_sender WHERE id=$3),$4,$5)",[p.workspaceId,identity,m.sender.id,'5511'+Math.floor(Math.random()*1e9),'+5511'+Math.floor(1e8+Math.random()*8e8)]);
  await c.query("INSERT INTO app.channel_conversation(workspace_id,id,connection_id,sender_id,identity_id,channel,last_inbound_at,last_message_at) VALUES($1,$2,$3,$4,$5,'WHATSAPP',now(),now())",[p.workspaceId,conversation,m.connection.id,m.sender.id,identity]);
 });
 const draft={...defaultSdrDraft(),name:'[RE] Agente',instructions:'Somos a [RE] QA.',channelIds:[m.connection.id],handoff:{memberId:p.userId,rules:['Pediu proposta']},hours:{timezone:'America/Sao_Paulo',weekdays:[0,1,2,3,4,5,6],start:'00:00',end:'23:59',allDay:true},qualification:[{question:'Porte?',field:'porte',required:true}]};
 const a=await saveSdrAgent(p,{expectedRevision:0,draft}),r=await prepareSdrActivation(p,{agentId:a.id,revision:a.revision});assert.deepEqual(r.blockers,[]);
 await confirmSdrActivation(p,{agentId:a.id,revision:a.revision,token:r.token,requestId:randomUUID()});
 await testAdmin(c=>c.query("UPDATE app.sdr_channel_binding SET created_at=now()-interval '1 hour' WHERE workspace_id=$1",[p.workspaceId]));
 return {p,connection:m.connection.id,sender:m.sender.id,identity,conversation,agent:a.id};
}
const tick=(deps:SdrWorkerDeps,now=IN_HOURS,workspaceId?:string)=>runSdrTick({limit:5,now,workspaceId},deps);

test('07B.2 one inbound makes one turn and one AI call; the draft waits; nothing is queued',async()=>{
 const f=await fixture(),seen={n:0} as {n:number;prompt?:string};await inbound(f,'Quanto custa?');
 const before=await rows('message_outbox',f.p.workspaceId);
 assert.equal((await tick(gen(reply(),seen),IN_HOURS,f.p.workspaceId)).processed,1);
 await tick(gen(reply(),seen),IN_HOURS,f.p.workspaceId);
 assert.equal(seen.n,1,'repeating the tick does not call the AI again');assert.match(seen.prompt!,/Quanto custa\?/);assert.match(seen.prompt!,/\[RE\] QA/);
 const v=await readSdrConversation(f.p,f.conversation);
 assert.equal(v.owner,'agent');assert.equal(v.turn!.state,'pending-approval');assert.equal(v.turn!.text,'Olá! Quantas pessoas tem o seu time?');assert.deepEqual(v.turn!.fields,[{field:'porte',value:'10'}]);
 assert.equal(await rows('message_outbox',f.p.workspaceId),before,'no reply without a person');
 assert.equal((await listSdrPending(f.p)).items[0].conversationId,f.conversation);
 assert.equal(await rows('notification_item',f.p.workspaceId,"AND event_type='approval'"),1);
 // Only the latest inbound answers: a burst before the tick makes one turn.
 await inbound(f,'um');await inbound(f,'dois');seen.n=0;await tick(gen(reply(),seen),IN_HOURS,f.p.workspaceId);
 assert.equal(seen.n,1);assert.equal(await rows('sdr_turn',f.p.workspaceId),2);
 assert.equal((await readSdrConversation(f.p,f.conversation)).turn!.state,'pending-approval');
 assert.equal(await rows('sdr_turn',f.p.workspaceId,"AND state='superseded'"),1,'the older draft is out');
});

test('07B.2 approving queues the edited text once and consumes one unit; a repeat changes nothing',async()=>{
 const f=await fixture({quota:3});await inbound(f,'Quanto custa?');await tick(gen(reply()),IN_HOURS,f.p.workspaceId);
 const turn=(await readSdrConversation(f.p,f.conversation)).turn!,text='Olá! Texto editado pela pessoa.';
 const review=await prepareSdrReply(f.p,f.conversation,{turnId:turn.id,text});assert.deepEqual(review.review.blockers,[]);
 const requestId=randomUUID(),one=await approveSdrReply(f.p,f.conversation,{turnId:turn.id,text,reviewToken:review.review.token,requestId});
 assert.equal(one.state,'sent');assert.ok(one.messageId);
 const two=await approveSdrReply(f.p,f.conversation,{turnId:turn.id,text,reviewToken:review.review.token,requestId});assert.equal(two.messageId,one.messageId);
 assert.equal(await rows('channel_message',f.p.workspaceId,"AND direction='outbound' AND text='"+text+"'"),1);
 assert.equal(await testAdmin(async c=>(await c.query("SELECT sum(spent)::int s,sum(held)::int h FROM app.billing_grant WHERE workspace_id=$1 AND unit='sdr'",[f.p.workspaceId])).rows[0].s),1);
 assert.equal(await testAdmin(async c=>(await c.query("SELECT sum(held)::int h FROM app.billing_grant WHERE workspace_id=$1 AND unit='sdr'",[f.p.workspaceId])).rows[0].h),0);
 assert.equal((await readSdrConversation(f.p,f.conversation)).owner,'agent','approving does not take the conversation over');
});

test('07B.2 a person taking over during the AI call: the answer is dropped, the receipt stays, the unit is released',async()=>{
 const f=await fixture({quota:3});await inbound(f,'Oi');
 const v0=await readSdrConversation(f.p,f.conversation);
 const deps:SdrWorkerDeps={route,generate:async(_c,r)=>{await takeOverSdr(f.p,f.conversation,{expectedRevision:v0.revision});return{value:r.parse(reply()),usage:{provider:'openai',inputTokens:3}};}};
 await tick(deps,IN_HOURS,f.p.workspaceId);
 const v=await readSdrConversation(f.p,f.conversation);assert.equal(v.owner,'human');assert.equal(v.turn!.state,'superseded');
 assert.ok(await testAdmin(async c=>(await c.query('SELECT usage FROM app.sdr_turn WHERE workspace_id=$1',[f.p.workspaceId])).rows[0].usage),'technical receipt kept');
 assert.equal(await rows('billing_grant',f.p.workspaceId,"AND unit='sdr' AND (held>0 OR spent>0)"),0);
 // While human-owned nothing new runs; resuming lets the next inbound through.
 const seen={n:0};await inbound(f,'Mais uma');await tick(gen(reply(),seen),IN_HOURS,f.p.workspaceId);assert.equal(seen.n,0);
 await resumeSdr(f.p,f.conversation,{expectedRevision:v.revision});await tick(gen(reply(),seen),IN_HOURS,f.p.workspaceId);assert.equal(seen.n,1);
});

test('07B.2 handoff, abstention, rejection and AI failure',async()=>{
 const f=await fixture({quota:3});await inbound(f,'Quero proposta fechada');
 await tick(gen(reply('Vou chamar alguém do time.','handoff',[])),IN_HOURS,f.p.workspaceId);
 let v=await readSdrConversation(f.p,f.conversation);assert.equal(v.owner,'human');assert.equal(v.turn!.state,'handed-off');
 assert.equal(await rows('notification_item',f.p.workspaceId,"AND event_type='handoff'"),1);
 await resumeSdr(f.p,f.conversation,{expectedRevision:v.revision});await inbound(f,'Outra coisa');
 await tick(gen(reply('','abstain',[])),IN_HOURS,f.p.workspaceId);assert.equal((await readSdrConversation(f.p,f.conversation)).turn!.state,'abstained');
 assert.equal(await rows('billing_grant',f.p.workspaceId,"AND unit='sdr' AND (held>0 OR spent>0)"),0,'abstaining costs nothing');
 // A failed call stays uncertain, holds the reservation and is not retried blindly.
 await inbound(f,'Terceira');const seen={n:0};
 await tick({route,generate:async()=>{seen.n++;throw Error('timeout');}},IN_HOURS,f.p.workspaceId);await tick({route,generate:async()=>{seen.n++;throw Error('timeout');}},IN_HOURS,f.p.workspaceId);
 const u=(await readSdrConversation(f.p,f.conversation)).turn!;assert.equal(u.state,'uncertain');assert.equal(seen.n,1);
 assert.equal(await rows('billing_grant',f.p.workspaceId,"AND unit='sdr' AND held=1"),1);
 await retrySdrTurn(f.p,f.conversation,{turnId:u.id});await tick(gen(reply()),IN_HOURS,f.p.workspaceId);
 const d=(await readSdrConversation(f.p,f.conversation)).turn!;assert.equal(d.id,u.id);assert.equal(d.state,'pending-approval');
 assert.equal(await rows('billing_grant',f.p.workspaceId,"AND unit='sdr' AND held=1"),1,'the retry does not hold twice');
 assert.equal((await rejectSdrReply(f.p,f.conversation,{turnId:d.id})).state,'rejected');
 assert.equal(await rows('billing_grant',f.p.workspaceId,"AND unit='sdr' AND (held>0 OR spent>0)"),0);
 await assert.rejects(rejectSdrReply(f.p,f.conversation,{turnId:d.id}),{status:409});
});

test('07B.2 hours: agent timezone, weekdays, end is closed, all day keeps weekdays',async()=>{
 const h={timezone:'America/Sao_Paulo',weekdays:[1,2,3,4,5],start:'09:00',end:'18:00',allDay:false};
 const at=(v:object,t:string)=>testAdmin(async c=>(await c.query('SELECT app.sdr_within_hours($1,$2) v',[v,t])).rows[0].v as boolean);
 assert.equal(await at(h,'2026-11-04T12:00:00Z'),true,'Wed 09:00 in Brasília');assert.equal(await at(h,'2026-11-04T11:59:00Z'),false);
 assert.equal(await at(h,'2026-11-04T21:00:00Z'),false,'18:00 is closed');assert.equal(await at(h,'2026-11-07T15:00:00Z'),false,'Saturday');
 assert.equal(await at({...h,allDay:true},'2026-11-05T02:00:00Z'),true,'Wed 23:00');assert.equal(await at({...h,allDay:true},'2026-11-07T15:00:00Z'),false);
});

test('07B.2 gates: no quota, opt-out, out of hours, daily limit, paused agent, no AI route, old messages',async()=>{
 const none=await fixture({quota:0});await inbound(none,'Oi');const seen={n:0};
 await tick(gen(reply(),seen),IN_HOURS,none.p.workspaceId);assert.equal(seen.n,0,'no franchise, no AI');
 const b=(await readSdrConversation(none.p,none.conversation)).turn!;assert.equal(b.state,'blocked');assert.equal(b.reason,'SDR_QUOTA');
 const f=await fixture();
 // A message from before the activation is not picked up.
 await testAdmin(async c=>{await c.query("INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,state,text,occurred_at,created_at) VALUES($1,gen_random_uuid()::text,$2,$3,$4,$5,'inbound','received','velha',now()-interval '1 day',now()-interval '1 day')",[f.p.workspaceId,f.connection,f.sender,f.identity,f.conversation]);});
 await tick(gen(reply(),seen),IN_HOURS,f.p.workspaceId);assert.equal(seen.n,0);
 await inbound(f,'Pode parar');
 await testAdmin(c=>c.query("INSERT INTO app.contact_suppression(workspace_id,identity_id,scope,reason) VALUES($1,$2,'all','qa')",[f.p.workspaceId,f.identity]));
 await tick(gen(reply(),seen),IN_HOURS,f.p.workspaceId);assert.equal(seen.n,0,'opt-out is final');
 await testAdmin(c=>c.query('DELETE FROM app.contact_suppression WHERE workspace_id=$1',[f.p.workspaceId]));
 // Opt-out arriving during the AI call drops the answer too.
 await tick({route,generate:async(_c,r)=>{await testAdmin(c=>c.query("INSERT INTO app.contact_suppression(workspace_id,identity_id,scope,reason) VALUES($1,$2,'all','qa')",[f.p.workspaceId,f.identity]));return{value:r.parse(reply()),usage:{provider:'openai'}};}},IN_HOURS,f.p.workspaceId);
 assert.equal((await readSdrConversation(f.p,f.conversation)).turn!.state,'superseded');
 await testAdmin(c=>c.query('DELETE FROM app.contact_suppression WHERE workspace_id=$1',[f.p.workspaceId]));
 // Out of hours nothing runs; in hours it does.
 const hours=(p:Principal,o:Record<string,unknown>)=>testAdmin(c=>c.query("UPDATE app.sdr_agent_revision SET config=jsonb_set(config,'{hours}',$2) WHERE workspace_id=$1",[p.workspaceId,o]));
 await hours(f.p,{timezone:'America/Sao_Paulo',weekdays:[3],start:'09:00',end:'18:00',allDay:false});await inbound(f,'Fora do horário');seen.n=0;
 await tick(gen(reply(),seen),new Date('2026-11-04T23:00:00Z'),f.p.workspaceId);assert.equal(seen.n,0);
 await tick(gen(reply(),seen),IN_HOURS,f.p.workspaceId);assert.equal(seen.n,1);
 // Daily limit of the agent.
 await testAdmin(async c=>{await c.query("UPDATE app.sdr_agent_revision SET config=jsonb_set(config,'{maxRepliesPerDay}','1') WHERE workspace_id=$1",[f.p.workspaceId]);await c.query("UPDATE app.sdr_turn SET state='sent' WHERE workspace_id=$1 AND state='pending-approval'",[f.p.workspaceId]);});
 await inbound(f,'Depois do teto');seen.n=0;await tick(gen(reply(),seen),IN_HOURS,f.p.workspaceId);
 assert.equal(seen.n,0);assert.equal((await readSdrConversation(f.p,f.conversation)).turn!.reason,'DAILY_LIMIT');
 // No AI route: blocked without a call, reservation released.
 const g=await fixture({quota:2});await inbound(g,'Oi');await tick({route:null},IN_HOURS,g.p.workspaceId);
 assert.equal((await readSdrConversation(g.p,g.conversation)).turn!.reason,'AI_UNAVAILABLE');assert.equal(await rows('billing_grant',g.p.workspaceId,"AND unit='sdr' AND held>0"),0);
});

test('07B.2 isolation and authority: other workspace, removed member, direct SQL, HTTP, manual reply',async()=>{
 const f=await fixture(),g=await fixture();await inbound(f,'Segredo de F');await inbound(g,'Mensagem de G');
 const seen={n:0} as {n:number;prompt?:string};await tick(gen(reply(),seen),IN_HOURS,g.p.workspaceId);assert.doesNotMatch(seen.prompt!,/Segredo de F/);
 await assert.rejects(readSdrConversation(g.p,f.conversation),{status:404});
 await assert.rejects(takeOverSdr(g.p,f.conversation,{expectedRevision:0}),{status:404});
 await tick(gen(reply()),IN_HOURS,f.p.workspaceId);const t=(await readSdrConversation(f.p,f.conversation)).turn!;
 await assert.rejects(rejectSdrReply(g.p,f.conversation,{turnId:t.id}),{status:404});
 await assert.rejects(prepareSdrReply(f.p,f.conversation,{turnId:randomUUID(),text:'x'}),{status:404});
 assert.equal((await sdrConversationRequest(new Request(base+'/api/sdr/conversations/'+f.conversation))).status,401);
 // A manual reply through the inbox takes the conversation over and drops the pending draft.
 const {manualReplyHooks}=await import('../../src/server/sdr/conversation.ts'),{prepareReply,confirmReply}=await import('../../src/server/messaging/replies.ts'),mr=await prepareReply(f.p,f.conversation,{content:{kind:'text',text:'Eu respondo'}});await confirmReply(f.p,f.conversation,{content:{kind:'text',text:'Eu respondo'},requestId:randomUUID(),reviewToken:mr.token},manualReplyHooks(f.conversation));
 const v=await readSdrConversation(f.p,f.conversation);assert.equal(v.owner,'human');assert.equal(v.turn!.state,'superseded');
 await testAdmin(c=>c.query('DELETE FROM auth.member WHERE "organizationId"=$1 AND "userId"=$2',[g.p.workspaceId,g.p.userId]));
 await assert.rejects(readSdrConversation(g.p,g.conversation),{status:403});
});

test('07B.2 review: fairness, gates on retry and approval, worker lost, purge, pause, retention and HTTP',async()=>{
 // H1: a workspace full of out-of-hours conversations does not starve another one.
 const a=await fixture(),b=await fixture();
 await testAdmin(async c=>{
  await c.query("UPDATE app.sdr_agent_revision SET config=jsonb_set(config,'{hours}',$2) WHERE workspace_id=$1",[a.p.workspaceId,{timezone:'America/Sao_Paulo',weekdays:[6],start:'09:00',end:'10:00',allDay:false}]);
  for(let i=0;i<51;i++){const id=randomUUID(),conv=randomUUID();
   await c.query("INSERT INTO app.channel_identity(workspace_id,id,scope,external_id) VALUES($1,$2,'qa-bulk',$2)",[a.p.workspaceId,id]);
   await c.query("INSERT INTO app.channel_conversation(workspace_id,id,connection_id,sender_id,identity_id,channel) VALUES($1,$2,$3,$4,$5,'WHATSAPP')",[a.p.workspaceId,conv,a.connection,a.sender,id]);
   await c.query("INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,state,text,occurred_at) VALUES($1,gen_random_uuid()::text,$2,$3,$4,$5,'inbound','received','fora',now())",[a.p.workspaceId,a.connection,a.sender,id,conv]);}
 });
 await inbound(b,'Mensagem de B');const seenB={n:0};await runSdrTick({limit:50,now:IN_HOURS},gen(reply(),seenB));
 assert.ok(seenB.n>=1);assert.equal((await readSdrConversation(b.p,b.conversation)).turn!.state,'pending-approval');
 assert.equal(await rows('sdr_turn',a.p.workspaceId),0);
 // M1: retrying after an opt-out is refused and the AI is not called; retries are capped.
 const f=await fixture({quota:3});await inbound(f,'Oi');
 await tick({route,generate:async()=>{throw Error('x');}},IN_HOURS,f.p.workspaceId);
 const u=(await readSdrConversation(f.p,f.conversation)).turn!;assert.equal(u.state,'uncertain');
 await testAdmin(c=>c.query("INSERT INTO app.contact_suppression(workspace_id,identity_id,scope,reason) VALUES($1,$2,'all','qa')",[f.p.workspaceId,f.identity]));
 await assert.rejects(retrySdrTurn(f.p,f.conversation,{turnId:u.id}),{status:409});
 await testAdmin(c=>c.query('DELETE FROM app.contact_suppression WHERE workspace_id=$1',[f.p.workspaceId]));
 for(let i=0;i<3;i++){await retrySdrTurn(f.p,f.conversation,{turnId:u.id});await tick({route,generate:async()=>{throw Error('x');}},IN_HOURS,f.p.workspaceId);}
 await assert.rejects(retrySdrTurn(f.p,f.conversation,{turnId:u.id}),{status:409},'three retries at most');
 // Queued but no longer eligible: dropped without calling the AI, unit released.
 await testAdmin(c=>c.query("UPDATE app.sdr_turn SET state='queued' WHERE id=$1",[u.id]));
 await testAdmin(c=>c.query("INSERT INTO app.contact_suppression(workspace_id,identity_id,scope,reason) VALUES($1,$2,'all','qa')",[f.p.workspaceId,f.identity]));
 const q={n:0};await tick(gen(reply(),q),IN_HOURS,f.p.workspaceId);assert.equal(q.n,0);
 assert.equal((await readSdrConversation(f.p,f.conversation)).turn!.state,'superseded');assert.equal(await rows('billing_grant',f.p.workspaceId,"AND unit='sdr' AND held>0"),0);
 // M3: a newer inbound after the review refuses the approval; nothing is queued.
 const g=await fixture({quota:3});await inbound(g,'Primeira');await tick(gen(reply()),IN_HOURS,g.p.workspaceId);
 const t=(await readSdrConversation(g.p,g.conversation)).turn!,rv=await prepareSdrReply(g.p,g.conversation,{turnId:t.id,text:'Olá'});
 await inbound(g,'Segunda');const out0=await rows('channel_message',g.p.workspaceId,"AND direction='outbound'");
 await assert.rejects(approveSdrReply(g.p,g.conversation,{turnId:t.id,text:'Olá',reviewToken:rv.review.token,requestId:randomUUID()}),{status:409});
 assert.equal(await rows('channel_message',g.p.workspaceId,"AND direction='outbound'"),out0);
 assert.equal((await readSdrConversation(g.p,g.conversation)).turn!.state,'pending-approval','a refusal changes nothing');
 // M8: a manual reply takes over atomically, and only the first time.
 const {manualReplyHooks}=await import('../../src/server/sdr/conversation.ts'),{prepareReply,confirmReply}=await import('../../src/server/messaging/replies.ts');
 const mr=await prepareReply(g.p,g.conversation,{content:{kind:'text',text:'Oi, sou eu'}}),mq={content:{kind:'text',text:'Oi, sou eu'},requestId:randomUUID(),reviewToken:mr.token};
 await confirmReply(g.p,g.conversation,mq,manualReplyHooks(g.conversation));
 const vh=await readSdrConversation(g.p,g.conversation);assert.equal(vh.owner,'human');assert.equal(vh.turn!.state,'superseded');
 await resumeSdr(g.p,g.conversation,{expectedRevision:vh.revision});
 await confirmReply(g.p,g.conversation,mq,manualReplyHooks(g.conversation));assert.equal((await readSdrConversation(g.p,g.conversation)).owner,'agent','a replay does not flip it again');
 // L1: an inbound already answered by hand does not make a draft.
 const a1={n:0};await tick(gen(reply(),a1),IN_HOURS,g.p.workspaceId);assert.equal(a1.n,0);
 // Worker lost: uncertain, no retry on its own. Purge: the draft loses the text too; purged text never reaches the prompt.
 const h=await fixture({quota:3});
 await testAdmin(c=>c.query("INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,state,text,text_purged_at,occurred_at) VALUES($1,gen_random_uuid()::text,$2,$3,$4,$5,'outbound','accepted',NULL,now(),now()-interval '1 hour')",[h.p.workspaceId,h.connection,h.sender,h.identity,h.conversation]));
 const inb=await inbound(h,'Texto sensível');
 const lost=await testAdmin(async c=>(await c.query("SELECT app.sdr_claim_turn('w1',$1,$2) v",[IN_HOURS,h.p.workspaceId])).rows[0].v);assert.equal(lost.incoming,'Texto sensível');assert.deepEqual(lost.history,[]);
 await tick(gen(reply()),new Date(IN_HOURS.getTime()+6*60000),h.p.workspaceId);
 const lt=(await readSdrConversation(h.p,h.conversation)).turn!;assert.equal(lt.state,'uncertain');assert.equal(lt.reason,'WORKER_LOST');
 await retrySdrTurn(h.p,h.conversation,{turnId:lt.id});await tick(gen(reply('Rascunho com dado')),IN_HOURS,h.p.workspaceId);
 assert.equal((await readSdrConversation(h.p,h.conversation)).turn!.text,'Rascunho com dado');
 await testAdmin(c=>c.query('UPDATE app.channel_message SET text=NULL,text_purged_at=now() WHERE id=$1',[inb]));
 const pv=(await readSdrConversation(h.p,h.conversation)).turn!;assert.equal(pv.text,null,'retention reaches the draft');assert.deepEqual(pv.fields,[]);
 // Pausing the agent drops its open drafts and releases the units; the inbox says when it is out of service.
 const k=await fixture({quota:3});await inbound(k,'Oi');await tick(gen(reply()),IN_HOURS,k.p.workspaceId);
 assert.equal((await readSdrConversation(k.p,k.conversation)).agent!.inService,true);
 await testAdmin(c=>c.query("UPDATE app.channel_connection SET state='attention' WHERE id=$1",[k.connection]));
 assert.equal((await readSdrConversation(k.p,k.conversation)).agent!.inService,false);
 await testAdmin(c=>c.query("UPDATE app.channel_connection SET state='ready' WHERE id=$1",[k.connection]));
 const {pauseSdrAgent}=await import('../../src/server/sdr/configuration.ts'),rev=await testAdmin(async c=>Number((await c.query('SELECT revision FROM app.sdr_agent WHERE id=$1',[k.agent])).rows[0].revision));
 await pauseSdrAgent(k.p,{agentId:k.agent,expectedRevision:rev});
 assert.equal((await readSdrConversation(k.p,k.conversation)).turn!.state,'superseded');assert.equal(await rows('billing_grant',k.p.workspaceId,"AND unit='sdr' AND held>0"),0);
 // M6: handoff member gone: owners and admins are told instead.
 const n=await fixture({quota:3});await testAdmin(c=>c.query("UPDATE app.sdr_agent_revision SET config=jsonb_set(config,'{handoff,memberId}','\"gone\"') WHERE workspace_id=$1",[n.p.workspaceId]));
 await inbound(n,'Quero falar com alguém');await tick(gen(reply('Já chamo.','handoff',[])),IN_HOURS,n.p.workspaceId);assert.equal(await rows('notification_item',n.p.workspaceId,"AND event_type='handoff'"),1);
});
