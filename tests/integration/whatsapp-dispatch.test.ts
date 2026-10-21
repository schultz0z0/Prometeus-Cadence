import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {publicationFixture} from './messaging-helpers.ts';
import {testAdmin} from './whatsapp-helpers.ts';
import {preparePublication,confirmPublication} from '../../src/server/messaging/publication.ts';
import {materializeDueMessages} from '../../src/server/messaging/outbox.ts';
import {claimDispatch} from '../../src/server/messaging/lease.ts';
import {dispatchOne} from '../../src/server/messaging/dispatch.ts';
import {prepareReply,confirmReply} from '../../src/server/messaging/replies.ts';
import {listConversations} from '../../src/server/messaging/inbox.ts';
import {webhookRequest} from '../../src/server/channels/webhooks.ts';
import {saveConnection} from '../../src/server/channels/repository.ts';
import {getPools} from '../../src/server/db/pool.ts';
import {closeIngressPool} from '../../src/server/channels/ingress-db.ts';
import {closeDispatchPool} from '../../src/server/messaging/worker-db.ts';
import type {ProviderAdapter} from '../../src/server/channels/providers/contracts.ts';
after(async()=>{await getPools().close();await closeIngressPool();await closeDispatchPool();});
async function publish(f:Awaited<ReturnType<typeof publicationFixture>>){const review=await preparePublication(f.u.p,f.input);assert.deepEqual(review.blockers,[]);return confirmPublication(f.u.p,{...f.input,requestId:randomUUID(),reviewToken:review.token});}
test('two cadences and a manual reply share one sender/workspace quota under concurrent dispatch',async()=>{
 const f=await publicationFixture();process.env.CHANNEL_PUBLIC_BASE_URL='https://hooks.example';
 await testAdmin(async c=>{await c.query('UPDATE app.messaging_limits SET workspace_daily_limit=1 WHERE workspace_id=$1',[f.u.p.workspaceId]);await c.query('UPDATE app.channel_sender SET daily_limit=1 WHERE workspace_id=$1',[f.u.p.workspaceId]);});
 await publish(f);
 const secondId=randomUUID();await testAdmin(c=>c.query("INSERT INTO app.cadence(workspace_id,id,list_id,payload) VALUES($1,$2,$3,$4)",[f.u.p.workspaceId,secondId,f.cadence.listId,{...f.cadence,id:secondId}]));
 const second={...f.input,cadenceId:secondId},review=await preparePublication(f.u.p,second);await confirmPublication(f.u.p,{...second,requestId:randomUUID(),reviewToken:review.token});
 const conversation=(await listConversations(f.u.p,{})).items[0],reply={content:{kind:'text' as const,text:'Resposta revisada'}};
 const replyReview=await prepareReply(f.u.p,conversation.id,reply);await confirmReply(f.u.p,conversation.id,{...reply,requestId:randomUUID(),reviewToken:replyReview.token});
 const now=new Date(f.now.getTime()+120000).toISOString();await materializeDueMessages(now,100);
 const leases=[];for(let i=0;i<3;i++){const lease=await claimDispatch(now,{workspaceId:f.u.p.workspaceId});assert.ok(lease);leases.push(lease);}
 let posts=0;const adapter:ProviderAdapter={...f.adapter,sendOnce:async()=>{posts++;return {kind:'accepted',remoteId:'wamid.accepted.'+randomUUID(),acceptedAt:now};}};
 await Promise.all(leases.map(lease=>dispatchOne(lease,{adapter,now:()=>now})));assert.equal(posts,1);
 const usage=await testAdmin(async c=>(await c.query("SELECT sum(units) AS total FROM app.message_usage_ledger WHERE workspace_id=$1 AND event='consume'",[f.u.p.workspaceId])).rows[0].total);assert.equal(Number(usage),1);
});
test('reply revocation and stale lease prevent the external POST after a claim',async()=>{
 const f=await publicationFixture();await publish(f);const now=new Date(f.now.getTime()+120000).toISOString();await materializeDueMessages(now,100);const lease=await claimDispatch(now,{workspaceId:f.u.p.workspaceId});assert.ok(lease);
 await webhookRequest(f.request({messages:[{id:'wamid.cancel.'+randomUUID(),from:'5541988888888',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Sim'}}]}),f.publicId,'meta');
 let posts=0;await dispatchOne(lease,{adapter:{...f.adapter,sendOnce:async()=>{posts++;return {kind:'uncertain',code:'NOT_EXPECTED'};}},now:()=>now});assert.equal(posts,0);
 const g=await publicationFixture();await publish(g);await materializeDueMessages(new Date(g.now.getTime()+120000).toISOString(),100);const revoked=await claimDispatch(new Date(g.now.getTime()+120000).toISOString(),{workspaceId:g.u.p.workspaceId});assert.ok(revoked);
 await testAdmin(c=>c.query('UPDATE auth.member SET role=$3 WHERE "organizationId"=$1 AND "userId"=$2',[g.u.p.workspaceId,g.u.p.userId,'operator']));
 await dispatchOne(revoked,{adapter:{...g.adapter,sendOnce:async()=>{posts++;return {kind:'uncertain',code:'NOT_EXPECTED'};}},now:()=>now});assert.equal(posts,0);
});
test('expired fenced claims and rotated credentials never authorize another POST',async()=>{
 const f=await publicationFixture();await publish(f);const now=new Date(f.now.getTime()+120000).toISOString();await materializeDueMessages(now,100);const stale=await claimDispatch(now,{workspaceId:f.u.p.workspaceId});assert.ok(stale);
 await testAdmin(c=>c.query("UPDATE app.message_outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE workspace_id=$1 AND message_id=$2",[f.u.p.workspaceId,stale.messageId]));
 const current=await claimDispatch(now,{workspaceId:f.u.p.workspaceId});assert.ok(current);assert.ok(current.fence>stale.fence);let posts=0;
 const adapter={...f.adapter,sendOnce:async()=>{posts++;return {kind:'uncertain' as const,code:'NOT_EXPECTED'};}};
 await dispatchOne(stale,{adapter,now:()=>now});assert.equal(posts,0);
 await saveConnection(f.u.p,{id:f.connection.id,name:'Rotated',provider:'meta',identifiers:f.connection.identifiers,credentials:{accessToken:'',appSecret:''},expectedRevision:1,requestId:randomUUID()});
 await dispatchOne(current,{adapter,now:()=>now});assert.equal(posts,0);
});
test('service window closing and template revocation after publication block dispatch without adapting content',async()=>{
 const f=await publicationFixture();await publish(f);const late=new Date(f.now.getTime()+25*3600000).toISOString();await materializeDueMessages(late,100);const lease=await claimDispatch(late,{workspaceId:f.u.p.workspaceId});assert.ok(lease);let posts=0;
 const adapter={...f.adapter,sendOnce:async()=>{posts++;return {kind:'uncertain' as const,code:'NOT_EXPECTED'};}};await dispatchOne(lease,{adapter,now:()=>late});assert.equal(posts,0);
 const g=await publicationFixture(),input={...g.input,bindings:{first:g.input.bindings.second,second:g.input.bindings.second}},review=await preparePublication(g.u.p,input);assert.deepEqual(review.blockers,[]);await confirmPublication(g.u.p,{...input,requestId:randomUUID(),reviewToken:review.token});
 const now=new Date(g.now.getTime()+120000).toISOString();await materializeDueMessages(now,100);const revoked=await claimDispatch(now,{workspaceId:g.u.p.workspaceId});assert.ok(revoked);
 assert.equal((await webhookRequest(g.request({message_template_id:'444444',event:'REJECTED'},'message_template_status_update'),g.publicId,'meta')).status,200);
 await dispatchOne(revoked,{adapter,now:()=>now});assert.equal(posts,0);
});
