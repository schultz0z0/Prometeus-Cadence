import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {getPools} from '../../src/server/db/pool.ts';import {dispatchPool,closeDispatchPool} from '../../src/server/messaging/worker-db.ts';
import {saveSenderLimits} from '../../src/server/channels/limits.ts';import {openwaFixture,openwaGatewayDouble,testAdmin} from './openwa-helpers.ts';import {runOpenwaMaintenanceTick} from '../../src/server/channels/openwa/lifecycle.ts';
after(async()=>{await Promise.all([getPools().close(),closeDispatchPool()]);});
async function ready(t:any){const f=await openwaFixture(),gateway=openwaGatewayDouble();Object.assign(process.env,{OPENWA_API_ORIGIN:'http://127.0.0.1:2785',OPENWA_ADMIN_API_KEY:'fixture-admin-key'});t.mock.method(globalThis,'fetch',gateway.fetch);await testAdmin(c=>c.query("UPDATE app.openwa_connection SET next_at=clock_timestamp()+interval '1 day' WHERE connection_id<>$1",[f.id]));await runOpenwaMaintenanceTick({now:new Date(Date.now()+1000).toISOString(),maxConnections:5});gateway.paired=true;await runOpenwaMaintenanceTick({now:new Date(Date.now()+31000).toISOString(),maxConnections:1});const sender=await testAdmin(async c=>(await c.query('SELECT * FROM app.channel_sender WHERE connection_id=$1',[f.id])).rows[0]);return {...f,sender};}
async function pending(f:Awaited<ReturnType<typeof ready>>,person?:string){return testAdmin(async c=>{
 const ws=f.u.p.workspaceId,identity=person??randomUUID(),message=randomUUID(),attempt=randomUUID(),conv=randomUUID(),token=randomUUID();
 if(!person){await c.query("INSERT INTO app.channel_identity(workspace_id,id,scope,external_id,phone) VALUES($1,$2,$3,$4,$5)",[ws,identity,'openwa:'+f.id,'1555'+String(Math.floor(Math.random()*10000000)).padStart(7,'0')+'@c.us','+15550000002']);await c.query("INSERT INTO app.consent_evidence(workspace_id,id,identity_id,purpose,source,occurred_at,evidence,actor_id) VALUES($1,$2,$3,'campaign','fixture',clock_timestamp()-interval '1 minute','Authorized fixture',$4)",[ws,randomUUID(),identity,f.u.p.userId]);}
 await c.query('INSERT INTO app.channel_conversation(workspace_id,id,connection_id,sender_id,identity_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[ws,conv,f.id,f.sender.id,identity]);const v=(await c.query('SELECT id FROM app.channel_conversation WHERE sender_id=$1 AND identity_id=$2',[f.sender.id,identity])).rows[0].id;
 await c.query("INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,text,purpose) VALUES($1,$2,$3,$4,$5,$6,'outbound','fixture','campaign')",[ws,message,f.id,f.sender.id,identity,v]);
 await c.query("INSERT INTO app.message_outbox(workspace_id,message_id,connection_id,sender_id,identity_id,actor_id,authority_kind,prepared_send,proof,lease_token,lease_until,fence) VALUES($1,$2,$3,$4,$5,$6,'admin',$7,'{}',$8,clock_timestamp()+interval '60 seconds',1)",[ws,message,f.id,f.sender.id,identity,f.u.p.userId,JSON.stringify({purpose:'campaign',content:{kind:'text',text:'fixture'}}),token]);
 await c.query("INSERT INTO app.message_dispatch_attempt(workspace_id,id,message_id,attempt_number,fence,lease_token,state) VALUES($1,$2,$3,1,1,$4,'prepared')",[ws,attempt,message,token]);return {ws,identity,message,attempt,token};
});}
const reserve=(row:Awaited<ReturnType<typeof pending>>,now=new Date().toISOString())=>dispatchPool().query('SELECT app.reserve_openwa_usage($1,$2,$3,$4,$5,$6) AS result',[row.ws,row.message,row.attempt,row.token,1,now]).then(r=>r.rows[0].result);
test('platform limits reject excessive UI and direct SQL values without raising shared workspace budget',async t=>{
 const f=await ready(t);
 await saveSenderLimits(f.u.p,{requestId:randomUUID(),expectedRevision:0,workspaceDailyLimit:30,senderId:f.sender.id,senderDailyLimit:20,senderNewConversationLimit:5});
 await assert.rejects(saveSenderLimits(f.u.p,{requestId:randomUUID(),expectedRevision:1,workspaceDailyLimit:100,senderId:f.sender.id,senderDailyLimit:21,senderNewConversationLimit:5}),{status:422});
 await assert.rejects(testAdmin(c=>c.query('UPDATE app.channel_sender SET daily_limit=21 WHERE id=$1',[f.sender.id])),/OPENWA_PLATFORM_LIMIT/);
 assert.equal(await testAdmin(async c=>(await c.query('SELECT workspace_daily_limit FROM app.messaging_limits WHERE workspace_id=$1',[f.u.p.workspaceId])).rows[0].workspace_daily_limit),30);
});
test('twenty daily automated attempts and five unique new contacts are atomically bounded; uncertainty keeps reservations',async t=>{
 const f=await ready(t),rows:Awaited<ReturnType<typeof pending>>[]=[];for(let i=0;i<5;i++)rows.push(await pending(f));
 for(const row of rows)assert.equal((await reserve(row)).allowed,true);
 assert.equal((await reserve(await pending(f))).code,'OPENWA_NEW_CONVERSATION_LIMIT');
 for(let i=0;i<15;i++)assert.equal((await reserve(await pending(f,rows[i%5].identity))).allowed,true);
 assert.equal((await reserve(await pending(f,rows[0].identity))).code,'OPENWA_DAILY_LIMIT');
 await testAdmin(c=>c.query("UPDATE app.message_dispatch_attempt SET state='uncertain' WHERE id=$1",[rows[0].attempt]));
 await dispatchPool().query('SELECT app.settle_openwa_usage($1,$2)',[rows[0].ws,rows[0].attempt]);
 assert.equal((await reserve(await pending(f,rows[0].identity))).code,'OPENWA_DAILY_LIMIT');
});
test('concurrent last slots serialize; one failed attempt cannot release another hold for the same person',async t=>{
 const f=await ready(t);await testAdmin(c=>c.query('UPDATE app.channel_sender SET daily_limit=3,new_conversation_limit=1 WHERE id=$1',[f.sender.id]));
 const a=await pending(f),b=await pending(f,a.identity),outsider=await pending(f);
 const results=await Promise.all([reserve(a),reserve(b),reserve(outsider)]);assert.equal(results.filter(r=>r.allowed).length,2);assert.equal(results[2].code,'OPENWA_NEW_CONVERSATION_LIMIT');
 await testAdmin(c=>c.query("UPDATE app.message_dispatch_attempt SET state='not_accepted' WHERE id=$1",[a.attempt]));await dispatchPool().query('SELECT app.settle_openwa_usage($1,$2)',[a.ws,a.attempt]);assert.equal((await reserve(outsider)).allowed,false);
 await testAdmin(c=>c.query("UPDATE app.message_dispatch_attempt SET state='not_accepted' WHERE id=$1",[b.attempt]));await dispatchPool().query('SELECT app.settle_openwa_usage($1,$2)',[b.ws,b.attempt]);assert.equal((await reserve(outsider)).allowed,true);
 const sameDay=await pending(f,outsider.identity),other=await pending(f,outsider.identity);assert.equal((await reserve(sameDay)).allowed,true);
 const final=await Promise.all([reserve(other),reserve(await pending(f,outsider.identity))]);assert.equal(final.filter(r=>r.allowed).length,1);
});
test('Sao Paulo midnight resets counts; inbound contacts bypass only new-contact cap, suppression and invalid clocks fail closed',async t=>{
 const f=await ready(t);await testAdmin(c=>c.query('UPDATE app.channel_sender SET daily_limit=1,new_conversation_limit=1 WHERE id=$1',[f.sender.id]));
 const a=await pending(f);await testAdmin(c=>c.query("UPDATE app.consent_evidence SET occurred_at='2020-01-01T00:00:00Z' WHERE workspace_id=$1",[f.u.p.workspaceId]));assert.equal((await reserve(a,'2026-10-24T02:59:59Z')).allowed,true);
 const afterMidnight=await pending(f);await testAdmin(c=>c.query("UPDATE app.consent_evidence SET occurred_at='2020-01-01T00:00:00Z' WHERE workspace_id=$1",[f.u.p.workspaceId]));assert.equal((await reserve(afterMidnight,'2026-10-24T03:00:00Z')).allowed,true);
 const known=await pending(f);await testAdmin(c=>c.query("INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,text,state,occurred_at) SELECT workspace_id,$2,connection_id,sender_id,identity_id,conversation_id,'inbound','Known contact','received',clock_timestamp() FROM app.channel_message WHERE id=$1",[known.message,randomUUID()]));
 await testAdmin(c=>c.query("UPDATE app.consent_evidence SET occurred_at='2020-01-01T00:00:00Z' WHERE workspace_id=$1",[f.u.p.workspaceId]));await testAdmin(c=>c.query('UPDATE app.channel_sender SET daily_limit=3 WHERE id=$1',[f.sender.id]));assert.equal((await reserve(known,'2026-10-24T03:00:01Z')).allowed,true);
 await testAdmin(c=>c.query("INSERT INTO app.contact_suppression(workspace_id,identity_id,reason) VALUES($1,$2,'fixture')",[a.ws,a.identity]));assert.equal((await reserve(await pending(f,a.identity),'2026-10-24T03:00:02Z')).code,'CONTACT_SUPPRESSED');
 await assert.rejects(reserve(await pending(f),'invalid'));
});
test('service without an inbound timestamp cannot use SQL null to bypass consent',async t=>{
 const f=await ready(t),row=await pending(f);
 await testAdmin(c=>c.query("UPDATE app.message_outbox SET prepared_send=jsonb_set(prepared_send,'{purpose}','\"service\"') WHERE message_id=$1",[row.message]));
 assert.equal((await reserve(row)).code,'OPT_IN_REQUIRED');
});
