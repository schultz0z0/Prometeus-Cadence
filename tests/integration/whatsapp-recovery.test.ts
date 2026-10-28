import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {publicationFixture} from './messaging-helpers.ts';
import {testAdmin} from './whatsapp-helpers.ts';
import {preparePublication,confirmPublication} from '../../src/server/messaging/publication.ts';
import {materializeDueMessages} from '../../src/server/messaging/outbox.ts';
import {claimDispatch} from '../../src/server/messaging/lease.ts';
import {dispatchOne} from '../../src/server/messaging/dispatch.ts';
import {saveConnection} from '../../src/server/channels/repository.ts';
import {webhookRequest} from '../../src/server/channels/webhooks.ts';
import {getPools} from '../../src/server/db/pool.ts';
import {closeIngressPool} from '../../src/server/channels/ingress-db.ts';
import {closeDispatchPool} from '../../src/server/messaging/worker-db.ts';
after(async()=>{await getPools().close();await closeIngressPool();await closeDispatchPool();});
async function queued(stableRetryClock=false){const f=await publicationFixture(stableRetryClock),review=await preparePublication(f.u.p,f.input);await confirmPublication(f.u.p,{...f.input,requestId:randomUUID(),reviewToken:review.token});const now=new Date(f.now.getTime()+120000).toISOString();await materializeDueMessages(now,100);const lease=await claimDispatch(now,{workspaceId:f.u.p.workspaceId});assert.ok(lease);return {...f,now,lease};}
test('lost REST response stays uncertain across lease expiry; signed trace callback reconciles exactly one consumption',async()=>{
 const f=await queued();let posts=0;
 await dispatchOne(f.lease,{adapter:{...f.adapter,sendOnce:async()=>{posts++;return {kind:'uncertain',code:'LOST_RESPONSE'};}},now:()=>f.now});
 await testAdmin(c=>c.query("UPDATE app.message_outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE workspace_id=$1 AND message_id=$2",[f.u.p.workspaceId,f.lease.messageId]));
 const retry=await claimDispatch(f.now,{workspaceId:f.u.p.workspaceId});assert.equal(retry?.messageId===f.lease.messageId,false);assert.equal(posts,1);
 await saveConnection(f.u.p,{id:f.connection.id,name:'Rotated',provider:'meta',identifiers:f.connection.identifiers,credentials:{accessToken:'',appSecret:''},expectedRevision:1,requestId:randomUUID()});
 const status={statuses:[{id:'wamid.recovered.'+randomUUID(),status:'delivered',timestamp:String(Math.floor(Date.now()/1000)),biz_opaque_callback_data:f.lease.attemptId}]};
 assert.equal((await webhookRequest(f.request(status),f.publicId,'meta')).status,200);assert.equal((await webhookRequest(f.request(status),f.publicId,'meta')).status,200);
 const state=await testAdmin(async c=>({message:(await c.query('SELECT state FROM app.channel_message WHERE workspace_id=$1 AND id=$2',[f.u.p.workspaceId,f.lease.messageId])).rows[0].state,units:Number((await c.query("SELECT COALESCE(sum(units),0) AS units FROM app.message_usage_ledger WHERE workspace_id=$1 AND event='consume'",[f.u.p.workspaceId])).rows[0].units)}));assert.equal(state.message,'delivered');assert.equal(state.units,1);
});
test('only proven rejected POSTs retry at most twice, with persisted backoff, while auth failures never retry',async()=>{
 const f=await queued(true);let posts=0;let clock=f.now;
 const adapter={...f.adapter,sendOnce:async()=>{posts++;return {kind:'not_accepted' as const,code:'META_429',retryable:true,retryAfterMs:30000};}};
 let lease=f.lease;
 for(let n=0;n<3;n++){
  await dispatchOne(lease,{adapter,now:()=>clock});
  const record=await testAdmin(async c=>(await c.query('SELECT state,next_at FROM app.message_outbox WHERE workspace_id=$1 AND message_id=$2',[f.u.p.workspaceId,f.lease.messageId])).rows[0]);
  if(n<2){assert.equal(record.state,'pending');assert.ok(record.next_at.getTime()>=Date.parse(clock)+30000);clock=new Date(record.next_at.getTime()+200000).toISOString();lease=(await claimDispatch(clock,{workspaceId:f.u.p.workspaceId}))!;assert.ok(lease);}else assert.equal(record.state,'failed');
 }
 assert.equal(posts,3);
 const auth=await queued();let authPosts=0;
 await dispatchOne(auth.lease,{adapter:{...auth.adapter,sendOnce:async()=>{authPosts++;return {kind:'not_accepted',code:'META_190',retryable:false,retryAfterMs:null};}},now:()=>auth.now});
 const authState=await testAdmin(async c=>(await c.query('SELECT state FROM app.message_outbox WHERE workspace_id=$1 AND message_id=$2',[auth.u.p.workspaceId,auth.lease.messageId])).rows[0].state);assert.equal(authState,'failed');assert.equal(authPosts,1);assert.equal((await claimDispatch(new Date(Date.parse(auth.now)+86400000).toISOString(),{workspaceId:auth.u.p.workspaceId}))?.messageId===auth.lease.messageId,false);
});
test('an accepted receipt survives role revocation after POST without scheduling further messages',async()=>{
 const f=await queued();let posts=0;
 await dispatchOne(f.lease,{adapter:{...f.adapter,sendOnce:async()=>{posts++;await testAdmin(c=>c.query('UPDATE auth.member SET role=$3 WHERE "organizationId"=$1 AND "userId"=$2',[f.u.p.workspaceId,f.u.p.userId,'operator']));return {kind:'accepted',remoteId:'wamid.revoked.'+randomUUID(),acceptedAt:f.now};}},now:()=>f.now});
 const rows=await testAdmin(async c=>({message:(await c.query('SELECT state FROM app.channel_message WHERE workspace_id=$1 AND id=$2',[f.u.p.workspaceId,f.lease.messageId])).rows[0].state,enrollment:(await c.query('SELECT state,schedule_pending FROM app.cadence_enrollment WHERE workspace_id=$1',[f.u.p.workspaceId])).rows[0]}));assert.equal(posts,1);assert.equal(rows.message,'accepted');assert.equal(rows.enrollment.state,'blocked');assert.equal(rows.enrollment.schedule_pending,false);
});
test('a signed callback before the REST receipt consumes once and the next step waits from acceptance',async()=>{
 const f=await queued(),remote='wamid.before-rest.'+randomUUID();let posts=0;
 await dispatchOne(f.lease,{adapter:{...f.adapter,sendOnce:async(_config,send)=>{
  posts++;const callback=await webhookRequest(f.request({statuses:[{id:remote,status:'delivered',timestamp:String(Math.floor(Date.now()/1000)),biz_opaque_callback_data:send.traceId}]}),f.publicId,'meta');assert.equal(callback.status,200);
  return {kind:'accepted',remoteId:remote,acceptedAt:f.now};
 }},now:()=>f.now});
 await materializeDueMessages(f.now,100);
 const state=await testAdmin(async c=>({enrollment:(await c.query('SELECT next_step,next_at,last_accepted_at,schedule_pending FROM app.cadence_enrollment WHERE workspace_id=$1',[f.u.p.workspaceId])).rows[0],message:(await c.query('SELECT state FROM app.channel_message WHERE workspace_id=$1 AND id=$2',[f.u.p.workspaceId,f.lease.messageId])).rows[0].state,consumed:Number((await c.query("SELECT sum(units) AS units FROM app.message_usage_ledger WHERE workspace_id=$1 AND event='consume'",[f.u.p.workspaceId])).rows[0].units)}));
 assert.equal(posts,1);assert.equal(state.message,'delivered');assert.equal(state.consumed,1);assert.equal(state.enrollment.next_step,1);assert.equal(state.enrollment.schedule_pending,false);assert.ok(state.enrollment.next_at.getTime()-state.enrollment.last_accepted_at.getTime()>=172800000);
});
