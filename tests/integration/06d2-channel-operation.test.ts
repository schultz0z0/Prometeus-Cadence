import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {publicationFixture} from './messaging-helpers.ts';
import {multiFixture} from './multichannel-helpers.ts';
import {testAdmin} from './whatsapp-helpers.ts';
import {prepareChannelTest,confirmChannelTest} from '../../src/server/messaging/replies.ts';
import {preparePublication,confirmPublication} from '../../src/server/messaging/publication.ts';
import {materializeDueMessages} from '../../src/server/messaging/outbox.ts';
import {claimDispatch} from '../../src/server/messaging/lease.ts';
import {dispatchOne} from '../../src/server/messaging/dispatch.ts';
import {readDeliveryEvidence} from '../../src/server/messaging/delivery-evidence.ts';
import {prepareChannelPilot,runChannelPilot} from '../../src/server/messaging/pilot.ts';
import {readConversation} from '../../src/server/messaging/inbox.ts';
import {readMessageMetrics} from '../../src/server/messaging/metrics.ts';
import {webhookRequest} from '../../src/server/channels/webhooks.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import {getPools} from '../../src/server/db/pool.ts';
import {closeIngressPool} from '../../src/server/channels/ingress-db.ts';
import {closeDispatchPool} from '../../src/server/messaging/worker-db.ts';
import type {MailAdapter} from '../../src/server/mail/providers/contracts.ts';
import {channelRequestHandler} from '../../src/server/channels/http.ts';
import {messagingRequestHandler} from '../../src/server/messaging/http.ts';
import {base} from './helpers.ts';
import {prepareMailTest,confirmMailTest} from '../../src/server/mail/tests.ts';
after(async()=>{await getPools().close();await closeIngressPool();await closeDispatchPool();});

async function pilotFixture(){
 const f=await publicationFixture();
 const input={senderId:f.sender.id,phone:f.lead.phone!,content:{kind:'text' as const,text:'Teste de canal autorizado'},consent:{source:'Fixture',occurredAt:f.now.toISOString(),evidence:'Destinatário fictício próprio para homologação.'}};
 const review=await prepareChannelTest(f.u.p,f.connection.id,input);assert.deepEqual(review.blockers,[]);
 const message=await confirmChannelTest(f.u.p,f.connection.id,{...input,requestId:randomUUID(),reviewToken:review.token});
 return {...f,message,pilot:{connectionId:f.connection.id,messageId:message.id,ownedRecipient:input.phone}};
}
test('ready credentials and a queued test do not fabricate delivery; current tenant alone reads evidence',async()=>{
 const f=await pilotFixture(),other=await publicationFixture();
 const proof=await readDeliveryEvidence(f.u.p,f.message.id);
 assert.deepEqual(proof,{messageId:f.message.id,state:'pending',acceptedAt:null,deliveredAt:null,readAt:null,supported:['accepted','delivered','read']});
 assert.deepEqual((await readConversation(f.u.p,f.message.conversationId)).messages.at(-1)?.delivery,proof);
 await assert.rejects(readDeliveryEvidence(other.u.p,f.message.id),{status:404});
});
test('authenticated out-of-order WhatsApp receipts retain delivered/read evidence and are never downgraded by sent',async()=>{
 const f=await pilotFixture(),now=new Date(f.now.getTime()+2000).toISOString(),lease=await claimDispatch(now,{workspaceId:f.u.p.workspaceId});assert.ok(lease);
 const remote='wamid.evidence.'+randomUUID();await dispatchOne(lease,{now:()=>now,adapter:{...f.adapter,sendOnce:async()=>({kind:'accepted',remoteId:remote,acceptedAt:now})}});
 assert.equal((await readDeliveryEvidence(f.u.p,f.message.id)).state,'accepted');
 for(const status of ['read','delivered','sent'])assert.equal((await webhookRequest(f.request({statuses:[{id:remote,status,timestamp:String(Math.floor(f.now.getTime()/1000)),recipient_id:'5541988888888'}]}),f.publicId,'meta')).status,200);
 const proof=await readDeliveryEvidence(f.u.p,f.message.id);assert.equal(proof.state,'read');assert.ok(proof.deliveredAt&&proof.readAt&&proof.acceptedAt);
});
test('SMTP acceptance stays acceptance, with no pixel claim and no delivery/read capability',async()=>{
 const f=await multiFixture(true),review=await preparePublication(f.u.p,f.input);await confirmPublication(f.u.p,{...f.input,requestId:randomUUID(),reviewToken:review.token,material:review.material});
 const now=new Date(f.now.getTime()+120000).toISOString();await materializeDueMessages(now,100,f.u.p.workspaceId);const lease=await claimDispatch(now,{workspaceId:f.u.p.workspaceId});assert.ok(lease);
 const adapter:MailAdapter={verify:async()=>{throw Error('unused');},readBatch:async()=>{throw Error('unused');},findSent:async()=>null,sendOnce:async()=>({kind:'accepted',remoteId:'smtp-'+randomUUID(),acceptedAt:now})};
 await dispatchOne(lease,{now:()=>now,mailAdapter:adapter});const proof=await readDeliveryEvidence(f.u.p,lease.messageId);
 assert.equal(proof.state,'accepted');assert.equal(proof.deliveredAt,null);assert.equal(proof.readAt,null);assert.deepEqual(proof.supported,['accepted']);assert.equal((await readMessageMetrics(f.u.p,{days:30})).tracking.opens,null);
});
test('pilot review observes one existing test and retries idempotently without granting adapter receipt authority',async()=>{
 const f=await pilotFixture(),review=await prepareChannelPilot(f.u.p,f.pilot),input={...f.pilot,reviewToken:review.token,requestId:randomUUID()};
 const a=await runChannelPilot(f.u.p,input),b=await runChannelPilot(f.u.p,input);assert.deepEqual(a,b);assert.equal(a.delivery.state,'pending');assert.equal(a.inboundId,null);
 const counts=await testAdmin(c=>c.query('SELECT (SELECT count(*) FROM app.channel_pilot_observation WHERE workspace_id=$1) AS pilots,(SELECT count(*) FROM app.message_outbox WHERE workspace_id=$1) AS sends',[f.u.p.workspaceId]));
 assert.equal(Number(counts.rows[0].pilots),1);assert.equal(Number(counts.rows[0].sends),1);
 await assert.rejects(runChannelPilot(f.u.p,{...input,messageId:randomUUID()}),{status:404});
 await assert.rejects(runChannelPilot(f.u.p,{...input,ownedRecipient:'+5541000000000'}),{status:409});
});
test('pilot rechecks membership and connection revision after observation I/O before publishing any result',async()=>{
 for(const mutation of ['member','connection']){
  const f=await pilotFixture(),now=new Date(f.now.getTime()+2000).toISOString(),lease=await claimDispatch(now,{workspaceId:f.u.p.workspaceId});assert.ok(lease);
  await dispatchOne(lease,{now:()=>now,adapter:{...f.adapter,sendOnce:async()=>({kind:'accepted',remoteId:'wamid.pilot.'+randomUUID(),acceptedAt:now})}});
  const review=await prepareChannelPilot(f.u.p,f.pilot);let calls=0;
  await assert.rejects(runChannelPilot(f.u.p,{...f.pilot,reviewToken:review.token,requestId:randomUUID()},{observe:async remote=>{
   calls++;assert.match(remote,/^wamid.pilot/);
   await testAdmin(c=>mutation==='member'?c.query('DELETE FROM auth.member WHERE "organizationId"=$1 AND "userId"=$2',[f.u.p.workspaceId,f.u.p.userId]):c.query('UPDATE app.channel_connection SET revision=revision+1 WHERE id=$1',[f.connection.id]));
   return {messageId:f.message.id,state:'read',acceptedAt:now,deliveredAt:now,readAt:now,supported:['read']};
  }}),{status:mutation==='member'?403:409});
  assert.equal(calls,1);assert.equal(Number((await testAdmin(c=>c.query('SELECT count(*) FROM app.channel_pilot_observation WHERE workspace_id=$1',[f.u.p.workspaceId]))).rows[0].count),0);
 }
});
for(const mutation of ['revoked','expired','workspace'] as const)test('pilot rejects '+mutation+' session after observation without publishing a journal or command',async()=>{
 const f=await pilotFixture(),now=new Date(f.now.getTime()+2000).toISOString(),lease=await claimDispatch(now,{workspaceId:f.u.p.workspaceId});assert.ok(lease);
 await dispatchOne(lease,{now:()=>now,adapter:{...f.adapter,sendOnce:async()=>({kind:'accepted',remoteId:'wamid.session.'+randomUUID(),acceptedAt:now})}});
 const review=await prepareChannelPilot(f.u.p,f.pilot),requestId=randomUUID();let calls=0;
 await assert.rejects(runChannelPilot(f.u.p,{...f.pilot,reviewToken:review.token,requestId},{observe:async()=>{
  calls++;await testAdmin(c=>mutation==='revoked'?c.query('DELETE FROM auth.session WHERE id=$1',[f.u.p.sessionId]):mutation==='expired'?c.query('UPDATE auth.session SET "expiresAt"=clock_timestamp()-interval \'1 second\' WHERE id=$1',[f.u.p.sessionId]):c.query('UPDATE auth.session SET "activeOrganizationId"=NULL WHERE id=$1',[f.u.p.sessionId]));
  return {messageId:f.message.id,state:'accepted',acceptedAt:now,deliveredAt:null,readAt:null,supported:['accepted']};
 }}),{status:mutation==='workspace'?409:401});
 assert.equal(calls,1);assert.equal(Number((await testAdmin(c=>c.query('SELECT count(*) FROM app.channel_pilot_observation WHERE workspace_id=$1',[f.u.p.workspaceId]))).rows[0].count),0);
 assert.equal((await readDeliveryEvidence(f.u.p,f.message.id)).state,'accepted');
});
test('pilot rejects a substituted session belonging to another user before observation I/O',async()=>{
 const f=await pilotFixture(),other=await publicationFixture();
 await assert.rejects(prepareChannelPilot({...f.u.p,sessionId:other.u.p.sessionId},f.pilot),{status:401});
});
test('email pilot accepts equivalent domain casing but preserves the mailbox local-part identity',async()=>{
 const f=await multiFixture(true),messageId=randomUUID(),input={mode:'test' as const,messageId,expectedRevision:1,to:'Contact@EXAMPLE.NET',content:{kind:'email' as const,subject:'Homologação',text:'Teste autorizado',signature:'Equipe QA'},consent:{source:'Fixture',occurredAt:f.now.toISOString(),evidence:'Destinatário fictício do administrador para teste.'}};
 const review=await prepareMailTest(f.u.p,f.mailbox.id,input);assert.deepEqual(review.blockers,[]);assert.equal(review.snapshot.to,'Contact@example.net');
 await confirmMailTest(f.u.p,f.mailbox.id,{...input,requestId:randomUUID(),reviewToken:review.token,material:review.material});
 const pilot={connectionId:f.mailbox.id,messageId,ownedRecipient:'Contact@EXAMPLE.NET'},prepared=await prepareChannelPilot(f.u.p,pilot);
 const first=await runChannelPilot(f.u.p,{...pilot,reviewToken:prepared.token,requestId:randomUUID()});assert.equal(first.outboundId,messageId);assert.equal(first.delivery.state,'pending');
 await assert.rejects(prepareChannelPilot(f.u.p,{...pilot,ownedRecipient:'contact@example.net'}),{status:409});
});
test('pilot reads durable receipts rather than adapter claims and observes the response stopping related follow-ups',async()=>{
 const f=await pilotFixture(),now=new Date(f.now.getTime()+2000).toISOString(),lease=await claimDispatch(now,{workspaceId:f.u.p.workspaceId});assert.ok(lease);
 await dispatchOne(lease,{now:()=>now,adapter:{...f.adapter,sendOnce:async()=>({kind:'accepted',remoteId:'wamid.real.'+randomUUID(),acceptedAt:now})}});
 const publication=await preparePublication(f.u.p,f.input);await confirmPublication(f.u.p,{...f.input,requestId:randomUUID(),reviewToken:publication.token});
 const review=await prepareChannelPilot(f.u.p,f.pilot);
 await webhookRequest(f.request({messages:[{id:'wamid.reply.'+randomUUID(),from:'5541988888888',timestamp:String(Math.floor((f.now.getTime()+3000)/1000)),type:'text',text:{body:'Recebi o teste'}}]}),f.publicId,'meta');
 const result=await runChannelPilot(f.u.p,{...f.pilot,reviewToken:review.token,requestId:randomUUID()},{observe:async()=>({messageId:f.message.id,state:'read',acceptedAt:now,deliveredAt:now,readAt:now,supported:['read']})});
 assert.equal(result.delivery.state,'accepted');assert.equal(result.delivery.readAt,null);assert.ok(result.inboundId);assert.equal(result.stoppedEnrollment,true);
 assert.equal(await materializeDueMessages(new Date(f.now.getTime()+3*86400000).toISOString(),100,f.u.p.workspaceId),0);
});
test('direct SQL cannot create receipt evidence, cross-tenant pilot records, or bypass an operator role',async()=>{
 const f=await pilotFixture(),other=await publicationFixture();
 await assert.rejects(withWorkspaceTransaction(f.u.p,c=>c.query("INSERT INTO app.channel_pilot_observation(workspace_id,request_id,connection_id,message_id,connection_revision,actor_id) VALUES($1,$2,$3,$4,1,$5)",[f.u.p.workspaceId,randomUUID(),f.connection.id,f.message.id,f.u.p.userId])));
 await assert.rejects(withWorkspaceTransaction(other.u.p,c=>c.query('SELECT app.record_channel_pilot($1,$2,$3,1,$4)',[randomUUID(),f.connection.id,f.message.id,f.pilot.ownedRecipient])));
 await testAdmin(c=>c.query('UPDATE auth.member SET role=$3 WHERE "organizationId"=$1 AND "userId"=$2',[f.u.p.workspaceId,f.u.p.userId,'operator']));
 await assert.rejects(prepareChannelPilot(f.u.p,f.pilot),{status:403});
 await assert.rejects(withWorkspaceTransaction(f.u.p,c=>c.query('SELECT app.record_channel_pilot($1,$2,$3,1,$4)',[randomUUID(),f.connection.id,f.message.id,f.pilot.ownedRecipient])));
});
test('HTTP observation enforces session, tenant, role, validation, fresh review and replay without a send endpoint',async()=>{
 const f=await pilotFixture(),other=await publicationFixture();
 const request=(headers:HeadersInit,body:unknown)=>new Request(base+'/api/channels/'+f.connection.id+'/pilot-prepare',{method:'POST',headers,body:JSON.stringify(body)});
 const target={id:f.connection.id,action:'pilot-prepare'},body={messageId:f.message.id,ownedRecipient:f.pilot.ownedRecipient};
 const anonymous=await channelRequestHandler(request({'origin':base},body),target);assert.ok([401,403].includes(anonymous.status));
 assert.equal((await channelRequestHandler(request(f.u.headers,{}),target)).status,422);
 assert.equal((await channelRequestHandler(request(other.u.headers,body),target)).status,404);
 const prepared=await channelRequestHandler(request(f.u.headers,body),target);assert.equal(prepared.status,200);const review=await prepared.json();
 const command={...body,reviewToken:review.token,requestId:randomUUID()},confirmed={...target,action:'pilot-confirm'};
 const first=await channelRequestHandler(request(f.u.headers,command),confirmed);assert.equal(first.status,200);assert.match(first.headers.get('cache-control')??'',/no-store/);
 assert.deepEqual(await first.json(),await(await channelRequestHandler(request(f.u.headers,command),confirmed)).json());
 assert.equal((await channelRequestHandler(request(f.u.headers,{...command,reviewToken:'stale'}),confirmed)).status,409);
 const evidence=await messagingRequestHandler(new Request(base+'/api/messaging/messages/'+f.message.id+'/evidence',{headers:f.u.headers}),{resource:'messages',id:f.message.id,action:'evidence'});
 assert.equal(evidence.status,200);assert.equal((await evidence.json()).state,'pending');
 const foreign=await messagingRequestHandler(new Request(base+'/api/messaging/messages/'+f.message.id+'/evidence',{headers:other.u.headers}),{resource:'messages',id:f.message.id,action:'evidence'});assert.equal(foreign.status,404);
 await testAdmin(c=>c.query('UPDATE auth.member SET role=$3 WHERE "organizationId"=$1 AND "userId"=$2',[f.u.p.workspaceId,f.u.p.userId,'operator']));
 assert.equal((await channelRequestHandler(request(f.u.headers,body),target)).status,403);
});
