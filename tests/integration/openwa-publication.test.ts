import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID,createHmac} from 'node:crypto';
import {publicationFixture} from './messaging-helpers.ts';import {openwaGatewayDouble,testAdmin} from './openwa-helpers.ts';
import {createOpenwaRecord} from '../../src/server/channels/openwa/repository.ts';import {runOpenwaMaintenanceTick} from '../../src/server/channels/openwa/lifecycle.ts';
import {recordLeadConsent,suppressIdentity} from '../../src/server/messaging/consent.ts';import {preparePublication,confirmPublication,pausePublication} from '../../src/server/messaging/publication.ts';
import {prepareChannelTest,confirmChannelTest,prepareReply} from '../../src/server/messaging/replies.ts';import {materializeDueMessages} from '../../src/server/messaging/outbox.ts';import {claimDispatch} from '../../src/server/messaging/lease.ts';import {dispatchOne} from '../../src/server/messaging/dispatch.ts';
import {handleChannelIngress} from '../../src/server/channels/openwa/events.ts';import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';import {readCredentialInTransaction} from '../../src/server/channels/repository.ts';
import {getPools} from '../../src/server/db/pool.ts';import {closeDispatchPool} from '../../src/server/messaging/worker-db.ts';import {closeIngressPool} from '../../src/server/channels/ingress-db.ts';
import type {PublicationInputV2} from '../../src/domain/cadence-runtime.ts';
after(async()=>{await Promise.all([getPools().close(),closeDispatchPool(),closeIngressPool()]);});
async function fixture(t:any){
 const f=await publicationFixture(),own=await createOpenwaRecord(f.u.p,{requestId:randomUUID(),name:'Own fixture'}),gateway=openwaGatewayDouble();Object.assign(process.env,{OPENWA_API_ORIGIN:'http://127.0.0.1:2785',OPENWA_ADMIN_API_KEY:'fixture-admin-key'});delete process.env.CHANNEL_PUBLIC_BASE_URL;t.mock.method(globalThis,'fetch',gateway.fetch);
 await testAdmin(c=>c.query("UPDATE app.openwa_connection SET next_at=clock_timestamp()+interval '1 day' WHERE connection_id<>$1",[own.connection.id]));await runOpenwaMaintenanceTick({now:new Date(Date.now()+1000).toISOString(),maxConnections:5});gateway.paired=true;await runOpenwaMaintenanceTick({now:new Date(Date.now()+31000).toISOString(),maxConnections:1});
 const sender=await testAdmin(async c=>(await c.query('SELECT * FROM app.channel_sender WHERE connection_id=$1',[own.connection.id])).rows[0]);
 await recordLeadConsent(f.u.p,{requestId:randomUUID(),leadId:f.lead.id,senderId:sender.id,phone:f.lead.phone,source:'fixture',occurredAt:new Date().toISOString(),evidence:'Authorized synthetic recipient for this own sender.'});
 const person=await testAdmin(async c=>(await c.query('SELECT * FROM app.channel_identity WHERE workspace_id=$1 AND scope=$2',[f.u.p.workspaceId,'openwa:'+own.connection.id])).rows[0]);
 const input:PublicationInputV2={version:2,cadenceId:f.cadence.id,expectedRevision:0,leadIds:[f.lead.id],steps:{first:{senderId:sender.id,content:{kind:'text',text:'Olá {{nome}}'}},second:{senderId:sender.id,content:{kind:'text',text:'Podemos conversar?'}}}};
 return {...f,own,gateway,ownSender:sender,person,ownInput:input};
}
test('authorized text cadence freezes OpenWA capability, resolves variables and stops after signed real inbound',async t=>{
 const f=await fixture(t);assert.ok(f.person,'consent must use local connection identity scope');assert.notEqual(f.person.id,f.identity);
 const review=await preparePublication(f.u.p,f.ownInput);assert.deepEqual(review.blockers,[]);assert.equal(review.snapshot.version,2);if(review.snapshot.version!==2)throw Error('version');
 const frozen=review.snapshot.recipients[0].steps.first;assert.equal(frozen.identityId,f.person.id);assert.equal('externalId'in frozen.identity?frozen.identity.externalId:'','5541988888888@c.us');assert.equal(frozen.sender.capabilities?.requiresServiceWindow,false);assert.equal(frozen.preview,'Olá Clínica QA');
 const pub=await confirmPublication(f.u.p,{...f.ownInput,requestId:randomUUID(),reviewToken:review.token,material:review.material});const now=new Date(f.now.getTime()+120000).toISOString();assert.equal(await materializeDueMessages(now,100,f.u.p.workspaceId),1);
 const lease=await claimDispatch(now,{workspaceId:f.u.p.workspaceId});assert.ok(lease);let posts=0;const {createOpenwaAdapter}=await import('../../src/server/channels/providers/openwa.ts');
 await dispatchOne(lease,{adapter:createOpenwaAdapter(async(_url,init)=>{posts++;assert.equal(JSON.parse(String(init?.body)).text,'Olá Clínica QA');return Response.json({messageId:'true_5541988888888@c.us_'+randomUUID(),timestamp:Math.floor(Date.now()/1000)},{status:201});}),now:()=>now});assert.equal(posts,1);
 const secret=(await withWorkspaceTransaction(f.u.p,c=>readCredentialInTransaction(c,f.own.connection.id))).credentials.webhookSecret,publicId=await testAdmin(async c=>(await c.query('SELECT public_id FROM app.channel_connection WHERE id=$1',[f.own.connection.id])).rows[0].public_id);
 const raw=JSON.stringify({event:'message.received',sessionId:f.gateway.session.id,timestamp:new Date().toISOString(),deliveryId:randomUUID(),idempotencyKey:randomUUID(),data:{id:'false_5541988888888@c.us_'+randomUUID(),chatId:'5541988888888@c.us',from:'5541988888888@c.us',to:'15550000001@c.us',body:'Sim, recebi.',type:'text',timestamp:Math.floor(Date.now()/1000),fromMe:false,isGroup:false}});
 assert.equal((await handleChannelIngress(new Request('http://channel-ingress:3214/api/channel-webhooks/openwa/'+publicId,{method:'POST',headers:{'content-type':'application/json','x-openwa-signature':'sha256='+createHmac('sha256',secret).update(raw).digest('hex')},body:raw}))).status,200);
 const remaining=await testAdmin(async c=>(await c.query('SELECT state FROM app.cadence_enrollment WHERE publication_id=$1',[pub.id])).rows[0]);assert.equal(remaining.state,'stopped');assert.equal(await materializeDueMessages(new Date(Date.now()+4*86400000).toISOString(),100,f.u.p.workspaceId),0);
});
test('own test uses canonical JID and private callback; templates are rejected and unrelated Meta needs its window',async t=>{
 const f=await fixture(t),input={senderId:f.ownSender.id,phone:'+15550000003',content:{kind:'text' as const,text:'Authorized test'},consent:{source:'fixture',occurredAt:new Date().toISOString(),evidence:'Synthetic own authorized address'}};
 const review=await prepareChannelTest(f.u.p,f.own.connection.id,input);assert.deepEqual(review.blockers,[]);assert.equal(review.snapshot.identity.externalId,'15550000003@c.us');await confirmChannelTest(f.u.p,f.own.connection.id,{...input,requestId:randomUUID(),reviewToken:review.token});
 const blocked=await preparePublication(f.u.p,{...f.ownInput,steps:{...f.ownInput.steps,first:{senderId:f.ownSender.id,content:f.input.bindings.second}}});assert.ok(blocked.blockers.some(b=>b.includes('TEMPLATE_UNSUPPORTED')));
 await testAdmin(c=>c.query("UPDATE app.channel_conversation SET last_inbound_at=clock_timestamp()-interval '25 hours' WHERE sender_id=$1",[f.sender.id]));
 const meta=await preparePublication(f.u.p,{...f.input,bindings:{first:f.input.bindings.first,second:f.input.bindings.first}});assert.ok(meta.blockers.some(b=>b.includes('SERVICE_WINDOW')));
});
test('reviewed scope does not silently switch, while opt-out, pause and changed limits prevent OpenWA POST',async t=>{
 for(const mode of ['optout','pause','limits']){
  const f=await fixture(t);assert.ok(f.person);const review=await preparePublication(f.u.p,f.ownInput),pub=await confirmPublication(f.u.p,{...f.ownInput,requestId:randomUUID(),reviewToken:review.token,material:review.material});const now=new Date(f.now.getTime()+120000).toISOString();await materializeDueMessages(now,100,f.u.p.workspaceId);const lease=await claimDispatch(now,{workspaceId:f.u.p.workspaceId});assert.ok(lease);
  if(mode==='optout')await suppressIdentity(f.u.p,{requestId:randomUUID(),identityId:f.person.id,reason:'fixture'});
  if(mode==='pause')await pausePublication(f.u.p,{requestId:randomUUID(),publicationId:pub.id,expectedRevision:1});
  if(mode==='limits')await testAdmin(c=>c.query('UPDATE app.channel_sender SET daily_limit=19 WHERE id=$1',[f.ownSender.id]));
  let posts=0;await dispatchOne(lease,{adapter:{...f.adapter,sendOnce:async()=>{posts++;return {kind:'uncertain',code:'UNEXPECTED'};}},now:()=>now});assert.equal(posts,0);
 }
});
