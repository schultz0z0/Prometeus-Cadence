import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {publicationFixture} from './messaging-helpers.ts';import {testAdmin} from './whatsapp-helpers.ts';
import {preparePublication,confirmPublication} from '../../src/server/messaging/publication.ts';
import {webhookRequest} from '../../src/server/channels/webhooks.ts';
import {pruneIngestMetadata} from '../../src/server/channels/events.ts';
import {runMessagingTick} from '../../src/server/messaging/worker.ts';
import {dispatchOne} from '../../src/server/messaging/dispatch.ts';
import {materializeDueMessages} from '../../src/server/messaging/outbox.ts';
import {claimDispatch} from '../../src/server/messaging/lease.ts';
import {getPools} from '../../src/server/db/pool.ts';import {closeIngressPool} from '../../src/server/channels/ingress-db.ts';import {closeDispatchPool} from '../../src/server/messaging/worker-db.ts';
after(async()=>{await getPools().close();await closeIngressPool();await closeDispatchPool();});

test('tenant lifecycle publishes, queues once across restart, and authenticated reply stops the next step',async()=>{
 const a=await publicationFixture(),b=await publicationFixture();let posts=0;
 const review=await preparePublication(a.u.p,a.input);await confirmPublication(a.u.p,{...a.input,requestId:randomUUID(),reviewToken:review.token});
 const now=new Date(a.now.getTime()+120000).toISOString(),tick={now:()=>now,maxMessages:1,workspaceId:a.u.p.workspaceId,events:async()=>0,dispatch:async(lease:Parameters<typeof dispatchOne>[0])=>dispatchOne(lease,{adapter:{...a.adapter,sendOnce:async()=>{posts++;return {kind:'accepted',remoteId:'wamid.lifecycle.'+randomUUID(),acceptedAt:now};}},now:()=>now})};
 await materializeDueMessages(now,1,a.u.p.workspaceId);
 assert.equal(await claimDispatch(now,{workspaceId:a.u.p.workspaceId,messageId:randomUUID()}),null,'pilot cannot claim a different queued message');
 const first=await runMessagingTick(tick);assert.equal(first.dispatched,1);await closeDispatchPool();await runMessagingTick(tick);assert.equal(posts,1);
 assert.equal((await webhookRequest(a.request({messages:[{id:'wamid.answer.'+randomUUID(),from:'5541988888888',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Pode parar, obrigado.'}}]}),a.publicId,'meta')).status,200);
 await runMessagingTick({...tick,now:()=>new Date(Date.parse(now)+86400000*4).toISOString()});assert.equal(posts,1);
 const counts=await testAdmin(async c=>({a:Number((await c.query('SELECT count(*) FROM app.channel_message WHERE workspace_id=$1 AND direction=\'outbound\'',[a.u.p.workspaceId])).rows[0].count),b:Number((await c.query('SELECT count(*) FROM app.channel_message WHERE workspace_id=$1 AND direction=\'outbound\'',[b.u.p.workspaceId])).rows[0].count)}));assert.equal(counts.a,1);assert.equal(counts.b,0);
});

test('90-day metadata pruning preserves message history status evidence and replay deduplication',async()=>{
 const f=await publicationFixture(),payload={messages:[{id:'wamid.prune.'+randomUUID(),from:'5541988888888',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Mensagem preservada'}}]};
 await webhookRequest(f.request(payload),f.publicId,'meta');
 const before=await testAdmin(async c=>{
  await c.query("UPDATE app.channel_received_event SET received_at=clock_timestamp()-interval '91 days' WHERE workspace_id=$1",[f.u.p.workspaceId]);
  return Number((await c.query('SELECT count(*) FROM app.channel_message WHERE workspace_id=$1',[f.u.p.workspaceId])).rows[0].count);
 });
 assert.ok(await pruneIngestMetadata(new Date().toISOString())>=1);
 const retained=await testAdmin(async c=>(await c.query('SELECT dedup_key,body_hash,event_metadata,metadata_pruned_at,message_id FROM app.channel_received_event WHERE workspace_id=$1',[f.u.p.workspaceId])).rows);
 assert.ok(retained.every(e=>e.dedup_key&&e.body_hash===null&&e.event_metadata===null&&e.metadata_pruned_at&&e.message_id));
 await webhookRequest(f.request(payload),f.publicId,'meta');
 const after=await testAdmin(async c=>Number((await c.query('SELECT count(*) FROM app.channel_message WHERE workspace_id=$1',[f.u.p.workspaceId])).rows[0].count));assert.equal(after,before);
 assert.equal(await pruneIngestMetadata('invalid').catch(()=>-1),-1);
});
