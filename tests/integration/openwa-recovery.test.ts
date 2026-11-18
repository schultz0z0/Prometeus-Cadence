import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {openwaFixture,openwaGatewayDouble,testAdmin} from './openwa-helpers.ts';import {runOpenwaMaintenanceTick,requestOpenwaDisconnect} from '../../src/server/channels/openwa/lifecycle.ts';import {runOpenwaRecoveryTick} from '../../src/server/channels/openwa/recovery.ts';
import {getPools} from '../../src/server/db/pool.ts';import {closeDispatchPool,dispatchPool} from '../../src/server/messaging/worker-db.ts';
after(async()=>{await Promise.all([getPools().close(),closeDispatchPool()]);});
async function ready(t:any){const f=await openwaFixture(),gateway=openwaGatewayDouble();Object.assign(process.env,{OPENWA_API_ORIGIN:'http://127.0.0.1:2785',OPENWA_ADMIN_API_KEY:'fixture-admin-key'});const mock=t.mock.method(globalThis,'fetch',gateway.fetch);await testAdmin(c=>c.query("UPDATE app.openwa_connection SET next_at=clock_timestamp()+interval '1 day' WHERE connection_id<>$1",[f.id]));await runOpenwaMaintenanceTick({now:new Date(Date.now()+1000).toISOString(),maxConnections:5});gateway.paired=true;await runOpenwaMaintenanceTick({now:new Date(Date.now()+31000).toISOString(),maxConnections:1});await testAdmin(c=>c.query("UPDATE app.openwa_connection SET automation_paused=true WHERE connection_id<>$1",[f.id]));await testAdmin(c=>c.query("UPDATE app.openwa_connection SET messages_since=clock_timestamp()-interval '60 seconds',protected_since=clock_timestamp()-interval '60 seconds' WHERE connection_id=$1",[f.id]));return {...f,gateway,mock};}
const now=()=>new Date().toISOString();
test('authenticated newest-first REST recovery walks a fixed bounded window, deduplicates and stores gateway-read provenance without sending',async t=>{
 const f=await ready(t),stamp=Math.floor(Date.now()/1000),rows=Array.from({length:23},(_,i)=>({id:randomUUID(),sessionId:f.gateway.session.id,waMessageId:'false_15550000002@c.us_'+i,chatId:'15550000002@c.us',from:'15550000002@c.us',to:'15550000001@c.us',body:'Recovered fixture '+i,type:'text',timestamp:stamp-i,direction:'incoming',status:'sent'}));let calls=0,sendCalls=0,until:string|null=null;
 f.mock.mock.mockImplementation(async(url:any,init:any)=>{const u=new URL(String(url));if(u.pathname.endsWith('/messages/send-text')){sendCalls++;throw Error('No send allowed');}if(u.pathname.endsWith('/messages')){calls++;assert.equal(u.searchParams.get('inlineMedia'),'false');assert.ok(u.searchParams.get('since'));if(until)assert.equal(u.searchParams.get('until'),until);else until=u.searchParams.get('until');const after=u.searchParams.get('after'),offset=after?rows.findIndex(r=>r.id===after)+1:0;return Response.json({messages:rows.slice(offset,offset+20),total:23,unknownTimestampTotal:0});}return f.gateway.fetch(url,init);});
 assert.equal((await runOpenwaRecoveryTick({now:now(),maxConnections:1,maxMessages:20})).failed,0);
 await testAdmin(c=>c.query("UPDATE app.openwa_recovery SET next_at=clock_timestamp()-interval '1 second' WHERE connection_id=$1",[f.id]));
 assert.equal((await runOpenwaRecoveryTick({now:now(),maxConnections:1,maxMessages:20})).failed,0);assert.equal(calls,2);assert.equal(sendCalls,0);
 assert.equal(await testAdmin(async c=>(await c.query("SELECT count(*) FROM app.channel_message WHERE connection_id=$1 AND direction='inbound'",[f.id])).rows[0].count),'23');
 assert.equal(await testAdmin(async c=>(await c.query("SELECT count(*) FROM app.channel_received_event WHERE connection_id=$1 AND event_metadata->>'source'='gateway-read'",[f.id])).rows[0].count),'23');
 await testAdmin(c=>c.query("UPDATE app.openwa_recovery SET next_at=clock_timestamp()-interval '1 second' WHERE connection_id=$1",[f.id]));await runOpenwaRecoveryTick({now:now(),maxConnections:1,maxMessages:20});assert.equal(await testAdmin(async c=>(await c.query('SELECT count(*) FROM app.channel_message WHERE connection_id=$1',[f.id])).rows[0].count),'23');
});
test('late REST response after logout has no authority and oversized history creates a visible recovery gap',async t=>{
 const f=await ready(t);let during=false;
 f.mock.mock.mockImplementation(async(url:any,init:any)=>{if(new URL(String(url)).pathname.endsWith('/messages')){if(!during){during=true;await requestOpenwaDisconnect(f.u.p,f.id,{requestId:randomUUID(),expectedRevision:1});}return Response.json({messages:[{id:randomUUID(),sessionId:f.gateway.session.id,waMessageId:'late-remote',chatId:'15550000002@c.us',from:'15550000002@c.us',to:'15550000001@c.us',body:'Late fixture',type:'text',timestamp:Math.floor(Date.now()/1000),direction:'incoming',status:'sent'}],total:1});}return f.gateway.fetch(url,init);});
 await runOpenwaRecoveryTick({now:now(),maxConnections:1,maxMessages:20});assert.equal(await testAdmin(async c=>(await c.query('SELECT count(*) FROM app.channel_message WHERE connection_id=$1',[f.id])).rows[0].count),'0');
 const g=await ready(t);await testAdmin(c=>c.query("INSERT INTO app.openwa_recovery(workspace_id,connection_id,revision,checkpoint,next_at) SELECT workspace_id,connection_id,revision,clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 second' FROM app.openwa_connection WHERE connection_id=$1",[g.id]));
 // A day-long pause is read back in 15-minute windows: the first one advances the checkpoint and the number stays active.
 const windows:string[]=[];g.mock.mock.mockImplementation(async(url:any,init:any)=>{const u=new URL(String(url));if(u.pathname.endsWith('/messages')){windows.push(u.searchParams.get('since')+'-'+u.searchParams.get('until'));return Response.json({messages:[],total:0,unknownTimestampTotal:0});}return g.gateway.fetch(url,init);});
 const before=await testAdmin(async c=>(await c.query('SELECT checkpoint FROM app.openwa_recovery WHERE connection_id=$1',[g.id])).rows[0].checkpoint);
 await runOpenwaRecoveryTick({now:now(),maxConnections:1,maxMessages:20});
 const after=await testAdmin(async c=>(await c.query('SELECT r.checkpoint,r.error_code,o.automation_paused FROM app.openwa_recovery r JOIN app.openwa_connection o USING(workspace_id,connection_id) WHERE r.connection_id=$1',[g.id])).rows[0]);
 assert.equal(after.automation_paused,false);assert.equal(after.error_code,null);
 const advanced=after.checkpoint.getTime()-before.getTime();assert.ok(advanced>13*60000&&advanced<=15*60000,'advanced '+advanced);
});
test('known outbound ACK is read through the scoped API; missing history is not non-acceptance and failed recovery backs off five times',async t=>{
 const f=await ready(t);await testAdmin(c=>c.query("UPDATE app.openwa_recovery SET next_at=clock_timestamp()+interval '1 day' WHERE connection_id<>$1",[f.id]));
 const remote='true_15550000002@c.us_KNOWN';let fail=false,queries=0,sendCalls=0;
 f.mock.mock.mockImplementation(async(url:any,init:any)=>{const u=new URL(String(url));if(u.pathname.endsWith('/messages')){if(fail)throw Error('outage');queries++;return Response.json({messages:u.searchParams.has('messageId')?[{id:randomUUID(),sessionId:f.gateway.session.id,waMessageId:remote,chatId:'15550000002@c.us',direction:'outgoing',status:'read',timestamp:Math.floor(Date.now()/1000)}]:[],total:u.searchParams.has('messageId')?1:0});}if(init?.method==='POST')sendCalls++;return f.gateway.fetch(url,init);});
 const id=await testAdmin(async c=>{const ws=f.u.p.workspaceId,i=randomUUID(),v=randomUUID(),id=randomUUID(),sender=(await c.query('SELECT id FROM app.channel_sender WHERE connection_id=$1',[f.id])).rows[0].id;await c.query('INSERT INTO app.channel_identity(workspace_id,id,scope,external_id,phone) VALUES($1,$2,$3,$4,$5)',[ws,i,'openwa:'+f.id,'15550000002@c.us','+15550000002']);await c.query('INSERT INTO app.channel_conversation(workspace_id,id,connection_id,sender_id,identity_id) VALUES($1,$2,$3,$4,$5)',[ws,v,f.id,sender,i]);await c.query("INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,text,state,remote_id) VALUES($1,$2,$3,$4,$5,$6,'outbound','fixture','accepted',$7)",[ws,id,f.id,sender,i,v,remote]);return id;});
 await runOpenwaRecoveryTick({now:now(),maxConnections:1,maxMessages:20});assert.equal(queries,2);assert.equal(sendCalls,0);assert.equal(await testAdmin(async c=>(await c.query('SELECT state FROM app.channel_message WHERE id=$1',[id])).rows[0].state),'read');
 fail=true;for(let i=0;i<5;i++){await testAdmin(c=>c.query("UPDATE app.openwa_recovery SET next_at=clock_timestamp()-interval '1 second' WHERE connection_id=$1",[f.id]));const result=await runOpenwaRecoveryTick({now:now(),maxConnections:1,maxMessages:20});assert.equal(result.failed,1);}
 assert.equal(await testAdmin(async c=>(await c.query('SELECT phase FROM app.openwa_connection WHERE connection_id=$1',[f.id])).rows[0].phase),'action_required');assert.equal((await runOpenwaRecoveryTick({now:now(),maxConnections:5,maxMessages:20})).processed,0);assert.equal(sendCalls,0);
});
test('expired recovery lease cannot ingest a late snapshot',async t=>{
 const f=await ready(t);await testAdmin(c=>c.query("UPDATE app.openwa_recovery SET next_at=clock_timestamp()+interval '1 day' WHERE connection_id<>$1",[f.id]));
 const lease=(await dispatchPool().query('SELECT app.claim_openwa_recovery($1) AS value',[now()])).rows[0].value;assert.ok(lease);await testAdmin(c=>c.query("UPDATE app.openwa_recovery SET lease_until=clock_timestamp()-interval '1 second' WHERE connection_id=$1",[f.id]));
 assert.equal((await dispatchPool().query('SELECT app.finish_openwa_recovery($1,$2,$3,$4,$5) AS value',[lease.workspaceId,lease.connectionId,lease.token,lease.fence,{kind:'page',cursor:null,events:[]}])).rows[0].value,false);
});
for(const status of ['pending','delivered'])test(`our own send (${status}) without a WhatsApp timestamp yet is not a recovery gap`,async t=>{
 // 16/11/2026: an approved SDR reply was already "delivered" while WhatsApp had not stamped it; the number was paused.
 const f=await ready(t);await testAdmin(c=>c.query("UPDATE app.openwa_recovery SET next_at=clock_timestamp()+interval '1 day' WHERE connection_id<>$1",[f.id]));
 f.mock.mock.mockImplementation(async(url:any,init:any)=>{if(new URL(String(url)).pathname.endsWith('/messages'))return Response.json({messages:[{id:randomUUID(),sessionId:f.gateway.session.id,waMessageId:'true_15550000002@c.us_'+status.toUpperCase(),chatId:'15550000002@c.us',direction:'outgoing',status,timestamp:null,type:'text',body:'Resposta'}],total:1,unknownTimestampTotal:1});return f.gateway.fetch(url,init);});
 assert.equal((await runOpenwaRecoveryTick({now:now(),maxConnections:1,maxMessages:20})).failed,0);
 assert.equal(await testAdmin(async c=>(await c.query('SELECT automation_paused FROM app.openwa_connection WHERE connection_id=$1',[f.id])).rows[0].automation_paused),false);
});
// 18/11/2026: a recovery pause shows its reason and an admin can resume sending without a new QR.
test('an admin resumes sending after a recovery pause; pairing and restriction pauses still require reconnecting',async t=>{
 const f=await ready(t);const {resumeOpenwaSending}=await import('../../src/server/channels/openwa/lifecycle.ts');
 const pause=(code:string)=>testAdmin(async c=>{
  await c.query("UPDATE app.openwa_connection SET automation_paused=true,phase='action_required',error_code=$2 WHERE connection_id=$1",[f.id,code]);
  await c.query("UPDATE app.channel_connection SET state='attention',last_error=$2 WHERE id=$1",[f.id,code]);
  await c.query("INSERT INTO app.openwa_recovery(workspace_id,connection_id,revision,checkpoint,failures,error_code) SELECT workspace_id,connection_id,revision,clock_timestamp()-interval '2 days',4,$2 FROM app.openwa_connection WHERE connection_id=$1 ON CONFLICT(workspace_id,connection_id) DO UPDATE SET checkpoint=EXCLUDED.checkpoint,failures=4,error_code=EXCLUDED.error_code",[f.id,code]);
 });
 const revision=async()=>Number(await testAdmin(async c=>(await c.query('SELECT revision FROM app.channel_connection WHERE id=$1',[f.id])).rows[0].revision));
 await pause('OPENWA_PAIRING_EXPIRED');
 await assert.rejects(resumeOpenwaSending(f.u.p,f.id,{requestId:randomUUID(),expectedRevision:await revision()}),{code:'OPENWA_RESUME_NOT_ALLOWED'});
 await pause('OPENWA_RECOVERY_GAP');
 // The periodic gateway check keeps the number paused but must not replace the reason (the resume button depends on it).
 await testAdmin(c=>c.query("UPDATE app.openwa_connection SET next_at=clock_timestamp()-interval '1 second' WHERE connection_id=$1",[f.id]));
 await runOpenwaMaintenanceTick({now:new Date(Date.now()+60000).toISOString(),maxConnections:1});
 assert.deepEqual(await testAdmin(async c=>(await c.query('SELECT o.automation_paused,o.error_code,c.last_error FROM app.openwa_connection o JOIN app.channel_connection c ON c.workspace_id=o.workspace_id AND c.id=o.connection_id WHERE o.connection_id=$1',[f.id])).rows[0]),{automation_paused:true,error_code:'OPENWA_RECOVERY_GAP',last_error:'OPENWA_RECOVERY_GAP'});
 const view=await resumeOpenwaSending(f.u.p,f.id,{requestId:randomUUID(),expectedRevision:await revision()});
 assert.equal(view.phase,'ready');assert.equal(view.errorCode,null);
 const row=await testAdmin(async c=>(await c.query("SELECT o.automation_paused,c.state,c.last_error,r.failures,r.error_code,r.checkpoint>clock_timestamp()-interval '1 minute' AS fresh FROM app.openwa_connection o JOIN app.channel_connection c ON c.workspace_id=o.workspace_id AND c.id=o.connection_id JOIN app.openwa_recovery r ON r.workspace_id=o.workspace_id AND r.connection_id=o.connection_id WHERE o.connection_id=$1",[f.id])).rows[0]);
 assert.deepEqual(row,{automation_paused:false,state:'ready',last_error:null,failures:0,error_code:null,fresh:true});
});
