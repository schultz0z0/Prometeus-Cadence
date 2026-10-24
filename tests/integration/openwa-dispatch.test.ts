import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID,createHmac} from 'node:crypto';
import {getPools} from '../../src/server/db/pool.ts';import {closeDispatchPool,dispatchPool} from '../../src/server/messaging/worker-db.ts';import {closeIngressPool} from '../../src/server/channels/ingress-db.ts';
import {openwaFixture,openwaGatewayDouble,testAdmin,completeOpenwaRecoveryFixture} from './openwa-helpers.ts';import {runOpenwaMaintenanceTick} from '../../src/server/channels/openwa/lifecycle.ts';
import {saveSenderLimits} from '../../src/server/channels/limits.ts';import {claimDispatch,leaseArgs} from '../../src/server/messaging/lease.ts';import {dispatchOne} from '../../src/server/messaging/dispatch.ts';
import {handleChannelIngress} from '../../src/server/channels/openwa/events.ts';import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';import {readCredentialInTransaction} from '../../src/server/channels/repository.ts';
after(async()=>{await Promise.all([getPools().close(),closeDispatchPool(),closeIngressPool()]);});
async function ready(t:any,existing?:Awaited<ReturnType<typeof openwaFixture>>){
 const f=existing??await openwaFixture(),gateway=openwaGatewayDouble();Object.assign(process.env,{OPENWA_API_ORIGIN:'http://127.0.0.1:2785',OPENWA_ADMIN_API_KEY:'fixture-admin-key'});delete process.env.CHANNEL_PUBLIC_BASE_URL;
 const mock=t.mock.method(globalThis,'fetch',gateway.fetch);await testAdmin(c=>c.query("UPDATE app.openwa_connection SET next_at=clock_timestamp()+interval '1 day' WHERE connection_id<>$1",[f.id]));
 await runOpenwaMaintenanceTick({now:new Date(Date.now()+1000).toISOString(),maxConnections:5});gateway.paired=true;await runOpenwaMaintenanceTick({now:new Date(Date.now()+31000).toISOString(),maxConnections:1});
 const sender=await testAdmin(async c=>(await c.query('SELECT * FROM app.channel_sender WHERE connection_id=$1',[f.id])).rows[0]);
 const revision=await testAdmin(async c=>(await c.query('SELECT revision FROM app.messaging_limits WHERE workspace_id=$1',[f.u.p.workspaceId])).rows[0]?.revision??0);
 await saveSenderLimits(f.u.p,{requestId:randomUUID(),expectedRevision:Number(revision),workspaceDailyLimit:20,senderId:sender.id,senderDailyLimit:20,senderNewConversationLimit:5});
 const current=await testAdmin(async c=>(await c.query('SELECT * FROM app.channel_sender WHERE id=$1',[sender.id])).rows[0]);await completeOpenwaRecoveryFixture(f.id);return {...f,sender:current,gateway,mock};
}
async function queued(f:Awaited<ReturnType<typeof ready>>){return testAdmin(async c=>{
 const ws=f.u.p.workspaceId,identity=randomUUID(),conv=randomUUID(),message=randomUUID(),phone='15550000002',scope='openwa:'+f.id;
 await c.query('INSERT INTO app.channel_identity(workspace_id,id,scope,external_id,phone) VALUES($1,$2,$3,$4,$5)',[ws,identity,scope,phone+'@c.us','+'+phone]);
 await c.query("INSERT INTO app.consent_evidence(workspace_id,id,identity_id,purpose,source,occurred_at,evidence,actor_id) VALUES($1,$2,$3,'campaign','fixture',clock_timestamp()-interval '1 minute','Authorized fixture',$4)",[ws,randomUUID(),identity,f.u.p.userId]);
 await c.query('INSERT INTO app.channel_conversation(workspace_id,id,connection_id,sender_id,identity_id) VALUES($1,$2,$3,$4,$5)',[ws,conv,f.id,f.sender.id,identity]);
 await c.query("INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,text,purpose) VALUES($1,$2,$3,$4,$5,$6,'outbound','Reviewed fixture','campaign')",[ws,message,f.id,f.sender.id,identity,conv]);
 const send={connectionId:f.id,connectionRevision:1,senderId:f.sender.id,identity:{scope,externalId:phone+'@c.us',phone:'+'+phone},purpose:'campaign',content:{kind:'text',text:'Reviewed fixture'}};
 await c.query("INSERT INTO app.message_outbox(workspace_id,message_id,connection_id,sender_id,identity_id,actor_id,authority_kind,prepared_send,proof,next_at) VALUES($1,$2,$3,$4,$5,$6,'admin',$7,$8,clock_timestamp()-interval '1 second')",[ws,message,f.id,f.sender.id,identity,f.u.p.userId,JSON.stringify(send),JSON.stringify({senderRevision:Number(f.sender.revision),replyEpoch:0})]);return message;
});}
const stored=(id:string)=>testAdmin(async c=>(await c.query('SELECT state FROM app.channel_message WHERE id=$1',[id])).rows[0].state);
test('OpenWA dispatch outside service window requires consent, uses private webhook, consumes atomic quota and never regresses early read',async t=>{
 const f=await ready(t),id=await queued(f),lease=await claimDispatch(new Date().toISOString(),{workspaceId:f.u.p.workspaceId,messageId:id});assert.ok(lease);
 const cred=await withWorkspaceTransaction(f.u.p,c=>readCredentialInTransaction(c,f.id));const publicId=await testAdmin(async c=>(await c.query('SELECT public_id FROM app.channel_connection WHERE id=$1',[f.id])).rows[0].public_id);let posts=0;
 f.mock.mock.mockImplementation(async(url:any,init:any)=>{
  if(!String(url).endsWith('/messages/send-text'))return f.gateway.fetch(url,init);posts++;assert.equal(new Headers(init.headers).get('idempotency-key'),lease.attemptId);
  assert.deepEqual(JSON.parse(init.body),{chatId:'15550000002@c.us',text:'Reviewed fixture'});
  const remote='true_15550000002@c.us_'+randomUUID(),raw=JSON.stringify({event:'message.ack',sessionId:f.gateway.session.id,timestamp:new Date().toISOString(),deliveryId:randomUUID(),idempotencyKey:randomUUID(),data:{id:remote,messageId:remote,chatId:'15550000002@c.us',status:'read',ack:3}});
  assert.equal((await handleChannelIngress(new Request('http://channel-ingress:3214/api/channel-webhooks/openwa/'+publicId,{method:'POST',headers:{'content-type':'application/json','x-openwa-signature':'sha256='+createHmac('sha256',cred.credentials.webhookSecret).update(raw).digest('hex')},body:raw}))).status,200);
  return Response.json({messageId:remote,timestamp:Math.floor(Date.now()/1000)},{status:201});
 });
 await dispatchOne(lease,{now:()=>new Date().toISOString()});assert.equal(posts,1);assert.equal(await stored(id),'read');
 assert.equal(await testAdmin(async c=>(await c.query('SELECT consumed FROM app.openwa_usage_reservation WHERE attempt_id=$1',[lease.attemptId])).rows[0]?.consumed),true);
});
test('lost POST response stays uncertain beyond gateway idempotency expiry and cannot be attested not sent',async t=>{
 const f=await ready(t),id=await queued(f),lease=await claimDispatch(new Date().toISOString(),{workspaceId:f.u.p.workspaceId,messageId:id});assert.ok(lease);let posts=0;
 f.mock.mock.mockImplementation(async(url:any,init:any)=>{if(!String(url).endsWith('/messages/send-text'))return f.gateway.fetch(url,init);posts++;throw Error('response lost after intent');});
 await dispatchOne(lease,{now:()=>new Date().toISOString()});assert.equal(await stored(id),'uncertain');
 assert.equal(await claimDispatch(new Date(Date.now()+25*3600000).toISOString(),{workspaceId:f.u.p.workspaceId,messageId:id}),null);await dispatchOne(lease,{now:()=>new Date().toISOString()});assert.equal(posts,1);
 assert.equal(await testAdmin(async c=>(await c.query('SELECT released FROM app.openwa_usage_reservation WHERE attempt_id=$1',[lease.attemptId])).rows[0]?.released),false);
 await assert.rejects(withWorkspaceTransaction(f.u.p,c=>c.query("SELECT app.admin_reconcile_message($1,$2,'not_accepted',NULL,$3)",[id,lease.attemptId,JSON.stringify({evidence:'Absence in a bounded history cannot establish non acceptance.',verifiedByUser:true})])),/OPENWA_NON_ACCEPTANCE_UNPROVEN/);
});
test('SQL final guard repeats capability and contact binding even when TypeScript is bypassed',async t=>{
 const f=await ready(t),id=await queued(f);await testAdmin(c=>c.query("UPDATE app.message_outbox SET prepared_send=jsonb_set(prepared_send,'{identity,externalId}','\"15550000003@c.us\"') WHERE message_id=$1",[id]));
 const lease=await claimDispatch(new Date().toISOString(),{workspaceId:f.u.p.workspaceId,messageId:id});assert.ok(lease);
 const ctx=(await dispatchPool().query('SELECT app.read_message_dispatch($1,$2,$3,$4) AS data',leaseArgs(lease))).rows[0].data;
 const result=(await dispatchPool().query('SELECT app.begin_message_dispatch($1,$2,$3,$4,$5,$6,$7) AS data',[lease.workspaceId,id,lease.attemptId,lease.token,lease.fence,ctx.guard,new Date().toISOString()])).rows[0].data;
 assert.equal(result.allowed,false);assert.equal(result.code,'CONTACT_CHANGED');
});
test('two OpenWA connections share the last workspace slot without leaking a second provider quota hold',async t=>{
 const a=await ready(t),{createOpenwaRecord}=await import('../../src/server/channels/openwa/repository.ts'),input={requestId:randomUUID(),name:'Second fixture'},view=await createOpenwaRecord(a.u.p,input);
 const b=await ready(t,{u:a.u,input,view,id:view.connection.id});await testAdmin(c=>c.query('UPDATE app.messaging_limits SET workspace_daily_limit=1 WHERE workspace_id=$1',[a.u.p.workspaceId]));
 const ids=[await queued(a),await queued(b)],leases=await Promise.all(ids.map(messageId=>claimDispatch(new Date().toISOString(),{workspaceId:a.u.p.workspaceId,messageId})));assert.ok(leases[0]);assert.ok(leases[1]);
 let posts=0;const {createOpenwaAdapter}=await import('../../src/server/channels/providers/openwa.ts');const adapter=createOpenwaAdapter(async()=>{posts++;return Response.json({messageId:'true_15550000002@c.us_'+randomUUID(),timestamp:Math.floor(Date.now()/1000)},{status:201});});
 await Promise.all(leases.map(lease=>dispatchOne(lease!,{adapter,now:()=>new Date().toISOString()})));assert.equal(posts,1);
 assert.equal(await testAdmin(async c=>(await c.query('SELECT count(*) FROM app.openwa_usage_reservation WHERE workspace_id=$1',[a.u.p.workspaceId])).rows[0].count),'1');
});
test('proven pre-send rejection releases only its own atomic reservation',async t=>{
 const f=await ready(t),id=await queued(f),lease=await claimDispatch(new Date().toISOString(),{workspaceId:f.u.p.workspaceId,messageId:id});assert.ok(lease);
 f.mock.mock.mockImplementation(async(url:any,init:any)=>String(url).endsWith('/messages/send-text')?Response.json({code:'IDEMPOTENCY_KEY_INVALID'},{status:400}):f.gateway.fetch(url,init));
 await dispatchOne(lease,{now:()=>new Date().toISOString()});assert.equal(await stored(id),'failed');
 assert.equal(await testAdmin(async c=>(await c.query('SELECT released FROM app.openwa_usage_reservation WHERE attempt_id=$1',[lease.attemptId])).rows[0]?.released),true);
});
