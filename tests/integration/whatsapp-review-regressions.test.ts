import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID,createHmac} from 'node:crypto';
import {publicationFixture} from './messaging-helpers.ts';import {testAdmin,metaConnectionInput} from './whatsapp-helpers.ts';
import {preparePublication,confirmPublication} from '../../src/server/messaging/publication.ts';
import {prepareReply,confirmReply} from '../../src/server/messaging/replies.ts';
import {saveConnection} from '../../src/server/channels/repository.ts';import {verifyConnection} from '../../src/server/channels/connections.ts';
import {webhookRequest} from '../../src/server/channels/webhooks.ts';import {listConversations} from '../../src/server/messaging/inbox.ts';
import {materializeDueMessages} from '../../src/server/messaging/outbox.ts';import {claimDispatch,leaseArgs} from '../../src/server/messaging/lease.ts';
import {dispatchOne} from '../../src/server/messaging/dispatch.ts';import {dispatchBlocker} from '../../src/server/messaging/guard.ts';
import {prepareReconciliation,confirmReconciliation} from '../../src/server/messaging/reconciliation.ts';
import {nextStepAt} from '../../src/server/messaging/schedule.ts';import {dispatchPool,closeDispatchPool} from '../../src/server/messaging/worker-db.ts';
import {getPools} from '../../src/server/db/pool.ts';import {closeIngressPool} from '../../src/server/channels/ingress-db.ts';
after(async()=>{await getPools().close();await closeDispatchPool();await closeIngressPool();});

test('fractional acceptance schedule crosses the real SQL guard without INVALID_SCHEDULE',async()=>{
 const f=await publicationFixture();f.cadence.settings.sendTime='12:00';f.cadence.steps[1].delayDays=1;
 await testAdmin(c=>c.query('UPDATE app.cadence SET payload=$2 WHERE id=$1',[f.cadence.id,f.cadence]));
 const review=await preparePublication(f.u.p,f.input),publication=await confirmPublication(f.u.p,{...f.input,requestId:randomUUID(),reviewToken:review.token});
 const accepted='2026-10-21T12:00:03.123Z';
 const enrollment=await testAdmin(async c=>(await c.query("UPDATE app.cadence_enrollment SET next_step=1,last_accepted_at=$2,schedule_pending=true WHERE publication_id=$1 RETURNING id",[publication.id,accepted])).rows[0].id);
 const next=nextStepAt({anchorAt:accepted,now:accepted,delayDays:1,...f.cadence.settings,holidayDates:null});
 await assert.doesNotReject(()=>dispatchPool().query('SELECT app.finish_enrollment_schedule($1,$2,$3,$4,$5)',[f.u.p.workspaceId,enrollment,1,accepted,next]));
});

test('recent inbound on sender A cannot authorize service text or publication on stale sender B',async()=>{
 const f=await publicationFixture(),phoneNumberId='993333333333',phone='+5541999999998';
 const connectionInput=metaConnectionInput(),wabaId=f.connection.identifiers!.wabaId;
 const saved=await saveConnection(f.u.p,{...connectionInput,name:'Meta B',identifiers:{...connectionInput.identifiers,wabaId,phoneNumberId}});
 const b=await verifyConnection(f.u.p,saved.id,1,{adapter:{...f.adapter,verifyAssets:async()=>({externalAccountId:wabaId,tokenExpiresAt:null,senders:[{externalId:phoneNumberId,address:phone,identityScope:'meta:'+wabaId,capabilities:{phoneOutbound:true,opaqueOutbound:false}}]})}});
 const publicId=await testAdmin(async c=>(await c.query('SELECT public_id FROM app.channel_connection WHERE id=$1',[b.id])).rows[0].public_id);
 const inbound=async(timestamp:string)=>{
  const body=JSON.stringify({object:'whatsapp_business_account',entry:[{id:wabaId,changes:[{field:'messages',value:{metadata:{phone_number_id:phoneNumberId},messages:[{id:'wamid.B.'+randomUUID(),from:'5541988888888',timestamp,type:'text',text:{body:'Olá B'}}]}}]}]});
  return webhookRequest(new Request('https://hooks.example/api/channel-webhooks/meta/'+publicId,{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':'sha256='+createHmac('sha256',connectionInput.credentials.appSecret).update(body).digest('hex')},body}),publicId,'meta');
 };
 await testAdmin(c=>c.query('UPDATE app.channel_sender SET daily_limit=10 WHERE id=$1',[b.senders[0].id]));
 assert.equal((await inbound(String(Math.floor(Date.now()/1000)-25*3600))).status,200);
 const thread=(await listConversations(f.u.p,{senderId:b.senders[0].id})).items[0];assert.ok(thread);
 const blocked=await prepareReply(f.u.p,thread.id,{content:{kind:'text',text:'Resposta B'}});assert.ok(blocked.blockers.includes('SERVICE_WINDOW_CLOSED'));
 const publication=await preparePublication(f.u.p,{...f.input,senderId:b.senders[0].id});assert.ok(publication.blockers.some(b=>b===f.lead.id+':first:SERVICE_WINDOW_CLOSED'));
 assert.equal((await inbound(String(Math.floor(Date.now()/1000)))).status,200);
 const input={content:{kind:'text' as const,text:'Resposta B autorizada na janela B'}},ready=await prepareReply(f.u.p,thread.id,input);assert.equal(ready.blockers.length,0);
 const message=await confirmReply(f.u.p,thread.id,{...input,requestId:randomUUID(),reviewToken:ready.token});
 await testAdmin(c=>c.query("UPDATE app.channel_conversation SET last_inbound_at=clock_timestamp()-interval '25 hours' WHERE id=$1",[thread.id]));
 const now=new Date().toISOString(),lease=await claimDispatch(now,{workspaceId:f.u.p.workspaceId,messageId:message.id});assert.ok(lease);
 const ctx=(await dispatchPool().query('SELECT app.read_message_dispatch($1,$2,$3,$4) AS ctx',leaseArgs(lease))).rows[0].ctx;
 assert.ok(['OPT_IN_REQUIRED','SERVICE_WINDOW_CLOSED'].includes(dispatchBlocker(ctx,now)??''));
 const gate=(await dispatchPool().query('SELECT app.begin_message_dispatch($1,$2,$3,$4,$5,$6,$7)',[lease.workspaceId,lease.messageId,lease.attemptId,lease.token,lease.fence,ctx.guard,now])).rows[0].begin_message_dispatch;
 assert.equal(gate.allowed,false);assert.equal(gate.code,'POLICY_CHANGED');
});

test('signed late delivered and read callbacks supersede negative reconciliation without another POST',async()=>{
 const f=await publicationFixture(),review=await preparePublication(f.u.p,f.input);await confirmPublication(f.u.p,{...f.input,requestId:randomUUID(),reviewToken:review.token});
 const now=new Date(f.now.getTime()+120000).toISOString();await materializeDueMessages(now,100,f.u.p.workspaceId);const lease=await claimDispatch(now,{workspaceId:f.u.p.workspaceId});assert.ok(lease);let posts=0;
 await dispatchOne(lease,{adapter:{...f.adapter,sendOnce:async()=>{posts++;return {kind:'uncertain',code:'LOST'};}},now:()=>now});
 const input={resolution:'not_accepted',remoteId:null,evidence:'Administrador conferiu o log, mas a confirmação do provedor ainda não havia chegado.',reference:'https://business.facebook.com/wa/manage/logs/fixture',proofKind:'provider-log',verifiedByUser:true},p=await prepareReconciliation(f.u.p,lease.messageId,input);
 await confirmReconciliation(f.u.p,{...input,messageId:lease.messageId,requestId:randomUUID(),reviewToken:p.token});
 for(const status of ['delivered','read','delivered']){const payload:Record<string,unknown>={statuses:[{id:'wamid.late.'+lease.attemptId,status,timestamp:String(Math.floor(Date.now()/1000)),biz_opaque_callback_data:lease.attemptId}]};assert.equal((await webhookRequest(f.request(payload),f.publicId,'meta')).status,200);assert.equal((await webhookRequest(f.request(payload),f.publicId,'meta')).status,200);}
 const state=await testAdmin(async c=>({message:(await c.query('SELECT state,remote_id FROM app.channel_message WHERE id=$1',[lease.messageId])).rows[0],usage:(await c.query("SELECT count(*) FILTER(WHERE event='consume')::int AS consumed,sum(units*CASE WHEN event='release' THEN -1 ELSE 1 END)::int AS held FROM app.message_usage_ledger WHERE workspace_id=$1",[f.u.p.workspaceId])).rows[0]}));
 assert.equal(state.message.state,'read');assert.equal(state.message.remote_id,'wamid.late.'+lease.attemptId);assert.equal(state.usage.consumed,1);assert.equal(state.usage.held,1);assert.equal(posts,1);
});
